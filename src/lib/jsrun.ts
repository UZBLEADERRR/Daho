/*
 * JavaScript bajaruvchi — Daho Code uchun «terminal» oʻrnini bosadi.
 *
 * Ilova brauzerda ishlagani uchun `bash` yoki `node` yoʻq. Lekin agentga
 * hisob-kitob qilish, maʼlumotni qayta ishlash, yozgan funksiyasini sinab
 * koʻrish imkoni kerak — aks holda u faqat taxmin qiladi.
 *
 * Kod alohida Worker da ishlaydi: DOM yoʻq, ilova holatiga tegolmaydi,
 * vaqt chegarasi bor. Cheksiz sikl butun ilovani qotirib qoʻymaydi.
 */

export interface RunResult {
  ok: boolean;
  /** console.log va shu kabilar */
  output: string;
  /** Oxirgi ifoda qiymati */
  value?: string;
  error?: string;
  ms: number;
}

const WORKER_SOURCE = `
self.onmessage = async (e) => {
  const lines = [];
  const show = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.name + ': ' + v.message;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };
  const log = (...args) => {
    lines.push(args.map(show).join(' '));
    // Juda koʻp chiqarilsa xotira toʻlmasin
    if (lines.length > 500) { lines.splice(0, 200); lines.push('… (koʻp qator olib tashlandi)'); }
  };
  self.console = { log, info: log, warn: log, error: log, debug: log, table: log };

  try {
    const fn = new Function('return (async () => {' + e.data.code + '\\n})()');
    const value = await fn();
    self.postMessage({
      ok: true,
      output: lines.join('\\n'),
      value: value === undefined ? undefined : show(value),
    });
  } catch (err) {
    self.postMessage({
      ok: false,
      output: lines.join('\\n'),
      error: err && err.message ? (err.name + ': ' + err.message) : String(err),
    });
  }
};
`;

/**
 * Kodni ishga tushiradi va natijani qaytaradi.
 *
 * @param code   Bajariladigan JavaScript. `return` bilan qiymat qaytarsa boʻladi.
 * @param timeoutMs Chegara — oʻtib ketsa Worker toʻxtatiladi.
 */
export function runJs(code: string, timeoutMs = 5000): Promise<RunResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    let url = '';
    let worker: Worker | null = null;
    let done = false;

    const finish = (result: Omit<RunResult, 'ms'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* boʻlmasa ham mayli */
      }
      if (url) URL.revokeObjectURL(url);
      resolve({ ...result, ms: Date.now() - started });
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          output: '',
          error: `Vaqt tugadi (${timeoutMs} ms). Cheksiz sikl yoki juda ogʻir hisob boʻlishi mumkin.`,
        }),
      timeoutMs,
    );

    try {
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = (e) => finish(e.data as Omit<RunResult, 'ms'>);
      worker.onerror = (e) =>
        finish({ ok: false, output: '', error: e.message || 'Worker xatosi' });
      worker.postMessage({ code });
    } catch (err) {
      finish({
        ok: false,
        output: '',
        error: `Bajaruvchi ochilmadi: ${String((err as Error)?.message ?? err)}`,
      });
    }
  });
}
