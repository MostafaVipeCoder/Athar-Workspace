import { ArrowDown, ArrowUp } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { Badge } from '../../ui/Badge.jsx'
import { NodeIcon } from '../../ui/iconMap.jsx'
import { cn } from '../../lib/cn.js'
import { TAB_AUDIENCES, effectiveTab, sortTabs } from './agendaLogic.js'

/**
 * The tab bar configuration of a host (design 02 section 4.2): one row per `view` edge into the `tabs` port with the
 * per-edge label override (ar/en), enabled flag, audience and order (arrows). Pure UI over a draft: `edits` is
 * { [edgeId]: partialPatch }, `onEdit(edgeId, patch)`; `onReorder(edgeIds)` rewrites order_index 0..n for every row.
 * The parent writes the patches through `update_edge` when the user saves.
 */
export default function TabsEditor({ edges, nodesById, edits, onEdit, onReorder, lockedFirstId = null }) {
  const { t, pick, pickLiteral } = useLanguage()
  const sorted = sortTabs(edges, edits)
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= sorted.length) return
    const ids = sorted.map((e) => e.id);
    [ids[i], ids[j]] = [ids[j], ids[i]]
    onReorder(ids)
  }
  if (!sorted.length) return <p className="text-sm text-muted-foreground">{t('agenda.settings.noTabs')}</p>
  return (
    <ol className="space-y-2" data-testid="tabs-editor">
      {sorted.map((e, i) => {
        const v = effectiveTab(e, edits)
        const source = nodesById.get(e.from_node_id)
        const name = pick(source, 'name') || source?.type || e.from_port
        const self = lockedFirstId && e.from_node_id === lockedFirstId
        return (
          <li key={e.id} className={cn('rounded-md border bg-card p-3', !v.is_enabled && 'opacity-70')} data-testid="tab-row">
            <div className="flex flex-wrap items-center gap-2">
              <NodeIcon name={source?.type === 'list' ? 'list' : source?.type === 'agenda' ? 'agenda' : source?.type === 'library' ? 'library' : source?.type === 'landing_page' ? 'landing' : source?.type === 'distribution' ? 'distribution' : 'document'} className="h-4 w-4 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">{v.label_en || v.label_ar ? `${v.label_en || v.label_ar}` : name}</span>
              <Badge tone="outline">{e.from_port}</Badge>
              {self && <Badge tone="blue">{pickLiteral({ en: 'this agenda', ar: 'هذه الأجندة' })}</Badge>}
              <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={t('agenda.edit.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
              <Button size="icon" variant="ghost" className="h-9 min-h-9 w-9 min-w-9" aria-label={t('agenda.edit.moveDown')} disabled={i === sorted.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_auto]">
              <Field label={`${t('agenda.settings.tabLabel')} (English)`} dir="ltr" lang="en" value={v.label_en} placeholder={t('agenda.settings.tabDefault', { name: source?.name_en ?? name })} onChange={(ev) => onEdit(e.id, { label_en: ev.target.value })} />
              <Field label={`${t('agenda.settings.tabLabel')} (العربية)`} dir="rtl" lang="ar" value={v.label_ar} placeholder={t('agenda.settings.tabDefault', { name: source?.name_ar ?? name })} onChange={(ev) => onEdit(e.id, { label_ar: ev.target.value })} />
              <Field label={t('agenda.settings.tabAudience')} as="select" value={v.audience} onChange={(ev) => onEdit(e.id, { audience: ev.target.value })}>
                {TAB_AUDIENCES.map((a) => <option key={a} value={a}>{t(`canvas.audience.${a}`)}</option>)}
              </Field>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm">
                <input type="checkbox" checked={v.is_enabled} onChange={(ev) => onEdit(e.id, { is_enabled: ev.target.checked })} />
                {t('agenda.settings.tabEnabled')}
              </label>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
