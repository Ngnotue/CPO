-- CPO portal foundation for Supabase (Postgres + Auth + Storage).
-- Apply with: supabase db push, or run this migration in the Supabase SQL editor.
-- Private student results are never exposed to anon or teacher roles.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

do $$ begin
  create type public.cpo_staff_role as enum ('admin', 'teacher');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.cpo_publication_kind as enum ('news', 'announcement', 'event', 'course', 'exercise', 'resource');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.cpo_publication_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.cpo_publication_visibility as enum ('public', 'private');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.cpo_staff_role not null default 'teacher',
  full_name text not null check (char_length(full_name) between 2 and 160),
  teacher_code text unique,
  subject text,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  kind public.cpo_publication_kind not null,
  status public.cpo_publication_status not null default 'draft',
  visibility public.cpo_publication_visibility not null default 'public',
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  title text not null check (char_length(title) between 3 and 220),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  summary text not null default '' check (char_length(summary) <= 600),
  body text not null default '' check (char_length(body) <= 50000),
  category text check (category is null or char_length(category) <= 100),
  class_id uuid references public.school_classes(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  is_important boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_expiry_after_publish check (expires_at is null or published_at is null or expires_at > published_at),
  constraint publication_locale_slug_unique unique (locale, slug)
);

create table if not exists public.publication_files (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  bucket_id text not null check (bucket_id in ('cpo-public', 'cpo-private-documents')),
  object_path text not null unique check (char_length(object_path) <= 1024),
  original_name text not null check (char_length(original_name) between 1 and 255),
  content_type text not null check (content_type in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 104857600),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

-- Student-identifying results are kept in a separate, administrator-only table.
create table if not exists public.school_results (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  class_id uuid references public.school_classes(id) on delete set null,
  exam_name text not null check (char_length(exam_name) between 2 and 180),
  student_name text not null check (char_length(student_name) between 2 and 180),
  student_identifier text,
  result_value text not null check (char_length(result_value) between 1 and 120),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (student_identifier is null or char_length(student_identifier) <= 100)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists publications_public_feed_idx on public.publications (published_at desc)
  where status = 'published' and visibility = 'public';
create index if not exists publications_author_idx on public.publications (author_id, updated_at desc);
create index if not exists publications_kind_status_idx on public.publications (kind, status, published_at desc);
create index if not exists publications_class_idx on public.publications (class_id) where class_id is not null;
create index if not exists publications_subject_idx on public.publications (subject_id) where subject_id is not null;
create index if not exists publication_files_publication_idx on public.publication_files (publication_id);
create index if not exists school_results_class_idx on public.school_results (class_id) where class_id is not null;
create index if not exists school_results_exam_idx on public.school_results (exam_name, created_at desc);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.set_publication_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.current_staff_role()
returns public.cpo_staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
  limit 1
$$;

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() in ('admin'::public.cpo_staff_role, 'teacher'::public.cpo_staff_role)
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() = 'admin'::public.cpo_staff_role
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.set_publication_published_at() from public, anon, authenticated;
revoke all on function private.current_staff_role() from public, anon;
revoke all on function private.is_active_staff() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.is_admin() to authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
drop trigger if exists publications_set_updated_at on public.publications;
create trigger publications_set_updated_at before update on public.publications
for each row execute function private.set_updated_at();
drop trigger if exists publications_set_published_at on public.publications;
create trigger publications_set_published_at before insert or update of status on public.publications
for each row execute function private.set_publication_published_at();

alter table public.profiles enable row level security;
alter table public.school_classes enable row level security;
alter table public.subjects enable row level security;
alter table public.publications enable row level security;
alter table public.publication_files enable row level security;
alter table public.school_results enable row level security;
alter table public.audit_log enable row level security;

-- Revoke broad defaults before granting the exact public and staff operations.
revoke all on table public.profiles, public.school_classes, public.subjects, public.publications,
  public.publication_files, public.school_results, public.audit_log from anon, authenticated;
grant select on table public.school_classes, public.subjects to anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.publications to anon, authenticated;
grant insert, update, delete on table public.publications to authenticated;
grant select on table public.publication_files to anon, authenticated;
grant insert, update, delete on table public.publication_files to authenticated;
grant select, insert, update, delete on table public.school_results to authenticated;
grant select on table public.audit_log to authenticated;
-- audit_log is server-only; service_role is not granted to client sessions.

create policy profiles_read_self_or_admin on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

create policy school_classes_read_active on public.school_classes for select to anon, authenticated
using (is_active);
create policy subjects_read_active on public.subjects for select to anon, authenticated
using (is_active);

create policy publications_read_public on public.publications for select to anon, authenticated
using (status = 'published' and visibility = 'public' and (published_at is null or published_at <= now()) and (expires_at is null or expires_at > now()));
create policy publications_staff_read on public.publications for select to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and author_id = (select auth.uid())));
create policy publications_staff_insert on public.publications for insert to authenticated
with check ((select private.is_active_staff()) and ((select private.is_admin()) or author_id = (select auth.uid())));
create policy publications_staff_update on public.publications for update to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and author_id = (select auth.uid())))
with check ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and author_id = (select auth.uid())));
create policy publications_staff_delete on public.publications for delete to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and author_id = (select auth.uid())));

create policy publication_files_read_public on public.publication_files for select to anon, authenticated
using (is_public and bucket_id = 'cpo-private-documents' and exists (
  select 1 from public.publications p where p.id = publication_id and p.status = 'published'
    and p.visibility = 'public' and (p.published_at is null or p.published_at <= now())
    and (p.expires_at is null or p.expires_at > now())
));
create policy publication_files_staff_read on public.publication_files for select to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and uploaded_by = (select auth.uid())));
create policy publication_files_staff_insert on public.publication_files for insert to authenticated
with check ((select private.is_active_staff()) and uploaded_by = (select auth.uid())
  and bucket_id = 'cpo-private-documents'
  and (storage.foldername(object_path))[1] = (select auth.uid())::text
  and exists (select 1 from public.publications p where p.id = publication_id
    and ((select private.is_admin()) or p.author_id = (select auth.uid()))
    and is_public = (p.status = 'published' and p.visibility = 'public')));
create policy publication_files_staff_update on public.publication_files for update to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and uploaded_by = (select auth.uid())))
with check ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and uploaded_by = (select auth.uid())
  and bucket_id = 'cpo-private-documents'
  and (storage.foldername(object_path))[1] = (select auth.uid())::text
  and exists (select 1 from public.publications p where p.id = publication_id and p.author_id = (select auth.uid())
    and is_public = (p.status = 'published' and p.visibility = 'public'))));
create policy publication_files_staff_delete on public.publication_files for delete to authenticated
using ((select private.is_admin()) or ((select private.current_staff_role()) = 'teacher'::public.cpo_staff_role and uploaded_by = (select auth.uid())));

-- Public and teacher queries never access student-identifying result rows.
create policy school_results_admin_read on public.school_results for select to authenticated
using ((select private.is_admin()));
create policy school_results_admin_insert on public.school_results for insert to authenticated
with check ((select private.is_admin()));
create policy school_results_admin_update on public.school_results for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy school_results_admin_delete on public.school_results for delete to authenticated
using ((select private.is_admin()));
create policy audit_log_admin_read on public.audit_log for select to authenticated
using ((select private.is_admin()));

-- Public image bucket; private teaching/admin documents use the private bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cpo-public', 'cpo-public', true, 104857600,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cpo-private-documents', 'cpo-private-documents', false, 104857600,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage is not exposed as a direct student-result delivery mechanism.
drop policy if exists cpo_public_media_read on storage.objects;
create policy cpo_public_media_read on storage.objects for select to anon, authenticated
using (bucket_id = 'cpo-public');
drop policy if exists cpo_staff_upload_own_folder on storage.objects;
create policy cpo_staff_upload_own_folder on storage.objects for insert to authenticated
with check ((select private.is_active_staff()) and (storage.foldername(name))[1] = (select auth.uid())::text
  and bucket_id in ('cpo-public', 'cpo-private-documents'));
drop policy if exists cpo_staff_update_own_folder on storage.objects;
create policy cpo_staff_update_own_folder on storage.objects for update to authenticated
using ((select private.is_admin()) or ((select private.is_active_staff()) and (storage.foldername(name))[1] = (select auth.uid())::text))
with check ((select private.is_admin()) or ((select private.is_active_staff()) and (storage.foldername(name))[1] = (select auth.uid())::text));
drop policy if exists cpo_staff_delete_own_folder on storage.objects;
create policy cpo_staff_delete_own_folder on storage.objects for delete to authenticated
using ((select private.is_admin()) or ((select private.is_active_staff()) and (storage.foldername(name))[1] = (select auth.uid())::text));
