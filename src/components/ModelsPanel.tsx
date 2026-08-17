import { useEffect, useState } from 'react';
import {
  PROVIDER_PRESETS,
  allCachedModels,
  allModels,
  cachedProviderModels,
  listProviderModels,
  parseRef,
  presetById,
} from '../lib/providers';
import { updateSettings, useStore } from '../lib/store';
import type { ProviderConfig, RoleModels } from '../lib/types';
import { Close, Cpu, Refresh, Trash } from './Icons';
import { Sheet, Switch, toast } from './ui';

const ROLE_LABEL: Array<{ key: keyof RoleModels; title: string; hint: string }> = [
  { key: 'bosh', title: '🧭 Bosh agent', hint: 'Rejalashtiradi va boshqaradi' },
  { key: 'kod', title: '⌨️ Dasturchi', hint: 'Mantiq va funksiyalar yozadi' },
  { key: 'dizayn', title: '🎨 Dizayner', hint: 'Koʻrinish va joylashuv' },
  { key: 'tekshir', title: '🔍 Tekshiruvchi', hint: 'Xato qidiradi va tuzatadi' },
  { key: 'matn', title: '✍️ Muharrir', hint: 'Kitob va hujjat matnlari' },
];

/**
 * AI modellarni boshqarish: tashqi provayderlarni ulash, model roʻyxatidan
 * keraksizlarini oʻchirish va koʻp agentli ish uchun rollarga model biriktirish.
 */
export function ModelsPanel() {
  const settings = useStore((s) => s.settings);
  const [addOpen, setAdd] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const providers = settings.providers ?? [];
  const models = allCachedModels();
  const hidden = new Set(settings.hiddenModels ?? []);
  const active = models.filter((m) => !hidden.has(m.id) && m.role === 'chat').length;

  /**
   * Google kaliti yoʻq boʻlsa asosiy model Gemini niki boʻlib qolmasligi kerak —
   * aks holda birinchi savolda «kalit yoʻq» xatosi chiqadi.
   *
   * Faqat provayderdan HAQIQIY roʻyxat kelgandan keyin tanlaymiz. Tavsiya
   * modellaridan tanlash notoʻgʻri boʻlar edi: ular shunchaki mashhur nomlar,
   * foydalanuvchining hisobida boʻlmasligi ham mumkin.
   */
  useEffect(() => {
    if (settings.apiKey.trim()) return;
    if (settings.model.includes('::')) return;
    const first = models.find(
      (m) =>
        m.role === 'chat' &&
        m.provider &&
        !hidden.has(m.id) &&
        cachedProviderModels(m.provider).length > 0,
    );
    if (!first) return;
    updateSettings({ model: first.id });
    toast(`Asosiy model: ${first.label}`);
  });

  const addProvider = (presetId: string) => {
    const preset = presetById(presetId);
    if (!preset) return;
    if (providers.some((p) => p.id === preset.id)) {
      setEditing(providers.find((p) => p.id === preset.id)!);
      setAdd(false);
      return;
    }
    const cfg: ProviderConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      apiKey: '',
      enabled: true,
      manual: [],
    };
    updateSettings({ providers: [...providers, cfg] });
    setAdd(false);
    setEditing(cfg);
  };

  const addCustom = () => {
    const cfg: ProviderConfig = {
      id: `custom_${Date.now().toString(36)}`,
      label: 'Oʻz serverim',
      baseUrl: '',
      apiKey: '',
      enabled: true,
      manual: [],
    };
    updateSettings({ providers: [...providers, cfg] });
    setAdd(false);
    setEditing(cfg);
  };

  return (
    <>
      <div className="section-label" style={{ padding: '14px 0 6px' }}>
        AI modellar
      </div>

      <div className="tiny" style={{ marginBottom: 10 }}>
        Gemini’dan tashqari Kimi, Qwen, DeepSeek, GPT va boshqa modellarni ham ulasangiz
        boʻladi. Bittasi band boʻlsa Daho oʻzi boshqasiga oʻtadi.
      </div>

      {providers.map((p) => {
        const count = models.filter((m) => m.provider === p.id).length;
        // Roʻyxat hali kelmagan boʻlsa tavsiya modellar ishlatiladi.
        const fetched = cachedProviderModels(p.id).length;
        return (
          <button className="prov-row" key={p.id} onClick={() => setEditing(p)}>
            <span className="prov-dot" data-on={p.enabled && Boolean(p.apiKey)} />
            <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
              <b>{p.label}</b>
              <div className="tiny">
                {!p.apiKey
                  ? 'kalit kiritilmagan'
                  : !p.enabled
                    ? 'oʻchirilgan'
                    : fetched
                      ? `✓ ${count} ta model tayyor`
                      : `${count} ta tavsiya model · roʻyxat olinmoqda…`}
              </div>
            </span>
          </button>
        );
      })}

      <button className="btn ghost wide" style={{ marginTop: 8 }} onClick={() => setAdd(true)}>
        + Model provayderi ulash
      </button>

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn ghost grow" onClick={() => setListOpen(true)}>
          <Cpu size={15} /> Modellar ({active})
        </button>
        <button className="btn ghost grow" onClick={() => setRolesOpen(true)}>
          👥 Rollar
        </button>
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <Switch
          on={settings.autoContinue !== false}
          onChange={(on) => updateSettings({ autoContinue: on })}
          label="Uzilgan javobni davom ettirish"
          hint="Kuchsiz model javobni kesib qoʻysa — oʻzi davom ettiradi"
        />
      </div>

      <div className="field">
        <label>Koʻpi bilan necha marta davom ettirsin: {settings.maxContinues ?? 6}</label>
        <input
          type="range"
          min={1}
          max={15}
          value={settings.maxContinues ?? 6}
          onChange={(e) => updateSettings({ maxContinues: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label>Code agenti qadamlari: {settings.agentRounds ?? 60}</label>
        <input
          type="range"
          min={10}
          max={150}
          step={5}
          value={settings.agentRounds ?? 60}
          onChange={(e) => updateSettings({ agentRounds: Number(e.target.value) })}
        />
        <div className="tiny">
          Katta loyihalar uchun koʻproq qadam kerak. Har qadam — bitta model chaqiruvi.
        </div>
      </div>

      {addOpen && (
        <Sheet title="Provayder tanlang" onClose={() => setAdd(false)}>
          {PROVIDER_PRESETS.map((preset) => (
            <button key={preset.id} className="action-row" onClick={() => addProvider(preset.id)}>
              <span className="action-icon">🔌</span>
              <span className="grow">
                <b>{preset.label}</b>
                <div className="tiny">{preset.note}</div>
              </span>
            </button>
          ))}
          <button className="action-row" onClick={addCustom}>
            <span className="action-icon">⚙️</span>
            <span className="grow">
              <b>Boshqa (OpenAI-mos)</b>
              <div className="tiny">Oʻz serveringiz yoki roʻyxatda yoʻq xizmat</div>
            </span>
          </button>
        </Sheet>
      )}

      {editing && (
        <ProviderEditor
          cfg={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            updateSettings({ providers: providers.filter((p) => p.id !== editing.id) });
            setEditing(null);
          }}
        />
      )}

      {listOpen && <ModelList onClose={() => setListOpen(false)} />}
      {rolesOpen && <RolePicker onClose={() => setRolesOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Provayder sozlamasi                                                */
/* ------------------------------------------------------------------ */

function ProviderEditor({
  cfg,
  onClose,
  onDelete,
}: {
  cfg: ProviderConfig;
  onClose: () => void;
  onDelete: () => void;
}) {
  const providers = useStore((s) => s.settings.providers ?? []);
  const live = providers.find((p) => p.id === cfg.id) ?? cfg;
  const preset = presetById(cfg.id);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [manual, setManual] = useState((live.manual ?? []).join(', '));

  const patch = (next: Partial<ProviderConfig>) =>
    updateSettings({
      providers: providers.map((p) => (p.id === cfg.id ? { ...p, ...next } : p)),
    });

  const load = async () => {
    if (!live.apiKey.trim()) {
      toast('Avval kalitni kiriting');
      return;
    }
    if (!live.baseUrl.trim()) {
      toast('Manzil (baseUrl) kiritilmagan');
      return;
    }
    setBusy(true);
    try {
      const ids = await listProviderModels(live, true);
      setFound(ids);
      toast(ids.length ? `${ids.length} ta model topildi` : 'Roʻyxat boʻsh — model nomini qoʻlda yozing');
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={live.label} onClose={onClose}>
      <label className="field">
        <span>Nomi</span>
        <input value={live.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>

      <label className="field">
        <span>API manzili</span>
        <input
          value={live.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value.trim() })}
          placeholder="https://openrouter.ai/api/v1"
          autoCapitalize="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>API kalit</span>
        <input
          type="password"
          value={live.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value.trim() })}
          placeholder="sk-…"
          autoCapitalize="off"
          spellCheck={false}
        />
        {preset && (
          <div className="tiny" style={{ marginTop: 6 }}>
            Kalitni olish: {preset.keyUrl}
          </div>
        )}
      </label>

      <Switch
        on={live.enabled}
        onChange={(on) => patch({ enabled: on })}
        label="Yoqilgan"
        hint="Oʻchirilsa modellari roʻyxatlarda koʻrinmaydi"
      />

      <button className="btn ghost wide" style={{ marginTop: 12 }} disabled={busy} onClick={() => void load()}>
        <Refresh size={15} /> {busy ? 'Olinmoqda…' : 'Model roʻyxatini olish'}
      </button>

      {!!found.length && (
        <div className="tiny" style={{ marginTop: 8, maxHeight: 120, overflow: 'auto' }}>
          {found.slice(0, 40).join(' · ')}
          {found.length > 40 ? ` … +${found.length - 40}` : ''}
        </div>
      )}

      <label className="field" style={{ marginTop: 12 }}>
        <span>Qoʻlda model nomlari (vergul bilan)</span>
        <textarea
          rows={2}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onBlur={() =>
            patch({
              manual: manual
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder={preset?.suggested.slice(0, 3).join(', ') ?? 'model-nomi'}
        />
        {preset && (
          <div className="chips" style={{ marginTop: 6 }}>
            {preset.suggested.map((id) => (
              <button
                key={id}
                className="chip"
                onClick={() => {
                  const next = [...new Set([...(live.manual ?? []), id])];
                  setManual(next.join(', '));
                  patch({ manual: next });
                }}
              >
                + {id}
              </button>
            ))}
          </div>
        )}
      </label>

      <button
        className="btn ghost wide"
        style={{ marginTop: 12, color: 'var(--danger)' }}
        onClick={onDelete}
      >
        <Trash size={15} /> Provayderni olib tashlash
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Model roʻyxati — yoqish/oʻchirish                                  */
/* ------------------------------------------------------------------ */

function ModelList({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  const hidden = new Set(settings.hiddenModels ?? []);
  const all = allCachedModels();
  const q = query.trim().toLowerCase();
  const visible = q ? all.filter((m) => m.id.toLowerCase().includes(q)) : all;

  const toggle = (id: string) => {
    const next = hidden.has(id)
      ? (settings.hiddenModels ?? []).filter((x) => x !== id)
      : [...(settings.hiddenModels ?? []), id];
    updateSettings({ hiddenModels: next });
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const list = await allModels(true);
      toast(`${list.length} ta model`);
      force((n) => n + 1);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Modellar" onClose={onClose}>
      <div className="tiny" style={{ marginBottom: 10 }}>
        Keraksiz modellarni oʻchirib qoʻying — ular tanlash roʻyxatlarida koʻrinmaydi
        va zaxira model sifatida ham ishlatilmaydi.
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input
          className="grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Qidirish: kimi, qwen, flash…"
        />
        <button className="btn mini ghost" disabled={busy} onClick={() => void refresh()}>
          <Refresh size={14} />
        </button>
      </div>

      <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
        {visible.map((m) => {
          const on = !hidden.has(m.id);
          return (
            <button
              key={m.id}
              className={on ? 'model-row on' : 'model-row'}
              onClick={() => toggle(m.id)}
            >
              <span className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                <b>{m.label}</b>
                <div className="tiny">
                  {m.providerLabel ?? 'Gemini'} · {m.role}
                  {m.preview ? ' · sinov' : ''}
                </div>
              </span>
              <span className="model-mark">{on ? '✓' : <Close size={14} />}</span>
            </button>
          );
        })}
        {!visible.length && <div className="tiny">Hech narsa topilmadi.</div>}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Rollar — koʻp agentli ish                                          */
/* ------------------------------------------------------------------ */

function RolePicker({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const hidden = new Set(settings.hiddenModels ?? []);
  const chat = allCachedModels().filter((m) => m.role === 'chat' && !hidden.has(m.id));

  const set = (key: keyof RoleModels, value: string) =>
    updateSettings({ roleModels: { ...settings.roleModels, [key]: value } });

  return (
    <Sheet title="Agent rollari" onClose={onClose}>
      <div className="tiny" style={{ marginBottom: 12 }}>
        Daho Code katta ishni yordamchi agentlarga boʻlib beradi. Har bir rol uchun
        alohida model tanlashingiz mumkin — masalan dizaynga kuchli model, matnga tez model.
        Boʻsh qoldirsangiz asosiy model ishlatiladi.
      </div>

      {ROLE_LABEL.map((role) => (
        <label className="field" key={role.key}>
          <span>
            {role.title} — <i className="tiny">{role.hint}</i>
          </span>
          <select
            value={settings.roleModels[role.key] ?? ''}
            onChange={(e) => set(role.key, e.target.value)}
          >
            <option value="">Asosiy model</option>
            {chat.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.providerLabel ? ` · ${m.providerLabel}` : ''}
              </option>
            ))}
          </select>
        </label>
      ))}

      {!chat.some((m) => m.provider) && (
        <div className="tiny" style={{ marginTop: 8, opacity: 0.75 }}>
          💡 Turli provayderdan model ulasangiz, bittasi band boʻlganda ish toʻxtamaydi.
        </div>
      )}
    </Sheet>
  );
}

/**
 * Suhbat modelini tanlash — Gemini va ulangan provayderlar birga.
 * Sozlamalarda ham, boshqa joylarda ham shu ishlatiladi.
 */
export function ChatModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const hidden = useStore((s) => s.settings.hiddenModels ?? []);
  const skip = new Set(hidden);
  const list = allCachedModels().filter((m) => m.role === 'chat' && !skip.has(m.id));
  const known = list.some((m) => m.id === value);

  // Provayder boʻyicha guruhlaymiz — roʻyxat uzun boʻlganda tushunarli boʻlsin.
  const groups = new Map<string, typeof list>();
  for (const m of list) {
    const key = m.providerLabel ?? 'Gemini';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{parseRef(value).model} (roʻyxatda yoʻq)</option>}
      {[...groups.entries()].map(([label, items]) => (
        <optgroup key={label} label={label}>
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.preview ? ' · sinov' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
