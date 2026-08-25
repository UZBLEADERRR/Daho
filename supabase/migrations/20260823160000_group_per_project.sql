-- ============================================================================
--  Guruh — har bir loyiha uchun alohida
--
--  Ilgari guruhlar mustaqil ro'yxat edi: odam guruh ochib, keyin uni
--  loyiha bilan bog'lashi kerak edi. Amalda esa guruh har doim BITTA
--  loyiha uchun tuziladi — «Kosmetika sayti ustida birga ishlaymiz».
--
--  Shuning uchun guruhga `project_ref` qo'shiladi: egasining shu
--  loyihasi. Bitta loyihaga bitta guruh.
-- ============================================================================

alter table public.groups
  add column if not exists project_ref text;

-- Bitta loyihaga bitta guruh. `project_ref` bo'sh bo'lsa cheklov ishlamaydi
-- (umumiy guruhlar uchun joy qoladi).
create unique index if not exists groups_owner_project
  on public.groups (owner_id, project_ref)
  where project_ref is not null;

-- ---------------------------------------------------------------------------
--  create_group — endi loyiha bilan
-- ---------------------------------------------------------------------------
create or replace function public.create_group(
  p_name text,
  p_kind text default 'kod',
  p_project_ref text default null
) returns public.groups language plpgsql security definer set search_path = public as $$
declare
  g public.groups%rowtype;
begin
  if auth.uid() is null then raise exception 'avval tizimga kiring'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'guruh nomi kerak'; end if;

  -- Shu loyiha uchun guruh allaqachon bo'lsa — yangisini ochmaymiz.
  if p_project_ref is not null then
    select * into g from public.groups
     where owner_id = auth.uid() and project_ref = p_project_ref;
    if found then return g; end if;
  end if;

  insert into public.groups (name, kind, owner_id, project_ref)
  values (trim(p_name), coalesce(nullif(p_kind, ''), 'kod'), auth.uid(), p_project_ref)
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  insert into public.group_projects (group_id, updated_by)
  values (g.id, auth.uid());

  return g;
end;
$$;

grant execute on function public.create_group(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Loyihaning guruhi
--
--  Ikki yo'l bilan topiladi:
--    - egasi bo'lsangiz — o'z `project_ref` ingiz bo'yicha;
--    - a'zo bo'lsangiz — guruh id si bo'yicha (loyiha sizda boshqa nom
--      bilan turadi, chunki u sizga taklif orqali kelgan).
-- ---------------------------------------------------------------------------
create or replace function public.group_for_project(p_ref text)
returns table (
  id uuid, name text, kind text, credits numeric,
  my_role text, members integer, owner_name text, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    g.id, g.name, g.kind, g.credits,
    m.role,
    (select count(*)::integer from public.group_members x where x.group_id = g.id),
    coalesce(nullif(o.full_name, ''), split_part(o.email, '@', 1)),
    g.updated_at
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  left join public.profiles o on o.id = g.owner_id
  where g.project_ref = p_ref and g.owner_id = auth.uid()
  limit 1;
$$;

create or replace function public.group_by_id(p_group uuid)
returns table (
  id uuid, name text, kind text, credits numeric,
  my_role text, members integer, owner_name text, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    g.id, g.name, g.kind, g.credits,
    m.role,
    (select count(*)::integer from public.group_members x where x.group_id = g.id),
    coalesce(nullif(o.full_name, ''), split_part(o.email, '@', 1)),
    g.updated_at
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  left join public.profiles o on o.id = g.owner_id
  where g.id = p_group;
$$;

grant execute on function public.group_for_project(text) to authenticated;
grant execute on function public.group_by_id(uuid) to authenticated;

comment on column public.groups.project_ref is
  'Egasining shu loyihasi (Daho Code loyihasining mahalliy id si). '
  'Bitta loyihaga bitta guruh.';
