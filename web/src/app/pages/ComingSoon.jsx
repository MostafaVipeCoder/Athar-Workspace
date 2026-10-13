import { Hammer } from 'lucide-react'
import { EmptyState } from '../../ui/States.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/** Clearly-marked placeholder for routes whose feature arrives in a later step of design 06 section 14. */
export default function ComingSoon({ step, what }) {
  const { t } = useLanguage()
  return (
    <div data-testid="coming-soon" data-step={step} className="py-6">
      <EmptyState icon={Hammer} title={t('common.comingIn', { step })} body={`${t('common.placeholderBody')}${what ? ` ${t('common.plannedFor', { what })}` : ''}`} />
    </div>
  )
}
