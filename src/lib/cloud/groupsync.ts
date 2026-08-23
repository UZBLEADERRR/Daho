/**
 * Guruh loyihasini sinxronlash.
 *
 * Guruh ochilgan loyiha endi bitta odamniki emas: fayllar hammaga
 * bir xil koʻrinishi kerak. Shu sabab ikki yoʻnalish:
 *
 *   TORTISH — har necha soniyada bazadagi versiya tekshiriladi.
 *     U bizdagidan yangi boʻlsa fayllar oʻrniga qoʻyiladi.
 *   ITARISH — oʻzimiz oʻzgartirsak, biroz kutib (bir necha tugma
 *     bosilishini birlashtirib) yoziladi.
 *
 * Toʻqnashuvda BAZA ustun: kimdir ulgurgan boʻlsa uniki olinadi va
 * bizdagi oʻzgarish yoʻqolmasin uchun darhol qaytadan yoziladi.
 * Bu «oxirgi yozgan yutadi» qoidasi — kichik jamoa uchun yetarli va
 * odam uchun tushunarli.
 */
import { patchCodeProject } from '../codeproject';
import { getState } from '../store';
import type { CodeFile, CodeProject } from '../types';
import { loadGroupProject, saveGroupProject } from './groups';

/** Bazaga yoziladigan qism — suhbat va tarix yuborilmaydi (ogʻir). */
interface Umumiy {
  name: string;
  description: string;
  template: string;
  spec?: string;
  files: CodeFile[];
}

function ulush(p: CodeProject): Umumiy {
  return {
    name: p.name,
    description: p.description,
    template: p.template,
    spec: p.spec,
    files: p.files,
  };
}

/** Fayllar bir xilmi — keraksiz yozuvni oldini oladi. */
function birXil(a: Umumiy, b: Partial<Umumiy> | undefined): boolean {
  if (!b) return false;
  return JSON.stringify(a) === JSON.stringify({
    name: b.name,
    description: b.description,
    template: b.template,
    spec: b.spec,
    files: b.files,
  });
}

const versiyalar = new Map<string, number>();

/** Bazadagini olib, yangiroq boʻlsa mahalliy loyihaga qoʻyadi. */
export async function pullGroup(project: CodeProject): Promise<void> {
  if (!project.groupId) return;
  const uzoq = await loadGroupProject(project.groupId).catch(() => null);
  if (!uzoq) return;

  const bizda = versiyalar.get(project.groupId) ?? 0;
  if (uzoq.version <= bizda) return;
  versiyalar.set(project.groupId, uzoq.version);

  const manba = (uzoq.project ?? {}) as Partial<Umumiy>;
  if (!Array.isArray(manba.files)) return;
  if (birXil(ulush(project), manba)) return;

  patchCodeProject(project.id, {
    files: manba.files,
    ...(manba.name ? { name: manba.name } : {}),
    ...(manba.description !== undefined ? { description: manba.description } : {}),
    ...(manba.spec !== undefined ? { spec: manba.spec } : {}),
  });
}

/**
 * Bazaga yozadi. Toʻqnashuvda uzoqdagini olib, ustiga qaytadan
 * yozamiz — shunda ikki tomonning ishi ham yoʻqolmaydi.
 */
export async function pushGroup(project: CodeProject): Promise<void> {
  if (!project.groupId) return;
  const gid = project.groupId;

  const out = await saveGroupProject(gid, ulush(project) as unknown as Record<string, unknown>,
    versiyalar.get(gid));

  if (out.conflict) {
    versiyalar.set(gid, Number(out.version ?? 0));
    // Eng yangi holatni olib, yana bir marta yozamiz.
    const yangi = getState().code.find((p) => p.id === project.id);
    if (!yangi) return;
    const qayta = await saveGroupProject(gid, ulush(yangi) as unknown as Record<string, unknown>,
      versiyalar.get(gid));
    if (qayta.version) versiyalar.set(gid, qayta.version);
    return;
  }

  if (out.version) versiyalar.set(gid, out.version);
}
