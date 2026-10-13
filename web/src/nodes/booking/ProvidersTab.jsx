import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge } from '../../ui/Badge.jsx'
import { Button } from '../../ui/Button.jsx'
import { Img } from '../../ui/Img.jsx'
import { EmptyState, Loading } from '../../ui/States.jsx'
import { INPUT_CLASS, SELECT_CLASS } from '../../ui/Field.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { materializeItem } from '../../data/lists.js'
import { publicImageUrl, publicThumbUrl } from '../../data/storage.js'
import { biPick } from '../../lib/entities.js'
import { NOTICE_OPTIONS, providerName } from './bookingConfig.js'

/**
 * Providers = the connected list's items shown BY REFERENCE (02 section 3.8) with the booking overlay row per item:
 * enabled (creates the `booking_providers` row lazily, after `materializeItem` for virtual items), booking e-mail
 * (default: the source e-mail), advance-notice override. Rows of providers no longer in the list stay visible as orphans.
 */
export default function ProvidersTab({ rows: allRows, status, settings, slots, mutations: m, run }) {
  const rows = status === 'loading' ? [] : allRows // no orphan flash while the connected list is still loading
  const { t, lang, tn } = useLanguage()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(null)
  const slotCount = (providerId) => slots.filter((s) => s.provider_id === providerId).length

  /** Enabling creates the overlay row lazily (the list item is materialised first when virtual, 02 section 3.8). */
  async function setEnabled(row, on) {
    setBusy(row.key)
    await run(async () => {
      if (row.provider) return m.updateProvider.mutateAsync({ providerId: row.provider.id, patch: { is_active: on } })
      const listItemId = await materializeItem(row.item._from, row.item)
      return m.upsertProvider.mutateAsync({ row: { list_item_id: listItemId, is_active: true, booking_email: row.item.contact?.email || row.item.entity?.email || null } })
    }, { success: t(on ? 'booking.providers.enabled' : 'booking.providers.disabled') })
    setBusy(null)
  }
  const saveEmail = (row, value) => {
    const next = value.trim() || null
    if (!row.provider || (row.provider.booking_email ?? null) === next) return
    run(() => m.updateProvider.mutateAsync({ providerId: row.provider.id, patch: { booking_email: next } }), { success: t('booking.providers.saved') })
  }
  const saveNotice = (row, value) => {
    const next = value === '' ? null : Number(value)
    run(() => m.updateProvider.mutateAsync({ providerId: row.provider.id, patch: { advance_notice_min: next } }), { success: t('booking.providers.saved') })
  }
  async function remove(row) {
    const ok = await confirm({ title: t('booking.providers.removeTitle', { name: providerName(row, lang) }), message: t('booking.providers.removeBody'), destructive: true })
    if (!ok) return
    const r = await run(() => m.deleteProvider.mutateAsync({ providerId: row.provider.id }), { success: t('booking.providers.removed') })
    if (r === undefined) return
  }

  return (
    <div className="space-y-3" data-testid="providers-tab">
      <p className="text-xs text-muted-foreground">{t('booking.providers.hint')}</p>
      {status === 'idle' && rows.length === 0 ? <EmptyState title={t('booking.providers.noSource')} /> : status === 'loading' && rows.length === 0 ? <Loading /> : rows.length === 0 ? <EmptyState title={t('booking.providers.empty')} /> : (
        <div className="overflow-x-auto rounded-input border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs font-semibold uppercase text-athar-ink">
              <tr>
                <th className="p-2 text-start">{t('booking.providers.col.provider')}</th>
                <th className="p-2 text-start">{t('booking.providers.col.enabled')}</th>
                <th className="p-2 text-start">{t('booking.providers.col.email')}</th>
                <th className="p-2 text-start">{t('booking.providers.col.notice')}</th>
                <th className="p-2 text-start">{t('booking.providers.col.slots')}</th>
                <th className="p-2"><span className="sr-only">{t('booking.col.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = providerName(row, lang)
                const entity = row.item?.entity
                const n = row.provider ? slotCount(row.provider.id) : 0
                return (
                  <tr key={row.key} className="border-t align-top" data-testid="provider-row">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface">
                          {entity?.imagePath && <Img src={publicImageUrl(entity.imagePath)} thumb={publicThumbUrl(entity.imagePath)} variant="thumb" alt="" aspect="1 / 1" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium" dir="auto">{name}</p>
                          {entity && <p className="text-xs text-muted-foreground" dir="auto">{biPick(entity.subtitle, lang)}</p>}
                          {row.missing && <Badge tone="red">{t(row.orphan ? 'booking.providers.orphan' : 'booking.providers.missing')}</Badge>}
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <label className="flex min-h-9 items-center gap-2">
                        <input type="checkbox" className="h-4 w-4" checked={row.enabled} disabled={busy === row.key || (row.missing && !row.provider)} onChange={(e) => setEnabled(row, e.target.checked)} aria-label={`${t('booking.providers.col.enabled')}: ${name}`} data-testid="provider-enabled" />
                      </label>
                    </td>
                    <td className="p-2">
                      <input type="email" dir="ltr" className={INPUT_CLASS + ' min-w-48'} defaultValue={row.provider?.booking_email ?? ''} placeholder={row.item?.contact?.email || entity?.email || t('booking.providers.noEmail')} disabled={!row.provider} onBlur={(e) => saveEmail(row, e.target.value)} aria-label={`${t('booking.providers.col.email')}: ${name}`} data-testid="provider-email" />
                      <p className="mt-1 text-xs text-muted-foreground">{t('booking.providers.emailHint')}</p>
                    </td>
                    <td className="p-2">
                      <select className={SELECT_CLASS + ' min-w-40'} value={row.provider?.advance_notice_min ?? ''} disabled={!row.provider} onChange={(e) => saveNotice(row, e.target.value)} aria-label={`${t('booking.providers.col.notice')}: ${name}`}>
                        <option value="">{t('booking.providers.noticeDefault', { minutes: tn('booking.notice.minutes', settings?.default_advance_notice_min ?? 1440) })}</option>
                        {NOTICE_OPTIONS.map((v) => <option key={v} value={v}>{tn('booking.notice.minutes', v)}</option>)}
                      </select>
                    </td>
                    <td className="p-2 tabular-nums">{n}</td>
                    <td className="p-2 text-end">
                      {row.provider && n === 0 && (
                        <Button variant="ghost" size="icon" className="text-destructive" aria-label={`${t('booking.providers.remove')}: ${name}`} onClick={() => remove(row)}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
