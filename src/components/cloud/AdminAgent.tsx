/**
 * Admin AI — panelni gap bilan boshqarish.
 *
 * Buyruq yoziladi, agent REJA tuzadi, reja ekranda koʻrinadi va faqat
 * «Bajarish» bosilgandan keyin ishga tushadi. Ataylab shunday: model
 * xato tushunsa, tarif yoki narxni jimgina buzib qoʻymasin.
 */
import { useEffect, useState } from 'react';
import {
  amalMatni,
  amallarniBajar,
  holatniOl,
  rejaTuz,
  type Amal,
  type Holat,
  type Natija,
} from '../../lib/cloud/adminagent';
import { toast } from '../ui';

const NAMUNALAR = [
  'Eng arzon uchta model qoʻsh: Daho Tez, Daho Aql, Daho Kuch — hammasini Pro ga ul',
  'Bepul tarifga bitta arzon model ochib ber',
  'Kutayotgan arizalarni koʻrib chiq va tasdiqla',
  'Ustamani 2.5 ga oʻzgartir',
];

export function AdminAgent() {
  const [holat, setHolat] = useState<Holat | null>(null);
  const [buyruq, setBuyruq] = useState('');
  const [javob, setJavob] = useState('');
  const [amallar, setAmallar] = useState<Amal[]>([]);
  const [natijalar, setNatijalar] = useState<Natija[] | null>(null);
  const [ish, setIsh] = useState<'' | 'oʻylayapti' | 'bajaryapti'>('');

  const yukla = () => {
    void holatniOl()
      .then(setHolat)
      .catch((err) => toast(String((err as Error)?.message ?? err)));
  };
  useEffect(yukla, []);

  const soʻra = async (matn: string) => {
    if (!holat) return;
    const q = matn.trim();
    if (q.length < 4) {
      toast('Buyruqni yozing');
      return;
    }
    setIsh('oʻylayapti');
    setNatijalar(null);
    setAmallar([]);
    setJavob('');
    try {
      const reja = await rejaTuz(q, holat);
      setJavob(reja.javob);
      setAmallar(reja.amallar);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setIsh('');
    }
  };

  const bajar = async () => {
    if (!holat || !amallar.length) return;
    setIsh('bajaryapti');
    try {
      const out = await amallarniBajar(amallar, holat);
      setNatijalar(out);
      setAmallar([]);
      // Holat oʻzgardi — qaytadan oʻqiymiz, keyingi buyruq yangisini koʻrsin.
      yukla();
      const xato = out.filter((n) => !n.ok).length;
      toast(xato ? `${out.length - xato} ta bajarildi, ${xato} ta xato` : 'Bajarildi');
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setIsh('');
    }
  };

  return (
    <div>
      <div className="section-label">Admin AI</div>
      <div className="tiny" style={{ marginBottom: 10 }}>
        Nima qilish kerakligini oddiy gap bilan yozing. Avval reja koʻrsatiladi —
        siz tasdiqlamaguningizcha hech narsa oʻzgarmaydi.
      </div>

      {holat && (
        <div className="tiny" style={{ marginBottom: 10, opacity: 0.75 }}>
          Hozir: {holat.models.length} model · {holat.plans.length} tarif ·{' '}
          {holat.requests.length} ariza · katalogda {holat.catalog.length} nomzod
        </div>
      )}

      <div className="row">
        <input
          className="grow"
          value={buyruq}
          onChange={(e) => setBuyruq(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void soʻra(buyruq);
          }}
          placeholder="Masalan: eng arzon model qoʻsh va Pro ga ul"
          disabled={!holat || ish !== ''}
        />
        <button className="btn mini" disabled={!holat || ish !== ''} onClick={() => void soʻra(buyruq)}>
          {ish === 'oʻylayapti' ? 'Oʻylayapti…' : 'Soʻrash'}
        </button>
      </div>

      {!buyruq && !javob && (
        <div className="agent-hints">
          {NAMUNALAR.map((n) => (
            <button
              key={n}
              className="agent-hint"
              onClick={() => {
                setBuyruq(n);
                void soʻra(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {javob && (
        <div className="cloud-card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>{javob}</div>

          {amallar.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 12 }}>
                Bajariladi ({amallar.length})
              </div>
              <ol className="agent-steps">
                {holat &&
                  amallar.map((a, i) => (
                    <li key={i}>{amalMatni(a, holat)}</li>
                  ))}
              </ol>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn mini grow"
                  disabled={ish !== ''}
                  onClick={() => void bajar()}
                >
                  {ish === 'bajaryapti' ? 'Bajarilmoqda…' : 'Bajarish'}
                </button>
                <button
                  className="btn ghost mini grow"
                  disabled={ish !== ''}
                  onClick={() => {
                    setAmallar([]);
                    setJavob('');
                  }}
                >
                  Bekor
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {natijalar && (
        <>
          <div className="section-label" style={{ marginTop: 12 }}>
            Natija
          </div>
          {natijalar.map((n, i) => (
            <div className="cloud-card" key={i}>
              <div className="between">
                <span style={{ minWidth: 0 }}>{n.matn}</span>
                <span className={n.ok ? 'pill' : 'pill error'}>{n.ok ? 'ok' : 'xato'}</span>
              </div>
              {n.xato && (
                <div className="tiny error" style={{ marginTop: 4 }}>
                  {n.xato}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
