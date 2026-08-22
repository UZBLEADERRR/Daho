import { useEffect, useState } from 'react';
import {
  adminModels,
  adminPlans,
  adminRequests,
  adminStats,
  adminUsers,
  approveRequest,
  deleteModel,
  grantPlan,
  readSetting,
  rejectRequest,
  resetTokens,
  saveModel,
  savePlan,
  saveSetting,
  setBlocked,
  type AdminModel,
  type AdminPlan,
  type AdminRequest,
  type AdminStats,
  type AdminUser,
} from '../../lib/admin';
import { tokenLabel } from '../PlansPanel';
import { Check, Close, Plus, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast, useConfirm } from '../ui';

type Tab = 'holat' | 'modellar' | 'tariflar' | 'sorovlar' | 'userlar' | 'aloqa';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'holat', label: 'Holat' },
  { id: 'sorovlar', label: 'Soʻrovlar' },
  { id: 'modellar', label: 'Modellar' },
  { id: 'tariflar', label: 'Tariflar' },
  { id: 'userlar', label: 'Foydalanuvchilar' },
  { id: 'aloqa', label: 'Aloqa' },
];

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('holat');

  return (
    <div className="admin">
      <div className="seg admin-seg">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'chip on' : 'chip'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll">
        <div className="pad">
          {tab === 'holat' && <StatsView />}
          {tab === 'sorovlar' && <RequestsView />}
          {tab === 'modellar' && <ModelsView />}
          {tab === 'tariflar' && <PlansView />}
          {tab === 'userlar' && <UsersView />}
          {tab === 'aloqa' && <ContactView />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatsView() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void adminStats()
      .then(setStats)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="card danger-text">{error}</div>;
  if (!stats) return <div className="muted">Yuklanmoqda…</div>;

  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-n">{stats.users}</div>
          <div className="tiny">foydalanuvchi</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.paidUsers}</div>
          <div className="tiny">obunachi</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.pending}</div>
          <div className="tiny">soʻrov</div>
        </div>
      </div>

      <div className="card admin-card">
        <div className="between">
          <span className="b">Bu oy sarflandi</span>
          <b>{tokenLabel(stats.tokensMonth)}</b>
        </div>
        <div className="between admin-row">
          <span className="muted">Bugun</span>
          <span className="muted">{tokenLabel(stats.tokensToday)}</span>
        </div>
      </div>

      <div className="section-label admin-label">Modellar boʻyicha</div>
      {stats.topModels.length === 0 ? (
        <div className="muted">Hali sarf yoʻq.</div>
      ) : (
        stats.topModels.map((m) => (
          <div className="line-row" key={m.slug}>
            <span className="grow trunc">{m.slug || '—'}</span>
            <span className="tiny">{tokenLabel(m.tokens)}</span>
          </div>
        ))
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function RequestsView() {
  const [items, setItems] = useState<AdminRequest[]>([]);
  const [busy, setBusy] = useState('');

  const load = () => void adminRequests('pending').then(setItems).catch(() => undefined);
  useEffect(load, []);

  if (!items.length) {
    return <Empty title="Yangi soʻrov yoʻq" hint="Obuna soʻrovlari shu yerda koʻrinadi." />;
  }

  const decide = async (req: AdminRequest, ok: boolean) => {
    setBusy(req.id);
    try {
      if (ok) await approveRequest(req);
      else await rejectRequest(req.id);
      toast(ok ? 'Tarif berildi' : 'Rad etildi');
      load();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      {items.map((r) => (
        <div className="card admin-card" key={r.id}>
          <div className="between">
            <b className="b trunc">{r.email || r.userId.slice(0, 8)}</b>
            <span className="chip sm accent">{r.planCode}</span>
          </div>
          <div className="muted admin-row">
            {r.months} oy · {r.contact}
          </div>
          {r.message && <div className="tiny admin-row">{r.message}</div>}
          <div className="row admin-actions">
            <button
              className="btn mini"
              disabled={busy === r.id}
              onClick={() => void decide(r, true)}
            >
              <Check size={13} /> Tasdiqlash
            </button>
            <button
              className="btn mini ghost"
              disabled={busy === r.id}
              onClick={() => void decide(r, false)}
            >
              <Close size={13} /> Rad etish
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

const EMPTY_MODEL: Partial<AdminModel> = {
  slug: '',
  name: '',
  tagline: '',
  upstreamRef: '',
  upstream: 'openrouter',
  minRank: 0,
  tokenMultiplier: 1,
  contextTokens: 32000,
  vision: false,
  tools: true,
  images: false,
  sort: 100,
  active: true,
};

function ModelsView() {
  const [items, setItems] = useState<AdminModel[]>([]);
  const [editing, setEditing] = useState<Partial<AdminModel> | null>(null);
  const confirm = useConfirm();

  const load = () => void adminModels().then(setItems).catch((e) => toast(String(e.message ?? e)));
  useEffect(load, []);

  return (
    <>
      <button className="btn wide admin-new" onClick={() => setEditing({ ...EMPTY_MODEL })}>
        <Plus size={16} /> Yangi model
      </button>

      {items.map((m) => (
        <button className="model-card" key={m.id} onClick={() => setEditing(m)}>
          <div className="between">
            <b className="b">{m.name}</b>
            <span className={m.active ? 'chip sm accent' : 'chip sm'}>
              {m.active ? `daraja ${m.minRank}` : 'oʻchiq'}
            </span>
          </div>
          <div className="tiny admin-row">{m.tagline || '—'}</div>
          <div className="upstream">{m.upstreamRef}</div>
        </button>
      ))}

      {editing && (
        <ModelEditor
          model={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onDelete={async () => {
            if (!editing.id) return;
            if (!(await confirm(`«${editing.name}» oʻchirilsinmi?`))) return;
            await deleteModel(editing.id);
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function ModelEditor({
  model,
  onClose,
  onSaved,
  onDelete,
}: {
  model: Partial<AdminModel>;
  onClose: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<Partial<AdminModel>>(model);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<AdminModel>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name?.trim()) return toast('Nom yozing');
    if (!form.upstreamRef?.trim()) return toast('OpenRouter model nomini yozing');
    const slug =
      form.slug?.trim() ||
      form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);

    setBusy(true);
    try {
      await saveModel({ ...form, slug });
      toast('Saqlandi');
      onSaved();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={form.id ? form.name || 'Model' : 'Yangi model'} onClose={onClose}>
      <label className="field">
        <span>Foydalanuvchi koʻradigan nom</span>
        <input
          value={form.name ?? ''}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="DahoX"
        />
      </label>

      <label className="field">
        <span>Qisqa izoh</span>
        <input
          value={form.tagline ?? ''}
          onChange={(e) => set({ tagline: e.target.value })}
          placeholder="Kundalik ish uchun kuchli model"
        />
      </label>

      <label className="field">
        <span>
          OpenRouter modeli <i>— faqat siz koʻrasiz</i>
        </span>
        <input
          value={form.upstreamRef ?? ''}
          onChange={(e) => set({ upstreamRef: e.target.value })}
          placeholder="qwen/qwen3-max"
          spellCheck={false}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Eng kam tarif darajasi</span>
          <input
            type="number"
            min={0}
            value={form.minRank ?? 0}
            onChange={(e) => set({ minRank: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Token koeffitsiyenti</span>
          <input
            type="number"
            step="0.1"
            min={0.1}
            value={form.tokenMultiplier ?? 1}
            onChange={(e) => set({ tokenMultiplier: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Kontekst (token)</span>
          <input
            type="number"
            value={form.contextTokens ?? 32000}
            onChange={(e) => set({ contextTokens: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Tartib</span>
          <input
            type="number"
            value={form.sort ?? 100}
            onChange={(e) => set({ sort: Number(e.target.value) })}
          />
        </label>
      </div>

      <Switch on={form.tools !== false} onChange={(v) => set({ tools: v })} label="Vositalarni qoʻllaydi" />
      <Switch on={Boolean(form.vision)} onChange={(v) => set({ vision: v })} label="Rasmni koʻradi" />
      <Switch on={Boolean(form.images)} onChange={(v) => set({ images: v })} label="Rasm chizadi" />
      <Switch on={form.active !== false} onChange={(v) => set({ active: v })} label="Yoqilgan" />

      <button className="btn wide admin-save" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>

      {form.id && (
        <button className="btn wide ghost danger-text admin-del" onClick={() => void onDelete()}>
          <Trash size={14} /> Oʻchirish
        </button>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function PlansView() {
  const [items, setItems] = useState<AdminPlan[]>([]);
  const [editing, setEditing] = useState<AdminPlan | null>(null);

  const load = () => void adminPlans().then(setItems).catch(() => undefined);
  useEffect(load, []);

  return (
    <>
      {items.map((p) => (
        <button className="model-card" key={p.id} onClick={() => setEditing(p)}>
          <div className="between">
            <b className="b">{p.name}</b>
            <span className="chip sm">daraja {p.rank}</span>
          </div>
          <div className="tiny admin-row">
            {p.priceUzs.toLocaleString('uz-UZ').replace(/,/g, ' ')} soʻm ·{' '}
            {tokenLabel(p.monthlyTokens)} token
          </div>
        </button>
      ))}

      {editing && (
        <PlanEditor
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function PlanEditor({
  plan,
  onClose,
  onSaved,
}: {
  plan: AdminPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(plan);
  const [feats, setFeats] = useState(plan.features.join('\n'));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await savePlan({
        ...form,
        features: feats.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      toast('Saqlandi');
      onSaved();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={form.name} onClose={onClose}>
      <label className="field">
        <span>Nom</span>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>

      <label className="field">
        <span>Izoh</span>
        <input
          value={form.tagline}
          onChange={(e) => setForm({ ...form, tagline: e.target.value })}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Narx (soʻm/oy)</span>
          <input
            type="number"
            value={form.priceUzs}
            onChange={(e) => setForm({ ...form, priceUzs: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span>Oylik token</span>
          <input
            type="number"
            value={form.monthlyTokens}
            onChange={(e) => setForm({ ...form, monthlyTokens: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="field">
        <span>
          Imkoniyatlar <i>— har qatorda bittadan</i>
        </span>
        <textarea rows={5} value={feats} onChange={(e) => setFeats(e.target.value)} />
      </label>

      <Switch
        on={form.active}
        onChange={(v) => setForm({ ...form, active: v })}
        label="Koʻrsatilsin"
      />

      <button className="btn wide admin-save" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function UsersView() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [chosen, setChosen] = useState<AdminUser | null>(null);

  const load = (q: string) => void adminUsers(q).then(setItems).catch(() => undefined);

  useEffect(() => {
    void adminPlans().then(setPlans).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => load(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      <input
        className="admin-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Email yoki ism boʻyicha qidirish"
      />

      {items.map((u) => (
        <button className="model-card" key={u.id} onClick={() => setChosen(u)}>
          <div className="between">
            <b className="b trunc">{u.email}</b>
            <span className={u.blocked ? 'chip sm danger-text' : 'chip sm accent'}>
              {u.blocked ? 'bloklangan' : u.planCode}
            </span>
          </div>
          <div className="tiny admin-row">
            {u.fullName || '—'} · {tokenLabel(u.tokensUsed)} token
            {u.role === 'admin' ? ' · admin' : ''}
          </div>
        </button>
      ))}

      {chosen && (
        <UserSheet
          user={chosen}
          plans={plans}
          onClose={() => setChosen(null)}
          onChanged={() => {
            setChosen(null);
            load(query);
          }}
        />
      )}
    </>
  );
}

function UserSheet({
  user,
  plans,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  plans: AdminPlan[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [plan, setPlan] = useState(user.planCode);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast(message);
      onChanged();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={user.email} onClose={onClose}>
      <div className="field">
        <span>Tarif</span>
        <div className="chips">
          {plans.map((p) => (
            <button
              key={p.code}
              className={plan === p.code ? 'chip on' : 'chip'}
              onClick={() => setPlan(p.code)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Muddat</span>
        <div className="chips">
          {[1, 3, 6, 12].map((m) => (
            <button
              key={m}
              className={months === m ? 'chip on' : 'chip'}
              onClick={() => setMonths(m)}
            >
              {m} oy
            </button>
          ))}
        </div>
      </div>

      <button
        className="btn wide"
        disabled={busy}
        onClick={() => void run(() => grantPlan(user.id, plan, months), 'Tarif berildi')}
      >
        Tarifni berish
      </button>

      <div className="row admin-actions">
        <button
          className="btn mini ghost"
          disabled={busy}
          onClick={() => void run(() => resetTokens(user.id), 'Token hisobi tozalandi')}
        >
          Tokenni tiklash
        </button>
        <button
          className="btn mini ghost danger-text"
          disabled={busy}
          onClick={() =>
            void run(
              () => setBlocked(user.id, !user.blocked),
              user.blocked ? 'Blokdan chiqarildi' : 'Bloklandi',
            )
          }
        >
          {user.blocked ? 'Blokdan chiqarish' : 'Bloklash'}
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */

function ContactView() {
  const [contact, setContact] = useState({ telegram: '', phone: '', email: '' });
  const [links, setLinks] = useState({ apk: '', extension: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readSetting('contact', contact).then(setContact);
    void readSetting('downloads', links).then(setLinks);
    // Bir marta yuklanadi — bogʻliqlik roʻyxati ataylab boʻsh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await saveSetting('contact', contact);
      await saveSetting('downloads', links);
      toast('Saqlandi');
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section-label admin-label-first">Aloqa — foydalanuvchi shu yerga yozadi</div>

      <label className="field">
        <span>Telegram havolasi</span>
        <input
          value={contact.telegram}
          onChange={(e) => setContact({ ...contact, telegram: e.target.value })}
          placeholder="https://t.me/username"
        />
      </label>

      <label className="field">
        <span>Telefon</span>
        <input
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          placeholder="+998 90 123 45 67"
        />
      </label>

      <label className="field">
        <span>Email</span>
        <input
          value={contact.email}
          onChange={(e) => setContact({ ...contact, email: e.target.value })}
        />
      </label>

      <div className="section-label admin-label">Yuklab olish havolalari</div>

      <label className="field">
        <span>APK</span>
        <input
          value={links.apk}
          onChange={(e) => setLinks({ ...links, apk: e.target.value })}
          placeholder="https://…/daho.apk"
        />
      </label>

      <label className="field">
        <span>Kengaytma</span>
        <input
          value={links.extension}
          onChange={(e) => setLinks({ ...links, extension: e.target.value })}
          placeholder="https://chromewebstore.google.com/…"
        />
      </label>

      <button className="btn wide" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </>
  );
}
