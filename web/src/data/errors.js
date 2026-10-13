/**
 * One error contract for the data layer (design 06 section 5.2): data functions THROW AppError, never swallow and
 * return []. Postgres/PostgREST/Auth codes are mapped once, here.
 */
export const ERROR_CODES = ['forbidden', 'not_found', 'conflict', 'validation', 'unauthenticated', 'network', 'config', 'unknown']

export class AppError extends Error {
  constructor(code, { messageKey, cause, retryable, detail } = {}) {
    super(messageKey ?? `errors.${code}`)
    this.name = 'AppError'
    this.code = ERROR_CODES.includes(code) ? code : 'unknown'
    this.messageKey = messageKey ?? `errors.${this.code}`
    this.cause = cause
    this.detail = detail
    this.retryable = retryable ?? (this.code === 'network' || this.code === 'unknown')
  }
}

const PG_MAP = {
  '42501': 'forbidden', // insufficient_privilege (also raised by our RPCs as 'forbidden')
  '23505': 'conflict', // unique_violation
  '40001': 'conflict', // serialization / our save_node revision conflict
  '23503': 'validation', // fk violation
  '23514': 'validation', // check violation
  '22023': 'validation', // invalid_parameter_value
  '22P02': 'validation', // invalid text representation
  PGRST116: 'not_found', // single() found no row
  PGRST301: 'unauthenticated', // JWT expired / invalid
  '28000': 'unauthenticated',
}

/**
 * Server error TOKENS: our RPCs/triggers raise with a message that starts with a stable token (and repeat it in `hint`),
 * so the client can show a specific translation instead of the generic one for the SQLSTATE. Keep in sync with db/migrations.
 */
const TOKEN_KEYS = {
  staff_founder_exclusive: 'errors.staffFounderExclusive', // m25 (08 section 15)
  // m31 public form submission (hint = token; `form_invalid` carries "<key>:<reason>" in detail -> field errors)
  form_closed: 'form.err.closed',
  form_full: 'form.err.full',
  form_duplicate: 'form.err.duplicate',
  form_rate_limited: 'form.err.rateLimited',
  form_not_found: 'form.err.notFound',
  form_invalid: 'form.err.invalid',
  // m33 selection e-mails / participants (hint = token)
  selection_confirm_required: 'selection.err.confirmRequired',
  selection_no_template: 'selection.err.noTemplate',
  selection_no_booking: 'selection.err.noBooking',
  selection_bad_base_url: 'selection.err.badBaseUrl',
  selection_daily_cap: 'selection.err.dailyCap',
  selection_not_enrolling: 'selection.err.notEnrolling',
  // m34 booking (hint = token; `booking_invalid` carries "<field>:<reason>" in detail)
  slot_unavailable: 'booking.err.slotUnavailable',
  slot_too_soon: 'booking.err.slotTooSoon',
  invitation_required: 'booking.err.invitationRequired',
  already_booked: 'booking.err.alreadyBooked',
  booking_limit_reached: 'booking.err.limitReached',
  booking_not_found: 'booking.err.notFound',
  booking_invalid: 'booking.err.invalid',
  booking_not_confirmed: 'booking.err.notConfirmed',
  booking_shared_link_required: 'booking.err.sharedLinkRequired',
  // m35 distribution (hint = token; `distribution_invalid` carries "<field>:<reason>" in detail)
  distribution_invalid: 'distribution.err.invalid',
  distribution_day_locked: 'distribution.err.dayLocked',
  distribution_company_double_booked: 'distribution.err.companyDoubleBooked',
  distribution_mentor_double_booked: 'distribution.err.mentorDoubleBooked',
  distribution_pair_repeated: 'distribution.err.pairRepeated',
  distribution_conflict: 'distribution.err.conflict',
  timer_no_round: 'distribution.err.timerNoRound',
  timer_no_next: 'distribution.err.timerNoNext',
  // m36 library (hint = token; `library_invalid` carries "resource:<id>:<field>" or "category:<id>:<field>" in detail)
  library_invalid: 'library.err.invalid',
  // m37 landing page save (hint = token; `landing_invalid` carries "<field>:<reason>" in detail)
  landing_invalid: 'landing.err.invalid',
  // m38 certificates (hint = token; `certificate_invalid` carries "<field>:<reason>" in detail)
  certificate_invalid: 'certificates.err.invalid',
  certificate_project_not_completed: 'certificates.err.notCompleted',
  certificate_template_missing: 'certificates.err.templateMissing',
  certificate_template_incomplete: 'certificates.err.templateIncomplete',
  certificate_not_attended: 'certificates.err.notAttended',
  certificate_no_name: 'certificates.err.noName',
  certificate_rate_limited: 'certificates.err.rateLimited',
}

function tokenOf(error) {
  const hint = String(error.hint ?? '')
  if (TOKEN_KEYS[hint]) return hint
  const m = /^([a-z_]+):/.exec(String(error.message ?? ''))
  return m && TOKEN_KEYS[m[1]] ? m[1] : null
}

/** Map a supabase-js / PostgREST / GoTrue error (or any thrown value) to an AppError. */
export function fromSupabase(error) {
  if (!error) return null
  if (error instanceof AppError) return error

  const status = error.status ?? error.statusCode
  const rawCode = String(error.code ?? '')
  const msg = String(error.message ?? '')
  const token = tokenOf(error)
  if (token) {
    const e = new AppError(PG_MAP[rawCode] ?? 'validation', { messageKey: TOKEN_KEYS[token], cause: error, retryable: false, detail: error.details ?? error.detail })
    e.token = token
    return e
  }

  if (error.name === 'TypeError' && /fetch|network|failed/i.test(msg)) {
    return new AppError('network', { cause: error, retryable: true })
  }
  if (error.name === 'AuthRetryableFetchError' || status === 0) {
    return new AppError('network', { cause: error, retryable: true })
  }
  if (error.name === 'AuthApiError' || error.name === 'AuthError') {
    if (/invalid login credentials|invalid_credentials/i.test(`${msg} ${rawCode}`)) {
      return new AppError('unauthenticated', { messageKey: 'errors.invalidCredentials', cause: error, retryable: false })
    }
    if (status === 429) return new AppError('unknown', { messageKey: 'errors.rateLimited', cause: error, retryable: true })
    return new AppError('unauthenticated', { cause: error, retryable: false })
  }
  if (PG_MAP[rawCode]) {
    const code = PG_MAP[rawCode]
    return new AppError(code, { cause: error, retryable: false, detail: error.details ?? error.detail })
  }
  if (/forbidden/i.test(msg)) return new AppError('forbidden', { cause: error, retryable: false })
  if (status === 401) return new AppError('unauthenticated', { cause: error, retryable: false })
  if (status === 403) return new AppError('forbidden', { cause: error, retryable: false })
  if (status === 404) return new AppError('not_found', { cause: error, retryable: false })
  if (status === 409) return new AppError('conflict', { cause: error, retryable: false })
  if (status >= 500) return new AppError('unknown', { cause: error, retryable: true })
  return new AppError('unknown', { cause: error })
}

/** Convenience: run a supabase builder result `{data, error}` and throw or return data. */
export function unwrap({ data, error }) {
  if (error) throw fromSupabase(error)
  return data
}

/** True when retrying could help (used by the QueryClient retry policy). */
export function isRetryable(error) {
  return error instanceof AppError ? error.retryable : true
}
