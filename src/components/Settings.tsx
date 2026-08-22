import { Capacitor } from '@capacitor/core';
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
import {
  exportState,
  getState,
  getStorageError,
  importState,
  resetState,
  updateSettings,
  useStore,
} from '../lib/store';
import { requestPersistentStorage, storageEstimate } from '../lib/storage';
import { serverHealth } from '../lib/cloud/server';
import { listProjects } from '../lib/sbadmin';
import { disconnectGoogle, redirectUri, startGoogleAuth } from '../lib/google';
import { tgChats, tgContacts, tgMe, tgReady, tgSync } from '../lib/telegram';
import { igMedia } from '../lib/social';
import { ChatModelSelect, ModelsPanel } from './ModelsPanel';
import { UsagePanel } from './UsagePanel';
import {
  Chart,
  Cloud,
  Code,
  Copy,
  Cpu,
  Database,
  Download,
  Globe,
  Image,
  Mic,
  Moon,
  Refresh,
  Send,
  Server,
  Sparkle,
  User,
} from './Icons';
import { ConnectButton } from './ConnectButton';
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
    icon: JSX.Element;
    title: string;
    hint: string;
    show?: boolean;
    body: JSX.Element;
  }> = [
    {
      id: 'cloud',
      icon: <Cloud size={18} />,
      title: 'Daho Cloud',
      hint: 'Hisob, obuna va sinxronizatsiya',
      show: cloudEnabled,
      body: (
        <>

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
      icon: <Cpu size={18} />,
      title: 'AI modellar',
      hint: 'Gemini, OpenRouter, rol modellari va ijodkorlik',
      body: (
        <>

      <div className="tiny set-intro">
        Ixtiyoriy — internet qidiruvi, tabiiy ovoz va mikrofon uchun kerak.
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
        <div className="tiny set-hint">
          aistudio.google.com/apikey — bepul. Kalit qurilmada qoladi.
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
      id: 'telegram',
      icon: <Send size={17} />,
      title: 'Telegram bot',
      hint: 'Mijozlar, guruh va kanal boshqaruvi',
      body: <TelegramPanel />,
    },
    {
      id: 'instagram',
      icon: <Image size={18} />,
      title: 'Instagram',
      hint: 'Izoh va Direct’ga javob berish',
      body: (
        <>
          <InstagramPanel />
        </>
      ),
    },
    {
      id: 'google',
      icon: <Globe size={18} />,
      title: 'Google hisobi',
      hint: 'Gmail, Drive va Kalendar',
      body: (
        <>
          <GooglePanel />
        </>
      ),
    },
    {
      id: 'server',
      icon: <Server size={18} />,
      title: 'Daho serveri',
      hint: 'Fon ishlari va haqiqiy terminal',
      body: (
        <>
          <ServerPanel />
        </>
      ),
    },
    {
      id: 'xarajat',
      icon: <Chart size={18} />,
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
      icon: <Mic size={18} />,
      title: 'Ovoz va mikrofon',
      hint: 'Diktor, tillar, nutqni tanish va tekshiruv',
      body: (
        <>
      <div className="section-label set-label">
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

      <div className="section-label set-label">
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
        <div className="tiny set-hint">
          Gapirib boʻlgach mikrofon tugmasini yana bosing.
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
        {micBusy ? 'Tekshirilmoqda…' : 'Mikrofonni tekshirish'}
      </button>

      {micChecks && (
        <div className="card" style={{ marginTop: 10 }}>
          {micChecks.map((c) => (
            <div key={c.step} className="between" style={{ marginBottom: 6, gap: 10 }}>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5 }}>
                  {c.step}
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
      icon: <Code size={18} />,
      title: 'GitHub',
      hint: 'Daho Code uchun token va nashr domeni',
      body: (
        <>
      <div className="section-label set-label">
        GitHub (Daho Code uchun)
      </div>

      <ConnectButton
        provider="github"
        what="Repo ochish, push, PR va Actions uchun. Token yasash shart emas."
      />

      <div className="field">
        <label>Shaxsiy token (agar ulanmasangiz)</label>
        <input
          type="password"
          value={settings.githubToken}
          onChange={(e) => updateSettings({ githubToken: e.target.value.trim() })}
          placeholder="ghp_… yoki github_pat_…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="tiny set-hint">
          GitHub → Developer settings → Tokens (classic). <b>repo</b> va{' '}
          <b>workflow</b> ruxsatlari kerak.
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
        <div className="tiny set-hint">
          Loyihani chiqarganda ishlatiladi.
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
      icon: <Database size={18} />,
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
      icon: <Sparkle size={18} />,
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
      icon: <User size={18} />,
      title: 'Shaxsiy',
      hint: 'Ismingiz, oʻqish joyingiz va koʻrsatmalar',
      body: (
        <>
      <div className="section-label set-label">
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
      icon: <Moon size={18} />,
      title: 'Koʻrinish',
      hint: 'Mavzu, rang va matn oʻlchami',
      body: (
        <>
      <div className="section-label set-label">
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
      icon: <Download size={18} />,
      title: 'Maʼlumotlar',
      hint: 'Zaxira nusxa, tiklash va tozalash',
      body: (
        <>
      <div className="section-label set-label">
        Qurilmadagi joy
      </div>
      <StoragePanel />

      <div className="section-label set-label">
        Zaxira nusxa
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


        </>
      ),
    },
  ];

  const current = groups.find((g) => g.id === openGroup);

  if (current) {
    return (
      <Sheet title={current.title} onClose={() => setOpenGroup(null)}>
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

      <div className="tiny set-foot">
        Daho 2.0
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
      <div className="section-label set-label">
        Ilova qiyofasi
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <button
          className="look-icon"
          onClick={() => pickRef.current?.click()}
          aria-label="Ikonka tanlash"
        >
          {icon ? <img src={icon} alt="" /> : <span className="muted">rasm</span>}
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

      <div className="tiny set-hint">
        Yangi ikonka bilan APK qaytadan yigʻiladi — 5-10 daqiqa. GitHub token kerak.
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
        say('Xato — Bu qurilmada mikrofon interfeysi yoʻq (getUserMedia).');
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
            ? 'Xato — Ruxsat berilmadi. Sozlamalar → Ilovalar → Daho → Ruxsatlar → Mikrofon.'
            : `Xato — Mikrofon ochilmadi: ${name || String(err)}`,
        );
        return;
      }
      say('OK — Ruxsat bor, mikrofon ochildi.');

      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach((t) => t.stop());
        say('Xato — MediaRecorder yoʻq — ovoz yozib boʻlmaydi.');
        return;
      }

      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      say('3 soniya gapiring…');
      await new Promise((r) => setTimeout(r, 3000));
      recorder.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      say(`OK — Yozildi: ${(blob.size / 1024).toFixed(1)} KB · ${blob.type || 'nomaʼlum'}`);
      if (blob.size < 1200) {
        say('Xato — Ovoz juda kichik — mikrofon boshqa ilovada band boʻlishi mumkin.');
        return;
      }

      let data: string;
      let mimeType = blob.type.split(';')[0] || 'audio/webm';
      try {
        data = bytesToB64(await blobToWavBytes(blob));
        mimeType = 'audio/wav';
        say('OK — WAV ga oʻgirildi.');
      } catch (err) {
        data = '';
        say(`Diqqat — WAV ga oʻgirilmadi: ${(err as Error).message}`);
      }
      if (!data) return;

      const { settings } = getState();
      if (!aiAvailable(settings.apiKey)) {
        say('Diqqat — Kalit ham, obuna ham yoʻq — matnga oʻgirib boʻlmaydi.');
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
        say(text.trim() ? `OK — Eshitildi: «${text.trim()}»` : 'Xato — Model matn qaytarmadi.');
      } catch (err) {
        say(`Xato — Gemini xatosi: ${(err as Error).message}`);
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
        {busy ? 'Tekshirilmoqda…' : 'Mikrofonni tekshirish'}
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
  const [projects, setProjects] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);

  const checkToken = async () => {
    setLoadingProjects(true);
    setProjects('');
    try {
      const list = await listProjects();
      setProjects(
        list.length
          ? `OK — ${list.length} ta loyiha koʻrindi:\n` +
              list
                .slice(0, 10)
                .map((p) => `· ${p.name} (${p.status})`)
                .join('\n')
          : 'OK — Token ishlayapti, lekin hali loyiha yoʻq.',
      );
    } catch (err) {
      setProjects(`Xato — ${String((err as Error)?.message ?? err)}`);
    }
    setLoadingProjects(false);
  };

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
      <div className="section-label set-label">
        Agent oʻzi loyiha ochishi uchun
      </div>
      <p className="tiny set-hint">
        Daho loyiha ochib, jadvallarni oʻzi yaratadi.
      </p>
      <ConnectButton
        provider="supabase"
        what="Loyiha ochish, jadval yaratish va SQL bajarish uchun."
      />

      <div className="field">
        <label>Management token (agar ulanmasangiz)</label>
        <input
          type="password"
          value={settings.supabaseToken}
          onChange={(e) => updateSettings({ supabaseToken: e.target.value.trim() })}
          placeholder="sbp_…"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="tiny set-hint">
          supabase.com/dashboard/account/tokens dan olinadi.
        </div>
      </div>
      <button
        className="btn ghost wide"
        disabled={loadingProjects || !settings.supabaseToken}
        onClick={() => void checkToken()}
        style={{ marginBottom: 4 }}
      >
        {loadingProjects ? 'Tekshirilmoqda…' : 'Tokenni tekshirish'}
      </button>
      {projects && (
        <pre className="conn-result" style={{ marginBottom: 14 }}>
          {projects}
        </pre>
      )}

      <div className="section-label set-label">
        Supabase (maʼlumot bazasi)
      </div>

      <div className="tiny set-hint">
        Yasagan ilovangizga haqiqiy baza kerak boʻlsa ulang. Bepul.
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
        <div className="tiny set-hint">
          Project Settings → API dan <b>anon public</b> kalitini oling.
          <b> service_role</b> kalitini kiritmang — u hamma himoyani chetlab oʻtadi.
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

/* ------------------------------------------------------------------ */
/*  Qurilmadagi joy                                                    */
/* ------------------------------------------------------------------ */

function StoragePanel() {
  const [info, setInfo] = useState<{ usedMb: number; quotaMb: number } | null>(null);
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const error = getStorageError();

  useEffect(() => {
    void storageEstimate().then(setInfo);
    void requestPersistentStorage().then(setPersistent);
  }, []);

  const pct = info && info.quotaMb ? Math.min(100, Math.round((info.usedMb / info.quotaMb) * 100)) : 0;

  return (
    <>
      {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}

      {info ? (
        <>
          <div className="progress">
            <i style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
          <div className="tiny" style={{ marginTop: 6 }}>
            {info.usedMb} MB band · {info.quotaMb} MB ruxsat berilgan ({pct}%)
          </div>
        </>
      ) : (
        <div className="tiny">Joy hajmi aniqlanmadi.</div>
      )}

      <div className="tiny" style={{ marginTop: 8, lineHeight: 1.55 }}>
        {persistent === true
          ? '✓ Maʼlumot doimiy saqlanadi — brauzer joy tugaganda ham oʻchirmaydi.'
          : 'Maʼlumot vaqtinchalik omborda. Qurilmada joy tugasa tizim uni tozalab '
            + 'yuborishi mumkin — muhim narsalarni zaxira nusxaga oling.'}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Daho serveri                                                       */
/* ------------------------------------------------------------------ */

function ServerPanel() {
  const settings = useStore((s) => s.settings);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<string>('');

  const check = async () => {
    setChecking(true);
    setHealth('');
    try {
      const info = await serverHealth();
      const worker = info.worker;
      setHealth(
        [
          info.ok ? 'OK — Server tayyor' : 'Diqqat — Server sozlanmagan',
          info.yetishmayapti?.length ? `Yetishmayapti: ${info.yetishmayapti.join(', ')}` : '',
          worker ? `Navbat: ${worker.polling ? 'kuzatilmoqda' : 'toʻxtagan'}` : '',
          worker ? `Bajarildi: ${worker.done} · xato: ${worker.failed}` : '',
          worker?.lastError ? `Oxirgi xato: ${worker.lastError}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (err) {
      setHealth(`Xato — Ulanib boʻlmadi: ${String((err as Error)?.message ?? err)}`);
    }
    setChecking(false);
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Server ulansa fon vazifalari <b>telefoningiz oʻchiq boʻlsa ham</b> bajariladi:
        kitob boblari yozilaveradi, jadval boʻyicha topshiriqlar ishlaydi. Daho Code
        esa haqiqiy terminalga ega boʻladi — <code>npm</code>, <code>node</code>,{' '}
        <code>python3</code>, <code>git</code>.
      </p>

      <div className="field">
        <label>Server manzili</label>
        <input
          value={settings.serverUrl}
          onChange={(e) => updateSettings({ serverUrl: e.target.value.trim() })}
          placeholder="https://daho-server.up.railway.app"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="tiny" style={{ marginTop: 6 }}>
          Railway’da qanday koʻtarish — <code>server/README.md</code> da yozilgan.
        </div>
      </div>

      <div className="field">
        <label>Maxfiy soʻz (WORKER_SECRET)</label>
        <input
          type="password"
          value={settings.serverSecret}
          onChange={(e) => updateSettings({ serverSecret: e.target.value.trim() })}
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="tiny" style={{ marginTop: 6 }}>
          Serverdagi qiymat bilan bir xil boʻlsin. Faqat shu qurilmada saqlanadi —
          bulutga yuborilmaydi.
        </div>
      </div>

      <button
        className="btn ghost wide"
        disabled={checking || !settings.serverUrl}
        onClick={() => void check()}
      >
        {checking ? 'Tekshirilmoqda…' : 'Ulanishni tekshirish'}
      </button>

      {health && (
        <pre className="conn-result" style={{ marginTop: 12 }}>
          {health}
        </pre>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Google hisobi                                                      */
/* ------------------------------------------------------------------ */

function GooglePanel() {
  const settings = useStore((s) => s.settings);
  const connected = Boolean(settings.googleAuth?.accessToken);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // Telefonda qaytish manzili server orqali oʻtadi — u boʻlmasa ulanib
  // boʻlmaydi, shuning uchun buni oldindan aytamiz.
  const needsServer =
    Capacitor.isNativePlatform()
    && !(settings.serverUrl ?? '').trim()
    && !(settings.googleRedirect ?? '').trim();

  const connect = async () => {
    setBusy(true);
    setNote('');
    try {
      await startGoogleAuth();
    } catch (err) {
      setNote(`Xato — ${String((err as Error)?.message ?? err)}`);
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Ulansa Daho pochtangizni oʻqiy va yubora oladi, Drive’dagi hujjatlarni
        ochadi, kalendaringizga voqea qoʻshadi. «Dekanatdan kelgan xatlarni
        koʻrsat», «bu hujjatni konspekt qil», «imtihonni kalendarga yoz» —
        shunday ishlaydi.
      </p>

      {connected ? (
        <>
          <div className="conn-row" style={{ marginBottom: 12 }}>
            <span className="conn-icon">✅</span>
            <span className="grow">
              <b>Ulangan</b>
              <div className="tiny" style={{ marginTop: 2 }}>
                Gmail · Drive · Kalendar
              </div>
            </span>
            <span className="conn-dot" data-on="true" />
          </div>
          <button
            className="btn ghost wide"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              disconnectGoogle();
              setNote('Ulanish uzildi.');
            }}
          >
            Hisobni uzish
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label>Google mijoz ID si</label>
            <input
              value={settings.googleClientId}
              onChange={(e) => updateSettings({ googleClientId: e.target.value.trim() })}
              placeholder="…apps.googleusercontent.com"
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="tiny" style={{ marginTop: 6, lineHeight: 1.55 }}>
              console.cloud.google.com → APIs &amp; Services → Credentials →
              <b> OAuth client ID</b> → <b>Web application</b>. Maxfiy soʻz
              kerak emas (PKCE).
            </div>
          </div>

          <div className="field">
            <label>Ruxsat etilgan qaytish manzili</label>
            <input
              value={settings.googleRedirect || redirectUri()}
              onChange={(e) => updateSettings({ googleRedirect: e.target.value.trim() })}
              onFocus={(e) => e.target.select()}
              placeholder={redirectUri()}
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn ghost"
                onClick={() => void copyText(settings.googleRedirect || redirectUri())}
              >
                Nusxa olish
              </button>
              {settings.googleRedirect && (
                <button
                  className="btn ghost"
                  onClick={() => updateSettings({ googleRedirect: '' })}
                >
                  Avtomatikka qaytarish
                </button>
              )}
            </div>
            <div className="tiny" style={{ marginTop: 8, lineHeight: 1.55 }}>
              Shu manzilni Google Console’da «Authorized redirect URIs» ga
              aynan koʻchiring — aks holda ulanish rad etiladi. Odatda oʻzi
              toʻgʻri toʻldiriladi; boshqa xostingdan foydalansangiz shu
              yerga qoʻlda yozing.
              {needsServer && (
                <>
                  {' '}
                  <b style={{ color: 'var(--danger)' }}>
                    Telefonda «localhost» ishlamaydi:
                  </b>{' '}
                  Google bunday manzilga qaytara olmaydi. «Daho serveri»
                  boʻlimiga Railway manzilini kiriting — shunda bu maydon
                  <code> …/oauth/callback</code> ga oʻzgaradi. Yoki oʻzingiz
                  boshqaradigan https sahifani shu yerga yozing.
                </>
              )}
            </div>
          </div>

          <button
            className="btn wide"
            disabled={busy || !settings.googleClientId || needsServer}
            onClick={() => void connect()}
          >
            {busy ? 'Google ochilmoqda…' : 'Google hisobini ulash'}
          </button>
        </>
      )}

      {note && (
        <pre className="conn-result" style={{ marginTop: 12 }}>
          {note}
        </pre>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Telegram                                                           */
/* ------------------------------------------------------------------ */

function TelegramPanel() {
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const check = async () => {
    setBusy(true);
    setResult('');
    try {
      const me = await tgMe();
      // Ulanish tasdiqlangach darhol xabarlarni ham olib qoʻyamiz —
      // aks holda roʻyxatlar boʻsh koʻrinib, ishlamayaptidek tuyuladi.
      const fresh = await tgSync();
      const people = await tgContacts();
      const groups = await tgChats();

      setResult(
        `OK — @${me.username} ulandi\n`
        + `· yangi xabar: ${fresh.length}\n`
        + `· yozganlar: ${people.length}\n`
        + `· guruh/kanal: ${groups.length}`
        + (me.can_read_all_group_messages === false
          ? '\n\nDiqqat — Bot guruhdagi hamma xabarni oʻqiy olmaydi. '
            + '@BotFather → /setprivacy → Disable qiling.'
          : ''),
      );
    } catch (err) {
      setResult(`Xato — ${String((err as Error)?.message ?? err)}`);
    }
    setBusy(false);
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Bot ulansa Daho sizga yozgan odamlarni biladi, har biriga alohida
        javob yozadi, guruh va kanalingizga eʼlon qoʻyadi, sutkalik
        mijozlarga birdan xabar tarqatadi.
      </p>

      <div className="field">
        <label>Bot tokeni</label>
        <input
          type="password"
          value={settings.tgToken}
          onChange={(e) => updateSettings({ tgToken: e.target.value.trim() })}
          placeholder="123456789:AA…"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      <button className="btn wide" disabled={busy || !tgReady()} onClick={() => void check()}>
        {busy ? 'Tekshirilmoqda…' : 'Ulanishni tekshirish'}
      </button>

      {result && (
        <pre className="conn-result" style={{ marginTop: 12 }}>
          {result}
        </pre>
      )}

      <div className="tiny" style={{ marginTop: 16, lineHeight: 1.7 }}>
        <b>Bot qanday ochiladi</b>
        <br />
        1. Telegramda <b>@BotFather</b> ga <code>/newbot</code> yozing
        <br />
        2. Nom va username bering → token beradi, shuni yuqoriga qoʻying
        <br />
        3. Guruh yoki kanalni boshqarishi uchun botni oʻsha yerga qoʻshib{' '}
        <b>admin</b> qiling
        <br />
        4. Guruhdagi hamma xabarni koʻrishi uchun: @BotFather →{' '}
        <code>/setprivacy</code> → <b>Disable</b>
      </div>

      <div className="tiny" style={{ marginTop: 16, lineHeight: 1.7 }}>
        <b>Oʻz nomingizdan ishlashi uchun</b> («secretary mode»)
        <br />
        Telegram → Sozlamalar → <b>Telegram Business</b> → <b>Chatbots</b> →
        botni tanlang va ruxsatlarni yoqing. Telegram Premium kerak.
        <br />
        <br />
        Shundan keyin Daho <b>sizning nomingizdan</b> yozadi, rasm va video
        yuboradi, story joylaydi — odam bot bilan emas, siz bilan
        gaplashayotgandek koʻradi.
        <br />
        Ruxsatlar alohida beriladi: yozish, oʻqilgan deb belgilash, story
        boshqarish. Qaysi biri yoqilganini Daho’dan «shaxsiy hisob holati»
        deb soʻrasangiz aytadi.
      </div>

      <div className="tiny" style={{ marginTop: 14, lineHeight: 1.7, opacity: 0.85 }}>
        Diqqat — Telegram shaxsiy hisobdan avtomatik yozishni taqiqlaydi va buning
        uchun hisobni bloklaydi. Shuning uchun bot ishlatiladi — u aynan shu
        ish uchun qilingan va cheklovi yoʻq darajada katta.
        <br />
        Odam botga birinchi boʻlib yozishi kerak; shundan keyin unga
        istagancha yozish mumkin.
        <br />
        <br />
        Xabarni keyinga qoʻymoqchi boʻlsangiz («ertaga soatt 9 da yubor»)
        hisobingizga kirgan boʻling — server oʻsha paytda yuboradi,
        telefon oʻchiq boʻlsa ham.
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Instagram                                                          */
/* ------------------------------------------------------------------ */

function InstagramPanel() {
  const settings = useStore((s) => s.settings);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState('');

  const check = async () => {
    setChecking(true);
    setResult('');
    try {
      const media = await igMedia(3);
      setResult(
        media.length
          ? `OK — Ulandi — oxirgi ${media.length} ta post koʻrindi:\n` +
              media
                .map((m) => `· ${(m.caption ?? '(matnsiz)').slice(0, 40)} — ${m.comments_count ?? 0} izoh`)
                .join('\n')
          : 'OK — Token ishlayapti, lekin post topilmadi.',
      );
    } catch (err) {
      setResult(`Xato — ${String((err as Error)?.message ?? err)}`);
    }
    setChecking(false);
  };

  return (
    <>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Ulansa Daho postlaringizdagi izohlarni oʻqiydi va har biriga alohida
        javob yozadi, Direct’dagi savollarga javob beradi. Kuniga minglab
        xabar boʻlsa ham uddalaydi — bu rasmiy API, brauzerni bosib turish
        emas.
      </p>

      <div className="field">
        <label>Graph API tokeni</label>
        <input
          type="password"
          value={settings.igToken}
          onChange={(e) => updateSettings({ igToken: e.target.value.trim() })}
          placeholder="EAAG…"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>Instagram Business hisob ID si</label>
        <input
          value={settings.igUserId}
          onChange={(e) => updateSettings({ igUserId: e.target.value.trim() })}
          placeholder="17841…"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      <button
        className="btn ghost wide"
        disabled={checking || !settings.igToken || !settings.igUserId}
        onClick={() => void check()}
      >
        {checking ? 'Tekshirilmoqda…' : 'Ulanishni tekshirish'}
      </button>

      {result && (
        <pre className="conn-result" style={{ marginTop: 12 }}>
          {result}
        </pre>
      )}

      <div className="section-label set-label">
        Qanday olinadi
      </div>
      <div className="tiny" style={{ lineHeight: 1.7 }}>
        1. Instagram hisobingiz <b>Business</b> yoki <b>Creator</b> boʻlsin
        (Sozlamalar → Hisob turi).
        <br />
        2. Uni Facebook sahifasiga ulang.
        <br />
        3. developers.facebook.com da ilova oching → <b>Instagram Graph API</b>{' '}
        va <b>Messenger API for Instagram</b> qoʻshing.
        <br />
        4. Graph API Explorer’dan token oling — ruxsatlar:{' '}
        <code>instagram_basic</code>, <code>instagram_manage_comments</code>,{' '}
        <code>instagram_manage_messages</code>,{' '}
        <code>pages_show_list</code>.
        <br />
        5. Hisob ID sini shu soʻrov bilan olasiz:{' '}
        <code>/me/accounts?fields=instagram_business_account</code>
      </div>

      <div className="tiny" style={{ marginTop: 12, color: 'var(--warn)', lineHeight: 1.6 }}>
        Diqqat — Instagram faqat odam sizga yozgan boʻlsa va oxirgi xabardan 24 soat
        oʻtmagan boʻlsa Direct’ga javob berishga ruxsat beradi. Bu Meta’ning
        qoidasi — chetlab oʻtib boʻlmaydi.
      </div>
    </>
  );
}
