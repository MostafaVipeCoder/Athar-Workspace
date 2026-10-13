import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { TemplateEditor } from '../../shared/email/TemplateEditor.jsx'
import { useBookingAdmin, useBookingExtras, useBookingLink, useBookingMutations } from '../../data/booking.js'
import { VISIBILITY } from '../../lib/constants.js'
import { buildPublicUrl, canonicalRef } from '../../lib/links.js'
import { biPick } from '../../lib/entities.js'
import { resolveTimeZone } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { EMAIL_KEYS, MEET_MODES, MODES, NOTICE_OPTIONS, PLACEHOLDERS_BY_KEY, normalizeBookingConfig, sampleVars, validateBookingConfig } from './bookingConfig.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Settings mode (design 01 section 6.3 config + 04 section 3.9 booking_settings): preset (mode), name, visibility,
 * show-to-participants, who can book (derived from the mode), max bookings per booker, default notice, Meet link mode +
 * shared link (empty = error at save time, C-3), the Google connection (placeholder select over google_connections:
 * "not connected" until 07's OAuth ships, never blocks bookings), the two e-mail templates ar/en with preview, page texts,
 * generator defaults, the public link. ONE explicit Save: node columns + config + `children.settings` in one save_node.
 */
export default function BookingSettings() {
  const { node, projectId, graph } = useNodeContext()
  const { t, tn, lang } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeBookingConfig(raw), [raw])
  const admin = useBookingAdmin(node.id)
  const extras = useBookingExtras(node.id)
  const link = useBookingLink(node.id)
  const { ensureLink } = useBookingMutations(node.id, projectId)
  const tz = resolveTimeZone(graph?.project?.timezone)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, visibility: node.visibility ?? 'private', show_to_participants: Boolean(node.show_to_participants) })
  const [base, setBase] = useState(null)
  const [settings, setSettings] = useState(null)
  const [errors, setErrors] = useState({})
  const [emailKey, setEmailKey] = useState('booking_confirmation')

  const loaded = useMemo(() => (admin.data?.settings ? { mode: admin.data.settings.mode, default_advance_notice_min: admin.data.settings.default_advance_notice_min, meeting_link_mode: admin.data.settings.meeting_link_mode, shared_meet_link: admin.data.settings.shared_meet_link ?? '', organizer_connection_id: admin.data.settings.organizer_connection_id ?? '' } : null), [admin.data])
  const settingsDirty = settings && base && !same(settings, base)
  if (loaded && (!base || (!same(loaded, base) && !settingsDirty))) {
    setBase(loaded)
    setSettings(loaded)
  }
  const s = settings ?? loaded
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.visibility !== (node.visibility ?? 'private') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty || Boolean(settingsDirty)
  const patch = (p) => setConfig({ ...config, ...p })
  const patchSettings = (p) => setSettings((cur) => ({ ...(cur ?? loaded), ...p }))
  const connections = extras.data?.connections ?? []

  async function onSave() {
    const errs = validateBookingConfig(config, s)
    setErrors(errs)
    if (Object.keys(errs).length) return
    const children = { settings: { ...s, shared_meet_link: s.shared_meet_link?.trim() || null, organizer_connection_id: s.organizer_connection_id || null, default_advance_notice_min: Number(s.default_advance_notice_min) } }
    const r = await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, visibility: fields.visibility, show_to_participants: fields.show_to_participants }, { children })
    if (r.ok) {
      setBase(s)
      setSettings(s)
      toast.success(t('booking.settings.saved'))
    } else if (r.error?.token === 'booking_shared_link_required') setErrors({ shared_meet_link: 'booking.settings.sharedLinkRequired' })
  }
  const url = link.data?.slug ? buildPublicUrl('booking', canonicalRef({ slug: link.data.slug, id: node.id })) : null
  async function copy() {
    try { await navigator.clipboard.writeText(url); toast.success(t('booking.settings.copied')) } catch { toast.info(url) }
  }
  const vars = sampleVars({ tz, projectName: biPick(extras.data?.project_name, lang), programName: biPick(extras.data?.program_name, lang), lang })

  if (admin.isPending || !s) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (admin.error) return <NodeFrame showSave={false}><ErrorState error={admin.error} onRetry={admin.refetch} /></NodeFrame>

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="booking-settings">
        <section className="grid gap-4 md:grid-cols-2">
          <Field as="select" label={t('booking.settings.preset')} value={s.mode} onChange={(e) => patchSettings({ mode: e.target.value })} hint={t('booking.settings.presetHint')} data-testid="settings-mode">
            {MODES.map((mo) => <option key={mo} value={mo}>{t(`booking.preset.${mo}`)}</option>)}
          </Field>
          <div className="space-y-1.5 text-sm">
            <span className="block text-sm font-medium text-athar-ink">{t('booking.settings.who')}</span>
            <p className="rounded-md bg-surface p-3 text-xs" data-testid="who-can-book">{t(s.mode === 'interview' ? 'booking.settings.who.invited' : 'booking.settings.who.open')}</p>
          </div>
        </section>

        <BilingualField label={t('booking.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('booking.settings.visibility')}</legend>
          <p className="text-xs text-muted-foreground">{t('booking.settings.visibilityHint')}</p>
          {VISIBILITY.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="visibility" value={v} checked={fields.visibility === v} onChange={() => setFields((f) => ({ ...f, visibility: v }))} className="h-4 w-4" />
              {t(`booking.settings.visibility.${v}`)}
            </label>
          ))}
          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} className="mt-1 h-4 w-4" />
            <span>{t('booking.settings.showToParticipants')}<span className="block text-xs text-muted-foreground">{t('booking.settings.showToParticipantsHint')}</span></span>
          </label>
        </fieldset>

        <section className="grid gap-4 md:grid-cols-2" data-testid="settings-rules">
          <Field as="select" label={t('booking.settings.notice')} value={String(s.default_advance_notice_min)} onChange={(e) => patchSettings({ default_advance_notice_min: Number(e.target.value) })} hint={t('booking.settings.noticeHint')} error={errors.default_advance_notice_min && t(errors.default_advance_notice_min)} data-testid="settings-notice">
            {[...new Set([...NOTICE_OPTIONS, Number(s.default_advance_notice_min)])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{tn('booking.notice.minutes', v)}</option>)}
          </Field>
          {s.mode === 'mentor' && (
            <Field label={t('booking.settings.max')} type="number" min="1" dir="ltr" value={config.rules.max_bookings_per_email ?? ''} onChange={(e) => patch({ rules: { ...config.rules, max_bookings_per_email: e.target.value === '' ? null : Number(e.target.value) } })} hint={t('booking.settings.maxHint')} error={errors.max_bookings_per_email && t(errors.max_bookings_per_email)} data-testid="settings-max" />
          )}
        </section>

        <fieldset className="space-y-2" data-testid="settings-meet">
          <legend className="text-sm font-medium">{t('booking.settings.meet')}</legend>
          {MEET_MODES.map((mm) => (
            <label key={mm} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="radio" name="meet" value={mm} checked={s.meeting_link_mode === mm} onChange={() => patchSettings({ meeting_link_mode: mm })} className="h-4 w-4" />
              {t(`booking.settings.meet.${mm}`)}
            </label>
          ))}
          {s.meeting_link_mode === 'shared' && (
            <Field label={t('booking.settings.sharedLink')} dir="ltr" value={s.shared_meet_link ?? ''} onChange={(e) => patchSettings({ shared_meet_link: e.target.value })} error={errors.shared_meet_link && t(errors.shared_meet_link)} placeholder="https://meet.google.com/..." data-testid="settings-shared-link" />
          )}
        </fieldset>

        <section className="space-y-2" data-testid="settings-calendar">
          <h3 className="text-sm font-semibold">{t('booking.settings.calendar')}</h3>
          <p className="text-xs text-muted-foreground">{t('booking.settings.calendarHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={t('booking.settings.calendar')} value={s.organizer_connection_id ?? ''} onChange={(e) => patchSettings({ organizer_connection_id: e.target.value })} className="min-h-11 rounded-input border border-input bg-input-bg px-3 text-sm" data-testid="settings-connection">
              <option value="">{t('booking.settings.calendar.none')}</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.email} ({t(c.own ? 'booking.settings.calendar.own' : 'booking.settings.calendar.system')}{c.status === 'needs_reauth' ? `, ${t('booking.settings.calendar.needsReauth')}` : ''})</option>)}
            </select>
            {connections.length === 0 && <Badge tone="amber">{t('booking.settings.calendar.none')}</Badge>}
          </div>
        </section>

        <section className="space-y-3" data-testid="settings-emails">
          <h3 className="text-sm font-semibold">{t('booking.settings.emails')}</h3>
          <p className="text-xs text-muted-foreground">{t('booking.settings.emailsHint')}</p>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('booking.settings.emails')}>
            {EMAIL_KEYS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={emailKey === k} onClick={() => setEmailKey(k)} className={cn('tap-target rounded-md px-3 text-sm', emailKey === k ? 'bg-foreground text-background' : 'hover:bg-surface')} data-testid={`email-${k}`}>
                {t(`booking.email.${k}`)}{!config.emails[k].enabled && ' (off)'}
              </button>
            ))}
          </div>
          <TemplateEditor
            template={config.emails[emailKey]}
            onChange={(tpl) => patch({ emails: { ...config.emails, [emailKey]: tpl } })}
            placeholders={PLACEHOLDERS_BY_KEY[emailKey]}
            sampleVars={vars}
            error={errors[`emails.${emailKey}`] ? errors[`emails.${emailKey}`].split('.').pop() : null}
          />
        </section>

        <section className="space-y-3" data-testid="settings-page">
          <h3 className="text-sm font-semibold">{t('booking.settings.page')}</h3>
          <BilingualField label={t('booking.settings.pageTitle')} value={config.page.title} onChange={(title) => patch({ page: { ...config.page, title } })} />
          <BilingualField as="textarea" rows={2} label={t('booking.settings.pageIntro')} value={config.page.intro} onChange={(intro) => patch({ page: { ...config.page, intro } })} />
        </section>

        <section className="space-y-2" data-testid="settings-slot-defaults">
          <h3 className="text-sm font-semibold">{t('booking.settings.slotDefaults')}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={t('booking.slots.from')} type="time" dir="ltr" value={config.slotDefaults.from} onChange={(e) => patch({ slotDefaults: { ...config.slotDefaults, from: e.target.value } })} />
            <Field label={t('booking.slots.to')} type="time" dir="ltr" value={config.slotDefaults.to} onChange={(e) => patch({ slotDefaults: { ...config.slotDefaults, to: e.target.value } })} />
            <Field label={t('booking.slots.duration')} type="number" min="5" dir="ltr" value={config.slotDefaults.durationMin} onChange={(e) => patch({ slotDefaults: { ...config.slotDefaults, durationMin: Number(e.target.value) } })} error={errors.durationMin && t(errors.durationMin)} />
            <Field label={t('booking.slots.gap')} type="number" min="0" dir="ltr" value={config.slotDefaults.gapMin} onChange={(e) => patch({ slotDefaults: { ...config.slotDefaults, gapMin: Number(e.target.value) } })} />
          </div>
        </section>

        <section className="space-y-2" data-testid="settings-link">
          <h3 className="text-sm font-semibold">{t('booking.settings.link')}</h3>
          <p className="text-xs text-muted-foreground">{t('booking.settings.linkHint')}</p>
          {url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{url}</code>
              <Button size="sm" variant="outline" onClick={copy}><Copy className="h-4 w-4" aria-hidden="true" />{t('booking.settings.copyLink')}</Button>
              <a href={url} target="_blank" rel="noopener noreferrer" className="tap-target inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-surface"><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('booking.settings.openLink')}</a>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => ensureLink.mutate()} loading={ensureLink.isPending} data-testid="create-link">{t('booking.settings.createLink')}</Button>
          )}
        </section>
      </div>
    </NodeFrame>
  )
}
