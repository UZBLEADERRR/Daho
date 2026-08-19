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

-- Model narxlari. Bepul rejaga faqat tezkor model, Pro'ga hammasi.
with p as (select id, code from public.plans)
insert into public.plan_models
  (plan_id, model, role, input_credits_per_mtok, output_credits_per_mtok, call_credits, enabled)
select p.id, m.model, m.role, m.inp, m.outp, m.call_c, true
from p
join (values
  ('free',  'gemini-flash-lite-latest', 'chat',  20::numeric,  60::numeric, 0::numeric),
  ('free',  'gemini-flash-latest',      'chat',  30,  90, 0),
  ('start', 'gemini-flash-lite-latest', 'chat',  20,  60, 0),
  ('start', 'gemini-flash-latest',      'chat',  30,  90, 0),
  ('start', 'gemini-2.5-flash-image',   'image',  0,   0, 40),
  ('start', 'gemini-2.5-flash-tts',     'tts',   10,   0, 5),
  ('pro',   'gemini-flash-lite-latest', 'chat',  20,  60, 0),
  ('pro',   'gemini-flash-latest',      'chat',  30,  90, 0),
  ('pro',   'gemini-pro-latest',        'chat', 150, 600, 0),
  ('pro',   'gemini-2.5-flash-image',   'image',  0,   0, 40),
  ('pro',   'gemini-2.5-flash-tts',     'tts',   10,   0, 5)
) as m(plan_code, model, role, inp, outp, call_c) on m.plan_code = p.code
on conflict (plan_id, model) do nothing;
