import { lazy, Suspense, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Download, FileSpreadsheet, Upload } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { invalidateNodeOutputs } from '../_kit/invalidate.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { ImageField } from '../../ui/ImageField.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useAgendaDefinition, useAgendaMutations } from '../../data/agenda.js'
import { publicImageUrl, publicThumbUrl, removeImage, uploadImage } from '../../data/storage.js'
import { exportWorkbook } from '../../lib/export/xlsx.js'
import { describeTimeZone, resolveTimeZone } from '../../lib/time/tz.js'
import { cn } from '../../lib/cn.js'
import DayEditor from './DayEditor.jsx'
import { HEADER_HEIGHTS, HEADER_TYPES, TEMPLATE_SHEETS, agendaSheets, duplicateDay, emptyDay, fromDayRow, mergeImportedDays, moveItem, normalizeAgendaConfig, toChildren, validateAgenda } from './agendaLogic.js'

const ImportAgendaModal = lazy(() => import('./ImportAgendaModal.jsx'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pickBi = (v, lang) => (lang === 'ar' ? v?.ar || v?.en : v?.en || v?.ar) || ''

/**
 * Edit mode (design 01 section 3.1): days (date + bilingual name) with their sessions, drag/arrow reorder of days and
 * sessions, duplicate day/session, +/-1 h shift, Excel import (staged into the draft) / export / template, the cover (=
 * the PROJECT cover, decision 01-2, uploaded immediately like every image) and the header block (brand name, overlay
 * title, colour, dim, height: the "visual identity" of the as-is builder, now ONE config object that round-trips).
 * Days/sessions + config are ONE client draft saved with ONE save_node call (config + children) under the revision
 * token: nothing is half-written, no action writes before Save (docs/03 section 7 #6/#7/#8 fixed).
 */
export default function AgendaEdit() {
  const { node, projectId, graph } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { config: rawConfig, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeAgendaConfig(rawConfig), [rawConfig])
  const def = useAgendaDefinition(node.id)
  const m = useAgendaMutations(node.id, projectId)
  const tz = resolveTimeZone(graph?.project?.timezone)
  const [base, setBase] = useState(null)
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [dragDay, setDragDay] = useState(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  // adopt the loaded rows (and newer saved states from outside) unless the user has unsaved edits
  const loaded = useMemo(() => (def.data ? def.data.days.map((d) => fromDayRow(d, d.slots)) : null), [def.data])
  const childrenDirty = draft && base && !same(draft, base)
  if (loaded && (!base || (!same(loaded, base) && !childrenDirty))) {
    setBase(loaded)
    setDraft(loaded)
  }
  const days = draft ?? loaded ?? []
  const dirty = configDirty || Boolean(childrenDirty)
  const patchConfig = (p) => setConfig({ ...config, ...p })
  const patchHeader = (p) => patchConfig({ header: { ...config.header, ...p } })
  const setDays = (fn) => setDraft((cur) => fn(cur ?? loaded ?? []))
  const slotCount = days.reduce((n, d) => n + d.slots.length, 0)
  const coverPath = graph?.project?.cover_path ?? null

  // ---- day operations
  const addDay = () => {
    const last = days[days.length - 1]
    const nextDate = last?.date ? nextDay(last.date) : ''
    setDays((cur) => [...cur, emptyDay({ date: nextDate, name: { en: `Day ${cur.length + 1}`, ar: '' } })])
  }
  const updateDay = (next, meta) => {
    setDays((cur) => cur.map((d) => (d.id === next.id ? next : d)))
    // removing a session needs no confirmation (nothing is written before Save): the toast offers Undo instead
    if (meta?.removedSlot) toast.info(t('agenda.edit.removedSlot', { name: meta.label }), { action: { label: t('canvas.undo'), onClick: () => setDays((cur) => cur.map((d) => (d.id === next.id ? { ...d, slots: restoreAt(d.slots, meta.removedSlot, meta.index) } : d))) } })
  }
  async function removeDay(d) {
    const name = pickBi(d.name, lang) || d.date || t('agenda.edit.untitledDay')
    if (!(await confirm({ title: t('agenda.edit.removeDay', { name }), message: t('agenda.edit.removeDayBody', { count: d.slots.length }), destructive: true }))) return
    setDays((cur) => cur.filter((x) => x.id !== d.id))
  }
  const onDropDay = (targetId) => {
    if (!dragDay || dragDay === targetId) return
    setDays((cur) => moveItem(cur, cur.findIndex((d) => d.id === dragDay), targetId ? cur.findIndex((d) => d.id === targetId) : cur.length - 1))
    setDragDay(null)
  }

  // ---- save (ONE save_node: config + children)
  async function onSave() {
    const errs = validateAgenda(days)
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error(t('agenda.edit.invalid'))
      return
    }
    const r = await save({ config }, { children: toChildren(days) })
    if (r.ok) {
      setBase(days)
      setDraft(days)
      qc.invalidateQueries({ queryKey: ['node', node.id, 'agenda'] })
      toast.success(t('agenda.edit.saved'))
    }
  }

  // ---- Excel (lazy SheetJS)
  async function onExport() {
    setBusy(true)
    try {
      await exportWorkbook(agendaSheets(days), `${node.name_en || 'agenda'}-agenda`)
      toast.success(t('agenda.edit.exported'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }
  async function onTemplate() {
    setBusy(true)
    try { await exportWorkbook(TEMPLATE_SHEETS(), 'agenda-template') } catch (e) { toast.error(t(e?.messageKey ?? 'errors.unknown')) } finally { setBusy(false) }
  }
  function onImport(imported, mode) {
    setDays((cur) => mergeImportedDays(cur, imported, mode))
    setErrors({})
    toast.success(t('agenda.import.done', { days: imported.length }))
  }

  // ---- cover (= project cover; immediate like every image upload)
  async function onCoverFile(file) {
    const path = await uploadImage(file, { ownerId: projectId, kind: 'cover' })
    const old = coverPath
    await m.setCover.mutateAsync({ coverPath: path })
    await invalidateNodeOutputs(qc, graph, node.id, projectId)
    if (old) removeImage(old).catch(() => {})
    toast.success(t('agenda.edit.coverSaved'))
  }
  async function onCoverClear() {
    const old = coverPath
    await m.setCover.mutateAsync({ coverPath: null })
    if (old) removeImage(old).catch(() => {})
    toast.success(t('agenda.edit.coverRemoved'))
  }

  if (def.isPending) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (def.error) return <NodeFrame showSave={false}><ErrorState error={def.error} onRetry={def.refetch} /></NodeFrame>

  const actions = (
    <div className="order-last flex w-full flex-wrap gap-1 lg:order-none lg:w-auto">
      <Button size="sm" variant="ghost" onClick={() => setImporting(true)} data-testid="import-open"><Upload className="h-4 w-4" aria-hidden="true" />{t('agenda.edit.import')}</Button>
      <Button size="sm" variant="ghost" onClick={onExport} loading={busy} disabled={!days.length}><Download className="h-4 w-4" aria-hidden="true" />{t('agenda.edit.export')}</Button>
      <Button size="sm" variant="ghost" onClick={onTemplate} disabled={busy}><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />{t('agenda.edit.template')}</Button>
    </div>
  )

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave} actions={actions} subtitle={t('agenda.edit.subtitle', { days: days.length, slots: slotCount, tz: describeTimeZone(tz, lang) })}>
      <div className="space-y-6" data-testid="agenda-edit">
        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ImageField
            label={t('agenda.edit.cover')}
            src={coverPath ? publicImageUrl(coverPath) : null}
            thumb={coverPath ? publicThumbUrl(coverPath) : null}
            aspect="16 / 9"
            labels={{ choose: t('image.choose'), replace: t('image.replace'), remove: t('image.remove'), hint: t('agenda.edit.coverHint') }}
            errorText={(p) => t(`errors.image.${p}`)}
            onFile={onCoverFile}
            onClear={onCoverClear}
          />
          <div className="space-y-3" data-testid="header-settings">
            <div>
              <h3 className="text-sm font-semibold">{t('agenda.edit.header')}</h3>
              <p className="text-xs text-muted-foreground">{t('agenda.edit.headerHint')}</p>
            </div>
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={config.header.visible} onChange={(e) => patchHeader({ visible: e.target.checked })} />{t('agenda.edit.headerVisible')}</label>
            <div className={cn('grid gap-3 sm:grid-cols-2', !config.header.visible && 'opacity-60')}>
              <Field label={t('agenda.edit.brandName')} value={config.header.brandName} onChange={(e) => patchHeader({ brandName: e.target.value })} hint={t('agenda.edit.brandNameHint')} data-testid="brand-name" />
              <Field label={t('agenda.edit.headerType')} as="select" value={config.header.type} onChange={(e) => patchHeader({ type: e.target.value })}>
                {HEADER_TYPES.map((x) => <option key={x} value={x}>{t(`agenda.edit.headerType.${x}`)}</option>)}
              </Field>
              <BilingualField className="sm:col-span-2" label={t('agenda.edit.headerTitle')} value={config.header.title} onChange={(title) => patchHeader({ title })} />
              <Field label={t('agenda.edit.headerHeight')} as="select" value={config.header.height} onChange={(e) => patchHeader({ height: e.target.value })}>
                {HEADER_HEIGHTS.map((x) => <option key={x} value={x}>{t(`agenda.edit.height.${x}`)}</option>)}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('agenda.edit.headerColor')} type="color" dir="ltr" value={config.header.color} onChange={(e) => patchHeader({ color: e.target.value })} inputClassName="h-11 p-1" disabled={config.header.type !== 'color'} />
                <Field label={t('agenda.edit.headerTitleColor')} type="color" dir="ltr" value={config.header.titleColor} onChange={(e) => patchHeader({ titleColor: e.target.value })} inputClassName="h-11 p-1" />
              </div>
              <Field className="sm:col-span-2" label={t('agenda.edit.headerDim', { pct: Math.round(config.header.dim * 100) })} type="range" min="0" max="80" step="5" dir="ltr" value={Math.round(config.header.dim * 100)} onChange={(e) => patchHeader({ dim: Number(e.target.value) / 100 })} inputClassName="h-11 px-0" disabled={config.header.type !== 'image'} />
            </div>
          </div>
        </section>

        <section className="space-y-3" data-testid="days">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('agenda.edit.days')}</h3>
            <Button size="sm" variant="secondary" onClick={addDay} data-testid="add-day"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{t('agenda.edit.addDay')}</Button>
          </div>
          {days.length === 0 ? (
            <EmptyState icon={CalendarPlus} title={t('agenda.edit.noDays')} body={t('agenda.edit.noDaysBody')} action={<Button size="sm" onClick={addDay}>{t('agenda.edit.addDay')}</Button>} />
          ) : (
            <div className="space-y-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDropDay(null) }}>
              {days.map((d, i) => (
                <div key={d.id} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropDay(d.id) }}>
                  <DayEditor
                    day={d}
                    index={i}
                    count={days.length}
                    errors={errors}
                    onChange={updateDay}
                    onRemove={() => removeDay(d)}
                    onDuplicate={() => setDays((cur) => duplicateDay(cur, d.id, { en: t('canvas.copySuffix') ? `(${t('canvas.copySuffix')})` : '(copy)', ar: '(نسخة)' }))}
                    onMove={(dir) => setDays((cur) => moveItem(cur, i, i + dir))}
                    dragging={dragDay === d.id}
                    dragHandleProps={{ draggable: true, onDragStart: () => setDragDay(d.id), onDragEnd: () => setDragDay(null) }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {importing && (
        <Suspense fallback={null}>
          <ImportAgendaModal onClose={() => setImporting(false)} onImport={onImport} hasDays={days.length > 0} />
        </Suspense>
      )}
    </NodeFrame>
  )
}

/** 'YYYY-MM-DD' + 1 day (calendar arithmetic at UTC noon; never a local-midnight Date). */
function nextDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 12))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
function restoreAt(slots, slot, index) {
  if (slots.some((x) => x.id === slot.id)) return slots
  const next = [...slots]
  next.splice(Math.min(Math.max(index ?? next.length, 0), next.length), 0, slot)
  return next
}
