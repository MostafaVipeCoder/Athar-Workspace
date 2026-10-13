import { useLanguage } from '../../../../i18n/LanguageProvider.jsx'
import { ExpandableText } from '../../../../ui/ExpandableText.jsx'
import '../i18n.js'

/** The program description (project description, else the program's) in the founder's language, expandable. */
export default function DescriptionBlock({ block }) {
  const { t, pick } = useLanguage()
  return (
    <div className="panel p-4" data-testid="description-block">
      <ExpandableText text={pick(block.data, 'description')} lines={5} threshold={320} labels={{ more: t('founder.block.more'), less: t('founder.block.less') }} />
    </div>
  )
}
