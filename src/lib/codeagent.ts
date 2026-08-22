import type { FunctionDeclaration, GeminiContent, GeminiPart } from './gemini';
import { activeConnectors, callConnector, findAction, findConnector } from './connectors';
import { unzipSync } from 'fflate';
import { openExternal } from './openlink';
import { saveBytes } from './exporter';
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
  downloadArtifact,
  enablePages,
  fetchBinary,
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
import { cachedModels, geminiModel, getModels } from './models';
import {
  bundlePreview,
  deleteProjectFile,
  fileTree,
  getCodeProject,
  patchCodeProject,
  writeProjectFile,
} from './codeproject';
import { describeDiff, restore, snapshot } from './checkpoint';
import { runJs } from './jsrun';
import { applyPatch } from './patch';
import { createProject, listProjects, projectKeys, projectUrl, runSql, sbAdminReady } from './sbadmin';
import { compactContents, contextSize, createLoopGuard } from './compact';
import { runOnServer, serverReady } from './cloud/server';
import { globFiles, grepFiles, sliceLines, type GrepHit } from './search';
import { describeProbe, probeApp } from './probe';
import { saveZip } from './exporter';
import {
  createTableSql,
  sbDelete,
  sbInsert,
  sbSchema,
  sbSelect,
  sbUpdate,
  supabaseLink,
} from './supabase';
import { screenshotHtml, shotToAttachment } from './shot';
import { searchAnswer } from './gemini';
import {
  allCachedModels,
  modelLabel,
  pickForJob,
  pickForProject,
  supportsVision,
  usableChatModels,
  visionCapableRef,
} from './providers';
import { askUser, drainInterjections } from './ask';
import { isModelReadable } from './attach';
import { getState, setState } from './store';
import { imageAny } from './providers';
import { templateById } from './templates';
import {
  connectable,
  connected,
  startConnect,
  type OauthProvider,
  type ProviderInfo,
} from './oauth';
import { CODE_GROUPS, closedCodeGroupsNote, codeToolNames, guessCodeGroups } from './toolpick';
import type {
  Artifact,
  Attachment,
  CodeFile,
  CodeProject,
  Message,
  ProjectStep,
  ToolCallRecord,
} from './types';
import { uid } from './utils';

/** Bitta topshiriq uchun koʻpi bilan shuncha qadam (sozlamadan olinadi). */
const DEFAULT_ROUNDS = 60;

/**
 * Hech narsani oʻzgartirmaydigan vositalar — bir turda bir nechtasi
 * soʻralsa parallel bajarilishi mumkin.
 */
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'grep',
  'find_files',
  'fetch_url',
  'web_search',
  'github_read',
  'github_list_repos',
  'github_search_code',
  'github_history',
  'list_models',
  'changes',
  'connect_list',
]);
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
  send_file: 'fayl yuborilmoqda',
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
  send_zip: 'arxiv tayyorlanmoqda',
  supabase: 'bazaga murojaat qilinmoqda',
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
    description:
      'Loyihadagi faylni oʻqiydi. Katta fayl boʻlsa `offset` va `limit` bilan '
      + 'faqat kerakli qismini ol — butun faylni oʻqish token yeydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Fayl yoʻli, masalan "src/app.js"' },
        offset: { type: 'NUMBER', description: 'Nechanchi qatordan boshlab (0 dan)' },
        limit: { type: 'NUMBER', description: 'Nechta qator oʻqilsin' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep',
    description:
      'Loyiha fayllari ICHIDAN matn yoki muntazam ifoda qidiradi va qaysi faylning '
      + 'qaysi qatorida borligini qaytaradi. Fayllarni bittalab ochib chiqishdan '
      + 'ancha tez va arzon.\n'
      + 'Misollar: "useState" — qayerda ishlatilgan; "TODO|FIXME" — bajarilmagan ishlar; '
      + '"function\\s+\\w+" — funksiyalar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        pattern: { type: 'STRING', description: 'Qidiriladigan matn yoki muntazam ifoda' },
        glob: { type: 'STRING', description: 'Faqat shu fayllarda, masalan "src/**/*.ts"' },
        ignore_case: { type: 'BOOLEAN', description: 'Katta-kichik harfni farqlamaslik' },
        context: { type: 'NUMBER', description: 'Har topilma atrofidan nechta qator (0-6)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'find_files',
    description:
      'Naqsh boʻyicha fayllarni topadi: "*.ts", "src/**/*.tsx", "**/test_*.py". '
      + 'Loyiha katta boʻlsa list_files oʻrniga shuni ishlat.',
    parameters: {
      type: 'OBJECT',
      properties: { pattern: { type: 'STRING', description: 'Fayl naqshi' } },
      required: ['pattern'],
    },
  },
  {
    name: 'run_js',
    description:
      'JavaScript kodini BAJARADI va natijani qaytaradi. Bu senga «terminal» '
      + 'oʻrnini bosadi: hisob-kitob, maʼlumotni qayta ishlash, yozgan '
      + 'funksiyangni sinab koʻrish, algoritmni tekshirish.\n'
      + 'console.log chiqishi va oxirgi `return` qiymati qaytadi. Kod alohida '
      + 'muhitda ishlaydi — DOM va loyiha fayllariga tegolmaydi, 5 soniyadan '
      + 'oshsa toʻxtatiladi. Taxmin qilish oʻrniga SHUNI ishlatib tekshir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        code: {
          type: 'STRING',
          description: 'Bajariladigan JavaScript. Natijani `return` bilan qaytar.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'run_cmd',
    description:
      'SERVERDA haqiqiy buyruq bajaradi: npm install, node, python3, git, '
      + 'testlar, qurish — hammasi. `run_js` dan farqi: bu toʻliq Linux '
      + 'muhiti, kutubxona oʻrnatsa ham boʻladi va fayllar chaqiruvlar '
      + 'orasida saqlanadi.\n'
      + 'Faqat foydalanuvchi Daho serverini ulagan boʻlsa ishlaydi '
      + '(Sozlamalar → Daho serveri). Ishlamasa `run_js` bilan davom et.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Bajariladigan buyruq' },
        cwd: { type: 'STRING', description: 'Qaysi papkada (ixtiyoriy)' },
        timeout: { type: 'NUMBER', description: 'Millisekundda chegara' },
      },
      required: ['command'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Havoladagi sahifa yoki API javobini oʻqiydi (matn holida). Hujjatlarni '
      + 'oʻqish, API namunasini koʻrish, kutubxona versiyasini tekshirish uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Toʻliq havola' },
        limit: { type: 'NUMBER', description: 'Koʻpi bilan nechta belgi (standart 8000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_attachments',
    description:
      'Foydalanuvchi shu suhbatda yuborgan fayl va rasmlar roʻyxati. '
      + 'Foydalanuvchi «shu rasmni ishlat», «logotipni qoʻy» desa avval '
      + 'shuni chaqir — qanday fayllar borligini bilib olasan.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'add_asset',
    description:
      'Foydalanuvchi yuborgan rasm/shrift/audio faylni LOYIHAGA qoʻshadi — '
      + 'haqiqiy fayl boʻlib saqlanadi, koʻrinishda ham, GitHubʼda ham '
      + 'ishlaydi.\n'
      + 'Foydalanuvchi «bu rasmni saytga qoʻy» desa: avval `list_attachments`, '
      + 'keyin shu vosita bilan loyihaga sol, soʻng HTML/CSS da odatdagidek '
      + 'havola qil: <img src="assets/logo.png">.\n'
      + 'Rasmni oʻzing chizishga urinma — foydalanuvchi aynan shu faylni '
      + 'ishlatishini kutayapti.',
    parameters: {
      type: 'OBJECT',
      properties: {
        attachment: {
          type: 'STRING',
          description: 'Fayl nomi yoki tartib raqami (list_attachments dan)',
        },
        path: {
          type: 'STRING',
          description: 'Loyihadagi yoʻl, masalan "assets/logo.png"',
        },
      },
      required: ['attachment', 'path'],
    },
  },
  {
    name: 'generate_asset',
    description:
      'Loyiha uchun RASM CHIZADI va uni fayl qilib saqlaydi — logotip, ikonka, '
      + 'fon, banner, illyustratsiya.\n'
      + 'Foydalanuvchi rasm yubormagan boʻlsa va sayt/ilova uchun tasvir kerak '
      + 'boʻlsa shuni ishlat: `<img src="assets/logo.png">` odatdagidek ishlaydi.\n'
      + 'Foydalanuvchi OʻZ rasmini yuborgan boʻlsa — `add_asset` ni ishlat, '
      + 'yangisini chizma.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Rasm tavsifi — ingliz tilida aniqroq chiqadi',
        },
        path: {
          type: 'STRING',
          description: 'Loyihadagi yoʻl, masalan "assets/logo.png"',
        },
        from_attachment: {
          type: 'STRING',
          description:
            'Ixtiyoriy: foydalanuvchi yuborgan rasmni asos qilib oʻzgartirish '
            + '(fayl nomi yoki tartib raqami)',
        },
      },
      required: ['prompt', 'path'],
    },
  },
  {
    name: 'apply_patch',
    description:
      'Faylga unified diff qoʻllaydi — KATTA faylni arzon tahrirlash yoʻli. '
      + '500 qatorli faylni `write_file` bilan qayta yozish 500 qator token '
      + 'yeydi; diff bilan bu 10 qator.\n'
      + 'Format: `@@` bilan boshlangan boʻlaklar, keyin ` ` kontekst, '
      + '`-` oʻchirish, `+` qoʻshish. Har boʻlakka 2-3 qator kontekst qoʻsh — '
      + 'joyni shunga qarab topamiz, qator raqamlari notoʻgʻri boʻlsa ham ishlaydi.\n'
      + 'Misol:\n@@ -10,4 +10,4 @@\n function salom() {\n-  return 1;\n+  return 2;\n }',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Fayl yoʻli' },
        diff: { type: 'STRING', description: 'Unified diff matni' },
      },
      required: ['path', 'diff'],
    },
  },
  {
    name: 'move_file',
    description: 'Faylni koʻchiradi yoki nomini oʻzgartiradi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        from: { type: 'STRING', description: 'Hozirgi yoʻl' },
        to: { type: 'STRING', description: 'Yangi yoʻl' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'write_files',
    description:
      'Bir nechta faylni BITTA chaqiruvda yozadi. Yangi loyiha yaratayotganda '
      + 'yoki bir necha faylni birga oʻzgartirayotganda tezroq.',
    parameters: {
      type: 'OBJECT',
      properties: {
        files: {
          type: 'ARRAY',
          description: 'Fayllar roʻyxati',
          items: {
            type: 'OBJECT',
            properties: {
              path: { type: 'STRING' },
              content: { type: 'STRING' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'checkpoint',
    description:
      'Loyihaning hozirgi holatini saqlab qoʻyadi. Katta oʻzgarishdan OLDIN '
      + 'chaqir — xato qilsang `undo` bilan qaytasan.',
    parameters: {
      type: 'OBJECT',
      properties: { label: { type: 'STRING', description: 'Nima qilmoqchisan' } },
      required: ['label'],
    },
  },
  {
    name: 'undo',
    description:
      'Saqlangan nusxaga qaytaradi. Nusxa nomi berilmasa — eng oxirgisiga. '
      + 'Qaytarishdan oldin hozirgi holat ham saqlanadi.',
    parameters: {
      type: 'OBJECT',
      properties: { snapshot: { type: 'STRING', description: 'Nusxa id si (ixtiyoriy)' } },
    },
  },
  {
    name: 'changes',
    description:
      'Oxirgi nusxadan beri qaysi fayllar oʻzgarganini koʻrsatadi. Ishni '
      + 'yakunlashdan oldin oʻzingni tekshirish uchun.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'todo',
    description:
      'Bajariladigan ishlar roʻyxatini yuritadi — foydalanuvchi buni ekranda '
      + 'koʻradi. Koʻp qadamli ishda BOSHIDA roʻyxat tuz, har qadamdan keyin '
      + 'bajarilganini belgila. Kichik ishga kerak emas.\n'
      + 'action: "set" (yangi roʻyxat), "done" (bajarildi deb belgilash), "list".',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'set | done | list' },
        items: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: '«set» uchun: ishlar roʻyxati',
        },
        item: { type: 'STRING', description: '«done» uchun: qaysi ish bajarildi' },
      },
      required: ['action'],
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
    name: 'send_file',
    description:
      'Tayyor faylni foydalanuvchining qurilmasiga BERADI — saqlash/ulashish oynasi ochiladi. ' +
      'APK yigʻilib boʻlgach ALBATTA shuni chaqir: aks holda foydalanuvchi faylni ololmaydi. ' +
      'Manba: "artifact" — GitHub Actions natijasi (zip ichidan kerakli fayl olinadi), ' +
      '"release" — reliz fayli, yoki toʻgʻridan-toʻgʻri havola.',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: {
          type: 'STRING',
          description: '"artifact" (standart), "release" yoki toʻliq https havola',
        },
        name: {
          type: 'STRING',
          description: 'Fayl nomi yoki uning bir qismi, masalan ".apk" yoki "app-debug"',
        },
      },
      required: [],
    },
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
    name: 'send_zip',
    description:
      'Loyihaning fayllarini ZIP arxiv qilib foydalanuvchining telefoniga yuboradi. ' +
      'Foydalanuvchi «zip qilib ber», «fayllarni yubor», «yuklab olaman» desa chaqir. ' +
      'Ulashish oynasi ochiladi — u faylni saqlaydi yoki Telegramga yuboradi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Arxiv nomi (kengaytmasiz)' },
        only: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Faqat shu fayllar; boʻsh boʻlsa hammasi',
        },
      },
    },
  },
  {
    name: 'supabase',
    description:
      'Supabase maʼlumot bazasi bilan ishlaydi — haqiqiy, telefonlar orasida ' +
      'umumiy baza. localStorage faqat bitta telefonda qoladi; roʻyxatga olish, ' +
      'foydalanuvchi hisobi, umumiy roʻyxat kerak boʻlsa Supabase ishlat.\n' +
      'Amallar:\n' +
      '- `schema` — qanday jadvallar va ustunlar bor (ISHNI SHUNDAN BOSHLA)\n' +
      '- `select` — yozuvlarni oʻqish\n' +
      '- `insert` — yozuv qoʻshish (`rows` — JSON massiv matni)\n' +
      '- `update` — `filter` boʻyicha yangilash (`patch` — JSON matn)\n' +
      '- `delete` — `filter` boʻyicha oʻchirish\n' +
      '- `sql` — jadval yaratish SQL ini TAYYORLAB beradi (bajarmaydi)\n' +
      'Filtr koʻrinishi: `id=eq.5` yoki `holat=eq.faol&narx=gt.100`.\n' +
      'MUHIM: anon kalit bilan CREATE TABLE bajarilmaydi. Jadval kerak boʻlsa ' +
      '`sql` bilan matnini yozib, faylga saqlab, foydalanuvchiga Supabase → ' +
      'SQL Editor ga bir marta qoʻyishini ayt.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'schema | select | insert | update | delete | sql' },
        table: { type: 'STRING' },
        columns: { type: 'STRING', description: 'select uchun: "id,nom,narx"' },
        filter: { type: 'STRING', description: 'masalan "id=eq.5"' },
        order: { type: 'STRING', description: 'masalan "created_at.desc"' },
        limit: { type: 'NUMBER' },
        rows: { type: 'STRING', description: 'insert uchun JSON massiv matni' },
        patch: { type: 'STRING', description: 'update uchun JSON obyekt matni' },
        sql_columns: {
          type: 'ARRAY',
          description: 'sql uchun ustunlar',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING' },
              type: { type: 'STRING', description: 'text | int8 | numeric | boolean | timestamptz | uuid' },
              nullable: { type: 'STRING', description: '"true" — boʻsh boʻlishi mumkin' },
            },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'sb_admin',
    description:
      'Supabase LOYIHASINI OʻZI boshqaradi — foydalanuvchi nomidan. Oddiy '
      + '`supabase` vositasi anon kalit bilan ishlaydi va jadval yarata '
      + 'olmaydi; bu esa hammasini qiladi.\n'
      + 'Amallar:\n'
      + '- `projects` — mavjud loyihalar roʻyxati\n'
      + '- `create` — YANGI loyiha ochish (`name`; parol oʻzi yasaladi)\n'
      + '- `sql` — loyihada SQL bajarish: CREATE TABLE, RLS, index — hammasi\n'
      + '- `keys` — loyihaning anon/service kalitlari va manzili\n'
      + 'Loyiha ochilgach `sql` bilan jadvallarni tuz, keyin `keys` bilan '
      + 'kalitni olib ilova kodiga yoz. Foydalanuvchidan hech narsa '
      + 'soʻrashing shart emas.\n'
      + 'Yangi loyiha tayyor boʻlishi 1-2 daqiqa vaqt oladi — `projects` '
      + 'bilan holatini tekshirib tur.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'projects | create | sql | keys' },
        name: { type: 'STRING', description: 'create uchun loyiha nomi' },
        ref: { type: 'STRING', description: 'sql/keys uchun loyiha ref si' },
        query: { type: 'STRING', description: 'sql uchun SQL matni' },
        region: { type: 'STRING', description: 'masalan eu-central-1' },
      },
      required: ['action'],
    },
  },
  {
    name: 'connect_app',
    description:
      'Foydalanuvchi ulab qoʻygan tashqi xizmatga soʻrov yuboradi (Telegram, '
      + 'Discord, Slack, Notion, Airtable, Home Assistant, webhook…). Loyihani '
      + 'nashr qilgach xabar berish, natijani jamoaga tashlash yoki tashqi '
      + 'maʼlumotni olib kelish uchun. Qanday ulanish borligini «connect_list» aytadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        connector: { type: 'STRING', description: 'Ulanish nomi' },
        action: { type: 'STRING', description: 'Amal nomi' },
        data: { type: 'OBJECT', description: 'Amal talab qiladigan maydonlar' },
      },
      required: ['connector', 'action'],
    },
  },
  {
    name: 'connect_list',
    description: 'Ulangan tashqi xizmatlar va ularning amallari roʻyxati.',
    parameters: { type: 'OBJECT', properties: {} },
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
  {
    name: 'connect_service',
    description:
      'Xizmatga ulanishni TAKLIF qiladi — foydalanuvchiga tugma chiqadi. Token soʻrama, '
      + 'shuni chaqir. Xizmatlar: github, supabase, google.',
    parameters: {
      type: 'OBJECT',
      properties: {
        service: { type: 'STRING', description: 'github | supabase | google' },
        why: { type: 'STRING', description: 'Nima uchun kerak — bir jumla' },
      },
      required: ['service'],
    },
  },
  {
    name: 'use_tools',
    description:
      'Yopiq vosita guruhini ochadi. Kerakli vosita roʻyxatda yoʻq boʻlsa shuni chaqir — '
      + 'keyingi qadamda ishlaydi. Guruhlar: github, supabase, media, ulanish, yordamchi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        groups: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Ochiladigan guruhlar',
        },
      },
      required: ['groups'],
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

/**
 * Foydalanuvchi shu loyihada yuborgan barcha fayllar — yangisi birinchi.
 * Bir xil fayl bir necha marta yuborilgan boʻlsa ham bir marta qaytadi.
 */
function projectAttachments(project: CodeProject): Attachment[] {
  const out: Attachment[] = [];
  const seen = new Set<string>();
  for (let i = project.messages.length - 1; i >= 0; i -= 1) {
    for (const att of project.messages[i].attachments ?? []) {
      const key = `${att.name ?? ''}:${att.data.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(att);
    }
  }
  return out;
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
  const num = (v: unknown, fallback = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const token = getState().settings.githubToken;
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, summary: 'Loyiha topilmadi', payload: { error: 'no_project' } };

  switch (name) {
    /*
     * Guruhni ochish. Hech narsa bajarmaydi — keyingi qadamda qaysi
     * eʼlonlar yuborilishini belgilaydi (siklda hisobga olinadi).
     */
    /*
     * Ulanish taklifi — token soʻrash oʻrniga tugma.
     */
    case 'connect_service': {
      const service = str(args.service).toLowerCase() as OauthProvider;
      if (!['github', 'supabase', 'google'].includes(service)) {
        return { ok: false, summary: 'nomaʼlum xizmat', payload: { xato: 'github | supabase | google' } };
      }
      if (connected(service)) {
        return { ok: true, summary: `${service} allaqachon ulangan`, payload: { ulangan: true } };
      }
      const list = await connectable().catch((): Record<string, ProviderInfo> => ({}));
      if (!list[service]?.ready) {
        return {
          ok: false,
          summary: `${service} ulanishi sozlanmagan`,
          payload: {
            xato: `Serverda ${service} ulanishi sozlanmagan.`,
            eslatma: 'Sozlamalardan qoʻlda kalit kiritish mumkinligini ayt.',
          },
        };
      }
      const answer = await askUser({
        scope: 'code',
        targetId: projectId,
        question: `${list[service].label} ga ulanish kerak — ${str(args.why, 'shu ish uchun')}. Ulaymizmi?`,
        options: ['Ulash', 'Hozir emas'],
        multi: false,
        signal,
      });
      if (!/ulash/i.test(answer)) {
        return { ok: false, summary: 'ulanish rad etildi', payload: { javob: answer } };
      }
      await startConnect(service);
      return {
        ok: true,
        summary: `${service} ulanish sahifasi ochildi`,
        payload: {
          ochildi: true,
          eslatma: 'Foydalanuvchi ruxsat berib qaytadi — shuni aytib qoʻy.',
        },
      };
    }

    case 'use_tools': {
      const asked = Array.isArray(args.groups)
        ? args.groups.map((g) => String(g).trim().toLowerCase())
        : [String(args.groups ?? '').trim().toLowerCase()];
      const known = asked.filter((g) => g && g in CODE_GROUPS && g !== 'yadro');
      return {
        ok: known.length > 0,
        summary: known.length ? `vositalar ochildi: ${known.join(', ')}` : 'bunday guruh yoʻq',
        payload: {
          opened: known,
          tools: known.flatMap((g) => CODE_GROUPS[g] ?? []),
          eslatma: known.length
            ? 'Endi shu vositalarni chaqirishing mumkin.'
            : 'Mavjud guruhlar: github, supabase, media, ulanish, yordamchi.',
        },
      };
    }

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
      const offset = Math.max(0, num(args.offset, 0));
      const limit = Math.max(0, num(args.limit, 0));
      if (!offset && !limit) {
        return { ok: true, summary: `Oʻqildi: ${path}`, payload: { content: file.content } };
      }
      const part = sliceLines(file.content, offset, limit);
      return {
        ok: true,
        summary: `Oʻqildi: ${path} (${part.from}-${part.to} / ${part.total} qator)`,
        payload: { content: part.text, qator: `${part.from}-${part.to}`, jami: part.total },
      };
    }

    case 'grep': {
      const pattern = str(args.pattern);
      if (!pattern) return { ok: false, summary: 'Naqsh boʻsh', payload: { error: 'pattern kerak' } };
      const res = grepFiles(project.files, pattern, {
        glob: str(args.glob) || undefined,
        ignoreCase: args.ignore_case === true || str(args.ignore_case) === 'true',
        context: num(args.context, 0),
      });
      if (!res.hits.length) {
        return {
          ok: true,
          summary: `«${pattern}» topilmadi`,
          payload: { topilma: [], koʻrilgan_fayl: res.scanned },
        };
      }
      return {
        ok: true,
        summary: `«${pattern}» — ${res.hits.length} ta topilma${res.truncated ? ' (kesildi)' : ''}`,
        payload: {
          topilma: res.hits.map((h: GrepHit) => ({
            fayl: h.path,
            qator: h.line,
            matn: h.text,
            ...(h.before?.length ? { oldin: h.before } : {}),
            ...(h.after?.length ? { keyin: h.after } : {}),
          })),
          koʻrilgan_fayl: res.scanned,
          kesildi: res.truncated,
        },
      };
    }

    case 'find_files': {
      const pattern = str(args.pattern);
      const found = globFiles(project.files, pattern).map((f: CodeFile) => f.path);
      return {
        ok: true,
        summary: found.length ? `${found.length} ta fayl topildi` : `«${pattern}» ga mos fayl yoʻq`,
        payload: { fayllar: found },
      };
    }

    case 'run_js': {
      const code = str(args.code);
      if (!code) return { ok: false, summary: 'Kod boʻsh', payload: { error: 'code kerak' } };
      const res = await runJs(code);
      return {
        ok: res.ok,
        summary: res.ok
          ? `Kod bajarildi (${res.ms} ms)`
          : `Kod xato berdi: ${(res.error ?? '').slice(0, 60)}`,
        payload: res.ok
          ? {
              chiqish: res.output || '(chiqish yoʻq)',
              ...(res.value !== undefined ? { natija: res.value } : {}),
              ms: res.ms,
            }
          : { chiqish: res.output, xato: res.error },
      };
    }

    case 'run_cmd': {
      const command = str(args.command);
      if (!command) return { ok: false, summary: 'Buyruq boʻsh', payload: { error: 'command kerak' } };
      if (!serverReady()) {
        return {
          ok: false,
          summary: 'Daho serveri ulanmagan',
          payload: {
            error: 'server_yoq',
            izoh:
              'Haqiqiy buyruq uchun server kerak. Foydalanuvchiga Sozlamalar → '
              + 'Daho serveri boʻlimidan Railway manzilini kiritishni ayt. '
              + 'Hozircha oddiy hisob uchun `run_js` ishlatsang boʻladi.',
          },
        };
      }
      try {
        const res = await runOnServer(command, {
          cwd: str(args.cwd) || undefined,
          timeout: num(args.timeout, 0) || undefined,
          signal,
        });
        return {
          ok: res.ok,
          summary: res.ok
            ? `$ ${command.slice(0, 50)} — tayyor`
            : `$ ${command.slice(0, 50)} — xato (${res.code})`,
          payload: {
            kod: res.code,
            chiqish: res.stdout.slice(-6000) || '(chiqish yoʻq)',
            ...(res.stderr ? { xato: res.stderr.slice(-3000) } : {}),
            ...(res.dir ? { papka: res.dir } : {}),
          },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Serverga ulanib boʻlmadi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'fetch_url': {
      const url = str(args.url);
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, summary: 'Havola notoʻgʻri', payload: { error: 'http(s) havola kerak' } };
      }
      const cap = Math.max(500, Math.min(40_000, num(args.limit, 8000)));
      try {
        const res = await fetch(url, { signal });
        const text = await res.text();
        // HTML boʻlsa teglarni tashlab, oʻqiladigan matn qoldiramiz.
        const clean = /<html|<body|<!doctype/i.test(text.slice(0, 500))
          ? text
              .replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/\s{2,}/g, ' ')
          : text;
        return {
          ok: res.ok,
          summary: `${url} — ${res.status}`,
          payload: { holat: res.status, matn: clean.trim().slice(0, cap) },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Havola ochilmadi',
          payload: {
            error: String((err as Error)?.message ?? err),
            izoh: 'Sayt boshqa manbadan soʻrovni taqiqlagan boʻlishi mumkin (CORS).',
          },
        };
      }
    }

    case 'list_attachments': {
      const list = projectAttachments(project);
      if (!list.length) {
        return {
          ok: true,
          summary: 'Yuborilgan fayl yoʻq',
          payload: {
            fayllar: [],
            izoh: 'Foydalanuvchi hali fayl yubormagan. Kerak boʻlsa soʻra.',
          },
        };
      }
      return {
        ok: true,
        summary: `${list.length} ta yuborilgan fayl`,
        payload: {
          fayllar: list.map((a, i) => ({
            raqam: i + 1,
            nom: a.name ?? `fayl-${i + 1}`,
            turi: a.mimeType,
            hajm_kb: Math.round((a.data.length * 0.75) / 1024),
          })),
        },
      };
    }

    case 'add_asset': {
      const list = projectAttachments(project);
      if (!list.length) {
        return {
          ok: false,
          summary: 'Yuborilgan fayl yoʻq',
          payload: { error: 'Foydalanuvchi hali fayl yubormagan.' },
        };
      }

      const wanted = str(args.attachment);
      const byIndex = Number(wanted);
      const picked =
        Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= list.length
          ? list[byIndex - 1]
          : (list.find((a) => (a.name ?? '').toLowerCase() === wanted.toLowerCase()) ??
            list.find((a) => (a.name ?? '').toLowerCase().includes(wanted.toLowerCase())));

      if (!picked) {
        return {
          ok: false,
          summary: `«${wanted}» topilmadi`,
          payload: { bor: list.map((a, i) => `${i + 1}. ${a.name ?? a.mimeType}`) },
        };
      }

      const path = str(args.path) || `assets/${picked.name ?? 'fayl'}`;
      writeProjectFile(projectId, path, picked.data, { mimeType: picked.mimeType });
      return {
        ok: true,
        summary: `${picked.name ?? picked.mimeType} → ${path}`,
        payload: {
          yoʻl: path,
          turi: picked.mimeType,
          izoh: `HTML da shunday havola qil: src="${path}"`,
        },
      };
    }

    /*
     * Loyiha uchun rasm chizish.
     *
     * `generate_image` chatda rasmni koʻrsatadi, bu esa uni loyihaga FAYL
     * qilib qoʻyadi — shunda u nashr qilinganda ham, GitHubʼda ham
     * ishlaydi. Foydalanuvchi yuborgan rasmni asos qilib ham boʻladi.
     */
    case 'generate_asset': {
      const prompt = str(args.prompt);
      if (!prompt) {
        return { ok: false, summary: 'Rasm tavsifi yoʻq', payload: { xato: 'prompt kerak' } };
      }

      // Asos rasm — foydalanuvchi yuborganini oʻzgartirish uchun.
      const refs: Attachment[] = [];
      const wanted = str(args.from_attachment);
      if (wanted) {
        const list = projectAttachments(project);
        const byIndex = Number(wanted);
        const picked =
          Number.isFinite(byIndex) && byIndex >= 1 && byIndex <= list.length
            ? list[byIndex - 1]
            : list.find((a) => (a.name ?? '').toLowerCase().includes(wanted.toLowerCase()));
        if (picked) refs.push(picked);
      }

      try {
        const images = await imageAny(prompt, refs, signal);
        if (!images.length) {
          return { ok: false, summary: 'Rasm chiqmadi', payload: { xato: 'model rasm qaytarmadi' } };
        }
        const image = images[0];
        const ext = (image.mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg');
        let path = str(args.path) || `assets/rasm.${ext}`;
        if (!/\.[a-z0-9]{2,4}$/i.test(path)) path = `${path}.${ext}`;

        writeProjectFile(projectId, path, image.data, { mimeType: image.mimeType });
        return {
          ok: true,
          summary: `Rasm chizildi → ${path}`,
          payload: {
            yoʻl: path,
            turi: image.mimeType,
            izoh: `HTML da shunday havola qil: src="${path}"`,
          },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Rasm chizilmadi: ${(err as Error).message}`,
          payload: { xato: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'apply_patch': {
      const path = str(args.path);
      const diff = str(args.diff);
      const file = project.files.find((f) => f.path === path);
      if (!file) {
        return {
          ok: false,
          summary: `Fayl yoʻq: ${path}`,
          payload: { error: 'topilmadi', mavjud: project.files.map((f) => f.path).slice(0, 40) },
        };
      }
      const res = applyPatch(file.content, diff);
      if (!res.ok || !res.content) {
        return {
          ok: false,
          summary: `Diff qoʻllanmadi: ${path}`,
          payload: {
            qoʻllandi: res.applied,
            xatolar: res.failed,
            izoh:
              'Faylni qayta oʻqib, aynan hozirgi matnga mos diff yoz. '
              + 'Kontekst qatorlari faylnikiga bir xil boʻlsin.',
          },
        };
      }
      writeProjectFile(projectId, path, res.content);
      const wasLines = file.content.split('\n').length;
      const nowLines = res.content.split('\n').length;
      return {
        ok: true,
        summary: `${path} — ${res.applied} ta boʻlak qoʻllandi`,
        payload: { qoʻllandi: res.applied, qator: `${wasLines} → ${nowLines}` },
      };
    }

    case 'move_file': {
      const from = str(args.from);
      const to = str(args.to);
      const file = project.files.find((f) => f.path === from);
      if (!file) {
        return { ok: false, summary: `Fayl yoʻq: ${from}`, payload: { error: 'topilmadi' } };
      }
      if (!to || to === from) {
        return { ok: false, summary: 'Yangi yoʻl notoʻgʻri', payload: { error: 'to kerak' } };
      }
      writeProjectFile(projectId, to, file.content);
      deleteProjectFile(projectId, from);
      return { ok: true, summary: `${from} → ${to}`, payload: { from, to } };
    }

    case 'write_files': {
      const list = Array.isArray(args.files) ? args.files : [];
      if (!list.length) {
        return { ok: false, summary: 'Fayl berilmadi', payload: { error: 'files kerak' } };
      }
      const written: string[] = [];
      for (const item of list) {
        const entry = item as { path?: unknown; content?: unknown };
        const path = str(entry.path);
        if (!path) continue;
        writeProjectFile(projectId, path, str(entry.content));
        written.push(path);
      }
      return {
        ok: written.length > 0,
        summary: `${written.length} ta fayl yozildi`,
        payload: { fayllar: written },
      };
    }

    case 'checkpoint': {
      const entry = snapshot(projectId, str(args.label, 'oʻzgarishdan oldin'));
      return {
        ok: true,
        summary: entry ? `Nusxa olindi: ${entry.label}` : 'Oʻzgarish yoʻq — nusxa kerak emas',
        payload: entry ? { id: entry.id, nom: entry.label } : { izoh: 'oxirgi nusxadan farq yoʻq' },
      };
    }

    case 'undo': {
      const history = getCodeProject(projectId)?.history ?? [];
      if (!history.length) {
        return { ok: false, summary: 'Nusxa yoʻq', payload: { error: 'saqlangan nusxa topilmadi' } };
      }
      const target = str(args.snapshot) || history[0].id;
      const ok = restore(projectId, target);
      return {
        ok,
        summary: ok ? 'Oldingi holatga qaytarildi' : 'Qaytarib boʻlmadi',
        payload: ok
          ? { nusxa: target, fayllar: getCodeProject(projectId)?.files.length ?? 0 }
          : { error: 'nusxa topilmadi' },
      };
    }

    case 'changes': {
      const history = getCodeProject(projectId)?.history ?? [];
      if (!history.length) {
        return {
          ok: true,
          summary: 'Solishtirish uchun nusxa yoʻq',
          payload: { izoh: 'Avval `checkpoint` chaqir.' },
        };
      }
      return {
        ok: true,
        summary: 'Oxirgi nusxadan beri oʻzgarishlar',
        payload: { oʻzgarish: describeDiff(projectId, history[0].id) },
      };
    }

    case 'todo': {
      const action = str(args.action, 'list');
      const current = getCodeProject(projectId)?.plan ?? [];

      if (action === 'set') {
        const items = Array.isArray(args.items) ? args.items.map(String) : [];
        if (!items.length) {
          return { ok: false, summary: 'Roʻyxat boʻsh', payload: { error: 'items kerak' } };
        }
        const plan: ProjectStep[] = items.slice(0, 20).map((title, i) => ({
          id: `todo_${Date.now().toString(36)}_${i}`,
          title: title.slice(0, 120),
          done: false,
        }));
        patchCodeProject(projectId, { plan });
        return {
          ok: true,
          summary: `${plan.length} ta ish belgilandi`,
          payload: { ishlar: plan.map((p) => p.title) },
        };
      }

      if (action === 'done') {
        const needle = str(args.item).toLowerCase();
        // Nomi berilmasa — birinchi bajarilmaganini yopamiz.
        const target = needle
          ? current.find((p) => p.title.toLowerCase().includes(needle))
          : current.find((p) => !p.done);
        if (!target) {
          return { ok: false, summary: 'Bunday ish yoʻq', payload: { ishlar: current.map((p) => p.title) } };
        }
        patchCodeProject(projectId, {
          plan: current.map((p) => (p.id === target.id ? { ...p, done: true } : p)),
        });
        const left = current.filter((p) => !p.done && p.id !== target.id).length;
        return {
          ok: true,
          summary: `✓ ${target.title}${left ? ` · ${left} ta qoldi` : ' · hammasi tayyor'}`,
          payload: { bajarildi: target.title, qoldi: left },
        };
      }

      return {
        ok: true,
        summary: current.length ? `${current.filter((p) => p.done).length}/${current.length} bajarildi` : 'Roʻyxat boʻsh',
        payload: { ishlar: current.map((p) => ({ ish: p.title, bajarildi: p.done })) },
      };
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

    case 'send_file': {
      const link = getCodeProject(projectId)?.repo;
      const want = str(args.name, '.apk').toLowerCase();
      const source = str(args.source, 'artifact');

      /** Baytlarni foydalanuvchiga beradi. */
      const hand = async (filename: string, bytes: Uint8Array) => {
        const mime = filename.endsWith('.apk')
          ? 'application/vnd.android.package-archive'
          : filename.endsWith('.zip')
            ? 'application/zip'
            : 'application/octet-stream';
        const note = await saveBytes(filename, bytes, mime);
        return {
          ok: true,
          summary: `Fayl berildi: ${filename}`,
          payload: {
            fayl: filename,
            hajm: `${Math.round(bytes.length / 1024)} KB`,
            holat: note,
            koʻrsatma:
              'Fayl foydalanuvchining qurilmasiga saqlandi. APK boʻlsa uni ochib ' +
              'oʻrnatishini ayt («Nomaʼlum manbalardan oʻrnatish» ruxsati kerak boʻlishi mumkin).',
          },
        };
      };

      // --- toʻgʻridan-toʻgʻri havola
      if (/^https?:\/\//i.test(source)) {
        try {
          const bytes = await fetchBinary(source);
          const filename = source.split('/').pop()?.split('?')[0] || 'fayl';
          return await hand(filename, bytes);
        } catch {
          openExternal(source);
          return {
            ok: true,
            summary: 'Havola brauzerda ochildi',
            payload: { havola: source, izoh: 'Fayl brauzer orqali yuklab olinadi' },
          };
        }
      }

      if (!link) {
        return { ok: false, summary: 'Repozitoriy ulanmagan', payload: { error: 'repo_yoq' } };
      }

      // --- reliz fayli (ochiq havola — eng ishonchli yoʻl)
      if (source === 'release') {
        const releases = await listReleases(token, link.owner, link.repo);
        const asset = releases
          .flatMap((r) => r.assets ?? [])
          .find((a) => a.name.toLowerCase().includes(want)) ??
          releases.flatMap((r) => r.assets ?? [])[0];
        if (!asset) {
          return {
            ok: false,
            summary: 'Relizda fayl yoʻq',
            payload: { error: 'asset_yoq', izoh: 'Avval reliz yasab, faylni unga qoʻshish kerak' },
          };
        }
        try {
          const bytes = await fetchBinary(asset.browser_download_url);
          return await hand(asset.name, bytes);
        } catch {
          openExternal(asset.browser_download_url);
          return {
            ok: true,
            summary: `«${asset.name}» brauzerda ochildi`,
            payload: { havola: asset.browser_download_url },
          };
        }
      }

      // --- Actions artefakti
      const runs = await listRuns(token, link.owner, link.repo, 10);
      const done = runs.find((r) => r.conclusion === 'success');
      if (!done) {
        return {
          ok: false,
          summary: 'Muvaffaqiyatli yigʻilish topilmadi',
          payload: { error: 'run_yoq', izoh: 'Avval run_workflow, keyin check_workflow' },
        };
      }

      const artifacts = await listRunArtifacts(token, link.owner, link.repo, done.id);
      const live = artifacts.filter((a) => !a.expired);
      if (!live.length) {
        return {
          ok: false,
          summary: 'Natija fayllari yoʻq yoki muddati oʻtgan',
          payload: { error: 'artifact_yoq', havola: done.html_url },
        };
      }
      const chosen = live.find((a) => a.name.toLowerCase().includes(want)) ?? live[0];

      try {
        const zip = await downloadArtifact(token, link.owner, link.repo, chosen.id);
        const files = unzipSync(zip);
        const names = Object.keys(files);
        const pick =
          names.find((n) => n.toLowerCase().includes(want)) ??
          names.find((n) => n.toLowerCase().endsWith('.apk')) ??
          names[0];
        if (!pick) {
          return { ok: false, summary: 'Zip boʻsh chiqdi', payload: { error: 'bosh_zip' } };
        }
        return await hand(pick.split('/').pop() || pick, files[pick]);
      } catch (err) {
        // Brauzer artefakt yuklashga ruxsat bermadi — ish sahifasini ochamiz.
        openExternal(done.html_url);
        return {
          ok: false,
          summary: 'Artefaktni ilova ichida yuklab boʻlmadi',
          payload: {
            error: String((err as Error)?.message ?? err),
            havola: done.html_url,
            koʻrsatma:
              'Foydalanuvchiga: fayl GitHub sahifasida ochildi, «Artifacts» boʻlimidan ' +
              'yuklab oladi. Keyingi safar ish oqimiga reliz qadamini qoʻshsang ' +
              '(softprops/action-gh-release@v2), fayl toʻgʻridan-toʻgʻri yuboriladi.',
          },
        };
      }
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
      const cut = (shot.fullHeight ?? 0) > shot.height;
      const size = `${shot.width}×${shot.height}`;
      const cutNote = cut
        ? { eslatma_2: `Sahifa ${shot.fullHeight}px — rasmda faqat yuqori qismi` }
        : {};

      // Joriy model rasmni koʻra oladimi? Koʻrmasa rasmni YUBORMAYMIZ —
      // aks holda provayder «rasm kiritishni qoʻllab-quvvatlamaydi» deb xato
      // beradi va agentning ishi oʻrtada uzilib qoladi.
      const active = pickForProject('reja', getCodeProject(projectId)?.model);
      if (supportsVision(active)) {
        return {
          ok: true,
          summary: `Skrinshot olindi (${size})`,
          payload: {
            status: 'rasm keyingi xabarda koʻrsatiladi',
            oʻlcham: size,
            ...cutNote,
            eslatma:
              'Rasmga qara: joylashuv, boʻsh joy, matn oʻlchami, ranglar mos kelyaptimi. ' +
              'Kamchilik koʻrsang tuzat va qayta suratga ol.',
          },
          image,
        };
      }

      // Koʻrmaydigan model uchun: rasmni KOʻRADIGAN modelga baholab beramiz
      // va matnli xulosani qaytaramiz — shunda ish davom etadi.
      onStep?.('skrinshot boshqa modelga baholashga berildi');
      const critique = await critiqueShot(image, project.name, signal).catch((err) => {
        if ((err as Error)?.name === 'AbortError') throw err;
        return '';
      });
      return {
        ok: true,
        summary: critique ? `Skrinshot baholandi (${size})` : `Skrinshot olindi (${size})`,
        payload: {
          oʻlcham: size,
          ...cutNote,
          eslatma: critique
            ? 'Sening modeling rasmni koʻrmaydi, shuning uchun rasmni koʻra oladigan ' +
              'boshqa model baholab berdi. Quyidagi xulosaga tayanib tuzat.'
            : 'Sening modeling rasmni koʻrmaydi va baholaydigan model ham topilmadi. ' +
              'test_app hisobotiga tayanib ishla.',
          dizayn_xulosasi: critique || undefined,
        },
      };
    }

    case 'supabase': {
      const action = str(args.action, 'schema');
      const table = str(args.table);

      if (action === 'schema') {
        const tables = await sbSchema();
        return {
          ok: true,
          summary: `${tables.length} ta jadval`,
          payload: {
            jadvallar: tables.map(
              (t) =>
                `${t.name}(${t.columns
                  .map((c) => `${c.name}:${c.type}${c.required ? '*' : ''}`)
                  .join(', ')})`,
            ),
            eslatma: tables.length
              ? '* — majburiy ustun. Yozuv qoʻshishda shu nomlardan foydalan.'
              : 'Jadval yoʻq. `sql` amali bilan CREATE TABLE matnini yozib ber.',
          },
        };
      }

      if (action === 'sql') {
        const raw = Array.isArray(args.sql_columns) ? args.sql_columns : [];
        const columns = raw
          .map((c) => {
            const item = (c ?? {}) as Record<string, unknown>;
            return {
              name: str(item.name),
              type: str(item.type, 'text'),
              nullable: str(item.nullable) === 'true',
            };
          })
          .filter((c) => c.name);
        if (!table || !columns.length) {
          return {
            ok: false,
            summary: 'Jadval nomi yoki ustunlar berilmadi',
            payload: { error: 'table va sql_columns kerak' },
          };
        }
        const sql = createTableSql(table, columns);
        // SQL ni loyihaga fayl qilib qoʻyamiz — foydalanuvchi nusxalab oladi.
        writeProjectFile(projectId, `supabase/${table}.sql`, sql);
        return {
          ok: true,
          summary: `SQL yozildi: supabase/${table}.sql`,
          payload: {
            sql,
            eslatma:
              'Bu SQL ni Daho bajara olmaydi (anon kalit DDL ga ruxsat bermaydi). ' +
              'Foydalanuvchiga ayt: Supabase → SQL Editor ga qoʻyib bir marta ishga ' +
              'tushirsin, keyin `schema` bilan tekshirasan.',
          },
        };
      }

      if (!table) {
        return { ok: false, summary: 'Jadval nomi berilmadi', payload: { error: 'table kerak' } };
      }

      if (action === 'select') {
        const rows = await sbSelect(table, {
          columns: str(args.columns),
          filter: str(args.filter),
          order: str(args.order),
          limit: Math.min(200, Number(args.limit) || 50),
        });
        return {
          ok: true,
          summary: `${rows.length} ta yozuv (${table})`,
          payload: { soni: rows.length, yozuvlar: rows.slice(0, 50) },
        };
      }

      /** JSON matnni xavfsiz oʻqiydi — model buzuq JSON yuborishi mumkin. */
      const parseJson = (value: string, what: string): unknown => {
        try {
          return JSON.parse(value);
        } catch {
          throw new Error(`${what} JSON emas: ${value.slice(0, 120)}`);
        }
      };

      if (action === 'insert') {
        const parsed = parseJson(str(args.rows, '[]'), 'rows');
        const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
        const added = await sbInsert(table, rows);
        return {
          ok: true,
          summary: `${added.length} ta yozuv qoʻshildi (${table})`,
          payload: { qoʻshildi: added.length, natija: added.slice(0, 10) },
        };
      }

      if (action === 'update') {
        const patch = parseJson(str(args.patch, '{}'), 'patch') as Record<string, unknown>;
        const changed = await sbUpdate(table, str(args.filter), patch);
        return {
          ok: true,
          summary: `${changed.length} ta yozuv yangilandi`,
          payload: { yangilandi: changed.length },
        };
      }

      if (action === 'delete') {
        const count = await sbDelete(table, str(args.filter));
        return {
          ok: true,
          summary: `${count} ta yozuv oʻchirildi`,
          payload: { oʻchirildi: count },
        };
      }

      return {
        ok: false,
        summary: `Nomaʼlum amal: ${action}`,
        payload: { error: 'schema | select | insert | update | delete | sql' },
      };
    }

    case 'send_zip': {
      const only = Array.isArray(args.only) ? args.only.map(String) : [];
      const files = only.length
        ? project.files.filter((f) => only.includes(f.path))
        : project.files;
      if (!files.length) {
        return {
          ok: false,
          summary: 'Arxivga soladigan fayl yoʻq',
          payload: { error: 'fayl_yoq', mavjud: project.files.map((f) => f.path) },
        };
      }
      const message = await saveZip(str(args.name, project.name), files);
      return {
        ok: true,
        summary: `${files.length} ta fayl ZIP qilib yuborildi`,
        payload: {
          status: message,
          fayllar: files.length,
          eslatma: 'Foydalanuvchiga ulashish oynasi ochilgani va faylni saqlashi mumkinligini ayt.',
        },
      };
    }

    case 'sb_admin': {
      if (!sbAdminReady()) {
        return {
          ok: false,
          summary: 'Supabase tokeni yoʻq',
          payload: {
            error: 'token_yoq',
            izoh:
              'Foydalanuvchiga ayt: supabase.com/dashboard/account/tokens dan '
              + 'Personal Access Token olib, Sozlamalar → Supabase boʻlimiga qoʻysin.',
          },
        };
      }

      const action = str(args.action, 'projects');
      try {
        if (action === 'projects') {
          const list = await listProjects(signal);
          return {
            ok: true,
            summary: `${list.length} ta loyiha`,
            payload: {
              loyihalar: list.map((p) => ({
                nom: p.name,
                ref: p.ref ?? p.id,
                holat: p.status,
                hudud: p.region,
              })),
            },
          };
        }

        if (action === 'create') {
          const name = str(args.name);
          if (!name) {
            return { ok: false, summary: 'Nom boʻsh', payload: { error: 'name kerak' } };
          }
          const { project, password } = await createProject(
            name,
            { region: str(args.region) || undefined },
            signal,
          );
          const ref = project.ref ?? project.id;
          return {
            ok: true,
            summary: `«${name}» loyihasi ochildi`,
            payload: {
              ref,
              manzil: projectUrl(ref),
              holat: project.status,
              baza_paroli: password,
              izoh:
                'Loyiha 1-2 daqiqada tayyor boʻladi. Parolni foydalanuvchiga '
                + 'koʻrsat — Supabase uni boshqa koʻrsatmaydi.',
            },
          };
        }

        if (action === 'sql') {
          const ref = str(args.ref);
          const query = str(args.query);
          if (!ref || !query) {
            return { ok: false, summary: 'ref va query kerak', payload: { error: 'toʻliqmas' } };
          }
          const result = await runSql(ref, query, signal);
          return {
            ok: true,
            summary: 'SQL bajarildi',
            payload: { natija: JSON.stringify(result).slice(0, 3000) },
          };
        }

        if (action === 'keys') {
          const ref = str(args.ref);
          if (!ref) return { ok: false, summary: 'ref kerak', payload: { error: 'ref' } };
          const keys = await projectKeys(ref, signal);
          return {
            ok: true,
            summary: 'Kalitlar olindi',
            payload: {
              manzil: projectUrl(ref),
              kalitlar: keys.map((k) => ({ nom: k.name, kalit: k.api_key })),
              izoh: 'service_role kalitini mijoz kodiga YOZMA — faqat anon kalitni ishlat.',
            },
          };
        }

        return { ok: false, summary: `Nomaʼlum amal: ${action}`, payload: { error: 'amal' } };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Supabase xatosi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'connect_list': {
      const list = activeConnectors();
      return {
        ok: true,
        summary: list.length ? `${list.length} ta ulanish` : 'Ulanish yoʻq',
        payload: {
          ulanishlar: list.map((c) => ({
            nom: c.name,
            amallar: c.actions.map((a) => ({ nom: a.name, izoh: a.description })),
          })),
        },
      };
    }

    case 'connect_app': {
      const connector = findConnector(str(args.connector));
      if (!connector) {
        return {
          ok: false,
          summary: 'Ulanish topilmadi',
          payload: { bor: activeConnectors().map((c) => c.name) },
        };
      }
      const action = findAction(connector, str(args.action));
      if (!action) {
        return {
          ok: false,
          summary: 'Amal topilmadi',
          payload: { amallar: connector.actions.map((a) => a.name) },
        };
      }
      try {
        const res = await callConnector(
          connector,
          action,
          args.data && typeof args.data === 'object' ? (args.data as Record<string, unknown>) : {},
          signal,
        );
        return {
          ok: res.ok,
          summary: `${connector.name} → ${action.name}: ${res.ok ? 'yuborildi' : `xato ${res.status}`}`,
          payload: { holat: res.status, javob: res.body.slice(0, 1200) },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Ulanib boʻlmadi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'web_search': {
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Soʻrov boʻsh', payload: { error: 'boʻsh' } };
      const { settings } = getState();
      const answer = await searchAnswer(settings.apiKey, geminiModel(settings.model), query, signal);
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

/**
 * Skrinshotni KOʻRA OLADIGAN modelga berib, dizayn xulosasini oladi.
 *
 * Asosiy model (masalan DeepSeek) rasmni koʻrmaydi. Shunday paytda ishni
 * toʻxtatmaymiz: rasmni koʻradigan modeldan (Gemini, GPT, Claude, Kimi…)
 * qisqa tanqid olib, matn koʻrinishida asosiy modelga uzatamiz.
 */
async function critiqueShot(
  image: Attachment,
  projectName: string,
  signal?: AbortSignal,
): Promise<string> {
  const ref = visionCapableRef();
  if (!ref) return '';
  const { settings } = getState();

  let out = '';
  await streamResilient({
    apiKey: settings.apiKey,
    model: ref,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: image.mimeType, data: image.data } },
          {
            text:
              `Bu «${projectName}» mobil ilovasining skrinshoti. Dizaynini qisqa baholab ber ` +
              '(5-8 qator, oʻzbekcha):\n' +
              '- Nima yaxshi koʻrinadi?\n' +
              '- Aniq KAMCHILIKLAR: matn sigʻmagan, element chiqib ketgan, boʻsh joy ' +
              'notoʻgʻri, rang oʻqilmaydi, tugma kichik, tekislanmagan — koʻrganingni ayt.\n' +
              '- Har kamchilikka bitta aniq tuzatish taklifi (masalan «sarlavha 20px, ' +
              'kartochkalar orasi 12px»).\n' +
              'Umumiy maslahat berma — faqat rasmda KOʻRINGAN narsani ayt.',
          },
        ],
      },
    ],
    temperature: 0.3,
    signal,
    onText: (chunk) => {
      out += chunk;
    },
    autoContinue: false,
  });
  return out.trim().slice(0, 2500);
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

  // Model oʻzidan model nomi oʻylab topishi mumkin — roʻyxatda boʻlmasa
  // eʼtiborsiz qoldiramiz, aks holda yordamchi «kalit yoʻq» xatosiga uriladi.
  const known = usableChatModels().some((m) => m.id === modelOverride);
  // Rol uchun model: qoʻlda belgilangani → avto tanlov → loyiha modeli.
  const model =
    (known ? modelOverride : '') || pickForJob(role.slot, project.model || settings.model);

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

function systemPrompt(project: CodeProject, groups: Set<string> = new Set()): string {
  const { settings } = getState();
  const template = templateById(project.template);
  const yopiq = closedCodeGroupsNote(groups);
  return `Sen — "Daho Code", telefonda ishlaydigan dasturchi agentsan. Oʻzbek tilida gaplashasan.

## Loyiha
Nomi: ${project.name}
${project.description ? `Tavsif: ${project.description}` : ''}
GitHub: ${project.repo ? `${project.repo.owner}/${project.repo.repo} (${project.repo.branch})` : 'ulanmagan'}
Jonli havola: ${project.publish?.url ?? 'hali chiqarilmagan'}
GitHub: ${settings.githubToken ? 'ulangan' : 'ULANMAGAN — `connect_service` bilan taklif qil, TOKEN SOʻRAMA'}
Supabase: ${supabaseLink() ? 'ulangan — `supabase` vositasi ishlaydi' : 'ulanmagan — `connect_service` bilan taklif qil'}

Shablon: ${template.name}
${template.brief}

Fayllar:
${fileTree(project) || '(boʻsh)'}
${project.spec ? `\n## Kelishilgan talablar — QATʼIY amal qil\n${project.spec}` : ''}
${planBlock(project)}
${yopiq ? `\n${yopiq}` : ''}

## Sen qanday agentsan
Sen bir marta javob yozib qoʻyadigan chat emassan. Sen — ishni OXIRIGACHA
olib boradigan agentsan. Topshiriq berilganda:
- oʻzing rejalashtirasan, oʻzing yozasan, oʻzing sinaysan, oʻzing tuzatasan;
- toʻxtash uchun ruxsat soʻrab oʻtirmaysan — ish tugaguncha davom etasan;
- «shu yerda toʻxtatib turaman» yoki «keyin davom ettiraman» DEMA. Yoki ishni
  tugat, yoki \`ask_user\` bilan aniq savol ber va javobni kut.

## Qanday ishlaysan
1. **Avval TOP, keyin oʻqi.** Katta loyihada \`grep\` bilan kerakli joyni qidir
   («useState qayerda ishlatilgan», «TODO|FIXME»), \`find_files\` bilan fayl
   naqshini top. Faqat topilgan faylni \`read_file\` qil — kerak boʻlsa
   \`offset\`/\`limit\` bilan bir qismini. Fayllarni bittalab ochib chiqma.
2. **Taxmin qilma — bajarib koʻr.** Hisob, formula, algoritm, maʼlumotni
   qayta ishlash — \`run_js\` bilan haqiqatan ishga tushirib tekshir. Yozgan
   funksiyangni shu yerda sinab koʻr, keyin faylga yoz.
3. **Katta oʻzgarishdan oldin \`checkpoint\`.** Xato qilsang \`undo\` bilan
   qaytasan, \`changes\` bilan nima oʻzgarganini koʻrasan.
4. **Koʻp qadamli ishda \`todo\` roʻyxatini yurit** — foydalanuvchi qayerdaligingni
   koʻrib turadi. Boshida \`set\`, har qadamdan keyin \`done\`.
5. Bir necha faylni birga yozayotganda \`write_files\` bilan bitta chaqiruvda yoz.
6. Hujjat yoki API namunasi kerak boʻlsa — \`fetch_url\` bilan oʻqi, xotirangdagi
   eskirgan maʼlumotga tayanma.
7. Avval kerakli fayllarni \`read_file\` bilan oʻqi — koʻrmasdan yozma.
8. Ishni mayda qadamlarga boʻl. Har bir qadamda bitta faylni oʻzgartir.
9. Kichik tuzatishga \`edit_file\`, katta oʻzgarish yoki yangi faylga \`write_file\`.
10. Ish tugagach qisqacha xulosa yoz: nima oʻzgardi va qanday sinash kerak.
11. Foydalanuvchi "chiqar", "nashr qil", "linkga qoʻy" desa — \`publish\` ni chaqir.
12. "GitHub’ga yubor" desa — \`github_push\`.
13. APK, test yoki deploy kerak boʻlsa: \`write_workflow\` → \`github_push\` →
   \`run_workflow\` → soʻng \`check_workflow\` bilan natijani tekshir. Yiqilsa
   sababini oʻqib, kodni tuzat va qaytadan yubor.
14. **Tayyor faylni foydalanuvchiga BER.** Yigʻish muvaffaqiyatli boʻlgach
   \`send_file\` ni chaqir — APK telefonga saqlanadi va ulashish oynasi ochiladi.
   «GitHub’dan yuklab oling» deb qoʻyish YETARLI EMAS: foydalanuvchi faylni
   ilovaning oʻzidan olishi kerak.
   APK ish oqimini yozganingda oxiriga reliz qadamini ham qoʻsh — shunda
   fayl ochiq havolaga chiqadi va ishonchli yetkaziladi:
   \`\`\`yaml
   - uses: softprops/action-gh-release@v2
     with:
       tag_name: apk-\${{ github.run_number }}
       files: '**/*.apk'
     env:
       GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
   \`\`\`
   (ish oqimiga \`permissions: contents: write\` kerak boʻladi)

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

## SEN NIMANI SINAY OLASAN, NIMANI YOʻQ — buni bil 🚨
\`test_app\` va \`screenshot\` FAQAT brauzerda ishlaydigan HTML/CSS/JS ni
ishga tushiradi. Ular quyidagilarni TEKSHIRMAYDI:
- Node kodi (server.js, bot.js, Express, Telegram bot);
- \`package.json\` skriptlari (\`npm test\`, \`npm start\`);
- GitHub Actions YAML (action nomlari, qadamlar);
- Deploy sozlamalari (Railway, muhit oʻzgaruvchilari).

Yaʼni server kodini yozsang — u SINALMAGAN boʻladi. Shuning uchun:
1. Node yoki bot kodi yozsang, \`write_workflow\` + \`github_push\` +
   \`run_workflow\` + \`check_workflow\` bilan uni GitHub’da HAQIQATAN
   ishga tushir va logini oʻqi. Bu yagona haqiqiy sinov.
2. Buni qila olmasang — foydalanuvchiga OCHIQ ayt: «server qismi sinalmadi».
   Sinalmagan kodni «tayyor» dema.
3. Yozib boʻlgach \`spawn_agent\` bilan \`tekshir\` agentini chaqir va unga
   quyidagilarni aniq soʻrat.

## Server/bot kodida ENG KOʻP UCHRAYDIGAN xatolar — har safar tekshir ✅
Bularni yozayotganda darhol toʻgʻri qil, keyin tekshiruvchiga ham berib chiq:
- **Tashqi maʼlumot** (foydalanuvchi matni, AI javobi) HTML/Markdown ichiga
  qoʻyilsa — belgilarni ekranla (\`<\`, \`>\`, \`&\`). Aks holda xabar
  umuman yuborilmaydi.
- **AI yoki API javobi** hech qachon kafolatlanmaydi: har bir maydonni
  \`?? []\` / \`?? ''\` bilan himoyala, aks holda TypeError chiqadi.
- **Polling sikli**: javob xato boʻlsa ham kutish (sleep) boʻlsin, aks holda
  cheksiz tez sikl hosil boʻlib server limitga uriladi. \`ok\` maydonini tekshir.
- **Bitta tokendan ikkita joyda** foydalanma (server + cron) — konflikt beradi.
- **Fayl yoʻli** foydalanuvchidan kelsa — papkadan tashqariga chiqishni
  (\`..\`) tekshir va papka soʻralganini alohida hal qil.
- **Shaxsiy maʼlumot** beradigan API — kim soʻrayotganini tekshirmasa,
  har kim boshqasining maʼlumotini oʻqiy oladi. Tekshiruv qoʻshilsin.
- **Bitta maʼlumot ikki faylda takrorlanmasin** (masalan mahsulotlar
  roʻyxati) — ular albatta bir-biridan farq qilib ketadi. Bitta manba boʻlsin.
- **Faylga yozadigan baza** deploy’da oʻchib ketadi — foydalanuvchiga ayt.
- **README va kod** bir xil oʻzgaruvchi nomlarini ishlatsin.
- Yozgan har bir YAML’da action nomlari toʻliq boʻlsin
  (\`actions/setup-node@v4\`, \`actions/checkout@v4\`) — qisqartma ishlamaydi.

## Tez va tejamkor ishla ⚡
Har bir chaqiruv vaqt va token yeydi. Shuning uchun:

- **Fayl qidirishda \`grep\` va \`find_files\`** ishlat — fayllarni bittalab
  ochib chiqma. \`grep\` qaysi faylning qaysi qatorida ekanini darrov aytadi.
- **Katta faylni \`offset\`/\`limit\` bilan** qism-qism oʻqi. Butun faylni
  oʻqish faqat u kichik boʻlsa (200 qatorgacha) oʻrinli.
- **Tahrirda \`apply_patch\` yoki \`edit_file\`** ishlat. \`write_file\` faqat
  yangi fayl yoki butunlay qayta yozish uchun — katta faylni qayta yozish
  oʻnlab barobar qimmat.
- **Bir turda bir nechta oʻqish** soʻra (bir necha \`read_file\`, \`grep\`) —
  ular parallel bajariladi va vaqt tejaydi.
- **Bir xil narsani qayta oʻqima.** Oʻqiganingni yodda tut.
- Bir vosita ayni argument bilan 2 marta xato bersa — **uchinchi marta
  urinma**, boshqa yoʻl tanla.

## Qaysi ish qayerda bajariladi ⚖️
Bu muhim — notoʻgʻri joyga bersang ish umuman bitmaydi.

**QURILMADA (telefon/brauzer):**
- Video yigʻish va kodlash — bu allaqachon shunday ishlaydi
- Rasm chizish, canvas ishlari, koʻrinish
- Ovoz eshittirish, mikrofon

Sabab: telefonda apparat kodlovchi bor va u BEPUL — har foydalanuvchi
oʻz qurilmasida ishlaydi. Serverga tashlansa bitta arzon protsessor
hammaga yetmaydi.

**SERVERDA:**
- Fon vazifalari — ilova yopiq boʻlsa ham davom etadigan ishlar
- Uzoq matn yozish (kitob boblari), API chaqiruvlari
- Kod bajarish, kutubxona oʻrnatish, testlar
- Jadval boʻyicha ishlar

**Serverga OGʻIR KODLASHNI TASHLAMA.** ffmpeg bor, lekin u yengil ish
uchun: audio ajratish, format haqida maʼlumot olish, kichik boʻlak
kesish. Butun videoni qayta kodlash — yoʻq. Server arzon protsessorda
turadi, ayni paytda fon vazifalarini ham bajaradi va ikkitadan ortiq
buyruqni birga koʻtarmaydi.

Foydalanuvchi «video qil» desa — ilovaning video boʻlimiga yoʻnaltir,
oʻzing serverda kodlashga urinma.

## Vosita yasab, uni OʻZING ishga tushir 🛠
Foydalanuvchi «shu ishni qiladigan narsa kerak» desa — u odatda tayyor
NATIJANI kutayapti, dastur kodini emas.

Daho serveri ulangan boʻlsa ketma-ketlik shunday:
1. Kerakli vositani yoz (yoki tayyor kutubxonani tanla).
2. \`run_cmd\` bilan oʻrnat: \`pip install …\`, \`npm i …\`.
3. Oʻsha yerda ishga tushir va natijani ol.
4. Natijani foydalanuvchiga ber — \`send_file\` yoki \`send_zip\` bilan.

Masalan «shu jadvalni tahlil qilib grafik chizib ber»: skript yoz →
\`pip install pandas matplotlib\` → ishga tushir → chiqqan rasmni yubor.
Foydalanuvchi kod bilan ovora boʻlmaydi.

Server ulanmagan boʻlsa: oddiy hisob-kitobni \`run_js\` bilan qil; tashqi
dastur kerak boʻlsa serverni ulashni ayt (Sozlamalar → Daho serveri).

**Ogohlantirish:** boshqa saytdan material yuklab beradigan vosita
soʻralsa (video, musiqa, kontent) — oʻsha xizmat shartlarini buzish
mumkinligini bir jumlada ayt, keyin foydalanuvchining oʻz materiali yoki
ruxsat berilgan manba boʻlsa davom et. Qaror foydalanuvchiniki, lekin u
buni bilib turishi kerak.

## Ishni tugatishdan oldin ✅
«Tayyor» deyishdan oldin natijani OʻZING tekshir:

1. \`changes\` bilan nima oʻzgarganini koʻr.
2. Ilova boʻlsa — \`test_app\` yoki \`screenshot\` bilan haqiqatan
   ishlayotganini koʻr.
3. Server ulangan boʻlsa — \`run_cmd\` bilan qurish/testni ishga tushir
   (\`npm run build\`, \`npm test\`). Yashil boʻlmasa tuzat.
4. Server yoʻq boʻlsa — mantiqni \`run_js\` bilan tekshirib koʻr.

Tekshirmasdan «tayyor» dema. Xato chiqsa — oʻzing tuzat, foydalanuvchiga
buzuq kod yuborma.

## Oʻz ishingni SINAB koʻr — majburiy
- \`test_app\` — JS xatolari, sahifa boʻsh chiqdimi, qaysi tugmalar bor.
- \`screenshot\` — haqiqiy koʻrinish rasmi, sen uni koʻrasan.
- Xato chiqsa tuzat va QAYTA sina. Uch marta boʻlmasa — muammoni ochiq ayt.
- Bot yoki Node kodi telefonda ishlamaydi: \`write_workflow\` → \`github_push\` →
  \`run_workflow\` → \`check_workflow\` bilan logini oʻqi. Sinovsiz qoldirma.
- Foydalanuvchi skrinshot yuborsa — undagi xato matnini diqqat bilan oʻqi,
  tegishli faylni ochib sababini top va tuzat.
- Bilmasang \`web_search\` bilan qidir. Taxmin qilib yozma.
- Foydalanuvchi fayllarni soʻrasa («zip qilib ber», «yuklab olaman») —
  \`send_zip\` bilan arxiv qilib yubor.

## Maʼlumot qayerda saqlanadi 🗄
- Kichik ilova, bitta telefon uchun — \`localStorage\` yetarli.
- Roʻyxatga olish, foydalanuvchi hisobi, bir nechta odam koʻradigan umumiy
  maʼlumot kerak boʻlsa — \`supabase\`. Avval \`supabase\` + \`schema\` bilan
  qanday jadval borligini KOʻR, keyin ishla. Jadval yoʻq boʻlsa \`sql\` amali
  bilan CREATE TABLE matnini yozib ber va foydalanuvchiga Supabase → SQL
  Editor ga qoʻyishini ayt (anon kalit jadval yaratolmaydi).
- Supabase ulanmagan boʻlsa avval \`ask_user\` bilan soʻra: localStorage
  bilan davom etaymi yoki Supabase ulaysizmi.

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

  // Ishdan OLDIN nusxa olamiz — agent buzib qoʻysa qaytish mumkin boʻlsin.
  snapshot(projectId, instruction.slice(0, 60) || 'topshiriq');

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

  let contents = toContents([...project.messages, userMsg]);
  const toolCalls: ToolCallRecord[] = [];
  /** Foydalanuvchiga koʻrsatiladigan skrinshot artifactlari */
  const shotIds: string[] = [];
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

  /*
   * Ochiq vosita guruhlari. Topshiriq matnidan taxmin qilinadi; loyihaga
   * repo yoki Supabase ulangan boʻlsa oʻsha guruhlar darrov ochiladi.
   * Model yetmagan vositani `use_tools` bilan oʻzi ochib oladi.
   */
  const groups = new Set<string>(guessCodeGroups(instruction));
  const boshlanish = getCodeProject(projectId);
  if (boshlanish?.repo) groups.add('github');
  if (supabaseLink()) groups.add('supabase');
  // Fayl yuborilgan boʻlsa rasm/asset vositalari darrov kerak boʻladi.
  if (attachments.length || projectAttachments(project).length) groups.add('media');

  /** Agent oʻrtada toʻxtab qolsa nechta marta turtki berish mumkin */
  // Kuchsiz modellar bitta vosita chaqirgach turnini tugatib qoʻyadi.
  // Foydalanuvchi «Continue» deb yozib oʻtirmasligi uchun koʻp marta
  // turtki beramiz — haqiqiy agent ishni oʻzi oxirigacha olib boradi.
  const MAX_NUDGES = 14;
  let nudges = 0;

  try {
    // Sikl oxirigacha yetib borsa — ish tugamagan, qadamlar tugagan.
    let finished = false;
    const guard = createLoopGuard();
    let compacted = 0;

    for (let round = 0; round < maxRounds; round += 1) {
      // Uzun ishda eski vosita natijalari kontekstni shishiradi. Ularni
      // qisqartiramiz — model oxirgi qadamlar ustida ishlaydi, eskisi
      // kerak boʻlsa vositani qayta chaqiradi.
      if (round > 0 && round % 6 === 0) {
        const before = contextSize(contents);
        if (before > 120_000) {
          const res = compactContents(contents);
          if (res.saved > 0) {
            contents = res.contents;
            compacted += res.saved;
            onStep?.(`kontekst siqildi — ${Math.round(res.saved / 1000)}k belgi tejaldi`);
          }
        }
      }

      // Har turda tizim koʻrsatmasi yangilanadi — fayl roʻyxati oʻzgargan boʻlishi mumkin.
      const current = getCodeProject(projectId);
      if (!current) {
        finished = true;
        break;
      }

      /*
       * Har turda qayta yigʻamiz: model `use_tools` bilan yangi guruh
       * ochgan boʻlishi mumkin.
       */
      const names = codeToolNames(groups);
      const declarations = CODE_TOOLS.filter((t) => names.has(t.name));

      const result = await streamResilient({
        apiKey: settings.apiKey,
        // AVTO yoqilgan boʻlsa u ustun; oʻchiq boʻlsa loyihaning modeli.
        model: pickForProject('reja', current.model),
        contents,
        systemInstruction: systemPrompt(current, groups),
        tools: declarations,
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

      // Bir turda bir nechta vosita soʻralsa, faqat OʻQIYDIGANLARINI
      // parallel bajaramiz — ular bir-biriga xalal bermaydi. Fayl
      // yozadiganlar navbat bilan qoladi, aks holda ikki yozuv
      // bir-birining ustiga tushib ketishi mumkin.
      const parallel = result.functionCalls.filter((c) => READ_ONLY_TOOLS.has(c.name));
      const precomputed = new Map<number, ToolResult>();
      if (parallel.length > 1) {
        onStep?.(`${parallel.length} ta soʻrov parallel bajarilmoqda`);
        const done = await Promise.all(
          parallel.map(async (call) => {
            try {
              return await runTool(projectId, call.name, call.args, signal, onStep, 0);
            } catch (err) {
              if ((err as Error)?.name === 'AbortError') throw err;
              return {
                ok: false,
                summary: `${call.name}: ${(err as Error).message}`,
                payload: { error: (err as Error).message },
              } as ToolResult;
            }
          }),
        );
        parallel.forEach((call, i) => {
          precomputed.set(result.functionCalls.indexOf(call), done[i]);
        });
      }

      for (const [index, call] of result.functionCalls.entries()) {
        onStep?.(STEP_LABEL[call.name] ?? call.name);
        let outcome: ToolResult;
        const ready = precomputed.get(index);
        if (ready) {
          outcome = ready;
        } else {
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
        }
        if (call.name === 'use_tools') {
          for (const g of (outcome.payload.opened as string[] | undefined) ?? []) {
            groups.add(g);
          }
        }
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: outcome.ok,
          summary: outcome.summary,
          at: accumulated.length,
        });
        if (outcome.image) {
          shots.push(outcome.image);
          // Skrinshotni FOYDALANUVCHI ham koʻrishi kerak — agent nimani
          // koʻrgani unga ham koʻrinsin, faqat modelga emas.
          const shotArtifact: Artifact = {
            id: uid('a_'),
            kind: 'image',
            title: `Skrinshot — ${project.name}`,
            content: outcome.image.data,
            mimeType: outcome.image.mimeType,
            createdAt: Date.now(),
          };
          setState((s) => ({ artifacts: [shotArtifact, ...s.artifacts] }));
          shotIds.push(shotArtifact.id);
          patchMessage(projectId, modelMsg.id, { artifactIds: [...shotIds] });
        }
        responses.push({ functionResponse: { name: call.name, response: outcome.payload } });

        // Bir xil chaqiruv qayta-qayta xato bersa — agent tiqilib qolgan.
        const warning = guard.note(call.name, call.args, outcome.ok);
        if (warning) {
          responses.push({ text: `⚠️ ${warning}` });
          onStep?.('takroriy xato — boshqa yoʻl qidirilmoqda');
        }
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
      artifactIds: shotIds.length ? [...shotIds] : undefined,
    });
    return { ok: true, text: accumulated };
  } catch (err) {
    if (flush) clearTimeout(flush);
    const aborted = (err as Error)?.name === 'AbortError';
    patchMessage(projectId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      artifactIds: shotIds.length ? [...shotIds] : undefined,
      error: aborted ? 'Toʻxtatildi.' : String((err as Error)?.message ?? err),
    });
    return { ok: false, text: accumulated };
  }
}
