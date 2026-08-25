import { useState } from 'react';
import {
  allCachedModels,
  isFreeModel,
  modelIsFree,
  parseRef,
  priceLabel,
  searchModels,
} from '../lib/providers';
import { useStore } from '../lib/store';
import type { ModelInfo } from '../lib/models';
import { Sheet } from './ui';

export type ModelFilter = 'hammasi' | 'sevimli' | 'bepul' | 'vositali';

/**
 * Qidiruvli model tanlagich.
 *
 * OpenRouter 250+ model beradi — oddiy `<select>` da ularni topib boʻlmaydi.
 * Shuning uchun hamma joyda (suhbat modeli, agent rollari, avtomatlashtirish,
 * Code loyihasi) shu bitta oyna ishlatiladi: qidiruv, filtrlar, narx.
 */
export function ModelPickerSheet({
  title,
  value,
  onPick,
  onClose,
  allowEmpty,
  emptyLabel = 'Asosiy model',
  role = 'chat',
}: {
  title: string;
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** «Tanlanmagan» varianti boʻlsinmi (rollar va loyiha uchun) */
  allowEmpty?: boolean;
  emptyLabel?: string;
  role?: ModelInfo['role'];
}) {
  const settings = useStore((s) => s.settings);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModelFilter>(
    // Foydalanuvchi «faqat bepul» rejimini yoqqan boʻlsa shundan boshlaymiz.
    settings.freeOnly ? 'bepul' : 'hammasi',
  );

  const hidden = new Set(settings.hiddenModels ?? []);
  const favorites = new Set(settings.favoriteModels ?? []);

  const base = (query.trim() ? searchModels(query) : allCachedModels())
    .filter((m) => m.role === role && !hidden.has(m.id));

  const list = base.filter((m) => {
    if (filter === 'sevimli') return favorites.has(m.id);
    if (filter === 'bepul') return modelIsFree(m);
    if (filter === 'vositali') return m.tools !== false;
    return true;
  });

  // Sevimlilar doim yuqorida tursin.
  const sorted = [...list].sort((a, b) => {
    const fa = favorites.has(a.id) ? 1 : 0;
    const fb = favorites.has(b.id) ? 1 : 0;
    return fb - fa || b.score - a.score;
  });

  const chips: Array<[ModelFilter, string]> = [
    ['hammasi', `Hammasi (${base.length})`],
    ['sevimli', `★ Sevimli (${base.filter((m) => favorites.has(m.id)).length})`],
    ['bepul', `🆓 Bepul (${base.filter(modelIsFree).length})`],
    ['vositali', 'Vositali'],
  ];

  return (
    <Sheet title={title} onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Qidirish: kimi, qwen, claude, free…"
        style={{ marginBottom: 10 }}
      />

      <div className="chips" style={{ marginBottom: 10 }}>
        {chips.map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? 'chip on' : 'chip'}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
        {allowEmpty && (
          <button
            className={!value ? 'action-row on' : 'action-row'}
            onClick={() => {
              onPick('');
              onClose();
            }}
          >
            <span className="action-icon">⚙️</span>
            <span className="grow">
              <b>{emptyLabel}</b>
            </span>
          </button>
        )}

        {sorted.map((m) => (
          <button
            key={m.id}
            className={value === m.id ? 'action-row on' : 'action-row'}
            onClick={() => {
              onPick(m.id);
              onClose();
            }}
          >
            <span className="action-icon">{m.label.slice(0, 1).toUpperCase()}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <b style={{ wordBreak: 'break-word' }}>{m.label}</b>
              <div className="tiny">
                {m.providerLabel ?? 'Gemini'}
                {modelIsFree(m) ? ' · bepul' : priceLabel(m) ? ` · ${priceLabel(m)}` : ''}
                {m.tools === false ? ' · vositasiz' : ''}
                {m.vision ? ' · rasm' : ''}
              </div>
            </span>
          </button>
        ))}

        {!sorted.length && (
          <div className="tiny">
            Hech narsa topilmadi.
            {filter !== 'hammasi' && ' Filtrni «Hammasi» ga oʻzgartirib koʻring.'}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Tanlangan modelni koʻrsatadigan tugma — bosilganda tanlagich ochiladi. */
export function ModelPickButton({
  value,
  onChange,
  title,
  allowEmpty,
  emptyLabel,
  role,
}: {
  value: string;
  onChange: (id: string) => void;
  title: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  role?: ModelInfo['role'];
}) {
  const [open, setOpen] = useState(false);
  const found = allCachedModels().find((m) => m.id === value);
  const label = value ? (found?.label ?? parseRef(value).model) : (emptyLabel ?? 'Asosiy model');

  return (
    <>
      <button className="model-pick" onClick={() => setOpen(true)}>
        <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
          <div style={{ wordBreak: 'break-word' }}>{label}</div>
          {found && (
            <div className="tiny">
              {found.providerLabel ?? 'Gemini'}
              {modelIsFree(found) ? ' · 🆓 bepul' : priceLabel(found) ? ` · ${priceLabel(found)}` : ''}
            </div>
          )}
        </span>
        <span className="tiny">›</span>
      </button>

      {open && (
        <ModelPickerSheet
          title={title}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
          allowEmpty={allowEmpty}
          emptyLabel={emptyLabel}
          role={role}
        />
      )}
    </>
  );
}

export { isFreeModel };
