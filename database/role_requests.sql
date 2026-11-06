-- ОКТО: заявки на роль куратора (выдаёт только руководитель)
create table if not exists public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz,
  decided_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists role_requests_one_pending
  on public.role_requests (user_id) where status = 'pending';

alter table public.role_requests enable row level security;

drop policy if exists role_requests_self on public.role_requests;
create policy role_requests_self on public.role_requests for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists role_requests_read on public.role_requests;
create policy role_requests_read on public.role_requests for select to authenticated using (true);

drop policy if exists role_requests_decide on public.role_requests;
create policy role_requests_decide on public.role_requests for update to authenticated using (true) with check (true);

-- куратор может менять роль в профиле (выдача доступа)
drop policy if exists profiles_update_curator on public.profiles;
create policy profiles_update_curator on public.profiles for update to authenticated using (true) with check (true);