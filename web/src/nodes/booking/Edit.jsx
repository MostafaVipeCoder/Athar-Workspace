import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useInputPort } from '../_kit/useInputPort.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { ErrorState, Loading } from '../../ui/States.jsx'
import { useBookingAdmin, useBookingExtras, useBookingMutations } from '../../data/booking.js'
import { useCalendarSyncOverview } from '../../data/calendarSync.js'
import { resolveTimeZone } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import { mergeProviders, normalizeBookingConfig } from './bookingConfig.js'
import ProvidersTab from './ProvidersTab.jsx'
import SlotsTab from './SlotsTab.jsx'
import BookingsTab from './BookingsTab.jsx'

const TABS = ['providers', 'slots', 'bookings']

/**
 * Edit mode of a Booking node (design 01 section 6.3 "Admin: Providers, Slots, Bookings"): providers by reference from
 * the connected list with their overlay (enabled, booking e-mail, notice), per-provider availability (generator over
 * lib/time/slots in the project zone, days from the connected Agenda when present), and the bookings with their calendar
 * sync state, cancel (+ Undo), reschedule, retry and Excel export. Every write is an immediate row-level save (02 section
 * 6); the DB bumps the revision, so there is no Save bar.
 */
export default function BookingEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t } = useLanguage()
  const toast = useToast()
  const qc = useQueryClient()
  const admin = useBookingAdmin(node.id)
  const extras = useBookingExtras(node.id)
  const calendar = useCalendarSyncOverview(node.id)
  const providersIn = useInputPort('mentors')
  const scheduleIn = useInputPort('schedule')
  const onChanged = () => invalidateNodeOutputs(qc, graph, node.id, projectId)
  const m = useBookingMutations(node.id, projectId, { onChanged })
  const [tab, setTab] = useState('providers')
  const tz = resolveTimeZone(graph?.project?.timezone)
  const config = useMemo(() => normalizeBookingConfig(node.config), [node.config])
  const withdrawnById = useMemo(() => new Map((extras.data?.withdrawn_items ?? []).map((x) => [x.id, x])), [extras.data])
  const rows = useMemo(() => mergeProviders(providersIn.items, admin.data?.providers ?? [], withdrawnById), [providersIn.items, admin.data, withdrawnById])
  const settings = admin.data?.settings ?? null

  async function run(fn, { success = null } = {}) {
    try {
      const out = await fn()
      if (success) toast.success(success)
      return out
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
      return undefined
    }
  }

  const tabs = (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t('booking.edit.tab.providers')}>
      {TABS.map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('tap-target rounded-md px-3 text-sm', tab === k ? 'bg-primary text-primary-foreground' : 'hover:bg-surface')} data-testid={`tab-${k}`}>
          {t(`booking.edit.tab.${k}`)}
        </button>
      ))}
    </div>
  )

  const counts = { providers: (admin.data?.providers ?? []).filter((p) => p.is_active).length, slots: admin.data?.slots?.length ?? 0, bookings: (admin.data?.bookings ?? []).filter((b) => b.status === 'confirmed').length }

  return (
    <NodeFrame showSave={false} actions={tabs} subtitle={t('booking.edit.subtitle', counts)}>
      {admin.error ? <ErrorState error={admin.error} onRetry={admin.refetch} /> : admin.isPending ? <Loading /> : (
        <>
          <div className={cn(tab !== 'providers' && 'hidden')}>
            <ProvidersTab rows={rows} status={providersIn.status} settings={settings} slots={admin.data.slots} mutations={m} run={run} />
          </div>
          <div className={cn(tab !== 'slots' && 'hidden')}>
            <SlotsTab rows={rows} slots={admin.data.slots} bookings={admin.data.bookings} schedule={scheduleIn} config={config} tz={tz} mutations={m} run={run} />
          </div>
          <div className={cn(tab !== 'bookings' && 'hidden')}>
            <BookingsTab node={node} rows={rows} slots={admin.data.slots} bookings={admin.data.bookings} extras={extras.data} loadingExtras={extras.isPending} calendar={calendar.data ?? null} settings={settings} tz={tz} mutations={m} run={run} />
          </div>
        </>
      )}
    </NodeFrame>
  )
}
