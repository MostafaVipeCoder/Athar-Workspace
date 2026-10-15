import { alumniKeys, deleteCompanySnapshot, getAlumniCompany, NEW_ROW, reviewCompanySnapshot, upsertCompanySnapshot } from '../../../data/alumni.js'
import { useLanguage } from '../../../i18n/LanguageProvider.jsx'
import { useToast } from '../../../ui/Toast.jsx'
import { useAlumniRefresh } from '../../../shared/alumni/useAlumniRefresh.js'
import { useAdminErrorText } from './hooks.js'
import './company.i18n.js'
import './company.edit.i18n.js'

/**
 * The yearly-figure actions of a manager on ONE company, shared by the company page and the directory drawer: save a year WITH the version of the row the form loaded (`NEW_ROW` = "no row
 * for this year": a figure a founder saved meanwhile is a conflict, never overwritten unseen), reload a year for the conflict flow, delete a year, mark / withdraw the review checkpoint.
 * `payload` = `get_alumni_company` (its `snapshots` carry the versions).
 */
export function useCompanyActions(payload) {
  const { t } = useLanguage()
  const d = (k, v) => t(`alumni.admin.co.${k}`, v)
  const toast = useToast()
  const errorText = useAdminErrorText()
  const { refresh, fetchFresh } = useAlumniRefresh()
  const companyId = payload.company.id
  return {
    refresh,
    saveYear: async (year, data, why) => {
      const row = payload.snapshots.find((x) => x.year === year)
      await upsertCompanySnapshot(companyId, year, data, row?.updated_at ?? NEW_ROW, why || null)
      await refresh()
      toast.success(d('yearSaved'))
    },
    reloadYear: async (year) => {
      const fresh = await fetchFresh(alumniKeys.adminCompany(companyId), () => getAlumniCompany(companyId))
      return fresh.snapshots.find((x) => x.year === year) ?? null
    },
    deleteYear: async (year) => {
      await deleteCompanySnapshot(companyId, year)
      await refresh()
      toast.success(d('yearDeleted'))
    },
    reviewYear: async (year, reviewed) => {
      try {
        await reviewCompanySnapshot(companyId, year, reviewed)
        await refresh()
        toast.success(reviewed ? d('reviewYearSaved') : d('reviewYearWithdrawn'))
      } catch (err) {
        toast.error(errorText(err))
      }
    },
  }
}
