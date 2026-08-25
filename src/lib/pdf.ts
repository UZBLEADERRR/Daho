import type { Block, Run } from './docmodel';
import { parseDocument, runsToText } from './docmodel';
import { loadImage, prepareImages } from './docimages';

/* ------------------------------------------------------------------ */
/*  Sahifalarni canvasda chizish                                       */
/* ------------------------------------------------------------------ */

/** A4 nuqtalarda (72 dpi) */
const PAGE_W = 595;
const PAGE_H = 842;
const SCALE = 2;
const MARGIN = 56;

interface Pen {
  ctx: CanvasRenderingContext2D;
  y: number;
}

function newPage(): { canvas: HTMLCanvasElement; pen: Pen } {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * SCALE;
  canvas.height = PAGE_H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas ishlamadi');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'top';
  return { canvas, pen: { ctx, y: MARGIN } };
}

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${line} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

interface TextOpts {
  size: number;
  bold?: boolean;
  color?: string;
  indent?: number;
  gapAfter?: number;
  mono?: boolean;
  lineHeight?: number;
}

/**
 * Matnni joriy sahifaga yozadi, joy tugasa yangi sahifa ochadi.
 * Yangi sahifa ochilsa uni `pages` ga qoʻshadi.
 */
function writeText(
  state: { pages: HTMLCanvasElement[]; current: { canvas: HTMLCanvasElement; pen: Pen } },
  text: string,
  opts: TextOpts,
): void {
  const indent = opts.indent ?? 0;
  const maxWidth = PAGE_W - MARGIN * 2 - indent;
  const lineHeight = opts.lineHeight ?? opts.size * 1.45;

  const apply = (ctx: CanvasRenderingContext2D) => {
    ctx.font = `${opts.bold ? '600 ' : ''}${opts.size}px ${opts.mono ? MONO : FONT}`;
    ctx.fillStyle = opts.color ?? '#1a1a1f';
  };

  apply(state.current.pen.ctx);
  const lines = opts.mono ? text.split('\n') : wrap(state.current.pen.ctx, text, maxWidth);

  for (const line of lines) {
    if (state.current.pen.y + lineHeight > PAGE_H - MARGIN) {
      state.pages.push(state.current.canvas);
      state.current = newPage();
      apply(state.current.pen.ctx);
    }
    state.current.pen.ctx.fillText(line, MARGIN + indent, state.current.pen.y, maxWidth);
    state.current.pen.y += lineHeight;
  }
  state.current.pen.y += opts.gapAfter ?? 6;
}

type DrawState = {
  pages: HTMLCanvasElement[];
  current: { canvas: HTMLCanvasElement; pen: Pen };
};

/**
 * Rasmni sahifaga chizadi. Sigʻmasa yangi sahifaga oʻtadi; juda baland
 * boʻlsa sahifa balandligiga moslashtiriladi.
 */
function drawImage(state: DrawState, img: HTMLImageElement, caption: string): void {
  const maxW = PAGE_W - MARGIN * 2;
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
  let w = maxW;
  let h = w * ratio;

  const maxH = PAGE_H - MARGIN * 2 - 30;
  if (h > maxH) {
    h = maxH;
    w = h / ratio;
  }

  // Sahifada joy qolmagan boʻlsa — yangisiga.
  if (state.current.pen.y + h > PAGE_H - MARGIN) {
    state.pages.push(state.current.canvas);
    state.current = newPage();
  }

  const x = MARGIN + (maxW - w) / 2;
  const { ctx } = state.current.pen;
  ctx.drawImage(img, x, state.current.pen.y, w, h);
  state.current.pen.y += h + 6;

  if (caption.trim()) {
    ctx.font = `italic 9.5px ${FONT}`;
    ctx.fillStyle = '#6b6b76';
    ctx.textAlign = 'center';
    ctx.fillText(caption.slice(0, 110), PAGE_W / 2, state.current.pen.y);
    ctx.textAlign = 'left';
    state.current.pen.y += 16;
  } else {
    state.current.pen.y += 8;
  }
}

/** Muqova sahifasi — rasm toʻliq sahifa, ustida kitob nomi. */
function drawCover(state: DrawState, img: HTMLImageElement, title: string): void {
  const { ctx } = state.current.pen;
  const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);

  // Sahifani toʻliq qoplaymiz (kerak boʻlsa chetini kesib).
  let w = PAGE_W;
  let h = w * ratio;
  if (h < PAGE_H) {
    h = PAGE_H;
    w = h / ratio;
  }
  ctx.drawImage(img, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);

  if (title.trim()) {
    // Pastki qismga qoraygan yoʻlak — matn har qanday rasmda oʻqiladi.
    const bandTop = PAGE_H - 190;
    const grad = ctx.createLinearGradient(0, bandTop, 0, PAGE_H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, bandTop, PAGE_W, 190);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const lines = wrap(ctx, title, PAGE_W - MARGIN * 2);
    ctx.font = `700 26px ${FONT}`;
    let y = PAGE_H - 60 - (lines.length - 1) * 32;
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, PAGE_W / 2, y);
      y += 32;
    }
    ctx.textAlign = 'left';
  }

  state.pages.push(state.current.canvas);
  state.current = newPage();
}

function drawBlock(
  state: DrawState,
  block: Block,
  images?: Map<string, HTMLImageElement>,
): void {
  switch (block.type) {
    case 'img': {
      const img = images?.get(block.src);
      if (img) drawImage(state, img, block.caption);
      break;
    }
    case 'h1':
      writeText(state, runsToText(block.runs), { size: 24, bold: true, gapAfter: 10 });
      break;
    case 'h2':
      writeText(state, runsToText(block.runs), { size: 18, bold: true, gapAfter: 8 });
      break;
    case 'h3':
      writeText(state, runsToText(block.runs), { size: 15, bold: true, gapAfter: 6 });
      break;
    case 'p':
      writeText(state, runsToText(block.runs), { size: 11.5, gapAfter: 8, color: '#26262c' });
      break;
    case 'ul':
      block.items.forEach((item) =>
        writeText(state, `•  ${runsToText(item)}`, {
          size: 11.5,
          indent: 14,
          gapAfter: 3,
          color: '#26262c',
        }),
      );
      state.current.pen.y += 6;
      break;
    case 'ol':
      block.items.forEach((item, i) =>
        writeText(state, `${i + 1}.  ${runsToText(item)}`, {
          size: 11.5,
          indent: 14,
          gapAfter: 3,
          color: '#26262c',
        }),
      );
      state.current.pen.y += 6;
      break;
    case 'code':
      writeText(state, block.text, {
        size: 9.5,
        mono: true,
        indent: 10,
        gapAfter: 10,
        color: '#3a3a44',
        lineHeight: 13,
      });
      break;
    case 'hr': {
      const { ctx, y } = state.current.pen;
      ctx.strokeStyle = '#d8d8de';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 4);
      ctx.lineTo(PAGE_W - MARGIN, y + 4);
      ctx.stroke();
      state.current.pen.y += 16;
      break;
    }
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/*  PDF fayl tuzish                                                    */
/* ------------------------------------------------------------------ */

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sahifa rasmlaridan PDF yigʻadi. Matn rasm ichida boʻlgani uchun
 * har qanday harf (oʻ, gʻ, ʼ) toʻgʻri koʻrinadi.
 */
function assemblePdf(images: Uint8Array[], width: number, height: number): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  const objectCount = 2 + images.length * 3;
  const markObject = (index: number) => {
    offsets[index] = length;
  };

  push('%PDF-1.4\n');

  // 1: Catalog, 2: Pages
  markObject(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageIds = images.map((_, i) => 3 + i * 3);
  markObject(2);
  push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${images.length} >>\nendobj\n`,
  );

  images.forEach((image, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    markObject(pageId);
    push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );

    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    markObject(contentId);
    push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    markObject(imageId);
    push(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width * SCALE} ` +
        `/Height ${height * SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    );
    push(image);
    push('\nendstream\nendobj\n');
  });

  const xrefStart = length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objectCount; i += 1) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/** Markdown matndan .pdf fayl bayti yasaydi. */
export async function buildPdf(markdown: string, title?: string): Promise<Uint8Array> {
  const blocks = parseDocument(markdown);

  // Rasmlarni oldindan yuklab olamiz — canvas ga chizish sinxron boʻlishi kerak.
  const srcs = blocks.filter((b): b is Extract<Block, { type: 'img' }> => b.type === 'img');
  const prepared = await prepareImages(srcs.map((b) => b.src));
  const images = new Map<string, HTMLImageElement>();
  for (const [src, data] of prepared) {
    try {
      images.set(src, await loadImage(data.data, data.mimeType));
    } catch {
      /* bitta rasm chiqmasa hujjat baribir yasaladi */
    }
  }

  const state = { pages: [] as HTMLCanvasElement[], current: newPage() };

  // Muqova boʻlsa — birinchi sahifa toʻliq muqova boʻlsin.
  const first = blocks[0];
  if (first?.type === 'img' && images.has(first.src)) {
    drawCover(state, images.get(first.src)!, title ?? '');
    blocks.shift();
  } else if (title) {
    writeText(state, title, { size: 26, bold: true, gapAfter: 16 });
  }

  for (const block of blocks) drawBlock(state, block, images);
  state.pages.push(state.current.canvas);

  const pageJpegs = state.pages.map((canvas) =>
    dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.86)),
  );
  return assemblePdf(pageJpegs, PAGE_W, PAGE_H);
}

/** Faqat sarlavhani olish uchun yordamchi (eksport nomi uchun). */
export function firstHeading(markdown: string, fallback: string): string {
  const runs: Run[] | undefined = parseDocument(markdown).find(
    (b): b is Extract<Block, { runs: Run[] }> => 'runs' in b && b.type.startsWith('h'),
  )?.runs;
  return runs ? runsToText(runs).slice(0, 60) : fallback;
}
