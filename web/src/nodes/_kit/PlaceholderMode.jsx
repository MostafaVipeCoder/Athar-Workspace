import { NodeIcon } from '../../ui/iconMap.jsx'
import { useNodeContext } from './NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** One shared placeholder for Edit/View/Settings of node types whose real screens arrive in step 7. */
export default function PlaceholderMode() {
  const { node, manifest, mode } = useNodeContext()
  const { t, pick, pickLiteral } = useLanguage()
  const name = pick(node, 'name') || pickLiteral(manifest.name)
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed p-8 text-center" data-testid="node-placeholder" data-mode={mode}>
      <NodeIcon name={manifest.icon} className="h-8 w-8 text-primary" />
      <p className="font-semibold">{name}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t('node.placeholder', { mode: t(`node.${mode}`), name })}</p>
    </div>
  )
}
