import { askUser } from './ask';
import { b64ToBytes } from './audio';
import { createBook, writeBook } from './book';
import { activeConnectors, callConnector, findAction, findConnector } from './connectors';
import { helperRole, runHelper } from './helper';
import {
  addEvent,
  googleReady,
  listDrive,
  listEvents,
  readDrive,
  readMail,
  searchMail,
  sendMail,
} from './google';
import {
  igComments,
  igConversations,
  igHide,
  igMedia,
  igMessages,
  igReady,
  igReply,
  igSend,
  ytComments,
  ytReply,
  ytVideos,
} from './social';
import {
  tgBroadcast,
  tgBusiness,
  tgChatInfo,
  tgChats,
  tgContacts,
  tgMe,
  tgPin,
  tgReady,
  tgSend,
  tgPostStory,
  tgSchedule,
  tgSendAs,
  tgSendMediaAs,
  tgSetCommands,
  tgSync,
} from './telegram';
import { fetchImageData, searchImages } from './imagesearch';
import { canSearchWeb, imageAny, jsonAny, searchAny, visionAny } from './providers';
import { DOC_LABEL, exportDocument, saveBytes, saveZip, type DocFormat } from './exporter';
import {
  DOCX_MIME,
  buildDocxWithImages,
  imageSize,
  placeImages,
  readDocx,
  type DocImage,
} from './office';
import type { FunctionDeclaration } from './gemini';
import {
  describeSpot,
  directionsUrl,
  distanceM,
  findPlace,
  getSpot,
  humanDistance,
  type Place,
  type Spot,
  type TravelMode,
} from './place';
import { openSite } from './browserbus';
import { synthesize } from './speech';
import {
  connectable,
  connected,
  startConnect,
  type OauthProvider,
  type ProviderInfo,
} from './oauth';
import { SKILLS, skillById } from './skills';
import { TOOL_GROUPS } from './toolpick';
import { getState, setState } from './store';
import { DAYS } from './types';
import type {
  Artifact,
  Attachment,
  RoutePlan,
  Course,
  CourseTopic,
  Note,
  Priority,
  Project,
  ScheduleItem,
  Task,
  TimeLog,
} from './types';
import { fmtDuration, todayISO, uid, weekdayIndex } from './utils';
import {
  chunkCaptions,
  clock,
  findVideos,
  keepReal,
  languageName,
  parseYouTube,
  readVideo,
  searchUrl,
  toNarration,
  toSrt,
} from './ytube';

export interface ToolOutcome {
  ok: boolean;
  /** Foydalanuvchiga koʻrsatiladigan qisqa izoh */
  summary: string;
  /** Modelga qaytariladigan javob */
  payload: Record<string, unknown>;
  /** Vosita yasagan artifactlar — xabarga biriktiriladi (rasm va h.k.) */
  artifacts?: Artifact[];
  /** Vosita ochgan yoʻl kartasining id si */
  route?: string;
}

/** Oxirgi aniqlangan joylashuv — qidiruvni shu atrofga yaqinlashtiradi. */
let recentSpot: Spot | null = null;
const lastSpot = (): Spot | undefined => recentSpot ?? undefined;
const setLastSpot = (spot: Spot) => {
  recentSpot = spot;
};

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback;

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function normPriority(v: unknown): Priority {
  const s = str(v, 'orta').toLowerCase();
  if (s.startsWith('yuq') || s === 'high') return 'yuqori';
  if (s.startsWith('pas') || s === 'low') return 'past';
  return 'orta';
}

function normDay(v: unknown): number {
  if (typeof v === 'number' && v >= 0 && v <= 6) return Math.floor(v);
  const s = str(v).toLowerCase();
  const idx = DAYS.findIndex((d) => d.toLowerCase().startsWith(s.slice(0, 3)));
  return idx >= 0 ? idx : weekdayIndex();
}

function normTime(v: unknown, fallback: string): string {
  const s = str(v);
  const m = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Modelga beriladigan funksiya e'lonlari. */
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'create_note',
    description:
      'Foydalanuvchi uchun yangi konspekt/eslatma yaratadi. Darsdan olingan bilim, formulalar, qisqacha mavzu bayoni uchun ishlatiladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Qisqa sarlavha' },
        content: { type: 'STRING', description: 'Toʻliq matn, markdown boʻlishi mumkin' },
        subject: { type: 'STRING', description: 'Fan nomi, masalan "Matematik analiz"' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'create_task',
    description: 'Bajariladigan vazifa (uy vazifasi, topshiriq, deadline) qoʻshadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Vazifa matni' },
        due: { type: 'STRING', description: 'Muddat, YYYY-MM-DD koʻrinishida' },
        priority: { type: 'STRING', description: 'past | orta | yuqori' },
        project: { type: 'STRING', description: 'Bogʻliq loyiha nomi (ixtiyoriy)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'add_schedule_item',
    description:
      'Haftalik dars jadvaliga yangi dars qoʻshadi. Har hafta takrorlanadigan darslar uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        day: { type: 'STRING', description: 'Hafta kuni nomi yoki 0-6 (0=Dushanba)' },
        start: { type: 'STRING', description: 'Boshlanish vaqti HH:MM' },
        end: { type: 'STRING', description: 'Tugash vaqti HH:MM' },
        subject: { type: 'STRING', description: 'Fan nomi' },
        room: { type: 'STRING', description: 'Xona/auditoriya' },
        teacher: { type: 'STRING', description: 'Oʻqituvchi' },
        kind: { type: 'STRING', description: 'maruza | amaliyot | lab | boshqa' },
      },
      required: ['day', 'start', 'subject'],
    },
  },
  {
    name: 'create_project',
    description:
      'Bosqichlari bilan yangi loyiha rejasi yaratadi. Kurs ishi, diplom, mustaqil ish kabi katta ishlar uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Loyiha nomi' },
        description: { type: 'STRING', description: 'Qisqa tavsif va maqsad' },
        steps: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Bosqichlar roʻyxati, tartib boʻyicha',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'log_work',
    description:
      'Tugallangan ish vaqtini qaydnomaga yozadi. Masalan "bugun 90 daqiqa fizika oʻqidim".',
    parameters: {
      type: 'OBJECT',
      properties: {
        label: { type: 'STRING', description: 'Nima ish qilingani' },
        minutes: { type: 'NUMBER', description: 'Necha daqiqa' },
        note: { type: 'STRING', description: 'Qoʻshimcha izoh' },
      },
      required: ['label', 'minutes'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mavjud vazifani bajarilgan deb belgilaydi (nomi boʻyicha qidiradi).',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Vazifa nomi yoki uning bir qismi' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_course',
    description:
      'Foydalanuvchi biror sohani oʻrganmoqchi boʻlsa (IELTS, dasturlash, matematika va h.k.) ' +
      'toʻliq kurs ochadi: mavzular roʻyxati bilan. Har bir mavzu keyinchalik bosilganda ' +
      'interaktiv darsga aylanadi. Mavzular soni 20 tadan 100 tagacha boʻlsin, oson mavzudan ' +
      'murakkabiga qarab tartiblangan.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Kurs nomi' },
        field: { type: 'STRING', description: 'Soha, masalan "IELTS" yoki "Python"' },
        goal: { type: 'STRING', description: 'Foydalanuvchining maqsadi' },
        level: { type: 'STRING', description: 'boshlangʻich | oʻrta | yuqori' },
        topics: {
          type: 'ARRAY',
          description: 'Mavzular, tartib boʻyicha',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING', description: 'Mavzu nomi' },
              summary: { type: 'STRING', description: 'Bir jumlada nima oʻrganiladi' },
            },
          },
        },
      },
      required: ['title', 'field', 'topics'],
    },
  },
  {
    name: 'search_images',
    description:
      'INTERNETDAN haqiqiy rasm qidiradi va manbasi bilan qaytaradi ' +
      '(Openverse va Wikimedia — bepul, litsenziyali rasmlar).\n' +
      'Qachon ishlatiladi: foydalanuvchi «rasmini koʻrsat», «qanday koʻrinadi», ' +
      '«namuna/misol rasm», «ilhom uchun rasmlar» desa; yoki haqiqiy joy, ' +
      'odam, hayvon, tarixiy voqea, mahsulot haqida gapirilsa.\n' +
      'Rasm YASASH kerak boʻlsa (chizma, logotip, muqova) — `generate_image` ishlat. ' +
      'Bu vosita esa mavjud, haqiqiy rasmlarni topadi.\n' +
      'Qidiruv soʻzini INGLIZ tilida yoz — natija ancha koʻp boʻladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Qidiruv soʻzi, ingliz tilida (masalan "korean skincare routine")',
        },
        count: { type: 'NUMBER', description: 'Nechta rasm kerak (standart 8, koʻpi 20)' },
        save: {
          type: 'STRING',
          description:
            '"true" — rasmlarni ilovaga saqlash (hujjatga qoʻyish yoki koʻrish uchun). ' +
            'Standart: faqat havola va manba qaytariladi.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_book',
    description:
      'KITOB yozishni boshlaydi. Foydalanuvchi «kitob yozmoqchiman», «menga kitob yozib ber», ' +
      '«qissa/roman/qoʻllanma yoz» desa shuni chaqir.\n' +
      'MUHIM: chaqirishdan OLDIN `ask_user` bilan kamida 3 ta narsani aniqla — ' +
      'kitob nima haqida va turi (badiiy/oʻquv/biznes), kim uchun, hajmi (necha bob). ' +
      'Rasm kerakmi, ohangi qanday boʻlsin — buni ham soʻrasang yaxshi.\n' +
      'Vosita ishga tushgach kitob oʻzi yoziladi: reja va qahramonlar, muqova rasmi, ' +
      'soʻng bob-bob matn. Foydalanuvchi jarayonni «Agent → Kitoblar» boʻlimida koʻradi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        request: {
          type: 'STRING',
          description:
            'Kitob haqida toʻliq tavsif: mavzu, tur, ohang, kim uchun, foydalanuvchi ' +
            'aytgan barcha tafsilotlar bir joyda.',
        },
        kind: { type: 'STRING', description: 'badiiy | oʻquv qoʻllanma | biznes | bolalar…' },
        chapters: { type: 'NUMBER', description: 'Boblar soni (standart 12)' },
        words: { type: 'NUMBER', description: 'Har bobda taxminan necha soʻz (standart 1200)' },
        images: { type: 'STRING', description: '"false" — rasmsiz kitob' },
      },
      required: ['request'],
    },
  },
  {
    name: 'send_file',
    description:
      'Foydalanuvchining telefoniga FAYL yuboradi: PDF, Word, matn (.md), slayd ' +
      'yoki ZIP. Ulashish oynasi ochiladi — u saqlaydi yoki boshqa ilovaga yuboradi.\n' +
      'Foydalanuvchi «pdf qilib ber», «word qilib yubor», «fayl qilib tashla», ' +
      '«yuklab olaman» desa chaqir. Uzun matnni chatga koʻchirib yozmasdan shu ' +
      'vosita bilan fayl qilib ber.\n' +
      'ZIP uchun `files` massivini toʻldir (bir nechta fayl), qolgan turlar uchun ' +
      '`content` ga markdown matnni yoz.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Fayl nomi (kengaytmasiz)' },
        format: {
          type: 'STRING',
          description: 'pdf | docx | md | pptx | zip',
        },
        content: {
          type: 'STRING',
          description: 'Markdown matn (pdf/docx/md/pptx uchun). Sarlavhalar # bilan.',
        },
        files: {
          type: 'ARRAY',
          description: 'ZIP uchun fayllar',
          items: {
            type: 'OBJECT',
            properties: {
              path: { type: 'STRING', description: 'Fayl nomi, masalan "reja.md"' },
              content: { type: 'STRING' },
            },
          },
        },
      },
      required: ['name', 'format'],
    },
  },
  {
    name: 'ask_user',
    description:
      'Foydalanuvchidan aniqlik soʻraydi va javobini kutadi. Ish yoʻnalishi ' +
      'noaniq boʻlsa, bir nechta yoʻl boʻlsa yoki muhim tanlov kerak boʻlsa shuni chaqir. ' +
      'Taxmin qilib ishni notoʻgʻri qilgandan koʻra bir marta soʻragan yaxshi. ' +
      'Lekin mayda-chuyda uchun soʻrama — oddiy narsani oʻzing hal qil.',
    parameters: {
      type: 'OBJECT',
      properties: {
        question: { type: 'STRING', description: 'Aniq, qisqa savol — oʻzbek tilida' },
        options: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tayyor variantlar (2-5 ta). Erkin javob ham har doim mumkin.',
        },
        multi: { type: 'STRING', description: '"true" — bir nechta variant tanlansa boʻladi' },
      },
      required: ['question'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Rasm chizadi yoki suhbatdagi oxirgi rasmni tahrirlaydi. Foydalanuvchi rasm, surat, ' +
      'illyustratsiya, logotip, plakat, chizma soʻraganda yoki mavjud rasmni oʻzgartirishni ' +
      'soʻraganda shuni chaqir. Yasalgan rasm chatda darhol koʻrinadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description:
            'Rasm tavsifi — ingliz tilida, batafsil: nima tasvirlangan, uslub, rang, yorugʻlik, rakurs.',
        },
        edit_last: {
          type: 'STRING',
          description:
            '"true" — suhbatdagi oxirgi rasmni asos qilib tahrirlaydi (foydalanuvchi "buni oʻzgartir" desa).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'get_location',
    description:
      'Foydalanuvchining HOZIRGI joylashuvini oladi (GPS) va manzil nomini qaytaradi. ' +
      '«Qayerdaman», «yaqin atrofda», «shu yerdan qanday boraman» kabi savollarda ' +
      'birinchi shuni chaqir.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'find_place',
    description:
      'Joy nomi boʻyicha xaritadan qidiradi (universitet, bekat, kasalxona, doʻkon) va ' +
      'koordinata bilan qaytaradi. Manzil kerak boʻlganda ishlat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Joy nomi, masalan "Konkuk University"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_web',
    description:
      'Google qidiruvi orqali JONLI maʼlumot topadi: avtobus va metro raqamlari, ' +
      'jadval, narx, ish vaqti, yangilik, ob-havo. Sening bilimingda yoʻq yoki ' +
      'eskirgan boʻlishi mumkin boʻlgan har qanday narsani shu bilan tekshir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'Qidiruv savoli — toʻliq jumla boʻlsin, kerak boʻlsa ingliz tilida',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_site',
    description:
      'Saytni ilovaning ichki brauzerida ochib beradi. Foydalanuvchi «shu saytni och», ' +
      '«hujjatini koʻrsat», «ro‘yxatdan o‘tkaz» desa yoki javobda muhim manba boʻlsa ishlat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Toʻliq manzil' },
        why: { type: 'STRING', description: 'Nima uchun ochilyapti — bir jumla' },
      },
      required: ['url'],
    },
  },
  {
    name: 'find_video',
    description:
      'Mavzu boʻyicha YouTube dan video topadi. Foydalanuvchi «video topib ber», ' +
      '«videosini koʻrsat», «tushuntiruvchi video» desa shuni chaqir. ' +
      'Topilgan havolalar chatda pleyer boʻlib chiqadi — havolani matnda qayta yozma.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Nima haqida video kerak' },
        language: {
          type: 'STRING',
          description: 'Qaysi tildagi video afzal (masalan «oʻzbek», «rus», «ingliz»). Boʻsh boʻlsa farqi yoʻq.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_video',
    description:
      'YouTube videoni koʻrib chiqadi: mazmunini yozadi va subtitrini tarjima qiladi. ' +
      'Foydalanuvchi «bu videoda nima deyilyapti», «tarjima qil», «subtitr qilib ber» desa ishlat. ' +
      'format="srt" boʻlsa subtitr fayli ham yasaladi. '
      + 'Uzun videoda aniq narsa soʻralsa `question` ni ber — ichidan oʻsha joy topiladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'YouTube havolasi' },
        lang: { type: 'STRING', description: 'Qaysi tilga tarjima qilinsin: uz-UZ, ru-RU, en-US, tr-TR' },
        format: { type: 'STRING', description: '«matn» (standart) yoki «srt»' },
        question: {
          type: 'STRING',
          description:
            'Videodan NIMA topish kerakligi. Berilsa butun subtitr emas, faqat shu '
            + 'savolga tegishli boʻlaklar (vaqti bilan) qaytariladi — uzun videoda '
            + 'token behuda sarflanmaydi.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'dub_video',
    description:
      'YouTube videoni soʻralgan tilda BITTA ovozli fayl qilib oʻqib beradi ' +
      '(videoning ovozini almashtirmaydi — alohida audio yasaladi). ' +
      'Foydalanuvchi «videoni tarjima qilib oʻqib ber», «ovozini oʻzbekchaga oʻgir» desa ishlat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'YouTube havolasi' },
        lang: { type: 'STRING', description: 'Ovoz tili: uz-UZ, ru-RU, en-US, tr-TR' },
      },
      required: ['url'],
    },
  },
  {
    name: 'plan_route',
    description:
      'Hozirgi joylashuvdan berilgan manzilgacha yoʻl kartasini ochadi: masofa, ' +
      'jamoat transporti (metro/avtobus) varianti va JONLI kuzatuv. Foydalanuvchi ' +
      '«falon joyga bormoqchiman» desa shuni chaqir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination: { type: 'STRING', description: 'Boriladigan joy nomi' },
        mode: {
          type: 'STRING',
          description: 'transit (jamoat transporti, standart), walking, driving, bicycling',
        },
      },
      required: ['destination'],
    },
  },
  {
    name: 'illustrate_document',
    description:
      'Suhbatga biriktirilgan hujjatga (Word .docx yoki PDF) rasm qoʻshib, yangi ' +
      '.docx fayl yasab beradi va telefonga saqlaydi. Foydalanuvchi «kitobga rasm ' +
      'qoʻshib ber», «hujjatni bezab ber», «illyustratsiya qoʻsh» desa shuni chaqir. ' +
      'Rasmlar mazmunga qarab mos joylarga qoʻyiladi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        count: { type: 'NUMBER', description: 'Nechta rasm kerak (1-12, standart 5)' },
        style: {
          type: 'STRING',
          description: 'Rasm uslubi, masalan "realistik surat", "bolalar kitobi rasmi", "chizma"',
        },
        note: { type: 'STRING', description: 'Qoʻshimcha talab (ranglar, qahramon, mavzu)' },
      },
    },
  },
  {
    name: 'delegate',
    description:
      'YORDAMCHI AGENT chaqiradi — ish katta boʻlsa boʻlaklab, har boʻlagini '
      + 'alohida mutaxassisga berasan. Yordamchi oʻz modeli bilan ishlaydi, '
      + 'kerak boʻlsa internetdan qidiradi, sayt va video oʻqiydi, keyin senga '
      + 'hisobot qaytaradi.\n'
      + 'Rollar: "tadqiqot" (maʼlumot yigʻish), "matn" (yozish, tahrirlash, '
      + 'tarjima), "tekshir" (xato va nomuvofiqlik qidirish), "reja" '
      + '(bosqichlarga ajratish).\n'
      + 'Qachon ishlatasan: mavzu keng boʻlsa va bir nechta yoʻnalishni '
      + 'parallel oʻrganish kerak boʻlsa; uzun matnni yozdirib, keyin '
      + 'tekshirtirish kerak boʻlsa. Oddiy savolga chaqirma — oʻzing javob ber.',
    parameters: {
      type: 'OBJECT',
      properties: {
        role: { type: 'STRING', description: 'tadqiqot | matn | tekshir | reja' },
        task: {
          type: 'STRING',
          description:
            'Toʻliq va aniq topshiriq. Yordamchi suhbat tarixini KOʻRMAYDI — '
            + 'kerakli kontekstni shu yerda yozib ber.',
        },
      },
      required: ['role', 'task'],
    },
  },
  {
    name: 'google',
    description:
      'Foydalanuvchining Google hisobi bilan ishlaydi — Gmail, Drive, Kalendar.\n'
      + 'Amallar:\n'
      + '- `mail_search` — xat qidirish (`query`: Gmail sintaksisi, masalan '
      + '"from:dekanat is:unread" yoki "subject:imtihon")\n'
      + '- `mail_read` — xatning toʻliq matni (`id`)\n'
      + '- `mail_send` — xat yuborish (`to`, `subject`, `body`)\n'
      + '- `drive_list` — fayllar (`query` — nom boʻyicha)\n'
      + '- `drive_read` — fayl matni (`id`); Google Docs ham oʻqiladi\n'
      + '- `calendar_list` — yaqin kunlardagi voqealar (`days`)\n'
      + '- `calendar_add` — voqea qoʻshish (`summary`, `start`, `end` — ISO vaqt)\n'
      + 'Xat yuborishdan OLDIN foydalanuvchiga matnini koʻrsatib tasdiqlat — '
      + 'yuborilgan xatni qaytarib boʻlmaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'mail_search | mail_read | mail_send | drive_list | drive_read | calendar_list | calendar_add' },
        query: { type: 'STRING' },
        id: { type: 'STRING' },
        to: { type: 'STRING' },
        subject: { type: 'STRING' },
        body: { type: 'STRING' },
        summary: { type: 'STRING' },
        start: { type: 'STRING', description: 'ISO vaqt, masalan 2026-08-25T14:00:00+05:00' },
        end: { type: 'STRING' },
        days: { type: 'NUMBER' },
        limit: { type: 'NUMBER' },
      },
      required: ['action'],
    },
  },
  {
    name: 'instagram',
    description:
      'Instagram Business/Creator hisobi bilan ishlaydi — RASMIY Graph API '
      + 'orqali. Minglab izoh va DM ga javob berish uchun aynan shu yoʻl.\n'
      + 'Amallar:\n'
      + '- `media` — oxirgi postlar (id, izohlar soni)\n'
      + '- `comments` — postdagi izohlar (`media_id`); javob berilganlari belgilanadi\n'
      + '- `reply` — izohga javob (`comment_id`, `message`)\n'
      + '- `hide` — izohni yashirish (`comment_id`) — spam yoki haqorat uchun\n'
      + '- `chats` — Direct suhbatlar roʻyxati\n'
      + '- `messages` — suhbatdagi xabarlar (`conversation_id`)\n'
      + '- `send` — Direct xabar yuborish (`user_id`, `message`)\n'
      + 'MUHIM: Instagram faqat odam SIZGA yozgan boʻlsa va oxirgi xabardan '
      + '24 soat oʻtmagan boʻlsa javob berishga ruxsat beradi. Bu Meta ning '
      + 'qoidasi, chetlab oʻtib boʻlmaydi.\n'
      + 'Koʻp odamga javob berayotganda har biriga ALOHIDA, savoliga mos '
      + 'javob yoz — bir xil matnni koʻchirma, buni Instagram spam deb '
      + 'belgilaydi va odamlar ham sezadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'media | comments | reply | hide | chats | messages | send' },
        media_id: { type: 'STRING' },
        comment_id: { type: 'STRING' },
        conversation_id: { type: 'STRING' },
        user_id: { type: 'STRING' },
        message: { type: 'STRING' },
        limit: { type: 'NUMBER' },
      },
      required: ['action'],
    },
  },
  {
    name: 'telegram',
    description:
      'Telegram boti bilan toʻliq ishlaydi — xabar oʻqish, javob berish, '
      + 'guruh va kanal boshqarish, koʻp odamga birdan yuborish.\n'
      + 'Amallar:\n'
      + '- `bot` — bot haqida maʼlumot (ulanish tekshiruvi)\n'
      + '- `sync` — yangi xabarlarni oʻqiydi va kim yozganini eslab qoladi\n'
      + '- `contacts` — yozganlar roʻyxati; `hours` bilan cheklash mumkin '
      + '(masalan 24 — sutkada yozganlar)\n'
      + '- `chats` — bot aʼzo boʻlgan guruh va kanallar\n'
      + '- `chat_info` — guruh haqida (`chat_id`): aʼzolar soni, bot admin mi\n'
      + '- `send` — bitta odamga/guruhga xabar (`chat_id`, `message`)\n'
      + '- `broadcast` — koʻpga birdan (`chat_ids` yoki `hours`, `message`)\n'
      + '- `pin` — xabarni qadash (`chat_id`, `message_id`)\n'
      + '- `commands` — bot menyusidagi buyruqlarni belgilash (`commands`)\n'
      + '- `schedule` — xabarni KEYINGA qoʻyish (`chat_ids` yoki `hours`, '
      + '`message`, `at`). Telefon oʻchiq boʻlsa ham server yuboradi. '
      + '`at` — ISO vaqt, masalan 2026-08-22T09:00:00Z. Buning uchun '
      + 'hisobga kirgan va fon vazifalari ochiq reja kerak.\n'
      + 'Ish tartibi: avval `sync`, keyin `contacts`/`chats`. `sync` '
      + 'qilinmagan boʻlsa roʻyxat boʻsh chiqadi — Telegram xabarni faqat '
      + 'soʻralganda beradi.\n'
      + 'MUHIM: `broadcast` — bu haqiqiy odamlarga haqiqiy xabar. Yuborishdan '
      + 'oldin MATNNI va NECHTA odamga ketishini koʻrsatib, foydalanuvchidan '
      + 'tasdiq ol. Bir xil matnni hammaga tashlama — odam oʻzi haqida '
      + 'yozilmaganini sezadi; savoliga qarab guruhla.\n'
      + 'Guruh yoki kanalga yozish uchun bot oʻsha yerda ADMIN boʻlishi kerak '
      + '— `chat_info` bilan tekshir.\n\n'
      + 'SHAXSIY HISOB («secretary mode» / Telegram Business) — bot '
      + 'foydalanuvchining OʻZI boʻlib yozadi, odam bot bilan emas, u bilan '
      + 'gaplashayotgandek koʻradi:\n'
      + '- `business` — ulanish bormi, qaysi ruxsatlar berilgan\n'
      + '- `send_as` — uning nomidan xabar (`chat_id`, `message`)\n'
      + '- `media_as` — uning nomidan rasm/video (`chat_id`, `file` — havola '
      + 'yoki file_id, `media` — photo|video|document|animation|voice|video_note)\n'
      + '- `story` — uning nomidan story (`file`, `media`: photo|video, '
      + '`hours`: 6|12|24|48, `message` — izoh)\n'
      + 'Avval `business` bilan tekshir: har bir ruxsat alohida beriladi va '
      + 'yoʻq boʻlsa soʻrov rad etiladi. Ruxsat yoʻq boʻlsa foydalanuvchiga '
      + 'aynan qaysi ruxsatni yoqish kerakligini ayt.\n'
      + 'Story oʻlchami qatʼiy: rasm 1080×1920, video 720×1280 va 60 '
      + 'soniyagacha. Boshqa oʻlcham berilsa Telegram rad etadi.\n'
      + 'Odamning nomidan yozish — jiddiy ish. Matnni koʻrsatib TASDIQ ol.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description:
            'bot | sync | contacts | chats | chat_info | send | broadcast | pin '
            + '| commands | schedule | business | send_as | media_as | story',
        },
        chat_id: { type: 'STRING' },
        chat_ids: { type: 'ARRAY', items: { type: 'STRING' } },
        message: { type: 'STRING' },
        message_id: { type: 'NUMBER' },
        hours: { type: 'NUMBER', description: 'Necha soat ichida yozganlar (contacts/broadcast)' },
        at: { type: 'STRING', description: 'schedule uchun: ISO vaqt (UTC)' },
        file: { type: 'STRING', description: 'media_as/story: havola yoki file_id' },
        media: { type: 'STRING', description: 'photo | video | document | animation | voice | video_note' },
        format: { type: 'STRING', description: 'Markdown yoki HTML' },
        commands: {
          type: 'ARRAY',
          description: 'Bot menyusi: [{command, description}]',
          items: {
            type: 'OBJECT',
            properties: { command: { type: 'STRING' }, description: { type: 'STRING' } },
          },
        },
        limit: { type: 'NUMBER' },
      },
      required: ['action'],
    },
  },
  {
    name: 'youtube_manage',
    description:
      'Oʻz YouTube kanalingizni boshqaradi (Google ulanishi kerak).\n'
      + '- `videos` — oxirgi videolar (koʻrishlar, izohlar soni)\n'
      + '- `comments` — videodagi izohlar (`video_id`)\n'
      + '- `reply` — izohga javob (`comment_id`, `message`)\n'
      + 'Izohlarni tahlil qilib, koʻp takrorlanadigan savollarni topsang — '
      + 'foydalanuvchiga qoʻllanma yozishni taklif qil.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'videos | comments | reply' },
        video_id: { type: 'STRING' },
        comment_id: { type: 'STRING' },
        message: { type: 'STRING' },
        limit: { type: 'NUMBER' },
      },
      required: ['action'],
    },
  },
  {
    name: 'connect_app',
    description:
      'BOSHQA ILOVAGA soʻrov yuboradi — foydalanuvchi ulab qoʻygan xizmatlar: '
      + 'Telegram, Discord, Slack, Notion, Airtable, Home Assistant, webhook va '
      + 'boshqalar. Xabar yuborish, yozuv qoʻshish, qurilmani yoqish, maʼlumot '
      + 'oʻqish — hammasi shu vosita orqali.\n'
      + 'Qaysi ulanishlar borligini «connect_list» aytadi. Ulanish yoʻq boʻlsa '
      + 'foydalanuvchiga Agent → Ulanishlar boʻlimidan qoʻshishni ayt.',
    parameters: {
      type: 'OBJECT',
      properties: {
        connector: { type: 'STRING', description: 'Ulanish nomi, masalan "Telegram"' },
        action: { type: 'STRING', description: 'Amal nomi, masalan "xabar yuborish"' },
        data: {
          type: 'OBJECT',
          description:
            'Amal talab qiladigan maydonlar. Masalan Telegram uchun {"text": "Salom"}.',
        },
      },
      required: ['connector', 'action'],
    },
  },
  {
    name: 'connect_list',
    description:
      'Foydalanuvchi ulab qoʻygan ilovalar va ularning amallari roʻyxatini beradi. '
      + 'Tashqi xizmat kerak boʻlsa avval shuni chaqir.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'read_data',
    description:
      'Foydalanuvchining saqlangan maʼlumotlarini oʻqiydi: jadval, vazifalar, konspektlar, loyihalar, ish vaqti qaydlari.',
    parameters: {
      type: 'OBJECT',
      properties: {
        what: {
          type: 'STRING',
          description: 'schedule | tasks | notes | projects | timelogs | courses | apps | all',
        },
        query: { type: 'STRING', description: 'Ixtiyoriy qidiruv soʻzi' },
      },
      required: ['what'],
    },
  },
  {
    name: 'use_skill',
    description:
      'Ish turi uchun tayyor koʻnikmani ochadi (kitob, test, ilmiy ish, rasmiy xat, '
      + 'rezyume, tahlil, tarjima, mijoz, taqdimot, tushuntirish). Keyingi qadamda '
      + 'shu ish uchun toʻliq koʻrsatma keladi. Oddiy savolga chaqirma.',
    parameters: {
      type: 'OBJECT',
      properties: {
        skill: { type: 'STRING', description: 'Koʻnikma nomi (id)' },
      },
      required: ['skill'],
    },
  },
  {
    name: 'connect_service',
    description:
      'Xizmatga ulanishni TAKLIF qiladi: foydalanuvchiga tugma chiqadi va u bir bosishda '
      + 'ruxsat beradi. Token soʻrama — buning oʻrniga shuni chaqir. '
      + 'Xizmatlar: github, supabase, google.',
    parameters: {
      type: 'OBJECT',
      properties: {
        service: { type: 'STRING', description: 'github | supabase | google' },
        why: { type: 'STRING', description: 'Nima uchun kerakligi — bir jumla' },
      },
      required: ['service'],
    },
  },
  {
    name: 'use_tools',
    description:
      'Yopiq vosita guruhini ochadi. Kerakli vosita roʻyxatda koʻrinmasa shuni chaqir — '
      + 'keyingi qadamda oʻsha guruh vositalari ishlaydi. Guruhlar: reja, ijod, video, joy, '
      + 'ulanish, telegram, ijtimoiy.',
    parameters: {
      type: 'OBJECT',
      properties: {
        groups: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Ochiladigan guruhlar nomi',
        },
      },
      required: ['groups'],
    },
  },
];

/** Nomi bo'yicha loyihani topadi yoki yaratadi. */
function findProjectId(name: string): string | undefined {
  if (!name) return undefined;
  const needle = name.toLowerCase();
  return getState().projects.find((p) => p.name.toLowerCase().includes(needle))?.id;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { chatId: string; signal?: AbortSignal },
): Promise<ToolOutcome> {
  switch (name) {
    /*
     * Guruhni ochish. Bu vosita hech narsa QILMAYDI — u faqat keyingi
     * qadamda qaysi eʼlonlar yuborilishini belgilaydi. Ochilishning
     * oʻzi agent siklida (`agent.ts`) hisobga olinadi.
     */
    /*
     * Xizmatga ulanish taklifi.
     *
     * Foydalanuvchidan token soʻrash notoʻgʻri: u qayerdan olishni
     * bilmaydi. Shuning uchun tayyor tugma chiqaramiz — «Ulash» bosilsa
     * xizmat sahifasi ochiladi va qolganini server bajaradi.
     */
    /*
     * Koʻnikmani ochish.
     *
     * Bu ham `use_tools` kabi hech narsa bajarmaydi — u keyingi qadamda
     * qaysi koʻrsatma yuborilishini belgilaydi. Toʻliq matnlar promptda
     * doim turmasin: hammasi birga ~8 000 token.
     */
    case 'use_skill': {
      const wanted = str(args.skill).toLowerCase();
      const found = skillById(wanted);
      if (!found) {
        return {
          ok: false,
          summary: `«${wanted}» koʻnikmasi yoʻq`,
          payload: { bor: SKILLS.map((sk) => sk.id) },
        };
      }
      return {
        ok: true,
        summary: `koʻnikma: ${found.name}`,
        payload: {
          skill: found.id,
          nomi: found.name,
          eslatma: 'Toʻliq koʻrsatma keyingi qadamda keladi — shunga amal qil.',
        },
      };
    }

    case 'connect_service': {
      const service = str(args.service).toLowerCase() as OauthProvider;
      if (!['github', 'supabase', 'google'].includes(service)) {
        return {
          ok: false,
          summary: 'nomaʼlum xizmat',
          payload: { xato: 'github, supabase yoki google boʻlishi kerak' },
        };
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
            eslatma: 'Foydalanuvchiga Sozlamalardan qoʻlda kalit kiritish mumkinligini ayt.',
          },
        };
      }

      const why = str(args.why, 'shu ish uchun kerak');
      const answer = await askUser({
        scope: 'chat',
        targetId: ctx.chatId,
        question: `${list[service].label} ga ulanish kerak — ${why}. Ulaymizmi?`,
        options: ['Ulash', 'Hozir emas'],
        multi: false,
        signal: ctx.signal,
      });

      if (!/ulash/i.test(answer)) {
        return {
          ok: false,
          summary: 'ulanish rad etildi',
          payload: { javob: answer, eslatma: 'Ulanishsiz qila oladigan ishni davom ettir.' },
        };
      }

      await startConnect(service);
      return {
        ok: true,
        summary: `${service} ulanish sahifasi ochildi`,
        payload: {
          ochildi: true,
          eslatma:
            'Foydalanuvchi ruxsat berib qaytadi. Shu javobingda «qaytganingizda davom ettiraman» deb yoz.',
        },
      };
    }

    case 'use_tools': {
      const asked = Array.isArray(args.groups)
        ? args.groups.map((g) => String(g).trim().toLowerCase())
        : [String(args.groups ?? '').trim().toLowerCase()];
      const known = asked.filter((g) => g && g in TOOL_GROUPS && g !== 'yadro');
      const unknown = asked.filter((g) => g && !known.includes(g));
      return {
        ok: known.length > 0,
        summary: known.length ? `vositalar ochildi: ${known.join(', ')}` : 'bunday guruh yoʻq',
        payload: {
          opened: known,
          tools: known.flatMap((g) => TOOL_GROUPS[g] ?? []),
          ...(unknown.length ? { nomaʼlum: unknown } : {}),
          eslatma: known.length
            ? 'Endi shu vositalarni chaqirishing mumkin.'
            : 'Mavjud guruhlar: reja, ijod, video, joy, ulanish, telegram, ijtimoiy.',
        },
      };
    }

    case 'ask_user': {
      const question = str(args.question, 'Qanday davom etay?');
      const answer = await askUser({
        scope: 'chat',
        targetId: ctx.chatId,
        question,
        options: Array.isArray(args.options) ? args.options.map(String) : [],
        multi: str(args.multi) === 'true',
        signal: ctx.signal,
      });
      return {
        ok: true,
        summary: `Soʻraldi: ${question.slice(0, 50)} → ${answer.slice(0, 40)}`,
        payload: { javob: answer },
      };
    }

    case 'delegate': {
      const role = helperRole(str(args.role, 'reja'));
      const task = str(args.task);
      if (!task) {
        return { ok: false, summary: 'Topshiriq boʻsh', payload: { xato: 'task kerak' } };
      }
      try {
        const report = await runHelper(role, task, {
          chatId: ctx.chatId,
          signal: ctx.signal,
        });
        if (!report.text) {
          return {
            ok: false,
            summary: `${role} yordamchisi javob qaytarmadi`,
            payload: { xato: 'Yordamchidan boʻsh javob keldi — oʻzing bajar.' },
          };
        }
        return {
          ok: true,
          summary: `${role} yordamchisi ishladi${report.steps ? ` (${report.steps} qadam)` : ''}`,
          payload: { rol: role, model: report.model, hisobot: report.text },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Yordamchi ishlamadi',
          payload: { xato: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'google': {
      if (!googleReady()) {
        return {
          ok: false,
          summary: 'Google hisobi ulanmagan',
          payload: {
            error: 'ulanmagan',
            izoh:
              'Foydalanuvchiga ayt: Sozlamalar → Google boʻlimidan hisobini ulasin. '
              + 'Bir marta ulansa pochta, Drive va kalendar ochiladi.',
          },
        };
      }

      const action = str(args.action);
      const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));

      try {
        if (action === 'mail_search') {
          const mails = await searchMail(str(args.query, 'is:unread'), limit);
          return {
            ok: true,
            summary: `${mails.length} ta xat`,
            payload: {
              xatlar: mails.map((m) => ({
                id: m.id,
                kimdan: m.from,
                mavzu: m.subject,
                sana: m.date,
                boshlanishi: m.snippet,
              })),
            },
          };
        }

        if (action === 'mail_read') {
          const id = str(args.id);
          if (!id) return { ok: false, summary: 'id kerak', payload: { error: 'id' } };
          const text = await readMail(id);
          return { ok: true, summary: 'Xat oʻqildi', payload: { matn: text } };
        }

        if (action === 'mail_send') {
          const to = str(args.to);
          const subject = str(args.subject);
          const body = str(args.body);
          if (!to || !body) {
            return { ok: false, summary: 'to va body kerak', payload: { error: 'toʻliqmas' } };
          }
          const id = await sendMail(to, subject, body);
          return { ok: true, summary: `Xat yuborildi: ${to}`, payload: { id } };
        }

        if (action === 'drive_list') {
          const files = await listDrive(str(args.query), limit);
          return {
            ok: true,
            summary: `${files.length} ta fayl`,
            payload: {
              fayllar: files.map((f) => ({
                id: f.id,
                nom: f.name,
                turi: f.mimeType,
                oʻzgargan: f.modifiedTime,
              })),
            },
          };
        }

        if (action === 'drive_read') {
          const id = str(args.id);
          if (!id) return { ok: false, summary: 'id kerak', payload: { error: 'id' } };
          return { ok: true, summary: 'Fayl oʻqildi', payload: { matn: await readDrive(id) } };
        }

        if (action === 'calendar_list') {
          const events = await listEvents(Math.max(1, Math.min(60, Number(args.days) || 7)));
          return {
            ok: true,
            summary: `${events.length} ta voqea`,
            payload: {
              voqealar: events.map((e) => ({
                nom: e.summary,
                boshlanish: e.start,
                tugash: e.end,
                joy: e.location,
              })),
            },
          };
        }

        if (action === 'calendar_add') {
          const summary = str(args.summary);
          const start = str(args.start);
          const end = str(args.end);
          if (!summary || !start || !end) {
            return {
              ok: false,
              summary: 'summary, start va end kerak',
              payload: { error: 'toʻliqmas' },
            };
          }
          const link = await addEvent(summary, start, end, str(args.body));
          return { ok: true, summary: `«${summary}» qoʻshildi`, payload: { havola: link } };
        }

        return { ok: false, summary: `Nomaʼlum amal: ${action}`, payload: { error: 'amal' } };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Google xatosi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'telegram': {
      if (!tgReady()) {
        return {
          ok: false,
          summary: 'Telegram boti ulanmagan',
          payload: {
            error: 'ulanmagan',
            izoh:
              'Sozlamalar → Telegram boʻlimiga bot tokenini qoʻying. '
              + 'Tokenni @BotFather dan olasiz: /newbot → nom → username. '
              + 'Guruh yoki kanalni boshqarish uchun botni oʻsha yerga '
              + 'ADMIN qilib qoʻshing.',
          },
        };
      }

      const action = str(args.action);
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
      const hours = Number(args.hours) || 0;
      const format = str(args.format) as 'Markdown' | 'HTML' | '';

      try {
        if (action === 'bot') {
          const me = await tgMe(ctx.signal);
          return {
            ok: true,
            summary: `@${me.username}`,
            payload: {
              nomi: me.first_name,
              username: `@${me.username}`,
              guruhga_qoshiladi: me.can_join_groups !== false,
              guruh_xabarlarini_oqiydi: me.can_read_all_group_messages === true,
              izoh:
                me.can_read_all_group_messages === false
                  ? 'Bot guruhdagi HAMMA xabarni oʻqiy olmaydi. @BotFather → '
                    + '/setprivacy → Disable qilsangiz hammasini koʻradi.'
                  : undefined,
            },
          };
        }

        if (action === 'sync') {
          const fresh = await tgSync(ctx.signal);
          return {
            ok: true,
            summary: `${fresh.length} ta yangi xabar`,
            payload: {
              xabarlar: fresh.slice(0, limit).map((m) => ({
                kim: m.from,
                chat_id: m.chatId,
                qayerda: m.chatType === 'private' ? 'shaxsiy' : m.chatTitle,
                matn: m.text.slice(0, 400),
                message_id: m.messageId,
                sana: new Date(m.at).toISOString(),
              })),
            },
          };
        }

        if (action === 'contacts') {
          const list = await tgContacts(hours);
          return {
            ok: true,
            summary: hours
              ? `${list.length} kishi soʻnggi ${hours} soatda yozgan`
              : `${list.length} kishi yozgan`,
            payload: {
              odamlar: list.slice(0, limit).map((c) => ({
                chat_id: c.id,
                ism: c.name,
                username: c.username ? `@${c.username}` : undefined,
                oxirgi_xabari: c.lastText.slice(0, 200),
                oxirgi_marta: new Date(c.lastAt).toISOString(),
                nechta_yozgan: c.count,
              })),
              izoh: list.length ? undefined : 'Avval `sync` qiling.',
            },
          };
        }

        if (action === 'chats') {
          const list = await tgChats();
          return {
            ok: true,
            summary: `${list.length} ta guruh/kanal`,
            payload: {
              chatlar: list.map((c) => ({
                chat_id: c.id,
                nomi: c.title,
                turi: c.type,
                username: c.username ? `@${c.username}` : undefined,
              })),
              izoh: list.length
                ? undefined
                : 'Bot hali hech qaysi guruhga qoʻshilmagan yoki `sync` qilinmagan.',
            },
          };
        }

        if (action === 'chat_info') {
          const id = str(args.chat_id);
          if (!id) return { ok: false, summary: 'chat_id kerak', payload: { error: 'id' } };
          const info = await tgChatInfo(id, ctx.signal);
          return {
            ok: true,
            summary: `${info.title}${info.botIsAdmin ? ' (bot admin)' : ''}`,
            payload: {
              nomi: info.title,
              turi: info.type,
              azolar: info.members,
              tavsif: info.description,
              bot_admin: info.botIsAdmin,
              izoh: info.botIsAdmin
                ? undefined
                : 'Bot bu yerda admin emas — yozish va boshqarish ishlamaydi.',
            },
          };
        }

        if (action === 'send') {
          const id = str(args.chat_id);
          const message = str(args.message);
          if (!id || !message) {
            return { ok: false, summary: 'chat_id va message kerak', payload: { error: 'toʻliqmas' } };
          }
          const mid = await tgSend(
            id,
            message,
            { format: format || undefined },
            ctx.signal,
          );
          return { ok: true, summary: 'Yuborildi', payload: { message_id: mid } };
        }

        if (action === 'broadcast') {
          const message = str(args.message);
          if (!message) {
            return { ok: false, summary: 'message kerak', payload: { error: 'matn yoʻq' } };
          }

          let targets = Array.isArray(args.chat_ids)
            ? (args.chat_ids as unknown[]).map((v) => String(v))
            : [];

          if (!targets.length) {
            const list = await tgContacts(hours || 24);
            targets = list.map((c) => String(c.id));
          }
          if (!targets.length) {
            return {
              ok: false,
              summary: 'Kimga yuborish nomaʼlum',
              payload: { error: 'boʻsh', izoh: 'Avval `sync`, keyin `contacts` qiling.' },
            };
          }

          const res = await tgBroadcast(
            targets,
            message,
            { format: format || undefined },
            ctx.signal,
          );
          return {
            ok: res.sent > 0,
            summary: `${res.sent}/${targets.length} yuborildi`,
            payload: {
              yuborildi: res.sent,
              yetmadi: res.failed.length,
              xatolar: res.failed.slice(0, 10),
              izoh: res.failed.length
                ? 'Yetmaganlar odatda botni bloklagan yoki suhbatni oʻchirgan.'
                : undefined,
            },
          };
        }

        if (action === 'business') {
          const b = await tgBusiness(true, ctx.signal);
          if (!b) {
            return {
              ok: false,
              summary: 'Shaxsiy hisob ulanmagan',
              payload: {
                error: 'ulanmagan',
                izoh:
                  'Telegram → Sozlamalar → Telegram Business → Chatbots '
                  + 'boʻlimidan botni ulang (Telegram Premium kerak). '
                  + 'Ulagach botga bir marta yozing va `sync` qiling — '
                  + 'ulanish shundan keyin koʻrinadi.',
              },
            };
          }
          const berilgan = Object.entries(b.rights)
            .filter(([, v]) => v)
            .map(([k]) => k);
          return {
            ok: b.enabled,
            summary: b.enabled ? `${b.user} nomidan ishlay oladi` : 'Ulanish oʻchiq',
            payload: {
              kim: b.user,
              yoqilgan: b.enabled,
              ruxsatlar: berilgan,
              yozolladimi: Boolean(b.rights.can_reply),
              story_qoyoladimi: Boolean(b.rights.can_manage_stories),
              oqiladimi: Boolean(b.rights.can_read_messages),
            },
          };
        }

        if (action === 'send_as') {
          const id = str(args.chat_id);
          const message = str(args.message);
          if (!id || !message) {
            return { ok: false, summary: 'chat_id va message kerak', payload: { error: 'toʻliqmas' } };
          }
          const mid = await tgSendAs(id, message, { format: format || undefined }, ctx.signal);
          return {
            ok: true,
            summary: 'Sizning nomingizdan yuborildi',
            payload: { message_id: mid },
          };
        }

        if (action === 'media_as') {
          const id = str(args.chat_id);
          const file = str(args.file);
          const kind = (str(args.media) || 'photo') as
            'photo' | 'video' | 'document' | 'animation' | 'voice' | 'video_note';
          if (!id || !file) {
            return { ok: false, summary: 'chat_id va file kerak', payload: { error: 'toʻliqmas' } };
          }
          const mid = await tgSendMediaAs(id, kind, file, str(args.message), ctx.signal);
          return {
            ok: true,
            summary: `${kind} yuborildi`,
            payload: { message_id: mid },
          };
        }

        if (action === 'story') {
          const file = str(args.file);
          if (!file) {
            return {
              ok: false,
              summary: 'file kerak',
              payload: { error: 'fayl', izoh: 'Rasm yoki video havolasi (yoki file_id).' },
            };
          }
          const kind = str(args.media) === 'video' ? 'video' : 'photo';
          const hours = Number(args.hours) || 24;
          const storyId = await tgPostStory(
            { kind, url: file },
            {
              activePeriod: hours * 3600,
              caption: str(args.message) || undefined,
            },
            ctx.signal,
          );
          return {
            ok: true,
            summary: `Story joylandi (${hours} soat)`,
            payload: { story_id: storyId, turi: kind },
          };
        }

        if (action === 'schedule') {
          const message = str(args.message);
          const at = new Date(str(args.at));
          if (!message) return { ok: false, summary: 'message kerak', payload: { error: 'matn' } };
          if (Number.isNaN(at.getTime())) {
            return {
              ok: false,
              summary: 'at notoʻgʻri',
              payload: { error: 'vaqt', izoh: 'ISO koʻrinishida bering: 2026-08-22T09:00:00Z' },
            };
          }

          let targets = Array.isArray(args.chat_ids)
            ? (args.chat_ids as unknown[]).map((v) => String(v))
            : [];
          if (!targets.length) {
            const list = await tgContacts(hours || 24);
            targets = list.map((c) => String(c.id));
          }
          if (!targets.length) {
            return { ok: false, summary: 'Kimga yuborish nomaʼlum', payload: { error: 'boʻsh' } };
          }

          const jobId = await tgSchedule(
            targets,
            message,
            at,
            (format || undefined) as 'Markdown' | 'HTML' | undefined,
          );
          return {
            ok: true,
            summary: `${targets.length} kishiga ${at.toLocaleString('uz')} da yuboriladi`,
            payload: {
              vazifa: jobId,
              qachon: at.toISOString(),
              kimga: targets.length,
              izoh: 'Telefon oʻchiq boʻlsa ham server yuboradi.',
            },
          };
        }

        if (action === 'pin') {
          const id = str(args.chat_id);
          const mid = Number(args.message_id);
          if (!id || !mid) {
            return { ok: false, summary: 'chat_id va message_id kerak', payload: { error: 'toʻliqmas' } };
          }
          await tgPin(id, mid, ctx.signal);
          return { ok: true, summary: 'Qadaldi', payload: { chat_id: id, message_id: mid } };
        }

        if (action === 'commands') {
          const raw = Array.isArray(args.commands) ? (args.commands as unknown[]) : [];
          const commands = raw
            .map((c) => c as { command?: unknown; description?: unknown })
            .map((c) => ({
              command: String(c.command ?? '').replace(/^\//, '').slice(0, 32),
              description: String(c.description ?? '').slice(0, 256),
            }))
            .filter((c) => c.command && c.description);
          if (!commands.length) {
            return { ok: false, summary: 'commands kerak', payload: { error: 'boʻsh' } };
          }
          await tgSetCommands(commands, ctx.signal);
          return {
            ok: true,
            summary: `${commands.length} ta buyruq belgilandi`,
            payload: { buyruqlar: commands },
          };
        }

        return { ok: false, summary: `Nomaʼlum amal: ${action}`, payload: { error: 'amal' } };
      } catch (err) {
        return {
          ok: false,
          summary: 'Telegram xatosi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'instagram': {
      if (!igReady()) {
        return {
          ok: false,
          summary: 'Instagram ulanmagan',
          payload: {
            error: 'ulanmagan',
            izoh:
              'Sozlamalar → Instagram boʻlimiga Graph API tokeni va Business '
              + 'hisob ID sini qoʻyish kerak. Hisob Business yoki Creator '
              + 'boʻlishi va Facebook sahifasiga ulangan boʻlishi shart.',
          },
        };
      }

      const action = str(args.action);
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));

      try {
        if (action === 'media') {
          const list = await igMedia(limit, ctx.signal);
          return {
            ok: true,
            summary: `${list.length} ta post`,
            payload: {
              postlar: list.map((m) => ({
                id: m.id,
                matn: (m.caption ?? '').slice(0, 120),
                turi: m.media_type,
                izohlar: m.comments_count,
                yoqtirishlar: m.like_count,
                sana: m.timestamp,
                havola: m.permalink,
              })),
            },
          };
        }

        if (action === 'comments') {
          const id = str(args.media_id);
          if (!id) return { ok: false, summary: 'media_id kerak', payload: { error: 'id' } };
          const list = await igComments(id, limit, ctx.signal);
          const pending = list.filter((c) => !c.replied);
          return {
            ok: true,
            summary: `${list.length} ta izoh, ${pending.length} tasiga javob berilmagan`,
            payload: {
              izohlar: list.map((c) => ({
                id: c.id,
                kim: c.username,
                matn: c.text,
                sana: c.timestamp,
                javob_berilgan: c.replied,
              })),
            },
          };
        }

        if (action === 'reply') {
          const id = str(args.comment_id);
          const message = str(args.message);
          if (!id || !message) {
            return { ok: false, summary: 'comment_id va message kerak', payload: { error: 'toʻliqmas' } };
          }
          const replyId = await igReply(id, message, ctx.signal);
          return { ok: true, summary: `Izohga javob berildi`, payload: { id: replyId } };
        }

        if (action === 'hide') {
          const id = str(args.comment_id);
          if (!id) return { ok: false, summary: 'comment_id kerak', payload: { error: 'id' } };
          await igHide(id, true, ctx.signal);
          return { ok: true, summary: 'Izoh yashirildi', payload: { id } };
        }

        if (action === 'chats') {
          const list = await igConversations(limit, ctx.signal);
          return {
            ok: true,
            summary: `${list.length} ta suhbat`,
            payload: {
              suhbatlar: list.map((c) => ({
                id: c.id,
                kim: c.username,
                user_id: c.userId,
                oxirgi_xabar: c.lastMessage,
                vaqt: c.updatedAt,
              })),
            },
          };
        }

        if (action === 'messages') {
          const id = str(args.conversation_id);
          if (!id) return { ok: false, summary: 'conversation_id kerak', payload: { error: 'id' } };
          const list = await igMessages(id, limit, ctx.signal);
          return { ok: true, summary: `${list.length} ta xabar`, payload: { xabarlar: list } };
        }

        if (action === 'send') {
          const userId = str(args.user_id);
          const message = str(args.message);
          if (!userId || !message) {
            return { ok: false, summary: 'user_id va message kerak', payload: { error: 'toʻliqmas' } };
          }
          const id = await igSend(userId, message, ctx.signal);
          return { ok: true, summary: 'Xabar yuborildi', payload: { id } };
        }

        return { ok: false, summary: `Nomaʼlum amal: ${action}`, payload: { error: 'amal' } };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'Instagram xatosi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'youtube_manage': {
      if (!googleReady()) {
        return {
          ok: false,
          summary: 'Google ulanmagan',
          payload: { error: 'Sozlamalar → Google hisobi boʻlimidan ulang.' },
        };
      }

      const action = str(args.action);
      const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));

      try {
        if (action === 'videos') {
          const list = await ytVideos(limit, ctx.signal);
          return {
            ok: true,
            summary: `${list.length} ta video`,
            payload: {
              videolar: list.map((v) => ({
                id: v.id,
                sarlavha: v.title,
                korishlar: v.views,
                izohlar: v.comments,
                sana: v.publishedAt,
              })),
            },
          };
        }

        if (action === 'comments') {
          const id = str(args.video_id);
          if (!id) return { ok: false, summary: 'video_id kerak', payload: { error: 'id' } };
          const list = await ytComments(id, limit, ctx.signal);
          return {
            ok: true,
            summary: `${list.length} ta izoh`,
            payload: {
              izohlar: list.map((c) => ({
                id: c.id,
                kim: c.author,
                matn: c.text,
                yoqtirish: c.likes,
                javoblar: c.replyCount,
                sana: c.publishedAt,
              })),
            },
          };
        }

        if (action === 'reply') {
          const id = str(args.comment_id);
          const message = str(args.message);
          if (!id || !message) {
            return { ok: false, summary: 'comment_id va message kerak', payload: { error: 'toʻliqmas' } };
          }
          const replyId = await ytReply(id, message, ctx.signal);
          return { ok: true, summary: 'Izohga javob berildi', payload: { id: replyId } };
        }

        return { ok: false, summary: `Nomaʼlum amal: ${action}`, payload: { error: 'amal' } };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: 'YouTube xatosi',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'connect_list': {
      const list = activeConnectors();
      if (!list.length) {
        return {
          ok: true,
          summary: 'Hech qanday ulanish qoʻshilmagan',
          payload: {
            ulanishlar: [],
            izoh:
              'Foydalanuvchi Agent → Ulanishlar boʻlimidan Telegram, Notion, '
              + 'webhook va boshqa xizmatlarni ulashi mumkin.',
          },
        };
      }
      return {
        ok: true,
        summary: `${list.length} ta ulanish`,
        payload: {
          ulanishlar: list.map((c) => ({
            nom: c.name,
            amallar: c.actions.map((a) => ({ nom: a.name, izoh: a.description })),
          })),
        },
      };
    }

    case 'connect_app': {
      const wanted = str(args.connector);
      const connector = findConnector(wanted);
      if (!connector) {
        const have = activeConnectors().map((c) => c.name);
        return {
          ok: false,
          summary: `«${wanted}» ulanishi topilmadi`,
          payload: {
            xato: have.length
              ? `Bunday ulanish yoʻq. Bor ulanishlar: ${have.join(', ')}.`
              : 'Hali hech qanday ilova ulanmagan. Agent → Ulanishlar boʻlimidan qoʻshish kerak.',
          },
        };
      }
      const action = findAction(connector, str(args.action));
      if (!action) {
        return {
          ok: false,
          summary: `«${connector.name}» da bunday amal yoʻq`,
          payload: { amallar: connector.actions.map((a) => a.name) },
        };
      }

      const data =
        args.data && typeof args.data === 'object'
          ? (args.data as Record<string, unknown>)
          : {};

      try {
        const res = await callConnector(connector, action, data, ctx.signal);
        return {
          ok: res.ok,
          summary: `${connector.icon} ${connector.name} → ${action.name}: ${res.ok ? 'yuborildi' : `xato ${res.status}`}`,
          payload: res.ok
            ? { holat: res.status, javob: res.body.slice(0, 1200) }
            : { holat: res.status, xato: res.body.slice(0, 1200) },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `${connector.name} ga ulanib boʻlmadi`,
          payload: { xato: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'create_note': {
      const note: Note = {
        id: uid('n_'),
        title: str(args.title, 'Sarlavhasiz'),
        content: str(args.content),
        subject: str(args.subject, 'Umumiy'),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => ({ notes: [note, ...s.notes] }));
      return {
        ok: true,
        summary: `Konspekt saqlandi: ${note.title}`,
        payload: { status: 'saqlandi', id: note.id },
      };
    }

    case 'create_task': {
      const task: Task = {
        id: uid('t_'),
        title: str(args.title, 'Nomsiz vazifa'),
        done: false,
        priority: normPriority(args.priority),
        due: str(args.due) || undefined,
        projectId: findProjectId(str(args.project)),
        createdAt: Date.now(),
      };
      setState((s) => ({ tasks: [task, ...s.tasks] }));
      return {
        ok: true,
        summary: `Vazifa qoʻshildi: ${task.title}${task.due ? ` (${task.due})` : ''}`,
        payload: { status: 'qoʻshildi', id: task.id },
      };
    }

    case 'add_schedule_item': {
      const start = normTime(args.start, '09:00');
      const item: ScheduleItem = {
        id: uid('s_'),
        day: normDay(args.day),
        start,
        end: normTime(args.end, addMinutes(start, 80)),
        subject: str(args.subject, 'Dars'),
        room: str(args.room) || undefined,
        teacher: str(args.teacher) || undefined,
        kind: (['maruza', 'amaliyot', 'lab', 'boshqa'] as const).find(
          (k) => k === str(args.kind).toLowerCase(),
        ),
      };
      setState((s) => ({
        schedule: [...s.schedule, item].sort(
          (a, b) => a.day - b.day || a.start.localeCompare(b.start),
        ),
      }));
      return {
        ok: true,
        summary: `Jadvalga qoʻshildi: ${DAYS[item.day]} ${item.start} — ${item.subject}`,
        payload: { status: 'qoʻshildi', id: item.id },
      };
    }

    case 'create_project': {
      const rawSteps = Array.isArray(args.steps) ? args.steps : [];
      const project: Project = {
        id: uid('p_'),
        name: str(args.name, 'Nomsiz loyiha'),
        description: str(args.description),
        status: 'reja',
        steps: rawSteps.map((t) => ({ id: uid('st_'), title: str(t), done: false })),
        createdAt: Date.now(),
      };
      setState((s) => ({ projects: [project, ...s.projects] }));
      return {
        ok: true,
        summary: `Loyiha yaratildi: ${project.name} (${project.steps.length} bosqich)`,
        payload: { status: 'yaratildi', id: project.id },
      };
    }

    case 'log_work': {
      const minutes = Math.max(1, num(args.minutes, 30));
      const end = Date.now();
      const log: TimeLog = {
        id: uid('w_'),
        label: str(args.label, 'Ish'),
        start: end - minutes * 60_000,
        end,
        note: str(args.note) || undefined,
      };
      setState((s) => ({ timeLogs: [log, ...s.timeLogs] }));
      return {
        ok: true,
        summary: `Ish vaqti yozildi: ${log.label} — ${minutes} daqiqa`,
        payload: { status: 'yozildi', id: log.id },
      };
    }

    case 'complete_task': {
      const needle = str(args.title).toLowerCase();
      const target = getState().tasks.find(
        (t) => !t.done && t.title.toLowerCase().includes(needle),
      );
      if (!target) {
        return {
          ok: false,
          summary: `Vazifa topilmadi: ${needle}`,
          payload: { status: 'topilmadi' },
        };
      }
      setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === target.id ? { ...t, done: true } : t)),
      }));
      return {
        ok: true,
        summary: `Bajarildi: ${target.title}`,
        payload: { status: 'bajarildi', id: target.id },
      };
    }

    case 'create_course': {
      const rawTopics = Array.isArray(args.topics) ? args.topics : [];
      const topics: CourseTopic[] = rawTopics.slice(0, 120).map((t) => {
        const item = (t ?? {}) as Record<string, unknown>;
        return {
          id: uid('ct_'),
          title: str(item.title, 'Mavzu'),
          summary: str(item.summary),
          done: false,
        };
      });
      if (!topics.length) {
        return {
          ok: false,
          summary: 'Kurs uchun mavzular berilmadi',
          payload: { status: 'mavzu_yoq' },
        };
      }
      const course: Course = {
        id: uid('k_'),
        title: str(args.title, 'Kurs'),
        field: str(args.field, str(args.title, 'Umumiy')),
        goal: str(args.goal),
        level: str(args.level, 'boshlangʻich'),
        topics,
        createdAt: Date.now(),
      };
      setState((s) => ({ courses: [course, ...s.courses] }));
      return {
        ok: true,
        summary: `Kurs ochildi: ${course.title} — ${topics.length} ta mavzu`,
        payload: { status: 'ochildi', id: course.id, topics: topics.length },
      };
    }

    case 'send_file': {
      const name = str(args.name, 'daho-fayl');
      const format = str(args.format, 'pdf').toLowerCase();

      try {
        if (format === 'zip') {
          const raw = Array.isArray(args.files) ? args.files : [];
          const files = raw
            .map((f) => {
              const item = (f ?? {}) as Record<string, unknown>;
              return { path: str(item.path), content: String(item.content ?? '') };
            })
            .filter((f) => f.path);
          if (!files.length) {
            return {
              ok: false,
              summary: 'ZIP uchun fayl berilmadi',
              payload: { error: 'files boʻsh — har biriga path va content bering' },
            };
          }
          const status = await saveZip(name, files);
          return {
            ok: true,
            summary: `${files.length} ta fayl ZIP qilib yuborildi`,
            payload: { status, eslatma: 'Ulashish oynasi ochildi — foydalanuvchiga ayt.' },
          };
        }

        const content = str(args.content);
        if (!content) {
          return {
            ok: false,
            summary: 'Fayl mazmuni berilmadi',
            payload: { error: 'content boʻsh' },
          };
        }
        const allowed: DocFormat[] = ['pdf', 'docx', 'md', 'pptx'];
        const kind = (allowed as string[]).includes(format) ? (format as DocFormat) : 'pdf';
        const status = await exportDocument(content, kind, name);

        // Faylni artifact sifatida ham saqlaymiz — keyin qayta yuklab olsa boʻladi.
        const artifact: Artifact = {
          id: uid('a_'),
          kind: 'markdown',
          title: name,
          content,
          chatId: ctx.chatId,
          createdAt: Date.now(),
        };
        return {
          ok: true,
          summary: `${DOC_LABEL[kind]} yuborildi: ${name}`,
          payload: {
            status,
            eslatma:
              'Ulashish oynasi ochildi. Matnni chatga qayta koʻchirib yozma — ' +
              'foydalanuvchi faylni oldi.',
          },
          artifacts: [artifact],
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Fayl yuborilmadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'search_images': {
      const query = str(args.query);
      if (!query) {
        return { ok: false, summary: 'Qidiruv soʻzi yoʻq', payload: { error: 'boʻsh' } };
      }
      const count = Math.max(1, Math.min(20, num(args.count, 8)));
      const found = await searchImages(query, count, ctx.signal);
      if (!found.length) {
        return {
          ok: false,
          summary: `Rasm topilmadi: ${query}`,
          payload: { error: 'topilmadi', maslahat: 'Qidiruv soʻzini ingliz tilida va soddaroq yozing.' },
        };
      }

      // Soʻralsa rasmlarni ilovaga koʻchirib olamiz — shunda ular chatda
      // koʻrinadi va hujjatga qoʻyish mumkin boʻladi.
      const made: Artifact[] = [];
      if (str(args.save) === 'true') {
        for (const img of found.slice(0, 8)) {
          const data = await fetchImageData(img.thumb, ctx.signal);
          if (!data) continue;
          made.push({
            id: uid('a_'),
            kind: 'image',
            title: img.title,
            content: data.data,
            mimeType: data.mimeType,
            chatId: ctx.chatId,
            createdAt: Date.now(),
          });
        }
      }

      return {
        ok: true,
        summary: `${found.length} ta rasm topildi: ${query.slice(0, 32)}`,
        payload: {
          rasmlar: found.map((img) => ({
            nomi: img.title,
            manba: img.source,
            muallif: img.author,
            litsenziya: img.license,
            havola: img.url,
          })),
          saqlandi: made.length,
          eslatma:
            'Foydalanuvchiga rasmlarni MANBA havolasi bilan koʻrsat (nomi + havola). ' +
            'Rasmlarni matn bilan qayta tasvirlab oʻtirma.',
        },
        artifacts: made.length ? made : undefined,
      };
    }

    case 'write_book': {
      const request = str(args.request);
      if (!request) {
        return {
          ok: false,
          summary: 'Kitob tavsifi berilmadi',
          payload: { error: 'avval ask_user bilan kitob haqida soʻrang' },
        };
      }
      const chapters = Math.max(3, Math.min(60, num(args.chapters, 12)));
      const book = createBook({
        request,
        kind: str(args.kind, 'aniqlanmagan'),
        wordsPerChapter: Math.max(400, Math.min(4000, num(args.words, 1200))),
        withImages: str(args.images) !== 'false',
        chatId: ctx.chatId,
      });
      // Yozish fon vazifasi boʻlib ketadi — suhbat bloklanmaydi va
      // foydalanuvchi boshqa boʻlimga oʻtsa ham davom etaveradi.
      void writeBook(book.id, { chapterCount: chapters });
      return {
        ok: true,
        summary: `Kitob boshlandi: ${chapters} bob`,
        payload: {
          status: 'yozish boshlandi',
          id: book.id,
          boblar: chapters,
          eslatma:
            'Kitob fonda yozilmoqda: avval reja va qahramonlar, keyin muqova, ' +
            'soʻng boblar. Foydalanuvchiga «Agent → Kitoblar» boʻlimidan kuzatishi ' +
            'mumkinligini ayt. Sen kitob matnini bu yerda yozma.',
        },
      };
    }

    case 'generate_image': {
      const prompt = str(args.prompt);
      if (!prompt) {
        return { ok: false, summary: 'Rasm tavsifi berilmadi', payload: { error: 'prompt_yoq' } };
      }
      const { artifacts: saved } = getState();
      const refs: Attachment[] = [];
      if (str(args.edit_last) === 'true') {
        const last = saved.find((a) => a.kind === 'image' && a.chatId === ctx.chatId);
        if (last) refs.push({ mimeType: last.mimeType ?? 'image/png', data: last.content });
      }
      try {
        // Gemini kaliti boʻlsa oʻsha bilan, boʻlmasa ulangan provayderning
        // rasm modeli bilan (masalan OpenRouter’dagi Gemini image).
        const images = await imageAny(prompt, refs, ctx.signal);
        const made: Artifact[] = images.map((img, i) => ({
          id: uid('a_'),
          kind: 'image',
          title: prompt.slice(0, 40) || `Rasm ${i + 1}`,
          content: img.data,
          mimeType: img.mimeType,
          chatId: ctx.chatId,
          createdAt: Date.now(),
        }));
        return {
          ok: true,
          summary: `Rasm tayyor: ${prompt.slice(0, 40)}`,
          payload: {
            status: 'chizildi',
            soni: made.length,
            eslatma: 'Rasm foydalanuvchiga koʻrsatildi — uni matn bilan qayta tasvirlab oʻtirma.',
          },
          artifacts: made,
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Rasm chizilmadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'get_location': {
      try {
        const spot = await getSpot();
        let address = '';
        try {
          address = await describeSpot(spot);
        } catch {
          /* manzil nomi topilmasa koordinata yetarli */
        }
        setLastSpot(spot);
        return {
          ok: true,
          summary: address ? `Joylashuv: ${address.split(',').slice(0, 2).join(',')}` : 'Joylashuv olindi',
          payload: {
            lat: spot.lat,
            lon: spot.lon,
            aniqlik_m: Math.round(spot.accuracy ?? 0),
            manzil: address,
          },
        };
      } catch (err) {
        return {
          ok: false,
          summary: `Joylashuv olinmadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'find_place': {
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Joy nomi berilmadi', payload: { error: 'query_yoq' } };
      try {
        const found = await findPlace(query, lastSpot());
        return {
          ok: Boolean(found.length),
          summary: found.length ? `Topildi: ${found[0].name}` : `Topilmadi: ${query}`,
          payload: { joylar: found.slice(0, 5) },
        };
      } catch (err) {
        return {
          ok: false,
          summary: `Qidiruv ishlamadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'search_web': {
      if (!canSearchWeb()) {
        return {
          ok: false,
          summary: 'Internet qidiruvi mavjud emas',
          payload: {
            error:
              'Google qidiruvi faqat Gemini kaliti bilan ishlaydi. Hozir u yoʻq. ' +
              'Foydalanuvchiga ochiq ayt: jonli maʼlumotni tekshira olmayapsan, ' +
              'shuning uchun taxminiy javob berasan yoki Sozlamalarda Gemini ' +
              'kalitini kiritishini soʻra. Maʼlumotni oʻzingdan oʻylab TOPMA.',
          },
        };
      }
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Savol berilmadi', payload: { error: 'query_yoq' } };
      try {
        const answer = await searchAny(query, ctx.signal);
        return {
          ok: true,
          summary: `Qidirildi: ${query.slice(0, 40)}`,
          payload: { natija: answer.text, manbalar: answer.sources },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Qidiruv ishlamadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }


    case 'open_site': {
      const url = str(args.url);
      if (!url) return { ok: false, summary: 'Manzil berilmadi', payload: { error: 'url_yoq' } };
      openSite(url);
      return {
        ok: true,
        summary: `Ochildi: ${url.replace(/^https?:\/\//, '').slice(0, 40)}`,
        payload: {
          ochildi: url,
          koʻrsatma: 'Sayt foydalanuvchining ekranida ochildi — havolani qayta yozma.',
        },
      };
    }

    case 'find_video': {
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Mavzu berilmadi', payload: { error: 'query_yoq' } };
      const language = str(args.language);
      const ask =
        `YouTube dan «${query}» mavzusidagi eng foydali 3-5 ta videoni top` +
        (language ? ` (${language} tilida boʻlsa afzal)` : '') +
        `. Har biri uchun toʻliq youtube.com/watch?v=... havolasini, sarlavhasini va ` +
        `nima haqidaligini bir jumlada yoz. Faqat haqiqatan mavjud videolarni ber.`;

      const browse = searchUrl(query);
      let note = '';

      /*
       * Qidiruv band boʻlishi mumkin — ikki marta urinamiz. Avval har
       * bir model bilan alohida urinilardi, lekin endi model tanlashni
       * `searchAny` oʻzi qiladi (Gemini yoki OpenRouter `:online`).
       */
      for (let urinish = 0; urinish < 2; urinish += 1) {
        try {
          const answer = await searchAny(ask, ctx.signal);
          const found = [
            ...findVideos(answer.text),
            ...findVideos(answer.sources.map((src) => src.url).join(' ')),
          ];
          const unique = found.filter((v, i) => found.findIndex((o) => o.id === v.id) === i);

          /*
           * HAVOLA TEKSHIRILADI.
           *
           * Model havolani oʻylab topishi mumkin — eng koʻp uchraydigani
           * `dQw4w9WgXcQ`. Ilgari oʻsha id javobga tushib ketardi va
           * odam butunlay boshqa video koʻrardi. Endi har bir nomzod
           * haqiqatan mavjudligi tekshiriladi va sarlavhasi olinadi.
           */
          const real = await keepReal(unique, ctx.signal);

          if (real.length) {
            return {
              ok: true,
              summary: `${real.length} ta video topildi`,
              payload: {
                izoh: answer.text,
                videolar: real.map((v: { url: string; title: string }) => ({
                  havola: v.url,
                  sarlavha: v.title || '(nomaʼlum)',
                })),
                youtube_qidiruv: browse,
                koʻrsatma:
                  'Havolalarni javobingda yoz — ular chatda pleyer boʻlib chiqadi. '
                  + 'MUHIM: yuqoridagi `sarlavha` — videoning HAQIQIY nomi. Agar u '
                  + 'soʻralgan mavzuga mos kelmasa, oʻsha videoni tavsiya qilma va '
                  + 'buni ochiq ayt. Sarlavhani oʻzingdan toʻqima.',
              },
            };
          }

          note = unique.length
            ? 'Model bergan havolalar tekshiruvdan oʻtmadi — bunday videolar mavjud emas.'
            : answer.text;
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          note = String((err as Error)?.message ?? err);
        }
      }

      // Qidiruv natija bermadi — YouTube ni ilovaning oʻzida ochib beramiz.
      openSite(browse);
      return {
        ok: true,
        summary: 'YouTube qidiruvi ochildi',
        payload: {
          izoh: note,
          youtube_qidiruv: browse,
          koʻrsatma:
            'Qidiruv natija bermadi, shuning uchun YouTube qidiruvi ilovaning ichki ' +
            'brauzerida ochildi — foydalanuvchi videoni oʻzi tanlaydi. Buni bir jumlada ayt ' +
            'va agar aniq video havolasini bersa, uni tarjima qilib bera olishingni eslat.',
        },
      };
    }

    case 'read_video': {
      const ref = parseYouTube(str(args.url));
      if (!ref) {
        return { ok: false, summary: 'YouTube havolasi notoʻgʻri', payload: { error: 'url_yoq' } };
      }
      const lang = str(args.lang, getState().settings.ttsLang || 'uz-UZ');
      const wantSrt = /srt|subtitr|fayl/i.test(str(args.format));

      try {
        const read = await readVideo(ref, lang, ctx.signal);
        const artifacts: Artifact[] = [];

        if (wantSrt && read.captions.length) {
          artifacts.push({
            id: uid('art'),
            kind: 'code',
            lang: 'srt',
            title: `${read.title || 'Video'} — subtitr (${languageName(lang)})`,
            content: toSrt(read.captions),
            createdAt: Date.now(),
          });
        }

        /*
         * Uzun videoda BUTUN subtitrni bermaymiz.
         *
         * Soatlik suhbat — oʻn minglab token. Savol berilgan boʻlsa
         * subtitr boʻlaklarga boʻlinadi va faqat eng mos boʻlaklar
         * (vaqti bilan) qaytariladi. Savol boʻlmasa — boshidan
         * qisqa parcha, mazmuni esa baribir toʻliq.
         */
        const savol = str(args.question);
        const parchalar = chunkCaptions(read.captions);
        let preview: string;
        let topildi = 0;

        if (savol && parchalar.length > 6) {
          const { rank } = await import('./context/retrieve');
          const mos = rank(parchalar, savol, (p) => p.text, { top: 6, threshold: 0.05 });
          topildi = mos.length;
          const tanlangan = (mos.length ? mos.map((m) => m.item) : parchalar.slice(0, 6))
            .slice()
            .sort((a, b) => a.start - b.start);
          preview = tanlangan
            .map((p) => `[${clock(p.start)}] ${p.text}`)
            .join('\n\n');
        } else {
          preview = parchalar
            .slice(0, 12)
            .map((p) => `[${clock(p.start)}] ${p.text}`)
            .join('\n');
        }

        return {
          ok: true,
          summary: `Video oʻqildi: ${read.title || ref.id}`,
          artifacts,
          payload: {
            sarlavha: read.title,
            asl_til: read.language,
            mazmuni: read.summary,
            subtitr_boʻlaklari: read.captions.length,
            davomiyligi: read.captions.length
              ? clock(read.captions[read.captions.length - 1].end)
              : undefined,
            ...(savol
              ? {
                  savol: savol,
                  mos_joylar: preview || '(mos joy topilmadi)',
                  topilgan_boʻlaklar: topildi,
                }
              : { tarjima_boshi: preview }),
            fayl: wantSrt && artifacts.length ? '.srt fayli tayyor' : undefined,
            koʻrsatma:
              savol
                ? 'Yuqoridagi `mos_joylar` — videoning aynan shu savolga tegishli '
                  + 'qismlari. Javobni shulardan ber va qaysi daqiqada aytilganini '
                  + 'koʻrsat (masalan «12:40 da»). Butun videoni qayta soʻzlab berma.'
                : 'Mazmunini oʻz soʻzing bilan yoz. Subtitrni toʻliq koʻchirma — '
                  + 'asosiy fikrlarni va muhim joylarni vaqti bilan ayt.',
          },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Video oʻqilmadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'dub_video': {
      const ref = parseYouTube(str(args.url));
      if (!ref) {
        return { ok: false, summary: 'YouTube havolasi notoʻgʻri', payload: { error: 'url_yoq' } };
      }
      const lang = str(args.lang, getState().settings.ttsLang || 'uz-UZ');

      try {
        const read = await readVideo(ref, lang, ctx.signal);
        const narration = toNarration(read);
        if (!narration) {
          return { ok: false, summary: 'Videodan matn chiqmadi', payload: { error: 'matn_yoq' } };
        }

        let wav: string;
        try {
          wav = await synthesize(narration, undefined, ctx.signal);
        } catch {
          // Uzun matn ovozga sigʻmasa — qisqacha mazmunni oʻqiymiz.
          wav = await synthesize(read.summary, undefined, ctx.signal);
        }

        return {
          ok: true,
          summary: `Ovozli tarjima tayyor (${languageName(lang)})`,
          artifacts: [
            {
              id: uid('art'),
              kind: 'audio',
              mimeType: 'audio/wav',
              title: `${read.title || 'Video'} — ${languageName(lang)} ovoz`,
              content: wav,
              createdAt: Date.now(),
            },
          ],
          payload: {
            sarlavha: read.title,
            mazmuni: read.summary,
            koʻrsatma:
              'Ovozli fayl chatda oʻzi chiqadi — uni matn bilan qayta tasvirlama. ' +
              'Faqat qisqacha mazmunini ayt.',
          },
        };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {
          ok: false,
          summary: `Ovozli tarjima boʻlmadi: ${(err as Error).message}`,
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
    }

    case 'search_web': {
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Savol berilmadi', payload: { error: 'query_yoq' } };

      // Qidiruv serveri band boʻlsa yana bir marta urinib koʻramiz.
      let lastError = '';

      for (let urinish = 0; urinish < 2; urinish += 1) {
        try {
          const answer = await searchAny(query, ctx.signal);
          return {
            ok: true,
            summary: `Qidirildi: ${query.slice(0, 40)}`,
            payload: { natija: answer.text, manbalar: answer.sources },
          };
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          lastError = String((err as Error)?.message ?? err);
        }
      }

      return {
        ok: false,
        summary: `Qidiruv ishlamadi: ${lastError}`,
        payload: {
          error: lastError,
          koʻrsatma:
            'Qidiruv serveri band. Foydalanuvchiga aytib, kerak boʻlsa open_site bilan ' +
            'tegishli saytni ochib ber yoki oʻzingdagi bilim bilan javob ber (lekin ' +
            'maʼlumot eskirgan boʻlishi mumkinligini ayt).',
        },
      };
    }

    case 'plan_route': {
      const destination = str(args.destination);
      if (!destination) {
        return { ok: false, summary: 'Manzil berilmadi', payload: { error: 'destination_yoq' } };
      }
      const mode = (['transit', 'walking', 'driving', 'bicycling'] as const).includes(
        str(args.mode, 'transit') as TravelMode,
      )
        ? (str(args.mode, 'transit') as TravelMode)
        : 'transit';

      let from: Spot | null = null;
      try {
        from = await getSpot();
        setLastSpot(from);
      } catch {
        /* joylashuvsiz ham manzilni koʻrsata olamiz */
      }

      let target: Place | null = null;
      try {
        target = (await findPlace(destination, from ?? undefined))[0] ?? null;
      } catch {
        /* xarita qidiruvi ishlamasa havolaning oʻzi yetadi */
      }

      const meters = from && target ? distanceM(from, target) : null;
      const route: RoutePlan = {
        id: uid('r_'),
        destination: target?.name ?? destination,
        address: target?.address,
        lat: target?.lat,
        lon: target?.lon,
        mode,
        mapsUrl: directionsUrl(from, target ?? destination, mode),
        createdAt: Date.now(),
      };
      setState((s) => ({ routes: [route, ...s.routes].slice(0, 20) }));

      return {
        ok: true,
        summary: `Yoʻl tayyor: ${route.destination}`,
        payload: {
          manzil: route.destination,
          toliq_manzil: target?.address ?? '',
          masofa: meters ? humanDistance(meters) : 'nomaʼlum',
          masofa_m: meters ? Math.round(meters) : null,
          hozirgi_joy: from ? { lat: from.lat, lon: from.lon } : null,
          eslatma:
            'Foydalanuvchiga chatda jonli kuzatuv kartasi koʻrsatildi (xarita, masofa, ' +
            '«Xaritada ochish» tugmasi). Sen esa search_web bilan aynan qaysi metro liniyasi, ' +
            'qaysi bekat va avtobus raqamlari kerakligini topib, qisqa qadamlar bilan yoz.',
        },
        route: route.id,
      };
    }

    case 'illustrate_document': {
      const { chats } = getState();
      const chat = chats.find((c) => c.id === ctx.chatId);

      // Suhbatdagi eng oxirgi hujjatni topamiz.
      let source: Attachment | null = null;
      for (let i = (chat?.messages.length ?? 0) - 1; i >= 0 && !source; i -= 1) {
        const msg = chat!.messages[i];
        for (const att of msg.attachments ?? []) {
          if (att.mimeType === DOCX_MIME || att.mimeType === 'application/pdf') {
            source = att;
            break;
          }
        }
      }
      if (!source) {
        return {
          ok: false,
          summary: 'Hujjat topilmadi',
          payload: { error: 'Avval Word (.docx) yoki PDF faylni biriktiring' },
        };
      }

      const count = Math.max(1, Math.min(12, Math.round(num(args.count, 5))));
      const style = str(args.style, 'chiroyli, kitobga mos illyustratsiya');
      const note = str(args.note);

      // 1. Hujjat matni.
      let text = '';
      if (source.mimeType === DOCX_MIME) {
        text = readDocx(b64ToBytes(source.data));
      } else {
        /*
         * PDF ni faqat KOʻRADIGAN model oʻqiy oladi. Avval bu yerda
         * Gemini qattiq yozilgan edi — OpenRouter bilan ishlaydigan
         * odamda hujjatga rasm qoʻshish umuman ishlamasdi.
         */
        text = await visionAny(
          'Ushbu PDF hujjatning BARCHA matnini oʻzgartirmasdan, tartibi bilan yozib ber. '
            + 'Izoh qoʻshma, faqat matnning oʻzi.',
          [source],
          ctx.signal,
        );
      }
      if (text.trim().length < 40) {
        return { ok: false, summary: 'Hujjat matni oʻqilmadi', payload: { error: 'matn_yoq' } };
      }
      const forPlan = text.length > 24000 ? `${text.slice(0, 24000)}\n…` : text;

      // 2. Qayerga qanday rasm kerakligini modeldan soʻraymiz.
      const plan = await jsonAny<{
        images: Array<{ prompt: string; caption?: string; after?: string }>;
      }>(
        `Quyidagi hujjatga ${count} ta rasm qoʻshamiz. Uslub: ${style}.` +
          (note ? ` Qoʻshimcha talab: ${note}.` : '') +
          `\n\nHar bir rasm uchun:\n` +
          `- "prompt": rasm tavsifi INGLIZ tilida, juda batafsil (nima tasvirlangan, ` +
          `uslub, rang, yorugʻlik). Matnda yozuv boʻlmasin.\n` +
          `- "caption": rasm ostidagi qisqa izoh — OʻZBEK tilida.\n` +
          `- "after": hujjatdagi AYNAN shu joydan keyin rasm turishi kerak boʻlgan ` +
          `jumla (hujjatdan soʻzma-soʻz koʻchirilgan 5-12 soʻz).\n\n` +
          `Rasmlar butun hujjat boʻylab teng taqsimlansin.\n\nHUJJAT:\n${forPlan}`,
        {
          type: 'OBJECT',
          properties: {
            images: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  prompt: { type: 'STRING' },
                  caption: { type: 'STRING' },
                  after: { type: 'STRING' },
                },
                required: ['prompt'],
              },
            },
          },
          required: ['images'],
        },
        ctx.signal,
      );

      const wanted = (plan.images ?? []).slice(0, count);
      if (!wanted.length) {
        return { ok: false, summary: 'Rasm rejasi tuzilmadi', payload: { error: 'reja_yoq' } };
      }

      // 3. Rasmlarni chizamiz (birma-bir — server limitini urmaslik uchun).
      const images: DocImage[] = [];
      const drawn: string[] = [];
      for (const item of wanted) {
        try {
          const drawnImages = await imageAny(
            `${item.prompt}. Style: ${style}.${note ? ` ${note}.` : ''} No text or letters in the image.`,
            [],
            ctx.signal,
          );
          const first = drawnImages[0];
          if (!first) continue;
          const size = await imageSize(first.data, first.mimeType);
          images.push({
            data: first.data,
            mimeType: first.mimeType,
            caption: item.caption,
            width: size.width,
            height: size.height,
          });
          drawn.push(item.after ?? '');
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') throw err;
          // Bitta rasm chiqmasa ham qolganini davom ettiramiz.
        }
      }
      if (!images.length) {
        return { ok: false, summary: 'Rasm chizilmadi', payload: { error: 'rasm_yoq' } };
      }

      // 4. Yangi .docx ni yigʻib, telefonga saqlaymiz.
      const parts = placeImages(text, drawn.map((after) => ({ after })));
      const bytes = buildDocxWithImages(parts, images);
      const title = (source.name ?? 'hujjat').replace(/\.(docx|pdf)$/i, '');
      const fileName = `${title}-rasmli.docx`;
      const where = await saveBytes(fileName, bytes, DOCX_MIME);

      return {
        ok: true,
        summary: `${images.length} ta rasm qoʻshildi → ${fileName}`,
        payload: {
          fayl: fileName,
          rasmlar: images.length,
          saqlandi: where,
          eslatma:
            'Fayl foydalanuvchining telefoniga saqlandi. Rasmlar hujjat ichiga ' +
            'joylandi. Qisqa qilib nima qilganingni ayt va faylni qayerdan ' +
            'topishini bir jumlada aytib qoʻy.',
        },
      };
    }

    case 'read_data': {
      const what = str(args.what, 'all').toLowerCase();
      const q = str(args.query).toLowerCase();
      const s = getState();
      const match = (text: string) => !q || text.toLowerCase().includes(q);
      const out: Record<string, unknown> = {};
      if (what === 'schedule' || what === 'all') {
        out.schedule = s.schedule
          .filter((i) => match(i.subject))
          .map((i) => `${DAYS[i.day]} ${i.start}-${i.end} ${i.subject}${i.room ? ` (${i.room})` : ''}`);
      }
      if (what === 'tasks' || what === 'all') {
        out.tasks = s.tasks
          .filter((t) => match(t.title))
          .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.title}${t.due ? ` — ${t.due}` : ''}`);
      }
      if (what === 'notes' || what === 'all') {
        out.notes = s.notes
          .filter((n) => match(n.title + n.content))
          .slice(0, 20)
          .map((n) => `${n.subject}: ${n.title}`);
      }
      if (what === 'projects' || what === 'all') {
        out.projects = s.projects
          .filter((p) => match(p.name))
          .map((p) => `${p.name} — ${p.steps.filter((x) => x.done).length}/${p.steps.length} bosqich`);
      }
      if (what === 'courses' || what === 'all') {
        out.courses = s.courses
          .filter((c) => match(c.title + c.field))
          .map(
            (c) =>
              `${c.title} — ${c.topics.filter((t) => t.done).length}/${c.topics.length} mavzu oʻrganilgan`,
          );
      }
      if (what === 'apps' || what === 'all') {
        out.apps = s.apps.filter((a) => match(a.name)).map((a) => `${a.icon} ${a.name}`);
      }
      if (what === 'timelogs' || what === 'all') {
        out.timelogs = s.timeLogs
          .filter((l) => match(l.label))
          .slice(0, 20)
          .map((l) => `${l.label} — ${fmtDuration((l.end ?? Date.now()) - l.start)}`);
      }
      return { ok: true, summary: `Maʼlumot oʻqildi: ${what}`, payload: out };
    }

    default:
      return {
        ok: false,
        summary: `Nomaʼlum vosita: ${name}`,
        payload: { error: 'unknown_tool' },
      };
  }
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/** Model uchun foydalanuvchi holatining ixcham xulosasi. */
export function buildContextSummary(): string {
  const s = getState();
  const day = weekdayIndex();
  const today = s.schedule.filter((i) => i.day === day);
  const open = s.tasks.filter((t) => !t.done).slice(0, 12);
  const lines: string[] = [];

  lines.push(`Bugun: ${DAYS[day]}, ${todayISO()}`);

  if (today.length) {
    lines.push(
      `Bugungi darslar: ${today
        .map((i) => `${i.start}-${i.end} ${i.subject}${i.room ? ` (${i.room})` : ''}`)
        .join('; ')}`,
    );
  } else {
    lines.push('Bugungi darslar: jadvalda yoʻq');
  }

  if (open.length) {
    lines.push(
      `Ochiq vazifalar: ${open
        .map((t) => `${t.title}${t.due ? ` [${t.due}]` : ''}`)
        .join('; ')}`,
    );
  }

  if (s.projects.length) {
    lines.push(
      `Loyihalar: ${s.projects
        .slice(0, 6)
        .map((p) => `${p.name} (${p.steps.filter((x) => x.done).length}/${p.steps.length})`)
        .join('; ')}`,
    );
  }

  if (s.notes.length) {
    const subjects = [...new Set(s.notes.map((n) => n.subject))].slice(0, 10);
    lines.push(`Konspekt fanlari: ${subjects.join(', ')} (jami ${s.notes.length} ta)`);
  }

  if (s.courses.length) {
    lines.push(
      `Kurslar: ${s.courses
        .slice(0, 5)
        .map((c) => `${c.title} (${c.topics.filter((t) => t.done).length}/${c.topics.length})`)
        .join('; ')}`,
    );
  }

  if (s.apps.length) {
    lines.push(`Saqlangan ilovalar: ${s.apps.slice(0, 8).map((a) => a.name).join(', ')}`);
  }

  return lines.join('\n');
}
