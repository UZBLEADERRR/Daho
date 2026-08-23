/**
 * Profil — toʻliq ekran.
 *
 * Ilgari hisob «Daho Cloud» degan tor oynada, toʻrtta segment ostida
 * turardi: odam «profil» ni qidirib topolmasdi va hamma narsa bitta
 * uzun varaqqa tiqilgan edi.
 *
 * Endi tanish tartib: yuqorida kim ekaningiz, pastda guruhlangan
 * qatorlar, har biri alohida sahifa. Bitta ekranda bitta ish.
 */
import { useState } from 'react';
import {
  formatCredits,
  refreshAccount,
  signOut,
  useCloud,
} from '../../lib/cloud';
import { clearSyncShadow, getSyncState, syncNow } from '../../lib/cloud/sync';
import { JobsTab, LimitBars, ModelList, PlansTab, ProfileBlock, UsageTab } from './AccountSheet';
import { InviteList } from './GroupPanel';
import { Settings } from '../Settings';
import { Close } from '../Icons';
import { toast } from '../ui';

type Page = 'bosh' | 'profil' | 'tarif' | 'sarf' | 'fon' | 'modellar' | 'sync' | 'sozlama';

const SARLAVHA: Record<Page, string> = {
  bosh: 'Profil',
  profil: 'Ism va parol',
  tarif: 'Tarif',
  sarf: 'Sarf tarixi',
  fon: 'Fon vazifalari',
  modellar: 'Modellar',
  sync: 'Sinxronizatsiya',
  sozlama: 'Sozlamalar',
};

/** Ism yoki pochtadan bitta harf — avatar oʻrniga. */
function boshHarf(text: string): string {
  const t = (text || '').trim();
  return (t[0] || '?').toUpperCase();
}

function Qator({
  emoji,
  label,
  qiymat,
  onClick,
}: {
  emoji: string;
  label: string;
  qiymat?: string;
  onClick: () => void;
}) {
  return (
    <button className="prof-row" onClick={onClick}>
      <span className="prof-emoji">{emoji}</span>
      <span className="prof-label">{label}</span>
      {qiymat && <span className="prof-value">{qiymat}</span>}
      <span className="prof-chevron">›</span>
    </button>
  );
}

export function ProfileScreen({
  onClose,
  onOpenAdmin,
}: {
  onClose: () => void;
  onOpenAdmin?: () => void;
}) {
  const { account } = useCloud();
  const [page, setPage] = useState<Page>('bosh');
  if (!account) return null;

  const ism = account.full_name || account.email.split('@')[0];
  const sync = getSyncState();

  return (
    <div className="prof-screen">
      <header className="prof-top">
        <button
          className="icon-btn"
          onClick={() => (page === 'bosh' ? onClose() : setPage('bosh'))}
          aria-label={page === 'bosh' ? 'Yopish' : 'Orqaga'}
        >
          {page === 'bosh' ? <Close /> : <span className="prof-back">‹</span>}
        </button>
        <div className="prof-title">{SARLAVHA[page]}</div>
        <span style={{ width: 38 }} />
      </header>

      <div className="prof-body">
        {page === 'bosh' && (
          <>
            <div className="prof-hero">
              <div className="prof-avatar">{boshHarf(ism)}</div>
              <div className="prof-name">{ism}</div>
              <div className="prof-mail">{account.email}</div>
              <div className="prof-pills">
                <span className="pill">{account.plan?.name ?? 'Rejasiz'}</span>
                {account.is_admin && <span className="pill admin">Admin</span>}
              </div>
            </div>

            <div className="prof-card">
              <LimitBars />
            </div>

            {/* Kelgan takliflar — koʻzga tashlanib tursin. */}
            <InviteList />

            {/*
              * Eng kerakli narsa yuqorida: obuna va kredit.
              * Token soni oddiy foydalanuvchiga koʻrsatilmaydi — u
              * kreditda oʻlchaydi, tokenda emas. Texnik tafsilot
              * (sarf tarixi, modellar roʻyxati, fon vazifalari) faqat
              * adminda qoladi.
              */}
            <div className="prof-group">Obuna</div>
            <div className="prof-list">
              <Qator
                emoji="💳"
                label="Tarif va kredit"
                qiymat={account.plan?.name ?? 'Rejasiz'}
                onClick={() => setPage('tarif')}
              />
              <Qator emoji="👤" label="Ism va parol" onClick={() => setPage('profil')} />
              <Qator
                emoji="☁️"
                label="Sinxronizatsiya"
                qiymat={sync.phase}
                onClick={() => setPage('sync')}
              />
            </div>

            <div className="prof-group">Tizim</div>
            <div className="prof-list">
              {/* Sozlamalar endi shu yerda — alohida oyna emas. */}
              <Qator emoji="⚙️" label="Sozlamalar" onClick={() => setPage('sozlama')} />
              {account.is_admin && (
                <>
                  <Qator emoji="📊" label="Sarf tarixi" onClick={() => setPage('sarf')} />
                  <Qator
                    emoji="🧠"
                    label="Modellar"
                    qiymat={String(account.models.length)}
                    onClick={() => setPage('modellar')}
                  />
                  <Qator
                    emoji="🗂"
                    label="Fon vazifalari"
                    qiymat={account.active_jobs ? String(account.active_jobs) : undefined}
                    onClick={() => setPage('fon')}
                  />
                </>
              )}
              {account.is_admin && onOpenAdmin && (
                <Qator emoji="🛡" label="Admin panel" onClick={onOpenAdmin} />
              )}
            </div>

            <button
              className="prof-out"
              onClick={async () => {
                await signOut();
                clearSyncShadow();
                toast('Hisobdan chiqdingiz');
                onClose();
              }}
            >
              Chiqish
            </button>
          </>
        )}

        {page === 'profil' && (
          <div className="prof-card">
            <ProfileBlock />
          </div>
        )}
        {page === 'tarif' && <PlansTab />}
        {page === 'sarf' && <UsageTab />}
        {page === 'fon' && <JobsTab />}
        {page === 'modellar' && <ModelList />}
        {page === 'sozlama' && (
          <Settings inline onClose={() => setPage('bosh')} onOpenAccount={() => setPage('bosh')} />
        )}
        {page === 'sync' && (
          <div className="prof-card">
            <div className="tiny">
              Holat: {sync.phase}
              {sync.lastAt
                ? ` · oxirgi: ${new Date(sync.lastAt).toLocaleTimeString('uz-UZ')}`
                : ''}
              {sync.skipped ? ` · ${sync.skipped} ta katta element yuborilmadi` : ''}
              {sync.error ? ` · xato: ${sync.error}` : ''}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn ghost mini grow" onClick={() => void syncNow()}>
                Hozir sinxronlash
              </button>
              <button className="btn ghost mini grow" onClick={() => void refreshAccount()}>
                Hisobni yangilash
              </button>
            </div>
            <div className="tiny" style={{ marginTop: 10, opacity: 0.7 }}>
              Kredit: {formatCredits(account.balance)}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
