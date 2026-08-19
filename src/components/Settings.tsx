import { useEffect, useRef, useState } from 'react';
import { blobToWavBytes, bytesToB64, playWavBase64 } from '../lib/audio';
import { applyAppLook } from '../lib/applook';
import { copyText, saveBackup } from '../lib/exporter';
import { getRepo, whoAmI } from '../lib/github';
import { sbPing } from '../lib/supabase';
import { transcribeAudio } from '../lib/gemini';
import { applyBackupSetting, cloudEnabled, useCloud } from '../lib/cloud';
import { byRole, cachedModels, geminiModel, getModels, pickModel, type ModelInfo } from '../lib/models';
import { useInstallPrompt } from '../lib/pwa';
import { aiAvailable, resolveSource } from '../lib/route';
import type { AiSource } from '../lib/types';
import {
  VOICES,
  checkMicrophone,
  listDeviceVoices,
  speak,
  synthesize,
  type DeviceVoice,
  type MicCheck,
} from '../lib/speech';
import { exportState, getState, importState, resetState, updateSettings, useStore } from '../lib/store';
import { ChatModelSelect, ModelsPanel } from './ModelsPanel';
import { UsagePanel } from './UsagePanel';
import { Copy, Refresh } from './Icons';
import { Sheet, Switch, toast } from './ui';

const ACCENTS = [
  { name: 'Binafsha', hex: '#8b7cf6' },
  { name: 'Koʻk', hex: '#3987e5' },
  { name: 'Yashil', hex: '#199e70' },
  { name: 'Zangori', hex: '#0ea5a5' },
  { name: 'Toʻq sariq', hex: '#e07a2f' },
  { name: 'Pushti', hex: '#d55181' },
  { name: 'Qizil', hex: '#e05555' },
  { name: 'Oltin', hex: '#c98500' },
];

const TTS_LANGS = [
  { id: 'uz-UZ', label: 'Oʻzbekcha' },
  { id: 'ru-RU', label: 'Ruscha' },
  { id: 'en-US', label: 'Inglizcha' },
  { id: 'tr-TR', label: 'Turkcha' },
];

interface SettingsProps {
  onClose: () => void;
  onOpenAccount: () => void;
}

export function Settings({ onClose, onOpenAccount }: SettingsProps) {
  const settings = useStore((s) => s.settings);
  const cloud = useCloud();
  const install = useInstallPrompt();
  const [models, setModels] = useState<ModelInfo[]>(cachedModels());
  const [loadingModels, setLoadingModels] = useState(false);
  const [deviceVoices, setDeviceVoices] = useState<DeviceVoice[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ghChecking, setGhChecking] = useState(false);
  const [micChecks, setMicChecks] = useState<MicCheck[] | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [micBusy, setMicBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listDeviceVoices().then(setDeviceVoices);
  }, []);

  const refreshModels = async (force = true) => {
    if (!aiAvailable(settings.apiKey)) {
      toast('Avval API kalitni kiriting yoki Daho Cloud hisobiga kiring');
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

  /** Sozlamalar boʻlimlari — bittasi ochiladi, qolgani xalaqit bermaydi. */
  const groups: Array<{
    id: string;
    icon: string;
    title: string;
    hint: string;
    show?: boolean;
    body: JSX.Element;
  }> = [
    {
      id: 'cloud',
      icon: '☁️',
      title: 'Daho Cloud',
      hint: 'Hisob, obuna va sinxronizatsiya',
      show: cloudEnabled,
      body: (
        <>

          <div className="section-label" style={{ padding: '0 0 6px' }}>
            Daho Cloud
          </div>

          <button className="btn ghost wide" onClick={onOpenAccount}>
            {cloud.status === 'kirgan'
              ? `Hisobim · ${cloud.account?.plan?.name ?? 'rejasiz'}`
              : 'Kirish yoki roʻyxatdan oʻtish'}
          </button>

          <div className="field" style={{ marginTop: 12 }}>
            <label>AI qayerdan ishlaydi</label>
            <select
              value={settings.aiSource}
              onChange={(e) => updateSettings({ aiSource: e.target.value as AiSource })}
            >
              <option value="auto">Avtomatik — kalit boʻlsa oʻzimniki, boʻlmasa obuna</option>
              <option value="byok">Faqat oʻz API kalitim</option>
              <option value="cloud">Faqat Daho Cloud obunasi</option>
            </select>
            <div className="tiny" style={{ marginTop: 6 }}>
              Hozir ishlatilmoqda:{' '}
              <b>{resolveSource(settings.apiKey) === 'cloud' ? 'Daho Cloud' : 'oʻz kalitingiz'}</b>
              {cloud.account ? ` · qolgan kredit: ${Math.round(cloud.account.balance)}` : ''}
            </div>
          </div>

          <Switch
            on={settings.cloudBackup}
            onChange={(value) => {
              updateSettings({ cloudBackup: value });
              applyBackupSetting(value);
            }}
            label="Bulutga sinxronlash"
            hint="Suhbat, konspekt, vazifa va loyihalar barcha qurilmalarda bir xil boʻladi. API kalit va GitHub tokeni hech qachon yuborilmaydi."
          />

        </>
      ),
    },
    {
      id: 'ai',
      icon: '🧠',
      title: 'AI modellar',
      hint: 'Gemini, OpenRouter, rol modellari va ijodkorlik',
      body: (
        <>
      <div className="section-label" style={{ padding: '0 0 6px' }}>
        Gemini (ixtiyoriy)
      </div>

      <div className="tiny" style={{ marginBottom: 10, lineHeight: 1.55 }}>
        Ilova <b>faqat OpenRouter</b> (yoki boshqa provayder) bilan ham toʻliq
        gaplashadi — pastdagi «Provayderlar» roʻyxatiga qarang. Google kaliti
        quyidagilar uchun kerak: <b>internet qidiruvi</b>, <b>tabiiy ovoz</b>{' '}
        (Gemini TTS) va <b>mikrofonni matnga oʻgirish</b>. Kalitsiz ovoz
        telefonning oʻz xizmati bilan ishlaydi. Rasm yasash uchun OpenRouter’da
        rasm modeli qoʻshsangiz kifoya.
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
        <ChatModelSelect value={settings.model} onChange={(id) => updateSettings({ model: id })} />
      </div>

      <ModelsPanel />

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

        </>
      ),
    },
    {
      id: 'xarajat',
      icon: '📊',
      title: 'Xarajat va xotira',
      hint: 'Sarflangan token, narx va eslab qolinganlar',
      body: (
        <>
      <UsagePanel />
        </>
      ),
    },
    {
      id: 'ovoz',
      icon: '🎙',
      title: 'Ovoz va mikrofon',
      hint: 'Diktor, tillar, nutqni tanish va tekshiruv',
      body: (
        <>
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

      <button
        className="btn ghost wide"
        style={{ marginTop: 4 }}
        disabled={micBusy}
        onClick={async () => {
          setMicBusy(true);
          setMicChecks(null);
          try {
            setMicChecks(await checkMicrophone());
          } finally {
            setMicBusy(false);
          }
        }}
      >
        {micBusy ? 'Tekshirilmoqda…' : '🎤 Mikrofonni tekshirish'}
      </button>

      {micChecks && (
        <div className="card" style={{ marginTop: 10 }}>
          {micChecks.map((c) => (
            <div key={c.step} className="between" style={{ marginBottom: 6, gap: 10 }}>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5 }}>
                  {c.ok ? '✅' : '❌'} {c.step}
                </div>
                <div className="tiny" style={{ wordBreak: 'break-word' }}>
                  {c.detail}
                </div>
              </span>
            </div>
          ))}
          <button
            className="btn mini ghost"
            style={{ marginTop: 6 }}
            onClick={async () => {
              const text = micChecks
                .map((c) => `${c.ok ? 'OK' : 'XATO'} — ${c.step}: ${c.detail}`)
                .join('\n');
              toast((await copyText(text)) ? 'Nusxalandi — menga yuboring' : 'Nusxalab boʻlmadi');
            }}
          >
            <Copy size={12} /> Natijani nusxalash
          </button>
        </div>
      )}


            <MicCheck />
        </>
      ),
    },
    {
      id: 'github',
      icon: '⌨️',
      title: 'GitHub',
      hint: 'Daho Code uchun token va nashr domeni',
      body: (
        <>
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

        </>
      ),
    },
    {
      id: 'supabase',
      icon: '🗄',
      title: 'Supabase',
      hint: 'Loyihalaringiz uchun maʼlumot bazasi',
      body: (
        <>
      <SupabasePanel />
        </>
      ),
    },
    {
      id: 'qiyofa',
      icon: '🎨',
      title: 'Ilova qiyofasi',
      hint: 'Ilova nomi va ikonkasini almashtirish',
      body: (
        <>
      <AppLook />
        </>
      ),
    },
    {
      id: 'shaxsiy',
      icon: '👤',
      title: 'Shaxsiy',
      hint: 'Ismingiz, oʻqish joyingiz va koʻrsatmalar',
      body: (
        <>
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

        </>
      ),
    },
    {
      id: 'korinish',
      icon: '🌗',
      title: 'Koʻrinish',
      hint: 'Mavzu, rang va matn oʻlchami',
      body: (
        <>
      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Koʻrinish
      </div>

      <Switch
        on={settings.theme === 'tun'}
        onChange={(v) => updateSettings({ theme: v ? 'tun' : 'kun' })}
        label="Tungi rejim"
      />

      <div className="field" style={{ marginTop: 10 }}>
        <label>Urgʻu rangi</label>
        <div className="accent-picker">
          {ACCENTS.map((a) => (
            <button
              key={a.hex}
              className={settings.accent === a.hex ? 'on' : ''}
              style={{ background: a.hex }}
              onClick={() => updateSettings({ accent: a.hex })}
              aria-label={a.name}
            />
          ))}
        </div>
        <input
          type="color"
          value={settings.accent}
          onChange={(e) => updateSettings({ accent: e.target.value })}
          style={{ height: 44, padding: 4, marginTop: 8 }}
        />
      </div>

      <div className="field">
        <label>Matn oʻlchami: {Math.round(settings.fontScale * 100)}%</label>
        <input
          type="range"
          min={0.85}
          max={2}
          step={0.05}
          value={settings.fontScale}
          onChange={(e) => updateSettings({ fontScale: Number(e.target.value) })}
          style={{ padding: 0, background: 'none', border: 'none' }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          {[0.9, 1, 1.2, 1.5, 1.8].map((value) => (
            <button
              key={value}
              className={
                Math.abs(settings.fontScale - value) < 0.03 ? 'btn mini' : 'btn mini ghost'
              }
              onClick={() => updateSettings({ fontScale: value })}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
        <div
          className="cloud-card"
          style={{ marginTop: 10, fontSize: `${(15 * settings.fontScale).toFixed(1)}px` }}
        >
          Suhbatdagi matn shunday koʻrinadi. Kattalashtirsangiz javoblar,
          konspekt va kitob matni ham shu oʻlchamda boʻladi.
        </div>
      </div>

        </>
      ),
    },
    {
      id: 'malumot',
      icon: '💾',
      title: 'Maʼlumotlar',
      hint: 'Zaxira nusxa, tiklash va tozalash',
      body: (
        <>
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
        </>
      ),
    },
  ];

  const current = groups.find((g) => g.id === openGroup);

  if (current) {
    return (
      <Sheet title={current.title} onClose={() => setOpenGroup(null)}>
        <button className="btn ghost mini" style={{ marginBottom: 12 }} onClick={() => setOpenGroup(null)}>
          ← Sozlamalar
        </button>
        {current.body}
      </Sheet>
    );
  }

  return (
    <Sheet title="Sozlamalar" onClose={onClose}>
      {install.available && (
        <button
          className="btn wide"
          style={{ marginBottom: 14 }}
          onClick={() => void install.install()}
        >
          Ilovani qurilmaga oʻrnatish
        </button>
      )}


      <div className="settings-menu">
        {groups
          .filter((g) => g.show !== false)
          .map((g) => (
            <button key={g.id} className="settings-row" onClick={() => setOpenGroup(g.id)}>
              <span className="settings-icon">{g.icon}</span>
              <span className="grow">
                <b>{g.title}</b>
                <i>{g.hint}</i>
              </span>
              <span className="settings-arrow">›</span>
            </button>
          ))}
      </div>

      <div className="tiny" style={{ textAlign: 'center', marginTop: 16 }}>
        Daho 2.0 · maʼlumotlar faqat shu qurilmada saqlanadi
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Ilova qiyofasi — nom va ikonka                                     */
/* ------------------------------------------------------------------ */

function AppLook() {
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Rasm tanlang');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.onerror = () => toast('Rasmni oʻqib boʻlmadi');
    reader.readAsDataURL(file);
  };

  const apply = async () => {
    if (!settings.githubToken) {
      toast('Avval GitHub tokenini kiriting');
      return;
    }
    setBusy(true);
    setDone(null);
    try {
      const me = await whoAmI(settings.githubToken);
      const repo = await getRepo(settings.githubToken, me.login, 'Daho');
      const result = await applyAppLook({
        name: name.trim() || undefined,
        iconDataUrl: icon ?? undefined,
        repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
      });
      setDone(result.runsUrl);
      toast(`Yuborildi (${result.commit}) — APK yigʻilmoqda`);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="section-label" style={{ padding: '10px 0 6px' }}>
        Ilova qiyofasi
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <button
          className="look-icon"
          onClick={() => pickRef.current?.click()}
          aria-label="Ikonka tanlash"
        >
          {icon ? <img src={icon} alt="" /> : <span>🖼</span>}
        </button>
        <div className="grow">
          <div style={{ fontWeight: 550 }}>Ikonka</div>
          <div className="tiny">
            Kvadrat rasm tanlang — barcha oʻlchamlar telefonda yasaladi.
          </div>
        </div>
        {icon && (
          <button className="btn mini ghost" onClick={() => setIcon(null)}>
            Bekor
          </button>
        )}
      </div>

      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <div className="field">
        <label>Ilova nomi</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Daho"
          maxLength={30}
        />
      </div>

      <button className="btn wide" disabled={busy || (!icon && !name.trim())} onClick={apply}>
        {busy ? 'Yuborilmoqda…' : 'Yangi APK yigʻish'}
      </button>

      <div className="tiny" style={{ marginTop: 6 }}>
        Ishlab turgan ilova oʻz ikonkasini almashtira olmaydi — shuning uchun Daho yangi
        ikonka va nomni GitHub’dagi oʻz repozitoriysiga yozadi va APK’ni qaytadan yigʻadi.
        5-10 daqiqadan soʻng yangi APK’ni yuklab olib oʻrnatasiz. GitHub token kerak.
      </div>

      {done && (
        <a className="btn ghost wide" style={{ marginTop: 8 }} href={done} target="_blank" rel="noreferrer">
          Yigʻilishni koʻrish →
        </a>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Mikrofon tekshiruvi                                                */
/* ------------------------------------------------------------------ */

/**
 * Mikrofon nima uchun ishlamayotganini aniqlaydi: ruxsat, yozib olish,
 * matnga oʻgirish — har bir bosqich alohida koʻrsatiladi.
 */
function MicCheck() {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  const run = async () => {
    setBusy(true);
    const log: string[] = [];
    const say = (line: string) => {
      log.push(line);
      setLines([...log]);
    };

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        say('❌ Bu qurilmada mikrofon interfeysi yoʻq (getUserMedia).');
        return;
      }
      say('⏳ Ruxsat soʻralmoqda…');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const name = String((err as Error)?.name ?? '');
        say(
          name === 'NotAllowedError'
            ? '❌ Ruxsat berilmadi. Sozlamalar → Ilovalar → Daho → Ruxsatlar → Mikrofon.'
            : `❌ Mikrofon ochilmadi: ${name || String(err)}`,
        );
        return;
      }
      say('✅ Ruxsat bor, mikrofon ochildi.');

      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach((t) => t.stop());
        say('❌ MediaRecorder yoʻq — ovoz yozib boʻlmaydi.');
        return;
      }

      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      say('🎙 3 soniya gapiring…');
      await new Promise((r) => setTimeout(r, 3000));
      recorder.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      say(`✅ Yozildi: ${(blob.size / 1024).toFixed(1)} KB · ${blob.type || 'nomaʼlum'}`);
      if (blob.size < 1200) {
        say('❌ Ovoz juda kichik — mikrofon boshqa ilovada band boʻlishi mumkin.');
        return;
      }

      let data: string;
      let mimeType = blob.type.split(';')[0] || 'audio/webm';
      try {
        data = bytesToB64(await blobToWavBytes(blob));
        mimeType = 'audio/wav';
        say('✅ WAV ga oʻgirildi.');
      } catch (err) {
        data = '';
        say(`⚠️ WAV ga oʻgirilmadi: ${(err as Error).message}`);
      }
      if (!data) return;

      const { settings } = getState();
      if (!aiAvailable(settings.apiKey)) {
        say('⚠️ Kalit ham, obuna ham yoʻq — matnga oʻgirib boʻlmaydi.');
        return;
      }
      say('⏳ Matnga oʻgirilmoqda…');
      try {
        const text = await transcribeAudio(
          settings.apiKey,
          geminiModel(settings.model),
          { mimeType, data },
          undefined,
          settings.sttLang,
        );
        say(text.trim() ? `✅ Eshitildi: «${text.trim()}»` : '❌ Model matn qaytarmadi.');
      } catch (err) {
        say(`❌ Gemini xatosi: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className="btn ghost wide"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Tekshirilmoqda…' : '🎙 Mikrofonni tekshirish'}
      </button>
      {!!lines.length && (
        <div className="tiny" style={{ marginTop: 8, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
          {lines.join('\n')}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Supabase                                                           */
/* ------------------------------------------------------------------ */

/**
 * Supabase ulanishi — yasalgan ilovalar uchun haqiqiy maʼlumot bazasi.
 * Faqat ochiq (anon) kalit kiritiladi; u brauzerga chiqarish uchun
 * moʻljallangan va Supabase tomonida RLS bilan himoyalanadi.
 */
function SupabasePanel() {
  const settings = useStore((s) => s.settings);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState('');

  const check = async () => {
    setChecking(true);
    setResult('');
    try {
      const res = await sbPing();
      setResult(res.message);
      toast(res.message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="section-label" style={{ padding: '14px 0 6px' }}>
        Supabase (maʼlumot bazasi)
      </div>

      <div className="tiny" style={{ marginBottom: 10, lineHeight: 1.55 }}>
        Yasalgan ilovaga <b>haqiqiy baza</b> kerak boʻlsa — roʻyxatga olish,
        foydalanuvchi hisobi, bir nechta odam koʻradigan roʻyxat — Supabase
        ulang. Bepul. Daho jadvallarni koʻradi, yozuv qoʻshadi va oʻqiydi.
      </div>

      <div className="field">
        <label>Loyiha manzili</label>
        <input
          value={settings.supabaseUrl}
          onChange={(e) => updateSettings({ supabaseUrl: e.target.value.trim() })}
          placeholder="https://xxxxx.supabase.co"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>Ochiq (anon) kalit</label>
        <input
          type="password"
          value={settings.supabaseAnonKey}
          onChange={(e) => updateSettings({ supabaseAnonKey: e.target.value.trim() })}
          placeholder="eyJhbGciOi…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="tiny" style={{ marginTop: 6 }}>
          Supabase → Project Settings → API. <b>anon public</b> kalitini oling.
          ⚠️ <b>service_role</b> kalitini kiritmang — u maxfiy va hamma
          himoyani chetlab oʻtadi.
        </div>
      </div>

      <button className="btn ghost wide" disabled={checking} onClick={() => void check()}>
        {checking ? 'Tekshirilmoqda…' : 'Supabase ulanishini tekshirish'}
      </button>

      {result && (
        <div className="tiny" style={{ marginTop: 8, opacity: 0.8 }}>
          {result}
        </div>
      )}
    </>
  );
}
