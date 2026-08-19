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

/* ---------- Tashqi AI provayderlar ---------- */

export interface ProviderConfig {
  /** 'openrouter', 'moonshot', 'custom_ab12' … */
  id: string;
  label: string;
  /** OpenAI-mos manzil, masalan https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  /** Roʻyxat olinmasa qoʻlda kiritilgan model nomlari */
  manual: string[];
}

/**
 * Koʻp agentli ishda kim qaysi model bilan ishlaydi.
 * Boʻsh boʻlsa — asosiy model.
 */
export interface RoleModels {
  /** Reja tuzuvchi / bosh agent */
  bosh: string;
  /** Dizayner — koʻrinish va uslub */
  dizayn: string;
  /** Kod yozuvchi */
  kod: string;
  /** Tekshiruvchi / xatolarni topuvchi */
  tekshir: string;
  /** Matn yozuvchi (kitob, hujjat) */
  matn: string;
}

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
  /** Supabase loyihasi manzili: https://xxxx.supabase.co */
  supabaseUrl: string;
  /** Supabase ochiq (anon) kaliti — brauzerga chiqarish uchun moʻljallangan */
  supabaseAnonKey: string;
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
  /** Ulangan tashqi AI provayderlar (OpenRouter, Kimi, Qwen…) */
  providers: ProviderConfig[];
  /** Foydalanuvchi oʻchirib qoʻygan modellar — roʻyxatlarda koʻrinmaydi */
  hiddenModels: string[];
  /** Tez tanlash uchun belgilangan modellar */
  favoriteModels: string[];
  /** Koʻp agentli ishda rollar boʻyicha modellar */
  roleModels: RoleModels;
  /** Kuchsiz model javobni kesib qoʻysa — avtomatik davom ettirish */
  autoContinue: boolean;
  /** Bitta javob uchun koʻpi bilan nechta davom ettirish */
  maxContinues: number;
  /** Code agenti uchun qadamlar chegarasi */
  agentRounds: number;
  /**
   * AVTO rejim: Daho har vazifaga oʻzi mos model tanlaydi (rollarga
   * biriktirilgan modellar va imkoniyatlarga qarab). Oʻchirilgan boʻlsa
   * hamma joyda faqat asosiy model ishlatiladi.
   */
  autoPickModel: boolean;
  /**
   * Avto rejim faqat shu modellardan tanlaydi. Boʻsh boʻlsa — oʻchirilmagan
   * barcha modellar ichidan.
   */
  autoPool: string[];
  /** Suhbatlardan foydalanuvchi haqidagi faktlarni oʻzi eslab qolsinmi */
  memoryEnabled: boolean;
  /**
   * FAQAT BEPUL rejim: Avto tanlov, zaxira model va tanlash roʻyxatlari
   * faqat bepul modellar bilan cheklanadi. Pul sarflanmasligiga kafolat.
   */
  freeOnly: boolean;
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
  /** Darslarga rasm chizilsinmi (foydalanuvchi roziligi bilan) */
  illustrated?: boolean;
  createdAt: number;
}

/* ---------- Video ---------- */

export interface SubtitleStyle {
  /** Subtitr videoga yozilsinmi (oʻchirilsa faqat rasm va ovoz qoladi) */
  enabled?: boolean;
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
  /** Diktor va subtitr tili — «Qayta tarjima» shuni oʻzgartiradi */
  language?: string;
  /** Render natijasi — obyekt URL emas, base64 webm */
  outputMime?: string;
  /** Faylni qaysi kengaytma bilan saqlash kerak */
  outputExt?: 'mp4' | 'webm';
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

/** Loyihaning saqlangan holati — orqaga qaytarish uchun. */
export interface CodeSnapshot {
  id: string;
  at: number;
  /** Nima qilinishidan oldin olingani */
  label: string;
  files: CodeFile[];
  plan?: ProjectStep[];
}

export interface CodeProject {
  id: string;
  name: string;
  description: string;
  /** Shu loyiha uchun tanlangan model (boʻsh boʻlsa umumiy sozlama) */
  model?: string;
  /** Agentning koʻrinadigan reja roʻyxati — nima qilingan, nima qolgan */
  plan?: ProjectStep[];
  /** Loyiha talablari — savol-javobdan chiqqan xulosa */
  spec?: string;
  /** Oxirgi nusxalar — agent buzib qoʻysa qaytish uchun */
  history?: CodeSnapshot[];
  /** Qaysi shablondan yaratilgan */
  template: string;
  files: CodeFile[];
  messages: Message[];
  repo?: { owner: string; repo: string; branch: string };
  publish?: { url: string; domain?: string; at: number };
  createdAt: number;
  updatedAt: number;
}

export interface BrowserVisit {
  url: string;
  at: number;
}

/* ---------- Kitob ---------- */

export type BookStage =
  | 'soʻrov' // savol-javob bosqichi
  | 'reja' // konsepsiya va tuzilma tayyorlanmoqda
  | 'muqova' // muqova chizilmoqda
  | 'yozilmoqda' // boblar yozilmoqda
  | 'tayyor'
  | 'xato';

export interface BookChapter {
  id: string;
  number: number;
  title: string;
  /** Rejadagi qisqacha mazmun — yozishdan oldin */
  brief: string;
  /** Yozilgan toʻliq matn (markdown) */
  text: string;
  /** Yozilgach chiqarilgan xulosa — keyingi boblar izchil boʻlishi uchun */
  recap: string;
  /** Bob ichidagi rasm (artifact id) */
  imageArtifactId?: string;
  words: number;
  done: boolean;
}

/**
 * «Kitob kitobi» — izchillikni saqlaydigan yagona haqiqat manbasi.
 * Har bir bob yozilishidan oldin modelga shu beriladi, shuning uchun
 * qahramonlar, atamalar va ohang oxirigacha bir xil qoladi.
 */
export interface BookBible {
  /** Bir jumlada — kitob nima haqida */
  premise: string;
  /** Kim uchun yozilyapti */
  audience: string;
  /** Ohang va uslub */
  tone: string;
  /** Qahramonlar yoki asosiy shaxslar (badiiy boʻlmasa — asosiy tushunchalar) */
  cast: Array<{ name: string; role: string; detail: string }>;
  /** Muhit, davr, joy */
  setting: string;
  /** Kitob boʻylab bir xil ishlatiladigan atamalar */
  glossary: Array<{ term: string; meaning: string }>;
  /** Rasm va muqova uchun yagona vizual uslub */
  visualStyle: string;
  /** Qatʼiy qoidalar — model buzmasligi kerak */
  rules: string[];
}

export interface Book {
  id: string;
  title: string;
  subtitle: string;
  /** Foydalanuvchining dastlabki soʻrovi */
  request: string;
  kind: string; // 'badiiy', 'oʻquv qoʻllanma', 'biznes'…
  language: string;
  stage: BookStage;
  bible: BookBible;
  chapters: BookChapter[];
  /** Muqova rasmi (artifact id) */
  coverArtifactId?: string;
  /** Har bobda taxminan nechta soʻz */
  wordsPerChapter: number;
  /** Boblarga rasm qoʻshilsinmi */
  withImages: boolean;
  chatId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/* ---------- Avtomatlashtirish ---------- */

export interface Automation {
  id: string;
  title: string;
  /** Har safar yuboriladigan topshiriq */
  prompt: string;
  /** HH:MM — qurilma vaqti boʻyicha */
  time: string;
  /** 0=Dushanba … 6=Yakshanba; boʻsh boʻlsa har kuni */
  days: number[];
  enabled: boolean;
  /** Natija qayerga tushadi */
  target: 'chat' | 'kod';
  /** target='kod' boʻlsa loyiha id si */
  projectId?: string;
  /** Har safar yangi suhbat ochilsinmi yoki bitta suhbatda davom etsinmi */
  freshChat: boolean;
  /** Shu avtomatlashtirish uchun ajratilgan suhbat */
  chatId?: string;
  /** Ixtiyoriy model — boʻsh boʻlsa asosiy */
  model?: string;
  lastRunAt?: number;
  lastResult?: string;
  lastOk?: boolean;
  createdAt: number;
}

/** Daho foydalanuvchi haqida eslab qolgan doimiy fakt. */
export interface Memory {
  id: string;
  text: string;
  /** Qayerdan olingani: suhbatdan avtomatik yoki qoʻlda kiritilgan */
  source: 'suhbat' | 'qoʻlda';
  createdAt: number;
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
  books: Book[];
  /** Ilova ichidagi brauzer tarixi */
  browserHistory: BrowserVisit[];
  automations: Automation[];
  /** Daho foydalanuvchi haqida eslab qolganlari */
  memories: Memory[];
  /** Oxirgi koʻrilgan ekran — ilova qayta ochilganda oʻsha joydan davom etadi */
  view: ViewState;
}

/**
 * Interfeys holati. Buni store da saqlaymiz, chunki komponent ichida
 * saqlansa boʻlim almashganda hamma narsa qaytadan boshlanadi.
 */
export interface ViewState {
  tab: 'chat' | 'agent' | 'kod';
  section: string;
  /** Ochiq kurs / kitob / loyiha id lari */
  courseId: string | null;
  bookId: string | null;
  codeId: string | null;
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
