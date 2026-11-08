begin;
select plan(19);

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.school_classes'::regclass), 'school_classes has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.subjects'::regclass), 'subjects has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.publications'::regclass), 'publications has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.publication_files'::regclass), 'publication_files has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.school_results'::regclass), 'school_results has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'audit_log has RLS enabled');

select ok(has_table_privilege('anon', 'public.publications', 'select'), 'anonymous visitors can read the publication feed');
select ok(not has_table_privilege('anon', 'public.publications', 'insert,update,delete'), 'anonymous visitors cannot write publications');
select ok(has_table_privilege('authenticated', 'public.publications', 'insert,update,delete'), 'staff role has publication operations subject to RLS');
select ok(not has_table_privilege('anon', 'public.school_results', 'select,insert,update,delete'), 'anonymous visitors have no grants on student results');
select ok(has_table_privilege('authenticated', 'public.school_results', 'select,insert,update,delete'), 'signed-in role reaches results only through admin RLS policies');
select ok(not has_table_privilege('anon', 'public.audit_log', 'select,insert,update,delete'), 'anonymous visitors have no audit-log grants');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert,update,delete'), 'client roles cannot write the audit log');

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'school_results' and policyname in ('school_results_admin_read', 'school_results_admin_insert', 'school_results_admin_update', 'school_results_admin_delete')),
  4,
  'student results have separate admin-only operation policies'
);
select ok(
  (select bool_and(coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%is_admin%') from pg_policies where schemaname = 'public' and tablename = 'school_results'),
  'every student-result policy checks the admin role'
);
select ok(
  (select bool_and(qual like '%author_id%' or with_check like '%author_id%') from pg_policies where schemaname = 'public' and tablename = 'publications' and policyname like 'publications_staff_%'),
  'teacher publication policies are owner-scoped'
);
select ok(
  (select count(*) = 2 from storage.buckets where id in ('cpo-public', 'cpo-private-documents')),
  'storage has configured CPO buckets'
);
select ok(
  (select bool_and(file_size_limit = 104857600) from storage.buckets where id in ('cpo-public', 'cpo-private-documents')),
  'CPO upload buckets use the documented 100 MiB limit'
);

select * from finish();
rollback;
