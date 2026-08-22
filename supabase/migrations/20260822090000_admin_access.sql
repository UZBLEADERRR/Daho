-- ============================================================================
--  Admin kirishini tuzatish
--
--  `admin_emails` boʻsh massiv bilan seed qilingan edi, shuning uchun admin
--  boʻlishning yagona yoʻli — birinchi boʻlib roʻyxatdan oʻtish. Kimdir
--  oldinroq roʻyxatdan oʻtgan boʻlsa, egasi oʻz panelini ocholmay qolardi.
-- ============================================================================

-- 1. Egasining pochtasi roʻyxatga qoʻshiladi (mavjudlari saqlanadi).
update public.app_settings
   set value = (
     select jsonb_agg(distinct lower(e))
       from jsonb_array_elements_text(
         coalesce(value, '[]'::jsonb) || '["sarvarbeksanjarivich@gmail.com"]'::jsonb
       ) e
   )
 where key = 'admin_emails';

insert into public.app_settings (key, value)
values ('admin_emails', '["sarvarbeksanjarivich@gmail.com"]'::jsonb)
on conflict (key) do nothing;

-- 2. Allaqachon roʻyxatdan oʻtgan boʻlsa — hoziroq admin qilamiz.
update public.profiles p
   set role = 'admin'
  from public.app_settings s
 where s.key = 'admin_emails'
   and s.value ? lower(p.email)
   and p.role <> 'admin';

-- ---------------------------------------------------------------------------
--  Oʻzini admin qilish uchun qulay funksiya.
--
--  Supabase SQL Editor da bir qator yozish kifoya:
--     select public.claim_admin('pochta@example.com');
--
--  Hech kim admin boʻlmaganda ishlaydi (birinchi egani belgilash uchun),
--  yoki chaqirayotgan odam allaqachon admin boʻlsa.
-- ---------------------------------------------------------------------------
create or replace function public.claim_admin(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_has_admin boolean;
  v_found integer;
begin
  select exists (select 1 from public.profiles where role = 'admin') into v_has_admin;

  if v_has_admin and not public.is_admin() then
    raise exception 'Admin allaqachon bor — faqat admin yangi admin tayinlay oladi';
  end if;

  update public.profiles
     set role = 'admin'
   where lower(email) = lower(p_email);
  get diagnostics v_found = row_count;

  if v_found = 0 then
    return 'Bunday pochta bilan roʻyxatdan oʻtilmagan: ' || p_email;
  end if;

  -- Keyingi safar ham admin boʻlib qolsin.
  update public.app_settings
     set value = (
       select jsonb_agg(distinct lower(e))
         from jsonb_array_elements_text(
           coalesce(value, '[]'::jsonb) || to_jsonb(array[lower(p_email)])
         ) e
     )
   where key = 'admin_emails';

  return 'Tayyor — ' || p_email || ' endi admin';
end;
$$;

revoke all on function public.claim_admin(text) from public;
grant execute on function public.claim_admin(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Foydalanuvchi oʻz holatini koʻra olsin (nega admin emasman?).
-- ---------------------------------------------------------------------------
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id',      auth.uid(),
    'email',        (select email from public.profiles where id = auth.uid()),
    'role',         (select role  from public.profiles where id = auth.uid()),
    'is_admin',     public.is_admin(),
    'admin_emails', (select value from public.app_settings where key = 'admin_emails'),
    'admin_count',  (select count(*) from public.profiles where role = 'admin')
  );
$$;

grant execute on function public.whoami() to authenticated;

-- ---------------------------------------------------------------------------
--  3. Xavfsizlik: «birinchi roʻyxatdan oʻtgan — admin» qoidasi olib tashlanadi
--
--  Ilova ochiq boʻlgach birinchi roʻyxatdan oʻtgan BEGONA odam butun tizimga
--  egalik qilib qolardi: barcha foydalanuvchilarni koʻradi, tarif beradi,
--  modellarni oʻzgartiradi. Endi admin faqat `admin_emails` roʻyxati orqali
--  beriladi.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admins jsonb;
  v_role text := 'user';
  v_plan public.plans%rowtype;
begin
  select value into v_admins from public.app_settings where key = 'admin_emails';

  if v_admins is not null and v_admins ? lower(coalesce(new.email, '')) then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;

  select * into v_plan from public.plans where is_default and is_active limit 1;

  insert into public.credit_balances (user_id, balance, granted, period_start, period_end)
  values (
    new.id,
    coalesce(v_plan.credit_grant, 0),
    coalesce(v_plan.credit_grant, 0),
    now(),
    now() + interval '30 days'
  )
  on conflict (user_id) do nothing;

  if v_plan.id is not null then
    insert into public.subscriptions (user_id, plan_id, status, note)
    values (new.id, v_plan.id, 'active', 'avtomatik bepul reja')
    on conflict do nothing;
  end if;

  return new;
end;
$$;
