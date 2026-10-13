import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useInputPort } from '../_kit/useInputPort.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** View mode: read-only, shows the saved text plus whatever arrives over the input port. */
export default function NoteView() {
  const { t } = useLanguage()
  const { node } = useNodeContext()
  const input = useInputPort('text-in')
  return (
    <NodeFrame>
      <p data-testid="note-text" className="whitespace-pre-wrap text-sm">{node.config?.text || '-'}</p>
      <div className="mt-3" data-testid="note-inputs" aria-live="polite">
        <p className="text-sm font-medium">{t('note.inputs')}</p>
        {input.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('note.noInputs')}</p>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {input.items.map((it) => (
              <li key={it._from}>{it.text || '-'}</li>
            ))}
          </ul>
        )}
      </div>
    </NodeFrame>
  )
}
