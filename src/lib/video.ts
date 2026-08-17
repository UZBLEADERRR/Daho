import { b64ToBytes } from './audio';
import { generateImage, generateJson } from './gemini';
import { synthesize } from './speech';
import { geminiModel } from './models';
import { getState, setState } from './store';
import type {
  SubtitleStyle,
  VideoCharacter,
  VideoProject,
  VideoScene,
  VideoStage,
} from './types';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Standart qiymatlar                                                 */
/* ------------------------------------------------------------------ */

export const DEFAULT_SUBTITLE: SubtitleStyle = {
  font: 'Inter',
  size: 46,
  color: '#ffffff',
  stroke: '#000000',
  strokeWidth: 7,
  background: 'rgba(0,0,0,0.35)',
  position: 'past',
  uppercase: false,
};

export const SUBTITLE_PRESETS: Array<{ id: string; name: string; style: SubtitleStyle }> = [
  { id: 'oddiy', name: 'Oddiy', style: DEFAULT_SUBTITLE },
  {
    id: 'sariq',
    name: 'Sariq urgʻu',
    style: { ...DEFAULT_SUBTITLE, color: '#FFD84D', strokeWidth: 8, background: 'transparent' },
  },
  {
    id: 'quti',
    name: 'Quti',
    style: {
      ...DEFAULT_SUBTITLE,
      color: '#ffffff',
      strokeWidth: 0,
      background: 'rgba(107,86,232,0.9)',
      size: 42,
    },
  },
  {
    id: 'baland',
    name: 'Baland, yirik',
    style: {
      ...DEFAULT_SUBTITLE,
      size: 58,
      position: 'orta',
      uppercase: true,
      background: 'transparent',
      strokeWidth: 9,
    },
  },
];

export const VIDEO_STYLES = [
  'realistik fotosurat',
  '3D animatsiya',
  'tekis illustratsiya',
  'anime',
  'aqlli doska chizmasi',
  'kinematografik',
];

export function dimensionsFor(aspect: VideoProject['aspect']): { w: number; h: number } {
  if (aspect === '16:9') return { w: 1280, h: 720 };
  if (aspect === '1:1') return { w: 900, h: 900 };
  return { w: 720, h: 1280 };
}

/* ------------------------------------------------------------------ */
/*  1-bosqich: ssenariy                                                */
/* ------------------------------------------------------------------ */

interface PlanResponse {
  title: string;
  style: string;
  characters: Array<{ name: string; look: string }>;
  scenes: Array<{ narration: string; imagePrompt: string; character?: string }>;
}

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    style: { type: 'STRING' },
    characters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, look: { type: 'STRING' } },
        required: ['name', 'look'],
      },
    },
    scenes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          narration: { type: 'STRING' },
          imagePrompt: { type: 'STRING' },
          character: { type: 'STRING' },
        },
        required: ['narration', 'imagePrompt'],
      },
    },
  },
  required: ['title', 'style', 'scenes'],
};

function planPrompt(topic: string, sceneCount: number, style: string): string {
  return `Sen professional video ssenariy muallifisan. Mavzu: «${topic}».

Qisqa, jozibali video uchun ${sceneCount} ta sahna tayyorla.

Har bir sahna uchun:
- "narration": diktor oʻqiydigan matn — OʻZBEK TILIDA, 12-25 soʻz, ravon va tushunarli.
  Bu matn ovozga aylantiriladi va ekranda subtitr boʻlib chiqadi, shuning uchun
  gapirish uchun qulay boʻlsin. Hech qanday belgi, qavs yoki ismlar yozma.
- "imagePrompt": shu sahna uchun rasm soʻrovi — INGLIZ TILIDA, batafsil, kadr tarkibini,
  yorugʻlikni va kayfiyatni tasvirla. Uslub: ${style}. Matn yoki yozuv soʻrama.
- "character": agar sahnada qahramon boʻlsa, uning ismi.

Agar mavzuga qahramon mos kelsa, 1-2 ta qahramon oʻylab top va "characters" ga
ularning tashqi koʻrinishini INGLIZ TILIDA batafsil yoz (yosh, kiyim, soch, yuz) —
bu tavsif har bir sahnada takrorlanadi, shunda qahramon bir xil chiqadi.

Ssenariy mantiqiy ketma-ketlikda boʻlsin: qiziqtiruvchi boshlanish, mazmun, xulosa.`;
}

export async function planVideo(
  topic: string,
  opts: { sceneCount?: number; style?: string; aspect?: VideoProject['aspect']; chatId?: string } = {},
  signal?: AbortSignal,
): Promise<VideoProject> {
  const { settings } = getState();
  const style = opts.style ?? VIDEO_STYLES[0];
  const sceneCount = Math.min(12, Math.max(3, opts.sceneCount ?? 6));

  const plan = await generateJson<PlanResponse>(
    settings.apiKey,
    geminiModel(settings.model),
    planPrompt(topic, sceneCount, style),
    PLAN_SCHEMA,
    signal,
  );

  const characters: VideoCharacter[] = (plan.characters ?? []).slice(0, 3).map((c) => ({
    id: uid('vc_'),
    name: c.name,
    look: c.look,
    voiceId: settings.ttsVoice,
  }));

  const scenes: VideoScene[] = (plan.scenes ?? []).slice(0, 12).map((s) => ({
    id: uid('vs_'),
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    durationSec: Math.max(2.5, Math.min(10, s.narration.split(/\s+/).length / 2.4)),
    characterId: characters.find((c) => c.name === s.character)?.id,
  }));

  if (!scenes.length) throw new Error('Ssenariy yaratilmadi — mavzuni aniqroq yozing.');

  const project: VideoProject = {
    id: uid('v_'),
    chatId: opts.chatId,
    topic,
    title: plan.title || topic,
    stage: 'sahnalar',
    aspect: opts.aspect ?? '9:16',
    style: plan.style || style,
    voiceId: settings.ttsVoice,
    scenes,
    characters,
    subtitle: { ...DEFAULT_SUBTITLE },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  setState((s) => ({ videos: [project, ...s.videos] }));
  return project;
}

/* ------------------------------------------------------------------ */
/*  Loyihani yangilash                                                 */
/* ------------------------------------------------------------------ */

export function patchProject(id: string, patch: Partial<VideoProject>): void {
  setState((s) => ({
    videos: s.videos.map((v) => (v.id === id ? { ...v, ...patch, updatedAt: Date.now() } : v)),
  }));
}

export function patchScene(projectId: string, sceneId: string, patch: Partial<VideoScene>): void {
  setState((s) => ({
    videos: s.videos.map((v) =>
      v.id === projectId
        ? {
            ...v,
            updatedAt: Date.now(),
            scenes: v.scenes.map((sc) => (sc.id === sceneId ? { ...sc, ...patch } : sc)),
          }
        : v,
    ),
  }));
}

export function getProject(id: string): VideoProject | undefined {
  return getState().videos.find((v) => v.id === id);
}

export function deleteProject(id: string): void {
  renderCache.delete(id);
  setState((s) => ({ videos: s.videos.filter((v) => v.id !== id) }));
}

function setStage(id: string, stage: VideoStage): void {
  patchProject(id, { stage, error: undefined });
}

/* ------------------------------------------------------------------ */
/*  2-bosqich: sahna rasmlari                                          */
/* ------------------------------------------------------------------ */

export async function generateSceneImages(
  projectId: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { settings } = getState();
  const project = getProject(projectId);
  if (!project) return;

  setStage(projectId, 'rasmlar');
  const total = project.scenes.length;

  for (let i = 0; i < total; i += 1) {
    const scene = getProject(projectId)?.scenes[i];
    if (!scene) break;
    if (scene.imageData) {
      onProgress?.(i + 1, total);
      continue;
    }

    const character = project.characters.find((c) => c.id === scene.characterId);
    const parts = [
      scene.imagePrompt,
      character ? `Character: ${character.name} — ${character.look}. Keep appearance identical.` : '',
      `Visual style: ${project.style}.`,
      `Aspect ratio ${project.aspect}, cinematic composition, high detail, no text or letters in the image.`,
    ].filter(Boolean);

    try {
      const result = await generateImage(
        settings.apiKey,
        settings.imageModel,
        parts.join(' '),
        character?.refImage ? [{ mimeType: 'image/png', data: character.refImage }] : [],
        signal,
      );
      patchScene(projectId, scene.id, {
        imageData: result.images[0].data,
        imageMime: result.images[0].mimeType,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      // Bitta sahna chiqmasa ham davom etamiz — render paytida fon ishlatiladi.
      console.warn('Sahna rasmi chiqmadi:', err);
    }
    onProgress?.(i + 1, total);
  }
}

/* ------------------------------------------------------------------ */
/*  3-bosqich: ovoz                                                    */
/* ------------------------------------------------------------------ */

export async function generateSceneVoices(
  projectId: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const project = getProject(projectId);
  if (!project) return;

  setStage(projectId, 'ovoz');
  const total = project.scenes.length;

  for (let i = 0; i < total; i += 1) {
    const scene = getProject(projectId)?.scenes[i];
    if (!scene) break;
    if (scene.audioWav) {
      onProgress?.(i + 1, total);
      continue;
    }
    const character = project.characters.find((c) => c.id === scene.characterId);
    try {
      const wav = await synthesize(scene.narration, character?.voiceId ?? project.voiceId, signal);
      patchScene(projectId, scene.id, { audioWav: wav });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      console.warn('Sahna ovozi chiqmadi:', err);
    }
    onProgress?.(i + 1, total);
  }
  setStage(projectId, 'tayyor');
}

/* ------------------------------------------------------------------ */
/*  4-bosqich: render                                                  */
/* ------------------------------------------------------------------ */

/** Render natijalari — localStorage ni to'ldirmaslik uchun xotirada saqlanadi. */
const renderCache = new Map<string, Blob>();

export function getRendered(projectId: string): Blob | undefined {
  return renderCache.get(projectId);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasm yuklanmadi'));
    img.src = dataUrl;
  });
}

/** Uzun matnni ekranga sig'adigan subtitr bo'laklariga bo'ladi. */
function splitCaption(text: string, wordsPerChunk = 6): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  return chunks.length ? chunks : [''];
}

function wrapLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = words[0] ?? '';
  for (let i = 1; i < words.length; i += 1) {
    if (ctx.measureText(`${line} ${words[i]}`).width <= maxWidth) line += ` ${words[i]}`;
    else {
      lines.push(line);
      line = words[i];
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pickVideoMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
}

/**
 * Sahnalarni, ovozni va subtitrni bitta videoga yigʻadi.
 * Telefonning oʻzida, canvas + MediaRecorder orqali — server kerak emas.
 */
export async function renderVideo(
  projectId: string,
  onProgress?: (percent: number) => void,
): Promise<RenderResult> {
  const project = getProject(projectId);
  if (!project) throw new Error('Loyiha topilmadi');
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Bu qurilmada video yigʻish qoʻllab-quvvatlanmaydi.');
  }

  setStage(projectId, 'render');
  const { w, h } = dimensionsFor(project.aspect);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas ochilmadi');

  const AudioCtor: typeof AudioContext =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const audio = new AudioCtor();
  if (audio.state === 'suspended') await audio.resume();

  // Ovozlarni dekodlash
  const buffers: (AudioBuffer | null)[] = [];
  for (const scene of project.scenes) {
    if (!scene.audioWav) {
      buffers.push(null);
      continue;
    }
    try {
      const bytes = b64ToBytes(scene.audioWav);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      buffers.push(await audio.decodeAudioData(copy));
    } catch {
      buffers.push(null);
    }
  }

  const GAP = 0.28;
  const durations = project.scenes.map((scene, i) =>
    buffers[i] ? buffers[i]!.duration + GAP : scene.durationSec,
  );
  const total = durations.reduce((sum, d) => sum + d, 0);

  // Rasmlarni yuklash
  const images: (HTMLImageElement | null)[] = [];
  for (const scene of project.scenes) {
    if (!scene.imageData) {
      images.push(null);
      continue;
    }
    try {
      images.push(await loadImage(`data:${scene.imageMime ?? 'image/png'};base64,${scene.imageData}`));
    } catch {
      images.push(null);
    }
  }

  const captions = project.scenes.map((s) => splitCaption(s.narration));

  // Oqimlarni birlashtirish
  const destination = audio.createMediaStreamDestination();
  const stream = canvas.captureStream(30);
  destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const mimeType = pickVideoMime();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 3_500_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(500);

  const startAt = audio.currentTime + 0.35;
  let cursor = startAt;
  buffers.forEach((buffer, i) => {
    if (buffer) {
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start(cursor);
    }
    cursor += durations[i];
  });

  const drawFrame = (elapsed: number) => {
    // Qaysi sahna?
    let index = 0;
    let sceneStart = 0;
    while (index < durations.length - 1 && elapsed > sceneStart + durations[index]) {
      sceneStart += durations[index];
      index += 1;
    }
    const local = elapsed - sceneStart;
    const progress = Math.min(1, Math.max(0, local / durations[index]));

    ctx.fillStyle = '#0b0b0f';
    ctx.fillRect(0, 0, w, h);

    const img = images[index];
    if (img) {
      // Ken Burns: sekin yaqinlashish
      const zoom = 1.06 + progress * 0.07;
      const scale = Math.max(w / img.width, h / img.height) * zoom;
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#221c4a');
      grad.addColorStop(1, '#0b0b0f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    // Pastki qorayish — subtitr oʻqilishi uchun
    const shade = ctx.createLinearGradient(0, h * 0.55, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    // Kirish/chiqish qorayishi
    if (elapsed < 0.4) {
      ctx.fillStyle = `rgba(0,0,0,${1 - elapsed / 0.4})`;
      ctx.fillRect(0, 0, w, h);
    } else if (total - elapsed < 0.5) {
      ctx.fillStyle = `rgba(0,0,0,${1 - (total - elapsed) / 0.5})`;
      ctx.fillRect(0, 0, w, h);
    }

    drawCaption(ctx, project.subtitle, captions[index], progress, w, h);
  };

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = audio.currentTime - startAt;
      if (elapsed >= total) {
        drawFrame(total - 0.01);
        resolve();
        return;
      }
      if (elapsed >= 0) {
        drawFrame(elapsed);
        onProgress?.(Math.min(99, Math.round((elapsed / total) * 100)));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  await audio.close().catch(() => undefined);

  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
  renderCache.set(projectId, blob);
  patchProject(projectId, {
    stage: 'yakunlandi',
    outputMime: blob.type,
    outputSize: blob.size,
  });
  onProgress?.(100);

  return { blob, mimeType: blob.type, durationSec: total };
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  style: SubtitleStyle,
  chunks: string[],
  progress: number,
  w: number,
  h: number,
): void {
  if (!chunks.length) return;
  const index = Math.min(chunks.length - 1, Math.floor(progress * chunks.length));
  const raw = chunks[index];
  if (!raw) return;
  const text = style.uppercase ? raw.toUpperCase() : raw;

  ctx.font = `700 ${style.size}px ${style.font}, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = w * 0.86;
  const lines = wrapLine(ctx, text, maxWidth);
  const lineHeight = style.size * 1.25;
  const blockHeight = lines.length * lineHeight;

  const centerY =
    style.position === 'yuqori'
      ? h * 0.16 + blockHeight / 2
      : style.position === 'orta'
        ? h / 2
        : h * 0.84 - blockHeight / 2;

  if (style.background && style.background !== 'transparent') {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const padX = style.size * 0.5;
    const padY = style.size * 0.34;
    ctx.fillStyle = style.background;
    const x = (w - widest) / 2 - padX;
    const y = centerY - blockHeight / 2 - padY;
    const bw = widest + padX * 2;
    const bh = blockHeight + padY * 2;
    const r = Math.min(18, bh / 3);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, r);
    ctx.arcTo(x + bw, y + bh, x, y + bh, r);
    ctx.arcTo(x, y + bh, x, y, r);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.closePath();
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const y = centerY - blockHeight / 2 + lineHeight * (i + 0.5);
    if (style.strokeWidth > 0) {
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeStyle = style.stroke;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, w / 2, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, w / 2, y);
  });
}
