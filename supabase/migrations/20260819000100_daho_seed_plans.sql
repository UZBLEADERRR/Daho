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
