/**
 * Image diagnostics (owner decision 08 section 18.5): everything the dev page /dev/image-check needs that is NOT a browser call, so it is
 * unit-tested. The owner opens the page on an iPhone / Mac Safari, picks a photo, and sends back the report; nothing here needs engineering help.
 *
 *   parseUserAgent(ua, { touchPoints })      { device, os, browser, engine, mobile }
 *   readExifOrientation(bytes)               1..8 | null   (JPEG APP1 / TIFF IFD0 tag 0x0112)
 *   orientationVerdict({...})                did the pipeline apply the rotation tag? ('ok' | 'fail' | 'na' | 'unknown')
 *   isWebpBytes / isJpegBytes / isProgressiveJpeg
 *   stageTimings(events, endAt)              [{ stage, ms }] + total, from the pipeline's progress events
 *   collectEnvironment(scope)                the browser facts (injectable: tests pass a fake window)
 *   buildReport({ now, page, env, probes, runs })   { text, verdict: 'pass' | 'warn' | 'fail', summary }
 *
 * The report is plain English text (the engineer reads it), whatever language the page is in.
 */
import { formatBytes } from './format.js'

/** `WebAssembly.validate` input that only passes where the engine supports SIMD (the same bytes `wasm-feature-detect` uses). */
export const SIMD_PROBE = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11)

// ------------------------------------------------------------------ user agent
const num = (m, i = 1) => (m && m[i] ? m[i] : '')

/** What the user agent says: device, OS, browser (+version), engine. `touchPoints` > 1 on a "Macintosh" UA = iPadOS in desktop mode. */
export function parseUserAgent(ua, { touchPoints = 0 } = {}) {
  const s = String(ua ?? '')
  const out = { device: 'unknown', os: 'unknown', browser: 'unknown', engine: 'unknown', mobile: false }
  const ios = /(iPhone|iPad|iPod)/.exec(s)
  const macTouch = /Macintosh/.test(s) && touchPoints > 1
  if (ios || macTouch) {
    const v = /OS (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(s)
    out.device = ios ? ios[1] : 'iPad (desktop mode)'
    out.os = v ? `iOS ${v[1]}.${v[2]}${v[3] ? `.${v[3]}` : ''}` : macTouch ? 'iPadOS' : 'iOS'
    out.mobile = true
    out.engine = 'WebKit'
    const cri = /CriOS\/(\d+)/.exec(s)
    const fxi = /FxiOS\/(\d+)/.exec(s)
    const edg = /EdgiOS\/(\d+)/.exec(s)
    const ver = /Version\/(\d+(?:\.\d+)?)/.exec(s)
    out.browser = cri ? `Chrome ${num(cri)} (iOS, WebKit)` : fxi ? `Firefox ${num(fxi)} (iOS, WebKit)` : edg ? `Edge ${num(edg)} (iOS, WebKit)` : `Safari ${ver ? ver[1] : ''}`.trim()
    return out
  }
  const android = /Android (\d+(?:\.\d+)?)/.exec(s)
  if (android) {
    out.device = 'Android phone / tablet'
    out.os = `Android ${android[1]}`
    out.mobile = true
  } else if (/Windows NT/.test(s)) {
    out.device = 'Windows PC'
    out.os = 'Windows'
  } else if (/Mac OS X (\d+)[_.](\d+)/.test(s)) {
    const m = /Mac OS X (\d+)[_.](\d+)/.exec(s)
    out.device = 'Mac'
    out.os = `macOS (UA says ${m[1]}.${m[2]})`
  } else if (/Linux|X11/.test(s)) {
    out.device = 'Linux PC'
    out.os = 'Linux'
  }
  const edge = /Edg\/(\d+)/.exec(s)
  const opera = /OPR\/(\d+)/.exec(s)
  const samsung = /SamsungBrowser\/(\d+)/.exec(s)
  const firefox = /Firefox\/(\d+)/.exec(s)
  const chrome = /Chrome\/(\d+)/.exec(s)
  const safari = /Version\/(\d+(?:\.\d+)?).*Safari\//.exec(s)
  if (edge) { out.browser = `Edge ${num(edge)}`; out.engine = 'Blink' }
  else if (opera) { out.browser = `Opera ${num(opera)}`; out.engine = 'Blink' }
  else if (samsung) { out.browser = `Samsung Internet ${num(samsung)}`; out.engine = 'Blink' }
  else if (firefox) { out.browser = `Firefox ${num(firefox)}`; out.engine = 'Gecko' }
  else if (chrome) { out.browser = `Chrome ${num(chrome)}`; out.engine = 'Blink' }
  else if (safari) { out.browser = `Safari ${num(safari)}`; out.engine = 'WebKit' }
  return out
}

// ------------------------------------------------------------------ bytes
export const isWebpBytes = (b) => Boolean(b && b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
export const isJpegBytes = (b) => Boolean(b && b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)

/** Walks the JPEG segments: true when the frame header is SOF2 (progressive), false for SOF0 / SOF1 (baseline), null when it cannot tell. */
export function isProgressiveJpeg(bytes) {
  if (!isJpegBytes(bytes)) return null
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1]
    if (marker === 0xff) { i += 1; continue }
    if (marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce) return true
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc3) return false
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3])
  }
  return null
}

/** EXIF orientation (1..8) of a JPEG, or null (no EXIF, no tag, not a JPEG). Reads the first segments only: pass the first 64 KB of the file. */
export function readExifOrientation(bytes) {
  if (!bytes || bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1]
    if (marker === 0xff) { i += 1; continue }
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const isExif = marker === 0xe1 && len >= 14 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66 && bytes[i + 8] === 0 && bytes[i + 9] === 0
    if (isExif) {
      const t = i + 10
      const little = bytes[t] === 0x49 && bytes[t + 1] === 0x49
      if (!little && !(bytes[t] === 0x4d && bytes[t + 1] === 0x4d)) return null
      const u16 = (o) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1])
      const u32 = (o) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0 : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0)
      if (t + 8 > bytes.length || u16(t + 2) !== 0x2a) return null
      const ifd = t + u32(t + 4)
      if (ifd + 2 > bytes.length) return null
      const count = u16(ifd)
      for (let k = 0; k < count; k += 1) {
        const e = ifd + 2 + k * 12
        if (e + 12 > bytes.length) return null
        if (u16(e) === 0x0112) {
          const v = u16(e + 8)
          return v >= 1 && v <= 8 ? v : null
        }
      }
      return null
    }
    i += 2 + len
  }
  return null
}

export const EXIF_LABEL = {
  1: 'normal',
  2: 'mirrored',
  3: 'rotated 180',
  4: 'mirrored vertically',
  5: 'mirrored + rotated 90 clockwise',
  6: 'rotated 90 clockwise (phone held upright)',
  7: 'mirrored + rotated 90 counter-clockwise',
  8: 'rotated 90 counter-clockwise',
}

/**
 * Did the pipeline apply the photo's rotation tag? `header` = the size the FILE says (the sensor's size), `decoded` = the size the pipeline decoded.
 * Orientations 5 - 8 turn the picture on its side: the upright size is the header size with width and height swapped.
 *   ok       the decoded size is the upright size (a portrait phone photo is portrait)
 *   fail     the decoded size is the sensor size although the tag asks for a turn: the photo would be stored lying down
 *   na       no tag, or a tag that does not turn the picture (1 - 4): nothing to prove with this photo
 *   unknown  the sizes agree with neither
 */
export function orientationVerdict({ exif, headerWidth, headerHeight, decodedWidth, decodedHeight }) {
  if (!exif || exif === 1) return { status: 'na', exif: exif ?? null, note: 'no rotation tag: pick a photo taken with the phone held upright to prove the orientation' }
  const turns = exif >= 5
  if (!turns) return { status: 'na', exif, note: `the tag (${EXIF_LABEL[exif]}) does not change the size: nothing to prove with this photo` }
  if (!(headerWidth > 0 && headerHeight > 0 && decodedWidth > 0 && decodedHeight > 0)) return { status: 'unknown', exif, note: 'sizes not available' }
  if (decodedWidth === headerHeight && decodedHeight === headerWidth) return { status: 'ok', exif, note: `upright: the ${headerWidth} x ${headerHeight} sensor image was turned to ${decodedWidth} x ${decodedHeight}` }
  if (decodedWidth === headerWidth && decodedHeight === headerHeight) return { status: 'fail', exif, note: `the rotation tag (${EXIF_LABEL[exif]}) was IGNORED: decoded at ${decodedWidth} x ${decodedHeight}, the photo would be stored lying down` }
  return { status: 'unknown', exif, note: `decoded at ${decodedWidth} x ${decodedHeight}, expected ${headerHeight} x ${headerWidth}` }
}

// ------------------------------------------------------------------ timings
/**
 * The pipeline reports progress events ({ stage, ... }); with the time each one arrived the page gets how long every stage took (a stage lasts until
 * the next one starts). `events` = [{ stage, t }] in order, `endAt` = when the conversion finished. Repeated stages (the encode ladder) are summed.
 */
export function stageTimings(events, endAt) {
  const list = Array.isArray(events) ? events : []
  const totals = new Map()
  for (let i = 0; i < list.length; i += 1) {
    const next = i + 1 < list.length ? list[i + 1].t : endAt
    const ms = Math.max(0, (next ?? list[i].t) - list[i].t)
    totals.set(list[i].stage, (totals.get(list[i].stage) ?? 0) + ms)
  }
  totals.delete('done')
  const stages = [...totals].map(([stage, ms]) => ({ stage, ms: Math.round(ms) }))
  const first = list[0]?.t
  return { stages, totalMs: first == null || endAt == null ? stages.reduce((n, s) => n + s.ms, 0) : Math.round(endAt - first) }
}

// ------------------------------------------------------------------ environment
/** The browser facts of the report. `scope` defaults to the real window; tests pass a fake one. Never throws. */
export function collectEnvironment(scope = globalThis) {
  const nav = scope.navigator ?? {}
  const scr = scope.screen ?? {}
  const ua = String(nav.userAgent ?? '')
  const touchPoints = Number(nav.maxTouchPoints ?? 0)
  let simd = false
  try {
    simd = typeof scope.WebAssembly === 'object' && scope.WebAssembly.validate(SIMD_PROBE)
  } catch {
    simd = false
  }
  let timeZone = ''
  try {
    timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timeZone = ''
  }
  return {
    userAgent: ua,
    parsed: parseUserAgent(ua, { touchPoints }),
    platform: String(nav.userAgentData?.platform ?? nav.platform ?? ''),
    language: String(nav.language ?? ''),
    timeZone,
    screen: scr.width ? `${scr.width}x${scr.height}` : '',
    pixelRatio: Number(scope.devicePixelRatio ?? 1),
    viewport: scope.innerWidth ? `${scope.innerWidth}x${scope.innerHeight}` : '',
    touchPoints,
    cores: Number(nav.hardwareConcurrency ?? 0) || null,
    memoryGb: Number(nav.deviceMemory ?? 0) || null,
    online: nav.onLine !== false,
    secureContext: Boolean(scope.isSecureContext),
    crossOriginIsolated: Boolean(scope.crossOriginIsolated),
    features: {
      createImageBitmap: typeof scope.createImageBitmap === 'function',
      offscreenCanvas: typeof scope.OffscreenCanvas === 'function',
      imageData: typeof scope.ImageData === 'function',
      webAssembly: typeof scope.WebAssembly === 'object',
      wasmSimd: simd,
      clipboardApi: typeof nav.clipboard?.writeText === 'function',
      share: typeof nav.share === 'function',
    },
  }
}

// ------------------------------------------------------------------ the report
const yes = (v) => (v ? 'yes' : 'no')
const kb = (n) => (n > 0 ? formatBytes(n) : '0 B')
const ms = (n) => (n == null ? '-' : `${Math.round(n)} ms`)

function probeLine(label, p) {
  if (!p) return `${label}: not run`
  if (p.ok) return `${label}: yes${p.bytes ? ` (${p.bytes} B, ${ms(p.ms)})` : ''}`
  return `${label}: NO${p.type ? ` (the canvas answered ${p.type})` : ''}${p.error ? ` [${p.error}]` : ''}`
}

/** Overall status of one run: 'pass' | 'warn' | 'fail' + the reasons. */
export function runVerdict(run) {
  const reasons = []
  let status = 'pass'
  const bump = (s, why) => {
    reasons.push(why)
    if (s === 'fail' || (s === 'warn' && status === 'pass')) status = s
  }
  if (run.error) {
    const soft = ['heic', 'type', 'size', 'corrupt', 'svg', 'svgUnsafe', 'tooLarge'].includes(run.error.code)
    bump(soft ? 'warn' : 'fail', `conversion refused: ${run.error.code} (${run.error.message})`)
    return { status, reasons }
  }
  if (run.orientation?.status === 'fail') bump('fail', run.orientation.note)
  if (run.orientation?.status === 'unknown') bump('warn', `orientation could not be judged: ${run.orientation.note}`)
  if (run.webpMagicOk === false) bump('fail', 'the stored WebP does not start with RIFF....WEBP')
  if (run.ogMagicOk === false) bump('fail', 'the link-preview JPEG does not start with FF D8 FF')
  if (run.result?.report?.notices?.includes('ogFailed')) bump('warn', 'the link-preview JPEG could not be prepared')
  return { status, reasons }
}

/**
 * The text the owner copies. `probes` = the result of lib/image/probe.js `runProbes()` (or null), `runs` = the conversions done on the page.
 * `now` = an ISO string (injected so the output is deterministic in tests). Returns { text, verdict, summary }.
 */
export function buildReport({ now, page = {}, env = null, probes = null, runs = [] } = {}) {
  const lines = []
  const add = (s = '') => lines.push(s)
  const reasons = []
  let verdict = 'pass'
  const bump = (s, why) => {
    reasons.push(why)
    if (s === 'fail' || (s === 'warn' && verdict === 'pass')) verdict = s
  }

  // ---- probes decide the encoder path
  const decision = probes?.decision ?? null
  if (probes) {
    if (decision?.webp === 'none') bump('fail', 'this browser cannot produce WebP (neither the canvas nor the WebAssembly fallback works): no upload would be possible')
    else if (decision?.webp === 'wasm') bump('warn', 'WebP is made by the WebAssembly fallback (expected on Safari / iPhone; slower than native)')
    if (decision?.jpeg === 'none') bump('warn', 'no JPEG encoder: shared images would get no link-preview JPEG')
    else if (decision?.jpeg === 'canvas') bump('warn', 'the link-preview JPEG is made by the canvas (baseline, not progressive): the WebAssembly encoder did not run')
  } else {
    bump('warn', 'the encoding probes did not run')
  }
  if (env && !env.secureContext) bump('warn', 'this page is not a secure context (http over the network): the copy button may need the text box instead')
  const runResults = runs.map((r) => ({ run: r, verdict: runVerdict(r) }))
  for (const { run, verdict: v } of runResults) for (const why of v.reasons) bump(v.status, `photo ${run.id}: ${why}`)
  if (!runs.length) reasons.push('no photo was converted yet')

  add('ATHAR IMAGE CHECK REPORT')
  add(`Time: ${now ?? ''}`)
  if (page.url) add(`Page: ${page.url}`)
  if (page.build) add(`Build: ${page.build}`)
  add(`RESULT: ${verdict.toUpperCase()}`)
  for (const why of reasons) add(`  - ${why}`)
  add()

  if (env) {
    add('BROWSER')
    add(`User agent: ${env.userAgent}`)
    const p = env.parsed ?? {}
    add(`Detected: ${p.device ?? '?'}, ${p.os ?? '?'}, ${p.browser ?? '?'} (${p.engine ?? '?'} engine)`)
    add(`Platform: ${env.platform}   Language: ${env.language}   Time zone: ${env.timeZone}`)
    add(`Screen: ${env.screen} @${env.pixelRatio}x   Viewport: ${env.viewport}   Touch points: ${env.touchPoints}`)
    add(`CPU cores: ${env.cores ?? 'n/a'}   Memory hint: ${env.memoryGb ? `${env.memoryGb} GB` : 'n/a'}   Online: ${yes(env.online)}`)
    add(`Secure context: ${yes(env.secureContext)}   Cross-origin isolated: ${yes(env.crossOriginIsolated)}`)
    const f = env.features ?? {}
    add(`Features: createImageBitmap ${yes(f.createImageBitmap)}; OffscreenCanvas ${yes(f.offscreenCanvas)}; ImageData ${yes(f.imageData)}; WebAssembly ${yes(f.webAssembly)} (SIMD ${yes(f.wasmSimd)}); clipboard API ${yes(f.clipboardApi)}; share API ${yes(f.share)}`)
    add()
  }

  if (probes) {
    add('ENCODING PROBES (16 x 16 test image)')
    if (probes.forcedNoNativeWebp) add('DEV switch ON: the native WebP encoder is switched off on purpose (tests the WebAssembly fallback)')
    add(probeLine('Canvas WebP (OffscreenCanvas)', probes.nativeWebp?.offscreen))
    add(probeLine('Canvas WebP (page canvas)', probes.nativeWebp?.dom))
    add(probeLine('Canvas JPEG (OffscreenCanvas)', probes.nativeJpeg?.offscreen))
    add(probeLine('Canvas JPEG (page canvas)', probes.nativeJpeg?.dom))
    const w = probes.wasmWebp
    add(w ? `WebAssembly WebP: ${w.ok ? 'OK' : 'FAILED'}${w.ok ? ` first run ${ms(w.coldMs)} (includes loading the codec), warm ${ms(w.warmMs)}, ${w.bytes} B, RIFF/WEBP bytes ${yes(w.magic)}` : ''}${w.error ? ` [${w.error}]` : ''}` : 'WebAssembly WebP: not run')
    const j = probes.wasmJpeg
    add(j ? `WebAssembly JPEG: ${j.ok ? 'OK' : 'FAILED'}${j.ok ? ` first run ${ms(j.coldMs)} (includes loading the codec), warm ${ms(j.warmMs)}, ${j.bytes} B, progressive ${yes(j.progressive)}` : ''}${j.error ? ` [${j.error}]` : ''}` : 'WebAssembly JPEG: not run')
    add(`The pipeline will use: WebP = ${decision?.webp ?? '?'}, link-preview JPEG = ${decision?.jpeg ?? '?'}`)
    add()
  }

  runResults.forEach(({ run, verdict: v }) => {
    add(`PHOTO ${run.id}: ${v.status.toUpperCase()}`)
    add(`File: ${run.file?.name ?? '?'}   ${run.file?.type || 'no type'}   ${kb(run.file?.bytes)}   Profile: ${run.profile}`)
    if (run.headerInfo) add(`Source: ${run.headerInfo.type} ${run.headerInfo.width} x ${run.headerInfo.height} (the file's own size)`)
    if (run.orientation) add(`Rotation tag: ${run.orientation.exif ? `${run.orientation.exif} (${EXIF_LABEL[run.orientation.exif]})` : 'none'} -> orientation ${run.orientation.status.toUpperCase()}: ${run.orientation.note}`)
    if (run.error) {
      add(`Refused: ${run.error.code} - ${run.error.message}`)
    } else if (run.result) {
      const r = run.result
      add(`Decoded: ${r.source.width} x ${r.source.height}`)
      add(`WebP: ${r.full.width} x ${r.full.height}, ${kb(r.full.bytes)} (${r.report.kind}${r.report.savedBytes > 0 ? `, saved ${kb(r.report.savedBytes)}` : ''}${r.report.quality != null ? `, quality ${r.report.quality}` : ''}${r.report.attempts ? `, ${r.report.attempts} encode attempt${r.report.attempts > 1 ? 's' : ''}` : ''}) bytes valid ${yes(run.webpMagicOk)}`)
      add(`Thumbnail: ${r.thumb ? `${r.thumb.width} x ${r.thumb.height}, ${kb(r.thumb.bytes)}` : 'none for this profile'}`)
      add(`Link-preview JPEG: ${r.og ? `${r.og.width} x ${r.og.height}, ${kb(r.og.bytes)}, quality ${r.og.quality}, ${r.og.progressive ? 'progressive' : 'baseline'}, bytes valid ${yes(run.ogMagicOk)}` : 'none for this profile'}`)
      if (r.report.notices?.length) add(`Notices: ${r.report.notices.join(', ')}`)
      if (run.encoders) add(`Encoder used: WebP ${run.encoders.webpNative ? `native x${run.encoders.webpNative}` : ''}${run.encoders.webpWasm ? `wasm x${run.encoders.webpWasm}` : ''}${!run.encoders.webpNative && !run.encoders.webpWasm ? 'none (kept as it was)' : ''}; JPEG ${run.encoders.jpegWasm ? `wasm x${run.encoders.jpegWasm}` : ''}${run.encoders.jpegNative ? `canvas x${run.encoders.jpegNative}` : ''}${!run.encoders.jpegWasm && !run.encoders.jpegNative ? 'none' : ''}`)
    }
    if (run.timings) add(`Time: ${run.timings.stages.map((s) => `${s.stage} ${ms(s.ms)}`).join(', ')} -> total ${ms(run.timings.totalMs)}`)
    for (const why of v.reasons) add(`  ! ${why}`)
    add()
  })

  const summary = { verdict, reasons, runs: runResults.map(({ run, verdict: v }) => ({ id: run.id, status: v.status })) }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return { text: lines.join('\n') + '\n', verdict, summary }
}
