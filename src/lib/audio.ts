/** Base64 → Uint8Array */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array → base64 (katta massivlar uchun bo'laklab) */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** "audio/L16;codec=pcm;rate=24000" dan namuna chastotasini ajratadi */
export function sampleRateOf(mimeType: string, fallback = 24000): number {
  const m = mimeType.match(/rate=(\d+)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * Xom PCM (16-bit, mono) ni WAV faylga oʻraydi — brauzer/WebView
 * L16 ni toʻgʻridan-toʻgʻri ijro eta olmaydi.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);

  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length, true);

  const out = new Uint8Array(buffer);
  out.set(pcm, 44);
  return out;
}

/** Gemini TTS javobini ijro etishga tayyor WAV base64 ga aylantiradi. */
export function ttsToWavBase64(data: string, mimeType: string): string {
  if (/wav/i.test(mimeType)) return data;
  const wav = pcmToWav(b64ToBytes(data), sampleRateOf(mimeType));
  return bytesToB64(wav);
}

/* ---------- Ijro ---------- */

let current: HTMLAudioElement | null = null;

export interface PlayHandle {
  stop: () => void;
  audio: HTMLAudioElement;
}

export function playWavBase64(b64: string, onEnd?: () => void): PlayHandle {
  stopPlayback();
  const audio = new Audio(`data:audio/wav;base64,${b64}`);
  audio.onended = () => {
    if (current === audio) current = null;
    onEnd?.();
  };
  audio.onerror = () => {
    if (current === audio) current = null;
    onEnd?.();
  };
  current = audio;
  void audio.play().catch(() => {
    current = null;
    onEnd?.();
  });
  return {
    audio,
    stop: () => {
      audio.pause();
      if (current === audio) current = null;
    },
  };
}

export function stopPlayback(): void {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

export function isPlaying(): boolean {
  return Boolean(current && !current.paused);
}

/** WAV base64 ning davomiyligi (soniyada) — sarlavhadan hisoblanadi. */
export function wavDuration(b64: string): number {
  try {
    const bytes = b64ToBytes(b64.slice(0, 120));
    const view = new DataView(bytes.buffer, bytes.byteOffset, Math.min(44, bytes.length));
    const byteRate = view.getUint32(28, true);
    const dataSize = view.getUint32(40, true);
    if (byteRate > 0 && dataSize > 0) return dataSize / byteRate;
  } catch {
    /* pastdagi taxminga tushamiz */
  }
  return 0;
}

/**
 * Yozib olingan ovozni (webm/ogg/mp4) Gemini tushunadigan WAV ga oʻgiradi.
 *
 * Gemini `audio/webm` ni qabul qilmaydi — shuning uchun brauzerning oʻz
 * dekoderi bilan ochib, 16 kHz mono WAV qilib qayta yigʻamiz. Bu ham hajmni
 * kichraytiradi (nutq uchun 16 kHz yetarli).
 */
export async function blobToWavBytes(blob: Blob, targetRate = 16000): Promise<Uint8Array> {
  const AudioCtor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) throw new Error('Brauzer ovozni oʻqiy olmadi');

  const ctx = new AudioCtor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());

    // Kanallarni bitta qilib qoʻshamiz.
    const length = decoded.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < length; i += 1) mono[i] += data[i];
    }
    if (decoded.numberOfChannels > 1) {
      for (let i = 0; i < length; i += 1) mono[i] /= decoded.numberOfChannels;
    }

    // Oddiy chiziqli qayta namunalash.
    const ratio = decoded.sampleRate / targetRate;
    const outLength = Math.max(1, Math.floor(length / ratio));
    const pcm = new Uint8Array(outLength * 2);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < outLength; i += 1) {
      const pos = i * ratio;
      const low = Math.floor(pos);
      const high = Math.min(low + 1, length - 1);
      const value = mono[low] + (mono[high] - mono[low]) * (pos - low);
      const clamped = Math.max(-1, Math.min(1, value));
      view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }

    return pcmToWav(pcm, targetRate, 1);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
