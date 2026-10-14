/**
 * Pure logic of the open founder sign-up (`/signup`) and the invitation sign-up (`/invite/:token`).
 * Errors are i18n KEYS (the page translates them); the database trigger decides what the account becomes (the role is never sent from here).
 */
import { isEmail } from './contact.js'

export const MIN_PASSWORD = 8

/** `{ field: i18nKey }`; empty = valid. The password rule matches the staff invitation (8 characters). */
export function validateSignupForm({ fullName, email, password, confirm }) {
  const e = {}
  if (!fullName?.trim() || fullName.trim().length < 2) e.fullName = 'invite.nameRequired'
  if (!email?.trim()) e.email = 'auth.fieldRequired'
  else if (!isEmail(email.trim()) || /\s/.test(email.trim())) e.email = 'alumni.auth.emailInvalid'
  if (!password || password.length < MIN_PASSWORD) e.password = 'invite.passwordShort'
  else if (password !== confirm) e.confirm = 'invite.passwordMismatch'
  return e
}

/** The staff roles: an account holding one can never hold `founder` (08 section 15), so such a session cannot accept a founder invitation. */
export const STAFF_ROLES = Object.freeze(['super_admin', 'project_manager', 'alumni_manager'])
export const holdsStaffRole = (roles) => (Array.isArray(roles) ? roles : []).some((r) => STAFF_ROLES.includes(r))

/** The company name of an invitation in the page language (the RPC returns both and a legacy `company_name`). */
export function invitationCompanyName(inv, lang) {
  const first = lang === 'ar' ? inv?.company_name_ar : inv?.company_name_en
  const second = lang === 'ar' ? inv?.company_name_en : inv?.company_name_ar
  return (first || second || inv?.company_name || '').trim()
}
