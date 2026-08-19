/*
 * MediaRecorder yozgan WebM «jonli oqim» sifatida chiqadi: Segment uzunligi
 * nomaʼlum, Info boʻlagida esa Duration umuman boʻlmaydi. Natijada pleyer
 * videoning necha soniya ekanini bilmaydi — vaqt chizigʻi boʻsh koʻrinadi,
 * orqaga surib boʻlmaydi, bazi telefon pleyerlari esa ovoz yoʻlini umuman
 * ochmaydi va video ovozsiz oʻynaydi.
 *
 * Shu yerda faylning boshidagi Info boʻlagiga Duration qoʻshib qoʻyamiz.
 * Klasterlarga tegilmaydi, shuning uchun qayta kodlash kerak emas.
 */

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

interface Element {
  id: number;
  /** Element ichidagi maʼlumot qayerdan boshlanadi */
  start: number;
  /** Maʼlumot uzunligi; nomaʼlum boʻlsa -1 */
  size: number;
  /** ID + uzunlik baytlari qayerdan boshlangan */
  head: number;
}

/** EBML element ID sini oʻqiydi (birinchi bayt uzunlikni bildiradi). */
function readId(view: DataView, at: number): { id: number; next: number } | null {
  if (at >= view.byteLength) return null;
  const first = view.getUint8(at);
  const length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0;
  if (!length || at + length > view.byteLength) return null;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + view.getUint8(at + i);
  return { id, next: at + length };
}

/** Oʻzgaruvchan uzunlikdagi sonni oʻqiydi. Hamma biti 1 boʻlsa — nomaʼlum. */
function readSize(view: DataView, at: number): { size: number; next: number; width: number } | null {
  if (at >= view.byteLength) return null;
  const first = view.getUint8(at);
  let width = 0;
  for (let i = 0; i < 8; i += 1) {
    if (first & (0x80 >> i)) {
      width = i + 1;
      break;
    }
  }
  if (!width || at + width > view.byteLength) return null;

  let value = first & (0xff >> width);
  let allOnes = value === 0xff >> width;
  for (let i = 1; i < width; i += 1) {
    const byte = view.getUint8(at + i);
    if (byte !== 0xff) allOnes = false;
    value = value * 256 + byte;
  }
  return { size: allOnes ? -1 : value, next: at + width, width };
}

function readElement(view: DataView, at: number): Element | null {
  const id = readId(view, at);
  if (!id) return null;
  const size = readSize(view, id.next);
  if (!size) return null;
  return { id: id.id, start: size.next, size: size.size, head: at };
}

/** Berilgan oraliqdan bitta bolani topadi. */
function findChild(view: DataView, from: number, to: number, wanted: number): Element | null {
  let at = from;
  while (at < to) {
    const el = readElement(view, at);
    if (!el) return null;
    if (el.id === wanted) return el;
    if (el.size < 0) return null;
    at = el.start + el.size;
  }
  return null;
}

function readUint(view: DataView, el: Element): number {
  let value = 0;
  for (let i = 0; i < el.size; i += 1) value = value * 256 + view.getUint8(el.start + i);
  return value;
}

/** Uzunlikni EBML VINT qilib yozadi — mavjud kenglikni saqlab qolgan holda. */
function writeSize(value: number, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let rest = value;
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  out[0] |= 0x80 >> (width - 1);
  return out;
}

/** Sondan necha bayt VINT kerakligini hisoblaydi. */
function sizeWidth(value: number): number {
  let width = 1;
  while (width < 8 && value >= 2 ** (7 * width) - 1) width += 1;
  return width;
}

/**
 * WebM ga davomiylik yozadi. Fayl tushunarsiz boʻlsa asl blob qaytadi —
 * video hech qachon yoʻqolmaydi.
 */
export async function withWebmDuration(blob: Blob, durationSec: number): Promise<Blob> {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return blob;

  try {
    // Sarlavha faylning boshida — hammasini oʻqish shart emas.
    const headSize = Math.min(blob.size, 64 * 1024);
    const head = new Uint8Array(await blob.slice(0, headSize).arrayBuffer());
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);

    // EBML sarlavhasidan keyingi Segment
    const ebml = readElement(view, 0);
    if (!ebml || ebml.size < 0) return blob;
    const segment = readElement(view, ebml.start + ebml.size);
    if (!segment || segment.id !== ID_SEGMENT) return blob;

    const limit = segment.size < 0 ? head.byteLength : Math.min(head.byteLength, segment.start + segment.size);
    const info = findChild(view, segment.start, limit, ID_INFO);
    if (!info || info.size < 0) return blob;

    const infoEnd = info.start + info.size;
    const scaleEl = findChild(view, info.start, infoEnd, ID_TIMECODE_SCALE);
    const scale = scaleEl ? readUint(view, scaleEl) : 1_000_000;
    if (!scale) return blob;

    // Duration — TimecodeScale birligida, 8 baytli float.
    const ticks = (durationSec * 1e9) / scale;
    const already = findChild(view, info.start, infoEnd, ID_DURATION);

    if (already && already.size === 8) {
      // Joyi bor — oʻrniga yozamiz, uzunliklar oʻzgarmaydi.
      const copy = head.slice();
      new DataView(copy.buffer).setFloat64(already.start, ticks);
      return new Blob([copy, blob.slice(headSize)], { type: blob.type });
    }
    if (already) return blob; // kutilmagan oʻlcham — tegmaymiz

    // Duration elementi: ID (2 bayt) + uzunlik (1 bayt) + qiymat (8 bayt)
    const duration = new Uint8Array(11);
    const dv = new DataView(duration.buffer);
    dv.setUint16(0, ID_DURATION);
    duration[2] = 0x88;
    dv.setFloat64(3, ticks);

    // Info uzunligi 11 baytga oʻsadi. VINT kengligi oʻzgarmasa — oddiy almashtirish.
    const oldWidth = info.start - (info.head + 4); // Info ID doim 4 bayt
    const newSize = info.size + duration.byteLength;
    if (sizeWidth(newSize) !== oldWidth) return blob;

    const patched = head.slice();
    patched.set(writeSize(newSize, oldWidth), info.head + 4);

    return new Blob(
      [
        patched.slice(0, info.start),
        duration,
        patched.slice(info.start),
        blob.slice(headSize),
      ],
      { type: blob.type },
    );
  } catch {
    return blob;
  }
}
