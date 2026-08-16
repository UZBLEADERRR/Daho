export type Role = 'user' | 'model';

export interface Attachment {
  mimeType: string;
  /** base64, prefikssiz */
  data: string;
  name?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  /** Ushbu xabar davomida yaratilgan artifact id lari */
  artifactIds?: string[];
  toolCalls?: ToolCallRecord[];
  createdAt: number;
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type ArtifactKind = 'html' | 'code' | 'image' | 'markdown';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** html/code/markdown uchun matn; image uchun base64 */
  content: string;
  lang?: string;
  mimeType?: string;
  chatId?: string;
  createdAt: number;
  pinned?: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  subject: string;
  createdAt: number;
  updatedAt: number;
}

export type Priority = 'past' | 'orta' | 'yuqori';

export interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: Priority;
  due?: string; // YYYY-MM-DD
  projectId?: string;
  createdAt: number;
}

export interface ProjectStep {
  id: string;
  title: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'reja' | 'jarayonda' | 'tugallandi';
  steps: ProjectStep[];
  createdAt: number;
}

export interface ScheduleItem {
  id: string;
  /** 0 = Dushanba ... 6 = Yakshanba */
  day: number;
  start: string; // HH:MM
  end: string; // HH:MM
  subject: string;
  room?: string;
  teacher?: string;
  kind?: 'maruza' | 'amaliyot' | 'lab' | 'boshqa';
}

export interface TimeLog {
  id: string;
  label: string;
  projectId?: string;
  start: number;
  end?: number;
  note?: string;
}

export type ThemeName = 'tun' | 'kun';

export interface Settings {
  apiKey: string;
  model: string;
  imageModel: string;
  theme: ThemeName;
  temperature: number;
  autoSpeak: boolean;
  ttsLang: string;
  ttsRate: number;
  ttsVoiceUri: string;
  sttLang: string;
  userName: string;
  university: string;
  customInstructions: string;
}

export interface AppState {
  version: number;
  settings: Settings;
  chats: Chat[];
  activeChatId: string | null;
  artifacts: Artifact[];
  notes: Note[];
  tasks: Task[];
  projects: Project[];
  schedule: ScheduleItem[];
  timeLogs: TimeLog[];
}

export const DAYS = [
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
  'Yakshanba',
] as const;

export const DAYS_SHORT = ['Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha', 'Yak'] as const;
