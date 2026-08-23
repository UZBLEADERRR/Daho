-- ============================================================================
--  Daho — bazani bir marta sozlash
--
--  Bu fayl `supabase/migrations/` dagi hamma migratsiyani TARTIB BILAN
--  birlashtiradi. Supabase → SQL Editor ga shu faylning oʻzini qoʻyib
--  «Run» bosing — boshqa hech narsa kerak emas.
--
--  Bir necha marta ishga tushirsa ham xavfsiz: hammasi «if not exists» va
--  «create or replace» bilan yozilgan, eski bazadagi yetishmagan ustunlar
--  esa oʻzi toʻldiriladi.
--
--  QOʻLDA TAHRIRLANMAYDI — `npm run sql` uni qayta yasaydi.
-- ============================================================================


-- ==========================================================================
--  20260818000000_repair_schema.sql
-- ==========================================================================

-- ============================================================================
--  Sxemani taʼmirlash — eski yoki yarim yaratilgan bazani toʻldiradi
--
--  Muammo: `create table if not exists` mavjud jadvalni oʻtkazib yuboradi.
--  Agar baza avvalgi (eskiroq) versiyada yaratilgan boʻlsa, jadval bor —
--  lekin yangi ustunlari yoʻq. Shundan keyin indeks yoki funksiya oʻsha
--  ustunga urilib migratsiya toʻxtaydi va qolgan jadvallar umuman
--  yaratilmaydi.
--
--  Bu fayl HAR QANDAY holatda xavfsiz: jadval yoʻq boʻlsa jim oʻtadi
--  (`alter table if exists`), ustun bor boʻlsa tegmaydi
--  (`add column if not exists`). Migratsiyalardan BIRINCHI boʻlib
--  ishga tushadi va nomi shunga qarab tanlangan.
-- ============================================================================


-- ============================================================================
--  `is_admin` ikkilanib qolgan boʻlsa — tozalaymiz
--
--  Xato: «function public.is_admin() is not unique».
--
--  Bazada ikkita funksiya paydo boʻlgan:
--      is_admin()          — eskiroq, argumentsiz
--      is_admin(uuid)      — hozirgi, `default auth.uid()` bilan
--
--  Ikkalasini ham `is_admin()` deb chaqirish mumkin, shuning uchun
--  PostgreSQL qaysi birini tanlashni bilmaydi va RLS siyosatlari
--  butunlay ishlamay qoladi.
--
--  Argumentlisi qoladi (u ham `is_admin()`, ham `is_admin(uuid)` boʻlib
--  ishlaydi). Argumentsizini olib tashlaymiz — lekin unga bogʻlangan
--  siyosatlar borligi uchun avval ularni saqlab, keyin qaytadan
--  yaratamiz. Siyosat matni oʻzgarmaydi.
-- ============================================================================

do $$
declare
  r record;
begin
  if not exists (
    select 1 from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = 'is_admin' and pr.pronargs = 0
  ) then
    return;   -- ikkilanish yoʻq
  end if;

  /*
   * Tartib muhim: avval TOʻGʻRI funksiya boʻlishi kerak.
   *
   * Argumentsizini oldin oʻchirsak, siyosatlarni qaytarish paytida
   * `is_admin()` umuman topilmay qoladi. Shuning uchun avval
   * argumentlisini yaratamiz — u ham `is_admin()` boʻlib chaqiriladi.
   */
  alter table if exists public.profiles
    add column if not exists role text default 'user';

  create or replace function public.is_admin(p_user uuid default auth.uid())
  returns boolean language sql stable security definer set search_path = public as $fn$
    select exists (
      select 1 from public.profiles p where p.id = p_user and p.role = 'admin'
    );
  $fn$;

  create temp table saqlangan_siyosat (
    nomi text, jadval text, buyruq text, roli text, qoida text, tekshiruv text
  ) on commit drop;

  insert into saqlangan_siyosat
  select pol.polname,
         pol.polrelid::regclass::text,
         case pol.polcmd
           when 'r' then 'select' when 'a' then 'insert'
           when 'w' then 'update' when 'd' then 'delete' else 'all'
         end,
         coalesce(
           (select string_agg(quote_ident(rolname), ', ')
              from pg_roles where oid = any(pol.polroles)),
           'public'
         ),
         pg_get_expr(pol.polqual, pol.polrelid),
         pg_get_expr(pol.polwithcheck, pol.polrelid)
    from pg_policy pol
   where pg_get_expr(pol.polqual, pol.polrelid) like '%is_admin()%'
      or pg_get_expr(pol.polwithcheck, pol.polrelid) like '%is_admin()%';

  for r in select * from saqlangan_siyosat loop
    execute format('drop policy %I on %s', r.nomi, r.jadval);
  end loop;

  begin
    drop function public.is_admin();
  exception when others then
    raise notice 'is_admin() olib tashlanmadi: %', sqlerrm;
  end;

  -- Siyosatlar qaytadi; endi ular argumentli funksiyaga bogʻlanadi.
  for r in select * from saqlangan_siyosat loop
    execute format(
      'create policy %I on %s for %s to %s%s%s',
      r.nomi, r.jadval, r.buyruq, r.roli,
      case when r.qoida is not null then ' using (' || r.qoida || ')' else '' end,
      case when r.tekshiruv is not null then ' with check (' || r.tekshiruv || ')' else '' end
    );
  end loop;
end $$;


-- app_settings
alter table if exists public.app_settings
  add column if not exists key text,
  add column if not exists value jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamp with time zone default now();

-- bot_tokens
alter table if exists public.bot_tokens
  add column if not exists user_id uuid,
  add column if not exists provider text,
  add column if not exists token text,
  add column if not exists updated_at timestamp with time zone default now();

-- credit_balances
alter table if exists public.credit_balances
  add column if not exists user_id uuid,
  add column if not exists balance numeric(14,4) default 0,
  add column if not exists granted numeric(14,4) default 0,
  add column if not exists used numeric(14,4) default 0,
  add column if not exists extra numeric(14,4) default 0,
  add column if not exists period_start timestamp with time zone default now(),
  add column if not exists period_end timestamp with time zone default (now() + '30 days'::interval),
  add column if not exists updated_at timestamp with time zone default now(),
  add column if not exists wallet numeric(14,2) default 0;

-- daily_model_usage
alter table if exists public.daily_model_usage
  add column if not exists user_id uuid,
  add column if not exists day date default CURRENT_DATE,
  add column if not exists calls integer default 0;

-- jobs
alter table if exists public.jobs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists kind text,
  add column if not exists title text default ''::text,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists model text default ''::text,
  add column if not exists status text default 'queued'::text,
  add column if not exists attempts integer default 0,
  add column if not exists result jsonb,
  add column if not exists error text,
  add column if not exists credits numeric(14,4) default 0,
  add column if not exists scheduled_at timestamp with time zone default now(),
  add column if not exists started_at timestamp with time zone,
  add column if not exists finished_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

-- plan_models
alter table if exists public.plan_models
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists plan_id uuid,
  add column if not exists model text,
  add column if not exists role text default 'chat'::text,
  add column if not exists input_credits_per_mtok numeric(12,4) default 0,
  add column if not exists output_credits_per_mtok numeric(12,4) default 0,
  add column if not exists call_credits numeric(12,4) default 0,
  add column if not exists enabled boolean default true,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

-- plans
alter table if exists public.plans
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists description text default ''::text,
  add column if not exists price_cents integer default 0,
  add column if not exists currency text default 'UZS'::text,
  add column if not exists period text default 'monthly'::text,
  add column if not exists credit_grant numeric(14,2) default 0,
  add column if not exists daily_credit_cap numeric(14,2),
  add column if not exists max_queued_jobs integer default 0,
  add column if not exists max_jobs_per_day integer default 0,
  add column if not exists allow_background boolean default false,
  add column if not exists features jsonb default '{}'::jsonb,
  add column if not exists is_active boolean default true,
  add column if not exists is_default boolean default false,
  add column if not exists sort integer default 0,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now(),
  add column if not exists hourly_credit_cap numeric(14,2),
  add column if not exists weekly_credit_cap numeric(14,2),
  add column if not exists allow_payg boolean default true,
  add column if not exists daily_model_access text default 'limited'::text,
  add column if not exists daily_model_quota integer default 30;

-- profiles
alter table if exists public.profiles
  add column if not exists id uuid,
  add column if not exists email text,
  add column if not exists full_name text default ''::text,
  add column if not exists role text default 'user'::text,
  add column if not exists blocked boolean default false,
  add column if not exists locale text default 'uz'::text,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

-- purchase_requests
alter table if exists public.purchase_requests
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists status text default 'pending'::text,
  add column if not exists contact text default ''::text,
  add column if not exists note text default ''::text,
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamp with time zone,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

-- subscriptions
alter table if exists public.subscriptions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists status text default 'active'::text,
  add column if not exists started_at timestamp with time zone default now(),
  add column if not exists expires_at timestamp with time zone,
  add column if not exists auto_renew boolean default false,
  add column if not exists note text default ''::text,
  add column if not exists granted_by uuid,
  add column if not exists created_at timestamp with time zone default now(),
  add column if not exists updated_at timestamp with time zone default now();

-- sync_items
alter table if exists public.sync_items
  add column if not exists user_id uuid,
  add column if not exists collection text,
  add column if not exists item_id text,
  add column if not exists payload jsonb,
  add column if not exists deleted boolean default false,
  add column if not exists device text default ''::text,
  add column if not exists rev bigint default 1,
  add column if not exists updated_at timestamp with time zone default now();

-- usage_events
alter table if exists public.usage_events
  add column if not exists id bigint,
  add column if not exists user_id uuid,
  add column if not exists model text default ''::text,
  add column if not exists kind text default 'chat'::text,
  add column if not exists source text default 'gateway'::text,
  add column if not exists input_tokens integer default 0,
  add column if not exists output_tokens integer default 0,
  add column if not exists total_tokens integer default 0,
  add column if not exists credits numeric(14,4) default 0,
  add column if not exists job_id uuid,
  add column if not exists meta jsonb default '{}'::jsonb,
  add column if not exists created_at timestamp with time zone default now();

-- wallet_events
alter table if exists public.wallet_events
  add column if not exists id bigint,
  add column if not exists user_id uuid,
  add column if not exists amount numeric(14,2),
  add column if not exists reason text default ''::text,
  add column if not exists admin_id uuid,
  add column if not exists created_at timestamp with time zone default now();

-- ==========================================================================
--  20260819000000_daho_cloud.sql
-- ==========================================================================

-- Daho Cloud — asosiy sxema.
-- Foydalanuvchi, obuna, kredit (token) hisobi, sinxronizatsiya va fon vazifalari.
--
-- Tushunchalar:
--   kredit  — ichki hisob birligi. Admin har bir reja va model uchun
--             «1 million token = necha kredit» narxini belgilaydi.
--   reja    — plans jadvali. Bepul reja is_default = true.
--   gateway — ai-gateway edge funksiyasi; obunachilar uchun so'rovni
--             platforma kaliti bilan Google'ga uzatadi va tokenni hisoblaydi.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- yordamchi

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  blocked boolean not null default false,
  locale text not null default 'uz',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.profiles
  add column if not exists id uuid,
  add column if not exists email text,
  add column if not exists full_name text default '',
  add column if not exists role text default 'user',
  add column if not exists blocked boolean default false,
  add column if not exists locale text default 'uz',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create or replace trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- security definer: RLS ichida rekursiyaga tushmasligi uchun.
create or replace function public.is_admin(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p where p.id = p_user and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------- app_settings

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.app_settings
  add column if not exists key text,
  add column if not exists value jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

create or replace trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value) values
  ('signup_enabled', 'true'::jsonb),
  ('gateway_enabled', 'true'::jsonb),
  ('allow_byok', 'true'::jsonb),
  -- Ushbu pochtalar bilan ro'yxatdan o'tgan foydalanuvchi darhol admin bo'ladi.
  ('admin_emails', '[]'::jsonb),
  -- Reja narx belgilamagan model uchun zaxira narx (kredit / 1M token).
  ('fallback_price', '{"input": 30, "output": 90}'::jsonb),
  ('brand', '{"name": "Daho", "support": ""}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- plans

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null default '',
  price_cents integer not null default 0,      -- so'mda: 1 = 1 so'm
  currency text not null default 'UZS',
  period text not null default 'monthly' check (period in ('monthly', 'yearly', 'once', 'free')),
  credit_grant numeric(14, 2) not null default 0,   -- har davrda beriladigan kredit
  daily_credit_cap numeric(14, 2),                  -- kunlik cheklov (null = yo'q)
  max_queued_jobs integer not null default 0,       -- navbatdagi fon vazifalari
  max_jobs_per_day integer not null default 0,
  allow_background boolean not null default false,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  is_default boolean not null default false,        -- yangi foydalanuvchi rejasi
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.plans
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists code text,
  add column if not exists name text,
  add column if not exists description text default '',
  add column if not exists price_cents integer default 0,
  add column if not exists currency text default 'UZS',
  add column if not exists period text default 'monthly',
  add column if not exists credit_grant numeric(14, 2) default 0,
  add column if not exists daily_credit_cap numeric(14, 2),
  add column if not exists max_queued_jobs integer default 0,
  add column if not exists max_jobs_per_day integer default 0,
  add column if not exists allow_background boolean default false,
  add column if not exists features jsonb default '{}'::jsonb,
  add column if not exists is_active boolean default true,
  add column if not exists is_default boolean default false,
  add column if not exists sort integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists plans_one_default
  on public.plans ((is_default)) where is_default;

create or replace trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

-- Reja ichidagi model ruxsati va token narxi — hammasi admin qo'lida.
create table if not exists public.plan_models (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  model text not null,
  role text not null default 'chat' check (role in ('chat', 'image', 'tts', 'video', 'other')),
  input_credits_per_mtok numeric(12, 4) not null default 0,
  output_credits_per_mtok numeric(12, 4) not null default 0,
  call_credits numeric(12, 4) not null default 0,   -- rasm/TTS uchun chaqiruv narxi
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, model)
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.plan_models
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists plan_id uuid,
  add column if not exists model text,
  add column if not exists role text default 'chat',
  add column if not exists input_credits_per_mtok numeric(12, 4) default 0,
  add column if not exists output_credits_per_mtok numeric(12, 4) default 0,
  add column if not exists call_credits numeric(12, 4) default 0,
  add column if not exists enabled boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create or replace trigger plan_models_touch before update on public.plan_models
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- obuna

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'active'
    check (status in ('active', 'trial', 'canceled', 'expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  auto_renew boolean not null default false,
  note text default '',
  granted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.subscriptions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists status text default 'active',
  add column if not exists started_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists auto_renew boolean default false,
  add column if not exists note text default '',
  add column if not exists granted_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists subscriptions_one_active
  on public.subscriptions (user_id) where status in ('active', 'trial');

create index if not exists subscriptions_user on public.subscriptions (user_id, created_at desc);

create or replace trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Obuna so'rovi (to'lov tizimi ulanmaguncha — admin tasdiqlaydi).
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  contact text default '',
  note text default '',
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.purchase_requests
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists plan_id uuid,
  add column if not exists status text default 'pending',
  add column if not exists contact text default '',
  add column if not exists note text default '',
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists purchase_requests_status
  on public.purchase_requests (status, created_at desc);

create or replace trigger purchase_requests_touch before update on public.purchase_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- kredit

create table if not exists public.credit_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric(14, 4) not null default 0,
  granted numeric(14, 4) not null default 0,   -- shu davrda berilgan
  used numeric(14, 4) not null default 0,      -- shu davrda sarflangan
  extra numeric(14, 4) not null default 0,     -- admin qo'lda qo'shgan, davr bilan yo'qolmaydi
  period_start timestamptz not null default now(),
  period_end timestamptz not null default (now() + interval '30 days'),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.credit_balances
  add column if not exists user_id uuid,
  add column if not exists balance numeric(14, 4) default 0,
  add column if not exists granted numeric(14, 4) default 0,
  add column if not exists used numeric(14, 4) default 0,
  add column if not exists extra numeric(14, 4) default 0,
  add column if not exists period_start timestamptz default now(),
  add column if not exists period_end timestamptz default (now() + interval '30 days'),
  add column if not exists updated_at timestamptz default now();

create or replace trigger credit_balances_touch before update on public.credit_balances
  for each row execute function public.touch_updated_at();

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  model text not null default '',
  kind text not null default 'chat',          -- chat | image | tts | search | stt | job
  source text not null default 'gateway',     -- gateway | byok | job
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  credits numeric(14, 4) not null default 0,
  job_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.usage_events
  add column if not exists id bigint,
  add column if not exists user_id uuid,
  add column if not exists model text default '',
  add column if not exists kind text default 'chat',
  add column if not exists source text default 'gateway',
  add column if not exists input_tokens integer default 0,
  add column if not exists output_tokens integer default 0,
  add column if not exists total_tokens integer default 0,
  add column if not exists credits numeric(14, 4) default 0,
  add column if not exists job_id uuid,
  add column if not exists meta jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

create index if not exists usage_events_user on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_created on public.usage_events (created_at desc);

-- ---------------------------------------------------------------- sinxronizatsiya

-- Har bir ro'yxat elementi (suhbat, konspekt, vazifa...) bitta satr.
-- Mahalliy nusxa (localStorage) asosiy manba bo'lib qoladi, bu jadval —
-- qurilmalar orasidagi ko'prik va zaxira.
create table if not exists public.sync_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null,
  item_id text not null,
  payload jsonb,
  deleted boolean not null default false,
  device text default '',
  rev bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, item_id)
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.sync_items
  add column if not exists user_id uuid,
  add column if not exists collection text,
  add column if not exists item_id text,
  add column if not exists payload jsonb,
  add column if not exists deleted boolean default false,
  add column if not exists device text default '',
  add column if not exists rev bigint default 1,
  add column if not exists updated_at timestamptz default now();

create index if not exists sync_items_cursor on public.sync_items (user_id, updated_at);

create or replace function public.sync_items_stamp()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.rev := old.rev + 1;
  end if;
  return new;
end;
$$;

create or replace trigger sync_items_stamp before insert or update on public.sync_items
  for each row execute function public.sync_items_stamp();

-- ---------------------------------------------------------------- fon vazifalari

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('chat', 'search', 'json', 'image', 'plan')),
  title text not null default '',
  payload jsonb not null default '{}'::jsonb,
  model text default '',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'error', 'canceled')),
  attempts integer not null default 0,
  result jsonb,
  error text,
  credits numeric(14, 4) not null default 0,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eski bazada bu jadval boshqa shaklda boʻlishi mumkin:
-- «create table if not exists» uni oʻtkazib yuboradi va keyingi indeks
-- yoki funksiya mavjud boʻlmagan ustunga urilib migratsiya toʻxtaydi.
-- Yetishmagan ustunlarni shu yerda toʻldiramiz.
alter table public.jobs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid,
  add column if not exists kind text,
  add column if not exists title text default '',
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists model text default '',
  add column if not exists status text default 'queued',
  add column if not exists attempts integer default 0,
  add column if not exists result jsonb,
  add column if not exists error text,
  add column if not exists credits numeric(14, 4) default 0,
  add column if not exists scheduled_at timestamptz default now(),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists jobs_queue on public.jobs (status, scheduled_at);
create index if not exists jobs_user on public.jobs (user_id, created_at desc);

create or replace trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- yangi foydalanuvchi

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admins jsonb;
  v_role text := 'user';
  v_plan public.plans%rowtype;
  v_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_first;
  select value into v_admins from public.app_settings where key = 'admin_emails';

  if v_first then
    v_role := 'admin';                      -- birinchi ro'yxatdan o'tgan — egasi
  elsif v_admins is not null and v_admins ? lower(coalesce(new.email, '')) then
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- reja/limit mantiqi

-- Foydalanuvchining amaldagi rejasi: faol obuna, bo'lmasa standart (bepul).
create or replace function public.active_plan(p_user uuid)
returns public.plans language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
begin
  select p.* into v_plan
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = p_user
    and s.status in ('active', 'trial')
    and (s.expires_at is null or s.expires_at > now())
    and p.is_active
  order by s.created_at desc
  limit 1;

  if v_plan.id is null then
    select * into v_plan from public.plans where is_default and is_active limit 1;
  end if;

  return v_plan;
end;
$$;

-- Davr tugagan bo'lsa kreditni yangilaydi (oylik grant).
create or replace function public.ensure_period(p_user uuid)
returns public.credit_balances language plpgsql security definer set search_path = public as $$
declare
  v_bal public.credit_balances%rowtype;
  v_plan public.plans%rowtype;
begin
  v_plan := public.active_plan(p_user);

  select * into v_bal from public.credit_balances where user_id = p_user for update;
  if not found then
    insert into public.credit_balances (user_id, balance, granted, period_start, period_end)
    values (p_user, coalesce(v_plan.credit_grant, 0), coalesce(v_plan.credit_grant, 0),
            now(), now() + interval '30 days')
    returning * into v_bal;
    return v_bal;
  end if;

  if v_bal.period_end <= now() then
    update public.credit_balances
    set balance = coalesce(v_plan.credit_grant, 0) + extra,
        granted = coalesce(v_plan.credit_grant, 0),
        used = 0,
        period_start = now(),
        period_end = now() + interval '30 days'
    where user_id = p_user
    returning * into v_bal;
  end if;

  return v_bal;
end;
$$;

-- Model ishlatilsa bo'ladimi? Gateway har chaqiruvdan oldin shuni so'raydi.
create or replace function public.can_use_model(p_user uuid, p_model text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_plan public.plans%rowtype;
  v_pm public.plan_models%rowtype;
  v_bal public.credit_balances%rowtype;
  v_today numeric;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'profil topilmadi');
  end if;
  if v_profile.blocked then
    return jsonb_build_object('allowed', false, 'reason', 'hisob bloklangan');
  end if;

  if coalesce((select value::text from public.app_settings where key = 'gateway_enabled'), 'true') = 'false' then
    return jsonb_build_object('allowed', false, 'reason', 'xizmat vaqtincha to''xtatilgan');
  end if;

  v_plan := public.active_plan(p_user);
  if v_plan.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'reja biriktirilmagan');
  end if;

  select * into v_pm from public.plan_models
  where plan_id = v_plan.id and model = p_model and enabled;
  if not found then
    return jsonb_build_object(
      'allowed', false,
      'reason', format('«%s» modeli «%s» rejasiga kirmagan', p_model, v_plan.name),
      'plan', v_plan.name
    );
  end if;

  v_bal := public.ensure_period(p_user);
  if v_bal.balance <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'kredit tugadi', 'balance', v_bal.balance);
  end if;

  if v_plan.daily_credit_cap is not null then
    select coalesce(sum(credits), 0) into v_today
    from public.usage_events
    where user_id = p_user and created_at >= date_trunc('day', now());
    if v_today >= v_plan.daily_credit_cap then
      return jsonb_build_object('allowed', false, 'reason', 'kunlik limit tugadi', 'today', v_today);
    end if;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'plan_id', v_plan.id,
    'plan', v_plan.name,
    'balance', v_bal.balance,
    'input_price', v_pm.input_credits_per_mtok,
    'output_price', v_pm.output_credits_per_mtok,
    'call_price', v_pm.call_credits
  );
end;
$$;

-- Sarflangan tokenni yozadi va kreditdan yechadi. Faqat service_role chaqiradi.
create or replace function public.charge_usage(
  p_user uuid,
  p_model text,
  p_kind text,
  p_input integer,
  p_output integer,
  p_source text default 'gateway',
  p_job uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
  v_pm public.plan_models%rowtype;
  v_in numeric;
  v_out numeric;
  v_call numeric := 0;
  v_credits numeric;
  v_bal public.credit_balances%rowtype;
  v_fallback jsonb;
begin
  v_plan := public.active_plan(p_user);
  select * into v_pm from public.plan_models
  where plan_id = v_plan.id and model = p_model;

  if found then
    v_in := v_pm.input_credits_per_mtok;
    v_out := v_pm.output_credits_per_mtok;
    v_call := v_pm.call_credits;
  else
    select value into v_fallback from public.app_settings where key = 'fallback_price';
    v_in := coalesce((v_fallback ->> 'input')::numeric, 30);
    v_out := coalesce((v_fallback ->> 'output')::numeric, 90);
  end if;

  v_credits := round(
    (coalesce(p_input, 0)::numeric / 1000000) * v_in +
    (coalesce(p_output, 0)::numeric / 1000000) * v_out +
    v_call,
    4
  );

  insert into public.usage_events (
    user_id, model, kind, source, input_tokens, output_tokens, total_tokens, credits, job_id, meta
  ) values (
    p_user, p_model, coalesce(p_kind, 'chat'), coalesce(p_source, 'gateway'),
    coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_input, 0) + coalesce(p_output, 0),
    v_credits, p_job, coalesce(p_meta, '{}'::jsonb)
  );

  if p_source <> 'byok' then
    update public.credit_balances
    set balance = balance - v_credits,
        used = used + v_credits
    where user_id = p_user
    returning * into v_bal;
  else
    select * into v_bal from public.credit_balances where user_id = p_user;
  end if;

  return jsonb_build_object('credits', v_credits, 'balance', coalesce(v_bal.balance, 0));
end;
$$;

revoke execute on function public.charge_usage(uuid, text, text, integer, integer, text, uuid, jsonb)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
--  Profilni kafolatlash.
--
--  `auth.users` da qator bor, `public.profiles` da yoʻq — bu real holat:
--  odam migratsiyalar ishga tushishidan OLDIN roʻyxatdan oʻtgan boʻlsa,
--  `handle_new_user()` triggeri hali mavjud emas edi. Natijada ilova
--  pochtani ham, rolni ham koʻrsatolmaydi («pochtasiz roʻyxatdan oʻtgan»).
--
--  Shuning uchun har kirishda profil bor-yoʻqligini tekshirib, kerak boʻlsa
--  oʻsha zahoti yaratamiz. Pochta JWT ichidan olinadi — `auth.users` ga
--  murojaat qilish shart emas.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_profile()
returns public.profiles language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_name text := '';
  v_admins jsonb;
  v_profile public.profiles%rowtype;
  v_plan public.plans%rowtype;
begin
  if v_user is null then
    return v_profile;
  end if;

  select * into v_profile from public.profiles where id = v_user;

  -- Pochta va ism: avval tokendan, boʻlmasa auth.users dan.
  begin
    v_email := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
    v_name  := coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '');
  exception when others then
    v_email := null;
  end;

  if v_email is null and to_regclass('auth.users') is not null then
    execute 'select u.email, coalesce(u.raw_user_meta_data ->> ''full_name'', '''') '
            'from auth.users u where u.id = $1'
      into v_email, v_name using v_user;
  end if;

  select value into v_admins from public.app_settings where key = 'admin_emails';

  if v_profile.id is null then
    insert into public.profiles (id, email, full_name, role)
    values (
      v_user,
      v_email,
      coalesce(v_name, ''),
      case when v_admins is not null and v_admins ? lower(coalesce(v_email, ''))
           then 'admin' else 'user' end
    )
    on conflict (id) do nothing;
    select * into v_profile from public.profiles where id = v_user;
  elsif coalesce(v_profile.email, '') = '' and v_email is not null then
    update public.profiles set email = v_email where id = v_user;
    v_profile.email := v_email;
  end if;

  -- Pochtasi egalik roʻyxatida boʻlsa — admin roli tiklanadi.
  if v_admins is not null
     and v_admins ? lower(coalesce(v_profile.email, ''))
     and coalesce(v_profile.role, 'user') <> 'admin' then
    update public.profiles set role = 'admin' where id = v_user;
    v_profile.role := 'admin';
  end if;

  -- Balans va obuna ham yetishmasa — standart rejani biriktiramiz.
  select * into v_plan from public.plans where is_default and is_active limit 1;
  if v_plan.id is not null then
    insert into public.credit_balances (user_id, balance, granted, period_start, period_end)
    values (
      v_user,
      coalesce(v_plan.credit_grant, 0),
      coalesce(v_plan.credit_grant, 0),
      now(),
      now() + interval '30 days'
    )
    on conflict (user_id) do nothing;

    if not exists (
      select 1 from public.subscriptions
       where user_id = v_user and status in ('active', 'trial')
    ) then
      insert into public.subscriptions (user_id, plan_id, status, note)
      values (v_user, v_plan.id, 'active', 'kirishda biriktirildi');
    end if;
  end if;

  return v_profile;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

-- Mijoz uchun bir so'rovda hamma narsa: profil, reja, kredit, modellar, sarf.
create or replace function public.my_account()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_plan public.plans%rowtype;
  v_sub public.subscriptions%rowtype;
  v_bal public.credit_balances%rowtype;
  v_models jsonb;
  v_today numeric;
  v_month numeric;
  v_jobs integer;
begin
  if v_user is null then
    return jsonb_build_object('signed_in', false);
  end if;

  -- Profil yoʻq boʻlsa shu yerda yaratiladi (eski hisoblar uchun).
  v_profile := public.ensure_profile();
  v_plan := public.active_plan(v_user);

  select * into v_sub from public.subscriptions
  where user_id = v_user and status in ('active', 'trial')
  order by created_at desc limit 1;

  select * into v_bal from public.credit_balances where user_id = v_user;

  select coalesce(jsonb_agg(jsonb_build_object(
    'model', pm.model,
    'role', pm.role,
    'input_price', pm.input_credits_per_mtok,
    'output_price', pm.output_credits_per_mtok,
    'call_price', pm.call_credits
  ) order by pm.role, pm.model), '[]'::jsonb)
  into v_models
  from public.plan_models pm
  where pm.plan_id = v_plan.id and pm.enabled;

  select coalesce(sum(credits), 0) into v_today
  from public.usage_events
  where user_id = v_user and created_at >= date_trunc('day', now());

  select coalesce(sum(credits), 0) into v_month
  from public.usage_events
  where user_id = v_user and created_at >= date_trunc('month', now());

  select count(*) into v_jobs from public.jobs
  where user_id = v_user and status in ('queued', 'running');

  return jsonb_build_object(
    'signed_in', true,
    'user_id', v_user,
    'email', v_profile.email,
    'full_name', v_profile.full_name,
    'is_admin', v_profile.role = 'admin',
    'blocked', v_profile.blocked,
    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id, 'code', v_plan.code, 'name', v_plan.name,
      'description', v_plan.description,
      'price_cents', v_plan.price_cents, 'currency', v_plan.currency,
      'period', v_plan.period,
      'credit_grant', v_plan.credit_grant,
      'daily_credit_cap', v_plan.daily_credit_cap,
      'allow_background', v_plan.allow_background,
      'max_queued_jobs', v_plan.max_queued_jobs,
      'max_jobs_per_day', v_plan.max_jobs_per_day,
      'features', v_plan.features
    ) end,
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'status', v_sub.status, 'started_at', v_sub.started_at, 'expires_at', v_sub.expires_at
    ) end,
    'balance', coalesce(v_bal.balance, 0),
    'granted', coalesce(v_bal.granted, 0),
    'used', coalesce(v_bal.used, 0),
    'period_end', v_bal.period_end,
    'models', v_models,
    'usage_today', v_today,
    'usage_month', v_month,
    'active_jobs', v_jobs
  );
end;
$$;

-- Fon vazifasini navbatga qo'yish (reja ruxsat bersa).
create or replace function public.enqueue_job(
  p_kind text,
  p_title text,
  p_payload jsonb,
  p_model text default null
) returns public.jobs language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_queued integer;
  v_today integer;
  v_job public.jobs%rowtype;
begin
  if v_user is null then
    raise exception 'avval tizimga kiring';
  end if;

  v_plan := public.active_plan(v_user);
  if v_plan.id is null or not v_plan.allow_background then
    raise exception 'fon vazifalari obunada ochiladi';
  end if;

  select count(*) into v_queued from public.jobs
  where user_id = v_user and status in ('queued', 'running');
  if v_queued >= v_plan.max_queued_jobs then
    raise exception 'navbatda ko''p vazifa bor (limit: %)', v_plan.max_queued_jobs;
  end if;

  select count(*) into v_today from public.jobs
  where user_id = v_user and created_at >= date_trunc('day', now());
  if v_plan.max_jobs_per_day > 0 and v_today >= v_plan.max_jobs_per_day then
    raise exception 'kunlik vazifa limiti tugadi (%)', v_plan.max_jobs_per_day;
  end if;

  insert into public.jobs (user_id, kind, title, payload, model)
  values (v_user, p_kind, coalesce(p_title, ''), coalesce(p_payload, '{}'::jsonb), p_model)
  returning * into v_job;

  return v_job;
end;
$$;

-- Ishchi (jobs-worker) navbatdan vazifa oladi. Faqat service_role.
create or replace function public.claim_jobs(p_limit integer default 3)
returns setof public.jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from public.jobs
    where status = 'queued' and scheduled_at <= now() and attempts < 3
    order by scheduled_at
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.jobs j
  set status = 'running', started_at = now(), attempts = j.attempts + 1
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

revoke execute on function public.claim_jobs(integer) from anon, authenticated;

-- ---------------------------------------------------------------- admin RPC

create or replace function public.admin_grant_plan(
  p_user uuid,
  p_plan uuid,
  p_days integer default 30,
  p_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;
  select * into v_plan from public.plans where id = p_plan;
  if not found then raise exception 'reja topilmadi'; end if;

  update public.subscriptions set status = 'canceled'
  where user_id = p_user and status in ('active', 'trial');

  insert into public.subscriptions (user_id, plan_id, status, expires_at, note, granted_by)
  values (
    p_user, p_plan, 'active',
    case when p_days is null or p_days <= 0 then null else now() + make_interval(days => p_days) end,
    coalesce(p_note, ''), auth.uid()
  );

  -- Yangi reja krediti darhol beriladi.
  insert into public.credit_balances (user_id, balance, granted, period_start, period_end)
  values (p_user, v_plan.credit_grant, v_plan.credit_grant, now(), now() + interval '30 days')
  on conflict (user_id) do update
  set balance = v_plan.credit_grant + credit_balances.extra,
      granted = v_plan.credit_grant,
      used = 0,
      period_start = now(),
      period_end = now() + interval '30 days';

  return jsonb_build_object('ok', true, 'plan', v_plan.name);
end;
$$;

create or replace function public.admin_add_credits(
  p_user uuid, p_amount numeric, p_note text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bal public.credit_balances%rowtype;
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;

  insert into public.credit_balances (user_id, balance, extra)
  values (p_user, p_amount, greatest(p_amount, 0))
  on conflict (user_id) do update
  set balance = credit_balances.balance + p_amount,
      extra = credit_balances.extra + greatest(p_amount, 0)
  returning * into v_bal;

  insert into public.usage_events (user_id, model, kind, source, credits, meta)
  values (p_user, '', 'grant', 'admin', -p_amount, jsonb_build_object('note', coalesce(p_note, '')));

  return jsonb_build_object('ok', true, 'balance', v_bal.balance);
end;
$$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;
  if p_role not in ('user', 'admin') then raise exception 'noto''g''ri rol'; end if;
  update public.profiles set role = p_role where id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_blocked(p_user uuid, p_blocked boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;
  update public.profiles set blocked = coalesce(p_blocked, false) where id = p_user;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_decide_request(p_request uuid, p_approve boolean, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req public.purchase_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;
  select * into v_req from public.purchase_requests where id = p_request;
  if not found then raise exception 'so''rov topilmadi'; end if;

  update public.purchase_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now()
  where id = p_request;

  if p_approve then
    perform public.admin_grant_plan(v_req.user_id, v_req.plan_id, p_days, 'so''rov tasdiqlandi');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb;
begin
  if not public.is_admin() then raise exception 'ruxsat yo''q'; end if;

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active_subs', (select count(*) from public.subscriptions
                    where status in ('active', 'trial')
                      and (expires_at is null or expires_at > now())),
    'paid_subs', (select count(*) from public.subscriptions s
                  join public.plans p on p.id = s.plan_id
                  where s.status in ('active', 'trial') and p.price_cents > 0
                    and (s.expires_at is null or s.expires_at > now())),
    'mrr_cents', (select coalesce(sum(p.price_cents), 0) from public.subscriptions s
                  join public.plans p on p.id = s.plan_id
                  where s.status in ('active', 'trial') and p.period = 'monthly'
                    and (s.expires_at is null or s.expires_at > now())),
    'tokens_today', (select coalesce(sum(total_tokens), 0) from public.usage_events
                     where created_at >= date_trunc('day', now())),
    'tokens_month', (select coalesce(sum(total_tokens), 0) from public.usage_events
                     where created_at >= date_trunc('month', now())),
    'credits_today', (select coalesce(sum(credits), 0) from public.usage_events
                      where created_at >= date_trunc('day', now()) and source <> 'admin'),
    'credits_month', (select coalesce(sum(credits), 0) from public.usage_events
                      where created_at >= date_trunc('month', now()) and source <> 'admin'),
    'jobs_queued', (select count(*) from public.jobs where status in ('queued', 'running')),
    'pending_requests', (select count(*) from public.purchase_requests where status = 'pending'),
    'top_models', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select model, sum(total_tokens) as tokens, sum(credits) as credits, count(*) as calls
        from public.usage_events
        where created_at >= date_trunc('month', now()) and model <> ''
        group by model order by sum(total_tokens) desc limit 8
      ) t
    )
  ) into v_out;

  return v_out;
end;
$$;

-- Admin uchun foydalanuvchilar ko'rinishi (RLS chaqiruvchi huquqi bilan ishlaydi).
create or replace view public.user_overview
with (security_invoker = true) as
select
  p.id,
  p.email,
  p.full_name,
  p.role,
  p.blocked,
  p.created_at,
  pl.name as plan_name,
  pl.code as plan_code,
  s.status as sub_status,
  s.expires_at,
  b.balance,
  b.used,
  b.period_end,
  (select coalesce(sum(u.total_tokens), 0) from public.usage_events u
   where u.user_id = p.id and u.created_at >= date_trunc('month', now())) as tokens_month,
  (select coalesce(sum(u.credits), 0) from public.usage_events u
   where u.user_id = p.id and u.created_at >= date_trunc('month', now()) and u.source <> 'admin')
   as credits_month
from public.profiles p
left join public.subscriptions s
  on s.user_id = p.id and s.status in ('active', 'trial')
left join public.plans pl on pl.id = s.plan_id
left join public.credit_balances b on b.user_id = p.id;

-- ---------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.plan_models enable row level security;
alter table public.subscriptions enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.credit_balances enable row level security;
alter table public.usage_events enable row level security;
alter table public.sync_items enable row level security;
alter table public.jobs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);
drop policy if exists plans_admin on public.plans;
create policy plans_admin on public.plans for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists plan_models_read on public.plan_models;
create policy plan_models_read on public.plan_models for select using (true);
drop policy if exists plan_models_admin on public.plan_models;
create policy plan_models_admin on public.plan_models for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists subs_read on public.subscriptions;
create policy subs_read on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists subs_admin on public.subscriptions;
create policy subs_admin on public.subscriptions for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists requests_read on public.purchase_requests;
create policy requests_read on public.purchase_requests for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists requests_insert on public.purchase_requests;
create policy requests_insert on public.purchase_requests for insert
  with check (user_id = auth.uid());
drop policy if exists requests_admin on public.purchase_requests;
create policy requests_admin on public.purchase_requests for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists balances_read on public.credit_balances;
create policy balances_read on public.credit_balances for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists usage_read on public.usage_events;
create policy usage_read on public.usage_events for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists sync_own on public.sync_items;
create policy sync_own on public.sync_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists jobs_cancel on public.jobs;
create policy jobs_cancel on public.jobs for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists jobs_delete on public.jobs;
create policy jobs_delete on public.jobs for delete
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select using (true);
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- Realtime: fon vazifasi natijasi darhol ko'rinsin.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs;
  end if;
exception when duplicate_object then null;
end $$;

-- Oddiy foydalanuvchi o'z rolini yoki blok holatini o'zgartira olmaydi.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.blocked := old.blocked;
  end if;
  return new;
end;
$$;

create or replace trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Gateway uchun: foydalanuvchi rejasida ochiq modellar ro'yxati.
create or replace function public.allowed_models(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
  v_out jsonb;
begin
  v_plan := public.active_plan(p_user);
  if v_plan.id is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'model', model, 'role', role,
    'input_price', input_credits_per_mtok,
    'output_price', output_credits_per_mtok,
    'call_price', call_credits
  )), '[]'::jsonb)
  into v_out
  from public.plan_models where plan_id = v_plan.id and enabled;

  return v_out;
end;
$$;

revoke execute on function public.allowed_models(uuid) from anon;

-- ---------------------------------------------------------------- huquqlar
-- PostgREST orqali kelgan so'rov `authenticated` roli bilan bajariladi;
-- qaysi satrni ko'rish/o'zgartirishni yuqoridagi RLS qoidalari hal qiladi.
-- Admin amallari ham shu rol bilan ketadi — shuning uchun yozish huquqi
-- berilgan, lekin RLS `is_admin()` ni talab qiladi.

grant usage on schema public to anon, authenticated;

grant select on
  public.plans, public.plan_models, public.app_settings
  to anon, authenticated;

grant select on
  public.profiles, public.subscriptions, public.credit_balances,
  public.usage_events, public.purchase_requests, public.user_overview
  to authenticated;

grant insert, update, delete on
  public.plans, public.plan_models, public.subscriptions,
  public.app_settings, public.profiles, public.purchase_requests
  to authenticated;

grant select, insert, update, delete on public.sync_items to authenticated;
grant select, update, delete on public.jobs to authenticated;

-- ==========================================================================
--  20260819000100_daho_seed_plans.sql
-- ==========================================================================

-- Boshlang'ich rejalar va model narxlari.
-- Narxlar «1 million token = N kredit» ko'rinishida. Admin panelidan
-- istalgan vaqtda o'zgartiriladi — bu yerdagilar faqat boshlang'ich qiymat.

insert into public.plans
  (code, name, description, price_cents, currency, period, credit_grant,
   daily_credit_cap, max_queued_jobs, max_jobs_per_day, allow_background,
   is_default, is_active, sort)
values
  ('free', 'Bepul', 'Sinash uchun. Kunlik kichik limit, fon vazifalari yo''q.',
   0, 'UZS', 'free', 2000, 200, 0, 0, false, true, true, 0),
  ('start', 'Start', 'Kundalik o''qish uchun. Chat, rasm va kurslar.',
   39000, 'UZS', 'monthly', 30000, null, 3, 20, true, false, true, 10),
  ('pro', 'Pro', 'Daho Code, video studiya va fon vazifalari to''liq.',
   99000, 'UZS', 'monthly', 120000, null, 10, 100, true, false, true, 20)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
--  Model narxlari BU YERDA URUG' QILINMAYDI
--
--  Ilgari shu joyda Gemini nomlari qo'lda yozilgan edi. Model nomi
--  eskiradi, qo'lda yozilgan narx esa haqiqiy tannarxga bog'lanmagan —
--  natijada admin panelida «provayderi noma'lum» qatorlar to'planardi.
--
--  To'g'ri manba `ai_models` katalogi: admin OpenRouter'ning jonli
--  ro'yxatidan model tanlaydi (tannarxi ko'rinib turadi), so'ng uni
--  `admin_attach_model` bilan tariflarga biriktiradi. Shuning uchun
--  boshlang'ich holatda hech qanday model bog'lanmaydi — panel buni
--  ochiq aytadi va «Tez sozlash» tugmasini taklif qiladi.
-- ---------------------------------------------------------------------------

-- ==========================================================================
--  20260821120000_telegram_jobs.sql
-- ==========================================================================

-- Telegram xabarlarini KEYINGA rejalashtirish.
--
-- `jobs` da `scheduled_at` allaqachon bor va `claim_jobs` uni hisobga
-- oladi, lekin `telegram` turi ruxsat etilgan roʻyxatda yoʻq edi —
-- shuning uchun rejalashtirilgan xabar navbatga tusha olmasdi.
--
-- `kitob` ham shu roʻyxatda yoʻq edi, holbuki server uni bajara oladi:
-- bu eskidan qolgan kamchilik, birga tuzatiladi.

alter table public.jobs drop constraint if exists jobs_kind_check;

alter table public.jobs
  add constraint jobs_kind_check
  check (kind in ('chat', 'search', 'json', 'image', 'plan', 'kitob', 'telegram'));

-- ---------------------------------------------------------------- token

-- Rejalashtirilgan xabarni server yuboradi, demak bot tokeni serverga
-- kerak. Uni vazifa ichida saqlash notoʻgʻri boʻlardi: vazifa natijasi
-- koʻrsatiladi va tarixda qoladi. Shuning uchun alohida jadval — har
-- kim faqat oʻzinikini koʻradi, server esa service_role bilan oʻqiydi.
create table if not exists public.bot_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('telegram')),
  token text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.bot_tokens enable row level security;

drop policy if exists bot_tokens_own on public.bot_tokens;
create policy bot_tokens_own on public.bot_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- RLS siyosati yetarli emas: jadvalning oʻziga ham ruxsat kerak,
-- aks holda «permission denied» chiqadi.
grant select, insert, update, delete on public.bot_tokens to authenticated;

-- --------------------------------------------------------- rejalashtirish

-- Eski imzoni olib tashlaymiz: yangisiga qoʻshimcha parametr qoʻshilsa
-- ikkalasi qolib, chaqiruv ikki maʼnoli boʻlib qolardi.
drop function if exists public.enqueue_job(text, text, jsonb, text);

create or replace function public.enqueue_job(
  p_kind text,
  p_title text,
  p_payload jsonb,
  p_model text default null,
  p_scheduled_at timestamptz default now()
) returns public.jobs language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_queued integer;
  v_today integer;
  v_job public.jobs%rowtype;
begin
  if v_user is null then
    raise exception 'avval tizimga kiring';
  end if;

  v_plan := public.active_plan(v_user);
  if v_plan.id is null or not v_plan.allow_background then
    raise exception 'fon vazifalari obunada ochiladi';
  end if;

  select count(*) into v_queued from public.jobs
  where user_id = v_user and status in ('queued', 'running');
  if v_queued >= v_plan.max_queued_jobs then
    raise exception 'navbatda ko''p vazifa bor (limit: %)', v_plan.max_queued_jobs;
  end if;

  select count(*) into v_today from public.jobs
  where user_id = v_user and created_at >= date_trunc('day', now());
  if v_plan.max_jobs_per_day > 0 and v_today >= v_plan.max_jobs_per_day then
    raise exception 'bugungi vazifa chegarasi tugadi (limit: %)', v_plan.max_jobs_per_day;
  end if;

  insert into public.jobs (user_id, kind, title, payload, model, scheduled_at)
  values (
    v_user,
    p_kind,
    coalesce(p_title, ''),
    coalesce(p_payload, '{}'::jsonb),
    nullif(p_model, ''),
    -- Oʻtmishdagi vaqt berilsa darhol bajariladi.
    greatest(coalesce(p_scheduled_at, now()), now() - interval '1 minute')
  )
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function public.enqueue_job(text, text, jsonb, text, timestamptz)
  to authenticated;

-- ==========================================================================
--  20260822090000_admin_access.sql
-- ==========================================================================

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

-- ==========================================================================
--  20260822091000_limits_and_payg.sql
-- ==========================================================================

-- ============================================================================
--  Obuna aqli: foizli limitlar, pay-as-you-go va bepul zaxira model
--
--  Foydalanuvchiga token soni koʻrsatilmaydi. U «haftalik limitning 64% i
--  qoldi» degan tushunarli raqamni koʻradi. Limit tugaganda ish toʻxtamaydi:
--  yoki hisobidagi puldan yechiladi (pay-as-you-go), yoki bepul, lekin
--  sekinroq «Daho Daily» modeliga oʻtadi.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  1. Rejaga oyna-limitlari
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists hourly_credit_cap  numeric(14, 2),
  add column if not exists weekly_credit_cap  numeric(14, 2),
  -- Limit tugaganda nima boʻladi
  add column if not exists allow_payg         boolean not null default true,
  add column if not exists daily_model_access text not null default 'limited'
    check (daily_model_access in ('none', 'limited', 'unlimited')),
  -- Bepul zaxira modeldan kuniga nechta xabar (limited uchun)
  add column if not exists daily_model_quota  integer not null default 30;

comment on column public.plans.hourly_credit_cap is
  'Soatiga sarflanadigan kredit chegarasi. null — cheklovsiz.';
comment on column public.plans.daily_model_access is
  'Limit tugagach bepul «Daho Daily» modeli: yoʻq / cheklangan / cheksiz.';

-- ---------------------------------------------------------------------------
--  2. Hisobdagi pul — pay-as-you-go uchun
--
--  Kredit (obuna bilan beriladi, har davrda kuyadi) va pul (foydalanuvchi
--  toʻlagan, kuymaydi) — bu ikki xil narsa, shuning uchun alohida turadi.
-- ---------------------------------------------------------------------------
alter table public.credit_balances
  add column if not exists wallet numeric(14, 2) not null default 0;

comment on column public.credit_balances.wallet is
  'Pay-as-you-go hamyoni. Obuna krediti tugagach shundan yechiladi; '
  'davr almashganda kuymaydi.';

create table if not exists public.wallet_events (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14, 2) not null,          -- + toʻldirish, − sarf
  reason text not null default '',
  admin_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists wallet_events_user_idx
  on public.wallet_events(user_id, created_at desc);

alter table public.wallet_events enable row level security;

drop policy if exists wallet_events_read on public.wallet_events;
create policy wallet_events_read on public.wallet_events
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
--  3. Bepul zaxira modeldan foydalanish hisobi
-- ---------------------------------------------------------------------------
create table if not exists public.daily_model_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0,
  primary key (user_id, day)
);

alter table public.daily_model_usage enable row level security;

drop policy if exists daily_usage_read on public.daily_model_usage;
create policy daily_usage_read on public.daily_model_usage
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
--  4. Oynalar boʻyicha sarf — foizli koʻrsatkich uchun
-- ---------------------------------------------------------------------------

-- Bitta oynaning holati. Chegara yoʻq boʻlsa — cheksiz.
create or replace function public.window_state(p_used numeric, p_cap numeric)
returns jsonb language sql immutable as $$
  select case
    when p_cap is null or p_cap <= 0 then
      jsonb_build_object('unlimited', true, 'left_percent', 100)
    else jsonb_build_object(
      'unlimited', false,
      'left_percent', greatest(0, least(100,
        round((1 - coalesce(p_used, 0) / p_cap) * 100)::int
      ))
    )
  end;
$$;

create or replace function public.usage_windows(p_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
  v_bal public.credit_balances%rowtype;
  v_hour numeric;
  v_day numeric;
  v_week numeric;
  v_daily_calls integer;
begin
  v_plan := public.active_plan(p_user);
  select * into v_bal from public.credit_balances where user_id = p_user;

  select coalesce(sum(credits), 0) into v_hour from public.usage_events
   where user_id = p_user and created_at >= now() - interval '1 hour';
  select coalesce(sum(credits), 0) into v_day from public.usage_events
   where user_id = p_user and created_at >= date_trunc('day', now());
  select coalesce(sum(credits), 0) into v_week from public.usage_events
   where user_id = p_user and created_at >= date_trunc('week', now());

  select coalesce(calls, 0) into v_daily_calls
    from public.daily_model_usage
   where user_id = p_user and day = current_date;

  return jsonb_build_object(
    'plan',   v_plan.code,
    -- Har bir oyna: sarflangan, chegara va QOLGAN FOIZ.
    'hour',   public.window_state(v_hour, v_plan.hourly_credit_cap),
    'day',    public.window_state(v_day,  v_plan.daily_credit_cap),
    'week',   public.window_state(v_week, v_plan.weekly_credit_cap),
    'period', public.window_state(
                coalesce(v_bal.granted, 0) - coalesce(v_bal.balance, 0),
                nullif(coalesce(v_bal.granted, 0), 0)
              ),
    'wallet',       coalesce(v_bal.wallet, 0),
    'allow_payg',   coalesce(v_plan.allow_payg, true),
    'daily_model',  jsonb_build_object(
      'access', coalesce(v_plan.daily_model_access, 'limited'),
      'used',   coalesce(v_daily_calls, 0),
      'quota',  coalesce(v_plan.daily_model_quota, 30)
    ),
    'period_end', v_bal.period_end
  );
end;
$$;

grant execute on function public.usage_windows(uuid) to authenticated;
grant execute on function public.window_state(numeric, numeric) to authenticated;

-- ==========================================================================
--  20260822092000_gateway_fallback.sql
-- ==========================================================================

-- ============================================================================
--  Limit tugaganda ish toʻxtamasin
--
--  Avval kredit tugashi bilan «kredit tugadi» deb rad javob berilardi.
--  Endi uch bosqich:
--    1. Obuna krediti bor       → oʻshandan yechiladi
--    2. Hisobda pul bor         → pay-as-you-go, hamyondan yechiladi
--    3. Ikkalasi ham yoʻq       → bepul «Daho Daily» modeliga oʻtiladi
--                                  (Pro da cheksiz, oddiy rejada kunlik son)
-- ============================================================================

-- Bepul zaxira modelning nomi sozlamada turadi — admin istagancha almashtiradi.
insert into public.app_settings (key, value)
-- Boshlang'ich holatda model YO'Q: nom qo'lda yozilsa eskirib qoladi.
-- Admin katalogdan model tanlagach shu yerga uning slug'i yoziladi.
values ('daily_model', '{"model": "", "label": "Daho Daily"}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
--  can_use_model — endi zaxira yoʻlni ham qaytaradi
-- ---------------------------------------------------------------------------
create or replace function public.can_use_model(p_user uuid, p_model text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_plan public.plans%rowtype;
  v_pm public.plan_models%rowtype;
  v_bal public.credit_balances%rowtype;
  v_today numeric;
  v_hour numeric;
  v_week numeric;
  v_daily jsonb;
  v_daily_model text;
  v_daily_used integer;

  -- Limit tugagach nima taklif qilamiz.
  v_note text;
begin
  select * into v_profile from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'profil topilmadi');
  end if;
  if v_profile.blocked then
    return jsonb_build_object('allowed', false, 'reason', 'hisob bloklangan');
  end if;

  if coalesce((select value::text from public.app_settings where key = 'gateway_enabled'), 'true') = 'false' then
    return jsonb_build_object('allowed', false, 'reason', 'xizmat vaqtincha toʻxtatilgan');
  end if;

  v_plan := public.active_plan(p_user);
  if v_plan.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'reja biriktirilmagan');
  end if;

  select value into v_daily from public.app_settings where key = 'daily_model';
  v_daily_model := coalesce(v_daily ->> 'model', '');

  select * into v_pm from public.plan_models
  where plan_id = v_plan.id and model = p_model and enabled;

  -- Model rejaga kirmagan boʻlsa — zaxira model bilan ishlashni taklif qilamiz.
  if not found then
    if v_daily_model <> '' and p_model <> v_daily_model
       and coalesce(v_plan.daily_model_access, 'limited') <> 'none' then
      return public.daily_fallback(
        p_user, v_plan, v_daily,
        format('«%s» modeli rejangizga kirmagan', p_model)
      );
    end if;
    return jsonb_build_object(
      'allowed', false,
      'reason', format('«%s» modeli «%s» rejasiga kirmagan', p_model, v_plan.name),
      'plan', v_plan.name
    );
  end if;

  v_bal := public.ensure_period(p_user);

  -- Oyna limitlari.
  select coalesce(sum(credits), 0) into v_today from public.usage_events
   where user_id = p_user and created_at >= date_trunc('day', now());
  select coalesce(sum(credits), 0) into v_hour from public.usage_events
   where user_id = p_user and created_at >= now() - interval '1 hour';
  select coalesce(sum(credits), 0) into v_week from public.usage_events
   where user_id = p_user and created_at >= date_trunc('week', now());

  v_note := '';
  if v_plan.hourly_credit_cap is not null and v_hour >= v_plan.hourly_credit_cap then
    v_note := 'soatlik limit tugadi';
  elsif v_plan.daily_credit_cap is not null and v_today >= v_plan.daily_credit_cap then
    v_note := 'kunlik limit tugadi';
  elsif v_plan.weekly_credit_cap is not null and v_week >= v_plan.weekly_credit_cap then
    v_note := 'haftalik limit tugadi';
  elsif v_bal.balance <= 0 then
    v_note := 'obuna krediti tugadi';
  end if;

  if v_note <> '' then
    -- 2-bosqich: hisobdagi pul.
    if coalesce(v_bal.wallet, 0) > 0 and coalesce(v_plan.allow_payg, true) then
      return jsonb_build_object(
        'allowed', true,
        'source', 'wallet',
        'note', v_note || ' — hisobingizdagi puldan yechilmoqda',
        'plan_id', v_plan.id,
        'plan', v_plan.name,
        'wallet', v_bal.wallet,
        'input_price', v_pm.input_credits_per_mtok,
        'output_price', v_pm.output_credits_per_mtok,
        'call_price', v_pm.call_credits
      );
    end if;

    -- 3-bosqich: bepul zaxira model.
    if v_daily_model <> '' and coalesce(v_plan.daily_model_access, 'limited') <> 'none' then
      return public.daily_fallback(p_user, v_plan, v_daily, v_note);
    end if;

    return jsonb_build_object('allowed', false, 'reason', v_note);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'source', 'plan',
    'plan_id', v_plan.id,
    'plan', v_plan.name,
    'balance', v_bal.balance,
    'input_price', v_pm.input_credits_per_mtok,
    'output_price', v_pm.output_credits_per_mtok,
    'call_price', v_pm.call_credits
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  Bepul zaxira modelga oʻtish
-- ---------------------------------------------------------------------------
create or replace function public.daily_fallback(
  p_user uuid,
  p_plan public.plans,
  p_daily jsonb,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_used integer;
  v_model text := coalesce(p_daily ->> 'model', '');
  v_label text := coalesce(p_daily ->> 'label', 'Daho Daily');
begin
  if v_model = '' then
    return jsonb_build_object('allowed', false, 'reason', p_reason);
  end if;

  if coalesce(p_plan.daily_model_access, 'limited') = 'unlimited' then
    return jsonb_build_object(
      'allowed', true,
      'source', 'daily',
      'use_model', v_model,
      'note', format('%s — %s modeliga oʻtildi (cheksiz, lekin sekinroq)', p_reason, v_label)
    );
  end if;

  select coalesce(calls, 0) into v_used
    from public.daily_model_usage where user_id = p_user and day = current_date;

  if coalesce(v_used, 0) >= coalesce(p_plan.daily_model_quota, 30) then
    return jsonb_build_object(
      'allowed', false,
      'reason', format('%s va bugungi bepul xabarlar ham tugadi', p_reason)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'source', 'daily',
    'use_model', v_model,
    'note', format('%s — %s modeliga oʻtildi', p_reason, v_label),
    'daily_left', coalesce(p_plan.daily_model_quota, 30) - coalesce(v_used, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  charge_usage — hamyondan yechish va bepul model hisobi
-- ---------------------------------------------------------------------------
create or replace function public.charge_source(
  p_user uuid,
  p_source text,
  p_credits numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_source = 'daily' then
    -- Bepul model: kredit yechilmaydi, faqat kunlik son oshadi.
    insert into public.daily_model_usage (user_id, day, calls)
    values (p_user, current_date, 1)
    on conflict (user_id, day) do update set calls = public.daily_model_usage.calls + 1;
    return;
  end if;

  if p_source = 'wallet' then
    update public.credit_balances
       set wallet = greatest(wallet - p_credits, 0)
     where user_id = p_user;

    insert into public.wallet_events (user_id, amount, reason)
    values (p_user, -p_credits, 'pay-as-you-go');
    return;
  end if;

  -- Odatiy yoʻl: obuna kreditidan.
  update public.credit_balances
     set balance = greatest(balance - p_credits, 0)
   where user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
--  Admin: hisobga pul tushirish
-- ---------------------------------------------------------------------------
create or replace function public.admin_add_wallet(
  p_user uuid,
  p_amount numeric,
  p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ruxsat yoʻq'; end if;

  insert into public.credit_balances (user_id, wallet)
  values (p_user, p_amount)
  on conflict (user_id) do update set wallet = public.credit_balances.wallet + p_amount;

  insert into public.wallet_events (user_id, amount, reason, admin_id)
  values (p_user, p_amount, coalesce(nullif(p_reason, ''), 'admin toʻldirdi'), auth.uid());

  return jsonb_build_object(
    'ok', true,
    'wallet', (select wallet from public.credit_balances where user_id = p_user)
  );
end;
$$;

grant execute on function public.admin_add_wallet(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
--  charge_usage — sarf qaysi manbadan yechilishini biladi
--
--  `p_source` endi ikki vazifani bajaradi: sarf qayerdan kelgani (gateway,
--  byok) va qaysi hamyondan yechilishi (plan, wallet, daily).
-- ---------------------------------------------------------------------------
create or replace function public.charge_usage(
  p_user uuid,
  p_model text,
  p_kind text,
  p_input integer,
  p_output integer,
  p_source text default 'gateway',
  p_job uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
  v_pm public.plan_models%rowtype;
  v_in numeric;
  v_out numeric;
  v_call numeric := 0;
  v_credits numeric;
  v_bal public.credit_balances%rowtype;
  v_fallback jsonb;
  -- Meta ichida qaysi hamyondan yechish kerakligi keladi.
  v_wallet text := coalesce(p_meta ->> 'charge_source', 'plan');
begin
  v_plan := public.active_plan(p_user);
  select * into v_pm from public.plan_models
  where plan_id = v_plan.id and model = p_model;

  if found then
    v_in := v_pm.input_credits_per_mtok;
    v_out := v_pm.output_credits_per_mtok;
    v_call := v_pm.call_credits;
  else
    select value into v_fallback from public.app_settings where key = 'fallback_price';
    v_in := coalesce((v_fallback ->> 'input')::numeric, 30);
    v_out := coalesce((v_fallback ->> 'output')::numeric, 90);
  end if;

  v_credits := round(
    (coalesce(p_input, 0)::numeric / 1000000) * v_in +
    (coalesce(p_output, 0)::numeric / 1000000) * v_out +
    v_call,
    4
  );

  insert into public.usage_events (
    user_id, model, kind, source, input_tokens, output_tokens, total_tokens, credits, job_id, meta
  ) values (
    p_user, p_model, coalesce(p_kind, 'chat'), coalesce(p_source, 'gateway'),
    coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_input, 0) + coalesce(p_output, 0),
    -- Bepul zaxira model limitni yemaydi, shuning uchun sarfi 0 yoziladi.
    case when v_wallet = 'daily' then 0 else v_credits end,
    p_job, coalesce(p_meta, '{}'::jsonb)
  );

  -- Oʻz kaliti bilan ishlaganda hech narsa yechilmaydi.
  if coalesce(p_source, '') <> 'byok' then
    perform public.charge_source(p_user, v_wallet, v_credits);
    if v_wallet <> 'daily' then
      update public.credit_balances set used = used + v_credits where user_id = p_user;
    end if;
  end if;

  select * into v_bal from public.credit_balances where user_id = p_user;

  return jsonb_build_object(
    'credits', case when v_wallet = 'daily' then 0 else v_credits end,
    'balance', coalesce(v_bal.balance, 0),
    'wallet', coalesce(v_bal.wallet, 0),
    'source', v_wallet
  );
end;
$$;

revoke execute on function public.charge_usage(uuid, text, text, integer, integer, text, uuid, jsonb)
  from anon, authenticated;

-- ==========================================================================
--  20260822093000_settings_privacy.sql
-- ==========================================================================

-- ============================================================================
--  app_settings: ichki sozlamalar hammaga koʻrinib turgan edi
--
--  `settings_read ... using (true)` — yaʼni istalgan roʻyxatdan oʻtgan
--  foydalanuvchi (va anon kalit bilan istalgan odam) `admin_emails`,
--  `daily_model`, `fallback_price` kabi ichki qiymatlarni oʻqiy olardi.
--  `admin_emails` esa kim admin ekanini oshkor qiladi — bu hujum uchun
--  birinchi qadam.
--
--  Endi faqat ataylab ochiq deb belgilangan kalitlar koʻrinadi.
-- ============================================================================

drop policy if exists settings_read on public.app_settings;

create policy settings_read on public.app_settings
  for select using (
    key like 'public.%'                        -- ataylab ochiq qilinganlar
    or key in ('contact', 'downloads')         -- aloqa va yuklab olish havolalari
    or public.is_admin()
  );

comment on table public.app_settings is
  'Ichki sozlamalar. Ochiq koʻrsatish kerak boʻlsa kalit nomini '
  '«public.» bilan boshlang, aks holda faqat admin koʻradi.';

-- Aloqa maʼlumotlari — bosh sahifa va «obuna sotib olish» uchun.
insert into public.app_settings (key, value) values
  ('contact', jsonb_build_object(
     'telegram', '',
     'phone', '',
     'email', ''
   )),
  ('downloads', jsonb_build_object('apk', '', 'extension', ''))
on conflict (key) do nothing;

-- ==========================================================================
--  20260822094000_repair_data.sql
-- ==========================================================================

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

-- ==========================================================================
--  20260823090000_model_catalog.sql
-- ==========================================================================

-- ============================================================================
--  Model katalogi — Daho nomlari va haqiqiy provayderlar
--
--  Foydalanuvchi «Dahonator» ni koʻradi. Uning ortida OpenRouter dagi
--  `moonshotai/kimi-k2` yoki Google dagi `gemini-3-flash` turadi. Admin bu
--  bogʻlanishni panelda oʻzi qiladi: katalogdan modelni tanlaydi, nom
--  beradi, ustama qoʻyadi — narx oʻzi hisoblanadi.
--
--  Nega alohida jadval: `plan_models` faqat «qaysi rejaga qaysi model
--  ochiq» degan savolga javob beradi. Modelning OʻZI kim ekani (provayder,
--  tannarx, tool qoʻllaydimi, rasm koʻradimi) rejadan mustaqil.
-- ============================================================================

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  -- Ilova va `plan_models.model` shu qiymatni ishlatadi.
  slug text not null unique,
  label text not null default '',
  description text not null default '',
  -- 'openrouter' | 'google'
  provider text not null default 'openrouter',
  -- Provayderdagi haqiqiy nom: 'openai/gpt-4o-mini', 'gemini-3-flash'
  upstream text not null default '',
  role text not null default 'chat',
  -- Tannarx: provayder soʻraydigan pul, USD / 1M token. Faqat admin koʻradi.
  cost_input_usd numeric(12, 6) not null default 0,
  cost_output_usd numeric(12, 6) not null default 0,
  -- Sotuv narxi: kredit / 1M token. `plan_models` boʻsh boʻlsa shu ishlaydi.
  input_credits_per_mtok numeric(12, 4) not null default 0,
  output_credits_per_mtok numeric(12, 4) not null default 0,
  call_credits numeric(12, 4) not null default 0,
  supports_tools boolean not null default true,
  supports_vision boolean not null default false,
  supports_stream boolean not null default true,
  context_tokens integer not null default 0,
  enabled boolean not null default true,
  -- Bepul «Daho Daily» modeli shu bayroq bilan belgilanadi.
  is_daily boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_models
  add column if not exists slug text,
  add column if not exists label text default '',
  add column if not exists description text default '',
  add column if not exists provider text default 'openrouter',
  add column if not exists upstream text default '',
  add column if not exists role text default 'chat',
  add column if not exists cost_input_usd numeric(12, 6) default 0,
  add column if not exists cost_output_usd numeric(12, 6) default 0,
  add column if not exists input_credits_per_mtok numeric(12, 4) default 0,
  add column if not exists output_credits_per_mtok numeric(12, 4) default 0,
  add column if not exists call_credits numeric(12, 4) default 0,
  add column if not exists supports_tools boolean default true,
  add column if not exists supports_vision boolean default false,
  add column if not exists supports_stream boolean default true,
  add column if not exists context_tokens integer default 0,
  add column if not exists enabled boolean default true,
  add column if not exists is_daily boolean default false,
  add column if not exists sort integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists ai_models_enabled on public.ai_models (enabled, sort);

create or replace trigger ai_models_touch before update on public.ai_models
  for each row execute function public.touch_updated_at();

alter table public.ai_models enable row level security;

-- Kirgan odam katalogni koʻradi, lekin TANNARXNI emas — quyidagi
-- `model_catalog()` funksiyasi kerakli ustunlarnigina qaytaradi.
drop policy if exists ai_models_read on public.ai_models;
create policy ai_models_read on public.ai_models
  for select to authenticated using (public.is_admin());

drop policy if exists ai_models_admin on public.ai_models;
create policy ai_models_admin on public.ai_models
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

/*
 * Jadval huquqlari.
 *
 * RLS siyosati oʻzi yetmaydi: PostgREST avval oddiy SQL huquqini
 * tekshiradi. Grant boʻlmasa «permission denied for table ai_models»
 * qaytadi — panel esa buni boʻsh roʻyxat deb koʻrsatadi va model
 * qoʻshish jimgina ishlamaydi. Aynan shu xato boʻlgan edi.
 */
grant select, insert, update, delete on public.ai_models to authenticated;

-- ---------------------------------------------------------------------------
--  Kredit kursi: tannarxdan sotuv narxini hisoblash
-- ---------------------------------------------------------------------------
/*
 * Kurs seed rejalardagi kredit miqdoriga moslab tanlangan.
 *
 * Pro rejasi 120 000 kredit beradi. `usd_per_credit = 0.00005` da bu
 * $6 lik sotuv qiymati, ustama 2 boʻlgani uchun taxminan $3 haqiqiy
 * xarajat — oyiga bir necha million token. Bepul reja 2 000 kredit,
 * yaʼni tanishib chiqish uchun.
 *
 * Admin buni panelda oʻzgartira oladi; oʻzgartirilsa yangi qoʻshilgan
 * modellar narxi shu kurs boʻyicha hisoblanadi.
 */
insert into public.app_settings (key, value)
values ('credit_rate', '{"usd_per_credit": 0.00005, "markup": 2.0}'::jsonb)
on conflict (key) do nothing;

-- USD/1M token → kredit/1M token.
create or replace function public.usd_to_credits(p_usd numeric)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  v_rate numeric;
  v_markup numeric;
begin
  select value into v from public.app_settings where key = 'credit_rate';
  v_rate := coalesce(nullif((v ->> 'usd_per_credit')::numeric, 0), 0.00005);
  v_markup := coalesce(nullif((v ->> 'markup')::numeric, 0), 2.0);
  return round(coalesce(p_usd, 0) * v_markup / v_rate, 4);
end;
$$;

-- ---------------------------------------------------------------------------
--  Ilova uchun katalog: nom, roli, imkoniyatlari. Tannarx yoʻq.
--
--  Rejaga kirmaganlari ham koʻrinadi — «bu model qaysi tarifda ochiladi»
--  degan savolga javob berish uchun. `open` maydoni shuni aytadi.
-- ---------------------------------------------------------------------------
create or replace function public.model_catalog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans%rowtype;
  v_out jsonb;
begin
  if v_user is not null then
    v_plan := public.active_plan(v_user);
  end if;

  select coalesce(jsonb_agg(x order by x ->> 'role', (x ->> 'sort')::int, x ->> 'label'), '[]'::jsonb)
    into v_out
  from (
    -- 1. Katalogdagi modellar (admin qoʻshgan «Daho» nomlari).
    select jsonb_build_object(
             'slug', m.slug,
             'label', coalesce(nullif(m.label, ''), m.slug),
             'description', m.description,
             'role', m.role,
             'supports_tools', m.supports_tools,
             'supports_vision', m.supports_vision,
             'context_tokens', m.context_tokens,
             'is_daily', m.is_daily,
             'sort', m.sort,
             'open', pm.id is not null,
             'input_credits_per_mtok', coalesce(pm.input_credits_per_mtok, m.input_credits_per_mtok),
             'output_credits_per_mtok', coalesce(pm.output_credits_per_mtok, m.output_credits_per_mtok),
             'call_credits', coalesce(pm.call_credits, m.call_credits)
           ) as x
      from public.ai_models m
      left join public.plan_models pm
        on pm.model = m.slug and pm.plan_id = v_plan.id and pm.enabled
     where m.enabled

    union all

    /*
     * 2. Katalogga hali kiritilmagan, lekin rejada ochiq modellar.
     *
     * Katalog yangi. Usiz eski sozlamadagi foydalanuvchi «katalog boʻsh»
     * degan yozuvni koʻrardi — holbuki modellari ishlab turgan.
     */
    select jsonb_build_object(
             'slug', pm.model,
             'label', pm.model,
             'description', '',
             'role', pm.role,
             'supports_tools', true,
             'supports_vision', false,
             'context_tokens', 0,
             'is_daily', false,
             'sort', 100,
             'open', true,
             'input_credits_per_mtok', pm.input_credits_per_mtok,
             'output_credits_per_mtok', pm.output_credits_per_mtok,
             'call_credits', pm.call_credits
           ) as x
      from public.plan_models pm
     where pm.plan_id = v_plan.id
       and pm.enabled
       and not exists (select 1 from public.ai_models m where m.slug = pm.model)
  ) s;

  return v_out;
end;
$$;

grant execute on function public.model_catalog() to authenticated, anon;

-- ---------------------------------------------------------------------------
--  Shlyuz uchun: slug → provayder + haqiqiy nom.
--
--  Faqat server (service_role) chaqiradi — shuning uchun ruxsat olib
--  tashlanadi. Slug katalogda boʻlmasa, nomning oʻzi qaytariladi: eski
--  sozlamalar (toʻgʻridan-toʻgʻri `gemini-…`) ishlayveradi.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_model(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m public.ai_models%rowtype;
begin
  select * into m from public.ai_models where slug = p_slug and enabled;
  if not found then
    return jsonb_build_object(
      'slug', p_slug,
      'provider', case when p_slug like '%/%' then 'openrouter' else 'google' end,
      'upstream', p_slug,
      'role', 'chat',
      'supports_tools', true,
      'supports_vision', true,
      'known', false
    );
  end if;
  return jsonb_build_object(
    'slug', m.slug,
    'provider', m.provider,
    'upstream', coalesce(nullif(m.upstream, ''), m.slug),
    'role', m.role,
    'supports_tools', m.supports_tools,
    'supports_vision', m.supports_vision,
    'supports_stream', m.supports_stream,
    'known', true
  );
end;
$$;

revoke all on function public.resolve_model(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
--  Admin: katalogdan modelni qoʻshish yoki narxini yangilash.
--
--  Tannarx (USD) beriladi — sotuv narxi `credit_rate` boʻyicha oʻzi
--  hisoblanadi. Admin xohlasa keyin qoʻlda tuzatadi.
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_model(p_model jsonb)
returns public.ai_models language plpgsql security definer set search_path = public as $$
declare
  v public.ai_models%rowtype;
  v_in numeric;
  v_out numeric;
begin
  if not public.is_admin() then
    raise exception 'faqat admin';
  end if;

  v_in := coalesce((p_model ->> 'input_credits_per_mtok')::numeric,
                   public.usd_to_credits((p_model ->> 'cost_input_usd')::numeric));
  v_out := coalesce((p_model ->> 'output_credits_per_mtok')::numeric,
                    public.usd_to_credits((p_model ->> 'cost_output_usd')::numeric));

  insert into public.ai_models (
    slug, label, description, provider, upstream, role,
    cost_input_usd, cost_output_usd,
    input_credits_per_mtok, output_credits_per_mtok, call_credits,
    supports_tools, supports_vision, supports_stream, context_tokens,
    enabled, is_daily, sort
  ) values (
    lower(trim(p_model ->> 'slug')),
    coalesce(p_model ->> 'label', ''),
    coalesce(p_model ->> 'description', ''),
    coalesce(p_model ->> 'provider', 'openrouter'),
    coalesce(p_model ->> 'upstream', ''),
    coalesce(p_model ->> 'role', 'chat'),
    coalesce((p_model ->> 'cost_input_usd')::numeric, 0),
    coalesce((p_model ->> 'cost_output_usd')::numeric, 0),
    coalesce(v_in, 0), coalesce(v_out, 0),
    coalesce((p_model ->> 'call_credits')::numeric, 0),
    coalesce((p_model ->> 'supports_tools')::boolean, true),
    coalesce((p_model ->> 'supports_vision')::boolean, false),
    coalesce((p_model ->> 'supports_stream')::boolean, true),
    coalesce((p_model ->> 'context_tokens')::integer, 0),
    coalesce((p_model ->> 'enabled')::boolean, true),
    coalesce((p_model ->> 'is_daily')::boolean, false),
    coalesce((p_model ->> 'sort')::integer, 0)
  )
  on conflict (slug) do update set
    label                   = excluded.label,
    description             = excluded.description,
    provider                = excluded.provider,
    upstream                = excluded.upstream,
    role                    = excluded.role,
    cost_input_usd          = excluded.cost_input_usd,
    cost_output_usd         = excluded.cost_output_usd,
    input_credits_per_mtok  = excluded.input_credits_per_mtok,
    output_credits_per_mtok = excluded.output_credits_per_mtok,
    call_credits            = excluded.call_credits,
    supports_tools          = excluded.supports_tools,
    supports_vision         = excluded.supports_vision,
    supports_stream         = excluded.supports_stream,
    context_tokens          = excluded.context_tokens,
    enabled                 = excluded.enabled,
    is_daily                = excluded.is_daily,
    sort                    = excluded.sort
  returning * into v;

  -- Bitta model «Daho Daily» boʻla oladi.
  if v.is_daily then
    update public.ai_models set is_daily = false where id <> v.id and is_daily;
    update public.app_settings
       set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('model', v.slug)
     where key = 'daily_model';
    insert into public.app_settings (key, value)
    values ('daily_model', jsonb_build_object('model', v.slug, 'quota', 30))
    on conflict (key) do nothing;
  end if;

  return v;
end;
$$;

grant execute on function public.admin_save_model(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
--  Admin: modelni bir necha rejaga bir vaqtda ochish.
-- ---------------------------------------------------------------------------
create or replace function public.admin_attach_model(
  p_slug text,
  p_plans uuid[],
  p_markup numeric default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  m public.ai_models%rowtype;
  v_plan uuid;
  v_count integer := 0;
  v_in numeric;
  v_out numeric;
begin
  if not public.is_admin() then
    raise exception 'faqat admin';
  end if;

  select * into m from public.ai_models where slug = p_slug;
  if not found then
    raise exception 'katalogda «%» yoʻq', p_slug;
  end if;

  v_in := m.input_credits_per_mtok * coalesce(p_markup, 1);
  v_out := m.output_credits_per_mtok * coalesce(p_markup, 1);

  foreach v_plan in array coalesce(p_plans, '{}'::uuid[]) loop
    insert into public.plan_models (
      plan_id, model, role,
      input_credits_per_mtok, output_credits_per_mtok, call_credits, enabled
    ) values (v_plan, m.slug, m.role, v_in, v_out, m.call_credits, true)
    on conflict (plan_id, model) do update set
      role                    = excluded.role,
      input_credits_per_mtok  = excluded.input_credits_per_mtok,
      output_credits_per_mtok = excluded.output_credits_per_mtok,
      call_credits            = excluded.call_credits,
      enabled                 = true;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.admin_attach_model(text, uuid[], numeric) to authenticated;

-- ---------------------------------------------------------------------------
--  Admin: qaysi provayder kaliti serverda sozlangan.
--
--  Kalitning OʻZI hech qachon bazaga yozilmaydi va panelga chiqmaydi —
--  u faqat Railway muhit oʻzgaruvchisida turadi. Panel faqat «bor / yoʻq»
--  ni koʻrsatadi, buni server `/api/providers` orqali aytadi.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value)
values ('providers', '{"openrouter": {"enabled": true}, "google": {"enabled": true}}'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
--  Katalogga kiritilmagan modellar
--
--  Katalog yangi. Undan oldin modellar toʻgʻridan-toʻgʻri `plan_models`
--  ga qoʻlda yozilgan boʻlishi mumkin — ular ishlaydi, lekin narxi eski
--  oʻlchovda qolgan va provayderi nomaʼlum. Admin buni koʻrib turishi
--  va katalogga koʻchirishi kerak.
-- ---------------------------------------------------------------------------
create or replace function public.unlisted_models()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'faqat admin';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'model', g.model,
           'role', g.role,
           'plans', g.plans,
           'input_credits_per_mtok', g.kirish,
           'output_credits_per_mtok', g.chiqish
         ) order by g.model), '[]'::jsonb)
    into v_out
    from (
      select pm.model,
             max(pm.role) as role,
             count(*) as plans,
             max(pm.input_credits_per_mtok) as kirish,
             max(pm.output_credits_per_mtok) as chiqish
        from public.plan_models pm
       where not exists (select 1 from public.ai_models m where m.slug = pm.model)
       group by pm.model
    ) g;

  return v_out;
end;
$$;

grant execute on function public.unlisted_models() to authenticated;

-- ==========================================================================
--  20260823120000_drop_stale_models.sql
-- ==========================================================================

-- ---------------------------------------------------------------------------
--  Eskirgan model urug'ini olib tashlash
--
--  Loyiha boshida `plan_models` ga qo'lda Gemini nomlari yozib qo'yilgan
--  edi (gemini-flash-latest, gemini-2.5-flash-image, ...). Ular ikki
--  sababga ko'ra yaroqsiz:
--
--    1. NOMI ESKIRADI. Provayder modelni yangilaydi yoki o'chiradi, bu
--       yerdagi qator esa qolib ketadi — admin panelida «provayderi
--       noma'lum, narxi eski o'lchovda» bo'lib turadi.
--    2. NARXI TAXMINIY. «1M token = N kredit» qo'lda yozilgan, haqiqiy
--       tannarxga bog'lanmagan.
--
--  To'g'ri manba — `ai_models` katalogi: admin OpenRouter'ning JONLI
--  ro'yxatidan model tanlaydi, tannarxi bilan. Shuning uchun katalogda
--  aksi bo'lmagan eski urug' qatorlari olib tashlanadi.
--
--  Admin QO'LDA qo'shgan qatorlarga tegilmaydi: faqat aynan o'sha
--  boshlang'ich ro'yxatdagi nomlar va faqat katalogda yo'q bo'lsa.
-- ---------------------------------------------------------------------------

do $$
declare
  v_eski text[] := array[
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-tts'
  ];
  v_soni integer;
begin
  if to_regclass('public.plan_models') is null then
    return;
  end if;

  delete from public.plan_models pm
  where pm.model = any (v_eski)
    and not exists (
      select 1 from public.ai_models am where am.slug = pm.model
    );

  get diagnostics v_soni = row_count;
  if v_soni > 0 then
    raise notice 'Eskirgan model qatorlari olib tashlandi: %', v_soni;
  end if;
end $$;

-- ---------------------------------------------------------------------------
--  Kunlik zaxira model ham katalogga bog'lansin
--
--  `daily_model` da o'sha eskirgan nom turibdi. Katalogda unga mos slug
--  bo'lmasa sozlamani bo'shatamiz — shunda `can_use_model` kunlik
--  zaxirani taklif qilmaydi va odam yo'q modelga urinmaydi. Admin
--  panelidan istalgan katalog modelini qayta tanlash mumkin.
-- ---------------------------------------------------------------------------
update public.app_settings
set value = jsonb_build_object('model', '', 'label', coalesce(value ->> 'label', 'Daho Daily'))
where key = 'daily_model'
  and coalesce(value ->> 'model', '') <> ''
  and not exists (
    select 1 from public.ai_models am where am.slug = public.app_settings.value ->> 'model'
  );

-- ---------------------------------------------------------------------------
--  Katalogdagi model tarifda eski narx bilan qolib ketmasin
--
--  Yuqoridagi tozalash faqat katalogda YO'Q qatorlarni o'chiradi. Ammo
--  admin eski nomni katalogga qo'shgan bo'lsa, tarifdagi qator o'sha
--  eskirgan «1M = 30 kredit» bilan qolardi va haqiqiy tannarxdan
--  o'nlab barobar arzon sotilardi. Shuning uchun katalogda aksi bor
--  qatorlarning narxi katalogdagi hisobga tenglashtiriladi.
--
--  Faqat aynan o'sha boshlang'ich urug'dagi nomlar tegishli — admin
--  qo'lda qo'ygan boshqa narxlarga tegilmaydi.
-- ---------------------------------------------------------------------------
do $$
declare
  v_eski text[] := array[
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-pro-latest',
    'gemini-2.5-flash-image',
    'gemini-2.5-flash-tts'
  ];
  v_soni integer;
begin
  if to_regclass('public.plan_models') is null or to_regclass('public.ai_models') is null then
    return;
  end if;

  /*
   * Kreditni katalogdan olamiz. Agar katalogda kredit ustuni hali
   * to'ldirilmagan bo'lsa (faqat tannarx yozilgan), uni tannarxdan
   * o'zimiz hisoblaymiz — aks holda tarifga NOL ko'chib, pullik model
   * bepul bo'lib qolardi.
   */
  with narx as (
    select
      am.slug,
      am.role,
      coalesce(nullif(am.input_credits_per_mtok, 0),
               public.usd_to_credits(am.cost_input_usd))  as inp,
      coalesce(nullif(am.output_credits_per_mtok, 0),
               public.usd_to_credits(am.cost_output_usd)) as outp,
      am.call_credits
    from public.ai_models am
  )
  update public.plan_models pm set
    role                    = narx.role,
    input_credits_per_mtok  = narx.inp,
    output_credits_per_mtok = narx.outp,
    call_credits            = narx.call_credits
  from narx
  where narx.slug = pm.model
    and pm.model = any (v_eski)
    -- Nol narx tarifga ko'chmasin: bunda eski qiymat qolgani xavfsizroq.
    and (narx.inp > 0 or narx.outp > 0)
    and (
      pm.input_credits_per_mtok  is distinct from narx.inp
      or pm.output_credits_per_mtok is distinct from narx.outp
    );

  get diagnostics v_soni = row_count;
  if v_soni > 0 then
    raise notice 'Tarifdagi eski narxlar katalogga tenglashtirildi: %', v_soni;
  end if;
end $$;

-- ==========================================================================
--  PostgREST sxema keshi — yangi jadval darrov koʻrinsin
-- ==========================================================================

notify pgrst, 'reload schema';
