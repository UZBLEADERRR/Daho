-- ============================================================================
--  Eski bazadagi maʼlumotni toʻgʻrilash
--
--  `20260818000000_repair_schema.sql` yetishmagan USTUNLARNI qoʻshadi,
--  lekin u eng birinchi ishga tushadi — u paytda boshqa jadvallar hali
--  yoʻq. Shuning uchun QIYMATLARNI toʻgʻrilash shu yerda, hammasi
--  yaratilib boʻlgandan keyin bajariladi.
--
--  Muammo: eski jadvaldagi qatorlar yangi ustunlarni boʻsh qiymat bilan
--  oladi. Masalan «free» rejasi `credit_grant = 0` boʻlib qoladi va
--  seed migratsiyasi uni `on conflict do nothing` bilan chetlab oʻtadi —
--  natijada foydalanuvchi roʻyxatdan oʻtadi, lekin krediti nol boʻladi.
-- ============================================================================

-- 1. Hech qachon sozlanmagan rejalarga seed qiymatlarini beramiz.
--    Krediti nol reja ishlamaydi — bu ataylab qilingan sozlama emas,
--    balki yarim qolgan yaratilishning izi.
update public.plans set
  description      = coalesce(nullif(description, ''), 'Sinash uchun. Kunlik kichik limit.'),
  credit_grant     = 2000,
  daily_credit_cap = coalesce(daily_credit_cap, 200),
  period           = coalesce(nullif(period, ''), 'free'),
  is_active        = true
where code = 'free' and coalesce(credit_grant, 0) = 0;

update public.plans set
  description      = coalesce(nullif(description, ''), 'Kundalik oʻqish uchun.'),
  credit_grant     = 30000,
  max_queued_jobs  = greatest(coalesce(max_queued_jobs, 0), 3),
  max_jobs_per_day = greatest(coalesce(max_jobs_per_day, 0), 20),
  allow_background = true,
  is_active        = true
where code = 'start' and coalesce(credit_grant, 0) = 0;

update public.plans set
  description      = coalesce(nullif(description, ''), 'Daho Code, video va fon vazifalari toʻliq.'),
  credit_grant     = 120000,
  max_queued_jobs  = greatest(coalesce(max_queued_jobs, 0), 10),
  max_jobs_per_day = greatest(coalesce(max_jobs_per_day, 0), 100),
  allow_background = true,
  is_active        = true
where code = 'pro' and coalesce(credit_grant, 0) = 0;

-- 2. Standart reja belgilanmagan boʻlsa — eng arzonini belgilaymiz.
--    Usiz yangi foydalanuvchiga umuman reja biriktirilmaydi.
do $$
begin
  if not exists (select 1 from public.plans where is_default) then
    update public.plans
       set is_default = true
     where id = (
       select id from public.plans
        where coalesce(is_active, true)
        order by coalesce(price_cents, 0), coalesce(sort, 0)
        limit 1
     );
  end if;
end $$;

-- 3. Profilsiz qolgan hisoblarni tiklaymiz.
--    Migratsiyalar ishga tushishidan OLDIN roʻyxatdan oʻtgan odamda
--    `auth.users` qatori bor, lekin `handle_new_user()` triggeri hali yoʻq
--    edi — shuning uchun `public.profiles` boʻsh qoldi. Ilova esa pochtani
--    ham, rolni ham koʻrsatolmaydi va «tizimda 0 ta admin bor» deb yozadi.
do $$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  execute $q$
    insert into public.profiles (id, email, full_name, role)
    select u.id,
           u.email,
           coalesce(u.raw_user_meta_data ->> 'full_name', ''),
           case
             when coalesce(
                    (select value from public.app_settings where key = 'admin_emails'),
                    '[]'::jsonb
                  ) ? lower(coalesce(u.email, '')) then 'admin'
             else 'user'
           end
      from auth.users u
     where not exists (select 1 from public.profiles p where p.id = u.id)
    on conflict (id) do nothing
  $q$;

  -- Profili bor, lekin pochtasi boʻsh qolganlar (eski shakldagi jadval).
  execute $q$
    update public.profiles p
       set email = u.email
      from auth.users u
     where u.id = p.id
       and u.email is not null
       and coalesce(p.email, '') = ''
  $q$;
end $$;

-- 4. Pochtasi egalik roʻyxatida boʻlganlar admin boʻlib qolsin.
update public.profiles p
   set role = 'admin'
  from public.app_settings s
 where s.key = 'admin_emails'
   and s.value ? lower(coalesce(p.email, ''))
   and coalesce(p.role, 'user') <> 'admin';

-- 5. Krediti berilmagan mavjud foydalanuvchilarga rejasining kreditini beramiz.
--    Eski bazada roʻyxatdan oʻtganlar boʻsh balans bilan qolgan boʻlishi mumkin.
update public.credit_balances b
   set balance      = p.credit_grant,
       granted      = p.credit_grant,
       period_start = coalesce(b.period_start, now()),
       period_end   = coalesce(b.period_end, now() + interval '30 days')
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
 where s.user_id = b.user_id
   and s.status = 'active'
   and coalesce(b.granted, 0) = 0
   and p.credit_grant > 0;

-- 6. Obunasi yoʻq foydalanuvchilarni standart rejaga biriktiramiz.
insert into public.subscriptions (user_id, plan_id, status, note)
select pr.id, pl.id, 'active', 'taʼmirlashda biriktirildi'
  from public.profiles pr
  cross join lateral (
    select id, credit_grant from public.plans where is_default and is_active limit 1
  ) pl
 where not exists (
   select 1 from public.subscriptions s where s.user_id = pr.id and s.status = 'active'
 );

insert into public.credit_balances (user_id, balance, granted, period_start, period_end)
select pr.id, pl.credit_grant, pl.credit_grant, now(), now() + interval '30 days'
  from public.profiles pr
  cross join lateral (
    select credit_grant from public.plans where is_default and is_active limit 1
  ) pl
 where not exists (select 1 from public.credit_balances b where b.user_id = pr.id)
on conflict (user_id) do nothing;
