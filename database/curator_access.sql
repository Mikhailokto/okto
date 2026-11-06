-- Всех регистрируем участниками; куратора выдаёт руководитель вручную.
-- Список участников и смена роли доступны вошедшим пользователям.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_any on public.profiles;
create policy profiles_update_any on public.profiles for update to authenticated
  using (true) with check (true);