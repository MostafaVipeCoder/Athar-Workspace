import { useState } from 'react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useInputPort } from '../_kit/useInputPort.js'
import { Field } from '../../ui/Field.jsx'
import { Button } from '../../ui/Button.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

export default function NoteEdit() {
  const { t } = useLanguage()
  const { config, update, dirty, saving, save } = useNodeConfig()
  const input = useInputPort('text-in')
  const [boom, setBoom] = useState(false)
  if (boom) throw new Error(t('note.crashed'))

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={save}>
      <div className="space-y-4">
        <Field as="textarea" label={t('note.label')} value={config.text ?? ''} onChange={(e) => update({ text: e.target.value })} rows={3} inputClassName="min-h-24 py-2" />
        <div data-testid="note-inputs" aria-live="polite">
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
        <Button variant="outline" size="sm" onClick={() => setBoom(true)}>
          {t('note.crash')}
        </Button>
      </div>
    </NodeFrame>
  )
}
