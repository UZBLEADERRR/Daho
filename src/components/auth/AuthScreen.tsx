import { useState, type FormEvent } from 'react';
import { AuthError, resetPassword, signIn, signUp } from '../../lib/auth';
import { Back } from '../Icons';
import { toast } from '../ui';

type Mode = 'kirish' | 'royxat' | 'tiklash';

const TITLES: Record<Mode, { title: string; hint: string; action: string }> = {
  kirish: { title: 'Xush kelibsiz', hint: 'Daho hisobingizga kiring', action: 'Kirish' },
  royxat: { title: 'Hisob ochish', hint: 'Bir daqiqada tayyor boʻladi', action: 'Davom etish' },
  tiklash: { title: 'Parolni tiklash', hint: 'Emailingizga havola yuboramiz', action: 'Yuborish' },
};

export function AuthScreen({
  initial = 'kirish',
  onBack,
}: {
  initial?: Mode;
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<'' | 'tasdiq' | 'tiklash'>('');

  const copy = TITLES[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.includes('@')) return setError('Emailni toʻgʻri yozing.');
    if (mode !== 'tiklash' && password.length < 8) {
      return setError('Parol kamida 8 ta belgi boʻlsin.');
    }
    if (mode === 'royxat' && name.trim().length < 2) {
      return setError('Ismingizni yozing.');
    }

    setBusy(true);
    try {
      if (mode === 'kirish') {
        await signIn(email, password);
      } else if (mode === 'royxat') {
        const res = await signUp(email, password, name);
        if (res.needsConfirm) setSent('tasdiq');
        else toast('Hisob ochildi');
      } else {
        await resetPassword(email);
        setSent('tiklash');
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-mark">D</div>
          <h1 className="auth-title">
            {sent === 'tasdiq' ? 'Emailingizni tasdiqlang' : 'Havola yuborildi'}
          </h1>
          <p className="auth-hint">
            <b>{email}</b> manziliga xat yubordik. Undagi havolani bosing —
            keyin shu yerdan kirishingiz mumkin.
          </p>
          <button
            className="btn wide"
            onClick={() => {
              setSent('');
              setMode('kirish');
              setPassword('');
            }}
          >
            Kirish sahifasiga qaytish
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      {onBack && (
        <button className="auth-back" onClick={onBack} aria-label="Orqaga">
          <Back />
        </button>
      )}

      <form className="auth-card" onSubmit={submit}>
        <div className="auth-mark">D</div>
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-hint">{copy.hint}</p>

        {mode === 'royxat' && (
          <label className="auth-field">
            <span>Ism</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Sarvarbek"
            />
          </label>
        )}

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="siz@example.com"
          />
        </label>

        {mode !== 'tiklash' && (
          <label className="auth-field">
            <span>Parol</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'royxat' ? 'new-password' : 'current-password'}
              placeholder="Kamida 8 ta belgi"
            />
          </label>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="btn wide" type="submit" disabled={busy}>
          {busy ? 'Kutilmoqda…' : copy.action}
        </button>

        <div className="auth-links">
          {mode === 'kirish' && (
            <>
              <button type="button" onClick={() => setMode('royxat')}>
                Hisob ochish
              </button>
              <button type="button" onClick={() => setMode('tiklash')}>
                Parolni unutdingizmi?
              </button>
            </>
          )}
          {mode === 'royxat' && (
            <button type="button" onClick={() => setMode('kirish')}>
              Hisobim bor — kirish
            </button>
          )}
          {mode === 'tiklash' && (
            <button type="button" onClick={() => setMode('kirish')}>
              Kirishga qaytish
            </button>
          )}
        </div>

        {mode === 'royxat' && (
          <p className="auth-terms">
            Davom etish orqali xizmat shartlariga va maxfiylik siyosatiga rozilik bildirasiz.
          </p>
        )}
      </form>
    </div>
  );
}
