export const AGENT_SECTIONS = [
  'bugun',
  'jadval',
  'vazifalar',
  'loyihalar',
  'konspekt',
  'vaqt',
  'artifact',
] as const;

export type AgentSection = (typeof AGENT_SECTIONS)[number];

export const SECTION_LABEL: Record<AgentSection, string> = {
  bugun: 'Bugun',
  jadval: 'Jadval',
  vazifalar: 'Vazifalar',
  loyihalar: 'Loyihalar',
  konspekt: 'Konspekt',
  vaqt: 'Ish vaqti',
  artifact: 'Artifactlar',
};
