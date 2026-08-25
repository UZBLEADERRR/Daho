/**
 * Fon vazifalari — obunachi ilovani yopsa ham ish serverda davom etadi.
 * Navbatga qo'yilgan vazifani `jobs-worker` edge funksiyasi bajaradi.
 */
import { supa } from './client';
import { accountSnapshot, scheduleAccountRefresh } from './account';
import type { CloudJob } from './types';

export type JobKind = CloudJob['kind'];

export const JOB_LABEL: Record<JobKind, string> = {
  chat: 'Matn tayyorlash',
  search: 'Internetdan qidirish',
  json: 'Tuzilgan maʼlumot',
  image: 'Rasm chizish',
  plan: 'Reja tuzish',
  kitob: 'Kitob yozish',
  telegram: 'Telegram xabari',
};

/** Reja fon vazifalariga ruxsat beradimi? */
export function backgroundAllowed(): boolean {
  const account = accountSnapshot();
  return Boolean(account?.signed_in && account.plan?.allow_background);
}

export async function enqueueJob(
  kind: JobKind,
  title: string,
  payload: Record<string, unknown>,
  model?: string,
  /** Qachon bajarilsin — berilmasa darhol navbatga tushadi. */
  scheduledAt?: Date,
): Promise<CloudJob> {
  const sb = supa();
  if (!sb) throw new Error('Bulut sozlanmagan');
  const { data, error } = await sb.rpc('enqueue_job', {
    p_kind: kind,
    p_title: title,
    p_payload: payload,
    p_model: model ?? null,
    p_scheduled_at: (scheduledAt ?? new Date()).toISOString(),
  });
  if (error) throw new Error(error.message);
  scheduleAccountRefresh(1500);
  return data as CloudJob;
}

export async function listJobs(limit = 40): Promise<CloudJob[]> {
  const sb = supa();
  if (!sb) return [];
  const { data, error } = await sb
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CloudJob[];
}

export async function cancelJob(id: string): Promise<void> {
  const sb = supa();
  if (!sb) return;
  const { error } = await sb
    .from('jobs')
    .update({ status: 'canceled' })
    .eq('id', id)
    .eq('status', 'queued');
  if (error) throw new Error(error.message);
}

export async function deleteJob(id: string): Promise<void> {
  const sb = supa();
  if (!sb) return;
  const { error } = await sb.from('jobs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Vazifa holati o'zgarganda darhol xabar beradi (realtime). */
export function watchJobs(onChange: (job: CloudJob) => void): () => void {
  const sb = supa();
  const account = accountSnapshot();
  if (!sb || !account?.signed_in) return () => undefined;

  const channel = sb
    .channel(`jobs:${account.user_id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'jobs', filter: `user_id=eq.${account.user_id}` },
      (payload) => {
        const row = payload.new as CloudJob;
        if (row?.id) onChange(row);
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}
