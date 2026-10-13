import { useMemo, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import './i18n.js'
import NodeFrame from '../_kit/NodeFrame.jsx'
import { useNodeContext } from '../_kit/NodeContext.js'
import { useNodeConfig } from '../_kit/useNodeConfig.js'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { Button } from '../../ui/Button.jsx'
import { BilingualField } from '../../ui/BilingualField.jsx'
import { buttonClass } from '../../ui/buttonStyles.js'
import { useCertificateDefinition } from '../../data/certificates.js'
import { buildPublicUrl } from '../../lib/links.js'
import { LANGUAGES, normalizeCertConfig } from './certConfig.js'

/**
 * Settings mode (design 01 section 3.10): name (the founder block title), the language of the template (one template per language,
 * decision 07-8), the public verification page switches, and "show to participants". ONE explicit Save: node columns + config in the
 * same save_node call (the template itself is saved by Edit).
 */
export default function CertificatesSettings() {
  const { node } = useNodeContext()
  const { t, lang } = useLanguage()
  const toast = useToast()
  const { config: raw, setConfig, dirty: configDirty, saving, save } = useNodeConfig()
  const config = useMemo(() => normalizeCertConfig(raw), [raw])
  const def = useCertificateDefinition(node.id)
  const [fields, setFields] = useState({ name: { en: node.name_en ?? '', ar: node.name_ar ?? '' }, show_to_participants: Boolean(node.show_to_participants) })
  const fieldsDirty = fields.name.en !== (node.name_en ?? '') || fields.name.ar !== (node.name_ar ?? '') || fields.show_to_participants !== Boolean(node.show_to_participants)
  const dirty = configDirty || fieldsDirty
  const patch = (p) => setConfig({ ...config, ...p })
  const patchVerifier = (p) => setConfig({ ...config, verifier: { ...config.verifier, ...p } })

  const hasTemplate = (language) => (def.data ?? []).some((r) => r.language === language)
  const other = config.language === 'ar' ? 'en' : 'ar'
  const missing = def.data && !hasTemplate(config.language) && hasTemplate(other)
  const verifyUrl = buildPublicUrl('verify', '')

  async function onSave() {
    await save({ config, name_en: fields.name.en.trim() || null, name_ar: fields.name.ar.trim() || null, show_to_participants: fields.show_to_participants })
  }
  async function copy(u) {
    try { await navigator.clipboard.writeText(u); toast.success(t('certificates.settings.copied')) } catch { toast.info(u) }
  }

  return (
    <NodeFrame dirty={dirty} saving={saving} onSave={onSave}>
      <div className="space-y-6" data-testid="certificates-settings">
        <BilingualField label={t('certificates.settings.name')} value={fields.name} onChange={(name) => setFields((f) => ({ ...f, name }))} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('certificates.settings.language')}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('certificates.settings.language')}>
            {LANGUAGES.map((l) => (
              <label key={l} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="radio" name="cert-language" value={l} checked={config.language === l} onChange={() => patch({ language: l })} data-testid={`language-${l}`} />
                {t(`certificates.language.${l}`)}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('certificates.settings.language.hint')}</p>
          {missing && <p role="status" className="rounded-md bg-accent/40 p-2 text-sm" data-testid="language-missing">{t('certificates.settings.language.other', { other: t(`certificates.language.${other}`), language: t(`certificates.language.${config.language}`) })}</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('certificates.settings.verifier')}</legend>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={config.verifier.enabled} onChange={(e) => patchVerifier({ enabled: e.target.checked })} data-testid="verifier-enabled" />
            <span>{t('certificates.settings.verifier.enabled')}<span className="block text-xs text-muted-foreground">{t('certificates.settings.verifier.enabledHint')}</span></span>
          </label>
          <label className={`flex min-h-11 items-start gap-2 text-sm ${config.verifier.enabled ? '' : 'opacity-60'}`}>
            <input type="checkbox" className="mt-1 h-4 w-4" disabled={!config.verifier.enabled} checked={config.verifier.enabled && config.verifier.showCertificate} onChange={(e) => patchVerifier({ showCertificate: e.target.checked })} data-testid="verifier-show" />
            <span>{t('certificates.settings.verifier.show')}<span className="block text-xs text-muted-foreground">{t('certificates.settings.verifier.showHint')}</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-2" data-testid="verifier-url">
            <span className="text-sm font-medium">{t('certificates.settings.verifier.url')}</span>
            <code dir="ltr" className="rounded-xs bg-surface px-2 py-1 text-xs">{verifyUrl}</code>
            <Button size="sm" variant="outline" onClick={() => copy(verifyUrl)}><Copy className="h-4 w-4" aria-hidden="true" />{t('certificates.settings.copy')}</Button>
            <a href={`${verifyUrl}?lang=${lang}`} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm' })}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t('certificates.settings.open')}</a>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={fields.show_to_participants} onChange={(e) => setFields((f) => ({ ...f, show_to_participants: e.target.checked }))} data-testid="show-to-participants" />
            <span>{t('certificates.settings.show')}<span className="block text-xs text-muted-foreground">{t('certificates.settings.showHint')}</span></span>
          </label>
        </fieldset>
      </div>
    </NodeFrame>
  )
}
