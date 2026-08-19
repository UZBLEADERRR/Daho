import { useEffect, useState } from 'react';
import { formatCredits, formatPrice, useCloud, type CloudPlan } from '../../lib/cloud';
import {
  addCredits,
  adminPlans,
  adminStats,
  adminUsers,
  decideRequest,
  deletePlan,
  deletePlanModel,
  getAppSetting,
  grantPlan,
  pendingRequests,
  planModels,
  recentUsage,
  savePlan,
  savePlanModel,
  setAppSetting,
  setBlocked,
  setRole,
  type AdminStats,
  type AdminUser,
  type PlanModelRow,
  type PurchaseRequestRow,
} from '../../lib/cloud/admin';
import type { UsageRow } from '../../lib/cloud/types';
import { Sheet, toast } from '../ui';

type Tab = 'umumiy' | 'odamlar' | 'rejalar' | 'sorovlar' | 'sozlama';

function fail(err: unknown): void {
  toast(String((err as Error)?.message ?? err));
}

/* ---------------------------------------------------------------- umumiy */

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);

  useEffect(() => {
    void adminStats().then(setStats).catch(fail);
    void recentUsage(undefined, 25).then(setUsage).catch(fail);
  }, []);

  if (!stats) return <div className="tiny">Yuklanmoqda…</div>;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat">
          <span>{stats.users}</span>
          Foydalanuvchi
        </div>
        <div className="stat">
          <span>{stats.paid_subs}</span>
          Pullik obuna
        </div>
        <div className="stat">
          <span>{formatPrice(stats.mrr_cents)}</span>
          Oylik daromad
        </div>
        <div className="stat">
          <span>{stats.tokens_month.toLocaleString('ru-RU')}</span>
          Token (oy)
        </div>
        <div className="stat">
          <span>{formatCredits(stats.credits_month)}</span>
          Kredit (oy)
        </div>
        <div className="stat">
          <span>{stats.jobs_queued}</span>
          Navbatdagi vazifa
        </div>
      </div>

      <div className="section-label">Modellar boʻyicha (shu oy)</div>
      {stats.top_models.map((m) => (
        <div className="line-row" key={m.model}>
          <div className="grow">
            <div>{m.model}</div>
            <div className="tiny">{m.calls} chaqiruv</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>{Number(m.tokens).toLocaleString('ru-RU')}</div>
            <div className="tiny">{formatCredits(m.credits)} kredit</div>
          </div>
        </div>
      ))}

      <div className="section-label">Oxirgi sarflar</div>
      {usage.map((row) => (
        <div className="line-row" key={row.id}>
          <div className="grow">
            <div>{row.model || row.kind}</div>
            <div className="tiny">
              {new Date(row.created_at).toLocaleString('uz-UZ')} · {row.source}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>{formatCredits(row.credits)}</div>
            <div className="tiny">{row.total_tokens} tk</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- odamlar */

function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string>('');
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState(30);
  const [credits, setCredits] = useState(10000);

  const load = () => {
    void adminUsers(search).then(setUsers).catch(fail);
  };

  useEffect(() => {
    load();
    void adminPlans()
      .then((list) => {
        setPlans(list);
        if (list.length) setPlanId((prev) => prev || list[0].id);
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="row">
        <input
          className="grow"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Pochta yoki ism boʻyicha qidirish"
        />
        <button className="btn mini" onClick={load}>
          Qidirish
        </button>
      </div>

      {users.map((user) => (
        <div className="cloud-card" key={user.id}>
          <div className="between" onClick={() => setOpen(open === user.id ? '' : user.id)}>
            <div className="grow">
              <b>{user.full_name || user.email}</b>
              <div className="tiny">
                {user.email} · {user.plan_name ?? 'rejasiz'}
                {user.role === 'admin' ? ' · admin' : ''}
                {user.blocked ? ' · bloklangan' : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div>{formatCredits(user.balance ?? 0)}</div>
              <div className="tiny">{Number(user.tokens_month).toLocaleString('ru-RU')} tk/oy</div>
            </div>
          </div>

          {open === user.id && (
            <div style={{ marginTop: 10 }}>
              <div className="row">
                <select className="grow" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  style={{ width: 92 }}
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  title="Necha kun"
                />
                <button
                  className="btn mini"
                  onClick={async () => {
                    try {
                      await grantPlan(user.id, planId, days);
                      toast('Reja berildi');
                      load();
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  Berish
                </button>
              </div>

              <div className="row" style={{ marginTop: 8 }}>
                <input
                  className="grow"
                  type="number"
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                />
                <button
                  className="btn mini ghost"
                  onClick={async () => {
                    try {
                      await addCredits(user.id, credits, 'admin');
                      toast('Kredit qoʻshildi');
                      load();
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  Kredit qoʻshish
                </button>
              </div>

              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn mini ghost grow"
                  onClick={async () => {
                    try {
                      await setBlocked(user.id, !user.blocked);
                      toast(user.blocked ? 'Blok olindi' : 'Bloklandi');
                      load();
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  {user.blocked ? 'Blokni olish' : 'Bloklash'}
                </button>
                <button
                  className="btn mini ghost grow"
                  onClick={async () => {
                    try {
                      await setRole(user.id, user.role === 'admin' ? 'user' : 'admin');
                      toast('Rol oʻzgartirildi');
                      load();
                    } catch (err) {
                      fail(err);
                    }
                  }}
                >
                  {user.role === 'admin' ? 'Adminlikni olish' : 'Admin qilish'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- rejalar */

const EMPTY_PLAN: Partial<CloudPlan> = {
  code: '',
  name: '',
  description: '',
  price_cents: 0,
  currency: 'UZS',
  period: 'monthly',
  credit_grant: 0,
  daily_credit_cap: null,
  allow_background: false,
  max_queued_jobs: 0,
  max_jobs_per_day: 0,
  is_active: true,
  sort: 50,
};

function PlanModels({ plan }: { plan: CloudPlan }) {
  const [rows, setRows] = useState<PlanModelRow[]>([]);
  const [draft, setDraft] = useState({ model: '', role: 'chat', input: 30, output: 90, call: 0 });

  const load = () => {
    void planModels(plan.id).then(setRows).catch(fail);
  };
  useEffect(load, [plan.id]);

  const patch = async (row: PlanModelRow, change: Partial<PlanModelRow>) => {
    try {
      await savePlanModel({ ...row, ...change });
      load();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div>
      <div className="section-label">Modellar va token narxi (1M token = kredit)</div>
      {rows.map((row) => (
        <div className="model-row" key={row.id}>
          <div className="between">
            <b>{row.model}</b>
            <div className="row">
              <button
                className="btn mini ghost"
                onClick={() => void patch(row, { enabled: !row.enabled })}
              >
                {row.enabled ? 'Ochiq' : 'Yopiq'}
              </button>
              <button
                className="btn mini ghost"
                onClick={async () => {
                  try {
                    await deletePlanModel(row.id);
                    load();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Oʻchirish
              </button>
            </div>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="mini-field">
              kirish
              <input
                type="number"
                defaultValue={row.input_credits_per_mtok}
                onBlur={(e) =>
                  void patch(row, { input_credits_per_mtok: Number(e.target.value) })
                }
              />
            </label>
            <label className="mini-field">
              chiqish
              <input
                type="number"
                defaultValue={row.output_credits_per_mtok}
                onBlur={(e) =>
                  void patch(row, { output_credits_per_mtok: Number(e.target.value) })
                }
              />
            </label>
            <label className="mini-field">
              chaqiruv
              <input
                type="number"
                defaultValue={row.call_credits}
                onBlur={(e) => void patch(row, { call_credits: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      ))}

      <div className="model-row">
        <div className="row">
          <input
            className="grow"
            placeholder="model id (masalan gemini-flash-latest)"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value.trim() })}
          />
          <select
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            style={{ width: 110 }}
          >
            {['chat', 'image', 'tts', 'video', 'other'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <label className="mini-field">
            kirish
            <input
              type="number"
              value={draft.input}
              onChange={(e) => setDraft({ ...draft, input: Number(e.target.value) })}
            />
          </label>
          <label className="mini-field">
            chiqish
            <input
              type="number"
              value={draft.output}
              onChange={(e) => setDraft({ ...draft, output: Number(e.target.value) })}
            />
          </label>
          <label className="mini-field">
            chaqiruv
            <input
              type="number"
              value={draft.call}
              onChange={(e) => setDraft({ ...draft, call: Number(e.target.value) })}
            />
          </label>
          <button
            className="btn mini"
            onClick={async () => {
              if (!draft.model) return toast('Model nomini yozing');
              try {
                await savePlanModel({
                  plan_id: plan.id,
                  model: draft.model,
                  role: draft.role,
                  input_credits_per_mtok: draft.input,
                  output_credits_per_mtok: draft.output,
                  call_credits: draft.call,
                  enabled: true,
                });
                setDraft({ ...draft, model: '' });
                load();
              } catch (err) {
                fail(err);
              }
            }}
          >
            Qoʻshish
          </button>
        </div>
      </div>
    </div>
  );
}

function Plans() {
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [open, setOpen] = useState('');
  const [draft, setDraft] = useState<Partial<CloudPlan>>(EMPTY_PLAN);

  const load = () => {
    void adminPlans().then(setPlans).catch(fail);
  };
  useEffect(load, []);

  const patch = async (plan: CloudPlan, change: Partial<CloudPlan>) => {
    try {
      await savePlan({ ...plan, ...change });
      load();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div>
      {plans.map((plan) => (
        <div className="cloud-card" key={plan.id}>
          <div className="between" onClick={() => setOpen(open === plan.id ? '' : plan.id)}>
            <div className="grow">
              <b>{plan.name}</b>
              <div className="tiny">
                {plan.code} · {formatPrice(plan.price_cents, plan.currency)} ·{' '}
                {formatCredits(plan.credit_grant)} kredit
                {plan.is_default ? ' · standart' : ''}
                {plan.is_active ? '' : ' · oʻchirilgan'}
              </div>
            </div>
            <span className="pill soft">{open === plan.id ? '▾' : '▸'}</span>
          </div>

          {open === plan.id && (
            <div style={{ marginTop: 10 }}>
              <div className="field">
                <label>Nomi</label>
                <input
                  defaultValue={plan.name}
                  onBlur={(e) => void patch(plan, { name: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Tavsif</label>
                <input
                  defaultValue={plan.description}
                  onBlur={(e) => void patch(plan, { description: e.target.value })}
                />
              </div>
              <div className="row">
                <label className="mini-field grow">
                  narx (soʻm)
                  <input
                    type="number"
                    defaultValue={plan.price_cents}
                    onBlur={(e) => void patch(plan, { price_cents: Number(e.target.value) })}
                  />
                </label>
                <label className="mini-field grow">
                  oylik kredit
                  <input
                    type="number"
                    defaultValue={plan.credit_grant}
                    onBlur={(e) => void patch(plan, { credit_grant: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="mini-field grow">
                  kunlik chegara
                  <input
                    type="number"
                    defaultValue={plan.daily_credit_cap ?? 0}
                    onBlur={(e) =>
                      void patch(plan, {
                        daily_credit_cap: Number(e.target.value) || null,
                      })
                    }
                  />
                </label>
                <label className="mini-field grow">
                  kunlik vazifa
                  <input
                    type="number"
                    defaultValue={plan.max_jobs_per_day}
                    onBlur={(e) => void patch(plan, { max_jobs_per_day: Number(e.target.value) })}
                  />
                </label>
                <label className="mini-field grow">
                  navbat
                  <input
                    type="number"
                    defaultValue={plan.max_queued_jobs}
                    onBlur={(e) => void patch(plan, { max_queued_jobs: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn mini ghost grow"
                  onClick={() => void patch(plan, { allow_background: !plan.allow_background })}
                >
                  Fon: {plan.allow_background ? 'ochiq' : 'yopiq'}
                </button>
                <button
                  className="btn mini ghost grow"
                  onClick={() => void patch(plan, { is_active: !plan.is_active })}
                >
                  {plan.is_active ? 'Sotuvdan olish' : 'Sotuvga qoʻyish'}
                </button>
                <button
                  className="btn mini ghost grow"
                  onClick={() => void patch(plan, { is_default: true })}
                >
                  Standart qilish
                </button>
              </div>

              <PlanModels plan={plan} />

              <button
                className="btn ghost wide"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  if (!window.confirm(`«${plan.name}» rejasi oʻchirilsinmi?`)) return;
                  try {
                    await deletePlan(plan.id);
                    load();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Rejani oʻchirish
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="section-label">Yangi reja</div>
      <div className="row">
        <input
          className="grow"
          placeholder="kod (pro)"
          value={draft.code ?? ''}
          onChange={(e) => setDraft({ ...draft, code: e.target.value.trim() })}
        />
        <input
          className="grow"
          placeholder="Nomi"
          value={draft.name ?? ''}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="mini-field grow">
          narx
          <input
            type="number"
            value={draft.price_cents ?? 0}
            onChange={(e) => setDraft({ ...draft, price_cents: Number(e.target.value) })}
          />
        </label>
        <label className="mini-field grow">
          kredit
          <input
            type="number"
            value={draft.credit_grant ?? 0}
            onChange={(e) => setDraft({ ...draft, credit_grant: Number(e.target.value) })}
          />
        </label>
        <button
          className="btn mini"
          onClick={async () => {
            if (!draft.code || !draft.name) return toast('Kod va nom kerak');
            try {
              await savePlan(draft);
              setDraft(EMPTY_PLAN);
              load();
              toast('Reja qoʻshildi');
            } catch (err) {
              fail(err);
            }
          }}
        >
          Qoʻshish
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- soʻrovlar */

function Requests() {
  const [rows, setRows] = useState<PurchaseRequestRow[]>([]);
  const [plans, setPlans] = useState<CloudPlan[]>([]);

  const load = () => {
    void pendingRequests().then(setRows).catch(fail);
  };
  useEffect(() => {
    load();
    void adminPlans().then(setPlans).catch(fail);
  }, []);

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;

  if (!rows.length) return <div className="tiny">Soʻrov yoʻq.</div>;

  return (
    <div>
      {rows.map((row) => (
        <div className="cloud-card" key={row.id}>
          <div className="between">
            <div className="grow">
              <b>{planName(row.plan_id)}</b>
              <div className="tiny">
                {row.contact || 'aloqasiz'} · {new Date(row.created_at).toLocaleString('uz-UZ')}
              </div>
            </div>
            <span className={`pill ${row.status}`}>{row.status}</span>
          </div>
          {row.status === 'pending' && (
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn mini grow"
                onClick={async () => {
                  try {
                    await decideRequest(row.id, true, 30);
                    toast('Tasdiqlandi');
                    load();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Tasdiqlash (30 kun)
              </button>
              <button
                className="btn mini ghost grow"
                onClick={async () => {
                  try {
                    await decideRequest(row.id, false);
                    load();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Rad etish
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- sozlama */

function Config() {
  const [gateway, setGateway] = useState(true);
  const [signup, setSignup] = useState(true);
  const [fallback, setFallback] = useState({ input: 30, output: 90 });
  const [admins, setAdmins] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setGateway(await getAppSetting('gateway_enabled', true));
        setSignup(await getAppSetting('signup_enabled', true));
        setFallback(await getAppSetting('fallback_price', { input: 30, output: 90 }));
        const list = await getAppSetting<string[]>('admin_emails', []);
        setAdmins(list.join(', '));
      } catch (err) {
        fail(err);
      }
    })();
  }, []);

  const save = async (key: string, value: unknown) => {
    try {
      await setAppSetting(key, value);
      toast('Saqlandi');
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div>
      <div className="row">
        <button
          className="btn ghost grow"
          onClick={() => {
            setGateway(!gateway);
            void save('gateway_enabled', !gateway);
          }}
        >
          Gateway: {gateway ? 'ishlayapti' : 'toʻxtatilgan'}
        </button>
        <button
          className="btn ghost grow"
          onClick={() => {
            setSignup(!signup);
            void save('signup_enabled', !signup);
          }}
        >
          Roʻyxat: {signup ? 'ochiq' : 'yopiq'}
        </button>
      </div>

      <div className="section-label">Zaxira narx (reja narx belgilamagan model uchun)</div>
      <div className="row">
        <label className="mini-field grow">
          kirish
          <input
            type="number"
            value={fallback.input}
            onChange={(e) => setFallback({ ...fallback, input: Number(e.target.value) })}
          />
        </label>
        <label className="mini-field grow">
          chiqish
          <input
            type="number"
            value={fallback.output}
            onChange={(e) => setFallback({ ...fallback, output: Number(e.target.value) })}
          />
        </label>
        <button className="btn mini" onClick={() => void save('fallback_price', fallback)}>
          Saqlash
        </button>
      </div>

      <div className="section-label">Admin pochtalari</div>
      <div className="row">
        <input
          className="grow"
          value={admins}
          onChange={(e) => setAdmins(e.target.value)}
          placeholder="admin@pochta.com, ikkinchi@pochta.com"
        />
        <button
          className="btn mini"
          onClick={() =>
            void save(
              'admin_emails',
              admins
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            )
          }
        >
          Saqlash
        </button>
      </div>
      <div className="tiny" style={{ marginTop: 6 }}>
        Bu pochtalar bilan yangi roʻyxatdan oʻtgan foydalanuvchi darhol admin boʻladi.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- asosiy */

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const { account } = useCloud();
  const [tab, setTab] = useState<Tab>('umumiy');

  if (!account?.is_admin) {
    return (
      <Sheet title="Admin" onClose={onClose}>
        <div className="tiny">Bu boʻlim faqat administratorlar uchun.</div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Admin panel" onClose={onClose}>
      <div className="seg-inline">
        <button className={tab === 'umumiy' ? 'on' : ''} onClick={() => setTab('umumiy')}>
          Umumiy
        </button>
        <button className={tab === 'odamlar' ? 'on' : ''} onClick={() => setTab('odamlar')}>
          Odamlar
        </button>
        <button className={tab === 'rejalar' ? 'on' : ''} onClick={() => setTab('rejalar')}>
          Rejalar
        </button>
        <button className={tab === 'sorovlar' ? 'on' : ''} onClick={() => setTab('sorovlar')}>
          Soʻrovlar
        </button>
        <button className={tab === 'sozlama' ? 'on' : ''} onClick={() => setTab('sozlama')}>
          Sozlama
        </button>
      </div>

      {tab === 'umumiy' && <Overview />}
      {tab === 'odamlar' && <Users />}
      {tab === 'rejalar' && <Plans />}
      {tab === 'sorovlar' && <Requests />}
      {tab === 'sozlama' && <Config />}
    </Sheet>
  );
}
