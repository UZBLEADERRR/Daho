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

/** Yumaloq burchakli toʻldirilgan karta — punktlar va raqamlar uchun. */
function card(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fill: string,
  alpha = 1,
  line?: string,
): string {
  const border = line
    ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Karta ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"/></a:avLst></a:prstGeom>
<a:solidFill><a:srgbClr val="${fill}"><a:alpha val="${Math.round(alpha * 100000)}"/></a:srgbClr></a:solidFill>
${border}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

/**
 * Fon — burchakdagi yumshoq dogʻ.
 *
 * Slaydlar bir xil qora toʻrtburchak boʻlib turmasin: har birida
 * urgʻu rangidagi katta doira burchakdan chiqib turadi. Bu arzon,
 * lekin taqdimotni «tayyor shablon»dek koʻrsatadi.
 */
function glow(id: number, corner: 'chap' | 'ong', color: string): string {
  /*
   * Dogʻ matn ustiga tushmasin: kattaroq qilib, koʻproq chetga va
   * yuqoriga chiqaramiz — faqat burchagi koʻrinib tursin.
   */
  const size = 5600000;
  const x = corner === 'chap' ? -size / 1.7 : W - size / 2.6;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Fon"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${-Math.round(size / 2.2)}"/>
<a:ext cx="${size}" cy="${size}"/></a:xfrm>
<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
<a:solidFill><a:srgbClr val="${color}"><a:alpha val="14000"/></a:srgbClr></a:solidFill>
<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}

function para(text: string, size: number, color: string, opts: { bold?: boolean; bullet?: boolean; align?: string } = {}): string {
  const pPr = opts.bullet
    ? '<a:pPr marL="285750" indent="-285750"><a:buClr><a:srgbClr val="8B7CF6"/></a:buClr><a:buChar char="\u25CF"/></a:pPr>'
    : `<a:pPr algn="${opts.align ?? 'l'}"/>`;
  return `<a:p>${pPr}<a:r><a:rPr lang="uz-UZ" sz="${size}"${opts.bold ? ' b="1"' : ''} dirty="0">
<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

const MARGIN_X = 838200;

/* ------------------------------------------------------------------ */
/*  Maketni tanlash                                                    */
/* ------------------------------------------------------------------ */

/*
 * Avval har bir slayd bir xil edi: sarlavha + punktlar. Shuning uchun
 * taqdimot «matn yozib qoʻyilgan» boʻlib koʻrinardi. Endi mazmunning
 * shakliga qarab maket tanlanadi — raqamlar karta boʻlib chiqadi,
 * taqqoslash ikki ustunga boʻlinadi, qadamlar raqamlangan zanjir
 * boʻladi va hokazo.
 */
type Maket = 'boʻlim' | 'raqam' | 'taqqos' | 'iqtibos' | 'qadam' | 'karta' | 'roʻyxat';

const RANGLAR = ['8B7CF6', '4EC98A', 'F0A93B', '3BA7F0', 'F4655F', '9B8AFB'];

/** «45%» yoki «3.2 mln» kabi boshlanishni ajratadi. */
function raqamlar(text: string): { son: string; izoh: string } | null {
  const m = /^\s*([<>~≈]?\s*[\d][\d\s.,]*\s*(?:%|mln|mlrd|ming|soat|kun|yil|x|×|\$|soʻm)?)\s*[—–:-]?\s*(.*)$/iu.exec(
    text,
  );
  if (!m) return null;
  const son = m[1].trim();
  if (son.length > 10) return null;
  return { son, izoh: m[2].trim() };
}

function juftlik(text: string): [string, string] | null {
  const m = /^(.{2,40}?)\s+[—–]\s+(.+)$/u.exec(text.trim());
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function maketOf(slide: Slide, media?: SlideMedia): Maket {
  const b = slide.bullets.filter((t) => t.trim());
  if (media) return 'roʻyxat';
  if (!b.length) return 'boʻlim';

  // Bitta uzun jumla — iqtibos qilib bersak kuchli koʻrinadi.
  if (b.length === 1 && b[0].length > 60) return 'iqtibos';

  // Yarmidan koʻpi raqam bilan boshlansa — koʻrsatkichlar slaydi.
  const sonlar = b.filter((t) => raqamlar(t)).length;
  if (b.length >= 2 && b.length <= 4 && sonlar >= Math.ceil(b.length / 2)) return 'raqam';

  // «X — Y» juftliklari yoki sarlavhada taqqoslash belgisi.
  const juftlar = b.filter((t) => juftlik(t)).length;
  if (
    /vs\.?|taqqos|farq|qarshi|yaxshi.*yomon|eski.*yangi|oldin.*keyin|ijobiy.*salbiy|afzal.*kamchi/i.test(
      slide.title,
    )
    && b.length >= 2
  ) {
    return 'taqqos';
  }
  if (b.length >= 3 && b.length <= 6 && juftlar >= b.length - 1) return 'karta';

  // Raqamlangan qadamlar — markdown `ol` yoki matnda «1.» boʻlsa.
  if (b.length >= 3 && b.length <= 7 && (slide.ordered || b.every((t) => /^\s*\d+[.)]/.test(t)))) {
    return 'qadam';
  }

  if (b.length >= 3 && b.length <= 6 && b.every((t) => t.length <= 90)) return 'karta';
  return 'roʻyxat';
}

/**
 * Slayd chizish.
 *
 * Maket mazmunga qarab tanlanadi (`maketOf`), shuning uchun taqdimot
 * bir xil punktlar roʻyxatidan iborat boʻlib qolmaydi.
 */
function slideXml(slide: Slide, index: number, media?: SlideMedia, cover = false): string {
  const shapes: string[] = [];
  let id = 10;
  const next = () => (id += 1);
  const urgu = RANGLAR[index % RANGLAR.length];

  if (cover && media) {
    // Muqova: rasm toʻliq, ustida qoraytirgich va katta sarlavha.
    shapes.push(picture(next(), 0, 0, W, H, 'rId2'));
    shapes.push(rect(next(), 0, H - 2600000, W, 2600000, '000000', 0.62));
    shapes.push(
      textBox(next(), 'Sarlavha', MARGIN_X, H - 2050000, W - MARGIN_X * 2, 1500000,
        para(slide.title, 4400, 'FFFFFF', { bold: true })
          + (slide.bullets[0] ? para(slide.bullets[0].slice(0, 120), 1800, 'D6D6DE') : '')),
    );
    return wrapSlide(shapes.join('\n'));
  }

  const maket = maketOf(slide, media);
  const bullets = slide.bullets.filter((t) => t.trim());

  // Fon dogʻi — slaydlar bir-biridan farq qilib tursin.
  shapes.push(glow(next(), index % 2 ? 'chap' : 'ong', urgu));

  /* ---------------- boʻlim ajratkichi ---------------- */
  if (maket === 'boʻlim') {
    shapes.push(rect(next(), MARGIN_X, H / 2 - 260000, 1400000, 90000, urgu));
    shapes.push(
      textBox(next(), 'Sarlavha', MARGIN_X, H / 2 - 100000, W - MARGIN_X * 2, 1600000,
        para(slide.title, 5400, 'FFFFFF', { bold: true })),
    );
    shapes.push(
      textBox(next(), 'Raqam', MARGIN_X, H / 2 - 900000, 2000000, 500000,
        para(String(index + 1).padStart(2, '0'), 2000, urgu, { bold: true })),
    );
    return wrapSlide(shapes.join('\n'));
  }

  /* ---------------- iqtibos ---------------- */
  if (maket === 'iqtibos') {
    shapes.push(
      textBox(next(), 'Tirnoq', MARGIN_X, 900000, 1200000, 1400000,
        para('\u201C', 9000, urgu, { bold: true })),
    );
    shapes.push(
      textBox(next(), 'Matn', MARGIN_X, 2000000, W - MARGIN_X * 2, 3000000,
        para(bullets[0].slice(0, 320), 2800, 'FFFFFF')),
    );
    shapes.push(rect(next(), MARGIN_X, H - 1500000, 700000, 50000, urgu));
    shapes.push(
      textBox(next(), 'Manba', MARGIN_X, H - 1300000, W - MARGIN_X * 2, 500000,
        para(slide.title, 1500, 'A6A6B2')),
    );
    return wrapSlide(shapes.join('\n'));
  }

  // Qolgan maketlarda umumiy sarlavha.
  shapes.push(rect(next(), MARGIN_X, 1050000, 900000, 60000, urgu));
  const textWidth = media ? (W - MARGIN_X * 2) * 0.52 : W - MARGIN_X * 2;
  shapes.push(
    textBox(next(), 'Sarlavha', MARGIN_X, 480000, textWidth, 900000,
      para(slide.title, 3200, 'FFFFFF', { bold: true })),
  );

  const bodyY = 1560000;
  const bodyH = H - bodyY - 800000;
  const bodyW = W - MARGIN_X * 2;

  /* ---------------- koʻrsatkichlar ---------------- */
  if (maket === 'raqam') {
    const n = bullets.length;
    const gap = 260000;
    const cw = Math.round((bodyW - gap * (n - 1)) / n);
    bullets.forEach((text, i) => {
      const parsed = raqamlar(text) ?? { son: '', izoh: text };
      const x = MARGIN_X + i * (cw + gap);
      const color = RANGLAR[(index + i) % RANGLAR.length];
      shapes.push(card(next(), x, bodyY, cw, Math.min(bodyH, 2600000), 'FFFFFF', 0.05, '2A2A32'));
      shapes.push(
        textBox(next(), 'Son', x + 200000, bodyY + 420000, cw - 400000, 1000000,
          para(parsed.son, 5400, color, { bold: true })),
      );
      shapes.push(
        textBox(next(), 'Izoh', x + 200000, bodyY + 1500000, cw - 400000, 900000,
          para(parsed.izoh.slice(0, 90), 1400, 'C9C9D4')),
      );
    });
    shapes.push(nomer(next(), index));
    return wrapSlide(shapes.join('\n'));
  }

  /* ---------------- taqqoslash ---------------- */
  if (maket === 'taqqos') {
    const half = Math.ceil(bullets.length / 2);
    const cols = [bullets.slice(0, half), bullets.slice(half)];
    const gap = 400000;
    const cw = Math.round((bodyW - gap) / 2);
    cols.forEach((items, i) => {
      const x = MARGIN_X + i * (cw + gap);
      const color = i === 0 ? RANGLAR[1] : RANGLAR[4];
      shapes.push(card(next(), x, bodyY, cw, bodyH, 'FFFFFF', 0.05, '2A2A32'));
      shapes.push(rect(next(), x, bodyY, cw, 70000, color));
      // Juftliklar orasida boʻsh qator — aks holda matn qalashib ketadi.
      const body = items
        .map((t) => {
          const j = juftlik(t);
          return j
            ? para(j[0], 1600, color, { bold: true }) + para(j[1].slice(0, 140), 1300, 'C9C9D4')
            : para(t.slice(0, 160), 1400, 'C9C9D4', { bullet: true });
        })
        .join('<a:p><a:pPr/><a:endParaRPr sz="700"/></a:p>');
      shapes.push(
        textBox(next(), 'Ustun', x + 280000, bodyY + 380000, cw - 560000, bodyH - 600000,
          body || '<a:p/>'),
      );
    });
    shapes.push(nomer(next(), index));
    return wrapSlide(shapes.join('\n'));
  }

  /* ---------------- qadamlar ---------------- */
  if (maket === 'qadam') {
    const n = bullets.length;
    const rowH = Math.min(760000, Math.round(bodyH / n));
    bullets.forEach((text, i) => {
      const y = bodyY + i * rowH;
      const color = RANGLAR[(index + i) % RANGLAR.length];
      const clean = text.replace(/^\s*\d+[.)]\s*/, '');
      shapes.push(card(next(), MARGIN_X, y, 520000, 520000, color, 0.18));
      shapes.push(
        textBox(next(), 'Qadam', MARGIN_X, y + 120000, 520000, 400000,
          para(String(i + 1), 1800, color, { bold: true, align: 'ctr' })),
      );
      shapes.push(
        textBox(next(), 'Matn', MARGIN_X + 700000, y + 90000, bodyW - 700000, rowH - 100000,
          para(clean.slice(0, 200), 1600, 'D6D6DE')),
      );
    });
    shapes.push(nomer(next(), index));
    return wrapSlide(shapes.join('\n'));
  }

  /* ---------------- kartalar ---------------- */
  if (maket === 'karta') {
    const n = bullets.length;
    const perRow = n <= 3 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / perRow);
    const gap = 260000;
    const cw = Math.round((bodyW - gap * (perRow - 1)) / perRow);
    const ch = Math.round((bodyH - gap * (rows - 1)) / rows);
    bullets.forEach((text, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const x = MARGIN_X + c * (cw + gap);
      const y = bodyY + r * (ch + gap);
      const color = RANGLAR[(index + i) % RANGLAR.length];
      const j = juftlik(text);
      shapes.push(card(next(), x, y, cw, ch, 'FFFFFF', 0.05, '2A2A32'));
      shapes.push(rect(next(), x + 280000, y + 280000, 340000, 60000, color));
      const body = j
        ? para(j[0], 1700, 'FFFFFF', { bold: true }) + para(j[1].slice(0, 160), 1300, 'B8B8C4')
        : para(text.slice(0, 180), 1500, 'D6D6DE');
      shapes.push(
        textBox(next(), 'Karta', x + 280000, y + 500000, cw - 560000, ch - 700000, body),
      );
    });
    shapes.push(nomer(next(), index));
    return wrapSlide(shapes.join('\n'));
  }

  /* ---------------- oddiy roʻyxat (rasm bilan yoki rasmsiz) ---------------- */
  const list = bullets
    .slice(0, media ? 5 : 8)
    .map((t) => para(t.slice(0, media ? 150 : 220), media ? 1600 : 1800, 'D6D6DE', { bullet: true }))
    .join('');
  shapes.push(textBox(next(), 'Matn', MARGIN_X, bodyY, textWidth, bodyH, list || '<a:p/>'));

  if (media) {
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
    shapes.push(picture(next(), boxX + (boxW - cx) / 2, boxY + (boxH - cy) / 2, cx, cy, 'rId2'));
    if (slide.caption?.trim()) {
      shapes.push(
        textBox(next(), 'Izoh', boxX, boxY + boxH + 60000, boxW, 320000,
          para(slide.caption.slice(0, 90), 1100, '8A8A96', { align: 'ctr' })),
      );
    }
  }

  shapes.push(nomer(next(), index));
  return wrapSlide(shapes.join('\n'));
}

/** Sahifa raqami — oʻng pastda. */
function nomer(id: number, index: number): string {
  return textBox(id, 'Raqam', W - 1400000, H - 700000, 800000, 400000,
    para(String(index + 1), 1200, '6A6A76', { align: 'r' }));
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
