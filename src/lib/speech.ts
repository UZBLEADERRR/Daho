import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { blobToWavBytes, bytesToB64, playWavBase64, stopPlayback, ttsToWavBase64 } from './audio';
import { generateSpeech, transcribeAudio } from './gemini';
import { cachedModels, geminiModel } from './models';
import { getState } from './store';

const isNative = () => Capacitor.isNativePlatform();

/* ------------------------------------------------------------------ */
/*  Ovozlar                                                            */
/* ------------------------------------------------------------------ */

export interface VoicePersona {
  id: string;
  name: string;
  /** Gemini TTS dagi ichki ovoz nomi */
  gemini: string;
  gender: 'erkak' | 'ayol';
  note: string;
}

/**
 * Oʻzbekcha ismlar bilan nomlangan ovozlar. Ostida Gemini TTS ning
 * tabiiy ovozlari ishlaydi — qurilmaning robot ovozidan ancha yaxshi.
 */
export const VOICES: VoicePersona[] = [
  { id: 'sardor', name: 'Sardor', gemini: 'Charon', gender: 'erkak', note: 'bosiq, ustozona' },
  { id: 'bekzod', name: 'Bekzod', gemini: 'Puck', gender: 'erkak', note: 'tetik, quvnoq' },
  { id: 'jasur', name: 'Jasur', gemini: 'Orus', gender: 'erkak', note: 'qatʼiy, ishonchli' },
  { id: 'aziz', name: 'Aziz', gemini: 'Iapetus', gender: 'erkak', note: 'tiniq, xotirjam' },
  { id: 'madina', name: 'Madina', gemini: 'Kore', gender: 'ayol', note: 'aniq, diktorona' },
  { id: 'nilufar', name: 'Nilufar', gemini: 'Leda', gender: 'ayol', note: 'yosh, samimiy' },
  { id: 'zilola', name: 'Zilola', gemini: 'Aoede', gender: 'ayol', note: 'yengil, yumshoq' },
  { id: 'dilnoza', name: 'Dilnoza', gemini: 'Autonoe', gender: 'ayol', note: 'yorqin, jonli' },
];

export function voiceById(id: string): VoicePersona {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

const STYLE_HINT =
  'Quyidagi matnni oʻzbek tilida, tabiiy va ravon ohangda, oʻqituvchi talabaga ' +
  'tushuntirayotgandek sokin surʻatda oʻqib ber. Belgilar va qavslarni oʻqima. ' +
  'Faqat matnni ovozga aylantir:';

/** O'qishga tayyorlash: markdown belgilari va kod bloklarini olib tashlaydi. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`|~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Qurilma ovozlari (zaxira yoʻl)                                     */
/* ------------------------------------------------------------------ */

export interface DeviceVoice {
  name: string;
  lang: string;
  uri: string;
}

let cachedDeviceVoices: DeviceVoice[] | null = null;

export async function listDeviceVoices(): Promise<DeviceVoice[]> {
  if (cachedDeviceVoices) return cachedDeviceVoices;
  try {
    if (isNative()) {
      const res = await TextToSpeech.getSupportedVoices();
      cachedDeviceVoices = (res.voices ?? []).map((v: any) => ({
        name: v.name ?? v.voiceURI ?? 'Ovoz',
        lang: v.lang ?? '',
        uri: v.voiceURI ?? v.name ?? '',
      }));
    } else {
      cachedDeviceVoices = await new Promise<DeviceVoice[]>((resolve) => {
        const read = () => {
          const list = window.speechSynthesis?.getVoices() ?? [];
          if (list.length) {
            resolve(list.map((v) => ({ name: v.name, lang: v.lang, uri: v.voiceURI })));
            return true;
          }
          return false;
        };
        if (read()) return;
        window.speechSynthesis?.addEventListener('voiceschanged', () => read(), { once: true });
        setTimeout(() => resolve([]), 1500);
      });
    }
  } catch {
    cachedDeviceVoices = [];
  }
  return cachedDeviceVoices;
}

async function speakOnDevice(text: string): Promise<void> {
  const { settings } = getState();
  if (isNative()) {
    await TextToSpeech.speak({
      text,
      lang: settings.ttsLang || 'uz-UZ',
      rate: settings.ttsRate,
      pitch: 1,
      volume: 1,
      category: 'ambient',
    }).catch(() =>
      TextToSpeech.speak({
        text,
        lang: 'en-US',
        rate: settings.ttsRate,
        pitch: 1,
        volume: 1,
        category: 'ambient',
      }).catch(() => undefined),
    );
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = settings.ttsLang || 'uz-UZ';
  utter.rate = settings.ttsRate;
  if (settings.ttsVoiceUri) {
    const voice = synth.getVoices().find((v) => v.voiceURI === settings.ttsVoiceUri);
    if (voice) utter.voice = voice;
  }
  synth.speak(utter);
}

/* ------------------------------------------------------------------ */
/*  Asosiy: ovozga aylantirish                                         */
/* ------------------------------------------------------------------ */

/** Gemini TTS orqali WAV (base64) yasaydi — video va oldindan tayyorlash uchun. */
export async function synthesize(
  text: string,
  voiceId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const { settings } = getState();
  const clean = cleanForSpeech(text);
  if (!clean) throw new Error('Oʻqiladigan matn yoʻq');

  const voice = voiceById(voiceId ?? settings.ttsVoice);
  const res = await generateSpeech(
    settings.apiKey,
    settings.ttsModel,
    clean.slice(0, 4500),
    voice.gemini,
    STYLE_HINT,
    signal,
  );
  return ttsToWavBase64(res.data, res.mimeType);
}

/**
 * Matnni ovoz bilan oʻqiydi. Standart holatda Gemini ning tabiiy ovozi,
 * xato boʻlsa yoki sozlamada tanlangan boʻlsa qurilma ovozi ishlatiladi.
 */
export async function speak(text: string): Promise<void> {
  const { settings } = getState();
  const clean = cleanForSpeech(text);
  if (!clean) return;

  await stopSpeaking();

  if (settings.ttsEngine === 'qurilma' || !settings.apiKey) {
    await speakOnDevice(clean);
    return;
  }

  try {
    const wav = await synthesize(clean);
    playWavBase64(wav);
  } catch (err) {
    console.warn('Gemini TTS ishlamadi, qurilma ovoziga oʻtildi:', err);
    await speakOnDevice(clean);
  }
}

export async function stopSpeaking(): Promise<void> {
  stopPlayback();
  try {
    if (isNative()) await TextToSpeech.stop();
    else window.speechSynthesis?.cancel();
  } catch {
    /* eʼtiborsiz */
  }
}

/* ------------------------------------------------------------------ */
/*  Mikrofon                                                           */
/* ------------------------------------------------------------------ */

export interface ListenHandle {
  /** Yozishni toʻxtatadi va matnni qaytaradi (boʻsh boʻlishi mumkin) */
  stop: () => Promise<void>;
  cancel: () => void;
}

export interface ListenCallbacks {
  onState?: (state: 'yozilmoqda' | 'tahlil') => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** Mikrofon darajasi 0..1 — jonli rejimda toʻlqin chizish uchun */
  onLevel?: (level: number) => void;
  /**
   * Jim qolinganda oʻzi toʻxtasin (jonli suhbat uchun). Necha millisekund
   * sukunatdan keyin toʻxtash kerakligi. 0 — oʻchiq.
   */
  autoStopAfterSilence?: number;
}

/**
 * Ovozni matnga oʻgirish uchun Gemini modeli.
 *
 * Asosiy model tashqi provayderniki (OpenRouter, Kimi…) boʻlishi mumkin —
 * ular audio qabul qilmaydi. Shuning uchun bu yerda har doim Gemini
 * modelini tanlaymiz.
 */
function sttModel(): string {
  return geminiModel(getState().settings.model);
}

/** Mikrofon ruxsatini so'raydi. */
async function ensureMicPermission(): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const perm = await SpeechRecognition.requestPermissions();
    return perm.speechRecognition === 'granted';
  } catch {
    // Plagin ruxsat so'ray olmasa, getUserMedia o'zi so'raydi.
    return true;
  }
}

function pickRecorderMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/**
 * Ovozni yozib olib, Gemini orqali matnga oʻgiradi.
 * Bu yoʻl oʻzbek tili uchun qurilmaning oʻz STT sidan ancha aniqroq.
 */
async function listenViaGemini(cb: ListenCallbacks): Promise<ListenHandle | null> {
  const { settings } = getState();
  if (!settings.apiKey) {
    cb.onError('Avval Sozlamalarda API kalitni kiriting.');
    return null;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return null;
  }

  await ensureMicPermission();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    cb.onError(
      String((err as Error)?.name) === 'NotAllowedError'
        ? 'Mikrofon uchun ruxsat berilmadi.'
        : 'Mikrofonni ochib boʻlmadi.',
    );
    return null;
  }

  const mimeType = pickRecorderMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  let cancelled = false;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  /* ---- Daraja oʻlchagich: koʻrsatkich va sukunatni aniqlash ---- */
  let meter: (() => void) | null = null;
  /** Umuman ovoz eshitildimi — «ovoz aniqlanmadi» xabarini aniq qilish uchun */
  let heardVoice = false;

  try {
    const AudioCtor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.frequencyBinCount);

    let lastLoudAt = Date.now();
    let raf = 0;
    const silenceMs = cb.autoStopAfterSilence ?? 0;
    /** Ovoz boshlanmasdan turib toʻxtatmaslik uchun */
    const startedAt = Date.now();

    const step = () => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        peak = Math.max(peak, Math.abs(buffer[i] - 128) / 128);
      }
      cb.onLevel?.(peak);
      if (peak > 0.06) {
        lastLoudAt = Date.now();
        heardVoice = true;
      }
      // Jonli rejim: gap tugagach oʻzi toʻxtaydi.
      if (
        silenceMs > 0 &&
        heardVoice &&
        Date.now() - lastLoudAt > silenceMs &&
        Date.now() - startedAt > 1200 &&
        recorder.state === 'recording'
      ) {
        recorder.stop();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    meter = () => {
      cancelAnimationFrame(raf);
      void ctx.close().catch(() => undefined);
    };
  } catch {
    /* daraja oʻlchagichsiz ham yozib olamiz */
  }

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = async () => {
      meter?.();
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) {
        resolve();
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1200 || !heardVoice) {
        cb.onError('Ovoz eshitilmadi — mikrofonga yaqinroq va balandroq gapiring.');
        resolve();
        return;
      }
      cb.onState?.('tahlil');
      try {
        // Gemini webm ni qabul qilmaydi — WAV ga oʻgiramiz.
        let sendMime = blob.type.split(';')[0] || 'audio/webm';
        let base64: string;
        try {
          base64 = bytesToB64(await blobToWavBytes(blob));
          sendMime = 'audio/wav';
        } catch {
          base64 = await blobToBase64(blob);
        }

        const audio = { mimeType: sendMime, data: base64 };
        let text = '';
        try {
          text = await transcribeAudio(
            settings.apiKey,
            sttModel(),
            audio,
            undefined,
            settings.sttLang,
          );
        } catch (first) {
          // Bitta model band yoki audioni qabul qilmadi — ikkinchisini sinaymiz.
          const spare = cachedModels().find(
            (m) => m.role === 'chat' && !m.provider && m.id !== sttModel(),
          );
          if (!spare) throw first;
          text = await transcribeAudio(
            settings.apiKey,
            spare.id,
            audio,
            undefined,
            settings.sttLang,
          );
        }

        if (text.trim()) cb.onFinal(text.trim());
        else cb.onError('Nutq tanilmadi — sekinroq va tiniqroq gapirib koʻring.');
      } catch (err) {
        // Model audioni qabul qilmadi — keyingi safar qurilma xizmatiga oʻtamiz.
        geminiSttBroken = true;
        cb.onError(
          `Ovozni matnga oʻgirib boʻlmadi: ${String((err as Error)?.message ?? err)} ` +
            '— keyingi safar telefonning oʻz xizmati ishlatiladi.',
        );
      }
      resolve();
    };
  });

  recorder.start();
  cb.onState?.('yozilmoqda');

  return {
    stop: async () => {
      if (recorder.state !== 'inactive') recorder.stop();
      await finished;
    },
    cancel: () => {
      cancelled = true;
      meter?.();
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/** Qurilmaning o'z nutq tanish xizmati — zaxira yo'l. */
async function listenOnDevice(cb: ListenCallbacks): Promise<ListenHandle | null> {
  const lang = getState().settings.sttLang || 'uz-UZ';

  if (isNative()) {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        cb.onError('Qurilmada nutqni tanish xizmati yoʻq.');
        return null;
      }
      if (!(await ensureMicPermission())) {
        cb.onError('Mikrofon uchun ruxsat berilmadi.');
        return null;
      }

      let last = '';
      const listener = await SpeechRecognition.addListener('partialResults', (data: any) => {
        const value = data?.matches?.[0];
        if (typeof value === 'string' && value) last = value;
      });

      cb.onState?.('yozilmoqda');
      const done = SpeechRecognition.start({
        language: lang,
        maxResults: 1,
        partialResults: true,
        popup: false,
      })
        .then((res: any) => {
          const value = res?.matches?.[0] ?? last;
          if (value) cb.onFinal(value);
          else cb.onError('Ovoz aniqlanmadi.');
        })
        .catch((err: any) => {
          if (last) cb.onFinal(last);
          else cb.onError(String(err?.message ?? err));
        })
        .finally(() => void listener.remove().catch(() => undefined));

      return {
        stop: async () => {
          await SpeechRecognition.stop().catch(() => undefined);
          await done;
        },
        cancel: () => {
          void SpeechRecognition.stop().catch(() => undefined);
          void listener.remove().catch(() => undefined);
        },
      };
    } catch (err) {
      cb.onError(String((err as Error)?.message ?? err));
      return null;
    }
  }

  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    cb.onError('Bu qurilmada ovozli kiritish qoʻllab-quvvatlanmaydi.');
    return null;
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  let last = '';
  rec.onresult = (e: any) => {
    let text = '';
    for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
    last = text;
  };
  rec.onerror = (e: any) => cb.onError(String(e?.error ?? 'xato'));
  rec.onend = () => {
    if (last) cb.onFinal(last);
    else cb.onError('Ovoz aniqlanmadi.');
  };
  rec.start();
  cb.onState?.('yozilmoqda');
  return {
    stop: async () => rec.stop(),
    cancel: () => rec.abort?.(),
  };
}

/**
 * Gemini orqali matnga oʻgirish ishlamay qolgan boʻlsa — shu suhbatda
 * boshqa urinmaymiz, qurilmaning oʻz xizmatiga oʻtamiz.
 */
let geminiSttBroken = false;

/** Mikrofonni yoqadi. Sozlamaga qarab Gemini yoki qurilma STT ishlatiladi. */
export async function startListening(cb: ListenCallbacks): Promise<ListenHandle | null> {
  const { settings } = getState();
  if (settings.sttEngine === 'qurilma' || geminiSttBroken) return listenOnDevice(cb);
  const viaGemini = await listenViaGemini(cb);
  return viaGemini ?? listenOnDevice(cb);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
