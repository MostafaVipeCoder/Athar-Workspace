import { db } from './client.js'
import { fromSupabase, unwrap } from './errors.js'

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
