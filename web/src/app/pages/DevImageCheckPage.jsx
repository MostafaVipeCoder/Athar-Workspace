import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ClipboardCopy, FlaskConical, ImagePlus, Loader2, RefreshCw, Smartphone, Trash2, TriangleAlert, XCircle } from 'lucide-react'
import { Button } from '../../ui/Button.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { cn } from '../../lib/cn.js'
import { copyText } from '../../lib/clipboard.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { translate } from '../../i18n/core.js'
import { acceptFor, convertToWebp, formatBytes } from '../../lib/image/index.js'
import { encoderStats } from '../../lib/image/canvas.js'
import { buildReport, collectEnvironment, isJpegBytes, isWebpBytes, orientationVerdict, readExifOrientation, stageTimings } from '../../lib/image/diagnostics.js'
import { runProbes } from '../../lib/image/probe.js'
import { makeTestImageFile } from '../../lib/image/testImage.js'
import { bytesOf, readHead, sniffImage } from '../../lib/image/sniff.js'
import './devImageCheck.i18n.js'

/**
 * DEV ONLY (/dev/image-check; not part of the production build, like /dev/nodes). The owner opens it on an iPhone / Mac Safari (see web/scripts/lan-dev.ps1
 * and "Testing on an iPhone" in web/README.md), picks a photo from the phone library and presses "Copy report". It runs the REAL pipeline (lib/image) on the
 * device and shows what happened: user agent, whether the browser's own WebP encoder works, whether the WebAssembly fallback loads, per-stage timings,
 * before / after bytes and dimensions, whether the photo's rotation tag was applied, the result and the link-preview JPEG. Nothing is uploaded or stored.
 * The pure parts (verdicts, report text) are lib/image/diagnostics.js; the browser probes are lib/image/probe.js.
 */
const PROFILES = ['cover', 'landing', 'content', 'avatar']
const MAX_RUNS = 4

const byteText = (n, lang) => formatBytes(n, lang) || '0 B'

async function copyReport(text, area) {
  if (await copyText(text)) return true
  try {
    area?.focus()
    area?.select()
    area?.setSelectionRange?.(0, text.length)
    return Boolean(document.execCommand?.('copy'))
  } catch {
    return false
  }
}

function Chip({ state, children }) {
  const tone = state === 'ok' ? 'green' : state === 'warn' ? 'amber' : state === 'fail' ? 'red' : 'neutral'
  const Icon = state === 'ok' ? CheckCircle2 : state === 'warn' ? TriangleAlert : state === 'fail' ? XCircle : Loader2
  return (
    <Badge tone={tone} className="shrink-0">
      <Icon className={cn('h-3.5 w-3.5', state === 'wait' && 'animate-spin')} aria-hidden="true" />
      {children}
    </Badge>
  )
}

export default function DevImageCheckPage() {
  const { t } = useLanguage()
  const [env] = useState(() => collectEnvironment())
  const [probes, setProbes] = useState(null)
  const [probing, setProbing] = useState(true)
  const [force, setForce] = useState(false)
  const [profile, setProfile] = useState('cover')
  const [anyType, setAnyType] = useState(false)
  const [busy, setBusy] = useState(null) // { stage, percent }
  const [runs, setRuns] = useState([])
  const [stamp, setStamp] = useState(() => new Date().toISOString())
  const [copied, setCopied] = useState(null)
  const [page] = useState(() => ({ url: `${window.location.origin}${window.location.pathname}`, build: `${import.meta.env.MODE}${import.meta.env.DEV ? ' (dev server)' : ''}` }))
  const counter = useRef(0)
  const area = useRef(null)
  const runsRef = useRef([])

  useEffect(() => {
    let alive = true
    runProbes({ forceNoNativeWebp: false }).then((p) => {
      if (alive) {
        setProbes(p)
        setProbing(false)
        setStamp(new Date().toISOString())
      }
    })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    runsRef.current = runs
  }, [runs])
  // object URLs of every result are revoked when the page goes away
  useEffect(() => () => {
    for (const r of runsRef.current) for (const u of Object.values(r.previews ?? {})) if (u) URL.revokeObjectURL(u)
  }, [])

  const reprobe = useCallback(async (forceNoNative) => {
    setProbing(true)
    setCopied(null)
    try {
      setProbes(await runProbes({ forceNoNativeWebp: forceNoNative }))
    } finally {
      setProbing(false)
      setStamp(new Date().toISOString())
    }
  }, [])

  function dropRuns(list) {
    for (const r of list) for (const u of Object.values(r.previews ?? {})) if (u) URL.revokeObjectURL(u)
  }

  async function runPhoto(picked) {
    counter.current += 1
    const id = counter.current
    // a new File object per run: the pipeline caches one conversion per (File, profile), and a repeated run must really convert again
    const file = new File([picked], picked.name || 'photo', { type: picked.type })
    const events = []
    const before = { ...encoderStats }
    const run = { id, file: { name: picked.name, type: picked.type, bytes: picked.size }, profile, previews: {} }
    const started = performance.now()
    try {
      const head = await readHead(file, 128 * 1024)
      run.headerInfo = sniffImage(head)
      run.exif = readExifOrientation(head)
      const result = await convertToWebp(file, {
        profile,
        onProgress: (e) => {
          events.push({ stage: e.stage, t: performance.now() })
          setBusy({ stage: e.stage, percent: e.percent })
        },
      })
      run.result = {
        source: result.source,
        full: { width: result.full.width, height: result.full.height, bytes: result.full.bytes },
        thumb: result.thumb ? { width: result.thumb.width, height: result.thumb.height, bytes: result.thumb.bytes } : null,
        og: result.og ? { width: result.og.width, height: result.og.height, bytes: result.og.bytes, quality: result.og.quality, progressive: result.og.progressive } : null,
        report: result.report,
      }
      run.webpMagicOk = isWebpBytes(await bytesOf(result.full.blob.slice(0, 16)))
      if (result.og) run.ogMagicOk = isJpegBytes(await bytesOf(result.og.blob.slice(0, 16)))
      run.previews = { original: URL.createObjectURL(file), after: URL.createObjectURL(result.full.blob), og: result.og ? URL.createObjectURL(result.og.blob) : null }
      run.orientation = orientationVerdict({ exif: run.exif, headerWidth: run.headerInfo.width, headerHeight: run.headerInfo.height, decodedWidth: result.source.width, decodedHeight: result.source.height })
    } catch (err) {
      const key = err?.messageKey
      run.error = { code: err?.code ?? 'unknown', key, message: key ? translate('en', key) : String(err?.message ?? err) }
      run.previews = { original: URL.createObjectURL(file) }
    }
    const end = performance.now()
    run.timings = stageTimings(events, end)
    if (!run.timings.totalMs) run.timings.totalMs = Math.round(end - started)
    run.encoders = {
      webpNative: encoderStats.webpNative - before.webpNative,
      webpWasm: encoderStats.webpWasm - before.webpWasm,
      jpegNative: encoderStats.jpegNative - before.jpegNative,
      jpegWasm: encoderStats.jpegWasm - before.jpegWasm,
    }
    setRuns((list) => {
      const next = [run, ...list]
      dropRuns(next.slice(MAX_RUNS))
      return next.slice(0, MAX_RUNS)
    })
    setStamp(new Date().toISOString())
    setCopied(null)
  }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || busy) return
    setBusy({ stage: 'checking', percent: 2 })
    try {
      await runPhoto(file)
    } finally {
      setBusy(null)
    }
  }
  async function onTestImage() {
    if (busy) return
    setBusy({ stage: 'checking', percent: 2 })
    try {
      await runPhoto(await makeTestImageFile())
    } finally {
      setBusy(null)
    }
  }

  const { text, verdict, summary } = useMemo(() => buildReport({ now: stamp, page, env, probes, runs }), [stamp, page, env, probes, runs])

  async function onCopy() {
    setCopied((await copyReport(text, area.current)) ? 'ok' : 'fail')
  }

  const f = env.features
  const how = (k) => t(`imgcheck.how.${k ?? 'none'}`)
  const rows = probes
    ? [
        { key: 'canvasWebp', state: probes.decision.webp === 'native' ? 'ok' : 'no', detail: probes.nativeWebp.offscreen?.ok === false && probes.nativeWebp.offscreen?.type ? `answered ${probes.nativeWebp.offscreen.type}` : probes.nativeWebp.offscreen?.error ?? '' },
        { key: 'wasmWebp', state: probes.wasmWebp.ok ? 'ok' : 'fail', detail: probes.wasmWebp.ok ? t('imgcheck.probe.coldWarm', { cold: probes.wasmWebp.coldMs, warm: probes.wasmWebp.warmMs }) : probes.wasmWebp.error ?? '' },
        { key: 'canvasJpeg', state: probes.nativeJpeg.offscreen?.ok || probes.nativeJpeg.dom?.ok ? 'ok' : 'no', detail: '' },
        { key: 'wasmJpeg', state: probes.wasmJpeg.ok ? 'ok' : 'no', detail: probes.wasmJpeg.ok ? t('imgcheck.probe.coldWarm', { cold: probes.wasmJpeg.coldMs, warm: probes.wasmJpeg.warmMs }) : probes.wasmJpeg.error ?? '' },
      ]
    : []
  const stateLabel = { ok: t('imgcheck.probe.ok'), no: t('imgcheck.probe.no'), fail: t('imgcheck.probe.failed'), wait: t('imgcheck.probes.running') }

  const banner = probing || !probes ? { state: 'wait', text: t('imgcheck.verdict.waiting') } : { state: verdict === 'pass' ? 'ok' : verdict === 'warn' ? 'warn' : 'fail', text: t(`imgcheck.verdict.${verdict}`) }

  return (
    <div className="space-y-5 py-3" data-testid="image-check-page">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-section-title"><Smartphone className="h-6 w-6 text-primary" aria-hidden="true" />{t('imgcheck.title')}</h1>
        <p className="text-sm text-foreground">{t('imgcheck.intro')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('imgcheck.steps.1')}</li>
          <li>{t('imgcheck.steps.2')}</li>
          <li>{t('imgcheck.steps.3')}</li>
        </ol>
        <p className="text-xs text-muted-foreground">{t('imgcheck.devonly')}</p>
      </header>

      <div role="status" aria-live="polite" data-testid="verdict" data-verdict={banner.state} className={cn('flex items-center gap-2 rounded-card border p-3 text-sm font-semibold', banner.state === 'ok' && 'border-success/40 bg-success/10 text-success', banner.state === 'warn' && 'border-accent bg-accent/30 text-athar-ink', banner.state === 'fail' && 'border-destructive/40 bg-destructive/10 text-destructive-text', banner.state === 'wait' && 'bg-surface text-muted-foreground')}>
        <Chip state={banner.state}>{banner.state === 'ok' ? 'OK' : banner.state === 'warn' ? '!' : banner.state === 'fail' ? 'X' : '...'}</Chip>
        <span>{banner.text}</span>
      </div>

      <section className="space-y-2 rounded-card border p-3" aria-labelledby="ic-device">
        <h2 id="ic-device" className="text-base font-semibold">{t('imgcheck.device.title')}</h2>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm" dir="ltr">
          {[
            ['device', `${env.parsed.device}`],
            ['os', env.parsed.os],
            ['browser', `${env.parsed.browser} (${env.parsed.engine})`],
            ['screen', `${env.screen} @${env.pixelRatio}x`],
            ['secure', f && env.secureContext ? t('imgcheck.yes') : t('imgcheck.no')],
            ['wasm', `${f.webAssembly ? t('imgcheck.yes') : t('imgcheck.no')} (${f.wasmSimd ? t('imgcheck.yes') : t('imgcheck.no')})`],
            ['offscreen', f.offscreenCanvas ? t('imgcheck.yes') : t('imgcheck.no')],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{t(`imgcheck.device.${k}`)}</dt>
              <dd className="font-medium" data-testid={`device-${k}`}>{v}</dd>
            </div>
          ))}
        </dl>
        {!env.secureContext && <p className="text-xs text-muted-foreground">{t('imgcheck.device.insecureNote')}</p>}
      </section>

      <section className="space-y-3 rounded-card border p-3" aria-labelledby="ic-probes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ic-probes" className="text-base font-semibold">{t('imgcheck.probes.title')}</h2>
          <Button variant="outline" size="sm" onClick={() => reprobe(force)} loading={probing} data-testid="reprobe"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('imgcheck.probes.rerun')}</Button>
        </div>
        <ul className="space-y-2" data-testid="probes">
          {(rows.length ? rows : ['canvasWebp', 'wasmWebp', 'canvasJpeg', 'wasmJpeg'].map((key) => ({ key, state: 'wait', detail: '' }))).map((r) => {
            const state = r.state === 'wait' || probing ? 'wait' : r.state
            return (
              <li key={r.key} className="flex flex-wrap items-start justify-between gap-2 text-sm" data-testid={`probe-${r.key}`} data-state={state}>
                <span>{t(`imgcheck.probe.${r.key}`)}{r.detail && <span className="block text-xs text-muted-foreground" dir="ltr">{r.detail}</span>}</span>
                <Chip state={state === 'no' ? (r.key.startsWith('wasm') ? 'fail' : 'warn') : state}>{stateLabel[state] ?? stateLabel.no}</Chip>
              </li>
            )
          })}
        </ul>
        {probes && !probing && <p className="text-sm font-medium" data-testid="probe-used">{t('imgcheck.probe.used', { webp: how(probes.decision.webp), jpeg: how(probes.decision.jpeg) })}</p>}
        {import.meta.env.DEV && (
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={force} data-testid="force-fallback" onChange={(e) => { setForce(e.target.checked); reprobe(e.target.checked) }} />
            <span><FlaskConical className="me-1 inline h-3.5 w-3.5" aria-hidden="true" />{t('imgcheck.probes.force')}</span>
          </label>
        )}
      </section>

      <section className="space-y-3 rounded-card border p-3" aria-labelledby="ic-try">
        <h2 id="ic-try" className="text-base font-semibold">{t('imgcheck.try.title')}</h2>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t('imgcheck.try.profile')}</span>
          <select className="min-h-11 w-full rounded-input border border-input bg-background px-3" value={profile} onChange={(e) => setProfile(e.target.value)} data-testid="profile">
            {PROFILES.map((p) => <option key={p} value={p}>{t(`imgcheck.profile.${p}`)}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <label className={cn('inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button bg-primary px-4 text-sm font-semibold text-primary-foreground', busy && 'pointer-events-none opacity-50')}>
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {t('imgcheck.try.pick')}
            <input type="file" className="sr-only" accept={anyType ? 'image/*' : acceptFor(profile)} onChange={onPick} disabled={Boolean(busy)} data-testid="photo-input" />
          </label>
          <Button variant="outline" className="min-h-11" onClick={onTestImage} disabled={Boolean(busy)} data-testid="test-image">{t('imgcheck.try.test')}</Button>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={anyType} onChange={(e) => setAnyType(e.target.checked)} data-testid="any-type" />
          <span>{t('imgcheck.try.any')}</span>
        </label>
        <p className="text-xs text-muted-foreground">{t('imgcheck.try.hint')}</p>
        {busy && (
          <div role="status" aria-live="polite" className="space-y-1" data-testid="photo-progress">
            <p className="text-sm">{t('imgcheck.try.working', { stage: t(`imgcheck.stage.${busy.stage}`) })}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(4, Math.min(100, busy.percent ?? 0))}%` }} /></div>
          </div>
        )}
      </section>

      {runs.map((run) => {
        const v = summary.runs.find((x) => x.id === run.id)?.status ?? 'pass'
        const r = run.result
        const o = run.orientation
        return (
          <section key={run.id} className="space-y-3 rounded-card border p-3" data-testid={`run-${run.id}`} data-status={v} aria-label={t('imgcheck.run.title', { n: run.id })}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{t('imgcheck.run.title', { n: run.id })}</h2>
              <div className="flex items-center gap-1">
                <Chip state={v === 'pass' ? 'ok' : v === 'warn' ? 'warn' : 'fail'}>{v.toUpperCase()}</Chip>
                <Button variant="ghost" size="sm" aria-label={t('imgcheck.run.remove')} onClick={() => { dropRuns([run]); setRuns((l) => l.filter((x) => x.id !== run.id)); setStamp(new Date().toISOString()) }}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground" dir="ltr">{run.file.name} · {run.file.type || '?'} · {byteText(run.file.bytes, 'en')} · {run.profile}</p>
            {run.error ? (
              <p role="alert" className="text-sm text-destructive-text" data-testid={`run-${run.id}-error`}>{t('imgcheck.run.refused', { message: run.error.key ? t(run.error.key) : run.error.message })}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[['original', run.previews.original, t('imgcheck.run.original')], ['after', run.previews.after, t('imgcheck.run.after')], ['og', run.previews.og, t('imgcheck.run.preview')]].filter(([, src]) => src).map(([k, src, label]) => (
                    <figure key={k} className="space-y-1">
                      <img src={src} alt={label} className="max-h-48 w-full rounded-input border bg-surface object-contain" data-testid={`run-${run.id}-${k}`} />
                      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
                    </figure>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t('imgcheck.run.previewHint')}</p>
                <p className={cn('flex items-start gap-1.5 text-sm font-medium', o.status === 'ok' && 'text-success', o.status === 'fail' && 'text-destructive-text')} data-testid={`run-${run.id}-orientation`} data-status={o.status}>
                  {o.status === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : o.status === 'fail' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                  <span>{t(`imgcheck.run.orientation.${o.status}`)}{run.exif ? ` (${t('imgcheck.run.rotation')}: ${run.exif})` : ''}</span>
                </p>
                <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm" dir="ltr">
                  <dt className="text-muted-foreground">{t('imgcheck.run.source')}</dt>
                  <dd>{run.headerInfo.type} {run.headerInfo.width} x {run.headerInfo.height} → {r.source.width} x {r.source.height}</dd>
                  <dt className="text-muted-foreground">{t('imgcheck.run.webp')}</dt>
                  <dd data-testid={`run-${run.id}-webp`}>{r.full.width} x {r.full.height} · {byteText(r.full.bytes, 'en')} (−{Math.max(0, Math.round((1 - r.full.bytes / Math.max(1, run.file.bytes)) * 100))}%){run.webpMagicOk ? '' : ' ✗'}</dd>
                  <dt className="text-muted-foreground">{t('imgcheck.run.thumb')}</dt>
                  <dd>{r.thumb ? `${r.thumb.width} x ${r.thumb.height} · ${byteText(r.thumb.bytes, 'en')}` : t('imgcheck.run.none')}</dd>
                  <dt className="text-muted-foreground">{t('imgcheck.run.og')}</dt>
                  <dd data-testid={`run-${run.id}-og-info`}>{r.og ? `${r.og.width} x ${r.og.height} · ${byteText(r.og.bytes, 'en')} · ${r.og.progressive ? t('imgcheck.run.progressive') : t('imgcheck.run.baseline')}` : t('imgcheck.run.none')}</dd>
                  <dt className="text-muted-foreground">{t('imgcheck.run.encoder')}</dt>
                  <dd>WebP {run.encoders.webpWasm ? `wasm x${run.encoders.webpWasm}` : run.encoders.webpNative ? `native x${run.encoders.webpNative}` : '-'} · JPEG {run.encoders.jpegWasm ? `wasm x${run.encoders.jpegWasm}` : run.encoders.jpegNative ? `canvas x${run.encoders.jpegNative}` : '-'}</dd>
                </dl>
              </>
            )}
            <p className="text-xs text-muted-foreground" dir="ltr" data-testid={`run-${run.id}-time`}>{t('imgcheck.run.time')}: {run.timings.stages.map((s) => `${s.stage} ${s.ms} ms`).join(' · ')} · {t('imgcheck.run.total')} {run.timings.totalMs} ms</p>
          </section>
        )
      })}

      <section className="space-y-2 rounded-card border p-3" aria-labelledby="ic-report">
        <h2 id="ic-report" className="text-base font-semibold">{t('imgcheck.report.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('imgcheck.report.hint')}</p>
        <textarea ref={area} readOnly dir="ltr" rows={14} value={text} onFocus={(e) => e.target.select()} className="w-full rounded-input border border-input bg-surface p-2 font-mono text-xs leading-5" data-testid="report-text" aria-label={t('imgcheck.report.title')} />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onCopy} className="min-h-11" data-testid="copy-report"><ClipboardCopy className="h-4 w-4" aria-hidden="true" />{t('imgcheck.report.copy')}</Button>
          {runs.length > 0 && <Button variant="ghost" onClick={() => { dropRuns(runs); setRuns([]); setStamp(new Date().toISOString()); setCopied(null) }} data-testid="clear-runs">{t('imgcheck.report.clear')}</Button>}
        </div>
        <p role="status" aria-live="polite" className={cn('text-sm', copied === 'ok' ? 'text-success' : 'text-destructive-text')} data-testid="copy-status">
          {copied === 'ok' ? t('imgcheck.report.copied') : copied === 'fail' ? t('imgcheck.report.copyFailed') : ''}
        </p>
      </section>
    </div>
  )
}
