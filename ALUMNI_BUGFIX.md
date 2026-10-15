# Alumni Platform — Bug Fix Log

## Date: 2026-10-05

---

## Bug #1 (Critical): `lang is not defined` — Runtime Crash

### Affected Files
- `src/components/alumni/AlumniDirectory.jsx`
- `src/components/alumni/MEWorkspace.jsx`

### Root Cause
During the design-system unification (light-theme conversion), a PowerShell batch script
accidentally removed the `useSearchParams` / `lang` / `isRtl` setup lines from both files
while leaving behind references to the `lang` variable used by the `translations.Alumni[lang]` call.

### Fix Applied
Added `const lang = 'en';` as a compile-time constant at the top of each component function.
Also removed the now-unused `useSearchParams` from the `react-router-dom` import in both files.

---

## Bug #2 (Medium): AuthContext Timeout Too Aggressive

### Affected File
- `src/contexts/AuthContext.jsx`

### Fix Applied
1. Timeout increased: 6000ms -> 9000ms
2. Retry logic added: First fetch attempt is wrapped with .catch() that triggers a single retry.

### Behaviour After Fix
| Scenario | Before | After |
|---|---|---|
| Normal load | Fetches fresh | Fetches fresh |
| Transient network glitch | Falls back to cache | Retries once, then succeeds |
| Timeout (>9s) | Falls back to cache | Falls back to cache |

---

## Summary

| # | Severity | File | Fix |
|---|---|---|---|
| 1 | Critical | AlumniDirectory.jsx | Added const lang = 'en' |
| 1 | Critical | MEWorkspace.jsx | Added const lang = 'en' |
| 2 | Medium | AuthContext.jsx | 9s timeout + 1 retry |
