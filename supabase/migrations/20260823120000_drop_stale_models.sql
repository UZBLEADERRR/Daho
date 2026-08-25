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
