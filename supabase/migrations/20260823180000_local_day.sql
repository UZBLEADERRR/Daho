-- ============================================================================
--  Kunlik va haftalik limit — MAHALLIY vaqt bo'yicha
--
--  Xato: `date_trunc('day', now())` UTC bo'yicha ishlaydi. O'zbekiston
--  UTC+5 — ya'ni foydalanuvchi uchun kunlik limit yarim tunda emas,
--  ERTALAB SOAT 5 DA yangilanardi. Kechqurun limitini sarflagan odam
--  yarim tundan keyin ham «kunlik limit tugadi» degan javob olardi;
--  ertalab esa hisob birdan «bugun» ga o'tib ketardi.
--
--  Endi mintaqa `app_settings.timezone` da turadi (standart
--  Asia/Tashkent) va hamma oyna shu vaqt bo'yicha hisoblanadi.
-- ============================================================================

insert into public.app_settings (key, value)
values ('timezone', '{"tz": "Asia/Tashkent"}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
--  Mahalliy kun/hafta boshlanishi
-- ---------------------------------------------------------------------------
create or replace function public.local_zone()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif((select value ->> 'tz' from public.app_settings where key = 'timezone'), ''),
    'Asia/Tashkent'
  );
$$;

/*
 * `now() at time zone tz` — mahalliy vaqt (timestamp), uni kun boshiga
 * yaxlitlab yana UTC ga qaytaramiz. Shunda taqqoslash `created_at`
 * (timestamptz) bilan to'g'ri ishlaydi.
 */
create or replace function public.local_day_start()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (date_trunc('day', now() at time zone public.local_zone()))
         at time zone public.local_zone();
$$;

create or replace function public.local_week_start()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (date_trunc('week', now() at time zone public.local_zone()))
         at time zone public.local_zone();
$$;

grant execute on function public.local_zone() to authenticated;
grant execute on function public.local_day_start() to authenticated;
grant execute on function public.local_week_start() to authenticated;

-- ---------------------------------------------------------------------------
--  can_use_model — oynalar mahalliy vaqtda
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc
   where proname = 'can_use_model' and pronamespace = 'public'::regnamespace
   limit 1;

  if v_src is null then
    return;
  end if;

  -- Faqat ikkita oyna chegarasi almashtiriladi, qolgan mantiq tegilmaydi.
  v_src := replace(
    v_src,
    'created_at >= date_trunc(''day'', now())',
    'created_at >= public.local_day_start()'
  );
  v_src := replace(
    v_src,
    'created_at >= date_trunc(''week'', now())',
    'created_at >= public.local_week_start()'
  );

  execute format(
    'create or replace function public.can_use_model(p_user uuid, p_model text) '
    'returns jsonb language plpgsql security definer set search_path = public as %L',
    v_src
  );
end $$;

-- ---------------------------------------------------------------------------
--  Kunlik bepul modelning hisobi ham mahalliy kunda
--
--  `daily_model_usage.day` `current_date` bilan yozilardi — u ham UTC.
--  Endi mahalliy sana yoziladi, aks holda bepul chaqiruvlar soni
--  yarim tunda emas, ertalab 5 da nolga tushardi.
-- ---------------------------------------------------------------------------
create or replace function public.charge_source(
  p_user uuid,
  p_source text,
  p_credits numeric
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone public.local_zone())::date;
begin
  if p_source = 'daily' then
    insert into public.daily_model_usage (user_id, day, calls)
    values (p_user, v_day, 1)
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

comment on function public.local_day_start() is
  'Mahalliy kun boshlanishi (app_settings.timezone). Kunlik limit '
  'UTC emas, foydalanuvchining yarim tunidan hisoblanadi.';
