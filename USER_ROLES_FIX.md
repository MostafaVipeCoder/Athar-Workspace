# Fix Documentation: `user_roles` Table Schema Cleanup & Constraint Resolution

## 1. Issue Summary
The `user_roles` table in the Supabase PostgreSQL database had two architectural problems:
1. **Redundant Columns**: Two columns were storing the user role (`role_key` of type `TEXT` and `role` of type `app_role` enum), requiring complex synchronization triggers (`trg_sync_user_roles` and `sync_user_roles_role_columns`).
2. **Unique Constraint Violation Errors**: Attempts to assign or re-assign roles triggered `duplicate key value violates unique constraint "user_roles_user_id_role_unique"`.

---

## 2. Root Cause Analysis
- **Column Redundancy**: An earlier migration introduced `role` (`app_role` enum) alongside the legacy `role_key` (`TEXT`) with a foreign key constraint referencing `roles(key)`. Triggers were placed to keep both in sync, which increased complexity, doubled maintenance, and introduced fragility across RLS policies and procedures.
- **Unique Constraint Error**: Applications were executing direct `INSERT` statements when associating a role with a user. Because `user_roles` possesses a `UNIQUE (user_id, role)` constraint (`user_roles_user_id_role_unique`), any attempt to assign an existing role without collision handling resulted in PostgreSQL throwing a duplicate key constraint violation.

---

## 3. Implemented Solution

### Phase 1: Audit & Diagnostics
- Inspected table schema, column definitions, constraints, indexes, and existing data.
- Verified that all 13 existing user role records had matching values across `role_key` and `role`.
- Identified all dependent objects on `role_key`:
  - PostgreSQL functions: `get_user_roles()`, `is_super_admin()`, `has_role()`.
  - Trigger function: `sync_user_roles_role_columns()` and trigger `trg_sync_user_roles`.
  - Foreign key: `user_roles_role_key_fkey`.
  - 4 Row Level Security (RLS) policies on `events` (`events_select_by_pm_or_admin`, `events_insert_by_pm_or_admin`, `events_update_by_owner_or_admin`, `events_delete_by_owner_or_admin`).

### Phase 2: Data Backup & Deduplication Verification
- Backed up complete table state before making any modifications to [user_roles_backup_20261004.json](file:///supabase/backups/user_roles_backup_20261004.json).
- Verified zero existing duplicate rows on `(user_id, role)`.

### Phase 3: Database Migration
Applied migration [20261004000000_fix_user_roles_drop_role_key.sql](file:///supabase/migrations/20261004000000_fix_user_roles_drop_role_key.sql):
1. **Updated Database Functions**:
   - `get_user_roles(p_user_id uuid)`: now aggregates `role::text`.
   - `is_super_admin(check_user_id uuid)`: checks `role = 'super_admin'::app_role`.
   - `has_role(role_name text, check_user_id uuid)`: checks `role::text = role_name`.
2. **Updated `events` Table RLS Policies**:
   - Switched from `ur.role_key` to `ur.role`.
3. **Removed Redundant Triggers**:
   - Dropped `trg_sync_user_roles` trigger and `sync_user_roles_role_columns()` function.
4. **Dropped Redundant Column**:
   - Dropped `role_key` column from `public.user_roles` (and its foreign key constraint).

### Phase 4: Codebase & TypeScript Types Update
1. **Frontend / Backend Queries**:
   - Cleaned `getUserRoles()` in [api.js](file:///src/lib/api.js#L4056-L4071) to select and map only `role`.
   - Cleaned `getAllEligibleProjectManagers()` in [api.js](file:///src/lib/api.js#L4214-L4240) to select and map only `role`.
   - Added robust helper functions `assignUserRole()` and `removeUserRole()` with `upsert` and `{ onConflict: 'user_id,role', ignoreDuplicates: true }`.
2. **TypeScript Type Definitions**:
   - Regenerated [database.types.ts](file:///src/types/database.types.ts#L2509-L2535) via Supabase schema generator, confirming `user_roles` now consists of `id`, `user_id`, `role`, `assigned_at`, `created_at`, `updated_at`.

---

## 4. Modified Files
| File Path | Description of Changes |
| :--- | :--- |
| [supabase/migrations/20261004000000_fix_user_roles_drop_role_key.sql](file:///supabase/migrations/20261004000000_fix_user_roles_drop_role_key.sql) | DDL migration updating policies, functions, triggers, and dropping `role_key`. |
| [supabase/backups/user_roles_backup_20261004.json](file:///supabase/backups/user_roles_backup_20261004.json) | Full snapshot of all `user_roles` records before modification. |
| [src/lib/api.js](file:///src/lib/api.js) | Removed `role_key` queries; added `assignUserRole` (UPSERT) and `removeUserRole`. |
| [src/types/database.types.ts](file:///src/types/database.types.ts) | Regenerated Supabase database types without `role_key`. |
| [USER_ROLES_FIX.md](file:///USER_ROLES_FIX.md) | Technical documentation of the audit, fix, and validation. |

---

## 5. Verification & Test Results
- **Schema Validation**:
  - `user_roles` columns verified: `id`, `user_id`, `role`, `assigned_at`, `created_at`, `updated_at`.
  - Column `role_key` is completely removed.
- **Constraints & Indexes**:
  - `user_roles_pkey` (PRIMARY KEY) intact.
  - `user_roles_user_id_fkey` (FOREIGN KEY on `auth.users(id)`) intact.
  - `user_roles_user_id_role_unique` (UNIQUE on `(user_id, role)`) intact.
- **Function Verification**:
  - `public.get_user_roles('e9b58863-1dbf-46fa-8125-0495019545a2')` returned `['super_admin', 'alumni_manager']`.
  - `public.is_super_admin(...)` returned `true`.
  - `public.has_role('alumni_manager', ...)` returned `true`.
  - `public.has_role('founder', ...)` returned `false`.
- **UPSERT Idempotency Test**:
  - Re-inserting existing role using `ON CONFLICT (user_id, role) DO NOTHING` succeeded without errors and maintained table count at 13.
- **Frontend Build**:
  - `bun run build` completed with zero errors and produced production distribution.

---

## 6. Future Recommendations
1. **Always Use UPSERT for Role Management**: When assigning user roles in code, always use:
   ```javascript
   await supabase
     .from('user_roles')
     .upsert(
       { user_id: userId, role: roleName },
       { onConflict: 'user_id,role', ignoreDuplicates: true }
     );
   ```
2. **Single Source of Truth**: Maintain single column definitions for roles (`app_role` enum) rather than dual enum and text representations.
3. **Session Cache Busting**: Ensure `sessionStorage.removeItem('user_roles_' + userId)` is invoked whenever roles are modified to keep client auth contexts synchronized.
