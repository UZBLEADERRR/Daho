-- ============================================================================
--  Guruh loyihalari
--
--  Bir necha odam bitta loyiha ustida ishlaydi: Daho Code'da kimdir loyiha
--  ochadi, boshqalarni qidirib taklif yuboradi, ular qabul qilgach loyiha
--  ham, suhbat ham umumiy bo'ladi.
--
--  KREDIT QOIDASI (foydalanuvchi so'ragan tartib):
--    1. Guruhning o'z hamyoni bor. Unga a'zolar o'z kreditidan o'tkazadi.
--    2. So'rov guruh ichida bo'lsa — avval GURUH hamyonidan yechiladi.
--       Shunda krediti tugagan a'zo ham ishlay oladi.
--    3. Guruhda yetmasa — o'sha odamning o'z krediti ishlatiladi.
--
--  MAXFIYLIK: odam qidirish butun ro'yxatni ochib qo'ymaydi. Faqat
--  to'liq pochta bilan yoki ismning kamida 3 harfi bilan topiladi, va
--  pochta niqoblab qaytariladi.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Jadvallar
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- 'kod' — Daho Code loyihasi, 'umumiy' — shunchaki jamoa.
  kind        text not null default 'kod',
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  -- Guruh hamyoni. A'zolar o'z kreditidan to'ldiradi.
  credits     numeric(14, 4) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user on public.group_members (user_id);

create table if not exists public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  from_user  uuid not null references public.profiles(id) on delete cascade,
  -- kutilmoqda | qabul | rad
  status     text not null default 'kutilmoqda',
  created_at timestamptz not null default now(),
  unique (group_id, to_user)
);

create index if not exists group_invites_to on public.group_invites (to_user, status);

-- Umumiy loyiha holati. Butun loyiha bitta jsonb — Daho Code'dagi
-- CodeProject ning o'zi. Kichik loyihalar uchun shu yetarli va
-- sinxronlash bitta yozuvga to'g'ri keladi.
create table if not exists public.group_projects (
  group_id   uuid primary key references public.groups(id) on delete cascade,
  project    jsonb not null default '{}'::jsonb,
  -- Har saqlashda oshadi: kim eskirgan nusxani yozayotganini bilamiz.
  version    bigint not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_feed on public.group_messages (group_id, created_at desc);

create table if not exists public.group_credit_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  amount     numeric(14, 4) not null,
  reason     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists group_credit_feed on public.group_credit_events (group_id, created_at desc);

-- ---------------------------------------------------------------------------
--  A'zolikni tekshirish
--
--  ALOHIDA `security definer` funksiya sifatida yozilgan. Agar RLS siyosati
--  to'g'ridan-to'g'ri `group_members` dan o'qisa, o'sha jadvalning o'z
--  siyosati yana chaqirilib cheksiz halqa hosil bo'lardi.
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(p_group uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group
      and m.user_id = coalesce(p_user, auth.uid())
  );
$$;

create or replace function public.is_group_owner(p_group uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group
      and m.user_id = coalesce(p_user, auth.uid())
      and m.role = 'owner'
  );
$$;

grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_owner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
--  RLS
-- ---------------------------------------------------------------------------

alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.group_invites      enable row level security;
alter table public.group_projects     enable row level security;
alter table public.group_messages     enable row level security;
alter table public.group_credit_events enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (public.is_group_member(id) or public.is_admin());

drop policy if exists groups_write on public.groups;
create policy groups_write on public.groups
  for update using (public.is_group_owner(id)) with check (public.is_group_owner(id));

drop policy if exists groups_drop on public.groups;
create policy groups_drop on public.groups
  for delete using (public.is_group_owner(id));

drop policy if exists gm_read on public.group_members;
create policy gm_read on public.group_members
  for select using (public.is_group_member(group_id) or user_id = auth.uid());

drop policy if exists gm_leave on public.group_members;
create policy gm_leave on public.group_members
  for delete using (user_id = auth.uid() or public.is_group_owner(group_id));

drop policy if exists gi_read on public.group_invites;
create policy gi_read on public.group_invites
  for select using (to_user = auth.uid() or public.is_group_member(group_id));

drop policy if exists gp_read on public.group_projects;
create policy gp_read on public.group_projects
  for select using (public.is_group_member(group_id));

drop policy if exists gmsg_read on public.group_messages;
create policy gmsg_read on public.group_messages
  for select using (public.is_group_member(group_id));

drop policy if exists gmsg_write on public.group_messages;
create policy gmsg_write on public.group_messages
  for insert with check (public.is_group_member(group_id) and user_id = auth.uid());

drop policy if exists gce_read on public.group_credit_events;
create policy gce_read on public.group_credit_events
  for select using (public.is_group_member(group_id));

grant select on public.groups, public.group_members, public.group_invites,
                public.group_projects, public.group_credit_events to authenticated;
grant select, insert on public.group_messages to authenticated;
grant delete on public.group_members to authenticated;

-- ---------------------------------------------------------------------------
--  Odam qidirish
--
--  Butun ro'yxat OCHILMAYDI. Ikki yo'l bor:
--    - to'liq pochta yozilsa aynan o'sha odam topiladi;
--    - ism bo'yicha kamida 3 harf yozilsa mos kelganlar chiqadi.
--  Pochta niqoblab qaytariladi: taklif yuborish uchun uni bilish shart emas.
-- ---------------------------------------------------------------------------
create or replace function public.find_people(p_query text)
returns table (user_id uuid, name text, email_hint text)
language sql stable security definer set search_path = public as $$
  with q as (select trim(lower(coalesce(p_query, ''))) as t)
  select
    p.id,
    coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
    -- «sarvarbek@gmail.com» -> «sa***@gmail.com»
    left(split_part(p.email, '@', 1), 2) || '***@' || split_part(p.email, '@', 2)
  from public.profiles p, q
  where p.id <> auth.uid()
    and not p.blocked
    and (
      (q.t like '%@%' and lower(p.email) = q.t)
      or (length(q.t) >= 3 and lower(coalesce(p.full_name, '')) like q.t || '%')
    )
  order by p.full_name nulls last
  limit 10;
$$;

grant execute on function public.find_people(text) to authenticated;

-- ---------------------------------------------------------------------------
--  Guruh ochish
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_kind text default 'kod')
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  g public.groups%rowtype;
begin
  if auth.uid() is null then raise exception 'avval tizimga kiring'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'guruh nomi kerak'; end if;

  insert into public.groups (name, kind, owner_id)
  values (trim(p_name), coalesce(nullif(p_kind, ''), 'kod'), auth.uid())
  returning * into g;

  insert into public.group_members (group_id, user_id, role)
  values (g.id, auth.uid(), 'owner');

  insert into public.group_projects (group_id, updated_by)
  values (g.id, auth.uid());

  return g;
end;
$$;

grant execute on function public.create_group(text, text) to authenticated;

-- ---------------------------------------------------------------------------
--  Taklif yuborish va javob berish
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_group(p_group uuid, p_user uuid)
returns public.group_invites language plpgsql security definer set search_path = public as $$
declare
  v public.group_invites%rowtype;
begin
  if not public.is_group_member(p_group) then
    raise exception 'siz bu guruh a''zosi emassiz';
  end if;
  if public.is_group_member(p_group, p_user) then
    raise exception 'bu odam allaqachon guruhda';
  end if;

  insert into public.group_invites (group_id, to_user, from_user)
  values (p_group, p_user, auth.uid())
  on conflict (group_id, to_user) do update
    set status = 'kutilmoqda', from_user = auth.uid(), created_at = now()
  returning * into v;

  return v;
end;
$$;

create or replace function public.respond_invite(p_invite uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.group_invites%rowtype;
begin
  select * into v from public.group_invites where id = p_invite;
  if not found then raise exception 'taklif topilmadi'; end if;
  if v.to_user <> auth.uid() then raise exception 'bu taklif sizga emas'; end if;
  if v.status <> 'kutilmoqda' then
    return jsonb_build_object('holat', v.status, 'ogohlantirish', 'javob allaqachon berilgan');
  end if;

  update public.group_invites
     set status = case when p_accept then 'qabul' else 'rad' end
   where id = p_invite;

  if p_accept then
    insert into public.group_members (group_id, user_id, role)
    values (v.group_id, auth.uid(), 'member')
    on conflict do nothing;
  end if;

  return jsonb_build_object('holat', case when p_accept then 'qabul' else 'rad' end,
                            'group_id', v.group_id);
end;
$$;

grant execute on function public.invite_to_group(uuid, uuid) to authenticated;
grant execute on function public.respond_invite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
--  Ro'yxatlar
-- ---------------------------------------------------------------------------
create or replace function public.my_groups()
returns table (
  id uuid, name text, kind text, credits numeric,
  my_role text, members integer, owner_name text, updated_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    g.id, g.name, g.kind, g.credits,
    m.role,
    (select count(*)::integer from public.group_members x where x.group_id = g.id),
    coalesce(nullif(o.full_name, ''), split_part(o.email, '@', 1)),
    g.updated_at
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  left join public.profiles o on o.id = g.owner_id
  order by g.updated_at desc;
$$;

create or replace function public.group_people(p_group uuid)
returns table (user_id uuid, name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    m.user_id,
    coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
    m.role,
    m.joined_at
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group
    and public.is_group_member(p_group)
  order by m.role, m.joined_at;
$$;

create or replace function public.my_invites()
returns table (
  id uuid, group_id uuid, group_name text, from_name text, created_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    i.id, i.group_id, g.name,
    coalesce(nullif(f.full_name, ''), split_part(f.email, '@', 1)),
    i.created_at
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  left join public.profiles f on f.id = i.from_user
  where i.to_user = auth.uid() and i.status = 'kutilmoqda'
  order by i.created_at desc;
$$;

grant execute on function public.my_groups() to authenticated;
grant execute on function public.group_people(uuid) to authenticated;
grant execute on function public.my_invites() to authenticated;

-- ---------------------------------------------------------------------------
--  Umumiy loyiha: o'qish va saqlash
--
--  Saqlashda VERSIYA tekshiriladi. Ikki kishi bir vaqtda yozsa,
--  kechikkani xato oladi va o'zidagini birlashtiradi — jimgina
--  ustidan yozib yuborilmaydi.
-- ---------------------------------------------------------------------------
create or replace function public.group_project(p_group uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'project', gp.project,
           'version', gp.version,
           'updated_at', gp.updated_at
         )
  from public.group_projects gp
  where gp.group_id = p_group and public.is_group_member(p_group);
$$;

create or replace function public.save_group_project(
  p_group uuid,
  p_project jsonb,
  p_version bigint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now bigint;
begin
  if not public.is_group_member(p_group) then
    raise exception 'siz bu guruh a''zosi emassiz';
  end if;

  select version into v_now from public.group_projects where group_id = p_group for update;
  if not found then
    insert into public.group_projects (group_id, project, updated_by)
    values (p_group, coalesce(p_project, '{}'::jsonb), auth.uid());
    return jsonb_build_object('version', 1);
  end if;

  if p_version is not null and p_version <> v_now then
    return jsonb_build_object('conflict', true, 'version', v_now);
  end if;

  update public.group_projects
     set project = coalesce(p_project, '{}'::jsonb),
         version = v_now + 1,
         updated_by = auth.uid(),
         updated_at = now()
   where group_id = p_group;

  update public.groups set updated_at = now() where id = p_group;

  return jsonb_build_object('version', v_now + 1);
end;
$$;

grant execute on function public.group_project(uuid) to authenticated;
grant execute on function public.save_group_project(uuid, jsonb, bigint) to authenticated;

-- ---------------------------------------------------------------------------
--  Guruh suhbati
-- ---------------------------------------------------------------------------
create or replace function public.group_feed(p_group uuid, p_limit integer default 100)
returns table (id uuid, user_id uuid, name text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    m.id, m.user_id,
    coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
    m.body, m.created_at
  from public.group_messages m
  join public.profiles p on p.id = m.user_id
  where m.group_id = p_group and public.is_group_member(p_group)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 300));
$$;

grant execute on function public.group_feed(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
--  Guruh hamyoni
--
--  A'zo o'z kreditidan guruhga o'tkazadi. Avval obuna kreditidan,
--  yetmasa pay-as-you-go hamyonidan olinadi.
-- ---------------------------------------------------------------------------
create or replace function public.move_credits_to_group(p_group uuid, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bal public.credit_balances%rowtype;
  v_from_balance numeric := 0;
  v_from_wallet numeric := 0;
  v_left numeric;
begin
  if not public.is_group_member(p_group) then
    raise exception 'siz bu guruh a''zosi emassiz';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'miqdor musbat bo''lishi kerak';
  end if;

  select * into v_bal from public.credit_balances where user_id = auth.uid() for update;
  if not found then raise exception 'hisob topilmadi'; end if;

  if coalesce(v_bal.balance, 0) + coalesce(v_bal.wallet, 0) < p_amount then
    raise exception 'kredit yetmaydi';
  end if;

  v_from_balance := least(coalesce(v_bal.balance, 0), p_amount);
  v_left := p_amount - v_from_balance;
  v_from_wallet := v_left;

  update public.credit_balances
     set balance = balance - v_from_balance,
         wallet  = wallet  - v_from_wallet
   where user_id = auth.uid();

  update public.groups set credits = credits + p_amount, updated_at = now()
   where id = p_group;

  insert into public.group_credit_events (group_id, user_id, amount, reason)
  values (p_group, auth.uid(), p_amount, 'a''zodan o''tkazma');

  return jsonb_build_object('group_credits',
    (select credits from public.groups where id = p_group));
end;
$$;

grant execute on function public.move_credits_to_group(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
--  Guruhdan yechish
--
--  Serverdan chaqiriladi. Guruhda yetarli bo'lsa yechadi va TRUE
--  qaytaradi; yetmasa hech narsa qilmaydi va FALSE qaytaradi — shunda
--  chaqiruvchi odamning o'z kreditidan yechadi.
-- ---------------------------------------------------------------------------
create or replace function public.group_charge(
  p_group uuid,
  p_user uuid,
  p_credits numeric,
  p_reason text default 'ishlatildi'
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_credits numeric;
begin
  if p_group is null or coalesce(p_credits, 0) <= 0 then return false; end if;
  if not public.is_group_member(p_group, p_user) then return false; end if;

  select credits into v_credits from public.groups where id = p_group for update;
  if not found or v_credits < p_credits then return false; end if;

  update public.groups set credits = credits - p_credits where id = p_group;

  insert into public.group_credit_events (group_id, user_id, amount, reason)
  values (p_group, p_user, -p_credits, p_reason);

  return true;
end;
$$;

revoke execute on function public.group_charge(uuid, uuid, numeric, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
--  charge_usage: guruh hamyoni birinchi
--
--  `p_meta ->> 'group_id'` kelsa avval guruhdan yechishga urinamiz.
--  Yechilsa odamning o'z krediti umuman teginmaydi — krediti tugagan
--  a'zo ham guruh hisobidan ishlay oladi. Yetmasa avvalgi yo'l.
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
  v_wallet text := coalesce(p_meta ->> 'charge_source', 'plan');
  v_group uuid := nullif(p_meta ->> 'group_id', '')::uuid;
  v_paid_by_group boolean := false;
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

  -- Guruh ishi bo'lsa avval guruh hamyoni.
  if v_group is not null and coalesce(p_source, '') <> 'byok' and v_wallet <> 'daily' then
    v_paid_by_group := public.group_charge(v_group, p_user, v_credits, coalesce(p_model, 'model'));
  end if;

  insert into public.usage_events (
    user_id, model, kind, source, input_tokens, output_tokens, total_tokens, credits, job_id, meta
  ) values (
    p_user, p_model, coalesce(p_kind, 'chat'), coalesce(p_source, 'gateway'),
    coalesce(p_input, 0), coalesce(p_output, 0), coalesce(p_input, 0) + coalesce(p_output, 0),
    case when v_wallet = 'daily' then 0 else v_credits end,
    p_job,
    -- Kim to'laganini yozib qo'yamiz: keyin «guruh qancha sarfladi» ko'rinadi.
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('paid_by', case when v_paid_by_group then 'group' else v_wallet end)
  );

  if coalesce(p_source, '') <> 'byok' and not v_paid_by_group then
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
    'source', case when v_paid_by_group then 'group' else v_wallet end,
    'group_paid', v_paid_by_group
  );
end;
$$;

revoke execute on function public.charge_usage(uuid, text, text, integer, integer, text, uuid, jsonb)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
--  can_use_model: guruhda kredit bo'lsa a'zoning krediti tugagan bo'lsa ham ruxsat
-- ---------------------------------------------------------------------------
create or replace function public.group_can_pay(p_group uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group
      and g.credits > 0
      and public.is_group_member(p_group, coalesce(p_user, auth.uid()))
  );
$$;

grant execute on function public.group_can_pay(uuid, uuid) to authenticated;

comment on table public.groups is
  'Guruh loyihalari. `credits` — guruh hamyoni: a''zolar o''z kreditidan '
  'to''ldiradi, so''rov guruh ichida bo''lsa avval shundan yechiladi.';
