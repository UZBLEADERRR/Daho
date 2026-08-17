/**
 * Chidamli oqim — ish hech qachon yarim yoʻlda toʻxtab qolmasin.
 *
 * Uchta muammoni yechadi:
 *
 * 1. **Server band.** 429/503 yoki «overloaded» xatosi kelsa, yozilgan matnni
 *    orqaga qaytarib, kutib, qaytadan uradi. Uch marta boʻlmasa — boshqa
 *    modelga oʻtadi (foydalanuvchi yoqib qoʻygan modellar ichidan).
 * 2. **Javob kesilib qoldi.** Kuchsiz/lite modellar uzun javobni oxirigacha
 *    yozolmaydi — `MAX_TOKENS` bilan toʻxtaydi. Bunda oʻzi «davom et» deb
 *    qayta soʻraydi va matnni ulab ketadi. Foydalanuvchi buni sezmaydi.
 * 3. **Oqim jimib qoldi.** Server ulanishni ochiq qoldirib, hech narsa
 *    yubormasa — kutib oʻtirmaymiz, uzib qayta boshlaymiz.
 */

import { GeminiError, type StreamOptions, type StreamResult } from './gemini';
import { streamAny, parseRef, usableChatModels } from './providers';
import { getState } from './store';

export interface ResilientOptions extends Omit<StreamOptions, 'onRetry'> {
  /** Xato boʻlsa shu qadar belgi orqaga qaytariladi (yarim yozilgan matn) */
  rollback?: (chars: number) => void;
  /** Foydalanuvchiga koʻrinadigan holat */
  onStep?: (step: string) => void;
  /** Model band boʻlsa boshqasiga oʻtish mumkinmi */
  allowModelSwap?: boolean;
  attempts?: number;
  /** Kesilgan javobni avtomatik davom ettirish (standart: sozlamadan) */
  autoContinue?: boolean;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Shu model band boʻlsa — oʻrniga ishlatish mumkin boʻlgan model.
 * Avval oʻsha provayderning boshqa modeli, keyin butunlay boshqa provayder:
 * bitta server band boʻlsa ikkinchisi ishlaydi.
 */
export function fallbackModel(current: string, tried: string[] = []): string | null {
  const pool = usableChatModels().map((m) => m.id);
  const skip = new Set([current, ...tried]);
  const here = parseRef(current).provider;

  const sameProvider = pool.find((id) => !skip.has(id) && parseRef(id).provider === here);
  const other = pool.find((id) => !skip.has(id) && parseRef(id).provider !== here);
  // Boshqa provayder ishonchliroq — bitta hisobning limiti tugagan boʻlishi mumkin.
  return other ?? sameProvider ?? null;
}

const BUSY =
  /(overload|high traffic|band|unavailable|resource has been exhausted|try again|rate.?limit|timeout|capacity)/i;

/** Server bandligidan kelib chiqqan xatomi? */
function isBusy(err: unknown): boolean {
  if (err instanceof GeminiError) {
    if ([408, 429, 500, 502, 503, 504].includes(err.status)) return true;
    return BUSY.test(err.message);
  }
  const message = String((err as Error)?.message ?? '');
  return BUSY.test(message) || /network|fetch|load failed/i.test(message);
}

/** Javob kesilib qolganmi (model gapini tugatmadi)? */
function wasCut(result: StreamResult): boolean {
  if (result.functionCalls.length) return false;
  if (result.finishReason === 'MAX_TOKENS') return true;
  // Baʼzi provayderlar sababni aytmaydi — matnning oʻzidan bilamiz:
  // tugallanmagan kod bloki yoki jumla oʻrtasida uzilgan matn.
  if (result.finishReason && result.finishReason !== 'STOP') return false;
  const text = result.text.trimEnd();
  if (text.length < 400) return false;
  const fences = (text.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return true;
  return false;
}

const CONTINUE_HINT =
  'Javobing tugamay uzilib qoldi. AYNAN uzilgan joydan davom ettir. ' +
  'Salomlashma, avvalgi matnni takrorlama, «davom etaman» deb yozma — ' +
  'toʻgʻridan-toʻgʻri keyingi belgidan yozishni davom ettir.';

/**
 * Bitta toʻliq javob oladi: server bandligini, model almashishini va
 * kesilgan javobni davom ettirishni oʻzi hal qiladi.
 */
export async function streamResilient(opts: ResilientOptions): Promise<StreamResult> {
  const { settings } = getState();
  const attempts = opts.attempts ?? 4;
  const autoContinue = opts.autoContinue ?? settings.autoContinue !== false;
  const maxContinues = Math.max(0, Math.min(20, settings.maxContinues ?? 6));

  let model = opts.model;
  const tried: string[] = [];

  /** Bitta chaqiruv — band boʻlsa qayta uradi, kerak boʻlsa model almashtiradi. */
  const once = async (
    contents: StreamOptions['contents'],
    onText: (chunk: string) => void,
  ): Promise<StreamResult> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let emitted = 0;
      try {
        return await streamAny({
          ...opts,
          model,
          contents,
          onText: (chunk) => {
            emitted += chunk.length;
            onText(chunk);
          },
          onRetry: (n, seconds) =>
            opts.onStep?.(`server band — ${seconds} s kutib qayta urinaman (${n})`),
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        lastError = err;
        if (emitted) opts.rollback?.(emitted);
        if (!isBusy(err)) throw err;
        if (attempt === attempts - 1) throw err;

        // Ikkinchi urinishdan keyin boshqa modelga oʻtamiz — kutib
        // oʻtirgandan koʻra ishlayotgan modelni topgan yaxshi.
        if (opts.allowModelSwap && attempt >= 1) {
          const other = fallbackModel(model, tried);
          if (other) {
            tried.push(model);
            model = other;
            opts.onStep?.(`«${other}» modeliga oʻtildi — avvalgisi band edi`);
          }
        }
        const seconds = Math.min(20, 4 * (attempt + 1));
        opts.onStep?.(`server band — ${seconds} s kutib davom ettiraman`);
        await sleep(seconds * 1000, opts.signal);
      }
    }
    throw lastError;
  };

  const contents = [...opts.contents];
  let result = await once(contents, opts.onText);

  if (!autoContinue) return result;

  // ---- Kesilgan javobni ulab ketamiz ----
  let joined = result;
  for (let step = 0; step < maxContinues && wasCut(joined); step += 1) {
    opts.onStep?.(`javob uzildi — davom ettiryapman (${step + 1})`);

    // Model yozganini tarixga qoʻshib, «davom et» deb soʻraymiz.
    contents.push({ role: 'model', parts: joined.parts });
    contents.push({ role: 'user', parts: [{ text: CONTINUE_HINT }] });

    let piece: StreamResult;
    try {
      piece = await once(contents, opts.onText);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      // Davomi kelmadi — bori bilan qaytamiz, ish butunlay yiqilmasin.
      opts.onStep?.('davomini olib boʻlmadi — bor matn bilan yakunlayman');
      break;
    }

    joined = {
      text: joined.text + piece.text,
      functionCalls: piece.functionCalls,
      images: [...joined.images, ...piece.images],
      parts: [...joined.parts, ...piece.parts],
      finishReason: piece.finishReason,
    };
    // Vosita chaqirilgan boʻlsa — davom etish tugadi, agent sikliga qaytamiz.
    if (piece.functionCalls.length) break;
  }

  return joined;
}
