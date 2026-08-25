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
