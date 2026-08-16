/**
 * Chidamli oqim — Google serveri band boʻlganda ish toʻxtab qolmasin.
 *
 * `streamGenerate` soʻrov boshlanishida 429/503 ni oʻzi qayta uradi, lekin
 * xato oqim OʻRTASIDA ham kelishi mumkin («high traffic», «overloaded»).
 * Bunda butun ish yiqilib ketmasligi kerak: yozilgan matnni orqaga qaytarib,
 * biroz kutib, qaytadan uramiz. Uchinchi urinishda esa boshqa modelga oʻtamiz.
 */

import { GeminiError, streamGenerate, type StreamOptions, type StreamResult } from './gemini';
import { byRole, cachedModels } from './models';

export interface ResilientOptions extends Omit<StreamOptions, 'onRetry'> {
  /** Xato boʻlsa shu qadar belgi orqaga qaytariladi (yarim yozilgan matn) */
  rollback?: (chars: number) => void;
  /** Foydalanuvchiga koʻrinadigan holat */
  onStep?: (step: string) => void;
  /** Model band boʻlsa boshqasiga oʻtish mumkinmi */
  allowModelSwap?: boolean;
  attempts?: number;
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

/** Shu model band boʻlsa — oʻrniga ishlatish mumkin boʻlgan model. */
export function fallbackModel(current: string): string | null {
  const list = byRole(cachedModels(), 'chat').map((m) => m.id);
  return list.find((id) => id !== current) ?? null;
}

const BUSY = /(overload|high traffic|band|unavailable|resource has been exhausted|try again)/i;

/** Server bandligidan kelib chiqqan xatomi? */
function isBusy(err: unknown): boolean {
  if (err instanceof GeminiError) {
    if ([429, 500, 502, 503, 504].includes(err.status)) return true;
    return BUSY.test(err.message);
  }
  return BUSY.test(String((err as Error)?.message ?? ''));
}

export async function streamResilient(opts: ResilientOptions): Promise<StreamResult> {
  const attempts = opts.attempts ?? 3;
  let model = opts.model;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let emitted = 0;
    try {
      return await streamGenerate({
        ...opts,
        model,
        onText: (chunk) => {
          emitted += chunk.length;
          opts.onText(chunk);
        },
        onRetry: (n, seconds) =>
          opts.onStep?.(`server band — ${seconds} s kutib qayta urinaman (${n})`),
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      lastError = err;
      if (emitted) opts.rollback?.(emitted);
      if (attempt === attempts - 1 || !isBusy(err)) throw err;

      // Oxirgi urinishdan oldin boshqa modelga oʻtib koʻramiz.
      if (opts.allowModelSwap && attempt === attempts - 2) {
        const other = fallbackModel(model);
        if (other) {
          model = other;
          opts.onStep?.(`«${other}» modeliga oʻtildi — avvalgisi band edi`);
        }
      }
      const seconds = 5 * (attempt + 1);
      opts.onStep?.(`server band — ${seconds} s kutib davom ettiraman`);
      await sleep(seconds * 1000, opts.signal);
    }
  }
  throw lastError;
}
