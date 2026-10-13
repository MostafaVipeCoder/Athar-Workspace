import './i18n.js'
import { Badge } from '../../ui/Badge.jsx'
import { useLanguage } from '../../i18n/LanguageProvider.jsx'

/**
 * THE "Withdrawn" chip (decision 17.1). Lists, the Selection board, Participants, Booking, Distribution and the Issue panel all show the same
 * red chip with the same words (one i18n key, `entity.withdraw.chip`); `reason` (PM-only) is the tooltip. Never dim the chip itself: the state is
 * what the PM most needs to read (WCAG AA), so rows dim their picture and name instead.
 */
export function WithdrawnChip({ reason, className, ...rest }) {
  const { t } = useLanguage()
  return (
    <Badge tone="red" className={className} title={reason ? t('entity.withdraw.reasonShown', { reason }) : undefined} data-testid="withdrawn-chip" {...rest}>
      {t('entity.withdraw.chip')}
    </Badge>
  )
}
