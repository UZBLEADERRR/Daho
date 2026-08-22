import { useEffect, useRef, useState } from 'react';
import { blobToWavBytes, bytesToB64, playWavBase64 } from '../lib/audio';
import { applyAppLook } from '../lib/applook';
import { copyText, saveBackup } from '../lib/exporter';
import { getRepo, whoAmI } from '../lib/github';
import { sbPing } from '../lib/supabase';
import { transcribeAudio } from '../lib/gemini';
import { geminiModel } from '../lib/models';
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
import { Chevron, Copy } from './Icons';
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

type Group =
  | 'korinish'
  | 'suhbat'
  | 'ovoz'
  | 'shaxsiy'
  | 'qiyofa'
  | 'code'
  | 'malumot'
  | 'ilgor';

const GROUPS: Array<{ id: Group; title: string; hint: string }> = [
  { id: 'korinish', title: 'Koʻrinish', hint: 'Mavzu, rang, shrift' },
  { id: 'suhbat', title: 'Suhbat', hint: 'Model va javob uslubi' },
  { id: 'ovoz', title: 'Ovoz va mikrofon', hint: 'Diktor, til, nutqni tanish' },
  { id: 'shaxsiy', title: 'Shaxsiy', hint: 'Ism va agent koʻrsatmasi' },
  { id: 'qiyofa', title: 'Ilova qiyofasi', hint: 'Nom va ikonka' },
  { id: 'code', title: 'Daho Code', hint: 'GitHub va nashr' },
  { id: 'malumot', title: 'Maʼlumotlar', hint: 'Zaxira va tozalash' },
  { id: 'ilgor', title: 'Ilgʻor', hint: 'Oʻz API kalitingiz bilan ishlash' },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);

  if (group) {
    const meta = GROUPS.find((g) => g.id === group)!;
    return (
      <Sheet title={meta.title} onClose={() => setGroup(null)}>
        {group === 'korinish' && <LookGroup />}
        {group === 'suhbat' && <ChatGroup />}
        {group === 'ovoz' && <VoiceGroup />}
        {group === 'shaxsiy' && <PersonalGroup />}
        {group === 'qiyofa' && <AppLook />}
        {group === 'code' && <CodeGroup />}
        {group === 'malumot' && <DataGroup onDone={onClose} />}
        {group === 'ilgor' && <AdvancedGroup />}
      </Sheet>
    );
  }

  return (
    <Sheet title="Sozlamalar" onClose={onClose}>
      {GROUPS.map((g) => (
        <button className="set-row" key={g.id} onClick={() => setGroup(g.id)}>
          <span className="grow">
            <b className="b">{g.title}</b>
            <span className="tiny">{g.hint}</span>
          </span>
          <Chevron size={16} />
        </button>
      ))}

      <div className="tiny set-foot">Daho 2.0</div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Koʻrinish                                                          */
/* ------------------------------------------------------------------ */

function LookGroup() {
  const settings = useStore((s) => s.settings);

  return (
    <>
      <Switch
        on={settings.theme === 'tun'}
        onChange={(v) => updateSettings({ theme: v ? 'tun' : 'kun' })}
        label="Tungi rejim"
      />

      <div className="field set-gap">
        <span>Urgʻu rangi</span>
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
      </div>

      <div className="field">
        <span>Shrift oʻlchami — {Math.round(settings.fontScale * 100)}%</span>
        <input
          className="slider"
          type="range"
          min={0.85}
          max={1.3}
          step={0.05}
          value={settings.fontScale}
          onChange={(e) => updateSettings({ fontScale: Number(e.target.value) })}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Suhbat                                                             */
/* ------------------------------------------------------------------ */

function ChatGroup() {
  const settings = useStore((s) => s.settings);

  return (
    <>
      <div className="field">
        <span>Model</span>
        <ChatModelSelect value={settings.model} onChange={(id) => updateSettings({ model: id })} />
      </div>

      <div className="field">
        <span>Ijodkorlik — {settings.temperature.toFixed(1)}</span>
        <input
          className="slider"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={settings.temperature}
          onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
        />
      </div>

      <Switch
        on={settings.autoPickModel !== false}
        onChange={(v) => updateSettings({ autoPickModel: v })}
        label="Modelni vazifaga qarab tanlash"
      />

      <Switch
        on={settings.memoryEnabled !== false}
        onChange={(v) => updateSettings({ memoryEnabled: v })}
        label="Meni eslab qolsin"
      />

      <Switch
        on={settings.autoContinue}
        onChange={(v) => updateSettings({ autoContinue: v })}
        label="Uzilgan javobni davom ettirish"
      />

      <Switch
        on={Boolean(settings.freeOnly)}
        onChange={(v) => updateSettings({ freeOnly: v })}
        label="Faqat bepul modellar"
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Ovoz va mikrofon                                                   */
/* ------------------------------------------------------------------ */

function VoiceGroup() {
  const settings = useStore((s) => s.settings);
  const [deviceVoices, setDeviceVoices] = useState<DeviceVoice[]>([]);
  const [testing, setTesting] = useState(false);
  const [micChecks, setMicChecks] = useState<MicCheck[] | null>(null);
  const [micBusy, setMicBusy] = useState(false);

  useEffect(() => {
    void listDeviceVoices().then(setDeviceVoices);
  }, []);

  const deviceMatching = deviceVoices.filter((v) =>
    v.lang?.toLowerCase().startsWith(settings.ttsLang.slice(0, 2).toLowerCase()),
  );

  const tryVoice = async () => {
    if (testing) return;
    setTesting(true);
    const sample = 'Salom! Men Daho — sizning oʻquv yordamchingizman.';
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

  return (
    <>
      <div className="field">
        <span>Ovoz manbai</span>
        <select
          value={settings.ttsEngine}
          onChange={(e) => updateSettings({ ttsEngine: e.target.value as 'gemini' | 'qurilma' })}
        >
          <option value="gemini">Tabiiy ovoz</option>
          <option value="qurilma">Telefon ovozi — internetsiz</option>
        </select>
      </div>

      {settings.ttsEngine === 'gemini' ? (
        <div className="field">
          <span>Diktor</span>
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
      ) : (
        <>
          <div className="field">
            <span>Ovoz tili</span>
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
              <span>Ovoz</span>
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
            <span>Oʻqish tezligi — {settings.ttsRate.toFixed(1)}×</span>
            <input
              className="slider"
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.ttsRate}
              onChange={(e) => updateSettings({ ttsRate: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      <Switch
        on={settings.autoSpeak}
        onChange={(v) => updateSettings({ autoSpeak: v })}
        label="Javoblarni oʻqib berish"
      />

      <button className="btn ghost wide set-gap" onClick={() => void tryVoice()} disabled={testing}>
        {testing ? 'Tayyorlanmoqda…' : 'Ovozni sinash'}
      </button>

      <div className="section-label set-label">Mikrofon</div>

      <div className="field">
        <span>Nutqni tanish</span>
        <select
          value={settings.sttEngine}
          onChange={(e) => updateSettings({ sttEngine: e.target.value as 'gemini' | 'qurilma' })}
        >
          <option value="gemini">Aniq — oʻzbekchani yaxshi tushunadi</option>
          <option value="qurilma">Tez — telefon xizmati</option>
        </select>
      </div>

      <div className="field">
        <span>Gapirish tili</span>
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
        <div className="card set-gap">
          {micChecks.map((c) => (
            <div key={c.step} className="mic-line">
              <span className={c.ok ? 'mic-dot ok' : 'mic-dot'} />
              <span className="grow">
                <div className="mic-step">{c.step}</div>
                <div className="tiny mic-detail">{c.detail}</div>
              </span>
            </div>
          ))}
          <button
            className="btn mini ghost set-gap"
            onClick={async () => {
              const text = micChecks
                .map((c) => `${c.ok ? 'OK' : 'XATO'} — ${c.step}: ${c.detail}`)
                .join('\n');
              toast((await copyText(text)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi');
            }}
          >
            <Copy size={12} /> Natijani nusxalash
          </button>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Shaxsiy                                                            */
/* ------------------------------------------------------------------ */

function PersonalGroup() {
  const settings = useStore((s) => s.settings);

  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Ismingiz</span>
          <input
            value={settings.userName}
            onChange={(e) => updateSettings({ userName: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Universitet</span>
          <input
            value={settings.university}
            onChange={(e) => updateSettings({ university: e.target.value })}
          />
        </label>
      </div>

      <label className="field">
        <span>Agent uchun koʻrsatma</span>
        <textarea
          value={settings.customInstructions}
          rows={4}
          onChange={(e) => updateSettings({ customInstructions: e.target.value })}
          placeholder="Masalan: men 2-kurs dasturchiman, javoblarda kod misollari koʻp boʻlsin."
        />
      </label>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Daho Code                                                          */
/* ------------------------------------------------------------------ */

function CodeGroup() {
  const settings = useStore((s) => s.settings);
  const [checking, setChecking] = useState(false);

  return (
    <>
      <label className="field">
        <span>GitHub tokeni</span>
        <input
          type="password"
          value={settings.githubToken}
          onChange={(e) => updateSettings({ githubToken: e.target.value.trim() })}
          placeholder="ghp_… yoki github_pat_…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>Domeningiz</span>
        <input
          value={settings.publishDomain}
          onChange={(e) => updateSettings({ publishDomain: e.target.value.trim() })}
          placeholder="daho.uz"
          autoCapitalize="off"
          spellCheck={false}
        />
      </label>

      <button
        className="btn ghost wide"
        disabled={checking}
        onClick={async () => {
          if (!settings.githubToken) {
            toast('Avval tokenni kiriting');
            return;
          }
          setChecking(true);
          try {
            const user = await whoAmI(settings.githubToken);
            toast(`Ulandi: ${user.login}`);
          } catch (err) {
            toast(String((err as Error)?.message ?? err));
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking ? 'Tekshirilmoqda…' : 'Ulanishni tekshirish'}
      </button>

      <p className="tiny set-note">
        Token github.com → Settings → Developer settings → Personal access tokens
        boʻlimidan olinadi. <b>repo</b> va <b>workflow</b> ruxsatlari kerak.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Maʼlumotlar                                                        */
/* ------------------------------------------------------------------ */

function DataGroup({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          void (async () => {
            const file = e.target.files?.[0];
            if (!file) return;
            toast(importState(await file.text()) ? 'Maʼlumotlar tiklandi' : 'Fayl notoʻgʻri');
          })();
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
        className="btn ghost wide danger-text set-gap"
        onClick={() => {
          if (window.confirm('Barcha suhbat, kurs, ilova va jadval oʻchiriladi. Davom etamizmi?')) {
            resetState();
            toast('Hammasi tozalandi');
            onDone();
          }
        }}
      >
        Hamma maʼlumotni oʻchirish
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Ilgʻor — oʻz kaliti bilan ishlash                                  */
/* ------------------------------------------------------------------ */

function AdvancedGroup() {
  const settings = useStore((s) => s.settings);
  const [open, setOpen] = useState(Boolean(settings.apiKey || settings.providers?.length));
  const [showKey, setShowKey] = useState(false);

  if (!open) {
    return (
      <>
        <p className="tiny set-note set-note-first">
          Odatda bu boʻlim kerak emas: Daho hisobingizdagi modellar tayyor holda
          ishlaydi. Oʻz API kalitingiz bilan ishlamoqchi boʻlsangiz shu yerdan yoqing.
        </p>
        <button className="btn ghost wide" onClick={() => setOpen(true)}>
          Oʻz kalitim bilan ishlash
        </button>
      </>
    );
  }

  return (
    <>
      <label className="field">
        <span>
          Google kaliti <i>— qidiruv va tabiiy ovoz uchun</i>
        </span>
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
      </label>

      <ModelsPanel />

      <UsagePanel />

      <SupabasePanel />

      <p className="tiny set-note">Kalitlar faqat shu qurilmada saqlanadi.</p>
    </>
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
      if (!settings.apiKey) {
        say('⚠️ API kalit yoʻq — matnga oʻgirib boʻlmaydi.');
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
