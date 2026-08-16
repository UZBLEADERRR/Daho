import { useEffect, useRef, useState } from 'react';
import { saveBackup } from '../lib/exporter';
import { listVoices, speak, type VoiceOption } from '../lib/speech';
import { exportState, importState, resetState, updateSettings, useStore } from '../lib/store';
import { Sheet, Switch, toast } from './ui';

const MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — tez, kundalik ish uchun' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — eng kuchli, murakkab masalalar' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — eng tejamkor' },
];

const TTS_LANGS = [
  { id: 'uz-UZ', label: 'Oʻzbekcha' },
  { id: 'ru-RU', label: 'Ruscha' },
  { id: 'en-US', label: 'Inglizcha' },
  { id: 'tr-TR', label: 'Turkcha' },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [showKey, setShowKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listVoices().then(setVoices);
  }, []);

  const matching = voices.filter((v) =>
    v.lang?.toLowerCase().startsWith(settings.ttsLang.slice(0, 2).toLowerCase()),
  );

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    toast(importState(text) ? 'Maʼlumotlar tiklandi' : 'Fayl notoʻgʻri');
  };

  return (
    <Sheet title="Sozlamalar" onClose={onClose}>
      <div className="section-label" style={{ padding: '0 0 6px' }}>
        Gemini
      </div>

      <div className="field">
        <label>API kalit</label>
        <div className="row">
          <input
            className="grow"
            type={showKey ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(e) => updateSettings({ apiKey: e.target.value.trim() })}
            placeholder="AIza…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn mini ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? 'Yashir' : 'Koʻrsat'}
          </button>
        </div>
        <div className="tiny" style={{ marginTop: 6 }}>
          Kalitni bepul olish: aistudio.google.com/apikey. Kalit faqat shu telefonda saqlanadi,
          hech qayerga yuborilmaydi.
        </div>
      </div>

      <div className="field">
        <label>Model</label>
        <select
          value={settings.model}
          onChange={(e) => updateSettings({ model: e.target.value })}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Rasm modeli</label>
        <input
          value={settings.imageModel}
          onChange={(e) => updateSettings({ imageModel: e.target.value.trim() })}
          placeholder="gemini-2.5-flash-image"
        />
      </div>

      <div className="field">
        <label>Ijodkorlik: {settings.temperature.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={settings.temperature}
          onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
          style={{ padding: 0, background: 'none', border: 'none' }}
        />
      </div>

      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Ovoz
      </div>

      <Switch
        on={settings.autoSpeak}
        onChange={(v) => updateSettings({ autoSpeak: v })}
        label="Javoblarni avtomatik oʻqib berish"
        hint="Qurilmaning bepul ovoz sintezatori ishlatiladi"
      />

      <div className="field">
        <label>Ovoz tili</label>
        <select
          value={settings.ttsLang}
          onChange={(e) => updateSettings({ ttsLang: e.target.value, ttsVoiceUri: '' })}
        >
          {TTS_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <div className="tiny" style={{ marginTop: 5 }}>
          Oʻzbekcha ovoz koʻp qurilmalarda oʻrnatilmagan. Boʻlmasa, Play Store’dan “Google Text-to-Speech”
          ni yangilang yoki ruscha ovozni tanlang.
        </div>
      </div>

      {matching.length > 0 && (
        <div className="field">
          <label>Ovoz</label>
          <select
            value={settings.ttsVoiceUri}
            onChange={(e) => updateSettings({ ttsVoiceUri: e.target.value })}
          >
            <option value="">Standart</option>
            {matching.map((v) => (
              <option key={v.uri} value={v.uri}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Oʻqish tezligi: {settings.ttsRate.toFixed(1)}×</label>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={settings.ttsRate}
          onChange={(e) => updateSettings({ ttsRate: Number(e.target.value) })}
          style={{ padding: 0, background: 'none', border: 'none' }}
        />
      </div>

      <button
        className="btn ghost wide"
        onClick={() =>
          speak('Salom! Men Daho, sizning oʻquv yordamchingizman.', {
            lang: settings.ttsLang,
            rate: settings.ttsRate,
            voiceUri: settings.ttsVoiceUri,
          })
        }
      >
        Ovozni sinab koʻrish
      </button>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Mikrofon tili</label>
        <select
          value={settings.sttLang}
          onChange={(e) => updateSettings({ sttLang: e.target.value })}
        >
          {TTS_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Shaxsiy
      </div>

      <div className="field-row">
        <div className="field">
          <label>Ismingiz</label>
          <input
            value={settings.userName}
            onChange={(e) => updateSettings({ userName: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Universitet</label>
          <input
            value={settings.university}
            onChange={(e) => updateSettings({ university: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label>Agent uchun qoʻshimcha koʻrsatma</label>
        <textarea
          value={settings.customInstructions}
          onChange={(e) => updateSettings({ customInstructions: e.target.value })}
          placeholder="Masalan: men 2-kurs dasturchiman, javoblarda kod misollari koʻp boʻlsin."
        />
      </div>

      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Koʻrinish
      </div>

      <Switch
        on={settings.theme === 'tun'}
        onChange={(v) => updateSettings({ theme: v ? 'tun' : 'kun' })}
        label="Tungi rejim"
      />

      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Maʼlumotlar
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="row">
        <button
          className="btn ghost grow"
          onClick={async () => {
            try {
              toast(await saveBackup(exportState()));
            } catch (err) {
              toast(`Xato: ${(err as Error).message}`);
            }
          }}
        >
          Zaxira nusxa
        </button>
        <button className="btn ghost grow" onClick={() => fileRef.current?.click()}>
          Tiklash
        </button>
      </div>

      <button
        className="btn ghost wide"
        style={{ marginTop: 9, color: 'var(--danger)' }}
        onClick={() => {
          if (window.confirm('Barcha suhbat, konspekt va jadval oʻchiriladi. Davom etamizmi?')) {
            resetState();
            toast('Hammasi tozalandi');
            onClose();
          }
        }}
      >
        Hamma maʼlumotni oʻchirish
      </button>

      <div className="tiny" style={{ textAlign: 'center', marginTop: 16 }}>
        Daho 1.0 · maʼlumotlar faqat shu telefonda saqlanadi
      </div>
    </Sheet>
  );
}
