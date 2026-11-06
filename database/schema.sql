-- ОКТО им. меня · схема базы для Supabase
-- Выполните этот файл целиком в SQL Editor проекта Supabase.

create extension if not exists pgcrypto;

/* ---------- профили ---------- */
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'participant' check (role in ('participant','curator')),
  created_at timestamptz not null default now()
);

/* ---------- курсы ---------- */
create table if not exists public.courses (
  id text primary key,
  title text not null,
  level text not null default 'Начальный',
  description text not null default '',
  lessons integer not null default 1,
  url text not null default '',
  published boolean not null default false,
  author uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

/* ---------- отправленные задания ---------- */
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  lesson text not null,
  text_body text not null default '',
  link text not null default '',
  status text not null default 'pending' check (status in ('pending','accepted','rework')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);

/* ---------- прогресс по занятиям ---------- */
create table if not exists public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  lesson_id text not null,
  done boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, course_id, lesson_id)
);

/* ---------- профиль создаётся при регистрации ---------- */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'curator' then 'curator' else 'participant' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

/* ---------- проверка роли ---------- */
create or replace function public.is_curator()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'curator');
$$;

grant execute on function public.is_curator() to authenticated;

/* ---------- RLS ---------- */
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.submissions enable row level security;
alter table public.progress enable row level security;

-- профили: свой виден самому, все профили видны авторизованным (нужно для журнала), менять можно только свой
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- курсы: опубликованные видят все, черновики — только куратор
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select
  using (published or public.is_curator());

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses for all to authenticated
  using (public.is_curator()) with check (public.is_curator());

-- задания: участник видит свои, куратор — все; создаёт только от своего имени
drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.is_curator());

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions for update to authenticated
  using (public.is_curator() or user_id = auth.uid())
  with check (public.is_curator() or user_id = auth.uid());

-- прогресс: участник видит и меняет свой, авторизованные видят все отметки (для журнала)
drop policy if exists progress_select on public.progress;
create policy progress_select on public.progress for select to authenticated using (true);

drop policy if exists progress_write on public.progress;
create policy progress_write on public.progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ---------- демонстрационный курс ---------- */
insert into public.courses (id, title, level, description, lessons, url, published)
values (
  'jung-character',
  'Юнгианский анализ театрального персонажа',
  'Начальный',
  'Практический курс о том, как читать сценический текст через юнгианские понятия и проверять интерпретации в действии, а не превращать их в диагнозы.',
  8,
  'courses/jung-character/index.html',
  true
)
on conflict (id) do nothing;
