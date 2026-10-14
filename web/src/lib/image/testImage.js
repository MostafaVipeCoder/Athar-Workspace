/**
 * The built-in test picture of the diagnostics page (/dev/image-check, owner decision 08 section 18.5): a 2400 x 1800 PNG made on the spot, so the
 * pipeline can be proved on a device that has no photo at hand. A gradient (like a real cover), the words TOP-LEFT in the top-left corner and an arrow
 * pointing UP: at a glance it shows whether the converted image came out turned, mirrored or cropped wrongly.
 *
 * It lives here (not in the page) because `lib/image/` is the only place allowed to encode a canvas (`data/storage.guard.test.js`); nothing made here
 * is ever stored, it only feeds `convertToWebp` as a File.
 */
export async function makeTestImageFile() {
  const c = document.createElement('canvas')
  c.width = 2400
  c.height = 1800
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 2400, 1800)
  grad.addColorStop(0, '#1a27c9')
  grad.addColorStop(1, '#ffe91e')
  g.fillStyle = grad
  g.fillRect(0, 0, 2400, 1800)
  g.fillStyle = '#ffffff'
  g.font = 'bold 150px sans-serif'
  g.fillText('TOP-LEFT', 90, 210)
  g.beginPath()
  g.moveTo(1200, 360)
  g.lineTo(1500, 800)
  g.lineTo(1300, 800)
  g.lineTo(1300, 1400)
  g.lineTo(1100, 1400)
  g.lineTo(1100, 800)
  g.lineTo(900, 800)
  g.closePath()
  g.fill()
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('this browser could not draw the test picture')
  return new File([blob], 'built-in-test.png', { type: 'image/png' })
}
