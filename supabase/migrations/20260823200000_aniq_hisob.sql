-- ============================================================================
--  Aniq hisob: kunlik limit ham, xarajat ham token bo'yicha
--
--  Muammo. Bepul (Daho Daily) yo'l bilan yuborilgan so'rov `usage_events`
--  ga KREDITSIZ yozilardi — `credits = 0`. Natijada:
--    - «Bugungi xarajat» hech qachon o'zgarmasdi: 0 + 0 + 0;
--    - kunlik limit hisoblagichi joyida turardi, chunki u ham kreditni
--      qo'shardi;
--    - hisobotda qaysi model qancha token yegani ko'rinsa-da, puli
--      ko'rinmasdi.
--
--  Yechim. Endi HAR BIR so'rovning haqiqiy narxi yoziladi — bepul
--  yo'lniki ham. Kimning hisobidan yechilgani `meta.paid_by` da turadi:
--  `plan`, `wallet`, `daily` yoki `group`. Reja limitlari (soat/kun/hafta)
--  esa faqat `plan`/`wallet` yozuvlarini sanaydi — bepul so'rov pullik
--  limitni yemaydi, guruh to'lagani ham a'zoning limitidan ketmaydi.
--
--  Ikkinchi xato. `charge_source` kunlik hisobni MAHALLIY sana bilan
--  yozardi, `daily_fallback` esa `current_date` (UTC) bilan o'qirdi.
--  Toshkent vaqti bilan kechqurun 05:00 dan keyin yozuv ertangi qatorga
--  tushib, o'qish bugungisiga qarardi — hisoblagich «qotib» qolardi.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Kunlik bepul hisob — endi tokenlar va krediti bilan
-- ---------------------------------------------------------------------------
alter table public.daily_model_usage
  add column if not exists tokens bigint not null default 0;
alter table public.daily_model_usage
  add column if not exists credits numeric(14, 4) not null default 0;

comment on column public.daily_model_usage.tokens is
  'Bugun bepul modelda sarflangan token (kirish + chiqish).';
comment on column public.daily_model_usage.credits is
  'Bepul so''rovlarning haqiqiy narxi. Foydalanuvchidan yechilmaydi, '
  'lekin hisobotda ko''rinadi va limit shu bo''yicha ham cheklanadi.';

-- ---------------------------------------------------------------------------
--  charge_source — tokenni ham biladi
--
--  Eski uch argumentli chaqiruvlar buzilmasin uchun o'rami qoldiriladi.
-- ---------------------------------------------------------------------------
create or replace function public.charge_source(
  p_user uuid,
  p_source text,
  p_credits numeric,
  p_tokens integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone public.local_zone())::date;
begin
  if p_source = 'daily' then
    insert into public.daily_model_usage (user_id, day, calls, tokens, credits)
    values (p_user, v_day, 1, greatest(coalesce(p_tokens, 0), 0), greatest(coalesce(p_credits, 0), 0))
    on conflict (user_id, day) do update set
      calls = public.daily_model_usage.calls + 1,
      tokens = public.daily_model_usage.tokens + greatest(coalesce(p_tokens, 0), 0),
      credits = public.daily_model_usage.credits + greatest(coalesce(p_credits, 0), 0);
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

  -- Odatiy yo'l: obuna kreditidan.
  update public.credit_balances
     set balance = greatest(balance - p_credits, 0)
   where user_id = p_user;
end;
$$;

create or replace function public.charge_source(
  p_user uuid,
  p_source text,
  p_credits numeric
) returns void language sql security definer set search_path = public as $$
  select public.charge_source(p_user, p_source, p_credits, 0);
$$;

-- ---------------------------------------------------------------------------
--  charge_usage — narx har doim yoziladi
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
  v_tokens integer := coalesce(p_input, 0) + coalesce(p_output, 0);
  v_bal public.credit_balances%rowtype;
  v_fallback jsonb;
  v_wallet text := coalesce(p_meta ->> 'charge_source', 'plan');
  v_group uuid := nullif(p_meta ->> 'group_id', '')::uuid;
  v_paid_by_group boolean := false;
  v_paid_by text;
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

  /*
   * Narx HAR DOIM tokendan hisoblanadi.
   *
   * Bepul yo'lda ham: pul yechilmaydi, lekin xarajat ko'rinsin —
   * «bugun 12 000 token, 4.2 kredit» degan rost raqam bo'lsin.
   */
  v_credits := round(
    (coalesce(p_input, 0)::numeric / 1000000) * v_in +
    (coalesce(p_output, 0)::numeric / 1000000) * v_out +
    v_call,
    4
  );

  -- Guruh ishi bo'lsa avval guruh hamyoni.
  if v_group is not null and coalesce(p_source, '') <> 'byok' and v_wallet <> 'daily' then
    v_paid_by_group := public.group_charge(v_group, p_user, v_credits, coalesce(p_model, 'model'));
  end if;

  v_paid_by := case
    when coalesce(p_source, '') = 'byok' then 'byok'
    when v_paid_by_group then 'group'
    else v_wallet
  end;

  insert into public.usage_events (
    user_id, model, kind, source, input_tokens, output_tokens, total_tokens, credits, job_id, meta
  ) values (
    p_user, p_model, coalesce(p_kind, 'chat'), coalesce(p_source, 'gateway'),
    coalesce(p_input, 0), coalesce(p_output, 0), v_tokens,
    v_credits,
    p_job,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('paid_by', v_paid_by)
  );

  if coalesce(p_source, '') <> 'byok' and not v_paid_by_group then
    perform public.charge_source(p_user, v_wallet, v_credits, v_tokens);
    if v_wallet <> 'daily' then
      update public.credit_balances set used = used + v_credits where user_id = p_user;
    end if;
  end if;

  select * into v_bal from public.credit_balances where user_id = p_user;

  return jsonb_build_object(
    'credits', v_credits,
    'tokens', v_tokens,
    'balance', coalesce(v_bal.balance, 0),
    'wallet', coalesce(v_bal.wallet, 0),
    'source', v_paid_by,
    'paid_by', v_paid_by,
    'group_paid', v_paid_by_group
  );
end;
$$;

revoke execute on function public.charge_usage(uuid, text, text, integer, integer, text, uuid, jsonb)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
--  Reja limiti nimani sanaydi
--
--  Faqat foydalanuvchining O'Z hisobidan ketgan kreditni: bepul yo'l ham,
--  guruh hamyoni ham pullik limitni yemaydi.
-- ---------------------------------------------------------------------------
create or replace function public.plan_spend(p_user uuid, p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(credits), 0)
    from public.usage_events
   where user_id = p_user
     and created_at >= p_since
     and coalesce(meta ->> 'paid_by', 'plan') in ('plan', 'wallet');
$$;

grant execute on function public.plan_spend(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
--  daily_fallback — mahalliy kun va aniq qoldiq
-- ---------------------------------------------------------------------------
create or replace function public.daily_fallback(
  p_user uuid,
  p_plan public.plans,
  p_daily jsonb,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row public.daily_model_usage%rowtype;
  v_quota integer := coalesce(p_plan.daily_model_quota, 30);
  v_model text := coalesce(p_daily ->> 'model', '');
  v_label text := coalesce(p_daily ->> 'label', 'Daho Daily');
begin
  if v_model = '' then
    return jsonb_build_object('allowed', false, 'reason', p_reason);
  end if;

  select * into v_row from public.daily_model_usage
   where user_id = p_user and day = (now() at time zone public.local_zone())::date;

  if coalesce(p_plan.daily_model_access, 'limited') = 'unlimited' then
    return jsonb_build_object(
      'allowed', true,
      'source', 'daily',
      'use_model', v_model,
      'daily_used', coalesce(v_row.calls, 0),
      'daily_tokens', coalesce(v_row.tokens, 0),
      'note', format('%s — %s modeliga o''tildi (cheksiz, lekin sekinroq)', p_reason, v_label)
    );
  end if;

  if coalesce(v_row.calls, 0) >= v_quota then
    return jsonb_build_object(
      'allowed', false,
      'reason', format('%s va bugungi bepul xabarlar ham tugadi', p_reason),
      'daily_used', coalesce(v_row.calls, 0),
      'daily_quota', v_quota,
      'daily_left', 0
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'source', 'daily',
    'use_model', v_model,
    'note', format('%s — %s modeliga o''tildi', p_reason, v_label),
    'daily_used', coalesce(v_row.calls, 0),
    'daily_quota', v_quota,
    'daily_tokens', coalesce(v_row.tokens, 0),
    'daily_left', v_quota - coalesce(v_row.calls, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  can_use_model — to'liq qayta yozildi (mahalliy oyna + to'g'ri sanoq)
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
    return jsonb_build_object('allowed', false, 'reason', 'xizmat vaqtincha to''xtatilgan');
  end if;

  v_plan := public.active_plan(p_user);
  if v_plan.id is null then
    return jsonb_build_object('allowed', false, 'reason', 'reja biriktirilmagan');
  end if;

  select value into v_daily from public.app_settings where key = 'daily_model';
  v_daily_model := coalesce(v_daily ->> 'model', '');

  select * into v_pm from public.plan_models
  where plan_id = v_plan.id and model = p_model and enabled;

  -- Model rejaga kirmagan bo'lsa — zaxira model bilan ishlashni taklif qilamiz.
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

  -- Oyna limitlari — mahalliy vaqt bo'yicha, faqat o'z hisobidan ketgani.
  v_today := public.plan_spend(p_user, public.local_day_start());
  v_hour := public.plan_spend(p_user, now() - interval '1 hour');
  v_week := public.plan_spend(p_user, public.local_week_start());

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

    return jsonb_build_object('allowed', false, 'reason', v_note, 'used_today', v_today);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'source', 'plan',
    'plan_id', v_plan.id,
    'plan', v_plan.name,
    'balance', v_bal.balance,
    'used_today', v_today,
    'input_price', v_pm.input_credits_per_mtok,
    'output_price', v_pm.output_credits_per_mtok,
    'call_price', v_pm.call_credits
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  my_account — hisoblagich uchun raqamlar
--
--  Ilova endi «bugun qancha ishlatdim, limitim qancha» ni to'g'ridan-to'g'ri
--  oladi: taxmin qilmaydi, hisoblab o'tirmaydi.
-- ---------------------------------------------------------------------------
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
  v_hour numeric;
  v_week numeric;
  v_all_today numeric;
  v_tokens_today bigint;
  v_month numeric;
  v_jobs integer;
  v_daily public.daily_model_usage%rowtype;
  v_daily_cfg jsonb;
begin
  if v_user is null then
    return jsonb_build_object('signed_in', false);
  end if;

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

  -- Limitga sanaladigan sarf (bepul va guruh hisobi kirmaydi).
  v_today := public.plan_spend(v_user, public.local_day_start());
  v_hour := public.plan_spend(v_user, now() - interval '1 hour');
  v_week := public.plan_spend(v_user, public.local_week_start());

  -- Ko'rsatiladigan haqiqiy xarajat va token — hammasi bilan.
  select coalesce(sum(credits), 0), coalesce(sum(total_tokens), 0)
    into v_all_today, v_tokens_today
    from public.usage_events
   where user_id = v_user and created_at >= public.local_day_start();

  select coalesce(sum(credits), 0) into v_month
  from public.usage_events
  where user_id = v_user and created_at >= date_trunc('month', now());

  select count(*) into v_jobs from public.jobs
  where user_id = v_user and status in ('queued', 'running');

  select * into v_daily from public.daily_model_usage
   where user_id = v_user and day = (now() at time zone public.local_zone())::date;

  select value into v_daily_cfg from public.app_settings where key = 'daily_model';

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
      'hourly_credit_cap', v_plan.hourly_credit_cap,
      'weekly_credit_cap', v_plan.weekly_credit_cap,
      'daily_model_access', v_plan.daily_model_access,
      'daily_model_quota', v_plan.daily_model_quota,
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
    'usage_hour', v_hour,
    'usage_week', v_week,
    'spend_today', v_all_today,
    'tokens_today', v_tokens_today,
    'usage_month', v_month,
    'active_jobs', v_jobs,
    'daily_free', jsonb_build_object(
      'access', coalesce(v_plan.daily_model_access, 'limited'),
      'quota', coalesce(v_plan.daily_model_quota, 30),
      'used', coalesce(v_daily.calls, 0),
      'left', greatest(coalesce(v_plan.daily_model_quota, 30) - coalesce(v_daily.calls, 0), 0),
      'tokens', coalesce(v_daily.tokens, 0),
      'credits', coalesce(v_daily.credits, 0),
      'label', coalesce(v_daily_cfg ->> 'label', 'Daho Daily')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
--  window_state — foizdan tashqari aniq raqam ham
--
--  «64% qoldi» degan chiziq ishonchsiz ko'rinadi: odam nechta kredit
--  ishlatganini ko'rmoqchi. Endi `used` va `cap` ham qaytadi — hisoblagich
--  har so'rovdan keyin ko'z oldida o'zgaradi.
-- ---------------------------------------------------------------------------
create or replace function public.window_state(p_used numeric, p_cap numeric)
returns jsonb language sql immutable as $$
  select case
    when p_cap is null or p_cap <= 0 then
      jsonb_build_object(
        'unlimited', true, 'left_percent', 100,
        'used', round(coalesce(p_used, 0), 2), 'cap', null
      )
    else jsonb_build_object(
      'unlimited', false,
      'left_percent', greatest(0, least(100,
        round((1 - coalesce(p_used, 0) / p_cap) * 100)::int
      )),
      'used', round(coalesce(p_used, 0), 2),
      'cap', round(p_cap, 2)
    )
  end;
$$;

grant execute on function public.window_state(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
--  usage_windows — ekrandagi hisoblagich
--
--  Profildagi «Soatlik / Kunlik / Haftalik» chiziqlari shu funksiyadan
--  oziqlanadi. U ham UTC bilan sanardi va bepul so'rovlarni pullik limitga
--  qo'shardi. Endi mahalliy kun, faqat o'z hisobidan ketgani va ustiga —
--  bugungi haqiqiy xarajat bilan token soni.
-- ---------------------------------------------------------------------------
create or replace function public.usage_windows(p_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.plans%rowtype;
  v_bal public.credit_balances%rowtype;
  v_hour numeric;
  v_day numeric;
  v_week numeric;
  v_spend numeric;
  v_tokens bigint;
  v_daily public.daily_model_usage%rowtype;
begin
  v_plan := public.active_plan(p_user);
  select * into v_bal from public.credit_balances where user_id = p_user;

  v_hour := public.plan_spend(p_user, now() - interval '1 hour');
  v_day  := public.plan_spend(p_user, public.local_day_start());
  v_week := public.plan_spend(p_user, public.local_week_start());

  select coalesce(sum(credits), 0), coalesce(sum(total_tokens), 0)
    into v_spend, v_tokens
    from public.usage_events
   where user_id = p_user and created_at >= public.local_day_start();

  select * into v_daily from public.daily_model_usage
   where user_id = p_user and day = (now() at time zone public.local_zone())::date;

  return jsonb_build_object(
    'plan',   v_plan.code,
    'hour',   public.window_state(v_hour, v_plan.hourly_credit_cap),
    'day',    public.window_state(v_day,  v_plan.daily_credit_cap),
    'week',   public.window_state(v_week, v_plan.weekly_credit_cap),
    'period', public.window_state(
                coalesce(v_bal.granted, 0) - coalesce(v_bal.balance, 0),
                nullif(coalesce(v_bal.granted, 0), 0)
              ),
    'wallet',       coalesce(v_bal.wallet, 0),
    'allow_payg',   coalesce(v_plan.allow_payg, true),
    'spend_today',  v_spend,
    'tokens_today', v_tokens,
    'daily_model',  jsonb_build_object(
      'access',  coalesce(v_plan.daily_model_access, 'limited'),
      'used',    coalesce(v_daily.calls, 0),
      'quota',   coalesce(v_plan.daily_model_quota, 30),
      'tokens',  coalesce(v_daily.tokens, 0),
      'credits', coalesce(v_daily.credits, 0)
    ),
    'period_end', v_bal.period_end
  );
end;
$$;

grant execute on function public.usage_windows(uuid) to authenticated;

notify pgrst, 'reload schema';
