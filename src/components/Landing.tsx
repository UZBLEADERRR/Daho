import { useEffect, useState } from 'react';
import { fetchDownloads, fetchPlans, type Plan } from '../lib/account';
import { Bolt, Book, Chart, Code, Download, Globe, Puzzle, Shield } from './Icons';

const FEATURES = [
  {
    icon: <Bolt size={20} />,
    title: 'Suhbat',
    text: 'Ovoz, rasm va fayl bilan ishlaydi. Javob uzilib qolsa oʻzi davom ettiradi.',
  },
  {
    icon: <Book size={20} />,
    title: 'Kitob yozish',
    text: 'Savol berib rejasini tuzadi, boblarni ketma-ket yozadi, muqova chizadi.',
  },
  {
    icon: <Code size={20} />,
    title: 'Daho Code',
    text: 'Haqiqiy loyihalar: reja, fayllar, skrinshot va oʻz-oʻzini tekshirish.',
  },
  {
    icon: <Chart size={20} />,
    title: 'Agent',
    text: 'Jadval, vazifa, konspekt va har kuni oʻzi bajariladigan topshiriqlar.',
  },
  {
    icon: <Globe size={20} />,
    title: 'Hamma joyda',
    text: 'Telefon, veb va brauzer kengaytmasi — suhbatlar sinxron turadi.',
  },
  {
    icon: <Shield size={20} />,
    title: 'Sozlash shart emas',
    text: 'API kaliti kerak emas. Kirdingiz — modellar darhol ishlaydi.',
  },
];

function money(uzs: number): string {
  if (!uzs) return 'Bepul';
  return `${uzs.toLocaleString('uz-UZ').replace(/,/g, ' ')} soʻm`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)} mln`;
  if (n >= 1000) return `${Math.round(n / 1000)} ming`;
  return String(n);
}

export function Landing({ onStart }: { onStart: (mode: 'kirish' | 'royxat') => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [links, setLinks] = useState({ apk: '', extension: '' });

  useEffect(() => {
    void fetchPlans().then(setPlans).catch(() => undefined);
    void fetchDownloads().then(setLinks).catch(() => undefined);
  }, []);

  const apk = links.apk || import.meta.env.VITE_APK_URL || '';
  const ext = links.extension || import.meta.env.VITE_EXTENSION_URL || '';

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-brand">
          Daho<span>.</span>
        </div>
        <nav className="lp-links">
          <a href="#imkoniyatlar">Imkoniyatlar</a>
          <a href="#tariflar">Tariflar</a>
          <a href="#yuklash">Yuklab olish</a>
        </nav>
        <div className="lp-nav-actions">
          <button className="btn ghost mini" onClick={() => onStart('kirish')}>
            Kirish
          </button>
          <button className="btn mini" onClick={() => onStart('royxat')}>
            Boshlash
          </button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="chip on lp-badge">Oʻzbek tilida</span>
          <h1>
            Oʻzbekcha oʻylaydigan
            <br />
            AI yordamchi.
          </h1>
          <p>
            Suhbat, agent va kod — bitta hisobda. API kaliti, sozlash va
            oylik hisob-kitob bilan ovora boʻlmaysiz.
          </p>
          <div className="lp-cta">
            <button className="btn" onClick={() => onStart('royxat')}>
              Bepul boshlash
            </button>
            {apk && (
              <a className="btn ghost" href={apk} target="_blank" rel="noreferrer">
                <Download size={16} /> Android
              </a>
            )}
          </div>
          <div className="tiny lp-note">Bepul tarifda kartani ulash shart emas</div>
        </div>

        <div className="lp-hero-art" aria-hidden>
          <div className="lp-glow" />
          <div className="lp-mock">
            <div className="lp-mock-bar">
              <span className="lp-mock-tabs">
                <i className="on">Chat</i>
                <i>Agent</i>
                <i>Code</i>
              </span>
            </div>
            <div className="lp-mock-body">
              <div className="lp-mock-user">Kitob yozamiz — sunʼiy intellekt asoslari</div>
              <div className="lp-mock-tool">Internetdan 6 ta manba oʻqildi</div>
              <div className="lp-mock-h">Kitob rejasi tayyor</div>
              <div className="lp-mock-p">12 bob, ~180 sahifa. Har bobga muqova rasmi.</div>
              <div className="lp-mock-lines">
                <i style={{ width: '88%' }} />
                <i style={{ width: '72%' }} />
                <i style={{ width: '81%' }} />
              </div>
            </div>
            <div className="lp-mock-comp">
              <span>Boblarni yozishni boshla…</span>
              <i />
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="imkoniyatlar">
        <div className="section-label">Nima qila oladi</div>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <div className="lp-feature" key={f.title}>
              <span className="lp-fi">{f.icon}</span>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section" id="tariflar">
        <div className="section-label">Tariflar</div>
        <h2 className="lp-h2">Oddiy narx, yashirin toʻlovsiz</h2>
        <div className="lp-plans">
          {plans
            .filter((p) => p.active)
            .map((p) => (
              <div className={p.rank === 2 ? 'lp-plan best' : 'lp-plan'} key={p.code}>
                {p.rank === 2 && <span className="lp-plan-tag">Ommabop</span>}
                <b className="lp-plan-name">{p.name}</b>
                <div className="lp-plan-price">
                  {money(p.priceUzs)}
                  {p.priceUzs > 0 && <i>/oy</i>}
                </div>
                <div className="muted lp-plan-line">
                  Oyiga {tokens(p.monthlyTokens)} token
                </div>
                <ul className="lp-plan-feats">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <button
                  className={p.rank === 2 ? 'btn wide' : 'btn ghost wide'}
                  onClick={() => onStart('royxat')}
                >
                  {p.priceUzs ? 'Tanlash' : 'Bepul boshlash'}
                </button>
              </div>
            ))}
        </div>
        <p className="tiny lp-plans-note">
          Toʻlov admin orqali rasmiylashtiriladi — ilovadagi «Tariflar» boʻlimidan soʻrov yuboring.
        </p>
      </section>

      <section className="lp-section" id="yuklash">
        <div className="section-label">Yuklab olish</div>
        <div className="lp-downloads">
          <a
            className={apk ? 'lp-dl' : 'lp-dl off'}
            href={apk || undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span className="lp-dl-i">
              <Download size={20} />
            </span>
            <span className="grow">
              <b>Android ilova</b>
              <span className="tiny">{apk ? 'APK · Android 8+' : 'Tez orada'}</span>
            </span>
          </a>
          <a
            className={ext ? 'lp-dl' : 'lp-dl off'}
            href={ext || undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span className="lp-dl-i">
              <Puzzle size={20} />
            </span>
            <span className="grow">
              <b>Brauzer kengaytmasi</b>
              <span className="tiny">{ext ? 'Chrome va Edge' : 'Tez orada'}</span>
            </span>
          </a>
          <div className="lp-dl">
            <span className="lp-dl-i">
              <Globe size={20} />
            </span>
            <span className="grow">
              <b>Veb versiya</b>
              <span className="tiny">Shu sahifada ishlaydi</span>
            </span>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-brand">
          Daho<span>.</span>
        </div>
        <span className="tiny">© {new Date().getFullYear()} · Toshkent</span>
      </footer>
    </div>
  );
}
