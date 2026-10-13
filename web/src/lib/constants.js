/**
 * Shared constants (design 06 section 6.3 "constants/"). Pure data, no imports.
 * Values that are database vocabularies mirror the CHECK constraints in db/migrations (m02/m24).
 */

/** Roles a super_admin may grant through staff management / staff invitations (08 section 14). `founder` is never one. */
export const STAFF_ROLES = ['project_manager', 'super_admin', 'alumni_manager']

/** projects.transportation CHECK (01 section 4) */
export const TRANSPORTATION = ['provided', 'self_arranged']

/** programs.visibility / projects.visibility CHECK (00 section 6) */
export const VISIBILITY = ['private', 'platform', 'public']

/** programs.program_type is free text in the DB; these are the suggestions offered in the form (01 section 5). */
export const PROGRAM_TYPES = ['accelerator', 'incubator', 'bootcamp', 'hackathon', 'other']

/**
 * profiles.profile_color palette (hex, lower-case; the DB CHECK accepts any #rrggbb): the site palette (Athar blue,
 * link blue, green, yellow, black, ink, slate, grey, error red). Yellow gets black initials / a black check mark
 * (lib/avatar isLightColor). Stored values outside this list still render.
 */
export const PROFILE_COLORS = ['#1a27c9', '#0b75d9', '#23a455', '#ffe91e', '#000000', '#364151', '#0f172a', '#7a7a7a', '#f56c6c']

/**
 * Image storage (design 04 section 6.9, owner decision 08 section 17.3 UNIVERSAL WEBP): the public image bucket. Source ceilings, accepted types, sizes per
 * kind and the thumbnail suffix live in ONE place, lib/image/profiles.js.
 */
export const IMAGE = {
  bucket: 'public-assets',
}



export const DEFAULT_TIMEZONE = 'Africa/Cairo'
