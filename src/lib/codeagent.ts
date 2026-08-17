import type { FunctionDeclaration, GeminiContent, GeminiPart } from './gemini';
import { streamResilient } from './resilient';
import {
  closeIssue,
  commentIssue,
  commitFiles,
  createBranch,
  createIssue,
  createPull,
  createRelease,
  createRepo,
  deleteRepoFile,
  dispatchWorkflow,
  enablePages,
  listBranches,
  listCommits,
  listContents,
  listIssues,
  listPulls,
  listReleases,
  listRepos,
  listRunArtifacts,
  listRuns,
  mergePull,
  readFile as ghReadFile,
  runFailureLog,
  searchCode,
  setTopics,
  updateRepo,
} from './github';
import { cachedModels, getModels } from './models';
import {
  bundlePreview,
  deleteProjectFile,
  fileTree,
  getCodeProject,
  patchCodeProject,
  writeProjectFile,
} from './codeproject';
import { describeProbe, probeApp } from './probe';
import { screenshotHtml, shotToAttachment } from './shot';
import { searchAnswer } from './gemini';
import { allCachedModels, modelLabel, usableChatModels } from './providers';
import { askUser, drainInterjections } from './ask';
import { isModelReadable } from './attach';
import { getState, setState } from './store';
import { templateById } from './templates';
import type { Attachment, CodeProject, Message, ProjectStep, ToolCallRecord } from './types';
import { uid } from './utils';

/** Bitta topshiriq uchun koʻpi bilan shuncha qadam (sozlamadan olinadi). */
const DEFAULT_ROUNDS = 60;
const MAX_HISTORY = 30;
/** Yordamchi agentga beriladigan qadamlar */
const SUB_ROUNDS = 18;

/** Vosita nomining oʻzbekcha tavsifi — pastdagi qatorda koʻrinadi. */
const STEP_LABEL: Record<string, string> = {
  ask_user: 'sizdan soʻrayapman',
  read_file: 'fayl oʻqilmoqda',
  write_file: 'fayl yozilmoqda',
  edit_file: 'fayl tuzatilmoqda',
  delete_file: 'fayl oʻchirilmoqda',
  list_files: 'fayllar koʻrilmoqda',
  list_models: 'modellar tekshirilmoqda',
  github_list_repos: 'repozitoriylar olinmoqda',
  github_read: 'GitHub’dan oʻqilmoqda',
  github_import: 'fayl koʻchirilmoqda',
  github_push: 'GitHub’ga yuborilmoqda',
  create_repo: 'repozitoriy ochilmoqda',
  connect_repo: 'repozitoriy ulanmoqda',
  write_workflow: 'ish oqimi yozilmoqda',
  run_workflow: 'yigʻish boshlandi',
  check_workflow: 'yigʻish tekshirilmoqda',
  test_app: 'ilova sinovdan oʻtkazilmoqda',
  github_branch: 'tarmoqlar bilan ishlanmoqda',
  github_pull_request: 'pull request bilan ishlanmoqda',
  github_issue: 'issue bilan ishlanmoqda',
  github_release: 'reliz tayyorlanmoqda',
  github_search_code: 'kod qidirilmoqda',
  github_delete_file: 'GitHub’dan oʻchirilmoqda',
  github_repo_settings: 'repo sozlanmoqda',
  github_history: 'tarix koʻrilmoqda',
  publish: 'internetga chiqarilmoqda',
  plan_write: 'reja yozilmoqda',
  plan_check: 'reja belgilanmoqda',
  screenshot: 'skrinshot olinmoqda',
  spawn_agent: 'yordamchi agent ishlamoqda',
  web_search: 'internetdan qidirilmoqda',
  save_spec: 'talablar yozilmoqda',
};

/* ------------------------------------------------------------------ */
/*  Vositalar                                                          */
/* ------------------------------------------------------------------ */

export const CODE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Loyihadagi faylning toʻliq matnini oʻqiydi.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Fayl yoʻli, masalan "src/app.js"' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Faylni toʻliq yozadi (mavjud boʻlsa almashtiradi, boʻlmasa yaratadi). ' +
      'Fayl mazmunini butunlay ber — qisman emas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Fayl yoʻli' },
        content: { type: 'STRING', description: 'Faylning toʻliq yangi matni' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Fayl ichidagi aniq matn boʻlagini almashtiradi. Kichik tuzatishlar uchun ' +
      'write_file dan tejamkorroq. find matni faylda aynan bir marta uchrashi kerak.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING' },
        find: { type: 'STRING', description: 'Almashtiriladigan aynan matn' },
        replace: { type: 'STRING', description: 'Yangi matn' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'delete_file',
    description: 'Loyihadan faylni oʻchiradi.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING' } },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'Loyihadagi barcha fayllar roʻyxatini qaytaradi.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'github_list_repos',
    description: 'Foydalanuvchining GitHub repozitoriylari roʻyxati.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'github_read',
    description:
      'GitHub repozitoriysidan fayl yoki papka mazmunini oʻqiydi. ' +
      'Mavjud loyihani oʻrganish yoki koʻchirib olish uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        path: { type: 'STRING', description: 'Fayl yoʻli; boʻsh boʻlsa papka roʻyxati' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_import',
    description:
      'GitHub’dagi faylni joriy loyihaga koʻchirib oladi (nusxalaydi).',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        path: { type: 'STRING' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_push',
    description:
      'Loyihadagi barcha fayllarni GitHub repozitoriysiga bitta commit qilib yuboradi. ' +
      'Repozitoriy ulanmagan boʻlsa avval connect_repo yoki create_repo ni chaqir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Commit izohi' },
      },
      required: ['message'],
    },
  },
  {
    name: 'create_repo',
    description: 'Yangi GitHub repozitoriysi ochadi va loyihaga bogʻlaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Repozitoriy nomi (bo‘sh joysiz)' },
        description: { type: 'STRING' },
      },
      required: ['name'],
    },
  },
  {
    name: 'connect_repo',
    description: 'Mavjud GitHub repozitoriysini joriy loyihaga bogʻlaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        branch: { type: 'STRING', description: 'Tarmoq nomi, standart: main' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'write_workflow',
    description:
      'GitHub Actions ish oqimini yozadi (.github/workflows/ ichiga). APK yigʻish, ' +
      'test, bot yoki deploy uchun. `workflow_dispatch` ni har doim qoʻsh — shunda ' +
      'run_workflow bilan qoʻlda ishga tushirsa boʻladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file: { type: 'STRING', description: 'Fayl nomi, masalan "apk.yml"' },
        yaml: { type: 'STRING', description: 'Ish oqimining toʻliq YAML matni' },
      },
      required: ['file', 'yaml'],
    },
  },
  {
    name: 'run_workflow',
    description:
      'GitHub Actions ish oqimini ishga tushiradi — APK yigʻish, deploy va hokazo. ' +
      'Avval github_push qilingan boʻlishi kerak.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file: { type: 'STRING', description: 'Ish oqimi fayli, masalan "apk.yml"' },
      },
      required: ['file'],
    },
  },
  {
    name: 'check_workflow',
    description:
      'Oxirgi ishga tushishlar holatini tekshiradi: bajarilyaptimi, muvaffaqiyatlimi, ' +
      'natija fayllari (APK va h.k.) bormi. Yiqilgan boʻlsa sababini qaytaradi.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'test_app',
    description:
      'Loyihani HAQIQATAN ishga tushirib sinaydi (telefonning oʻzida, koʻrinmas oynada). ' +
      'JavaScript xatolarini, sahifa boʻsh chiqqanini, qaysi tugma va maydonlar ' +
      'chizilganini qaytaradi. Veb loyiha ustida ish qilganingdan soʻng HAR SAFAR chaqir: ' +
      'xato boʻlsa tuzat va qayta sinab koʻr. Faqat HTML/JS loyihalar uchun ishlaydi ' +
      '(Node yoki bot kodi bunda ishlamaydi — ular uchun run_workflow + check_workflow).',
    parameters: {
      type: 'OBJECT',
      properties: {
        entry: {
          type: 'STRING',
          description: 'Boshlangʻich fayl, odatda "index.html"',
        },
        wait: {
          type: 'STRING',
          description: 'Necha millisekund kutish (default 1200, koʻpi 6000)',
        },
      },
    },
  },
  {
    name: 'ask_user',
    description:
      'Foydalanuvchidan aniqlik soʻraydi va javobini kutadi. Yoʻnalish noaniq boʻlsa, ' +
      'bir nechta yechim boʻlsa yoki qaytarib boʻlmaydigan ish (fayl oʻchirish, repo ' +
      'sozlamasini oʻzgartirish, nashr) oldidan chaqir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        question: { type: 'STRING', description: 'Qisqa, aniq savol — oʻzbekcha' },
        options: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tayyor variantlar (2-5 ta)',
        },
        multi: { type: 'STRING', description: '"true" — bir nechtasini tanlash mumkin' },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_models',
    description:
      'Mavjud AI modellar roʻyxatini qaytaradi. Kodda model nomini yozishdan oldin ' +
      'shu roʻyxatdan tekshir — oʻzingdan model nomi oʻylab topma.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'github_branch',
    description: 'Tarmoqlarni koʻradi yoki yangi tarmoq ochadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'list | create' },
        name: { type: 'STRING', description: 'Yangi tarmoq nomi (create uchun)' },
        from: { type: 'STRING', description: 'Qaysi tarmoqdan (standart: asosiy)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'github_pull_request',
    description: 'Pull requestlarni koʻradi, yangisini ochadi yoki birlashtiradi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'list | create | merge' },
        title: { type: 'STRING' },
        body: { type: 'STRING' },
        head: { type: 'STRING', description: 'Manba tarmoq' },
        base: { type: 'STRING', description: 'Maqsad tarmoq' },
        number: { type: 'NUMBER', description: 'merge uchun PR raqami' },
      },
      required: ['action'],
    },
  },
  {
    name: 'github_issue',
    description: 'Issue’larni koʻradi, ochadi, izoh qoldiradi yoki yopadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'list | create | comment | close' },
        title: { type: 'STRING' },
        body: { type: 'STRING' },
        number: { type: 'NUMBER' },
      },
      required: ['action'],
    },
  },
  {
    name: 'github_release',
    description: 'Relizlarni koʻradi yoki yangi reliz chiqaradi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'list | create' },
        tag: { type: 'STRING', description: 'masalan v1.0.0' },
        name: { type: 'STRING' },
        body: { type: 'STRING', description: 'Oʻzgarishlar roʻyxati' },
      },
      required: ['action'],
    },
  },
  {
    name: 'github_search_code',
    description: 'GitHub boʻylab kod qidiradi. Namuna yoki yechim topish uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'masalan "telegram bot repo:uzbleaderrr/bot"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_delete_file',
    description: 'GitHub repozitoriysidan faylni oʻchiradi (loyihadan emas).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING' },
        message: { type: 'STRING', description: 'Commit izohi' },
      },
      required: ['path'],
    },
  },
  {
    name: 'github_repo_settings',
    description:
      'Repozitoriy sozlamalarini oʻzgartiradi: tavsif, veb-sayt, mavzular (topics), ' +
      'ochiq/yopiqligi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING' },
        homepage: { type: 'STRING' },
        topics: { type: 'ARRAY', items: { type: 'STRING' } },
        private: { type: 'STRING', description: '"true" yoki "false"' },
      },
    },
  },
  {
    name: 'github_history',
    description: 'Oxirgi commitlarni koʻrsatadi — nima oʻzgarganini bilish uchun.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'publish',
    description:
      'Loyihani internetga chiqaradi: fayllarni yuboradi va GitHub Pages’ni yoqadi. ' +
      'Natijada jonli havola qaytadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        domain: { type: 'STRING', description: 'Oʻz domeningiz (ixtiyoriy)' },
      },
    },
  },
  {
    name: 'save_spec',
    description:
      'Foydalanuvchi bilan savol-javobdan chiqqan TALABLARNI saqlaydi. Katta ishni ' +
      'boshlashdan oldin, ask_user bilan aniqlab olgach chaqir. Bu matn keyingi ' +
      'barcha qadamlarda senga eslatib turiladi — shuning uchun loyiha yoʻldan chiqmaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        spec: {
          type: 'STRING',
          description:
            'Talablar: nima yasaladi, kim uchun, qanday ekranlar, qanday maʼlumot, ' +
            'qanday dizayn, nima kirmaydi.',
        },
      },
      required: ['spec'],
    },
  },
  {
    name: 'plan_write',
    description:
      'Ish rejasini yozadi — foydalanuvchi koʻradigan belgilanadigan roʻyxat. ' +
      'Katta ish boshlanishida chaqir. Har bir qadam alohida, aniq va tekshirsa ' +
      'boʻladigan boʻlsin ("Maʼlumot qatlami: store.js" kabi).',
    parameters: {
      type: 'OBJECT',
      properties: {
        steps: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: '4-12 ta qadam, bajarilish tartibida',
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'plan_check',
    description: 'Rejadagi qadamni bajarildi deb belgilaydi. Har qadam tugagach chaqir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        step: { type: 'NUMBER', description: 'Qadam raqami (1 dan boshlab)' },
        done: { type: 'STRING', description: '"false" — belgini olib tashlash' },
      },
      required: ['step'],
    },
  },
  {
    name: 'screenshot',
    description:
      'Ilovani ishga tushirib RASMGA oladi va rasmni SENGA koʻrsatadi. Shundan keyin ' +
      'oʻz dizayningni koʻzing bilan koʻrasan: elementlar joyidami, matn sigʻdimi, ' +
      'ranglar mosmi. Veb ilova ustida ishlaganingdan keyin test_app bilan birga ' +
      'chaqir — xato yoʻqligi yetarli emas, koʻrinishi ham yaxshi boʻlishi kerak.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entry: { type: 'STRING', description: 'Boshlangʻich fayl, odatda "index.html"' },
        wait: { type: 'STRING', description: 'Necha millisekund kutish (default 1400)' },
      },
    },
  },
  {
    name: 'spawn_agent',
    description:
      'YORDAMCHI AGENT chaqiradi — oʻz modeli va oʻz vazifasi bilan. Katta ishni ' +
      'boʻlaklarga ajratib, har boʻlagini alohida agentga berasan. Yordamchi ' +
      'fayllarni oʻqiy va yoza oladi, ishini sinaydi va senga hisobot qaytaradi.\n' +
      'Rollar: "dizayn" (koʻrinish, CSS, joylashuv), "kod" (mantiq, maʼlumot, ' +
      'funksiyalar), "tekshir" (xato qidiradi va tuzatadi), "matn" (yozuvlar, ' +
      'hujjat, tarjima).\n' +
      'Vazifani ANIQ yoz: qaysi fayllar, nima natija kutilyapti.',
    parameters: {
      type: 'OBJECT',
      properties: {
        role: { type: 'STRING', description: 'dizayn | kod | tekshir | matn' },
        task: { type: 'STRING', description: 'Toʻliq va aniq topshiriq' },
        files: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Qaysi fayllar ustida ishlasin',
        },
        model: { type: 'STRING', description: 'Ixtiyoriy: aynan qaysi model ishlatilsin' },
      },
      required: ['role', 'task'],
    },
  },
  {
    name: 'web_search',
    description:
      'Internetdan qidiradi — kutubxona hujjati, API manzili, xato matni, yangi ' +
      'versiya. Sening bilimlaring eskirgan; aniq bilmasang taxmin qilma, qidir.',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING', description: 'Qidiruv soʻrovi' } },
      required: ['query'],
    },
  },
];

/** Yordamchi agentga beriladigan vositalar — ular repo yoki nashrga tegmaydi. */
const SUB_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_files',
  'test_app',
  'screenshot',
  'web_search',
]);

export interface ToolResult {
  ok: boolean;
  summary: string;
  payload: Record<string, unknown>;
  /**
   * Vosita qaytargan rasm — modelga alohida xabar boʻlib koʻrsatiladi
   * (funksiya javobi faqat matn/JSON boʻla oladi).
   */
  image?: Attachment;
}

class NeedsRepo extends Error {
  constructor() {
    super('Repozitoriy ulanmagan — avval create_repo yoki connect_repo ni chaqiring.');
  }
}

function requireRepo(projectId: string): { owner: string; repo: string; branch: string } {
  const link = getCodeProject(projectId)?.repo;
  if (!link) throw new NeedsRepo();
  return link;
}

async function runTool(
  projectId: string,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onStep?: (step: string) => void,
  depth = 0,
): Promise<ToolResult> {
  const str = (v: unknown, fallback = '') =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback;
  const token = getState().settings.githubToken;
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, summary: 'Loyiha topilmadi', payload: { error: 'no_project' } };

  switch (name) {
    case 'ask_user': {
      const question = str(args.question, 'Qanday davom etay?');
      const answer = await askUser({
        scope: 'code',
        targetId: projectId,
        question,
        options: Array.isArray(args.options) ? args.options.map(String) : [],
        multi: str(args.multi) === 'true',
        signal,
      });
      return {
        ok: true,
        summary: `Soʻraldi → ${answer.slice(0, 45)}`,
        payload: { javob: answer },
      };
    }

    case 'list_files':
      return {
        ok: true,
        summary: `${project.files.length} ta fayl`,
        payload: { files: project.files.map((f) => f.path) },
      };

    case 'test_app': {
      const entry = str(args.entry, 'index.html');
      if (!project.files.some((f) => f.path === entry)) {
        return {
          ok: false,
          summary: `Sinov uchun ${entry} yoʻq`,
          payload: { error: 'kirish_fayli_yoq', mavjud: project.files.map((f) => f.path) },
        };
      }
      const wait = Number(str(args.wait, '1200')) || 1200;
      const result = await probeApp(bundlePreview(project, entry), wait);
      return {
        ok: result.ok,
        summary: result.ok
          ? `Sinovdan oʻtdi: ${entry} (${result.nodes} element)`
          : `Sinov muammo topdi: ${result.errors[0]?.slice(0, 60) ?? 'sahifa boʻsh'}`,
        payload: { hisobot: describeProbe(result), xatolar: result.errors },
      };
    }

    case 'read_file': {
      const path = str(args.path);
      const file = project.files.find((f) => f.path === path);
      if (!file) {
        return {
          ok: false,
          summary: `Fayl yoʻq: ${path}`,
          payload: { error: 'topilmadi', mavjud: project.files.map((f) => f.path) },
        };
      }
      return { ok: true, summary: `Oʻqildi: ${path}`, payload: { content: file.content } };
    }

    case 'write_file': {
      const path = str(args.path);
      if (!path) return { ok: false, summary: 'Yoʻl berilmadi', payload: { error: 'yoq' } };
      writeProjectFile(projectId, path, String(args.content ?? ''));
      return { ok: true, summary: `Yozildi: ${path}`, payload: { status: 'yozildi' } };
    }

    case 'edit_file': {
      const path = str(args.path);
      const find = String(args.find ?? '');
      const file = project.files.find((f) => f.path === path);
      if (!file) return { ok: false, summary: `Fayl yoʻq: ${path}`, payload: { error: 'topilmadi' } };
      const count = file.content.split(find).length - 1;
      if (count === 0) {
        return { ok: false, summary: `Matn topilmadi: ${path}`, payload: { error: 'mos_kelmadi' } };
      }
      if (count > 1) {
        return {
          ok: false,
          summary: `${path}: matn ${count} marta uchradi`,
          payload: { error: 'bir nechta mos keldi — uzunroq boʻlak bering' },
        };
      }
      writeProjectFile(projectId, path, file.content.replace(find, String(args.replace ?? '')));
      return { ok: true, summary: `Tuzatildi: ${path}`, payload: { status: 'tuzatildi' } };
    }

    case 'delete_file': {
      const path = str(args.path);
      const ok = deleteProjectFile(projectId, path);
      return {
        ok,
        summary: ok ? `Oʻchirildi: ${path}` : `Fayl yoʻq: ${path}`,
        payload: { status: ok ? 'oʻchirildi' : 'topilmadi' },
      };
    }

    case 'github_list_repos': {
      const repos = await listRepos(token);
      return {
        ok: true,
        summary: `${repos.length} ta repozitoriy`,
        payload: {
          repos: repos.slice(0, 40).map((r) => `${r.full_name} (${r.default_branch})`),
        },
      };
    }

    case 'github_read': {
      const owner = str(args.owner);
      const repo = str(args.repo);
      const path = str(args.path);
      if (!path) {
        const entries = await listContents(token, owner, repo);
        return {
          ok: true,
          summary: `${owner}/${repo}: ${entries.length} ta element`,
          payload: { entries: entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`) },
        };
      }
      const content = await ghReadFile(token, owner, repo, path);
      return {
        ok: true,
        summary: `GitHub’dan oʻqildi: ${path}`,
        payload: { content: content.slice(0, 40000) },
      };
    }

    case 'github_import': {
      const owner = str(args.owner);
      const repo = str(args.repo);
      const path = str(args.path);
      const content = await ghReadFile(token, owner, repo, path);
      writeProjectFile(projectId, path.split('/').pop() ?? path, content);
      return {
        ok: true,
        summary: `Koʻchirildi: ${path}`,
        payload: { status: 'koʻchirildi', qatorlar: content.split('\n').length },
      };
    }

    case 'create_repo': {
      const name = str(args.name, project.name)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const repo = await createRepo(token, name, str(args.description, project.description));
      patchCodeProject(projectId, {
        repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
      });
      return {
        ok: true,
        summary: `Repozitoriy ochildi: ${repo.full_name}`,
        payload: { full_name: repo.full_name, url: repo.html_url },
      };
    }

    case 'connect_repo': {
      const link = {
        owner: str(args.owner),
        repo: str(args.repo),
        branch: str(args.branch, 'main'),
      };
      patchCodeProject(projectId, { repo: link });
      return {
        ok: true,
        summary: `Bogʻlandi: ${link.owner}/${link.repo}`,
        payload: { status: 'bogʻlandi' },
      };
    }

    case 'github_push': {
      const link = getCodeProject(projectId)?.repo;
      if (!link) {
        return {
          ok: false,
          summary: 'Repozitoriy ulanmagan',
          payload: { error: 'avval create_repo yoki connect_repo ni chaqiring' },
        };
      }
      const files = getCodeProject(projectId)?.files ?? [];
      const result = await commitFiles(
        token,
        link.owner,
        link.repo,
        link.branch,
        str(args.message, 'Daho Code orqali yangilandi'),
        files,
      );
      return {
        ok: true,
        summary: `${files.length} ta fayl yuborildi (${result.sha.slice(0, 7)})`,
        payload: { commit: result.sha },
      };
    }

    case 'write_workflow': {
      const file = str(args.file, 'ci.yml').replace(/[^\w.-]/g, '');
      const path = `.github/workflows/${file.endsWith('.yml') ? file : `${file}.yml`}`;
      writeProjectFile(projectId, path, String(args.yaml ?? ''));
      return { ok: true, summary: `Ish oqimi yozildi: ${file}`, payload: { path } };
    }

    case 'run_workflow': {
      const link = getCodeProject(projectId)?.repo;
      if (!link) {
        return {
          ok: false,
          summary: 'Repozitoriy ulanmagan',
          payload: { error: 'avval create_repo va github_push' },
        };
      }
      const file = str(args.file, 'ci.yml');
      await dispatchWorkflow(token, link.owner, link.repo, file, link.branch);
      return {
        ok: true,
        summary: `Ishga tushirildi: ${file}`,
        payload: {
          status: 'boshlandi',
          eslatma: 'Natijani check_workflow bilan bir necha daqiqadan soʻng tekshiring',
        },
      };
    }

    case 'check_workflow': {
      const link = getCodeProject(projectId)?.repo;
      if (!link) {
        return { ok: false, summary: 'Repozitoriy ulanmagan', payload: { error: 'yoq' } };
      }
      const runs = await listRuns(token, link.owner, link.repo, 3);
      if (!runs.length) {
        return { ok: true, summary: 'Hali ishga tushish yoʻq', payload: { runs: [] } };
      }
      const latest = runs[0];
      const payload: Record<string, unknown> = {
        holat: latest.status,
        natija: latest.conclusion ?? 'hali tugamagan',
        havola: latest.html_url,
      };
      if (latest.conclusion === 'success') {
        const artifacts = await listRunArtifacts(token, link.owner, link.repo, latest.id);
        payload.fayllar = artifacts.map(
          (a) => `${a.name} (${Math.round(a.size_in_bytes / 1024)} KB)`,
        );
      } else if (latest.conclusion === 'failure') {
        payload.sabab = await runFailureLog(token, link.owner, link.repo, latest.id);
      }
      return {
        ok: true,
        summary: `${latest.name}: ${latest.conclusion ?? latest.status}`,
        payload,
      };
    }

    case 'list_models': {
      if (!cachedModels().length) {
        await getModels(getState().settings.apiKey).catch(() => []);
      }
      const list = allCachedModels();
      return {
        ok: true,
        summary: `${list.length} ta model`,
        payload: {
          chat: list.filter((m) => m.role === 'chat').map((m) => m.id),
          rasm: list.filter((m) => m.role === 'image').map((m) => m.id),
          ovoz: list.filter((m) => m.role === 'tts').map((m) => m.id),
          yordamchi_uchun: usableChatModels()
            .slice(0, 12)
            .map((m) => m.id),
        },
      };
    }

    case 'github_branch': {
      const link = requireRepo(projectId);
      const action = str(args.action, 'list');
      if (action === 'create') {
        const name = str(args.name);
        await createBranch(token, link.owner, link.repo, name, str(args.from, link.branch));
        return { ok: true, summary: `Tarmoq ochildi: ${name}`, payload: { status: 'ochildi' } };
      }
      const branches = await listBranches(token, link.owner, link.repo);
      return {
        ok: true,
        summary: `${branches.length} ta tarmoq`,
        payload: { branches: branches.map((b) => b.name) },
      };
    }

    case 'github_pull_request': {
      const link = requireRepo(projectId);
      const action = str(args.action, 'list');
      if (action === 'create') {
        const pr = await createPull(
          token,
          link.owner,
          link.repo,
          str(args.title, 'Yangilanish'),
          str(args.head, link.branch),
          str(args.base, 'main'),
          str(args.body),
        );
        return { ok: true, summary: `PR #${pr.number} ochildi`, payload: { url: pr.html_url } };
      }
      if (action === 'merge') {
        const num = Number(args.number);
        const res = await mergePull(token, link.owner, link.repo, num);
        return {
          ok: res.merged,
          summary: res.merged ? `PR #${num} birlashtirildi` : res.message,
          payload: { merged: res.merged },
        };
      }
      const pulls = await listPulls(token, link.owner, link.repo);
      return {
        ok: true,
        summary: `${pulls.length} ta ochiq PR`,
        payload: { pulls: pulls.map((p) => `#${p.number} ${p.title} (${p.head.ref} → ${p.base.ref})`) },
      };
    }

    case 'github_issue': {
      const link = requireRepo(projectId);
      const action = str(args.action, 'list');
      if (action === 'create') {
        const issue = await createIssue(
          token,
          link.owner,
          link.repo,
          str(args.title, 'Yangi masala'),
          str(args.body),
        );
        return {
          ok: true,
          summary: `Issue #${issue.number} ochildi`,
          payload: { url: issue.html_url },
        };
      }
      if (action === 'comment') {
        await commentIssue(token, link.owner, link.repo, Number(args.number), str(args.body));
        return { ok: true, summary: `#${args.number} ga izoh qoldirildi`, payload: { ok: true } };
      }
      if (action === 'close') {
        await closeIssue(token, link.owner, link.repo, Number(args.number));
        return { ok: true, summary: `#${args.number} yopildi`, payload: { ok: true } };
      }
      const issues = await listIssues(token, link.owner, link.repo);
      return {
        ok: true,
        summary: `${issues.length} ta ochiq issue`,
        payload: { issues: issues.map((i) => `#${i.number} ${i.title}`) },
      };
    }

    case 'github_release': {
      const link = requireRepo(projectId);
      if (str(args.action, 'list') === 'create') {
        const tag = str(args.tag, `v${new Date().toISOString().slice(0, 10)}`);
        const rel = await createRelease(
          token,
          link.owner,
          link.repo,
          tag,
          str(args.name, tag),
          str(args.body),
        );
        return { ok: true, summary: `Reliz chiqarildi: ${tag}`, payload: { url: rel.html_url } };
      }
      const rels = await listReleases(token, link.owner, link.repo);
      return {
        ok: true,
        summary: `${rels.length} ta reliz`,
        payload: { releases: rels.map((r) => `${r.tag_name} — ${r.name}`) },
      };
    }

    case 'github_search_code': {
      const res = await searchCode(token, str(args.query));
      return {
        ok: true,
        summary: `${res.items?.length ?? 0} ta natija`,
        payload: {
          hits: (res.items ?? []).map((h) => `${h.repository.full_name}/${h.path}`),
        },
      };
    }

    case 'github_delete_file': {
      const link = requireRepo(projectId);
      const path = str(args.path);
      await deleteRepoFile(
        token,
        link.owner,
        link.repo,
        path,
        link.branch,
        str(args.message, `${path} oʻchirildi`),
      );
      return { ok: true, summary: `GitHub’dan oʻchirildi: ${path}`, payload: { ok: true } };
    }

    case 'github_repo_settings': {
      const link = requireRepo(projectId);
      const patch: Record<string, unknown> = {};
      if (str(args.description)) patch.description = str(args.description);
      if (str(args.homepage)) patch.homepage = str(args.homepage);
      if (str(args.private)) patch.private = str(args.private) === 'true';
      if (Object.keys(patch).length) await updateRepo(token, link.owner, link.repo, patch);
      if (Array.isArray(args.topics) && args.topics.length) {
        await setTopics(token, link.owner, link.repo, args.topics.map(String));
      }
      return { ok: true, summary: 'Repozitoriy sozlamalari yangilandi', payload: { ok: true } };
    }

    case 'github_history': {
      const link = requireRepo(projectId);
      const commits = await listCommits(token, link.owner, link.repo, link.branch);
      return {
        ok: true,
        summary: `${commits.length} ta oxirgi commit`,
        payload: {
          commits: commits.map(
            (c) => `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]} — ${c.commit.author.name}`,
          ),
        },
      };
    }

    case 'publish': {
      const domain = str(args.domain, getState().settings.publishDomain);
      const result = await publishProject(projectId, domain);
      return {
        ok: true,
        summary: `Chiqarildi: ${result.url}`,
        payload: { url: result.url },
      };
    }

    case 'save_spec': {
      const spec = str(args.spec);
      if (!spec) return { ok: false, summary: 'Talab boʻsh', payload: { error: 'boʻsh' } };
      patchCodeProject(projectId, { spec });
      return {
        ok: true,
        summary: 'Talablar saqlandi',
        payload: { status: 'saqlandi — endi shu talablarga qatʼiy amal qil' },
      };
    }

    case 'plan_write': {
      const raw = Array.isArray(args.steps) ? args.steps.map(String) : [];
      const steps: ProjectStep[] = raw
        .map((title) => title.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((title) => ({ id: uid('st_'), title, done: false }));
      if (!steps.length) {
        return { ok: false, summary: 'Reja boʻsh', payload: { error: 'qadam yoʻq' } };
      }
      patchCodeProject(projectId, { plan: steps });
      return {
        ok: true,
        summary: `Reja: ${steps.length} qadam`,
        payload: {
          reja: steps.map((s, i) => `${i + 1}. ${s.title}`),
          eslatma: 'Har qadam tugagach plan_check bilan belgila.',
        },
      };
    }

    case 'plan_check': {
      const index = Math.round(Number(args.step) || 0) - 1;
      const plan = project.plan ?? [];
      if (index < 0 || index >= plan.length) {
        return {
          ok: false,
          summary: `Bunday qadam yoʻq: ${args.step}`,
          payload: { error: 'notoʻgʻri raqam', qadamlar: plan.length },
        };
      }
      const done = str(args.done, 'true') !== 'false';
      const next = plan.map((s, i) => (i === index ? { ...s, done } : s));
      patchCodeProject(projectId, { plan: next });
      const left = next.filter((s) => !s.done).length;
      return {
        ok: true,
        summary: `${index + 1}-qadam ${done ? 'bajarildi' : 'qaytarildi'}`,
        payload: {
          qolgan: left,
          keyingi: next.find((s) => !s.done)?.title ?? 'hammasi bajarildi',
        },
      };
    }

    case 'screenshot': {
      const entry = str(args.entry, 'index.html');
      const file = project.files.find((f) => f.path === entry)
        ?? project.files.find((f) => f.path.endsWith('.html'));
      if (!file) {
        return {
          ok: false,
          summary: 'Skrinshot uchun HTML yoʻq',
          payload: { error: 'html_yoq', mavjud: project.files.map((f) => f.path) },
        };
      }
      const wait = Number(str(args.wait, '1400')) || 1400;
      const shot = await screenshotHtml(bundlePreview(project, file.path), wait);
      const image = shotToAttachment(shot);
      if (!image) {
        return {
          ok: false,
          summary: `Skrinshot chiqmadi: ${shot.error ?? 'nomaʼlum'}`,
          payload: { error: shot.error ?? 'nomaʼlum' },
        };
      }
      return {
        ok: true,
        summary: `Skrinshot olindi (${shot.width}×${shot.height})`,
        payload: {
          status: 'rasm keyingi xabarda koʻrsatiladi',
          oʻlcham: `${shot.width}×${shot.height}`,
          eslatma:
            'Rasmga qara: joylashuv, boʻsh joy, matn oʻlchami, ranglar mos kelyaptimi. ' +
            'Kamchilik koʻrsang tuzat va qayta suratga ol.',
        },
        image,
      };
    }

    case 'web_search': {
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Soʻrov boʻsh', payload: { error: 'boʻsh' } };
      const { settings } = getState();
      const answer = await searchAnswer(settings.apiKey, settings.model, query, signal);
      return {
        ok: true,
        summary: `Qidirildi: ${query.slice(0, 40)}`,
        payload: {
          javob: answer.text.slice(0, 6000),
          manbalar: answer.sources.map((s) => `${s.title} — ${s.url}`),
        },
      };
    }

    case 'spawn_agent': {
      if (depth >= 1) {
        return {
          ok: false,
          summary: 'Yordamchi agent yana agent chaqira olmaydi',
          payload: { error: 'ichma-ich chaqiruv taqiqlangan — ishni oʻzing bajar' },
        };
      }
      const role = str(args.role, 'kod').toLowerCase();
      const task = str(args.task);
      if (!task) return { ok: false, summary: 'Vazifa boʻsh', payload: { error: 'boʻsh' } };
      const files = Array.isArray(args.files) ? args.files.map(String) : [];
      const report = await runSubAgent(projectId, role, task, files, str(args.model), signal, onStep);
      return {
        ok: report.ok,
        summary: `${SUB_ROLES[role]?.title ?? role}: ${report.summary.slice(0, 50)}`,
        payload: {
          hisobot: report.summary,
          oʻzgargan_fayllar: report.touched,
          model: report.model,
        },
      };
    }

    default:
      return { ok: false, summary: `Nomaʼlum vosita: ${name}`, payload: { error: 'unknown' } };
  }
}

/* ------------------------------------------------------------------ */
/*  Yordamchi agentlar (koʻp agentli ish)                              */
/* ------------------------------------------------------------------ */

interface SubRole {
  title: string;
  /** Sozlamalardagi qaysi rol modeli */
  slot: 'dizayn' | 'kod' | 'tekshir' | 'matn';
  brief: string;
}

const SUB_ROLES: Record<string, SubRole> = {
  dizayn: {
    title: 'Dizayner',
    slot: 'dizayn',
    brief: `Sen — DIZAYNER agentsan. Faqat koʻrinish bilan shugʻullanasan: joylashuv,
ranglar, shrift oʻlchami, boʻsh joy, animatsiya, mobil moslashuv.
- Ishni boshlashdan oldin \`screenshot\` bilan hozirgi holatni KOʻR.
- Oʻzgartirgach yana \`screenshot\` ol va oʻzing baho ber.
- Qorongʻi fon, bitta urgʻu rangi, yumshoq radiuslar, silliq oʻtishlar.
- Tugmalar barmoqqa qulay (kamida 44px balandlik), matn 15px dan kichik boʻlmasin.
- Mantiqqa (JS funksiyalari, maʼlumot) TEGMA — faqat CSS va tuzilma.`,
  },
  kod: {
    title: 'Dasturchi',
    slot: 'kod',
    brief: `Sen — DASTURCHI agentsan. Mantiq, maʼlumot va funksiyalar sening ishing.
- Avval tegishli fayllarni oʻqi, keyin yoz.
- Kodni mayda funksiyalarga ajrat, har fayl bitta ish qilsin.
- Xatolarni ushla: boʻsh kiritish, notoʻgʻri son, yoʻq maʼlumot.
- Ish tugagach \`test_app\` bilan sina; xato chiqsa tuzat va qayta sina.
- Koʻrinish (CSS) bilan ovora boʻlma — u boshqa agentning ishi.`,
  },
  tekshir: {
    title: 'Tekshiruvchi',
    slot: 'tekshir',
    brief: `Sen — TEKSHIRUVCHI agentsan. Vazifang: xato topish va tuzatish.
- \`test_app\` va \`screenshot\` bilan ilovani haqiqatan ishlatib koʻr.
- Har bir tugma va maydonni koʻrib chiq: bosilganda nima boʻladi, boʻsh qoldirilsa-chi.
- Topgan har bir muammoni tuzat, keyin qayta sina.
- Hisobotingda: nima buzuq edi, nimani tuzatding, nima hali ham shubhali.`,
  },
  matn: {
    title: 'Muharrir',
    slot: 'matn',
    brief: `Sen — MUHARRIR agentsan. Ilovadagi barcha yozuvlar sening isharing.
- Matn oʻzbek tilida (lotin), sodda va tushunarli boʻlsin.
- Tugma yozuvlari qisqa (1-2 soʻz), xato xabarlari foydali boʻlsin.
- Kod mantigʻiga tegma — faqat matnlarni almashtir.`,
  },
};

export interface SubReport {
  ok: boolean;
  summary: string;
  touched: string[];
  model: string;
}

function subSystemPrompt(project: CodeProject, role: SubRole, task: string, files: string[]): string {
  return `${role.brief}

## Loyiha
${project.name}${project.description ? ` — ${project.description}` : ''}
${project.spec ? `\n## Loyiha talablari\n${project.spec}` : ''}

Fayllar:
${fileTree(project) || '(boʻsh)'}
${files.length ? `\n## Senga tegishli fayllar\n${files.map((f) => `- ${f}`).join('\n')}` : ''}

## Vazifang
${task}

## Qoidalar
- Faqat shu vazifani bajar. Boshqa joyga tegma, «yaxshilab qoʻyay» dema.
- Kodni javob matniga koʻchirma — \`write_file\` va \`edit_file\` bilan faylga yoz.
- Ish tugagach 2-4 qatorda HISOBOT yoz: nima qilding, qaysi fayllarni oʻzgartirding,
  nima ishlamadi. Bosh agent shu hisobotni oʻqiydi.
- Savol berma — foydalanuvchi bilan gaplashish bosh agentning ishi.
  Noaniqlik boʻlsa eng mantiqiy yechimni tanla va hisobotda ayt.`;
}

/** Yordamchi agentni ishga tushiradi va hisobotini qaytaradi. */
async function runSubAgent(
  projectId: string,
  roleId: string,
  task: string,
  files: string[],
  modelOverride: string,
  signal?: AbortSignal,
  onStep?: (step: string) => void,
): Promise<SubReport> {
  const role = SUB_ROLES[roleId] ?? SUB_ROLES.kod;
  const { settings } = getState();
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, summary: 'Loyiha topilmadi', touched: [], model: '' };

  const model =
    modelOverride ||
    settings.roleModels[role.slot] ||
    project.model ||
    settings.model;

  const tools = CODE_TOOLS.filter((t) => SUB_TOOL_NAMES.has(t.name));
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: `Vazifani bajar:\n${task}` }] },
  ];
  const touched = new Set<string>();
  let text = '';

  for (let round = 0; round < SUB_ROUNDS; round += 1) {
    const current = getCodeProject(projectId);
    if (!current) break;

    let chunkText = '';
    const result = await streamResilient({
      apiKey: settings.apiKey,
      model,
      contents,
      systemInstruction: subSystemPrompt(current, role, task, files),
      tools,
      temperature: role.slot === 'dizayn' ? 0.7 : 0.35,
      signal,
      onText: (chunk) => {
        chunkText += chunk;
      },
      rollback: (chars) => {
        chunkText = chunkText.slice(0, Math.max(0, chunkText.length - chars));
      },
      onStep: (step) => onStep?.(`${role.title}: ${step}`),
      allowModelSwap: true,
    });
    text = chunkText;

    if (!result.functionCalls.length) break;
    contents.push({ role: 'model', parts: result.parts });

    const responses: GeminiPart[] = [];
    const images: Attachment[] = [];
    for (const call of result.functionCalls) {
      onStep?.(`${role.title}: ${STEP_LABEL[call.name] ?? call.name}`);
      let outcome: ToolResult;
      try {
        outcome = await runTool(projectId, call.name, call.args, signal, onStep, 1);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        outcome = {
          ok: false,
          summary: `${call.name}: ${(err as Error).message}`,
          payload: { error: (err as Error).message },
        };
      }
      if (call.name === 'write_file' || call.name === 'edit_file') {
        const path = typeof call.args.path === 'string' ? call.args.path : '';
        if (path) touched.add(path);
      }
      if (outcome.image) images.push(outcome.image);
      responses.push({ functionResponse: { name: call.name, response: outcome.payload } });
    }
    contents.push({ role: 'user', parts: responses });
    // Skrinshot alohida xabar boʻlib boradi — model rasmni koʻrishi kerak.
    if (images.length) {
      contents.push({
        role: 'user',
        parts: [
          ...images.map((img) => ({
            inlineData: { mimeType: img.mimeType, data: img.data },
          })),
          { text: 'Mana ilovaning hozirgi koʻrinishi. Koʻrib chiq va kerak boʻlsa tuzat.' },
        ],
      });
    }
  }

  return {
    ok: true,
    summary: text.trim() || 'Vazifa bajarildi (hisobot yozilmadi).',
    touched: [...touched],
    model: modelLabel(model),
  };
}

/* ------------------------------------------------------------------ */
/*  Nashr qilish                                                       */
/* ------------------------------------------------------------------ */

export interface PublishResult {
  url: string;
  domain?: string;
}

/** Loyihani GitHub Pages’ga chiqaradi va jonli havolani qaytaradi. */
export async function publishProject(
  projectId: string,
  domain?: string,
): Promise<PublishResult> {
  const token = getState().settings.githubToken;
  let project = getCodeProject(projectId);
  if (!project) throw new Error('Loyiha topilmadi');

  if (!project.repo) {
    const name = project.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `daho-${Date.now().toString(36)}`;
    const repo = await createRepo(token, name, project.description);
    patchCodeProject(projectId, {
      repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
    });
    project = getCodeProject(projectId)!;
  }

  const link = project.repo!;
  const files = [...project.files];

  // Oʻz domeningiz boʻlsa CNAME fayli kerak.
  if (domain) {
    files.push({ path: 'CNAME', content: `${domain}\n` });
  }
  // Jekyll fayllarni yashirmasligi uchun.
  if (!files.some((f) => f.path === '.nojekyll')) {
    files.push({ path: '.nojekyll', content: '' });
  }

  await commitFiles(token, link.owner, link.repo, link.branch, 'Daho Code: nashr', files);
  const pages = await enablePages(token, link.owner, link.repo, link.branch, domain);

  const url = domain ? `https://${domain}` : pages.html_url;
  patchCodeProject(projectId, { publish: { url, domain, at: Date.now() } });
  return { url, domain };
}

/* ------------------------------------------------------------------ */
/*  Agent sikli                                                        */
/* ------------------------------------------------------------------ */

/** Agentning joriy rejasi — har turda eslatib turiladi. */
function planBlock(project: CodeProject): string {
  const plan = project.plan ?? [];
  if (!plan.length) return '';
  const lines = plan.map((s, i) => `${s.done ? '[x]' : '[ ]'} ${i + 1}. ${s.title}`);
  const next = plan.find((s) => !s.done);
  return `\n## Joriy reja\n${lines.join('\n')}\n${
    next ? `Keyingi qadam: ${next.title}` : 'Hamma qadam bajarildi — yakunlash vaqti.'
  }`;
}

function systemPrompt(project: CodeProject): string {
  const { settings } = getState();
  const template = templateById(project.template);
  return `Sen — "Daho Code", telefonda ishlaydigan dasturchi agentsan. Oʻzbek tilida gaplashasan.

## Loyiha
Nomi: ${project.name}
${project.description ? `Tavsif: ${project.description}` : ''}
GitHub: ${project.repo ? `${project.repo.owner}/${project.repo.repo} (${project.repo.branch})` : 'ulanmagan'}
Jonli havola: ${project.publish?.url ?? 'hali chiqarilmagan'}
GitHub tokeni: ${settings.githubToken ? 'kiritilgan' : 'YOʻQ — github vositalari ishlamaydi'}

Shablon: ${template.name}
${template.brief}

Fayllar:
${fileTree(project) || '(boʻsh)'}
${project.spec ? `\n## Kelishilgan talablar — QATʼIY amal qil\n${project.spec}` : ''}
${planBlock(project)}

## Sen qanday agentsan
Sen bir marta javob yozib qoʻyadigan chat emassan. Sen — ishni OXIRIGACHA
olib boradigan agentsan. Topshiriq berilganda:
- oʻzing rejalashtirasan, oʻzing yozasan, oʻzing sinaysan, oʻzing tuzatasan;
- toʻxtash uchun ruxsat soʻrab oʻtirmaysan — ish tugaguncha davom etasan;
- «shu yerda toʻxtatib turaman» yoki «keyin davom ettiraman» DEMA. Yoki ishni
  tugat, yoki \`ask_user\` bilan aniq savol ber va javobni kut.

## Boshlash tartibi
### 1-qadam: TUSHUN (yangi yoki katta ish boʻlsa)
Foydalanuvchi «X yasab ber» desa, darhol kod yozishga tashlanma.
Avval \`ask_user\` bilan 2-4 ta MUHIM savol ber (bir chaqiruvda bitta savol,
tayyor variantlar bilan):
- Aniq nima kerak: qaysi ekranlar, qaysi imkoniyatlar?
- Kim uchun va qayerda ishlaydi (telefon sayti, bot, APK)?
- Maʼlumot qayerda saqlanadi (telefonda, GitHub’da, tashqi bazada)?
- Koʻrinishi qanday boʻlsin (qorongʻi/yorugʻ, uslub, rang)?
Javoblarni olgach \`save_spec\` bilan talablarni yozib qoʻy.
Kichik tuzatish soʻralsa (bitta rang, bitta xato) — savol berma, darhol qil.

### 2-qadam: REJA
\`plan_write\` bilan 4-12 qadamli reja tuz. Har qadam ishlaydigan natija bersin.
Rejani foydalanuvchiga qisqa koʻrsat.

### 3-qadam: BAJAR
Qadamma-qadam ishla. Har qadam tugagach \`plan_check\` bilan belgila.
Katta qadamni \`spawn_agent\` bilan yordamchiga ber (pastga qara).

### 4-qadam: SINA
Har qadam oxirida \`test_app\` (xato bormi) VA \`screenshot\` (koʻrinishi
qandayligi). Skrinshotga oʻz koʻzing bilan qara — matn sigʻmagan, tugma
qiyshaygan, rang oʻqilmaydigan boʻlsa tuzat va qayta suratga ol.

### 5-qadam: YAKUNLA
Nima yasalgani, qanday ishlatish va qanday sinaganingni 4-6 qatorda ayt.

## Koʻp agentli ish 👥
Katta loyihada hamma ishni oʻzing qilma — \`spawn_agent\` bilan boʻlib ber:
- \`kod\` — mantiq, maʼlumot qatlami, funksiyalar;
- \`dizayn\` — CSS, joylashuv, mobil moslashuv (u skrinshot koʻrib ishlaydi);
- \`tekshir\` — tayyor boʻlgach xato qidiradi va tuzatadi;
- \`matn\` — ilovadagi yozuvlar, xato xabarlari.
Har biriga ANIQ vazifa va fayl nomlarini ber. Ular ishlab, senga hisobot
qaytaradi. Ketma-ket chaqir: avval kod, keyin dizayn, oxirida tekshir.
Yordamchilarning har biri boshqa modelda ishlashi mumkin — bu normal.

## Arxitektura — 4 ta fayl bilan cheklanma 🏗
Jiddiy loyiha jiddiy tuzilishga muhtoj. Mos keladigan tuzilma:
\`\`\`
index.html          — faqat tuzilma (markup), mantiq yoʻq
css/base.css        — ranglar, shriftlar, umumiy uslub
css/app.css         — ekranlarning oʻz uslubi
js/store.js         — maʼlumot: saqlash, oʻqish, oʻzgartirish
js/api.js           — tashqi soʻrovlar (bor boʻlsa)
js/ui.js            — ekranni chizish
js/app.js           — hammasini ulaydi, boshlaydi
REJA.md             — maqsad, ekranlar, maʼlumot, fayl xaritasi
\`\`\`
Qoidalar:
- Har bir fayl BITTA ish qilsin. 300 qatordan oshsa — boʻlaklarga ajrat.
- Maʼlumot bilan ishlash UI ichida emas, alohida faylda.
- Takrorlanayotgan kodni funksiyaga chiqar.
- Sozlamalar (rang, URL, kalit) bitta joyda tursin.
- \`<link href="css/app.css">\` va \`<script src="js/app.js">\` bemalol ishlat —
  ular telefonda avtomatik birlashtiriladi.
- Yangi qadam eskisini buzmasin: oʻzgartirishdan oldin faylni \`read_file\` bilan oʻqi.

## Oʻz ishingni SINAB koʻr — majburiy
- \`test_app\` — JS xatolari, sahifa boʻsh chiqdimi, qaysi tugmalar bor.
- \`screenshot\` — haqiqiy koʻrinish rasmi, sen uni koʻrasan.
- Xato chiqsa tuzat va QAYTA sina. Uch marta boʻlmasa — muammoni ochiq ayt.
- Bot yoki Node kodi telefonda ishlamaydi: \`write_workflow\` → \`github_push\` →
  \`run_workflow\` → \`check_workflow\` bilan logini oʻqi. Sinovsiz qoldirma.
- Foydalanuvchi skrinshot yuborsa — undagi xato matnini diqqat bilan oʻqi,
  tegishli faylni ochib sababini top va tuzat.
- Bilmasang \`web_search\` bilan qidir. Taxmin qilib yozma.

## Kod qoidalari
- Telefonda koʻriladigan qism (index.html va h.k.) tashqi CDN, shrift yoki
  kutubxonasiz boʻlsin — kerakli kodni oʻzing yoz.
- Node kodi (bot, backend, build skript) faqat GitHub Actions yoki serverda
  ishlaydi — telefonda emas. Buni foydalanuvchiga ochiq ayt.
- Tashqi npm paketiga ehtiyoj boʻlsa avval Node’ning oʻz modullarini koʻrib chiq.
- \`<link href="style.css">\` va \`<script src="app.js">\` bemalol ishlat —
  ular avtomatik birlashtiriladi.
- Mobil ekranga moslashgan, katta tugmali, qorongʻi fon.
- Kod toza, funksiyalarga ajratilgan va oʻzbekcha izohli boʻlsin.
- Interfeys matni oʻzbek tilida.

## Savol berish va aytib ishlash
- Har bir vositani chaqirishdan OLDIN bir qisqa jumlada nima qilayotganingni yoz.
- Yoʻnalish noaniq boʻlsa \`ask_user\` bilan variantlar berib soʻra: qaysi sahifa,
  qaysi uslub, qaysi tarmoq, nashr qilinsinmi va hokazo. Taxmin qilib katta ishni
  notoʻgʻri qilma.
- Qaytarib boʻlmaydigan ish (fayl oʻchirish, repo sozlamasi, nashr, PR birlashtirish)
  oldidan albatta soʻra.
- Mayda qarorlarni oʻzing qabul qil va aytib qoʻy — har narsaga soʻrama.
- Ish davomida foydalanuvchi qoʻshimcha yozsa, u «Foydalanuvchi qoʻshimcha aytdi»
  boʻlib keladi — uni darhol hisobga ol va rejangni oʻzgartir.

## Buyruqqa boʻysunish — MUHIM
- Foydalanuvchi aniq nom aytsa (model nomi, kutubxona, fayl nomi, rang, matn) —
  AYNAN oʻshani yoz. Oʻzingdan boshqasiga almashtirma.
- «gemini-3.7-flash ishlat» desa — kodga aynan \`gemini-3.7-flash\` yoz.
  Bu model senga notanish boʻlishi mumkin — bu normal, sening bilimlaring eskirgan.
  Shubhalansang \`list_models\` bilan tekshir, lekin baribir foydalanuvchi aytganini yoz.
- Agar rostdan ham mos kelmasa: aytilganini yoz, soʻng bir jumlada
  «agar ishlamasa X ga almashtiring» deb eslat. Lekin oʻzing almashtirma.
- Foydalanuvchi soʻramagan narsani qoʻshma, soʻralganini tushirib qoldirma.

## Uslub
Qisqa yoz. Kodni javob matniga koʻchirma — vositalar orqali faylga yoz.
Nima qilayotganingni bir jumlada ayt, keyin vositani chaqir.`;
}

function toContents(messages: Message[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const msg of messages.slice(-MAX_HISTORY)) {
    const parts: GeminiPart[] = [];
    for (const att of msg.attachments ?? []) {
      if (!isModelReadable(att.mimeType)) continue;
      parts.push({ inlineData: { mimeType: att.mimeType, data: att.data } });
    }
    if (msg.text.trim()) parts.push({ text: msg.text });
    if (!parts.length) continue;
    out.push({ role: msg.role, parts });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function patchMessage(projectId: string, messageId: string, patch: Partial<Message>): void {
  setState((s) => ({
    code: s.code.map((p) =>
      p.id === projectId
        ? {
            ...p,
            messages: p.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
          }
        : p,
    ),
  }));
}

export interface CodeRunResult {
  ok: boolean;
  text: string;
}

/** Foydalanuvchi topshirigʻini bajaradi: oʻqiydi, yozadi, yuboradi, chiqaradi. */
export async function runCodeAgent(
  projectId: string,
  instruction: string,
  signal?: AbortSignal,
  attachments: Attachment[] = [],
  onStep?: (step: string) => void,
): Promise<CodeRunResult> {
  const { settings } = getState();
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, text: '' };

  const userMsg: Message = {
    id: uid('m_'),
    role: 'user',
    text: instruction,
    attachments: attachments.length ? attachments : undefined,
    createdAt: Date.now(),
  };
  const modelMsg: Message = { id: uid('m_'), role: 'model', text: '', createdAt: Date.now() };

  setState((s) => ({
    code: s.code.map((p) =>
      p.id === projectId
        ? { ...p, updatedAt: Date.now(), messages: [...p.messages, userMsg, modelMsg] }
        : p,
    ),
  }));

  const contents = toContents([...project.messages, userMsg]);
  const toolCalls: ToolCallRecord[] = [];
  let accumulated = '';
  let flush: ReturnType<typeof setTimeout> | null = null;

  const onText = (chunk: string) => {
    accumulated += chunk;
    if (!flush) {
      flush = setTimeout(() => {
        flush = null;
        patchMessage(projectId, modelMsg.id, { text: accumulated });
      }, 60);
    }
  };

  const maxRounds = Math.max(10, Math.min(200, settings.agentRounds || DEFAULT_ROUNDS));

  /** Agent oʻrtada toʻxtab qolsa nechta marta turtki berish mumkin */
  const MAX_NUDGES = 4;
  let nudges = 0;

  try {
    // Sikl oxirigacha yetib borsa — ish tugamagan, qadamlar tugagan.
    let finished = false;
    for (let round = 0; round < maxRounds; round += 1) {
      // Har turda tizim koʻrsatmasi yangilanadi — fayl roʻyxati oʻzgargan boʻlishi mumkin.
      const current = getCodeProject(projectId);
      if (!current) {
        finished = true;
        break;
      }

      const result = await streamResilient({
        apiKey: settings.apiKey,
        model: current.model || settings.model,
        contents,
        systemInstruction: systemPrompt(current),
        tools: CODE_TOOLS,
        temperature: 0.4,
        signal,
        onText,
        rollback: (chars) => {
          accumulated = accumulated.slice(0, Math.max(0, accumulated.length - chars));
          patchMessage(projectId, modelMsg.id, { text: accumulated });
        },
        onStep,
        allowModelSwap: true,
      });

      if (!result.functionCalls.length) {
        const extra = drainInterjections('code', projectId);
        if (extra.length) {
          contents.push({ role: 'model', parts: result.parts });
          contents.push({
            role: 'user',
            parts: [{ text: `Foydalanuvchi qoʻshimcha aytdi:\n${extra.join('\n')}` }],
          });
          onStep?.('qoʻshimcha koʻrsatma hisobga olinmoqda');
          continue;
        }

        // Reja tugamagan boʻlsa — agent oʻrtada toʻxtab qolgan. Turtki
        // beramiz: foydalanuvchi «davom et» deb yozib oʻtirmasin.
        const left = (current.plan ?? []).filter((s) => !s.done);
        if (left.length && nudges < MAX_NUDGES) {
          nudges += 1;
          contents.push({ role: 'model', parts: result.parts });
          contents.push({
            role: 'user',
            parts: [
              {
                text:
                  `Rejada hali ${left.length} ta qadam bajarilmagan:\n` +
                  `${left.map((s) => `- ${s.title}`).join('\n')}\n\n` +
                  'Toʻxtama — keyingi qadamni hoziroq bajar. Ish tugagach ' +
                  'plan_check bilan belgilab, qisqa xulosa yoz.',
              },
            ],
          });
          onStep?.(`reja davom etmoqda — ${left.length} qadam qoldi`);
          continue;
        }

        finished = true;
        break;
      }

      // Fikrlash imzolari bilan birga aynan qaytariladi.
      contents.push({ role: 'model', parts: result.parts });

      const responses: GeminiPart[] = [];
      const shots: Attachment[] = [];
      for (const call of result.functionCalls) {
        onStep?.(STEP_LABEL[call.name] ?? call.name);
        let outcome: ToolResult;
        try {
          outcome = await runTool(projectId, call.name, call.args, signal, onStep, 0);
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          outcome = {
            ok: false,
            summary: `${call.name}: ${(err as Error).message}`,
            payload: { error: (err as Error).message },
          };
        }
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: outcome.ok,
          summary: outcome.summary,
          at: accumulated.length,
        });
        if (outcome.image) shots.push(outcome.image);
        responses.push({ functionResponse: { name: call.name, response: outcome.payload } });
      }
      contents.push({ role: 'user', parts: responses });

      // Skrinshot funksiya javobiga sigʻmaydi — alohida xabar bilan
      // koʻrsatamiz, shunda model oʻz ishini haqiqatan koʻradi.
      if (shots.length) {
        contents.push({
          role: 'user',
          parts: [
            ...shots.map((img) => ({
              inlineData: { mimeType: img.mimeType, data: img.data },
            })),
            {
              text:
                'Mana ilovaning hozirgi koʻrinishi. Diqqat bilan qara: joylashuv, ' +
                'boʻsh joylar, matn oʻlchami, ranglar, tugmalar. Kamchilik boʻlsa ' +
                'tuzat va qayta suratga ol.',
            },
          ],
        });
      }
      patchMessage(projectId, modelMsg.id, { toolCalls: [...toolCalls] });

      const extra = drainInterjections('code', projectId);
      if (extra.length) {
        contents.push({
          role: 'user',
          parts: [{ text: `Foydalanuvchi qoʻshimcha aytdi:\n${extra.join('\n')}` }],
        });
        onStep?.('qoʻshimcha koʻrsatma hisobga olinmoqda');
      }
    }

    if (flush) clearTimeout(flush);
    // Katta loyihada qadamlar tugab qolsa — ish yarim qolganini aytamiz.
    if (!finished) {
      accumulated +=
        '\n\n⏸ Bu bosqichda qadamlar tugadi. «Davom et» desangiz shu joydan davom ettiraman.';
    }
    patchMessage(projectId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    });
    return { ok: true, text: accumulated };
  } catch (err) {
    if (flush) clearTimeout(flush);
    const aborted = (err as Error)?.name === 'AbortError';
    patchMessage(projectId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      error: aborted ? 'Toʻxtatildi.' : String((err as Error)?.message ?? err),
    });
    return { ok: false, text: accumulated };
  }
}
