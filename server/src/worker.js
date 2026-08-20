import { DEFAULT_MODEL } from './gemini.js';
import { env } from './env.js';
import { runJob } from './jobs.js';
import { adminClient } from './supabase.js';

let running = false;
let timer = null;
const stats = { picked: 0, done: 0, failed: 0, lastRun: null, lastError: null };

export function workerStats() {
  return { ...stats, polling: timer !== null, busy: running };
}

/**
 * Navbatdan vazifa olib bajaradi.
 *
 * Ilova yopiq, telefon oʻchiq — farqi yoʻq: server doim ishlab turadi va
 * navbatni oʻzi tekshiradi.
 */
export async function tick(limit = env.batchSize) {
  if (running) return { skipped: 'band' };
  running = true;
  const report = [];

  try {
    const admin = adminClient();
    const { data: jobs, error } = await admin.rpc('claim_jobs', { p_limit: limit });
    if (error) throw new Error(error.message);

    const picked = jobs ?? [];
    stats.picked += picked.length;
    stats.lastRun = new Date().toISOString();

    for (const job of picked) {
      const model = job.model || DEFAULT_MODEL[job.kind] || DEFAULT_MODEL.chat;
      try {
        // Rejasi shu modelga ruxsat beradimi va krediti yetadimi
        const { data: check } = await admin.rpc('can_use_model', {
          p_user: job.user_id,
          p_model: model,
        });
        if (!check?.allowed) throw new Error(check?.reason ?? 'ruxsat yoʻq');

        // Uzoq ishda foydalanuvchi jarayonni koʻrib tursin.
        // supabase-js soʻrovi faqat `await`/`then` da yuboriladi — `void`
        // bilan qoldirilsa hech qachon ketmaydi.
        const note = (text) => {
          admin
            .from('jobs')
            .update({ result: { progress: text } })
            .eq('id', job.id)
            .then(
              () => undefined,
              () => undefined,
            );
        };

        const outcome = await runJob(job, note);

        const { data: charged } = await admin.rpc('charge_usage', {
          p_user: job.user_id,
          p_model: outcome.model,
          p_kind: 'job',
          p_input: outcome.input,
          p_output: outcome.output,
          p_source: 'job',
          p_job: job.id,
          p_meta: { kind: job.kind, server: 'railway' },
        });

        await admin
          .from('jobs')
          .update({
            status: 'done',
            result: outcome.result,
            error: null,
            credits: Number(charged?.credits ?? 0),
            finished_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        stats.done += 1;
        report.push({ id: job.id, status: 'done' });
      } catch (err) {
        const message = String(err?.message ?? err);
        stats.failed += 1;
        stats.lastError = message;
        await admin
          .from('jobs')
          .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
          .eq('id', job.id);
        report.push({ id: job.id, status: 'error', error: message });
      }
    }

    return { picked: picked.length, jobs: report };
  } catch (err) {
    stats.lastError = String(err?.message ?? err);
    return { error: stats.lastError };
  } finally {
    running = false;
  }
}

/** Doimiy tekshirib turadigan sikl — Railway ning asosiy foydasi shu. */
export function startPolling() {
  if (timer) return;
  const ms = Math.max(3, env.pollSeconds) * 1000;
  timer = setInterval(() => {
    void tick().catch((err) => {
      stats.lastError = String(err?.message ?? err);
    });
  }, ms);
  console.log(`[worker] navbat har ${ms / 1000} soniyada tekshiriladi`);
}

export function stopPolling() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
