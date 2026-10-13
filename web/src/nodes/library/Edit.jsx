import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, FilePlus2, Library, Link2, Upload } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useConfirm } from '../../ui/ConfirmDialog.jsx'
import { Button } from '../../ui/Button.jsx'
import { Field } from '../../ui/Field.jsx'
import { SearchBar } from '../../ui/SearchBar.jsx'
import { EmptyState, ErrorState, Loading } from '../../ui/States.jsx'
import { useLibraryDefinition, uploadResourceFile, removeResourceFiles } from '../../data/library.js'
import { removeImage, uploadImage } from '../../data/storage.js'
import { exportWorkbook } from '../../lib/export/xlsx.js'
import { describeReport, variantsOf } from '../../lib/image/index.js'
import CategoriesPanel from './CategoriesPanel.jsx'
import ResourceRow from './ResourceRow.jsx'
import {
  FILE_ACCEPT, RESOURCE_TYPES, categoryName, emptyCategory, emptyResource, fromCategoryRow, fromRow, indexRows, moveItem, resourceTitle,
  toChildren, typeFromMime, validateFile, validateLibrary,
} from './libraryLogic.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const insertAt = (list, item, index) => {
  if (list.some((x) => x.id === item.id)) return list
  const next = [...list]
  next.splice(Math.min(Math.max(index ?? next.length, 0), next.length), 0, item)
  return next
}
/** The object itself and its thumbnail when it has one (a PDF has none: no phantom path is sent to Storage). */
const withThumb = (p) => variantsOf(p)
/** A refused image keeps its own sentence (corrupt, HEIC, ...); everything else is the generic upload error. */
const uploadErrorKey = (e) => (/^(library|errors\.image)\./.test(e?.messageKey ?? '') ? e.messageKey : 'library.err.upload')
const baseName = (name) => String(name ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Storage bookkeeping of the draft: files uploaded in THIS session are removed again when they never get saved. */
function useAssetSession() {
  const ref = useRef({ files: new Set(), covers: new Set(), garbageFiles: new Set(), garbageCovers: new Set() })
  useEffect(() => {
    const a = ref.current
    return () => {
      // leaving the editor with unsaved uploads: they belong to nobody
      removeResourceFiles([...a.files].flatMap(withThumb))
      for (const c of a.covers) removeImage(c).catch(() => {})
    }
  }, [])
  return ref
}

/**
 * Edit mode (design 01 section 3.8): the resource list of ONE library, ordered by drag or arrows, with links and uploaded
 * files (PDF, images, audio, video, Office documents; type/size validated here and by the server, images become WebP + a
 * thumbnail), categories (ar/en), title/description (ar/en), per-resource visibility (public / participants / hidden), a
 * cover image, preview, removal with a confirmation and Undo, and an Excel index. The draft (categories + resources) is saved with
 * ONE save_node call (children, expected revision); removed resources are soft deleted by the server.
 */
export default function LibraryEdit() {
  const { node, projectId } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const { dirty: configDirty, saving, save } = useNodeConfig()
  const def = useLibraryDefinition(node.id)
  const assets = useAssetSession()
  const fileInput = useRef(null)
  const [base, setBase] = useState(null)
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [pending, setPending] = useState([])
  const [dragId, setDragId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState({ query: '', type: 'all', categoryId: 'all' })

  // adopt the loaded rows (and newer saved states from outside) unless the user has unsaved edits
  const loaded = useMemo(() => (def.data ? { categories: def.data.categories.map(fromCategoryRow), resources: def.data.resources.map(fromRow) } : null), [def.data])
  const childrenDirty = Boolean(draft && base && !same(draft, base))
  if (loaded && (!base || (!same(loaded, base) && !childrenDirty))) {
    setBase(loaded)
    setDraft(loaded)
  }
  const categories = draft?.categories ?? loaded?.categories ?? []
  const resources = useMemo(() => draft?.resources ?? loaded?.resources ?? [], [draft, loaded])
  const dirty = configDirty || childrenDirty
  const setCategories = (fn) => setDraft((cur) => ({ ...(cur ?? loaded), categories: fn((cur ?? loaded).categories) }))
  const setResources = (fn) => setDraft((cur) => ({ ...(cur ?? loaded), resources: fn((cur ?? loaded).resources) }))
  const updateResource = (next) => setResources((cur) => cur.map((x) => (x.id === next.id ? next : x)))

  const filtering = filters.query.trim() !== '' || filters.type !== 'all' || filters.categoryId !== 'all'
  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    return resources.filter((r) => {
      if (filters.type !== 'all' && r.type !== filters.type) return false
      if (filters.categoryId === 'none' ? r.categoryId : filters.categoryId !== 'all' && r.categoryId !== filters.categoryId) return false
      return !q || [r.title.en, r.title.ar, r.description.en, r.description.ar, r.url].some((s) => String(s ?? '').toLowerCase().includes(q))
    })
  }, [resources, filters])
  const counts = useMemo(() => {
    const out = {}
    for (const r of resources) if (r.categoryId) out[r.categoryId] = (out[r.categoryId] ?? 0) + 1
    return out
  }, [resources])
  const fileCount = resources.filter((r) => r.filePath).length

  // ---- storage bookkeeping
  const trackFile = (path) => assets.current.files.add(path)
  const trackCover = (path) => assets.current.covers.add(path)
  function releaseFile(path) {
    if (!path) return
    const a = assets.current
    if (a.files.has(path)) { a.files.delete(path); removeResourceFiles(withThumb(path)) } else a.garbageFiles.add(path)
  }
  function releaseCover(path) {
    if (!path) return
    const a = assets.current
    if (a.covers.has(path)) { a.covers.delete(path); removeImage(path).catch(() => {}) } else a.garbageCovers.add(path)
  }
  /** After a successful save: unreferenced uploads of this session and replaced saved files are removed; the rest is saved. */
  function flushAssets(saved) {
    const a = assets.current
    const files = new Set(saved.resources.map((r) => r.filePath).filter(Boolean))
    const covers = new Set(saved.resources.map((r) => r.coverPath).filter(Boolean))
    const drop = [...a.files, ...a.garbageFiles].filter((p) => !files.has(p))
    if (drop.length) removeResourceFiles(drop.flatMap(withThumb))
    for (const c of [...a.covers, ...a.garbageCovers]) if (!covers.has(c)) removeImage(c).catch(() => {})
    a.files.clear(); a.covers.clear(); a.garbageFiles.clear(); a.garbageCovers.clear()
  }

  // ---- adding
  function addLink() {
    const r = emptyResource()
    setResources((cur) => [...cur, r])
    setExpanded(r.id)
    setFilters({ query: '', type: 'all', categoryId: 'all' })
  }
  async function uploadFiles(fileList) {
    const files = [...(fileList ?? [])]
    let last = null
    for (const file of files) {
      const problem = validateFile(file)
      if (problem) { toast.error(`${file.name}: ${t(`library.err.${problem}`)}`); continue }
      const tempId = `${file.name}:${file.size}:${Math.random()}`
      setPending((p) => [...p, { id: tempId, name: file.name }])
      try {
        const up = await uploadResourceFile(file, { projectId, nodeId: node.id })
        trackFile(up.path)
        if (up.report) { const d = describeReport(up.report); toast.info(`${file.name}: ${t(d.key, d.vars)}`) }
        const title = baseName(file.name)
        const r = emptyResource({ title: { en: title, ar: '' }, type: typeFromMime(up.mime), filePath: up.path, hasFile: true, mime: up.mime, bytes: up.bytes })
        setResources((cur) => [...cur, r])
        last = r.id
      } catch (e) {
        toast.error(`${file.name}: ${t(uploadErrorKey(e))}`)
      } finally {
        setPending((p) => p.filter((x) => x.id !== tempId))
      }
    }
    if (last) { setExpanded(last); setFilters({ query: '', type: 'all', categoryId: 'all' }) }
  }
  async function replaceFile(r, file) {
    const problem = validateFile(file)
    if (problem) { toast.error(`${file.name}: ${t(`library.err.${problem}`)}`); return }
    try {
      const up = await uploadResourceFile(file, { projectId, nodeId: node.id })
      trackFile(up.path)
      if (up.report) { const d = describeReport(up.report); toast.info(`${file.name}: ${t(d.key, d.vars)}`) }
      releaseFile(r.filePath)
      updateResource({ ...r, filePath: up.path, hasFile: true, mime: up.mime, bytes: up.bytes, url: '', type: r.type === 'link' ? typeFromMime(up.mime) : r.type })
    } catch (e) {
      toast.error(t(uploadErrorKey(e)))
    }
  }
  function switchToLink(r) {
    releaseFile(r.filePath)
    updateResource({ ...r, filePath: null, hasFile: false, mime: null, bytes: null, url: '' })
  }
  async function setCover(r, file) {
    const path = await uploadImage(file, { ownerId: projectId, kind: 'library' })
    trackCover(path)
    releaseCover(r.coverPath)
    updateResource({ ...r, coverPath: path })
  }
  function clearCover(r) {
    releaseCover(r.coverPath)
    updateResource({ ...r, coverPath: null })
  }

  // ---- removal (confirm + Undo; nothing is written before Save)
  async function removeResource(r) {
    const name = resourceTitle(r, lang) || t('library.edit.untitled')
    if (!(await confirm({ title: t('library.edit.removeTitle', { name }), message: t('library.edit.removeBody'), confirmLabel: t('library.edit.remove'), destructive: true }))) return
    const index = resources.findIndex((x) => x.id === r.id)
    setResources((cur) => cur.filter((x) => x.id !== r.id))
    if (expanded === r.id) setExpanded(null)
    toast.info(t('library.edit.removed', { name }), { action: { label: t('canvas.undo'), onClick: () => setResources((cur) => insertAt(cur, r, index)) } })
  }
  async function removeCategory(c) {
    const used = resources.filter((r) => r.categoryId === c.id).map((r) => r.id)
    const name = categoryName(c, lang) || t('library.edit.untitledCategory')
    if (used.length && !(await confirm({ title: t('library.edit.removeCategoryTitle', { name }), message: t('library.edit.removeCategoryBody', { count: used.length }), confirmLabel: t('library.edit.remove'), destructive: true }))) return
    const index = categories.findIndex((x) => x.id === c.id)
    setDraft((cur) => ({ categories: cur.categories.filter((x) => x.id !== c.id), resources: cur.resources.map((r) => (r.categoryId === c.id ? { ...r, categoryId: null } : r)) }))
    toast.info(t('library.edit.categoryRemoved', { name }), { action: { label: t('canvas.undo'), onClick: () => setDraft((cur) => ({ categories: insertAt(cur.categories, c, index), resources: cur.resources.map((r) => (used.includes(r.id) ? { ...r, categoryId: c.id } : r)) })) } })
  }

  // ---- ordering (arrows + HTML5 drag; disabled while a filter hides rows)
  const move = (r, dir) => setResources((cur) => moveItem(cur, cur.findIndex((x) => x.id === r.id), cur.findIndex((x) => x.id === r.id) + dir))
  function onDropOn(targetId) {
    if (!dragId || dragId === targetId) return
    setResources((cur) => moveItem(cur, cur.findIndex((x) => x.id === dragId), targetId ? cur.findIndex((x) => x.id === targetId) : cur.length - 1))
    setDragId(null)
  }

  // ---- save (ONE save_node: children under the revision token)
  async function onSave() {
    const errs = validateLibrary(categories, resources)
    setErrors(errs)
    const firstBad = resources.find((r) => errs[r.id])
    if (Object.keys(errs).length) {
      if (firstBad) setExpanded(firstBad.id)
      toast.error(t('library.edit.invalid'))
      return
    }
    if (pending.length) { toast.info(t('library.edit.uploadsRunning')); return }
    const result = await save(null, { children: toChildren(categories, resources) })
    if (result.ok) {
      flushAssets(draft)
      setBase(draft)
      qc.invalidateQueries({ queryKey: ['node', node.id, 'library'] })
    }
  }

  // ---- Excel index
  async function onExport() {
    setBusy(true)
    try {
      const types = Object.fromEntries(RESOURCE_TYPES.map((x) => [x, t(`library.type.${x}`)]))
      const visibilities = { public: t('library.visibility.public.short'), participants: t('library.visibility.participants.short'), hidden: t('library.visibility.hidden.short') }
      const labels = { order: '#', titleEn: t('library.export.titleEn'), titleAr: t('library.export.titleAr'), descriptionEn: t('library.export.descriptionEn'), descriptionAr: t('library.export.descriptionAr'), type: t('library.export.type'), category: t('library.export.category'), visibility: t('library.export.visibility'), source: t('library.export.source'), url: t('library.export.url'), size: t('library.export.size'), file: t('library.export.file'), link: t('library.export.link'), types, visibilities }
      await exportWorkbook({ [t('library.export.sheet')]: indexRows(resources, categories, labels, lang) }, `${node.name_en || 'library'}-index`)
      toast.success(t('library.edit.exported'))
    } catch (e) {
      toast.error(t(e?.messageKey ?? 'errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  if (def.isPending && !draft) return <NodeFrame showSave={false}><Loading /></NodeFrame>
  if (def.error && !draft) return <NodeFrame showSave={false}><ErrorState error={def.error} onRetry={def.refetch} /></NodeFrame>

  const actions = (
    <div className="order-last flex w-full flex-wrap gap-1 lg:order-none lg:w-auto">
      <Button size="sm" variant="ghost" onClick={addLink} data-testid="add-link"><Link2 className="h-4 w-4" aria-hidden="true" />{t('library.edit.addLink')}</Button>
      <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} data-testid="upload-open"><Upload className="h-4 w-4" aria-hidden="true" />{t('library.edit.upload')}</Button>
      <Button size="sm" variant="ghost" onClick={onExport} loading={busy} disabled={!resources.length} data-testid="export"><Download className="h-4 w-4" aria-hidden="true" />{t('library.edit.export')}</Button>
    </div>
  )

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave} actions={actions} subtitle={t('library.edit.subtitle', { count: resources.length, files: fileCount })}>
      <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="file-input"
        onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; uploadFiles(files) }} />
      <div className="space-y-6" data-testid="library-edit">
        <CategoriesPanel
          categories={categories}
          counts={counts}
          errors={errors}
          onChange={(next) => setCategories((cur) => cur.map((c) => (c.id === next.id ? next : c)))}
          onAdd={() => setCategories((cur) => [...cur, emptyCategory()])}
          onRemove={removeCategory}
          onMove={(i, dir) => setCategories((cur) => moveItem(cur, i, i + dir))}
        />

        <section className="space-y-3" data-testid="resources">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('library.edit.resources')}</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={addLink}><Link2 className="h-4 w-4" aria-hidden="true" />{t('library.edit.addLink')}</Button>
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{t('library.edit.upload')}</Button>
            </div>
          </div>

          {resources.length > 1 && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <SearchBar value={filters.query} onChange={(query) => setFilters((f) => ({ ...f, query }))} label={t('library.edit.search')} placeholder={t('library.edit.search')} />
              <Field className="sm:w-48" label={t('library.edit.type')} as="select" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} inputClassName="min-h-11">
                <option value="all">{t('library.view.all')}</option>
                {RESOURCE_TYPES.map((x) => <option key={x} value={x}>{t(`library.type.${x}`)}</option>)}
              </Field>
              <Field className="sm:w-48" label={t('library.edit.category')} as="select" value={filters.categoryId} onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}>
                <option value="all">{t('library.view.all')}</option>
                <option value="none">{t('library.edit.noCategory')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{categoryName(c, lang) || t('library.edit.untitledCategory')}</option>)}
              </Field>
            </div>
          )}
          {filtering && resources.length > 1 && <p className="text-xs text-muted-foreground" role="status">{t('library.edit.reorderDisabled')}</p>}

          {resources.length === 0 && pending.length === 0 ? (
            <EmptyState icon={Library} title={t('library.edit.empty')} body={t('library.edit.emptyBody')}
              action={<div className="flex flex-wrap justify-center gap-2"><Button size="sm" onClick={addLink}><Link2 className="h-4 w-4" aria-hidden="true" />{t('library.edit.addLink')}</Button><Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}><FilePlus2 className="h-4 w-4" aria-hidden="true" />{t('library.edit.upload')}</Button></div>} />
          ) : (
            <div
              className="space-y-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files)
                else onDropOn(null)
              }}
            >
              {visible.map((r, i) => (
                <div key={r.id} onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }} onDrop={(e) => { if (e.dataTransfer?.files?.length) return; e.preventDefault(); e.stopPropagation(); onDropOn(r.id) }}>
                  <ResourceRow
                    resource={r}
                    index={i}
                    count={visible.length}
                    categories={categories}
                    errors={errors}
                    expanded={expanded === r.id}
                    onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                    onChange={updateResource}
                    onRemove={() => removeResource(r)}
                    onMove={(dir) => move(r, dir)}
                    onReplaceFile={replaceFile}
                    onUseLink={switchToLink}
                    onCover={setCover}
                    onCoverClear={clearCover}
                    onPreviewError={() => toast.error(t('library.view.openFailed'))}
                    reorderable={!filtering}
                    dragging={dragId === r.id}
                    dragHandleProps={{ draggable: true, onDragStart: () => setDragId(r.id), onDragEnd: () => setDragId(null) }}
                  />
                </div>
              ))}
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-card border border-dashed border-input bg-surface/60 p-3 text-sm" role="status" data-testid="upload-pending">
                  <Upload className="h-4 w-4 animate-pulse text-primary" aria-hidden="true" />
                  <span className="truncate" dir="auto">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{t('library.edit.uploading')}</span>
                </div>
              ))}
              {filtering && visible.length === 0 && <p className="rounded-card border border-dashed border-input p-4 text-center text-sm text-muted-foreground">{t('library.view.noResults')}</p>}
            </div>
          )}
        </section>
      </div>
    </NodeFrame>
  )
}
