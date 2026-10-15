-- Verification queries for Phase 2
SELECT 'user_roles_count' as metric, count(*)::text as val FROM public.user_roles
UNION ALL
SELECT 'user_roles_super_admin' as metric, count(*)::text as val FROM public.user_roles WHERE role = 'super_admin'
UNION ALL
SELECT 'profiles_count' as metric, count(*)::text as val FROM public.profiles
UNION ALL
SELECT 'project_managers_columns' as metric, string_agg(column_name, ', ' ORDER BY ordinal_position) as val 
FROM information_schema.columns 
WHERE table_name = 'project_managers' AND table_schema = 'public'
UNION ALL
SELECT 'user_roles_columns' as metric, string_agg(column_name, ', ' ORDER BY ordinal_position) as val 
FROM information_schema.columns 
WHERE table_name = 'user_roles' AND table_schema = 'public'
UNION ALL
SELECT 'policies_count' as metric, count(*)::text as val 
FROM pg_policies 
WHERE tablename IN ('user_roles', 'project_managers');
