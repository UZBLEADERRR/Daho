/**
 * Nusxa va orqaga qaytarish.
 *
 * Agent fayllarni qayta yozadi. Ishlab turgan loyihani buzib qoʻysa,
 * qaytish yoʻli boʻlishi kerak — aks holda agentga topshiriq berish
 * qoʻrqinchli boʻladi.
 *
 * Har ishga tushishdan oldin fayllarning holati saqlanadi. Foydalanuvchi
 * bir bosishda oʻsha holatga qaytadi.
 *
 * Telefon xotirasi cheklangan (localStorage odatda 5 MB), shuning uchun:
 *  - koʻpi bilan {@link MAX_SNAPSHOTS} ta nusxa saqlanadi;
 *  - umumiy hajm {@link MAX_BYTES} dan oshsa eng eskisi oʻchiriladi;
 *  - fayllar oʻzgarmagan boʻlsa yangi nusxa olinmaydi.
 */

import { getCodeProject, patchCodeProject } from './codeproject';
import type { CodeFile, CodeSnapshot } from './types';
import { uid } from './utils';

const MAX_SNAPSHOTS = 8;
const MAX_BYTES = 900_000;

function sizeOf(files: CodeFile[]): number {
  return files.reduce((sum, f) => sum + f.path.length + f.content.length, 0);
}

/** Ikkita fayl roʻyxati bir xilmi? */
function same(a: CodeFile[], b: CodeFile[]): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(b.map((f) => [f.path, f.content]));
  return a.every((f) => map.get(f.path) === f.content);
}

/**
 * Loyihaning hozirgi holatini saqlaydi.
 * Oʻzgarish boʻlmagan boʻlsa yangi nusxa olinmaydi.
 */
export function snapshot(projectId: string, label: string): CodeSnapshot | null {
  const project = getCodeProject(projectId);
  if (!project) return null;

  const history = project.history ?? [];
  const last = history[0];
  if (last && same(last.files, project.files)) return null;

  const entry: CodeSnapshot = {
    id: uid('snap_'),
    at: Date.now(),
    label: label.trim().slice(0, 80) || 'oʻzgarishdan oldin',
    files: project.files.map((f) => ({ ...f })),
    plan: project.plan?.map((s) => ({ ...s })),
  };

  // Yangisi boshida; soni va hajmi boʻyicha eskisini kesamiz.
  let next = [entry, ...history].slice(0, MAX_SNAPSHOTS);
  while (next.length > 1 && next.reduce((sum, s) => sum + sizeOf(s.files), 0) > MAX_BYTES) {
    next = next.slice(0, -1);
  }

  patchCodeProject(projectId, { history: next });
  return entry;
}

/**
 * Nusxaga qaytaradi. Qaytarishdan oldin hozirgi holat ham saqlanadi —
 * shuning uchun «qaytarishni qaytarish» ham mumkin.
 */
export function restore(projectId: string, snapshotId: string): boolean {
  const project = getCodeProject(projectId);
  const target = project?.history?.find((s) => s.id === snapshotId);
  if (!project || !target) return false;

  // Hozirgi holatni yoʻqotmaymiz.
  snapshot(projectId, 'qaytarishdan oldingi holat');

  patchCodeProject(projectId, {
    files: target.files.map((f) => ({ ...f })),
    plan: target.plan?.map((s) => ({ ...s })),
  });
  return true;
}

export function deleteSnapshot(projectId: string, snapshotId: string): void {
  const project = getCodeProject(projectId);
  if (!project) return;
  patchCodeProject(projectId, {
    history: (project.history ?? []).filter((s) => s.id !== snapshotId),
  });
}

export function clearHistory(projectId: string): void {
  patchCodeProject(projectId, { history: [] });
}

/** Nusxa hozirgi holatdan nimasi bilan farq qiladi. */
export function describeDiff(projectId: string, snapshotId: string): string {
  const project = getCodeProject(projectId);
  const target = project?.history?.find((s) => s.id === snapshotId);
  if (!project || !target) return '';

  const now = new Map(project.files.map((f) => [f.path, f.content]));
  const then = new Map(target.files.map((f) => [f.path, f.content]));

  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];

  for (const [path, content] of now) {
    if (!then.has(path)) added.push(path);
    else if (then.get(path) !== content) changed.push(path);
  }
  for (const path of then.keys()) if (!now.has(path)) removed.push(path);

  const parts: string[] = [];
  // «Qaytarsam nima boʻladi» nuqtai nazaridan yozamiz.
  if (added.length) parts.push(`${added.length} ta yangi fayl oʻchadi`);
  if (changed.length) parts.push(`${changed.length} ta fayl eski holatiga qaytadi`);
  if (removed.length) parts.push(`${removed.length} ta oʻchirilgan fayl tiklanadi`);
  return parts.join(' · ') || 'farq yoʻq';
}
