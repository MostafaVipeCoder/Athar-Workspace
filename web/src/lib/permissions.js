/**
 * Roles -> areas -> permissions (design 06 section 8.2). Client checks are UX only; RLS is the authority (design 03).
 * super_admin implies everything and is spelled out explicitly in the map instead of being special-cased in guards.
 */
export const ROLES = ['super_admin', 'project_manager', 'alumni_manager', 'founder']

export const AREAS = ['staff', 'network', 'founder']

export const PERMISSIONS = [
  'area:staff',
  'area:network',
  'area:founder',
  'program:create',
  'form-library:manage',
  'team:manage',
  'staff:manage', // 08 section 14: super_admin manages staff roles, memberships and invitations
]

const ALL = PERMISSIONS

export const ROLE_PERMISSIONS = {
  super_admin: ALL,
  project_manager: ['area:staff', 'program:create'],
  alumni_manager: ['area:network'],
  founder: ['area:founder'],
  // non-human accounts never get UI access
  integration: [],
}

export const ROLE_LABELS = {
  super_admin: { en: 'Super Admin', ar: 'مدير النظام' },
  project_manager: { en: 'Project Manager', ar: 'مدير مشروع' },
  alumni_manager: { en: 'Alumni Manager', ar: 'مدير الخريجين' },
  founder: { en: 'Founder', ar: 'مؤسس' },
  integration: { en: 'Integration', ar: 'حساب تكامل' },
}

/** Home path of each area (RoleHome and AreaSwitcher use this). */
export const AREA_HOME = {
  staff: '/programs',
  network: '/alumni/admin/dashboard',
  founder: '/alumni/founder/dashboard',
}

export function permissionsForRoles(roles = []) {
  const set = new Set()
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p)
  return set
}

export function hasPermission(roles, permission) {
  return permissionsForRoles(roles).has(permission)
}

export function areasForRoles(roles = []) {
  const perms = permissionsForRoles(roles)
  return AREAS.filter((a) => perms.has(`area:${a}`))
}

/** Where a signed-in user should land. lastArea (remembered choice) wins when still allowed. */
export function roleHome(roles = [], lastArea = null) {
  const areas = areasForRoles(roles)
  if (areas.length === 0) return '/no-access'
  if (lastArea && areas.includes(lastArea)) return AREA_HOME[lastArea]
  if (areas.length === 1) return AREA_HOME[areas[0]]
  // several areas, nothing remembered: staff-capable first (06 section 8.3 says "small chooser"; chooser is step 2b UI)
  return null
}
