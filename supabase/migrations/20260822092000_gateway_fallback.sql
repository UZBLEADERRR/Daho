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
values ('daily_model', '{"model": "gemini-flash-latest", "label": "Daho Daily"}'::jsonb)
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
