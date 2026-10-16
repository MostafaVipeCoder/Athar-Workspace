/**
 * Data layer of the QUARTERLY figures (owner decision 21; m66 figures, m67 portfolio, m68 reminders). ONE function per RPC; every function throws AppError (data/errors.js).
 *
 * The model in one paragraph: a company's figures are a free-form DRAFT (`saveCompanyFigures`, no per-edit history, only "last modified"); the quarter's close freezes a SNAPSHOT
 * and the snapshots are the only data the graphs and the portfolio aggregates read. A founder confirms his figures (`confirmCompanyFigures`); a manager closes / reopens / corrects
 * a quarter. Reminders (notification + e-mail) are sent by the scheduler and manually (`sendAlumniReminders`).
 *
 * Query keys live under ['alumni', 'quarters', ...]: `useAlumniMutations()` (data/alumni.js) and `useQuarterMutations()` below invalidate everything under ['alumni'] (except the lookups).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from './client.js'
import { unwrap } from './errors.js'

const rpc = async (name, args) => unwrap(await db().rpc(name, args))
const ROOT = ['alumni', 'quarters']

export const quarterKeys = {
  root: () => ROOT,
  figures: (companyId) => [...ROOT, 'figures', companyId],
  portfolio: (params) => [...ROOT, 'portfolio', params],
  status: (params) => [...ROOT, 'status', params],
  settings: () => [...ROOT, 'settings'],
  campaigns: (params) => [...ROOT, 'campaigns', params],
  recipients: (params) => [...ROOT, 'recipients', params],
  drafts: (ids) => [...ROOT, 'drafts', ids],
}

/** The `expected` of a company that has NO draft yet: a draft that appeared meanwhile is a conflict. */
export const NO_DRAFT = '-infinity'

// ------------------------------------------------------------------ a company's figures
/**
 * `{ company_id, calendar_period, target_period, period_start, period_end, deadline, status, target_status, draft, snapshots[] }`. `draft` = the free-form current values with
 * `updated_at` / `updated_source` ("last modified"), `confirmed`, and (a manager only) `updated_by_name` / `confirmed_by_name`; `snapshots[]` = the FROZEN quarters, newest first
 * (`period_key, status (frozen | reopened), reported, confirmed, corrected, previous_values, frozen_at, frozen_source`, the figures, `team_size`, `female_founders`, `operating_status`).
 */
export const getCompanyFigures = (companyId) => rpc('get_company_figures', { p_company: companyId })
/** `data` keys: revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs (null clears, absent keys stay). `expected` = the draft's `updated_at` (or NO_DRAFT). */
export const saveCompanyFigures = (companyId, data, expected = null) => rpc('save_company_figures', { p_company: companyId, p_data: data, ...(expected ? { p_expected: expected } : {}) })
/** A founder of the company: "these figures are right for the quarter". Any later edit makes it unconfirmed again. */
export const confirmCompanyFigures = (companyId) => rpc('confirm_company_figures', { p_company: companyId })

// ------------------------------------------------------------------ manager: close / reopen / correct
/** "Close quarter now": one company or (null) every alumni company; an existing snapshot is NEVER overwritten. -> `{ period, frozen, already_frozen, skipped }`. */
export const closeAlumniQuarter = (period, companyId = null) => rpc('close_alumni_quarter', { p_period: period, p_company: companyId })
export const reopenAlumniQuarter = (period, companyId = null) => rpc('reopen_alumni_quarter', { p_period: period, p_company: companyId })
export const refreezeAlumniQuarter = (period, companyId = null) => rpc('refreeze_alumni_quarter', { p_period: period, p_company: companyId })
/** Patch of a REOPENED snapshot (or the backfill of a quarter that ended without one): the original frozen value of a changed metric is kept once in `previous_values`. Keys also allow team_size / female_founders. */
export const correctAlumniSnapshot = (companyId, period, data) => rpc('correct_alumni_snapshot', { p_company: companyId, p_period: period, p_data: data })

// ------------------------------------------------------------------ manager: the portfolio and the quarter status
/** `{ latest, from, to, periods: [{ period_key, companies, reporting, revenue_total, revenue_median, employees_total, employees_female, female_share, freelancers, funding_total, team_size, female_founders, open, closed, survival_rate, closed_new, at_risk, closing_rate, corrected }] }` from FROZEN snapshots only. */
export const getAlumniPortfolio = ({ filters = {}, from = null, to = null } = {}) => rpc('get_alumni_portfolio', { p_filters: filters, p_from: from, p_to: to })
/** `{ period: { key, start, end, deadline, is_current, timezone }, counts: { total, confirmed, updated, not_updated, closed }, total, rows: [{ id, name_*, status, last_modified, updated_by_name, confirmed_at, confirmed_by_name, snapshot, reminders: { count, last_at }, founders }] }`. */
export const listAlumniQuarterStatus = ({ period = null, filters = {}, status = null, limit = 50, offset = 0, sort = 'name', dir = 'asc' } = {}) =>
  rpc('list_alumni_quarter_status', { p_period: period, p_filters: filters, p_status: status, p_limit: limit, p_offset: offset, p_sort: sort, p_dir: dir })

// ------------------------------------------------------------------ manager: reminders
/** `{ first_period, auto_freeze, auto_reminders, reminder_offsets, send_hour, app_base_url, timezone, current_period, due[], templates[], placeholders[], closed_templates[], closed_placeholders[], scheduler }`. */
export const getAlumniQuarterSettings = () => rpc('get_alumni_quarter_settings', {})
/** Patch keys: auto_freeze, auto_reminders, reminder_offsets (1-6 distinct days, 1-90), send_hour (0-23, Cairo), app_base_url. */
export const setAlumniQuarterSettings = (patch) => rpc('set_alumni_quarter_settings', { p_patch: patch })
/**
 * `lang` ar | en; patch keys: notif_title, notif_body, email_subject, email_body (plain text with {founder_name} {company_name} {quarter} {deadline} {link}), finalised.
 * `variant` = 'figures' (active companies, the default) | 'closed' (closed companies, owner decision 22: "what are you doing now?"; no {deadline}).
 */
export const saveAlumniReminderTemplate = (lang, patch, variant = 'figures') => rpc('save_alumni_reminder_template', { p_lang: lang, p_patch: patch, ...(variant !== 'figures' ? { p_variant: variant } : {}) })
export const resetAlumniReminderTemplate = (lang, variant = 'figures') => rpc('reset_alumni_reminder_template', { p_lang: lang, ...(variant !== 'figures' ? { p_variant: variant } : {}) })
/** Renders a (possibly unsaved) template with sample values through the SAME code as the real send: `{ notif_title, notif_body, email_subject, email_html, email_text }`. */
export const previewAlumniReminderTemplate = (lang, template = null, variant = 'figures') => rpc('preview_alumni_reminder_template', { p_lang: lang, p_template: template, ...(variant !== 'figures' ? { p_variant: variant } : {}) })
/**
 * The two audiences, separately: `{ period, recipients, with_email, without_email, companies, already_reminded, sample[] }` = the FIGURES reminder (active companies) and `closed: { same keys }` = the
 * "what are you doing now?" reminder (closed companies), plus `total` and `confirm_above`. `onlyNew` = skip founders already reminded this quarter; `audience` = all | figures | closed.
 */
export const previewAlumniReminders = ({ period = null, companyIds = null, filters = null, onlyNew = false, audience = 'all' } = {}) =>
  rpc('preview_alumni_reminders', { p_period: period, p_company_ids: companyIds, p_filters: filters, p_only_new: onlyNew, ...(audience !== 'all' ? { p_audience: audience } : {}) })
/**
 * Sends the reminders (notification + e-mail queued for the worker). `token` makes a double click ONE send (a new token = a deliberate resend); above 100 recipients the exact
 * `expectedCount` must be given (`alumni_confirm_required` otherwise). -> `{ campaign_id, audience, sent, already_sent, no_email }`.
 */
export const sendAlumniReminders = ({ period = null, companyIds = null, filters = null, onlyNew = false, token, expectedCount = null, appUrl = null, audience = 'all' } = {}) =>
  rpc('send_alumni_reminders', { p_period: period, p_company_ids: companyIds, p_filters: filters, p_only_new: onlyNew, p_token: token, p_expected_count: expectedCount, p_app_url: appUrl, ...(audience !== 'all' ? { p_audience: audience } : {}) })
/** `{ total, rows: [{ id, period_key, trigger, kind, status, created_at, created_by_name, recipients, closed_recipients, notified, emailed, no_email, delivery, read, note }] }`. */
export const listAlumniReminderCampaigns = ({ period = null, limit = 20, offset = 0 } = {}) => rpc('list_alumni_reminder_campaigns', { p_period: period, p_limit: limit, p_offset: offset })

/** A fresh token for one send dialog (a double click = one send). */
export const newSendToken = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, '').slice(0, 32)

// ------------------------------------------------------------------ the draft rows of many companies (the manager's data-entry grid; a manager reads every draft, RLS)
const DRAFT_COLUMNS = 'company_id, period_key, revenue_total, funding_raised_total, employees_total, employees_female, freelancers, traction, challenges, needs, updated_at, updated_source, confirmed_period, confirmed_at'
export async function listDraftsForCompanies(companyIds) {
  if (!companyIds?.length) return []
  return unwrap(await db().from('company_figures').select(DRAFT_COLUMNS).in('company_id', companyIds)) ?? []
}

// ------------------------------------------------------------------ hooks
export const useCompanyFigures = (companyId, options = {}) =>
  useQuery({ queryKey: quarterKeys.figures(companyId), queryFn: () => getCompanyFigures(companyId), enabled: Boolean(companyId), staleTime: 15_000, refetchOnWindowFocus: true, ...options })
export const useAlumniPortfolio = (params = {}, options = {}) =>
  useQuery({ queryKey: quarterKeys.portfolio(params), queryFn: () => getAlumniPortfolio(params), staleTime: 60_000, placeholderData: (prev) => prev, ...options })
export const useAlumniQuarterStatus = (params = {}, options = {}) =>
  useQuery({ queryKey: quarterKeys.status(params), queryFn: () => listAlumniQuarterStatus(params), staleTime: 15_000, placeholderData: (prev) => prev, ...options })
export const useAlumniQuarterSettings = (options = {}) =>
  useQuery({ queryKey: quarterKeys.settings(), queryFn: getAlumniQuarterSettings, staleTime: 30_000, ...options })
export const useAlumniReminderCampaigns = (params = {}, options = {}) =>
  useQuery({ queryKey: quarterKeys.campaigns(params), queryFn: () => listAlumniReminderCampaigns(params), staleTime: 15_000, placeholderData: (prev) => prev, ...options })
export const useReminderPreview = (params, key, options = {}) =>
  useQuery({ queryKey: quarterKeys.recipients(key), queryFn: () => previewAlumniReminders(params), staleTime: 5_000, retry: false, ...options })
export const useDraftRows = (companyIds, options = {}) =>
  useQuery({ queryKey: quarterKeys.drafts(companyIds), queryFn: () => listDraftsForCompanies(companyIds), enabled: Boolean(companyIds?.length), staleTime: 10_000, ...options })

/** Every success refreshes everything under ['alumni'] except the vocabulary (a save changes the figures, the table, the status page, the portfolio and the overview). */
export function useQuarterMutations() {
  const qc = useQueryClient()
  const all = () => qc.invalidateQueries({ queryKey: ['alumni'], predicate: (q) => q.queryKey[1] !== 'lookups' })
  return {
    saveFigures: useMutation({ mutationFn: ({ companyId, data, expected }) => saveCompanyFigures(companyId, data, expected), onSuccess: all }),
    confirmFigures: useMutation({ mutationFn: ({ companyId }) => confirmCompanyFigures(companyId), onSuccess: all }),
    closeQuarter: useMutation({ mutationFn: ({ period, companyId }) => closeAlumniQuarter(period, companyId ?? null), onSuccess: all }),
    reopenQuarter: useMutation({ mutationFn: ({ period, companyId }) => reopenAlumniQuarter(period, companyId ?? null), onSuccess: all }),
    refreezeQuarter: useMutation({ mutationFn: ({ period, companyId }) => refreezeAlumniQuarter(period, companyId ?? null), onSuccess: all }),
    correctSnapshot: useMutation({ mutationFn: ({ companyId, period, data }) => correctAlumniSnapshot(companyId, period, data), onSuccess: all }),
    saveSettings: useMutation({ mutationFn: setAlumniQuarterSettings, onSuccess: all }),
    saveTemplate: useMutation({ mutationFn: ({ lang, patch, variant }) => saveAlumniReminderTemplate(lang, patch, variant), onSuccess: all }),
    resetTemplate: useMutation({ mutationFn: (arg) => (typeof arg === 'string' ? resetAlumniReminderTemplate(arg) : resetAlumniReminderTemplate(arg.lang, arg.variant)), onSuccess: all }),
    sendReminders: useMutation({ mutationFn: sendAlumniReminders, onSuccess: all }),
  }
}
