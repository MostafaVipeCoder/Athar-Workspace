/** The translation key of the answer of email_outbox_send_now: { released, queued, kicked }. */
export function sendNowMessage(result) {
  const released = Number(result?.released) || 0
  const queued = Number(result?.queued) || 0
  if (released === 0 && queued === 0) return 'outbox.toast.sendNowNone'
  return result?.kicked ? 'outbox.toast.sendNow' : 'outbox.toast.sendNowSoon'
}
