import { useState, type FormEvent } from 'react';
import {
  resetPassword,
  signIn,
  signInWithLink,
  signUp,
} from '../../lib/cloud';
import { Back } from '../Icons';

type Mode = 'kirish' | 'royxat' | 'tiklash';

const COPY: Record<Mode, { title: string; hint: string; action: string }> = {
  kirish: { title: 'Xush kelibsiz', hint: 'Daho hisobingizga kiring', action: 'Kirish' },
  royxat: { title: 'Hisob ochish', hint: 'Bir daqiqada tayyor boʻladi', action: 'Davom etish' },
  tiklash: { title: 'Parolni tiklash', hint: 'Pochtangizga havola yuboramiz', action: 'Yuborish' },
};

/**
 * Rasmiy kirish ekrani.
 *
 * Avval hisob faqat ichkaridagi varaqdan ochilardi — yangi odam ilovani
 * ochganda nima qilishni bilmasdi. Endi kirish/roʻyxat alohida ekran.
 */
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
  const [done, setDone] = useState('');

  const copy = COPY[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.includes('@')) return setError('Pochtani toʻgʻri yozing.');
    if (mode !== 'tiklash' && password.length < 6) {
      return setError('Parol kamida 6 ta belgi boʻlsin.');
    }
    if (mode === 'royxat' && name.trim().length < 2) {
      return setError('Ismingizni yozing.');
    }

    setBusy(true);
    try {
      if (mode === 'kirish') {
        const res = await signIn(email, password);
        if (!res.ok) setError(res.message);
      } else if (mode === 'royxat') {
        const res = await signUp(email, password, name.trim());
        if (!res.ok) setError(res.message);
        else if (res.message) setDone(res.message);
      } else {
        const res = await resetPassword(email);
        if (!res.ok) setError(res.message);
        else setDone(res.message || 'Havola yuborildi.');
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const magicLink = async () => {
    if (!email.includes('@')) return setError('Avval pochtangizni yozing.');
    setBusy(true);
    setError('');
    try {
      const res = await signInWithLink(email);
      if (!res.ok) setError(res.message);
      else setDone(res.message || 'Kirish havolasi pochtangizga yuborildi.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="auth">
        <div className="auth-card">
          <div className="auth-mark">D</div>
          <h1 className="auth-title">Pochtangizni tekshiring</h1>
          <p className="auth-hint">
            <b>{email}</b> manziliga xat yubordik. Undagi havolani bosing.
          </p>
          <button
            className="btn wide"
            onClick={() => {
              setDone('');
              setMode('kirish');
              setPassword('');
            }}
          >
            Kirishga qaytish
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
          <span>Pochta</span>
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
              placeholder="Kamida 6 ta belgi"
            />
          </label>
        )}

        {error && <div className="auth-error">{error}</div>}

        <button className="btn wide" type="submit" disabled={busy}>
          {busy ? 'Kutilmoqda…' : copy.action}
        </button>

        {mode === 'kirish' && (
          <button
            className="btn ghost wide auth-alt"
            type="button"
            disabled={busy}
            onClick={() => void magicLink()}
          >
            Parolsiz — havola bilan kirish
          </button>
        )}

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
          {mode !== 'kirish' && (
            <button type="button" onClick={() => setMode('kirish')}>
              Kirishga qaytish
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
