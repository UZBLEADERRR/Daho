/**
 * Model nomini koʻrsatish — bitta joydan.
 *
 * «Dahonator» ortida qaysi provayder modeli turgani sotuv siri.
 * Shuning uchun ekranda hech qayerda `openai/gpt-…`, `mistralai/…`
 * kabi haqiqiy nomlar chiqmasligi kerak: na yuqoridagi chipda, na
 * rollar qatorida, na sarf hisobotida.
 *
 * Admin uchun esa aksincha — u haqiqiy nomni koʻrishi kerak, aks
 * holda qaysi modelni ulaganini bilmaydi.
 */
import { accountSnapshot } from './cloud/account';
import { cloudEnabled } from './cloud/config';

let nomlar: Record<string, string> = {};

/** Katalogdan kelgan «slug → koʻrinadigan nom» juftliklari. */
export function noteCatalogNames(rows: Array<{ slug: string; label: string }>): void {
  nomlar = Object.fromEntries(rows.map((r) => [r.slug, r.label]));
}

/** Katalogda shu model bormi (nomi bilan). */
export function catalogLabel(ref: string): string {
  const slug = String(ref || '').split('/').pop() ?? '';
  return nomlar[ref] ?? nomlar[slug] ?? '';
}

/** Ishlab chiquvchimi — haqiqiy nomlarni koʻrsatsa boʻladimi. */
export function canSeeRawModels(): boolean {
  if (!cloudEnabled) return true;
  const hisob = accountSnapshot();
  return Boolean(hisob?.is_admin);
}

/**
 * Ekranda koʻrsatiladigan nom.
 *
 * Tartib: katalogdagi Daho nomi → (admin boʻlsa) qisqartirilgan
 * haqiqiy nom → «Daho». Oddiy foydalanuvchi hech qachon provayder
 * nomini koʻrmaydi.
 */
export function displayModel(ref: string): string {
  const label = catalogLabel(ref);
  if (label) return label;
  if (!ref) return 'Avto';
  if (canSeeRawModels()) {
    return (String(ref).split('/').pop() ?? '').replace(/^gemini-/, '') || 'Avto';
  }
  return 'Daho';
}
