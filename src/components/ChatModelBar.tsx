/**
 * Suhbat tepasidagi model tanlagichi.
 *
 * Oddiy foydalanuvchi Sozlamalarga kirib model qidirmasligi kerak —
 * unga admin ochib bergan modellar shu yerda, bir bosishda koʻrinadi.
 * Yopiq modellar ham koʻrsatiladi: «bu qaysi tarifda ochiladi?»
 * degan savol javobsiz qolmasin.
 */
import { useEffect, useState } from 'react';
import { publicCatalog, type PublicModel } from '../lib/cloud/catalog';
import { cloudEnabled } from '../lib/cloud';
import { updateSettings, useStore } from '../lib/store';
import { Sheet, toast } from './ui';

const ROLE_EMOJI: Record<string, string> = {
  chat: '💬',
  code: '⌨️',
  image: '🖼',
  video: '🎬',
  tts: '🔊',
};

export function ChatModelBar() {
  const model = useStore((s) => s.settings.model);
  const [list, setList] = useState<PublicModel[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!cloudEnabled) return;
    void publicCatalog()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  // Katalog boʻsh boʻlsa (admin hali model qoʻshmagan) — qatorni koʻrsatmaymiz.
  if (!cloudEnabled || !list?.length) return null;

  const ochiq = list.filter((m) => m.open);
  const yopiq = list.filter((m) => !m.open);
  const joriy = list.find((m) => m.slug === model);

  return (
    <>
      <button className="model-bar" onClick={() => setOpen(true)}>
        <span className="model-bar-dot" />
        <span className="grow">{joriy?.label ?? 'Model tanlash'}</span>
        <span className="model-bar-caret">▾</span>
      </button>

      {open && (
        <Sheet title="Model tanlash" onClose={() => setOpen(false)}>
          {ochiq.map((m) => (
            <button
              key={m.slug}
              className={`line-row model-row${m.slug === model ? ' on' : ''}`}
              onClick={() => {
                updateSettings({ model: m.slug });
                setOpen(false);
              }}
            >
              <span className="model-emoji">{ROLE_EMOJI[m.role] ?? '💬'}</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <div>
                  {m.label}
                  {m.is_daily ? ' · bepul' : ''}
                </div>
                <div className="tiny">
                  {[
                    m.description,
                    m.supports_tools ? 'vosita ishlatadi' : '',
                    m.supports_vision ? 'rasm koʻradi' : '',
                    m.context_tokens ? `${Math.round(m.context_tokens / 1000)}k kontekst` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </span>
            </button>
          ))}

          {yopiq.length > 0 && (
            <>
              <div className="section-label">Yuqori tarifda ochiladi</div>
              {yopiq.map((m) => (
                <button
                  key={m.slug}
                  className="line-row model-row dim"
                  onClick={() => toast(`«${m.label}» yuqori tarifda ochiladi`)}
                >
                  <span className="model-emoji">🔒</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div>{m.label}</div>
                    <div className="tiny">{m.description}</div>
                  </span>
                </button>
              ))}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
