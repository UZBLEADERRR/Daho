export const AGENT_SECTIONS = [
  'bugun',
  'kitoblar',
  'kurslar',
  'avto',
  'ulanish',
  'ilovalar',
  'jadval',
  'vazifalar',
  'loyihalar',
  'konspekt',
  'vaqt',
  'videolar',
  'artifact',
] as const;

export type AgentSection = (typeof AGENT_SECTIONS)[number];

export const SECTION_LABEL: Record<AgentSection, string> = {
  bugun: 'Bugun',
  kitoblar: 'Kitoblar',
  kurslar: 'Kurslar',
  avto: 'Avto',
  ulanish: 'Ulanishlar',
  ilovalar: 'Ilovalarim',
  jadval: 'Jadval',
  vazifalar: 'Vazifalar',
  loyihalar: 'Loyihalar',
  konspekt: 'Konspekt',
  vaqt: 'Ish vaqti',
  videolar: 'Videolar',
  artifact: 'Artifactlar',
};

export const SECTION_EMOJI: Record<AgentSection, string> = {
  bugun: '✨',
  kitoblar: '📚',
  kurslar: '🎓',
  avto: '🔁',
  ulanish: '🔌',
  ilovalar: '🧩',
  jadval: '📅',
  vazifalar: '✅',
  loyihalar: '📁',
  konspekt: '📝',
  vaqt: '⏱',
  videolar: '🎬',
  artifact: '🗂',
};

/** Boʻlim nomi haqiqiy boʻlimmi (saqlangan holatni tekshirish uchun). */
export function isSection(value: string): value is AgentSection {
  return (AGENT_SECTIONS as readonly string[]).includes(value);
}
