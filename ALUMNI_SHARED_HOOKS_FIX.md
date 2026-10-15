# Alumni Shared Hooks Fix

## Problem Summary
During the light-theme conversion, the PowerShell batch script removed
`useSearchParams`/`lang`/`isRtl` setup blocks from 6 pages while leaving
behind references — causing ReferenceErrors on every tab except Dashboard.

## Audit Results

| Tab | File | Missing Variables |
|-----|------|-------------------|
| Invitations | AlumniInvitationsPage.jsx | isRtl (×4) |
| Notifications | AlumniNotificationsPage.jsx | isRtl (×1) |
| Platform Analytics | AlumniAnalyticsPage.jsx | searchParams (×6) |
| Impact Dashboard | ImpactDashboard.jsx | lang (×1) |
| M&E Workspace | MEWorkspace.jsx | lang (fixed earlier) |
| Company Directory | AlumniDirectory.jsx | lang (fixed earlier) |
| Opportunities | OpportunitiesHub.jsx | lang (×1) |

## Solution: Two Shared Hooks

### src/hooks/useLanguage.js
- Provides: lang, isRtl, isLtr, setLang
- Persists choice to localStorage
- Syncs document.dir and document.lang

### src/hooks/useQueryParams.js  
- Provides: searchParams, getParam, setParam, resetParams
- Thin wrapper over react-router useSearchParams with helpers

## Files Modified

| File | Change |
|------|--------|
| src/hooks/useLanguage.js | CREATED |
| src/hooks/useQueryParams.js | CREATED |
| AlumniInvitationsPage.jsx | import useLanguage + const { lang, isRtl } |
| AlumniNotificationsPage.jsx | import useLanguage + const { lang, isRtl } |
| AlumniAnalyticsPage.jsx | import useQueryParams + const { searchParams } |
| ImpactDashboard.jsx | const lang = 'en' (hardcoded, English-only) |
| OpportunitiesHub.jsx | const lang = 'en' (hardcoded, English-only) |

## Pattern for Future Pages

Every Alumni Manager page must start with:

  import { useLanguage } from '../../hooks/useLanguage';
  const { lang, isRtl } = useLanguage();

If URL query params needed:

  import { useQueryParams } from '../../hooks/useQueryParams';
  const { searchParams, getParam, setParam } = useQueryParams();

## Build Result
  built in 12.12s — 0 errors across 2579 modules
