/**
 * lib/image: the ONE image pipeline of the platform (08 section 17.3, universal WebP). Import from here only:
 *   convertToWebp(file, { profile, onProgress })   browser conversion (profiles, EXIF, alpha, quality ladder, thumbnail)
 *   PROFILES / profileForKind / acceptFor           what each kind of image is prepared like
 *   buildImagePath / thumbPath / variantsOf         path conventions (`<uuid>.webp` + `<uuid>_t.webp`)
 *   describeReport / formatBytes                    the "Optimised: 2.1 MB -> 180 KB" feedback
 *   ImageError                                      every refusal, with `messageKey` = errors.image.<code>
 * Storing the result is data/storage.js's job (the only module allowed to write image files; lint + a source scan enforce it).
 */
export { convertToWebp, fitWithin, validateImageFile, svgProblem } from './convert.js'
export { PROFILES, PROFILE_NAMES, KIND_PROFILE, MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, SVG_MIME, THUMB_SUFFIX, WEBP_MIME, acceptFor, profileForKind, qualityLadder, resolveProfile } from './profiles.js'
export { buildImagePath, isSvgPath, isThumbPath, isWebpPath, newId, thumbPath, variantsOf } from './paths.js'
export { describeReport, formatBytes, ltr } from './format.js'
export { ImageError, IMAGE_ERROR_CODES } from './errors.js'
export { sniffImage, gifFrames, looksLikeSvg } from './sniff.js'
export { browserBackend } from './canvas.js'
