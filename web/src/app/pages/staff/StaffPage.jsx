import { useMemo, useState } from 'react'
import { Mail, Shield, UserMinus, Users } from 'lucide-react'
import { useStaff, useStaffInvitations, useStaffMutations } from '../../../data/staff.js'
import { usePrograms } from '../../../data/programs.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useAuth } from '../../AuthContext.js'
import { Loading, ErrorState, EmptyState } from '../../../ui/States.jsx'
import { Button } from '../../../ui/Button.jsx'
import { Avatar } from '../../../ui/Avatar.jsx'
import { Badge } from '../../../ui/Badge.jsx'
import { SearchBar, matchesTerm } from '../../../ui/SearchBar.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useConfirm } from '../../../ui/ConfirmDialog.jsx'
import RolesModal from './RolesModal.jsx'
import MembershipsModal from './MembershipsModal.jsx'
import InviteStaffModal from './InviteStaffModal.jsx'
import InvitationsList from './InvitationsList.jsx'

/**
 * /admin/staff (08 section 14, super_admin only; the route guard checks `staff:manage`, every RPC re-checks server-side).
 * Lists staff (profiles + roles + program memberships), changes roles, edits memberships, removes a staff member
 * (roles + memberships only; the auth user stays) and invites new staff by e-mail.
 */
export default function StaffPage() {
  const { t, pick } = useLanguage()
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const staff = useStaff()
  const invitations = useStaffInvitations()
  const programs = usePrograms()
  const m = useStaffMutations()
  const [term, setTerm] = useState('')
  const [editing, setEditing] = useState(null) // { kind: 'roles'|'memberships', person }
  const [inviting, setInviting] = useState(false)

  const programName = useMemo(() => {
    const map = new Map()
    for (const g of programs.data ?? []) map.set(g.id, pick(g, 'name'))
    return (id) => map.get(id) ?? '…'
  }, [programs.data, pick])

  const visible = useMemo(
    () => (staff.data ?? []).filter((p) => matchesTerm(p, ['full_name', 'email', (x) => x.roles.join(' ')], term)),
    [staff.data, term],
  )

  if (staff.isPending || programs.isPending) return <Loading />
  if (staff.error || programs.error) return <ErrorState error={staff.error ?? programs.error} onRetry={() => { staff.refetch(); programs.refetch() }} />

  async function remove(person) {
    const ok = await confirm({ title: t('staff.removeTitle'), message: t('staff.removeBody', { name: person.full_name || person.email }), destructive: true, confirmLabel: t('staff.remove') })
    if (!ok) return
    try {
      await m.remove.mutateAsync({ userId: person.id })
      toast.success(t('staff.removed'))
    } catch (err) {
      toast.error(t(err?.messageKey ?? 'errors.unknown'))
    }
  }

  return (
    <div className="space-y-6" data-testid="staff-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-section-title">{t('staff.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('staff.subtitle')}</p>
        </div>
        <Button onClick={() => setInviting(true)} data-testid="invite-staff">
          <Mail className="h-4 w-4" aria-hidden="true" />
          {t('staff.invite')}
        </Button>
      </div>

      <SearchBar value={term} onChange={setTerm} className="max-w-md" />

      {visible.length === 0 ? (
        <EmptyState icon={Users} title={t('staff.empty')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card" data-testid="staff-list">
          {visible.map((p) => {
            const isSelf = p.id === user?.id
            return (
              <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start" data-testid="staff-row" data-email={p.email}>
                <Avatar name={p.full_name || p.email} id={p.id} color={p.profile_color} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">
                    {p.full_name || p.email}
                    {isSelf && <Badge tone="neutral" className="ms-2">{t('staff.you')}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">{p.email}</p>
                  <div className="flex flex-wrap gap-1" aria-label={t('staff.roles')}>
                    {p.roles.map((r) => (
                      <Badge key={r} tone="blue">
                        <Shield className="h-3 w-3" aria-hidden="true" />
                        {t(`role.${r}`)}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1" aria-label={t('staff.programs')}>
                    {p.programs.length === 0 ? (
                      <span className="text-xs text-muted-foreground">{t('staff.noPrograms')}</span>
                    ) : (
                      p.programs.map((g) => (
                        <Badge key={g.program_id} tone="neutral">
                          {programName(g.program_id)}
                          {g.member_role === 'owner' ? ` · ${t('staff.owner')}` : ''}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 sm:flex-col sm:items-stretch">
                  <Button variant="outline" size="sm" disabled={isSelf} onClick={() => setEditing({ kind: 'roles', person: p })}>{t('staff.editRoles')}</Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing({ kind: 'memberships', person: p })}>{t('staff.editPrograms')}</Button>
                  <Button variant="ghost" size="sm" disabled={isSelf} onClick={() => remove(p)} className="text-destructive hover:bg-destructive/10">
                    <UserMinus className="h-4 w-4" aria-hidden="true" />
                    {t('staff.remove')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <InvitationsList query={invitations} programName={programName} onRevoke={(id) => m.revoke.mutateAsync({ id })} />

      {editing?.kind === 'roles' && (
        <RolesModal person={editing.person} onClose={() => setEditing(null)} onSave={(roles) => m.setRoles.mutateAsync({ userId: editing.person.id, roles })} />
      )}
      {editing?.kind === 'memberships' && (
        <MembershipsModal person={editing.person} programs={programs.data} onClose={() => setEditing(null)} onSave={(programIds) => m.setMemberships.mutateAsync({ userId: editing.person.id, programIds })} />
      )}
      {inviting && <InviteStaffModal programs={programs.data} onClose={() => setInviting(false)} onInvite={(input) => m.invite.mutateAsync(input)} />}
    </div>
  )
}
