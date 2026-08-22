import { useEffect, useMemo, useState } from 'react';
import {
  formatCredits,
  usageWindows,
  whoami,
  type UsageWindows,
  type WindowState,
  formatPrice,
  publicPlans,
  refreshAccount,
  requestPlan,
  signIn,
  signInWithLink,
  changePassword,
  saveProfile,
  signOut,
  signUp,
  resetPassword,
  useCloud,
  type CloudPlan,
} from '../../lib/cloud';
import { recentUsage } from '../../lib/cloud/admin';
import {
  JOB_LABEL,
  backgroundAllowed,
  cancelJob,
  deleteJob,
  enqueueJob,
  listJobs,
  watchJobs,
  type JobKind,
} from '../../lib/cloud/jobs';
import type { CloudJob, UsageRow } from '../../lib/cloud/types';
import { clearSyncShadow, getSyncState, subscribeSync, syncNow } from '../../lib/cloud/sync';
import { setState } from '../../lib/store';
import { uid } from '../../lib/utils';
import type { Note } from '../../lib/types';
import { Sheet, toast } from '../ui';

type Tab = 'hisob' | 'rejalar' | 'sarf' | 'fon';

/* ---------------------------------------------------------------- kirish */

function AuthForm() {
  const [mode, setMode] = useState<'kirish' | 'royxat'>('kirish');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || (mode === 'kirish' ? !password : password.length < 6)) {
      toast('Pochta va kamida 6 belgili parol kerak');
      return;
    }
    setBusy(true);
    const res =
      mode === 'kirish' ? await signIn(email, password) : await signUp(email, password, name);
    setBusy(false);
    toast(res.message);
  };

  return (
    <div>
      <div className="seg-inline">
        <button className={mode === 'kirish' ? 'on' : ''} onClick={() => setMode('kirish')}>
          Kirish
        </button>
        <button className={mode === 'royxat' ? 'on' : ''} onClick={() => setMode('royxat')}>
          Roʻyxatdan oʻtish
        </button>
      </div>

      {mode === 'royxat' && (
        <div className="field">
          <label>Ismingiz</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ism Familiya" />
        </div>
      )}

      <div className="field">
        <label>Pochta</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="siz@pochta.com"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>Parol</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••"
        />
      </div>

      <button className="btn wide" onClick={() => void submit()} disabled={busy}>
        {busy ? 'Kutilmoqda…' : mode === 'kirish' ? 'Kirish' : 'Hisob yaratish'}
      </button>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn ghost mini grow"
          onClick={async () => {
            if (!email.trim()) return toast('Avval pochtani yozing');
            toast((await signInWithLink(email)).message);
          }}
        >
          Parolsiz kirish
        </button>
        <button
          className="btn ghost mini grow"
          onClick={async () => {
            if (!email.trim()) return toast('Avval pochtani yozing');
            toast((await resetPassword(email)).message);
          }}
        >
          Parolni unutdim
        </button>
      </div>

      <div className="tiny" style={{ marginTop: 12 }}>
        Hisob ochmasangiz ham ilova toʻliq ishlaydi — Sozlamalarga oʻz Gemini kalitingizni
        kiritsangiz kifoya. Hisob kerak boʻladi: maʼlumot sinxronizatsiyasi, obuna modellari
        va fon vazifalari uchun.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- hisob */

/**
 * Limitlar — foizda.
 *
 * Foydalanuvchiga token yoki kredit soni koʻrsatilmaydi: u raqamning nimani
 * anglatishini bilmaydi va bekorga xavotir oladi. Oʻrniga «soatlik limit:
 * 80% qoldi» degan tushunarli koʻrsatkich turadi.
 */
const ROLE_WORD: Record<string, string> = {
  chat: 'suhbat',
  image: 'rasm',
  tts: 'ovoz',
  video: 'video',
  other: 'boshqa',
};

/**
 * Model qanchalik «qimmat» ekanini soʻz bilan aytadi.
 *
 * Aniq kredit narxi foydalanuvchiga hech narsa demaydi, lekin qaysi model
 * limitni tez yeyishini bilishi kerak — shuning uchun uch daraja.
 */
function costWord(m: { output_price: number; call_price: number }): string {
  const price = Number(m.output_price ?? 0) + Number(m.call_price ?? 0) * 10;
  if (price >= 200) return 'limitni tez yeydi';
  if (price >= 60) return 'oʻrtacha';
  return 'tejamkor';
}

/**
 * «Admin panel qayerda?» degan savolga javob.
 *
 * Admin faqat `admin_emails` roʻyxati orqali beriladi. Foydalanuvchi
 * oʻzining holatini koʻra olsin va nima qilish kerakligini bilsin.
 */
function AdminHint({ email: sessionEmail }: { email: string }) {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        className="tiny admin-hint-toggle"
        onClick={() => {
          setOpen(true);
          void whoami().then(setInfo).catch(() => undefined);
        }}
      >
        Admin panel koʻrinmayaptimi?
      </button>
    );
  }

  const emails = (info?.admin_emails as string[] | null) ?? [];
  const email = String(info?.email ?? '') || sessionEmail;
  const role = String(info?.role ?? '');
  /*
   * Rol boʻsh boʻlsa `public.profiles` da qator yoʻq degani: odam
   * migratsiyalar ishga tushishidan oldin roʻyxatdan oʻtgan. Bunday
   * holatda `claim_admin` ham ishlamaydi — avval sxemani yangilash kerak.
   */
  const profilYoq = info !== null && role === '';

  return (
    <div className="card admin-hint">
      <div className="tiny">
        Roling: <b>{role || (info === null ? '…' : 'yoʻq')}</b> · tizimda{' '}
        <b>{String(info?.admin_count ?? '…')}</b> ta admin bor.
      </div>
      {profilYoq ? (
        <>
          <div className="tiny admin-hint-row">
            Bazada profilingiz yaratilmagan — hisobingiz sxema oʻrnatilishidan
            oldin ochilgan.
          </div>
          <div className="tiny admin-hint-row">
            Supabase → SQL Editor da <b>supabase/setup.sql</b> faylini bir marta
            ishga tushiring, soʻng chiqib qayta kiring.
          </div>
        </>
      ) : (
        <>
          <div className="tiny admin-hint-row">
            {emails.includes(email.toLowerCase())
              ? 'Pochtangiz admin roʻyxatida bor — chiqib qayta kiring.'
              : 'Pochtangiz admin roʻyxatida yoʻq.'}
          </div>
          <div className="tiny admin-hint-row">
            Supabase → SQL Editor da bir qator yozing:
          </div>
          <code className="admin-hint-sql">
            select public.claim_admin('{email || 'pochtangiz'}');
          </code>
        </>
      )}
    </div>
  );
}

function LimitBars() {
  const [win, setWin] = useState<UsageWindows | null>(null);

  useEffect(() => {
    void usageWindows().then(setWin).catch(() => undefined);
  }, []);

  if (!win) return null;

  const rows: Array<[string, WindowState]> = [
    ['Soatlik', win.hour],
    ['Kunlik', win.day],
    ['Haftalik', win.week],
    ['Obuna davri', win.period],
  ];

  const visible = rows.filter(([, w]) => !w.unlimited);
  const daily = win.daily_model;

  return (
    <div className="limits">
      {visible.length === 0 ? (
        <div className="tiny">Limitsiz reja — cheklov yoʻq.</div>
      ) : (
        visible.map(([label, w]) => (
          <div className="limit" key={label}>
            <div className="between tiny">
              <span>{label}</span>
              <b className={w.left_percent <= 15 ? 'danger-text' : ''}>{w.left_percent}%</b>
            </div>
            <div className="meter">
              <i
                className={w.left_percent <= 15 ? 'low' : ''}
                style={{ width: `${w.left_percent}%` }}
              />
            </div>
          </div>
        ))
      )}

      {win.wallet > 0 && (
        <div className="tiny limits-note">
          Hisobingizda <b>{formatPrice(Math.round(win.wallet))}</b> — limit tugasa shundan
          ishlatiladi.
        </div>
      )}

      {daily.access !== 'none' && (
        <div className="tiny limits-note">
          Limit tugasa <b>Daho Daily</b> modeli ishlaydi
          {daily.access === 'unlimited'
            ? ' — cheksiz, lekin sekinroq.'
            : ` — bugun ${Math.max(daily.quota - daily.used, 0)} ta xabar qoldi.`}
        </div>
      )}
    </div>
  );
}

/**
 * Profil — ism, parol va chiqish.
 *
 * Avval ism faqat roʻyxatdan oʻtishda soʻralardi va keyin uni
 * oʻzgartirishning iloji yoʻq edi; parolni almashtirish ham yoʻq edi.
 */
function ProfileBlock() {
  const { account } = useCloud();
  const [name, setName] = useState(account?.full_name ?? '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  if (!account) return null;

  const save = async () => {
    setBusy(true);
    setNote('');
    try {
      if (name.trim() !== (account.full_name ?? '')) {
        const res = await saveProfile(name);
        if (!res.ok) throw new Error(res.message);
      }
      if (pass) {
        const res = await changePassword(pass);
        if (!res.ok) throw new Error(res.message);
        setPass('');
      }
      setNote('Saqlandi');
    } catch (err) {
      setNote(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section-label set-label">Profil</div>

      <label className="field">
        <span>Ism va familya</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sarvarbek Sanjarivich"
          autoComplete="name"
        />
      </label>

      <label className="field">
        <span>Pochta <i>— oʻzgartirib boʻlmaydi</i></span>
        <input value={account.email} readOnly disabled />
      </label>

      <label className="field">
        <span>Yangi parol</span>
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Oʻzgartirmasangiz boʻsh qoldiring"
          autoComplete="new-password"
        />
      </label>

      {note && <div className="tiny set-hint">{note}</div>}

      <button className="btn wide" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </>
  );
}

function AccountTab({ onOpenAdmin }: { onOpenAdmin?: () => void }) {
  const { account } = useCloud();
  const [sync, setSync] = useState(getSyncState());

  useEffect(() => subscribeSync(() => setSync(getSyncState())), []);

  if (!account) return null;

  return (
    <div>
      <div className="cloud-card">
        <div className="between">
          <div>
            <b>{account.full_name || account.email}</b>
            <div className="tiny">{account.email}</div>
          </div>
          <span className="pill">{account.plan?.name ?? 'Rejasiz'}</span>
        </div>

        <LimitBars />
      </div>

      {account.is_admin && onOpenAdmin && (
        <button className="btn wide admin-entry" onClick={onOpenAdmin}>
          Admin panel
        </button>
      )}

      {!account.is_admin && <AdminHint email={account.email} />}

      <ProfileBlock />

      <div className="stat-grid">
        <div className="stat">
          <span>{account.models.length}</span>
          Ochiq model
        </div>
        <div className="stat">
          <span>{account.active_jobs}</span>
          Fon vazifasi
        </div>
      </div>

      <div className="section-label">Ochiq modellar</div>
      {account.models.length === 0 && (
        <div className="tiny">Rejangizda model ochilmagan. Adminga murojaat qiling.</div>
      )}
      {account.models.map((m) => (
        <div className="line-row" key={m.model}>
          <div className="grow">
            <div>{m.model}</div>
            <div className="tiny">{costWord(m)} · {ROLE_WORD[m.role] ?? m.role}</div>
          </div>
          {account.is_admin && (
            <span className="pill soft">{formatCredits(m.output_price)}</span>
          )}
        </div>
      ))}

      <div className="section-label">Sinxronizatsiya</div>
      <div className="tiny">
        Holat: {sync.phase}
        {sync.lastAt ? ` · oxirgi: ${new Date(sync.lastAt).toLocaleTimeString('uz-UZ')}` : ''}
        {sync.skipped ? ` · ${sync.skipped} ta katta element yuborilmadi` : ''}
        {sync.error ? ` · xato: ${sync.error}` : ''}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost mini grow" onClick={() => void syncNow()}>
          Hozir sinxronlash
        </button>
        <button className="btn ghost mini grow" onClick={() => void refreshAccount()}>
          Hisobni yangilash
        </button>
      </div>

      <button
        className="btn ghost wide"
        style={{ marginTop: 14 }}
        onClick={async () => {
          await signOut();
          clearSyncShadow();
          toast('Hisobdan chiqdingiz');
        }}
      >
        Chiqish
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- rejalar */

function PlansTab() {
  const { account } = useCloud();
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void publicPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const send = async (plan: CloudPlan) => {
    if (!contact.trim()) {
      toast('Bogʻlanish uchun telefon yoki Telegram yozing');
      return;
    }
    setBusy(plan.id);
    try {
      await requestPlan(plan.id, contact.trim());
      toast('Soʻrov yuborildi — admin tasdiqlagach reja ochiladi');
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div className="field">
        <label>Bogʻlanish uchun (telefon yoki Telegram)</label>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="+998 90 123 45 67"
        />
      </div>

      {plans.map((plan) => {
        const current = account?.plan?.id === plan.id;
        return (
          <div className={current ? 'plan-card on' : 'plan-card'} key={plan.id}>
            <div className="between">
              <b>{plan.name}</b>
              <span className="price">{formatPrice(plan.price_cents, plan.currency)}</span>
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {plan.description}
            </div>
            <ul className="plan-list">
              <li>Oyiga {formatCredits(plan.credit_grant)} kredit</li>
              {plan.daily_credit_cap ? (
                <li>Kunlik chegara: {formatCredits(plan.daily_credit_cap)}</li>
              ) : (
                <li>Kunlik chegarasiz</li>
              )}
              <li>
                {plan.allow_background
                  ? `Fon vazifalari: kuniga ${plan.max_jobs_per_day} ta`
                  : 'Fon vazifalari yoʻq'}
              </li>
            </ul>
            {current ? (
              <div className="pill" style={{ marginTop: 8 }}>
                Joriy reja
              </div>
            ) : (
              <button
                className="btn wide"
                style={{ marginTop: 8 }}
                disabled={busy === plan.id}
                onClick={() => void send(plan)}
              >
                {busy === plan.id ? 'Yuborilmoqda…' : 'Soʻrov yuborish'}
              </button>
            )}
          </div>
        );
      })}

      <div className="tiny" style={{ marginTop: 10 }}>
        Toʻlov qabul qilinganidan soʻng admin rejani ochadi. Xohlasangiz obunasiz —
        oʻz Gemini kalitingiz bilan ham ishlashingiz mumkin.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sarf */

function UsageTab() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void recentUsage(undefined, 60)
      .then(setRows)
      .catch((err) => setError(String(err?.message ?? err)));
  }, []);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          tokens: acc.tokens + (r.total_tokens ?? 0),
          credits: acc.credits + Number(r.credits ?? 0),
        }),
        { tokens: 0, credits: 0 },
      ),
    [rows],
  );

  if (error) return <div className="tiny">Xato: {error}</div>;
  if (!rows.length) return <div className="tiny">Hali sarf yoʻq.</div>;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat">
          <span>{totals.tokens.toLocaleString('ru-RU')}</span>
          Token (oxirgi 60 ta)
        </div>
        <div className="stat">
          <span>{formatCredits(totals.credits)}</span>
          Kredit
        </div>
      </div>

      {rows.map((row) => (
        <div className="line-row" key={row.id}>
          <div className="grow">
            <div>{row.model || row.kind}</div>
            <div className="tiny">
              {new Date(row.created_at).toLocaleString('uz-UZ')} · {row.kind} · {row.source}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>{formatCredits(row.credits)}</div>
            <div className="tiny">
              {row.input_tokens}↑ {row.output_tokens}↓
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- fon */

const KINDS: JobKind[] = ['chat', 'search', 'plan', 'json', 'image'];

function JobsTab() {
  const { account } = useCloud();
  const [jobs, setJobs] = useState<CloudJob[]>([]);
  const [kind, setKind] = useState<JobKind>('chat');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = backgroundAllowed();

  const reload = () => {
    void listJobs()
      .then(setJobs)
      .catch(() => undefined);
  };

  useEffect(() => {
    reload();
    return watchJobs((job) => {
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== job.id);
        return [job, ...next];
      });
      if (job.status === 'done') toast(`Fon vazifasi tayyor: ${job.title || job.kind}`);
    });
  }, []);

  const create = async () => {
    if (!prompt.trim()) {
      toast('Vazifa matnini yozing');
      return;
    }
    setBusy(true);
    try {
      const job = await enqueueJob(kind, title.trim() || prompt.slice(0, 60), {
        prompt: prompt.trim(),
      });
      setJobs((prev) => [job, ...prev]);
      setPrompt('');
      setTitle('');
      toast('Navbatga qoʻyildi — ilovani yopsangiz ham bajariladi');
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const saveToNotes = (job: CloudJob) => {
    const text = String((job.result as { text?: string })?.text ?? '');
    if (!text) return;
    const note: Note = {
      id: uid('note'),
      title: job.title || 'Fon vazifasi',
      content: text,
      subject: 'Fon',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setState((s) => ({ notes: [note, ...s.notes] }));
    toast('Konspektga saqlandi');
  };

  if (!account?.signed_in) return null;

  return (
    <div>
      {!allowed && (
        <div className="cloud-card warn">
          Fon vazifalari obunada ochiladi. «Rejalar» boʻlimidan mos rejani tanlang.
        </div>
      )}

      <div className="field">
        <label>Vazifa turi</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as JobKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {JOB_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Nomi (ixtiyoriy)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="IELTS reja" />
      </div>

      <div className="field">
        <label>Topshiriq</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Masalan: IELTS 7.0 uchun 8 haftalik tayyorgarlik rejasini tuz."
        />
      </div>

      <button className="btn wide" disabled={busy || !allowed} onClick={() => void create()}>
        {busy ? 'Yuborilmoqda…' : 'Navbatga qoʻyish'}
      </button>

      <div className="section-label">Vazifalar</div>
      {jobs.length === 0 && <div className="tiny">Hali fon vazifasi yoʻq.</div>}

      {jobs.map((job) => (
        <div className="cloud-card" key={job.id}>
          <div className="between">
            <b>{job.title || JOB_LABEL[job.kind]}</b>
            <span className={`pill ${job.status}`}>{job.status}</span>
          </div>
          <div className="tiny">
            {new Date(job.created_at).toLocaleString('uz-UZ')} · {JOB_LABEL[job.kind]}
            {job.credits ? ` · ${formatCredits(job.credits)} kredit` : ''}
          </div>

          {job.error && <div className="tiny error">{job.error}</div>}

          {job.status === 'done' && job.result?.kind === 'image' && (
            <img
              className="job-image"
              alt={job.title}
              src={`data:${job.result.mimeType};base64,${job.result.data}`}
            />
          )}

          {job.status === 'done' && typeof job.result?.text === 'string' && (
            <div className="job-text">{String(job.result.text).slice(0, 1200)}</div>
          )}

          {job.status === 'done' && job.result && job.result.kind !== 'image' &&
            typeof job.result.text !== 'string' && (
              <pre className="job-text">{JSON.stringify(job.result.data, null, 2).slice(0, 1200)}</pre>
            )}

          <div className="row" style={{ marginTop: 8 }}>
            {job.status === 'done' && typeof job.result?.text === 'string' && (
              <button className="btn ghost mini" onClick={() => saveToNotes(job)}>
                Konspektga saqlash
              </button>
            )}
            {job.status === 'queued' && (
              <button
                className="btn ghost mini"
                onClick={async () => {
                  await cancelJob(job.id);
                  reload();
                }}
              >
                Bekor qilish
              </button>
            )}
            <button
              className="btn ghost mini"
              onClick={async () => {
                await deleteJob(job.id);
                setJobs((prev) => prev.filter((j) => j.id !== job.id));
              }}
            >
              Oʻchirish
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- asosiy */

export function AccountSheet({
  onClose,
  onOpenAdmin,
}: {
  onClose: () => void;
  onOpenAdmin?: () => void;
}) {
  const { status, account, error } = useCloud();
  const [tab, setTab] = useState<Tab>('hisob');

  if (status === 'off') {
    return (
      <Sheet title="Daho Cloud" onClose={onClose}>
        <div className="tiny">
          Bulut xizmati bu nusxada sozlanmagan. Ilova toʻliq mahalliy rejimda ishlaydi —
          Sozlamalarga oʻz Gemini kalitingizni kiriting.
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Daho Cloud" onClose={onClose}>
      {status === 'yuklanmoqda' && <div className="tiny">Yuklanmoqda…</div>}

      {/* Xato boʻlsa jim turmaydi — sababi va nima qilish kerakligi yoziladi. */}
      {error && <div className="auth-error cloud-error">{error}</div>}

      {status === 'kirilmagan' && <AuthForm />}

      {status === 'kirgan' && account && (
        <>
          <div className="seg-inline">
            <button className={tab === 'hisob' ? 'on' : ''} onClick={() => setTab('hisob')}>
              Hisob
            </button>
            <button className={tab === 'rejalar' ? 'on' : ''} onClick={() => setTab('rejalar')}>
              Rejalar
            </button>
            <button className={tab === 'sarf' ? 'on' : ''} onClick={() => setTab('sarf')}>
              Sarf
            </button>
            <button className={tab === 'fon' ? 'on' : ''} onClick={() => setTab('fon')}>
              Fon
            </button>
          </div>

          {tab === 'hisob' && <AccountTab onOpenAdmin={onOpenAdmin} />}
          {tab === 'rejalar' && <PlansTab />}
          {tab === 'sarf' && <UsageTab />}
          {tab === 'fon' && <JobsTab />}
        </>
      )}
    </Sheet>
  );
}
