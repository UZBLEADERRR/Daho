import { useEffect, useMemo, useState } from 'react';
import {
  formatCredits,
  formatPrice,
  publicPlans,
  refreshAccount,
  requestPlan,
  signIn,
  signInWithLink,
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

function AccountTab() {
  const { account } = useCloud();
  const [sync, setSync] = useState(getSyncState());

  useEffect(() => subscribeSync(() => setSync(getSyncState())), []);

  if (!account) return null;
  const used = Number(account.used ?? 0);
  const granted = Number(account.granted ?? 0) || 1;
  const percent = Math.min(100, Math.round((used / granted) * 100));

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

        <div className="meter" style={{ marginTop: 12 }}>
          <i style={{ width: `${percent}%` }} />
        </div>
        <div className="between tiny" style={{ marginTop: 6 }}>
          <span>
            Qolgan kredit: <b>{formatCredits(account.balance)}</b>
          </span>
          <span>
            {formatCredits(used)} / {formatCredits(granted)}
          </span>
        </div>
        {account.period_end && (
          <div className="tiny" style={{ marginTop: 4 }}>
            Yangilanish: {new Date(account.period_end).toLocaleDateString('uz-UZ')}
          </div>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <span>{formatCredits(account.usage_today)}</span>
          Bugun
        </div>
        <div className="stat">
          <span>{formatCredits(account.usage_month)}</span>
          Shu oy
        </div>
        <div className="stat">
          <span>{account.models.length}</span>
          Ochiq model
        </div>
        <div className="stat">
          <span>{account.active_jobs}</span>
          Fon vazifasi
        </div>
      </div>

      <div className="section-label">Ochiq modellar va narxi</div>
      {account.models.length === 0 && (
        <div className="tiny">Rejangizda model ochilmagan. Adminga murojaat qiling.</div>
      )}
      {account.models.map((m) => (
        <div className="line-row" key={m.model}>
          <div className="grow">
            <div>{m.model}</div>
            <div className="tiny">
              1M kirish: {formatCredits(m.input_price)} · 1M chiqish:{' '}
              {formatCredits(m.output_price)}
              {m.call_price > 0 ? ` · chaqiruv: ${formatCredits(m.call_price)}` : ''}
            </div>
          </div>
          <span className="pill soft">{m.role}</span>
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

export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { status, account } = useCloud();
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

          {tab === 'hisob' && <AccountTab />}
          {tab === 'rejalar' && <PlansTab />}
          {tab === 'sarf' && <UsageTab />}
          {tab === 'fon' && <JobsTab />}
        </>
      )}
    </Sheet>
  );
}
