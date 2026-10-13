import { Bus, CalendarDays, ExternalLink, Footprints, MapPin } from 'lucide-react'
import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import { buttonClass } from '../../../../ui/buttonStyles.js'
import { safeMapUrl } from '../programLogic.js'
import '../i18n.js'

function Row({ icon: Icon, label, children }) {
  return (
    <li className="flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        {children}
      </div>
    </li>
  )
}

/**
 * Project Details as the PM entered them (nothing is shown unless the PM turned the toggle on AND filled it in): the offline
 * location with a map link, the number of in-person days and whether transportation is provided or everyone comes on their own.
 */
export default function LocationBlock({ block }) {
  const { t, tn, pick } = useLanguage()
  const d = block.data ?? {}
  const place = pick(d, 'location')
  const map = safeMapUrl(d.map_url)
  const transport = d.transportation === 'provided' || d.transportation === 'self_arranged' ? d.transportation : null
  return (
    <ul className="panel divide-y divide-border" data-testid="location-block">
      {(place || map) && (
        <Row icon={MapPin} label={t('founder.details.location')}>
          {place && <p className="break-words font-semibold" dir="auto">{place}</p>}
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'outline', size: 'sm', className: 'mt-1' })} aria-label={place ? t('founder.details.mapOf', { place }) : t('founder.details.openMap')}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t('founder.details.openMap')}
            </a>
          )}
        </Row>
      )}
      {d.offline_days > 0 && (
        <Row icon={CalendarDays} label={t('founder.details.offlineLabel')}>
          <p className="font-semibold">{tn('founder.details.offlineDays', d.offline_days)}</p>
        </Row>
      )}
      {transport && (
        <Row icon={transport === 'provided' ? Bus : Footprints} label={t('founder.details.transportation')}>
          <p className="font-semibold">{t(`founder.details.${transport}`)}</p>
        </Row>
      )}
    </ul>
  )
}
