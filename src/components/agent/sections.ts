export const AGENT_SECTIONS = [
  'bugun',
  'kurslar',
  'ilovalar',
  'kod',
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
  kurslar: 'Kurslar',
  ilovalar: 'Ilovalarim',
  kod: 'Daho Code',
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
  kurslar: '🎓',
  ilovalar: '🧩',
  kod: '⌨️',
  jadval: '📅',
  vazifalar: '✅',
  loyihalar: '📁',
  konspekt: '📝',
  vaqt: '⏱',
  videolar: '🎬',
  artifact: '🗂',
};
