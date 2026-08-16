/**
 * Ilovaning oʻz qiyofasi — nomi va ikonkasi.
 *
 * Android ikonkasi va ilova nomi APK ichida boʻladi, ularni ishlab turgan
 * ilovadan turib oʻzgartirib boʻlmaydi. Shuning uchun boshqacha yoʻl tutamiz:
 * tanlangan rasmdan barcha oʻlchamdagi ikonkalarni telefonning oʻzida yasaymiz,
 * ularni GitHub’dagi Daho repozitoriysiga yozamiz va APK yigʻishni ishga
 * tushiramiz. Bir necha daqiqadan soʻng yangi nom va ikonkali APK tayyor.
 */

import { commitFiles, dispatchWorkflow, readFile, type CommitFile } from './github';
import { getState } from './store';

/** Android zichliklari: [papka, oddiy ikonka, adaptiv old qatlam] */
const DENSITIES: Array<[string, number, number]> = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

const RES = 'android/app/src/main/res';
const WORKFLOW = 'android.yml';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasmni oʻqib boʻlmadi'));
    img.src = src;
  });
}

function toPngBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

/** Rasmni kvadratga «cover» qilib chizadi — chetlari kesiladi, markazi qoladi. */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, size: number): void {
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}

function square(img: HTMLImageElement, size: number, round: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas ishlamadi');
  if (round) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }
  cover(ctx, img, size);
  return toPngBase64(canvas);
}

/** Tanlangan rasmdan barcha ikonka fayllarini yasaydi. */
export async function buildIconFiles(dataUrl: string): Promise<CommitFile[]> {
  const img = await loadImage(dataUrl);
  const files: CommitFile[] = [];
  for (const [density, legacy, adaptive] of DENSITIES) {
    files.push(
      { path: `${RES}/mipmap-${density}/ic_launcher.png`, content: square(img, legacy, false), base64: true },
      { path: `${RES}/mipmap-${density}/ic_launcher_round.png`, content: square(img, legacy, true), base64: true },
      {
        path: `${RES}/mipmap-${density}/ic_launcher_foreground.png`,
        content: square(img, adaptive, false),
        base64: true,
      },
    );
  }
  // Adaptiv ikonka rasmni old qatlam sifatida ishlatsin.
  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  files.push(
    { path: `${RES}/mipmap-anydpi-v26/ic_launcher.xml`, content: adaptiveXml },
    { path: `${RES}/mipmap-anydpi-v26/ic_launcher_round.xml`, content: adaptiveXml },
  );
  return files;
}

/** Ilova nomini oʻzgartiruvchi strings.xml ni tayyorlaydi. */
async function nameFile(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  name: string,
): Promise<CommitFile> {
  const path = `${RES}/values/strings.xml`;
  const xml = await readFile(token, owner, repo, path, branch);
  const clean = name.trim().slice(0, 30).replace(/[<>&"]/g, '');
  const next = xml
    .replace(
      /(<string name="app_name">)[^<]*(<\/string>)/,
      (_m, a: string, b: string) => `${a}${clean}${b}`,
    )
    .replace(
      /(<string name="title_activity_main">)[^<]*(<\/string>)/,
      (_m, a: string, b: string) => `${a}${clean}${b}`,
    );
  if (next === xml) throw new Error('strings.xml oʻqilmadi — nomni oʻzgartirib boʻlmadi');
  return { path, content: next };
}

export interface LookResult {
  /** Yigʻilish sahifasi */
  runsUrl: string;
  commit: string;
}

/**
 * Yangi nom va/yoki ikonkani repozitoriyga yozadi va APK yigʻishni boshlaydi.
 * `repo` berilmasa loyihalardan «Daho» repozitoriysi qidiriladi.
 */
export async function applyAppLook(options: {
  name?: string;
  iconDataUrl?: string;
  repo: { owner: string; repo: string; branch: string };
}): Promise<LookResult> {
  const { settings } = getState();
  const token = settings.githubToken;
  if (!token) throw new Error('GitHub token kerak — Sozlamalardan kiriting');
  const { owner, repo, branch } = options.repo;

  const files: CommitFile[] = [];
  if (options.iconDataUrl) files.push(...(await buildIconFiles(options.iconDataUrl)));
  if (options.name?.trim()) files.push(await nameFile(token, owner, repo, branch, options.name));
  if (!files.length) throw new Error('Oʻzgartirish uchun nom yoki rasm tanlang');

  const result = await commitFiles(
    token,
    owner,
    repo,
    branch,
    `Daho: ilova qiyofasi yangilandi${options.name ? ` (${options.name.trim()})` : ''}`,
    files,
  );

  // Push’ning oʻzi ham yigʻishni boshlaydi; dispatch qoʻshimcha kafolat.
  try {
    await dispatchWorkflow(token, owner, repo, WORKFLOW, branch);
  } catch {
    /* ish oqimi push orqali baribir ishga tushadi */
  }

  return {
    runsUrl: `https://github.com/${owner}/${repo}/actions`,
    commit: result.sha.slice(0, 7),
  };
}
