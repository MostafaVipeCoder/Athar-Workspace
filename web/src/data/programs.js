import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'
import { keys } from './queryKeys.js'

const PROGRAM_COLS = 'id, name_en, name_ar, description_en, description_ar, program_type, year, cover_path, visibility, archived_at, created_at, projects_total, completed_projects, is_completed'
const PROJECT_COLS = 'id, program_id, name_en, name_ar, description_en, description_ar, cover_path, timezone, location_en, location_ar, map_url, offline_days, transportation, show_description, show_details, visibility, completed_at, created_at'

/**
 * Programs the signed-in user can see (RLS: members, or anyone with a project membership inside; super_admin all).
 * Read through `v_programs` so completion (derived from the projects, 04 section 3.3) comes with the row.
 */
export async function listPrograms({ includeArchived = true } = {}) {
  let q = db().from('v_programs').select(PROGRAM_COLS).is('deleted_at', null).order('created_at', { ascending: false })
  if (!includeArchived) q = q.is('archived_at', null)
  return unwrap(await q)
}

export async function getProgram(programId) {
  return unwrap(await db().from('v_programs').select(PROGRAM_COLS).eq('id', programId).is('deleted_at', null).maybeSingle())
}

/** Projects the user can see (RLS: project/program members or super_admin). Optionally for one program. */
export async function listProjects(programId) {
  let q = db().from('projects').select(PROJECT_COLS).is('deleted_at', null).order('created_at', { ascending: false })
  if (programId) q = q.eq('program_id', programId)
  return unwrap(await q)
}

/** One project; RLS returns no row when the user is not allowed to see it. */
export async function getProject(projectId) {
  return unwrap(await db().from('projects').select(PROJECT_COLS).eq('id', projectId).is('deleted_at', null).maybeSingle())
}

// ------------------------------------------------------------------ writes (RPCs where they exist, else RLS-guarded updates)
/** RPC create_program (m06b): the creator becomes the program owner by trigger. Cover/visibility are set in a follow-up update. */
export async function createProgram({ name_en, name_ar, description_en, description_ar, program_type, year, cover_path, visibility }) {
  const row = unwrap(
    await db().rpc('create_program', {
      p_name_en: name_en || null, p_name_ar: name_ar || null, p_description_en: description_en || null, p_description_ar: description_ar || null,
      p_program_type: program_type || null, p_year: year ? Number(year) : null,
    }),
  )
  if (cover_path || (visibility && visibility !== 'private')) {
    return updateProgram(row.id, { cover_path: cover_path ?? null, visibility: visibility ?? 'private' })
  }
  return row
}

const PROGRAM_EDITABLE = ['name_en', 'name_ar', 'description_en', 'description_ar', 'program_type', 'year', 'cover_path', 'visibility', 'archived_at']

export async function updateProgram(programId, patch) {
  const clean = {}
  for (const k of PROGRAM_EDITABLE) if (k in patch) clean[k] = patch[k] === '' ? null : patch[k]
  if (clean.year !== undefined && clean.year !== null) clean.year = Number(clean.year)
  return unwrap(await db().from('programs').update(clean).eq('id', programId).select('id').single())
}

export const archiveProgram = (programId, archived = true) => updateProgram(programId, { archived_at: archived ? new Date().toISOString() : null })

/** RPC create_project (m06b): creator becomes project owner; the hidden view_host node is created by the RPC. */
export async function createProject({ program_id, name_en, name_ar, timezone }) {
  return unwrap(await db().rpc('create_project', { p_program: program_id, p_name_en: name_en || null, p_name_ar: name_ar || null, p_timezone: timezone || 'Africa/Cairo' }))
}

const PROJECT_EDITABLE = ['name_en', 'name_ar', 'description_en', 'description_ar', 'cover_path', 'timezone', 'location_en', 'location_ar', 'map_url', 'offline_days', 'transportation', 'show_description', 'show_details', 'visibility']

/** Project Details + settings (RLS: project manager). Empty strings become NULL; offline_days is coerced. */
export async function updateProject(projectId, patch) {
  const clean = {}
  for (const k of PROJECT_EDITABLE) if (k in patch) clean[k] = patch[k] === '' ? null : patch[k]
  if ('offline_days' in clean && clean.offline_days !== null) clean.offline_days = Number(clean.offline_days)
  return unwrap(await db().from('projects').update(clean).eq('id', projectId).select('id').single())
}

export async function completeProject(projectId) {
  unwrap(await db().rpc('complete_project', { p_project: projectId }))
}
export async function reopenProject(projectId) {
  unwrap(await db().rpc('reopen_project', { p_project: projectId }))
}
/** Decision 01-11: "complete all" shortcut on Program Settings. Returns the number of projects completed. */
export async function completeAllProjects(programId) {
  return unwrap(await db().rpc('complete_all_projects', { p_program: programId }))
}

// ------------------------------------------------------------------ hooks
export const usePrograms = (opts) => useQuery({ queryKey: keys.programs(), queryFn: () => listPrograms(opts) })
export const useProgram = (programId) => useQuery({ queryKey: keys.program(programId), queryFn: () => getProgram(programId), enabled: Boolean(programId) })
export const useProjects = (programId) => useQuery({ queryKey: keys.projects(programId ?? 'all'), queryFn: () => listProjects(programId) })
export const useProject = (projectId) =>
  useQuery({ queryKey: keys.project(projectId), queryFn: () => getProject(projectId), enabled: Boolean(projectId) })

function useInvalidate() {
  const qc = useQueryClient()
  return (programId, projectId) => {
    qc.invalidateQueries({ queryKey: ['programs'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    if (projectId) qc.invalidateQueries({ queryKey: keys.project(projectId) })
    if (programId) qc.invalidateQueries({ queryKey: keys.program(programId) })
  }
}

export function useCreateProgram() {
  const inv = useInvalidate()
  return useMutation({ mutationFn: createProgram, onSuccess: () => inv() })
}
export function useUpdateProgram(programId) {
  const inv = useInvalidate()
  return useMutation({ mutationFn: (patch) => updateProgram(programId, patch), onSuccess: () => inv(programId) })
}
export function useCreateProject() {
  const inv = useInvalidate()
  return useMutation({ mutationFn: createProject, onSuccess: (row) => inv(row?.program_id) })
}
export function useUpdateProject(projectId, programId) {
  const inv = useInvalidate()
  return useMutation({ mutationFn: (patch) => updateProject(projectId, patch), onSuccess: () => inv(programId, projectId) })
}
export function useProjectCompletion(programId) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ projectId, completed }) => (completed ? completeProject(projectId) : reopenProject(projectId)),
    onSuccess: (_d, v) => inv(programId, v.projectId),
  })
}
export function useCompleteAll(programId) {
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => completeAllProjects(programId), onSuccess: () => inv(programId) })
}
