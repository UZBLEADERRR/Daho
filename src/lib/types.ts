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
  /** Javob matnining qaysi belgisidan keyin bajarilgani — tartibda koʻrsatish uchun */
  at?: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  /** Ushbu xabar davomida yaratilgan artifact id lari */
  artifactIds?: string[];
  toolCalls?: ToolCallRecord[];
  /** Shu xabar ochgan video loyihasi */
  videoId?: string;
  /** Shu xabardan saqlangan mini ilova */
  appId?: string;
  /** Shu xabar ochgan yoʻl (jonli kuzatuv kartasi) */
  routeId?: string;
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

export type ArtifactKind = 'html' | 'code' | 'image' | 'markdown' | 'audio';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** html/code/markdown uchun matn; image va audio uchun base64 */
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

export type Engine = 'gemini' | 'qurilma';

export type AiSource = 'auto' | 'byok' | 'cloud';

export interface Settings {
  apiKey: string;
  model: string;
  imageModel: string;
  ttsModel: string;
  theme: ThemeName;
  /** Urgʻu rangi (hex) */
  accent: string;
  /** Interfeys shrift oʻlchami koeffitsienti */
  fontScale: number;
  temperature: number;
  autoSpeak: boolean;
  /** 'gemini' — tabiiy ovoz, 'qurilma' — tizim sintezatori */
  ttsEngine: Engine;
  ttsVoice: string;
  ttsLang: string;
  ttsRate: number;
  ttsVoiceUri: string;
  sttEngine: Engine;
  sttLang: string;
  /** GitHub shaxsiy tokeni — faqat shu qurilmada saqlanadi */
  githubToken: string;
  /** Nashr uchun oʻz domeningiz (ixtiyoriy) */
  publishDomain: string;
  /**
   * AI qayerdan ishlaydi:
   *   'auto'  — kalit boʻlsa oʻzinikidan, boʻlmasa obunadan
   *   'byok'  — faqat oʻz API kaliti
   *   'cloud' — faqat Daho Cloud obunasi
   */
  aiSource: AiSource;
  /** Maʼlumotlar bulutga sinxronlansinmi */
  cloudBackup: boolean;
  userName: string;
  university: string;
  customInstructions: string;
}

/* ---------- Mini ilovalar ---------- */

export interface MiniApp {
  id: string;
  name: string;
  icon: string; // emoji
  description: string;
  /** Ichki ilova uchun HTML; havolali ilovada boʻsh */
  html: string;
  /** Tashqi havola bilan qoʻshilgan ilova */
  url?: string;
  /** Sayt iframe’da ochilishni taqiqlaydi — brauzerda ochiladi */
  external?: boolean;
  createdAt: number;
  updatedAt: number;
  opens: number;
}

/* ---------- Yoʻl va joylashuv ---------- */

export interface RoutePlan {
  id: string;
  /** Boriladigan joy nomi */
  destination: string;
  address?: string;
  lat?: number;
  lon?: number;
  mode: 'transit' | 'walking' | 'driving' | 'bicycling';
  /** Telefondagi xarita ilovasida ochish havolasi */
  mapsUrl: string;
  createdAt: number;
}

/* ---------- Kurslar ---------- */

export interface CourseTopic {
  id: string;
  title: string;
  summary: string;
  /** Tayyorlangan dars artifact id si (bosilgach yaratiladi) */
  lessonArtifactId?: string;
  done: boolean;
}

export interface Course {
  id: string;
  title: string;
  field: string;
  goal: string;
  level: string;
  topics: CourseTopic[];
  createdAt: number;
}

/* ---------- Video ---------- */

export interface SubtitleStyle {
  font: string;
  size: number;
  color: string;
  stroke: string;
  strokeWidth: number;
  background: string;
  position: 'past' | 'orta' | 'yuqori';
  uppercase: boolean;
}

export interface VideoCharacter {
  id: string;
  name: string;
  /** Tashqi koʻrinish tavsifi — sahna rasmlarida ishlatiladi */
  look: string;
  voiceId: string;
  /** Ixtiyoriy tayanch rasm (base64) */
  refImage?: string;
}

export interface VideoScene {
  id: string;
  /** Ekранda eshitiladigan matn (ovoz va subtitr) */
  narration: string;
  /** Rasm uchun tasvir soʻrovi */
  imagePrompt: string;
  imageData?: string;
  imageMime?: string;
  audioWav?: string;
  durationSec: number;
  characterId?: string;
}

export type VideoStage =
  | 'reja'
  | 'ssenariy'
  | 'sahnalar'
  | 'rasmlar'
  | 'ovoz'
  | 'tayyor'
  | 'render'
  | 'yakunlandi';

export interface VideoProject {
  id: string;
  chatId?: string;
  topic: string;
  title: string;
  stage: VideoStage;
  aspect: '9:16' | '16:9' | '1:1';
  style: string;
  voiceId: string;
  scenes: VideoScene[];
  characters: VideoCharacter[];
  subtitle: SubtitleStyle;
  /** Render natijasi — obyekt URL emas, base64 webm */
  outputMime?: string;
  outputSize?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Daho Code ---------- */

export interface CodeFile {
  path: string;
  content: string;
}

export interface CodeProject {
  id: string;
  name: string;
  description: string;
  /** Shu loyiha uchun tanlangan model (boʻsh boʻlsa umumiy sozlama) */
  model?: string;
  /** Qaysi shablondan yaratilgan */
  template: string;
  files: CodeFile[];
  messages: Message[];
  repo?: { owner: string; repo: string; branch: string };
  publish?: { url: string; domain?: string; at: number };
  createdAt: number;
  updatedAt: number;
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
  apps: MiniApp[];
  courses: Course[];
  videos: VideoProject[];
  code: CodeProject[];
  routes: RoutePlan[];
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
