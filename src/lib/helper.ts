/*
 * Yordamchi agentlar — bosh agent katta ishni boʻlaklab beradigan
 * mutaxassislar.
 *
 * Ilgari faqat Daho Code da bor edi. Chatda esa bosh agentning oʻzi hamma
 * ishni bajarardi: keng mavzuni oʻrganish, uzun matn yozish va uni
 * tekshirish — hammasi bitta kontekstda toʻplanib, javob sifati tushardi.
 * Endi har bir boʻlak oʻz modeli va oʻz toza konteksti bilan bajariladi,
 * bosh agentga esa faqat hisobot qaytadi.
 */

import { streamResilient } from './resilient';
import { getState } from './store';
import { pickForJob, type JobKind } from './providers';
import { TOOL_DECLARATIONS, executeTool } from './tools';
import type { GeminiContent } from './gemini';

export type HelperRole = 'tadqiqot' | 'matn' | 'tekshir' | 'reja';

interface RoleSpec {
  job: JobKind;
  brief: string;
  /** Shu rol ishlatishi mumkin boʻlgan vositalar */
  tools: string[];
}

/** Yordamchiga faqat oʻqiydigan vositalar beriladi — hech narsani buzmaydi. */
const RESEARCH_TOOLS = ['search_web', 'open_site', 'find_video', 'read_video', 'read_data'];

const ROLES: Record<HelperRole, RoleSpec> = {
  tadqiqot: {
    job: 'reja',
    tools: RESEARCH_TOOLS,
    brief:
      'Sen tadqiqotchisan. Berilgan mavzu boʻyicha ishonchli maʼlumot yigʻasan: '
      + 'internetdan qidirasan, saytlarni oʻqiysan, kerak boʻlsa videodan olasan. '
      + 'Topilgan maʼlumotni tartibga solib, manbalari bilan qaytarasan. '
      + 'Oʻylab topma — topmasang «topilmadi» deb yoz.',
  },
  matn: {
    job: 'matn',
    tools: RESEARCH_TOOLS,
    brief:
      'Sen muharrirsan. Matn yozasan yoki bor matnni qayta ishlaysan: tahrirlash, '
      + 'qisqartirish, tarjima, uslubni oʻzgartirish. Natija tayyor holda, '
      + 'izohsiz boʻlsin — bosh agent uni toʻgʻridan-toʻgʻri ishlatadi.',
  },
  tekshir: {
    job: 'tekshir',
    tools: RESEARCH_TOOLS,
    brief:
      'Sen tekshiruvchisan. Berilgan matn yoki rejadagi xato, nomuvofiqlik, '
      + 'yetishmayotgan joy va shubhali daʼvolarni topasan. Har bir topilmani '
      + 'aniq koʻrsat: qayerda, nima notoʻgʻri, qanday tuzatish kerak. '
      + 'Hammasi joyida boʻlsa — shuni ayt, xato oʻylab topma.',
  },
  reja: {
    job: 'reja',
    tools: RESEARCH_TOOLS,
    brief:
      'Sen rejalashtiruvchisan. Katta ishni bajarish mumkin boʻlgan bosqichlarga '
      + 'ajratasan: har bosqich nima, nima kerak, qancha vaqt oladi. '
      + 'Umumiy gap emas — aniq va bajariladigan qadamlar.',
  },
};

export function helperRole(value: string): HelperRole {
  const key = value.trim().toLowerCase();
  if (key in ROLES) return key as HelperRole;
  if (key.includes('qidir') || key.includes('research')) return 'tadqiqot';
  if (key.includes('yoz') || key.includes('tarjim')) return 'matn';
  if (key.includes('tekshir') || key.includes('xato')) return 'tekshir';
  return 'reja';
}

export interface HelperReport {
  role: HelperRole;
  model: string;
  text: string;
  /** Yordamchi nechta vosita ishlatdi */
  steps: number;
}

const MAX_HELPER_ROUNDS = 6;

/**
 * Yordamchini ishga tushiradi va hisobotini qaytaradi.
 *
 * Yordamchi bosh suhbatni koʻrmaydi — faqat berilgan topshiriqni. Shuning
 * uchun topshiriq oʻzi yetarli boʻlishi kerak.
 */
export async function runHelper(
  role: HelperRole,
  task: string,
  ctx: { chatId: string; signal?: AbortSignal; onStep?: (note: string) => void },
): Promise<HelperReport> {
  const spec = ROLES[role];
  const { settings } = getState();
  const model = pickForJob(spec.job);
  const tools = TOOL_DECLARATIONS.filter((t) => spec.tools.includes(t.name));

  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: task }] }];
  let steps = 0;
  let answer = '';

  for (let round = 0; round < MAX_HELPER_ROUNDS; round += 1) {
    const result = await streamResilient({
      apiKey: settings.apiKey,
      model,
      contents,
      systemInstruction:
        `${spec.brief}\n\n`
        + 'Javobni oʻzbek tilida yoz. Qisqa va aniq — bosh agent buni oʻqib '
        + 'ishlatadi, foydalanuvchiga esa oʻzi qayta yozib beradi. '
        + 'Muqaddima qilma, darhol natijadan boshla.',
      tools: tools.length ? tools : undefined,
      temperature: settings.temperature,
      signal: ctx.signal,
      onText: () => undefined,
      onStep: ctx.onStep,
      allowModelSwap: true,
    });

    answer = result.text || answer;

    if (!result.functionCalls.length) break;

    contents.push({ role: 'model', parts: result.parts });

    const responses = [];
    for (const call of result.functionCalls) {
      steps += 1;
      ctx.onStep?.(`${role}: ${call.name}`);
      let outcome;
      try {
        outcome = await executeTool(call.name, call.args, {
          chatId: ctx.chatId,
          signal: ctx.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        outcome = {
          ok: false,
          summary: 'xato',
          payload: { error: String((err as Error)?.message ?? err) },
        };
      }
      responses.push({
        functionResponse: { name: call.name, response: outcome.payload },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return { role, model, text: answer.trim(), steps };
}
