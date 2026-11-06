-- ОКТО: проекты (куратор добавляет работы объединения)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 160),
  tag text not null default '' check (char_length(tag) <= 60),
  description text not null check (char_length(description) >= 20),
  link text not null default '',
  published boolean not null default false,
  author uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (true);

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
  using (is_curator()) with check (is_curator());