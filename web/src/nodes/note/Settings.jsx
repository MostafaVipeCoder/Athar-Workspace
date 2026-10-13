import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Settings mode: common fields (name, visibility) are rendered by the kit later; here just a readout. */
export default function NoteSettings() {
  const { node } = useNodeContext()
  const { pick } = useLanguage()
  return (
    <NodeFrame>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">name</dt>
        <dd>{pick(node, 'name')}</dd>
        <dt className="text-muted-foreground">visibility</dt>
        <dd>{node.visibility ?? 'private'}</dd>
      </dl>
    </NodeFrame>
  )
}
