/**
 * Shared Alumni UI blocks (alumni.contract.md section 5), created by the founder-side builder and reused by the manager side.
 * Import from the file when a page needs one block (lazy chunks stay small); this barrel is for convenience and for the manager pages.
 *
 *   forms:      useDraftForm (draft + Undo), SaveBar, UnsavedGuard, useAlumniErrorText / useAlumniFieldErrors
 *   fields:     ChipSelect, LookupSelect, GovernoratePicker, SectorPicker, useLookupOptions, NationalIdField
 *   blocks:     ProfileSection, DerivedValue, CompletenessMeter, scrollToSection
 *   company:    CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection, CompanyOnlineSection, CompanyStatusSection, DirectoryVisibilitySection
 *   data views: TeamEditor, ProgramsReadOnlyList, FiguresPanel (the quarterly figures: draft, confirm, closed quarters, graphs), useMetricFormat
 * Pure logic: lib/alumniForms.js (form <-> patch, instant validation), lib/nationalId.js (instant ID feedback), lib/alumniProgress.js (milestones), lib/alumniQuarters.js (quarters, series).
 */
export { useDraftForm } from './useDraftForm.js'
export { useAlumniRefresh } from './useAlumniRefresh.js'
export { default as SaveBar } from './SaveBar.jsx'
export { default as UnsavedGuard } from './UnsavedGuard.jsx'
export { useAlumniErrorText, useAlumniFieldErrors } from './useAlumniErrorText.js'
export { ChipSelect, LookupSelect, GovernoratePicker, SectorPicker } from './pickers.jsx'
export { useLookupOptions } from './useLookupOptions.js'
export { default as NationalIdField } from './NationalIdField.jsx'
export { ProfileSection, DerivedValue, CompletenessMeter } from './blocks.jsx'
export { scrollToSection } from './scrollToSection.js'
export { CompanyBasicsSection, CompanyClassificationSection, CompanyLocationSection, CompanyOnlineSection, CompanyStatusSection, DirectoryVisibilitySection } from './CompanySections.jsx'
export { default as TeamEditor } from './TeamEditor.jsx'
export { default as ProgramsReadOnlyList } from './ProgramsReadOnlyList.jsx'
export { default as FiguresPanel, FiguresBanner, FigureStatusBadge, QuarterHistory } from './FiguresPanel.jsx'
export { useMetricFormat } from './useMetricFormat.js'
