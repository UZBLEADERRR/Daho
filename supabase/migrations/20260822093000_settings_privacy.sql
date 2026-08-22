-- ============================================================================
--  app_settings: ichki sozlamalar hammaga koʻrinib turgan edi
--
--  `settings_read ... using (true)` — yaʼni istalgan roʻyxatdan oʻtgan
--  foydalanuvchi (va anon kalit bilan istalgan odam) `admin_emails`,
--  `daily_model`, `fallback_price` kabi ichki qiymatlarni oʻqiy olardi.
--  `admin_emails` esa kim admin ekanini oshkor qiladi — bu hujum uchun
--  birinchi qadam.
--
--  Endi faqat ataylab ochiq deb belgilangan kalitlar koʻrinadi.
-- ============================================================================

drop policy if exists settings_read on public.app_settings;

create policy settings_read on public.app_settings
  for select using (
    key like 'public.%'                        -- ataylab ochiq qilinganlar
    or key in ('contact', 'downloads')         -- aloqa va yuklab olish havolalari
    or public.is_admin()
  );

comment on table public.app_settings is
  'Ichki sozlamalar. Ochiq koʻrsatish kerak boʻlsa kalit nomini '
  '«public.» bilan boshlang, aks holda faqat admin koʻradi.';

-- Aloqa maʼlumotlari — bosh sahifa va «obuna sotib olish» uchun.
insert into public.app_settings (key, value) values
  ('contact', jsonb_build_object(
     'telegram', '',
     'phone', '',
     'email', ''
   )),
  ('downloads', jsonb_build_object('apk', '', 'extension', ''))
on conflict (key) do nothing;
