import qrcode from 'qrcode-generator'

/**
 * Local QR codes (design 07 section 4.5): the verification URL is encoded IN THE BROWSER by a small MIT library; nothing is ever
 * sent to a third-party image service (the as-is generator leaked every verify URL to a third-party QR image service). The matrix is drawn as
 * crisp rectangles, so the code stays sharp at any canvas size.
 */

/** { size, modules: boolean[][] } for `text` (byte mode, error correction M by default, version chosen automatically). */
export function qrMatrix(text, { level = 'M' } = {}) {
  const value = String(text ?? '')
  if (!value) throw new Error('qr: nothing to encode')
  const qr = qrcode(0, level)
  qr.addData(value)
  qr.make()
  const size = qr.getModuleCount()
  const modules = []
  for (let r = 0; r < size; r += 1) {
    const row = []
    for (let c = 0; c < size; c += 1) row.push(qr.isDark(r, c))
    modules.push(row)
  }
  return { size, modules }
}

/**
 * Draw a QR matrix into the square (left, top, side) of a 2D context: a white quiet-zone background (so it scans on a dark or
 * decorated template too) and the dark modules on top. Rectangles are snapped to whole device pixels to avoid hairline seams.
 */
export function drawQr(ctx, matrix, left, top, side, { margin = 2, dark = '#000000', light = '#ffffff' } = {}) {
  const cells = matrix.size + margin * 2
  const unit = side / cells
  ctx.fillStyle = light
  ctx.fillRect(left, top, side, side)
  ctx.fillStyle = dark
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (!matrix.modules[r][c]) continue
      const x0 = Math.floor(left + (c + margin) * unit)
      const y0 = Math.floor(top + (r + margin) * unit)
      const x1 = Math.ceil(left + (c + margin + 1) * unit)
      const y1 = Math.ceil(top + (r + margin + 1) * unit)
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
  }
}
