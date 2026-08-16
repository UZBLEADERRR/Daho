/**
 * Word hujjatlari bilan ishlash — oʻqish va rasm qoʻshib qayta yozish.
 *
 * Hammasi telefonda bajariladi: .docx aslida ZIP, ichida XML. `fflate` bilan
 * ochamiz, matnni olamiz, kerak boʻlsa rasmlarni qoʻshib qaytadan yigʻamiz.
 */

import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { b64ToBytes } from './audio';

/* ------------------------------------------------------------------ */
/*  Oʻqish                                                             */
/* ------------------------------------------------------------------ */

function xmlText(xml: string): string {
  // Har bir <w:p> — alohida qator, <w:tab/> — tabulyatsiya.
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');

  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withBreaks))) {
    parts.push(m[1] === undefined ? '\n' : m[1]);
  }

  return parts
    .join('')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** .docx faylidan matnni ajratib oladi. */
export function readDocx(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('Bu .docx fayl emas yoki buzilgan');
  return xmlText(strFromU8(doc));
}

/** Fayl .docx ekanini nomi yoki turidan aniqlaydi. */
export function isDocx(name: string, mime = ''): boolean {
  return (
    name.toLowerCase().endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* ------------------------------------------------------------------ */
/*  Rasm bilan qayta yozish                                            */
/* ------------------------------------------------------------------ */

export interface DocImage {
  /** base64, prefikssiz */
  data: string;
  mimeType: string;
  /** Rasm ostidagi izoh */
  caption?: string;
  /** Piksel oʻlchamlari — nisbatni saqlash uchun */
  width?: number;
  height?: number;
}

/**
 * Hujjat tarkibi: matn qatorlari va orasidagi rasmlar.
 * `image` — IMAGES roʻyxatidagi indeks.
 */
export type DocPart = { text: string } | { image: number };

const EMU_PER_PX = 9525;
const MAX_WIDTH_EMU = 5486400; // ~5.7 dyuym (A4 ning matn kengligi)

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extOf(mime: string): 'png' | 'jpeg' {
  return mime.includes('jpeg') || mime.includes('jpg') ? 'jpeg' : 'png';
}

function textParagraph(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '<w:p/>';

  const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    return (
      `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` +
      `<w:r><w:t xml:space="preserve">${esc(heading[2])}</w:t></w:r></w:p>`
    );
  }

  const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
  if (bullet) {
    return (
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      `<w:r><w:t xml:space="preserve">${esc(bullet[1])}</w:t></w:r></w:p>`
    );
  }

  return `<w:p><w:r><w:t xml:space="preserve">${esc(trimmed)}</w:t></w:r></w:p>`;
}

function imageParagraph(index: number, image: DocImage): string {
  const px = image.width && image.height ? { w: image.width, h: image.height } : { w: 900, h: 600 };
  let cx = px.w * EMU_PER_PX;
  let cy = px.h * EMU_PER_PX;
  if (cx > MAX_WIDTH_EMU) {
    cy = Math.round((cy * MAX_WIDTH_EMU) / cx);
    cx = MAX_WIDTH_EMU;
  }
  const rid = `rIdImg${index}`;
  const name = `Rasm ${index + 1}`;

  const drawing =
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index + 100}" name="${name}"/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${index + 100}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

  const caption = image.caption
    ? '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:sz w:val="18"/>' +
      `<w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">${esc(image.caption)}</w:t></w:r></w:p>`
    : '';

  return drawing + caption;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:pPr><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>
<w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">
<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

/**
 * Matn va rasmlardan .docx yasaydi.
 * Rasmlar hujjat ichiga haqiqiy tasvir sifatida joylanadi (havola emas).
 */
export function buildDocxWithImages(parts: DocPart[], images: DocImage[]): Uint8Array {
  const body = parts
    .map((part) =>
      'image' in part
        ? images[part.image]
          ? imageParagraph(part.image, images[part.image])
          : ''
        : part.text.split('\n').map(textParagraph).join(''),
    )
    .join('');

  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    '</w:body></w:document>';

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    images
      .map(
        (img, i) =>
          `<Relationship Id="rIdImg${i}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
          `Target="media/image${i}.${extOf(img.mimeType)}"/>`,
      )
      .join('') +
    '</Relationships>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const zip: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(rels),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
  };
  images.forEach((img, i) => {
    zip[`word/media/image${i}.${extOf(img.mimeType)}`] = b64ToBytes(img.data);
  });

  return zipSync(zip, { level: 6 });
}

/** Rasmning haqiqiy oʻlchamini aniqlaydi (nisbat toʻgʻri boʻlishi uchun). */
export function imageSize(data: string, mimeType: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 900, height: 600 });
    img.src = `data:${mimeType};base64,${data}`;
  });
}

/**
 * Matnni «langar» (anchor) boʻyicha boʻlib, oʻsha joylarga rasm qoʻyadi.
 * Langar topilmasa rasm matnni teng boʻlaklarga boʻlib joylashtiriladi.
 */
export function placeImages(
  text: string,
  anchors: Array<{ after: string }>,
): DocPart[] {
  const parts: DocPart[] = [];
  let rest = text;

  anchors.forEach((anchor, index) => {
    const needle = anchor.after?.trim();
    const at = needle ? rest.indexOf(needle) : -1;
    if (at >= 0) {
      const cut = at + needle.length;
      parts.push({ text: rest.slice(0, cut) });
      parts.push({ image: index });
      rest = rest.slice(cut);
      return;
    }
    // Langar topilmadi — qolgan matnni teng boʻlib joylaymiz.
    const share = Math.floor(rest.length / Math.max(1, anchors.length - index));
    const boundary = rest.indexOf('\n', share);
    const cut = boundary > 0 ? boundary : rest.length;
    parts.push({ text: rest.slice(0, cut) });
    parts.push({ image: index });
    rest = rest.slice(cut);
  });

  if (rest) parts.push({ text: rest });
  return parts;
}
