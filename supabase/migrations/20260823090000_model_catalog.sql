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
