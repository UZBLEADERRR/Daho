import { askUser } from './ask';
import { b64ToBytes } from './audio';
import { createBook, writeBook } from './book';
import { geminiModel } from './models';
import { saveBytes } from './exporter';
import { generateImage, generateJson, generateText, searchAnswer } from './gemini';
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
      const { settings, artifacts: saved } = getState();
      const refs: Attachment[] = [];
      if (str(args.edit_last) === 'true') {
        const last = saved.find((a) => a.kind === 'image' && a.chatId === ctx.chatId);
        if (last) refs.push({ mimeType: last.mimeType ?? 'image/png', data: last.content });
      }
      try {
        const result = await generateImage(
          settings.apiKey,
          settings.imageModel,
          prompt,
          refs,
          ctx.signal,
        );
        const made: Artifact[] = result.images.map((img, i) => ({
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
      const query = str(args.query);
      if (!query) return { ok: false, summary: 'Savol berilmadi', payload: { error: 'query_yoq' } };
      const { settings } = getState();
      try {
        const answer = await searchAnswer(settings.apiKey, geminiModel(settings.model), query, ctx.signal);
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
      const { settings, chats } = getState();
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
        text = await generateText(
          settings.apiKey,
          geminiModel(settings.model),
          'Ushbu PDF hujjatning BARCHA matnini oʻzgartirmasdan, tartibi bilan yozib ber. ' +
            'Izoh qoʻshma, faqat matnning oʻzi.',
          [source],
          ctx.signal,
        );
      }
      if (text.trim().length < 40) {
        return { ok: false, summary: 'Hujjat matni oʻqilmadi', payload: { error: 'matn_yoq' } };
      }
      const forPlan = text.length > 24000 ? `${text.slice(0, 24000)}\n…` : text;

      // 2. Qayerga qanday rasm kerakligini modeldan soʻraymiz.
      const plan = await generateJson<{
        images: Array<{ prompt: string; caption?: string; after?: string }>;
      }>(
        settings.apiKey,
        settings.model,
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
          const result = await generateImage(
            settings.apiKey,
            settings.imageModel,
            `${item.prompt}. Style: ${style}.${note ? ` ${note}.` : ''} No text or letters in the image.`,
            [],
            ctx.signal,
          );
          const first = result.images[0];
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
