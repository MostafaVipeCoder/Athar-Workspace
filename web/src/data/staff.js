import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

/**
 * Staff management + staff invitations (08 section 14, migration m24). Every write is an RPC that re-checks super_admin
 * server-side; the client only renders. The invitation TOKEN is returned once by create_staff_invitation and is never
 * stored in the client beyond the current screen (the admin copies the link).
 */
export async function listStaff() {
  return unwrap(await db().rpc('list_staff')) ?? []
}

export async function setStaffRoles(userId, roles) {
  unwrap(await db().rpc('set_staff_roles', { p_user: userId, p_roles: roles }))
}

export async function setProgramMemberships(userId, programIds) {
  unwrap(await db().rpc('set_program_memberships', { p_user: userId, p_program_ids: programIds }))
}

export async function removeStaff(userId) {
  unwrap(await db().rpc('remove_staff', { p_user: userId }))
}

export async function listStaffInvitations() {
  return unwrap(
    await db()
      .from('staff_invitations')
      .select('id, email, roles, program_ids, language, invited_by, status, expires_at, accepted_at, created_at')
      .order('created_at', { ascending: false }),
  )
}

/** Returns { id, email, token, expires_at, roles, program_ids }. `appUrl` is the origin the e-mail link is built with. */
export async function createStaffInvitation({ email, roles, programIds = [], language = 'en', appUrl }) {
  return unwrap(
    await db().rpc('create_staff_invitation', { p_email: email, p_roles: roles, p_program_ids: programIds, p_language: language, p_app_url: appUrl ?? null }),
  )
}

export async function revokeStaffInvitation(id) {
  unwrap(await db().rpc('revoke_staff_invitation', { p_id: id }))
}

/** Anonymous: { valid, email?, inviter_name?, expires_at?, language? }. */
export async function validateStaffInvitation(token) {
  return unwrap(await db().rpc('validate_staff_invitation', { p_token: token }))
}

/** Authenticated: { accepted, already?, reason?, roles?, program_ids? }. */
export async function acceptStaffInvitation(token) {
  return unwrap(await db().rpc('accept_staff_invitation', { p_token: token }))
}

// ------------------------------------------------------------------ hooks
export const useStaff = () => useQuery({ queryKey: keys.staff(), queryFn: listStaff })
export const useStaffInvitations = () => useQuery({ queryKey: keys.staffInvitations(), queryFn: listStaffInvitations })
export const useStaffInvitation = (token) =>
  useQuery({ queryKey: keys.staffInvitation(token), queryFn: () => validateStaffInvitation(token), enabled: Boolean(token), retry: false, staleTime: 60_000 })

function useInvalidateStaff() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: keys.staff() })
    qc.invalidateQueries({ queryKey: keys.staffInvitations() })
  }
}
export function useStaffMutations() {
  const inv = useInvalidateStaff()
  const opts = { onSuccess: inv }
  return {
    setRoles: useMutation({ mutationFn: ({ userId, roles }) => setStaffRoles(userId, roles), ...opts }),
    setMemberships: useMutation({ mutationFn: ({ userId, programIds }) => setProgramMemberships(userId, programIds), ...opts }),
    remove: useMutation({ mutationFn: ({ userId }) => removeStaff(userId), ...opts }),
    invite: useMutation({ mutationFn: createStaffInvitation, ...opts }),
    revoke: useMutation({ mutationFn: ({ id }) => revokeStaffInvitation(id), ...opts }),
  }
}
