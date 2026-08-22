import { useEffect, useState } from 'react';
import {
  myRequests,
  refreshAccount,
  requestSubscription,
  type Plan,
  type SubscriptionRequest,
} from '../lib/account';
import { useAccount } from '../lib/useAccount';
import { Check, Crown, Mail, Phone } from './Icons';
import { Sheet, toast } from './ui';

function money(uzs: number): string {
  if (!uzs) return 'Bepul';
  return `${uzs.toLocaleString('uz-UZ').replace(/,/g, ' ')} soʻm`;
}

export function tokenLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} mln`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Oylik token holati — ustun va raqamlar. */
export function QuotaBar() {
  const { quota } = useAccount();
  if (!quota) return null;

  const total = quota.monthlyTokens || 1;
  const used = Math.min(quota.tokensUsed, total);
  const percent = Math.round((used / total) * 100);
  const low = quota.tokensLeft <= total * 0.1;

  return (
    <div className="quota">
      <div className="between">
        <span className="b">{quota.planName} tarifi</span>
        <span className={low ? 'tiny danger' : 'tiny'}>
          {tokenLabel(quota.tokensLeft)} qoldi
        </span>
      </div>
      <div className="quota-bar">
        <i className={low ? 'low' : ''} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className="tiny quota-foot">
        {tokenLabel(quota.tokensUsed)} / {tokenLabel(quota.monthlyTokens)} token · har oy yangilanadi
      </div>
    </div>
  );
}

export function PlansPanel() {
  const { plans, quota, contact } = useAccount();
  const [chosen, setChosen] = useState<Plan | null>(null);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);

  useEffect(() => {
    void myRequests().then(setRequests).catch(() => undefined);
  }, []);

  const pending = requests.find((r) => r.status === 'pending');
  const currentRank = quota?.planRank ?? 0;

  return (
    <div className="pad">
      <QuotaBar />

      {pending && (
        <div className="card notice-card">
          <b className="b">Soʻrovingiz koʻrib chiqilmoqda</b>
          <div className="muted">
            {plans.find((p) => p.code === pending.planCode)?.name ?? pending.planCode} tarifi ·{' '}
            {pending.months} oy. Admin tasdiqlashi bilan tarif ochiladi.
          </div>
        </div>
      )}

      <div className="section-label plans-label">Tariflar</div>

      {plans
        .filter((p) => p.active)
        .map((p) => {
          const active = quota?.planCode === p.code;
          return (
            <div className={active ? 'plan-row on' : 'plan-row'} key={p.code}>
              <div className="between">
                <div>
                  <b className="plan-name">{p.name}</b>
                  <div className="tiny">{p.tagline}</div>
                </div>
                <div className="plan-price">
                  {money(p.priceUzs)}
                  {p.priceUzs > 0 && <i>/oy</i>}
                </div>
              </div>

              <ul className="plan-feats">
                {p.features.map((f) => (
                  <li key={f}>
                    <Check size={13} /> {f}
                  </li>
                ))}
              </ul>

              {active ? (
                <div className="plan-current">Joriy tarifingiz</div>
              ) : p.rank > currentRank ? (
                <button className="btn wide mini" onClick={() => setChosen(p)}>
                  <Crown size={15} /> {p.name} ga oʻtish
                </button>
              ) : null}
            </div>
          );
        })}

      {chosen && (
        <RequestSheet
          plan={chosen}
          contact={contact}
          onClose={() => setChosen(null)}
          onSent={() => {
            setChosen(null);
            void myRequests().then(setRequests).catch(() => undefined);
            void refreshAccount();
          }}
        />
      )}
    </div>
  );
}

function RequestSheet({
  plan,
  contact,
  onClose,
  onSent,
}: {
  plan: Plan;
  contact: { telegram: string; phone: string; email: string } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const total = plan.priceUzs * months;

  const send = async () => {
    if (phone.trim().length < 7) {
      toast('Bogʻlanish uchun telefon yoki Telegram yozing');
      return;
    }
    setBusy(true);
    try {
      await requestSubscription({
        planCode: plan.code,
        months,
        contact: phone.trim(),
        message: message.trim(),
      });
      toast('Soʻrov yuborildi');
      onSent();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={`${plan.name} tarifi`} onClose={onClose}>
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

      <div className="sum-row">
        <span className="grow">Jami</span>
        <b>{money(total)}</b>
      </div>

      <label className="field">
        <span>Telefon yoki Telegram</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+998 90 123 45 67"
          inputMode="tel"
        />
      </label>

      <label className="field">
        <span>Qoʻshimcha (ixtiyoriy)</span>
        <textarea
          value={message}
          rows={3}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Toʻlovni qanday qilishni yozing…"
        />
      </label>

      <button className="btn wide" disabled={busy} onClick={() => void send()}>
        {busy ? 'Yuborilmoqda…' : 'Soʻrov yuborish'}
      </button>

      {(contact?.telegram || contact?.phone || contact?.email) && (
        <>
          <div className="section-label contact-label">Toʻgʻridan-toʻgʻri aloqa</div>
          <div className="contact-row">
            {contact.telegram && (
              <a className="btn ghost mini" href={contact.telegram} target="_blank" rel="noreferrer">
                Telegram
              </a>
            )}
            {contact.phone && (
              <a className="btn ghost mini" href={`tel:${contact.phone}`}>
                <Phone size={14} /> {contact.phone}
              </a>
            )}
            {contact.email && (
              <a className="btn ghost mini" href={`mailto:${contact.email}`}>
                <Mail size={14} /> Email
              </a>
            )}
          </div>
        </>
      )}

      <p className="tiny sheet-note">
        Toʻlov tasdiqlangach tarif darhol ochiladi. Pul ilova ichida yechilmaydi.
      </p>
    </Sheet>
  );
}
