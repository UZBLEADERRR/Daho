/*
 * Vositalarni tanlash — tokenni tejashning eng katta yeri.
 *
 * Muammo: 29 ta vosita eʼloni birga ~6 300 token. Tizim koʻrsatmasi
 * yana ~4 600. Yaʼni «salom» deb yozilganda ham 11 000 token ketardi,
 * agent sikli esa buni HAR QADAMDA qayta yuborardi. Bir suhbat
 * yuz minglab tokenga tushardi.
 *
 * Yechim: har doim faqat YADRO vositalari yuboriladi. Qolganlari
 * guruhlarga ajratilgan va ikki yoʻl bilan ochiladi:
 *   1. Foydalanuvchi soʻzidan tushunib (masalan «telegram» deyilsa);
 *   2. Model oʻzi `use_tools` bilan soʻrab — keyingi qadamda ochiladi.
 *
 * Shu tufayli hech qanday imkoniyat yoʻqolmaydi, lekin oddiy savol
 * ~11 000 emas, ~3 000 token turadi.
 */

/** Guruh nomi → ichidagi vositalar. */
export const TOOL_GROUPS: Record<string, string[]> = {
  // Har doim ochiq: savol berish, oʻz maʼlumotini oʻqish, internet.
  yadro: ['ask_user', 'read_data', 'search_web', 'open_site', 'delegate', 'use_tools', 'connect_service', 'use_skill'],

  reja: [
    'create_note',
    'create_task',
    'complete_task',
    'add_schedule_item',
    'create_project',
    'log_work',
  ],
  ijod: [
    'generate_image',
    'search_images',
    'illustrate_document',
    'write_book',
    'create_course',
    'send_file',
  ],
  video: ['find_video', 'read_video', 'dub_video', 'youtube_manage'],
  joy: ['get_location', 'find_place', 'plan_route'],
  ulanish: ['connect_app', 'connect_list', 'google'],
  telegram: ['telegram'],
  ijtimoiy: ['instagram'],
};

/** Foydalanuvchiga koʻrsatiladigan qisqa tavsif — model shu roʻyxatni koʻradi. */
export const GROUP_NOTE: Record<string, string> = {
  reja: 'vazifa, dars jadvali, loyiha, konspekt, ish vaqti',
  ijod: 'rasm chizish/qidirish, kitob yozish, kurs ochish, fayl yuborish',
  video: 'YouTube qidirish, videoni oʻqish, dublyaj, kanal boshqaruvi',
  joy: 'joylashuv, manzil qidirish, yoʻl qurish',
  ulanish: 'tashqi xizmatga ulanish (Google Drive, Calendar, Sheets…)',
  telegram: 'Telegram: xabar, kontaktlar, eʼlon, jadval boʻyicha yuborish',
  ijtimoiy: 'Instagram: izohlar, Direct, post',
};

/**
 * Qaysi soʻz qaysi guruhni ochadi.
 *
 * Ataylab kengroq olingan: ortiqcha guruh ochilib qolgani — kerakli
 * vosita yoʻqligidan koʻra arzon.
 */
const HINTS: Array<[string, RegExp]> = [
  ['reja', /vazifa|topshiriq|dars|jadval|reja|loyiha|konspekt|eslat|deadline|muddat|qayd|kun tartib/i],
  ['ijod', /rasm|surat|foto|chiz|illyustr|kitob|kurs|darslik|slayd|prezent|fayl|hujjat|pdf|word|yubor|generatsiya|dizayn|logo|muqova/i],
  ['video', /video|youtube|yutub|klip|dublyaj|ovoz ber|subtitr|kanal|montaj/i],
  ['joy', /manzil|joylash|xarita|yoʻl|yo'l|marshrut|qayerda|masofa|restoran|kafe|shifoxona|do'kon|dokon/i],
  ['ulanish', /ulan|connect|google\s*(drive|calendar|sheet|doc|gmail)|kalendar|jadvalim|hisobim|akkaunt|token|api/i],
  ['telegram', /telegram|tg\b|bot|mijoz|eʼlon|e'lon|broadcast|guruh(ga|dagi)|obunachi/i],
  ['ijtimoiy', /instagram|insta\b|direct|izoh|comment|reels|story|storis|post/i],
];

/** Matndan qaysi guruhlar kerakligini topadi. */
export function guessGroups(text: string): string[] {
  const found: string[] = [];
  for (const [group, rule] of HINTS) {
    if (rule.test(text)) found.push(group);
  }
  return found;
}

/** Ochiq guruhlardagi vosita nomlari (yadro har doim ichida). */
export function toolNames(groups: Iterable<string>): Set<string> {
  const names = new Set(TOOL_GROUPS.yadro);
  for (const group of groups) {
    for (const name of TOOL_GROUPS[group] ?? []) names.add(name);
  }
  return names;
}

/*
 * Soʻrov belgilari.
 *
 * Koʻrsatmaning baʼzi boʻlimlari faqat MAʼLUM ish turida kerak:
 * grafik chizish qoidalari raqam boʻlmasa, artifact yozish qoidalari
 * ilova soʻralmasa — bekorga token yeydi. Shu belgilar boʻyicha ular
 * qoʻshiladi yoki qoʻshilmaydi.
 */
export interface Signals {
  /** Javobda raqam/statistika boʻlishi mumkin — grafik qoidalari kerak */
  raqam: boolean;
  /** Ilova, sayt, oʻyin, kod soʻralyapti — artifact qoidalari kerak */
  yasash: boolean;
  /** Foydalanuvchining oʻz maʼlumoti kerak — kontekst xulosasi qoʻshiladi */
  shaxsiy: boolean;
}

export function readSignals(text: string): Signals {
  return {
    raqam:
      /raqam|statistik|foiz|%|dinamik|taqqosla|solishtir|oʻsish|osish|kamay|jadval|grafik|diagramma|hisobla|necha|nechta|natija|reyting|byudjet|xarajat|daromad/i.test(
        text,
      ),
    yasash:
      /ilova|sayt|oʻyin|oyin|kalkulyator|interaktiv|vizual|dastur|kod|html|css|javascript|python|quiz|test tuz|simulyator|generator|yasab ber|qilib ber/i.test(
        text,
      ),
    shaxsiy:
      /mening|menda|jadval|dars|vazifa|deadline|loyiha|konspekt|ish vaqti|bugun|ertaga|rejam|kursim|nima qildim|nima bor/i.test(
        text,
      ),
  };
}

/** Yopiq guruhlarni model uchun bir necha qatorda tushuntiradi. */
export function closedGroupsNote(open: Iterable<string>): string {
  const openSet = new Set(open);
  const rest = Object.keys(GROUP_NOTE).filter((g) => !openSet.has(g));
  if (!rest.length) return '';
  const lines = rest.map((g) => `- \`${g}\` — ${GROUP_NOTE[g]}`);
  return [
    '## Yopiq vositalar 🔒',
    'Quyidagi guruhlar hozir yuborilmagan (token tejash uchun). Kerak boʻlsa',
    '`use_tools` bilan ochib ol — keyingi qadamda ishlata olasan. Ochmasdan',
    'turib «qila olmayman» dema.',
    ...lines,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/*  Daho Code uchun                                                    */
/* ------------------------------------------------------------------ */

/*
 * Kod agentida 52 ta vosita bor — birga ~6 900 token. Agent 60 qadamgacha
 * yurishi mumkin, yaʼni bir ish uchun 400 000+ token faqat eʼlonlarga
 * ketardi. Bu yerda ham yadro + guruh usuli ishlaydi.
 */
export const CODE_GROUPS: Record<string, string[]> = {
  yadro: [
    'read_file', 'write_file', 'write_files', 'edit_file', 'apply_patch',
    'find_files', 'list_files', 'grep', 'delete_file', 'move_file',
    'changes', 'undo', 'checkpoint',
    'run_cmd', 'run_js', 'test_app', 'screenshot',
    'todo', 'plan_write', 'plan_check', 'save_spec',
    'ask_user', 'fetch_url', 'web_search', 'list_models', 'use_tools', 'connect_service',
  ],
  github: [
    'github_read', 'github_push', 'github_issue', 'github_branch',
    'github_release', 'github_history', 'github_search_code',
    'github_delete_file', 'github_list_repos', 'github_import',
    'github_repo_settings', 'github_pull_request',
    'create_repo', 'connect_repo', 'publish',
    'write_workflow', 'run_workflow', 'check_workflow',
  ],
  supabase: ['supabase', 'sb_admin'],
  media: ['add_asset', 'generate_asset', 'list_attachments', 'send_file', 'send_zip'],
  ulanish: ['connect_app', 'connect_list'],
  yordamchi: ['spawn_agent'],
};

export const CODE_GROUP_NOTE: Record<string, string> = {
  github: 'GitHub: repo ochish, push, PR, issue, release, Actions workflow, deploy',
  supabase: 'Supabase: jadval, RLS, edge funksiya, admin amallari',
  media: 'rasm: loyihaga yuborilgan rasmni qoʻshish yoki yangisini chizish, fayl/zip yuborish',
  ulanish: 'tashqi xizmatga ulanish (Google, Notion…)',
  yordamchi: 'yordamchi agent chaqirish (uzun ishni boʻlish)',
};

const CODE_HINTS: Array<[string, RegExp]> = [
  ['github', /github|git\b|repo|repozitor|push|commit|pull request|\bpr\b|issue|release|deploy|joyla|nashr|workflow|actions|pages|vercel|netlify/i],
  ['supabase', /supabase|baza|database|sql|jadval|rls|auth|edge function|postgres/i],
  ['media', /rasm|surat|foto|logo|logotip|ikon|icon|asset|fayl|zip|arxiv|biriktir|yuklab/i],
  ['ulanish', /ulan|connect|google\s*(drive|sheet|doc)|notion|kalendar/i],
  ['yordamchi', /parallel|bir vaqtda|yordamchi agent|boʻlib ol|bo'lib ol/i],
];

export function guessCodeGroups(text: string): string[] {
  const found: string[] = [];
  for (const [group, rule] of CODE_HINTS) {
    if (rule.test(text)) found.push(group);
  }
  return found;
}

export function codeToolNames(groups: Iterable<string>): Set<string> {
  const names = new Set(CODE_GROUPS.yadro);
  for (const group of groups) {
    for (const name of CODE_GROUPS[group] ?? []) names.add(name);
  }
  return names;
}

export function closedCodeGroupsNote(open: Iterable<string>): string {
  const openSet = new Set(open);
  const rest = Object.keys(CODE_GROUP_NOTE).filter((g) => !openSet.has(g));
  if (!rest.length) return '';
  return [
    '## Yopiq vositalar 🔒',
    'Token tejash uchun quyidagi guruhlar hozir yuborilmagan. Kerak boʻlsa',
    '`use_tools` bilan och — keyingi qadamda ishlaydi. Ochmasdan turib',
    '«imkonim yoʻq» dema.',
    ...rest.map((g) => `- \`${g}\` — ${CODE_GROUP_NOTE[g]}`),
  ].join('\n');
}
