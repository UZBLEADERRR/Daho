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
