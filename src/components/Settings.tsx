import { useEffect, useRef, useState } from 'react';
import { playWavBase64 } from '../lib/audio';
import { saveBackup } from '../lib/exporter';
import { whoAmI } from '../lib/github';
import { byRole, cachedModels, getModels, pickModel, type ModelInfo } from '../lib/models';
import { VOICES, listDeviceVoices, speak, synthesize, type DeviceVoice } from '../lib/speech';
import { exportState, importState, resetState, updateSettings, useStore } from '../lib/store';
import { Refresh } from './Icons';
import { Sheet, Switch, toast } from './ui';

const TTS_LANGS = [
  { id: 'uz-UZ', label: 'Oʻzbekcha' },
  { id: 'ru-RU', label: 'Ruscha' },
  { id: 'en-US', label: 'Inglizcha' },
  { id: 'tr-TR', label: 'Turkcha' },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const [models, setModels] = useState<ModelInfo[]>(cachedModels());
  const [loadingModels, setLoadingModels] = useState(false);
  const [deviceVoices, setDeviceVoices] = useState<DeviceVoice[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ghChecking, setGhChecking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listDeviceVoices().then(setDeviceVoices);
  }, []);

  const refreshModels = async (force = true) => {
    if (!settings.apiKey) {
      toast('Avval API kalitni kiriting');
      return;
    }
    setLoadingModels(true);
    try {
      const list = await getModels(settings.apiKey, force);
      setModels(list);
      updateSettings({
        model: pickModel(list, 'chat', settings.model) ?? settings.model,
        imageModel: pickModel(list, 'image', settings.imageModel) ?? settings.imageModel,
        ttsModel: pickModel(list, 'tts', settings.ttsModel) ?? settings.ttsModel,
      });
      toast(`${list.length} ta model topildi`);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setLoadingModels(false);
    }
  };

  const chatModels = byRole(models, 'chat');
  const imageModels = byRole(models, 'image');
  const ttsModels = byRole(models, 'tts');

  const deviceMatching = deviceVoices.filter((v) =>
    v.lang?.toLowerCase().startsWith(settings.ttsLang.slice(0, 2).toLowerCase()),
  );

  const tryVoice = async () => {
    if (testing) return;
    setTesting(true);
    const sample = 'Salom! Men Daho — sizning oʻquv yordamchingizman. Keling, birga oʻrganamiz.';
    try {
      if (settings.ttsEngine === 'gemini' && settings.apiKey) {
        playWavBase64(await synthesize(sample));
      } else {
        await speak(sample);
      }
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setTesting(false);
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    toast(importState(text) ? 'Maʼlumotlar tiklandi' : 'Fayl notoʻgʻri');
  };

  const modelOptions = (list: ModelInfo[], current: string) => {
    const known = list.some((m) => m.id === current);
    return (
      <>
        {!known && <option value={current}>{current} (roʻyxatda yoʻq)</option>}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.preview ? ' · sinov' : ''}
          </option>
        ))}
      </>
    );
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
          Kalitni bepul olish: aistudio.google.com/apikey. Kalit faqat shu telefonda saqlanadi.
        </div>
      </div>

      <button
        className="btn ghost wide"
        onClick={() => void refreshModels()}
        disabled={loadingModels}
        style={{ marginBottom: 12 }}
      >
        <Refresh size={15} /> {loadingModels ? 'Qidirilmoqda…' : 'Modellarni yangilash'}
      </button>
      <div className="tiny" style={{ margin: '-6px 0 12px' }}>
        Roʻyxat Google’dan jonli olinadi — yangi model chiqsa shu yerda oʻzi paydo boʻladi.
        Eski model ishlamay qolsa ham shu tugma tuzatadi.
      </div>

      <div className="field">
        <label>Suhbat modeli</label>
        <select value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })}>
          {modelOptions(chatModels, settings.model)}
        </select>
      </div>

      <div className="field">
        <label>Rasm modeli</label>
        {imageModels.length ? (
          <select
            value={settings.imageModel}
            onChange={(e) => updateSettings({ imageModel: e.target.value })}
          >
            {modelOptions(imageModels, settings.imageModel)}
          </select>
        ) : (
          <input
            value={settings.imageModel}
            onChange={(e) => updateSettings({ imageModel: e.target.value.trim() })}
          />
        )}
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

      <div className="field">
        <label>Ovoz manbai</label>
        <select
          value={settings.ttsEngine}
          onChange={(e) => updateSettings({ ttsEngine: e.target.value as 'gemini' | 'qurilma' })}
        >
          <option value="gemini">Gemini — tabiiy, jonli ovoz</option>
          <option value="qurilma">Telefon ovozi — internetsiz, lekin robotroq</option>
        </select>
      </div>

      {settings.ttsEngine === 'gemini' ? (
        <>
          <div className="field">
            <label>Diktor</label>
            <div className="voice-grid">
              {VOICES.map((v) => (
                <button
                  key={v.id}
                  className={settings.ttsVoice === v.id ? 'voice-tile on' : 'voice-tile'}
                  onClick={() => updateSettings({ ttsVoice: v.id })}
                >
                  <b>{v.name}</b>
                  <span>{v.note}</span>
                </button>
              ))}
            </div>
          </div>
          {ttsModels.length > 0 && (
            <div className="field">
              <label>Ovoz modeli</label>
              <select
                value={settings.ttsModel}
                onChange={(e) => updateSettings({ ttsModel: e.target.value })}
              >
                {modelOptions(ttsModels, settings.ttsModel)}
              </select>
            </div>
          )}
        </>
      ) : (
        <>
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
          </div>
          {deviceMatching.length > 0 && (
            <div className="field">
              <label>Ovoz</label>
              <select
                value={settings.ttsVoiceUri}
                onChange={(e) => updateSettings({ ttsVoiceUri: e.target.value })}
              >
                <option value="">Standart</option>
                {deviceMatching.map((v) => (
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
        </>
      )}

      <Switch
        on={settings.autoSpeak}
        onChange={(v) => updateSettings({ autoSpeak: v })}
        label="Javoblarni avtomatik oʻqib berish"
      />

      <button className="btn ghost wide" onClick={() => void tryVoice()} disabled={testing}>
        {testing ? 'Tayyorlanmoqda…' : 'Ovozni sinab koʻrish'}
      </button>

      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Mikrofon
      </div>

      <div className="field">
        <label>Nutqni tanish</label>
        <select
          value={settings.sttEngine}
          onChange={(e) => updateSettings({ sttEngine: e.target.value as 'gemini' | 'qurilma' })}
        >
          <option value="gemini">Gemini — oʻzbekchani yaxshi tushunadi</option>
          <option value="qurilma">Telefon xizmati — tezroq, lekin aniqligi past</option>
        </select>
        <div className="tiny" style={{ marginTop: 5 }}>
          Gemini rejimida gapirib boʻlgach mikrofon tugmasini yana bosing — yozuv matnga
          aylanadi.
        </div>
      </div>

      <div className="field">
        <label>Gapirish tili</label>
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
        GitHub (Daho Code uchun)
      </div>

      <div className="field">
        <label>Shaxsiy token</label>
        <input
          type="password"
          value={settings.githubToken}
          onChange={(e) => updateSettings({ githubToken: e.target.value.trim() })}
          placeholder="ghp_… yoki github_pat_…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="tiny" style={{ marginTop: 6 }}>
          github.com → Settings → Developer settings → Personal access tokens →
          <b> Tokens (classic)</b> → Generate new token. <b>repo</b> va{' '}
          <b>workflow</b> ruxsatlarini belgilang. Token faqat shu telefonda saqlanadi.
        </div>
      </div>

      <div className="field">
        <label>Domeningiz (ixtiyoriy)</label>
        <input
          value={settings.publishDomain}
          onChange={(e) => updateSettings({ publishDomain: e.target.value.trim() })}
          placeholder="daho.uz"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="tiny" style={{ marginTop: 6 }}>
          Loyihani chiqarganda shu domen ishlatiladi. DNS sozlash koʻrsatmasi Daho Code →
          Nashr boʻlimida.
        </div>
      </div>

      <button
        className="btn ghost wide"
        disabled={ghChecking}
        onClick={async () => {
          if (!settings.githubToken) {
            toast('Avval tokenni kiriting');
            return;
          }
          setGhChecking(true);
          try {
            const user = await whoAmI(settings.githubToken);
            toast(`Ulandi: ${user.login}`);
          } catch (err) {
            toast(String((err as Error)?.message ?? err));
          } finally {
            setGhChecking(false);
          }
        }}
      >
        {ghChecking ? 'Tekshirilmoqda…' : 'GitHub ulanishini tekshirish'}
      </button>

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
          if (window.confirm('Barcha suhbat, kurs, ilova va jadval oʻchiriladi. Davom etamizmi?')) {
            resetState();
            toast('Hammasi tozalandi');
            onClose();
          }
        }}
      >
        Hamma maʼlumotni oʻchirish
      </button>

      <div className="tiny" style={{ textAlign: 'center', marginTop: 16 }}>
        Daho 2.0 · maʼlumotlar faqat shu telefonda saqlanadi
      </div>
    </Sheet>
  );
}
