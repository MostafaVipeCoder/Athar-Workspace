import { db } from './client.js'
import { AppError, fromSupabase, unwrap } from './errors.js'
import { appBaseUrl } from '../lib/links.js'

/** Session helpers. Components never touch supabase.auth directly. */
export async function getSession() {
  const { data, error } = await db().auth.getSession()
  if (error) throw fromSupabase(error)
  return data.session
}

export function onAuthChange(callback) {
  const { data } = db().auth.onAuthStateChange((event, session) => callback(event, session))
  return () => data.subscription.unsubscribe()
}

export async function signInWithPassword(email, password) {
  const { data, error } = await db().auth.signInWithPassword({ email: String(email).trim(), password })
  if (error) throw fromSupabase(error)
  return data.session
}

export async function signOut() {
  const { error } = await db().auth.signOut()
  if (error) throw fromSupabase(error)
}

/**
 * Roles of a user. Source of truth = user_roles (RLS: a user reads their own rows; design 03/04).
 * There is no get_user_roles RPC in the migrated schema (checked), so the table is read directly.
 * A DB failure throws: the UI shows an error with retry and never trusts a stale role.
 */
export async function fetchRoles(userId) {
  const rows = unwrap(await db().from('user_roles').select('role_key').eq('user_id', userId))
  return [...new Set((rows ?? []).map((r) => r.role_key))]
}

export async function fetchProfile(userId) {
  const row = unwrap(
    await db().from('profiles').select('id, full_name, avatar_path, language, profile_color').eq('id', userId).maybeSingle(),
  )
  return row ?? null
}

/**
 * Sign-up through a STAFF invitation (08 section 14 / m24): the e-mail comes from the invitation; `staff_invitation_token`
 * in user metadata tells the DB trigger "never founder" and lets it apply the invitation atomically. Returns the session
 * (null when e-mail confirmation is on: the user confirms, signs in, and the invite page calls accept_staff_invitation).
 */
export async function signUpWithStaffInvitation({ email, password, fullName, profileColor, token }) {
  const { data, error } = await db().auth.signUp({
    email: String(email).trim(),
    password,
    options: { data: { full_name: fullName, profile_color: profileColor, staff_invitation_token: token } },
  })
  if (error) throw fromSupabase(error)
  return data.session
}

/** Supabase Auth sign-up failures -> a specific, translated AppError (the generic mapper would call all of them "unauthenticated"). */
function signUpError(error) {
  const code = String(error?.code ?? '')
  const msg = String(error?.message ?? '')
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered|already exists/i.test(msg)) {
    return new AppError('conflict', { messageKey: 'alumni.auth.emailTaken', cause: error, retryable: false })
  }
  if (code === 'weak_password' || /password should|weak password/i.test(msg)) {
    return new AppError('validation', { messageKey: 'alumni.auth.weakPassword', cause: error, retryable: false })
  }
  if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid.*e-?mail|e-?mail.*invalid/i.test(msg)) {
    return new AppError('validation', { messageKey: 'alumni.auth.emailInvalid', cause: error, retryable: false })
  }
  if (code === 'signup_disabled') return new AppError('forbidden', { messageKey: 'alumni.auth.signupDisabled', cause: error, retryable: false })
  if (code === 'captcha_failed') return new AppError('validation', { messageKey: 'alumni.auth.captchaFailed', cause: error, retryable: true })
  return fromSupabase(error)
}

/**
 * Open founder sign-up (design 09 F1) and the founder invitation sign-up (F2). The role is NEVER sent: the database trigger grants the literal
 * `founder` role and creates the `founders` row, and (when `invitationToken` is given and the e-mail is the invited one) links the account to the invited
 * company and consumes the invitation in the same transaction. `captchaToken` is the hook for the CAPTCHA widget (03 OD-5: not built yet; GoTrue only
 * checks it when CAPTCHA is enabled in the project's Auth settings).
 * Returns `{ session, user }`: `session` is null when e-mail confirmation is ON in the project (the person must confirm, then sign in); the local stack
 * auto-confirms, so a session comes back.
 */
export async function signUpFounder({ email, password, fullName, invitationToken = null, captchaToken = null }) {
  const meta = { full_name: String(fullName ?? '').trim() }
  if (invitationToken) meta.invitation_token = invitationToken
  const options = { data: meta, emailRedirectTo: `${appBaseUrl()}/login` }
  if (captchaToken) options.captchaToken = captchaToken
  const { data, error } = await db().auth.signUp({ email: String(email).trim(), password, options })
  if (error) throw signUpError(error)
  // an existing, confirmed address is answered with an obfuscated user without identities when confirmation is ON (no error): treat it as taken
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new AppError('conflict', { messageKey: 'alumni.auth.emailTaken', retryable: false })
  }
  return { session: data?.session ?? null, user: data?.user ?? null }
}

/** Own profile fields (RLS: own row). */
export async function updateProfile(userId, { full_name, profile_color, language }) {
  const patch = {}
  if (full_name !== undefined) patch.full_name = String(full_name).trim()
  if (profile_color !== undefined) patch.profile_color = profile_color ? String(profile_color).toLowerCase() : null
  if (language !== undefined) patch.language = language
  return unwrap(await db().from('profiles').update(patch).eq('id', userId).select('id, full_name, avatar_path, language, profile_color').single())
}

export async function updatePassword(password) {
  const { error } = await db().auth.updateUser({ password })
  if (error) throw fromSupabase(error)
}
