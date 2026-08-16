import { useEffect, useState, type ReactNode } from 'react';
import { Close } from './Icons';

/* ---------- Toast ---------- */

type ToastListener = (message: string) => void;
const toastListeners = new Set<ToastListener>();

export function toast(message: string): void {
  toastListeners.forEach((l) => l(message));
}

export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const listener: ToastListener = (m) => {
      setMessage(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2600);
    };
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
      clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return <div className="toast">{message}</div>;
}

/* ---------- Sheet ---------- */

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ title, onClose, children }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 14 }}>
          <div className="h2" style={{ margin: 0 }}>
            {title}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Yopish">
            <Close />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- Switch ---------- */

interface SwitchProps {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}

export function Switch({ on, onChange, label, hint }: SwitchProps) {
  return (
    <button
      className="between"
      style={{ width: '100%', padding: '9px 0', textAlign: 'left' }}
      onClick={() => onChange(!on)}
    >
      <span className="grow">
        <span style={{ fontSize: 14.5 }}>{label}</span>
        {hint && <div className="tiny">{hint}</div>}
      </span>
      <span className={on ? 'switch on' : 'switch'}>
        <i />
      </span>
    </button>
  );
}

/* ---------- Empty ---------- */

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint}
    </div>
  );
}

/* ---------- Confirm ---------- */

export function useConfirm() {
  return (message: string): boolean => window.confirm(message);
}
