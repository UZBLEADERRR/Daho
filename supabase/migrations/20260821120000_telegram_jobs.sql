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
