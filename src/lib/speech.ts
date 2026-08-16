import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const isNative = () => Capacitor.isNativePlatform();

export interface VoiceOption {
  name: string;
  lang: string;
  uri: string;
}

let cachedVoices: VoiceOption[] | null = null;

/**
 * Qurilmadagi mavjud ovozlar ro'yxati.
 * Androidda tizim TTS (Google/Samsung), Windows brauzerda Microsoft ovozlari.
 */
export async function listVoices(): Promise<VoiceOption[]> {
  if (cachedVoices) return cachedVoices;
  try {
    if (isNative()) {
      const res = await TextToSpeech.getSupportedVoices();
      cachedVoices = (res.voices ?? []).map((v: any) => ({
        name: v.name ?? v.voiceURI ?? 'Ovoz',
        lang: v.lang ?? '',
        uri: v.voiceURI ?? v.name ?? '',
      }));
    } else {
      cachedVoices = await new Promise<VoiceOption[]>((resolve) => {
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
    cachedVoices = [];
  }
  return cachedVoices;
}

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  voiceUri?: string;
}

/** Matnni ovoz bilan o'qiydi. Bepul — qurilmaning o'z sintezatori ishlatiladi. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' kod bloki. ')
    .replace(/[*_#>`|]/g, '')
    .trim();
  if (!clean) return;

  await stopSpeaking();

  if (isNative()) {
    await TextToSpeech.speak({
      text: clean,
      lang: opts.lang || 'uz-UZ',
      rate: opts.rate ?? 1,
      pitch: 1,
      volume: 1,
      category: 'ambient',
    }).catch(async (err) => {
      // Til qurilmada bo'lmasa — inglizchaga tushamiz.
      console.warn('TTS xatosi, zaxira tilga oʻtildi:', err);
      await TextToSpeech.speak({
        text: clean,
        lang: 'en-US',
        rate: opts.rate ?? 1,
        pitch: 1,
        volume: 1,
        category: 'ambient',
      }).catch(() => undefined);
    });
    return;
  }

  const synth = window.speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = opts.lang || 'uz-UZ';
  utter.rate = opts.rate ?? 1;
  if (opts.voiceUri) {
    const voice = synth.getVoices().find((v) => v.voiceURI === opts.voiceUri);
    if (voice) utter.voice = voice;
  }
  synth.speak(utter);
}

export async function stopSpeaking(): Promise<void> {
  try {
    if (isNative()) await TextToSpeech.stop();
    else window.speechSynthesis?.cancel();
  } catch {
    /* e'tiborsiz */
  }
}

export interface ListenHandle {
  stop: () => Promise<void>;
}

export interface ListenCallbacks {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

/** Mikrofon ruxsatini so'raydi va nutqni matnga o'giradi. */
export async function startListening(
  lang: string,
  cb: ListenCallbacks,
): Promise<ListenHandle | null> {
  if (isNative()) {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        cb.onError('Qurilmada nutqni tanish xizmati topilmadi.');
        return null;
      }
      const perm = await SpeechRecognition.requestPermissions();
      if (perm.speechRecognition !== 'granted') {
        cb.onError('Mikrofon uchun ruxsat berilmadi.');
        return null;
      }

      let last = '';
      const listener = await SpeechRecognition.addListener('partialResults', (data: any) => {
        const value = data?.matches?.[0];
        if (typeof value === 'string' && value) {
          last = value;
          cb.onPartial?.(value);
        }
      });

      SpeechRecognition.start({
        language: lang || 'uz-UZ',
        maxResults: 1,
        partialResults: true,
        popup: false,
      })
        .then((res: any) => {
          const value = res?.matches?.[0] ?? last;
          if (value) cb.onFinal(value);
          else if (!last) cb.onError('Ovoz aniqlanmadi.');
        })
        .catch((err: any) => {
          if (last) cb.onFinal(last);
          else cb.onError(String(err?.message ?? err));
        })
        .finally(() => {
          listener.remove().catch(() => undefined);
        });

      return {
        stop: async () => {
          await SpeechRecognition.stop().catch(() => undefined);
          await listener.remove().catch(() => undefined);
          if (last) cb.onFinal(last);
        },
      };
    } catch (err) {
      cb.onError(String((err as Error)?.message ?? err));
      return null;
    }
  }

  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    cb.onError('Bu qurilmada ovozli kiritish qoʻllab-quvvatlanmaydi.');
    return null;
  }
  const rec = new Ctor();
  rec.lang = lang || 'uz-UZ';
  rec.interimResults = true;
  rec.continuous = false;
  let last = '';
  rec.onresult = (e: any) => {
    let text = '';
    for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
    last = text;
    if (e.results[e.results.length - 1].isFinal) cb.onFinal(text);
    else cb.onPartial?.(text);
  };
  rec.onerror = (e: any) => cb.onError(String(e?.error ?? 'xato'));
  rec.onend = () => {
    if (last) cb.onFinal(last);
  };
  rec.start();
  return {
    stop: async () => {
      rec.stop();
    },
  };
}
