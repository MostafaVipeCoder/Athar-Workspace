/**
 * The ways an image can be refused by the pipeline. One class, one stable `code`; `messageKey` is the i18n key (`errors.image.<code>`,
 * ar + en in the base dictionary) so every consumer shows the same sentence: `t(error.messageKey)`.
 *
 *   required        no file
 *   empty           a zero-byte file
 *   type            not an image we accept (PDF, text, ...)
 *   size            larger than the source ceiling
 *   corrupt         the bytes are not a decodable image (damaged / truncated / not what the name says)
 *   heic            HEIC/HEIF that this browser cannot decode (ask for JPEG or PNG)
 *   tooLarge        more pixels than the decoder budget
 *   svg             an SVG where only rasters are accepted
 *   svgUnsafe       an SVG with scripts / event handlers / external references
 *   webpUnsupported WebP could not be produced: the browser's canvas cannot encode it (Safari / iOS) AND the WebAssembly fallback encoder
 *                   could not be loaded or run (offline, blocked, no WebAssembly)
 *   aborted         the caller cancelled
 */
export const IMAGE_ERROR_CODES = ['required', 'empty', 'type', 'size', 'corrupt', 'heic', 'tooLarge', 'svg', 'svgUnsafe', 'webpUnsupported', 'aborted']

export class ImageError extends Error {
  constructor(code, { cause } = {}) {
    super(`errors.image.${code}`)
    this.name = 'ImageError'
    this.code = code
    this.messageKey = `errors.image.${code}`
    this.cause = cause
  }
}
