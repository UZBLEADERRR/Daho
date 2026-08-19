import { strToU8, zipSync } from 'fflate';
import { b64ToBytes } from './audio';
import { prepareImages } from './docimages';
import type { Slide } from './docmodel';
import { parseSlides } from './docmodel';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** EMU: 1 dyuym = 914400. Slayd 16:9 → 12192000 × 6858000 */
const W = 12192000;
const H = 6858000;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Daho">
<a:themeElements>
<a:clrScheme name="Daho">
<a:dk1><a:srgbClr val="16161A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="2A2A32"/></a:dk2><a:lt2><a:srgbClr val="F3F3F7"/></a:lt2>
<a:accent1><a:srgbClr val="6B56E8"/></a:accent1><a:accent2><a:srgbClr val="8B7CF6"/></a:accent2>
<a:accent3><a:srgbClr val="4EC98A"/></a:accent3><a:accent4><a:srgbClr val="F4655F"/></a:accent4>
<a:accent5><a:srgbClr val="F0A93B"/></a:accent5><a:accent6><a:srgbClr val="3BA7F0"/></a:accent6>
<a:hlink><a:srgbClr val="6B56E8"/></a:hlink><a:folHlink><a:srgbClr val="8B7CF6"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Daho">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Daho">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0E0E12"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2"
 accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Bosh"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function textBox(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  paragraphs: string,
): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>
<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr>
<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

interface SlideMedia {
  /** ppt/media/ ichidagi fayl nomi */
  file: string;
  width: number;
  height: number;
}

/** Rasm shakli (p:pic) — slayddagi rIdN ga bogʻlanadi. */
function picture(id: number, x: number, y: number, cx: number, cy: number, rel: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Rasm ${id}"/>
<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 4000"/></a:avLst></a:prstGeom>
</p:spPr></p:pic>`;
}

/** Toʻrtburchak — fon yoʻlagi va bezak chiziqlari uchun. */
function rect(id: number, x: number, y: number, cx: number, cy: number, color: string, alpha?: number): string {
  const fill = alpha === undefined
    ? `<a:srgbClr val="${color}"/>`
    : `<a:srgbClr val="${color}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shakl ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
<a:solidFill>${fill}</a:solidFill></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function para(text: string, size: number, color: string, opts: { bold?: boolean; bullet?: boolean; align?: string } = {}): string {
  const pPr = opts.bullet
    ? '<a:pPr marL="285750" indent="-285750"><a:buClr><a:srgbClr val="8B7CF6"/></a:buClr><a:buChar char="\u25CF"/></a:pPr>'
    : `<a:pPr algn="${opts.align ?? 'l'}"/>`;
  return `<a:p>${pPr}<a:r><a:rPr lang="uz-UZ" sz="${size}"${opts.bold ? ' b="1"' : ''} dirty="0">
<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

const MARGIN_X = 838200;

/**
 * Slayd chizish. Uch koʻrinish:
 *  - **muqova** (birinchi slayd, rasm bilan) — rasm butun slaydni qoplaydi;
 *  - **rasmli** — matn chapda, rasm oʻngda;
 *  - **oddiy** — sarlavha va punktlar.
 */
function slideXml(slide: Slide, index: number, media?: SlideMedia, cover = false): string {
  const shapes: string[] = [];
  let id = 10;

  if (cover && media) {
    // Muqova: rasm toʻliq, ustida qoraytirgich va katta sarlavha.
    shapes.push(picture((id += 1), 0, 0, W, H, 'rId2'));
    shapes.push(rect((id += 1), 0, H - 2600000, W, 2600000, '000000', 0.62));
    shapes.push(
      textBox((id += 1), 'Sarlavha', MARGIN_X, H - 2050000, W - MARGIN_X * 2, 1500000,
        para(slide.title, 4400, 'FFFFFF', { bold: true }) +
          (slide.bullets[0] ? para(slide.bullets[0].slice(0, 120), 1800, 'D6D6DE') : '')),
    );
    return wrapSlide(shapes.join('\n'));
  }

  // Chap tomondagi urgʻu chizigʻi + sarlavha.
  shapes.push(rect((id += 1), MARGIN_X, 1050000, 900000, 60000, '8B7CF6'));

  const textWidth = media ? (W - MARGIN_X * 2) * 0.52 : W - MARGIN_X * 2;
  shapes.push(
    textBox((id += 1), 'Sarlavha', MARGIN_X, 520000, textWidth, 900000,
      para(slide.title, 3200, 'FFFFFF', { bold: true })),
  );

  const bullets = slide.bullets
    .slice(0, media ? 5 : 8)
    .map((t) => para(t.slice(0, media ? 150 : 220), media ? 1600 : 1800, 'D6D6DE', { bullet: true }))
    .join('');
  shapes.push(
    textBox((id += 1), 'Matn', MARGIN_X, 1400000, textWidth, H - 2200000, bullets || '<a:p/>'),
  );

  if (media) {
    // Oʻng tomonda rasm — nisbati saqlangan holda joyga sigʻdiriladi.
    const boxX = MARGIN_X + textWidth + 500000;
    const boxW = W - boxX - MARGIN_X;
    const boxY = 1300000;
    const boxH = H - boxY - 900000;
    const ratio = media.height / media.width;
    let cx = boxW;
    let cy = cx * ratio;
    if (cy > boxH) {
      cy = boxH;
      cx = cy / ratio;
    }
    shapes.push(picture((id += 1), boxX + (boxW - cx) / 2, boxY + (boxH - cy) / 2, cx, cy, 'rId2'));
    if (slide.caption?.trim()) {
      shapes.push(
        textBox((id += 1), 'Izoh', boxX, boxY + boxH + 60000, boxW, 320000,
          para(slide.caption.slice(0, 90), 1100, '8A8A96', { align: 'ctr' })),
      );
    }
  }

  // Sahifa raqami.
  shapes.push(
    textBox((id += 1), 'Raqam', W - 1400000, H - 700000, 800000, 400000,
      para(String(index + 1), 1200, '6A6A76', { align: 'r' })),
  );

  return wrapSlide(shapes.join('\n'));
}

function wrapSlide(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${body}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/** Markdown matndan .pptx fayl bayti yasaydi. */
export async function buildPptx(markdown: string, title?: string): Promise<Uint8Array> {
  const slides = parseSlides(markdown);
  if (title) slides.unshift({ title, bullets: [] });

  // Rasmlarni tayyorlaymiz: har biri ppt/media ichiga JPEG boʻlib tushadi.
  const prepared = await prepareImages(
    slides.map((s) => s.image).filter((src): src is string => Boolean(src)),
  );
  const media = new Map<number, SlideMedia>();
  const mediaFiles: Record<string, Uint8Array> = {};
  slides.forEach((slide, i) => {
    const img = slide.image ? prepared.get(slide.image) : undefined;
    if (!img) return;
    const file = `image${i + 1}.jpeg`;
    mediaFiles[`ppt/media/${file}`] = b64ToBytes(img.data);
    media.set(i, { file, width: img.width, height: img.height });
  });

  const files: Record<string, Uint8Array> = { ...mediaFiles };

  const overrides = slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('');

  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${overrides}
</Types>`);

  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  const slideIds = slides
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join('');

  files['ppt/presentation.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slideIds}</p:sldIdLst>
<p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="${W}"/>
</p:presentation>`);

  const presRels = slides
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join('');

  files['ppt/_rels/presentation.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${presRels}
<Relationship Id="rId${slides.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`);

  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(SLIDE_MASTER);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(SLIDE_LAYOUT);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

  files['ppt/theme/theme1.xml'] = strToU8(THEME);

  slides.forEach((slide, i) => {
    const pic = media.get(i);
    // Birinchi slayd rasmli boʻlsa — muqova koʻrinishida chiziladi.
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slideXml(slide, i, pic, i === 0 && Boolean(pic)));
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${pic ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${pic.file}"/>` : ''}
</Relationships>`);
  });

  return zipSync(files, { level: 6 });
}
