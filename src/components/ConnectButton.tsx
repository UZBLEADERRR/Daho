/**
 * «Ulash» tugmasi — token soʻrash oʻrniga.
 *
 * Server tomonda xizmat sozlangan boʻlsa (mijoz ID va siri Railway
 * muhitida) foydalanuvchi hech narsa kiritmaydi: tugmani bosadi,
 * xizmat sahifasida ruxsat beradi, tamom.
 *
 * Sozlanmagan boʻlsa tugma yashirinadi va eski qoʻlda kiritish qoladi —
 * shunda hech kim ishsiz qolmaydi.
 */
import { useEffect, useState } from 'react';
import {
  connectable,
  connected,
  disconnect,
  startConnect,
  type OauthProvider,
  type ProviderInfo,
} from '../lib/oauth';
import { useStore } from '../lib/store';
import { toast } from './ui';

export function ConnectButton({
  provider,
  what,
}: {
  provider: OauthProvider;
  /** Nima uchun kerakligi — bir jumlada */
  what?: string;
}) {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [busy, setBusy] = useState(false);
  // Token oʻzgarsa tugma «ulangan» holatiga oʻtsin.
  const token = useStore((st) =>
    provider === 'github'
      ? st.settings.githubToken
      : provider === 'supabase'
        ? st.settings.supabaseToken
        : (st.settings.googleAuth?.accessToken ?? ''),
  );

  useEffect(() => {
    void connectable()
      .then((list) => setInfo(list[provider] ?? null))
      .catch(() => setInfo(null));
  }, [provider]);

  const bor = Boolean(token) && connected(provider);

  if (!info?.ready) {
    // Server sozlanmagan — qoʻlda kiritish qoladi, ortiqcha gap yozmaymiz.
    return null;
  }

  if (bor) {
    return (
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="chip ok">{info.label} ulangan</span>
        <button className="btn mini ghost" onClick={() => disconnect(provider)}>
          Uzish
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        className="btn wide"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startConnect(provider)
            .catch((err) => {
              toast(String((err as Error)?.message ?? err));
              setBusy(false);
            });
        }}
      >
        {busy ? 'Ochilmoqda…' : `${info.label} bilan ulash`}
      </button>
      <div className="tiny set-hint">
        {what ?? 'Token kiritish shart emas — xizmat sahifasida ruxsat berasiz.'}
      </div>
    </div>
  );
}
