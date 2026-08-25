/**
 * Input ostidagi rol qatori.
 *
 * Daho Code bitta model bilan ishlamaydi: reja tuzish, kod yozish,
 * dizayn va tekshirish — har biriga alohida model qoʻyish mumkin.
 * Ilgari buni faqat Sozlamalar → AI modellar → Rollar ichidan
 * oʻzgartirib boʻlardi, yaʼni ish ustida almashtirib boʻlmasdi.
 *
 * Endi qator aynan input ostida: bir bosishda koʻrinadi, ikkinchi
 * bosishda almashadi.
 */
import { useState } from 'react';
import { usableChatModels } from '../lib/providers';
import { canSeeRawModels, displayModel } from '../lib/modelname';
import { updateSettings, useStore } from '../lib/store';
import type { RoleModels } from '../lib/types';
import { Sheet } from './ui';

const ROLLAR: Array<{ id: keyof RoleModels; label: string; emoji: string; hint: string }> = [
  { id: 'bosh', label: 'Reja', emoji: '🧭', hint: 'vazifani boʻlaklarga ajratadi' },
  { id: 'kod', label: 'Kod', emoji: '⌨️', hint: 'fayllarni yozadi' },
  { id: 'dizayn', label: 'Dizayn', emoji: '🎨', hint: 'koʻrinish va uslub' },
  { id: 'tekshir', label: 'Tekshir', emoji: '🔍', hint: 'xatolarni topadi' },
];

export function RoleBar() {
  const roleModels = useStore((s) => s.settings.roleModels);
  const auto = useStore((s) => s.settings.autoPickModel !== false);
  const [ochiq, setOchiq] = useState<keyof RoleModels | null>(null);

  const models = usableChatModels();
  const rol = ROLLAR.find((r) => r.id === ochiq);

  return (
    <>
      <div className="role-bar">
        {ROLLAR.map((r) => {
          const qiymat = roleModels?.[r.id] ?? '';
          return (
            <button
              key={r.id}
              className={qiymat ? 'role-chip set' : 'role-chip'}
              onClick={() => setOchiq(r.id)}
              title={r.hint}
            >
              <span>{r.emoji}</span>
              {r.label}
              <i>{qiymat ? displayModel(qiymat) : auto ? 'avto' : 'umumiy'}</i>
            </button>
          );
        })}
      </div>

      {rol && (
        <Sheet title={`${rol.label} uchun model`} onClose={() => setOchiq(null)}>
          <div className="tiny" style={{ marginBottom: 10 }}>
            {rol.hint}. «Avto» tanlansa ishga qarab eng mosi oʻzi olinadi.
          </div>

          <button
            className={!roleModels?.[rol.id] ? 'action-row on' : 'action-row'}
            onClick={() => {
              updateSettings({ roleModels: { ...roleModels, [rol.id]: '' } });
              setOchiq(null);
            }}
          >
            <span className="action-icon">⚡</span>
            <span className="grow">
              <b>Avto</b>
              <div className="tiny">ishga qarab oʻzi tanlaydi</div>
            </span>
          </button>

          {models.map((m) => (
            <button
              key={m.id}
              className={roleModels?.[rol.id] === m.id ? 'action-row on' : 'action-row'}
              onClick={() => {
                updateSettings({ roleModels: { ...roleModels, [rol.id]: m.id } });
                setOchiq(null);
              }}
            >
              <span className="action-icon">🧠</span>
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{displayModel(m.id)}</b>
                {canSeeRawModels() && (
                  <div className="tiny">{m.providerLabel ?? 'Gemini'}</div>
                )}
              </span>
            </button>
          ))}

          {!models.length && (
            <div className="tiny">
              Roʻyxat boʻsh. Sozlamalar → «Modellarni yangilash» tugmasini bosing.
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
