import { useState } from 'react';
import { refreshAccount, saveProfile } from '../lib/account';
import { changePassword, signOut } from '../lib/auth';
import { useAccount, useSession } from '../lib/useAccount';
import { AdminPanel } from './admin/AdminPanel';
import { Back, Crown, Logout, Shield, User } from './Icons';
import { PlansPanel, QuotaBar } from './PlansPanel';
import { Sheet, toast, useConfirm } from './ui';

type View = 'asosiy' | 'tariflar' | 'admin';

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('asosiy');
  const { profile } = useAccount();
  const session = useSession();
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();

  const title =
    view === 'tariflar' ? 'Tariflar' : view === 'admin' ? 'Admin panel' : 'Hisobim';

  return (
    <div className="overlay">
      <div className="sheet-full">
        <header className="topbar">
          <button
            className="icon-btn"
            onClick={() => (view === 'asosiy' ? onClose() : setView('asosiy'))}
            aria-label="Orqaga"
          >
            <Back />
          </button>
          <span className="grow panel-title">{title}</span>
        </header>

        {view === 'admin' ? (
          <AdminPanel />
        ) : view === 'tariflar' ? (
          <div className="scroll">
            <PlansPanel />
          </div>
        ) : (
          <div className="scroll">
            <div className="pad">
              <button className="profile" onClick={() => setEditing(true)}>
                <span className="profile-mark">
                  {(profile?.fullName || profile?.email || 'D').slice(0, 1).toUpperCase()}
                </span>
                <span className="grow">
                  <b className="b profile-name">{profile?.fullName || 'Ism qoʻshing'}</b>
                  <span className="tiny">{profile?.email || session?.email}</span>
                </span>
              </button>

              <QuotaBar />

              <button className="action-row account-row" onClick={() => setView('tariflar')}>
                <span className="action-icon accent-icon">
                  <Crown size={17} />
                </span>
                <span className="grow">
                  <b className="b">Tariflar</b>
                  <span className="tiny">Token chegarasi va obuna</span>
                </span>
              </button>

              {profile?.role === 'admin' && (
                <button className="action-row account-row" onClick={() => setView('admin')}>
                  <span className="action-icon accent-icon">
                    <Shield size={17} />
                  </span>
                  <span className="grow">
                    <b className="b">Admin panel</b>
                    <span className="tiny">Modellar, tariflar, foydalanuvchilar</span>
                  </span>
                </button>
              )}

              <button className="action-row account-row" onClick={() => setEditing(true)}>
                <span className="action-icon">
                  <User size={17} />
                </span>
                <span className="grow">
                  <b className="b">Profil</b>
                  <span className="tiny">Ism va parol</span>
                </span>
              </button>

              <button
                className="action-row account-row danger-text"
                onClick={() => {
                  void (async () => {
                    if (!(await confirm('Hisobdan chiqasizmi?'))) return;
                    await signOut();
                  })();
                }}
              >
                <span className="action-icon">
                  <Logout size={17} />
                </span>
                <span className="grow">
                  <b className="b">Chiqish</b>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && <ProfileSheet onClose={() => setEditing(false)} />}
    </div>
  );
}

function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useAccount();
  const [name, setName] = useState(profile?.fullName ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (name.trim() !== (profile?.fullName ?? '')) {
        await saveProfile({ fullName: name.trim() });
      }
      if (password) {
        if (password.length < 8) {
          toast('Parol kamida 8 ta belgi boʻlsin');
          setBusy(false);
          return;
        }
        await changePassword(password);
      }
      await refreshAccount();
      toast('Saqlandi');
      onClose();
    } catch (err) {
      toast(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Profil" onClose={onClose}>
      <label className="field">
        <span>Ism</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sarvarbek" />
      </label>

      <label className="field">
        <span>Yangi parol</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Oʻzgartirmasangiz boʻsh qoldiring"
          autoComplete="new-password"
        />
      </label>

      <button className="btn wide" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saqlanmoqda…' : 'Saqlash'}
      </button>
    </Sheet>
  );
}
