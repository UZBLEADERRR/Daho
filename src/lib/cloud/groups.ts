/**
 * Guruh loyihalari.
 *
 * Bir necha odam bitta loyiha ustida ishlaydi: egasi guruh ochadi,
 * odam qidirib taklif yuboradi, qabul qilinsa loyiha va suhbat umumiy
 * boʻladi.
 *
 * KREDIT: guruhning oʻz hamyoni bor. Aʼzo unga oʻz kreditidan
 * oʻtkazadi. Guruh ichidagi soʻrov avval SHU hamyondan toʻlanadi —
 * shunda krediti tugagan aʼzo ham ishlay oladi. Guruhda yetmasa
 * odamning oʻz krediti ishlatiladi. Bu qaror bazada (`charge_usage`)
 * qabul qilinadi, brauzerda emas.
 */
import { supa } from './client';

export interface GroupRow {
  id: string;
  name: string;
  kind: string;
  credits: number;
  my_role: string;
  members: number;
  owner_name: string;
  updated_at: string;
}

export interface Person {
  user_id: string;
  name: string;
  email_hint: string;
}

export interface GroupMember {
  user_id: string;
  name: string;
  role: string;
  joined_at: string;
}

export interface GroupInvite {
  id: string;
  group_id: string;
  group_name: string;
  from_name: string;
  created_at: string;
}

export interface GroupMessage {
  id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
}

function db() {
  const sb = supa();
  if (!sb) throw new Error('Bulut sozlanmagan');
  return sb;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------------------ */
/*  Guruhlar                                                           */
/* ------------------------------------------------------------------ */

export async function myGroups(): Promise<GroupRow[]> {
  return (await rpc<GroupRow[]>('my_groups')) ?? [];
}

/**
 * Loyiha uchun guruh ochadi.
 *
 * `projectRef` berilsa shu loyihaga BOGʻLANADI va ikkinchi marta
 * chaqirilsa yangisi ochilmaydi — borini qaytaradi.
 */
export async function createGroup(
  name: string,
  kind = 'kod',
  projectRef?: string,
): Promise<GroupRow> {
  return rpc<GroupRow>('create_group', {
    p_name: name,
    p_kind: kind,
    p_project_ref: projectRef ?? null,
  });
}

/** Egasi uchun: shu loyihaning guruhi bormi. */
export async function groupForProject(projectRef: string): Promise<GroupRow | null> {
  const rows = (await rpc<GroupRow[]>('group_for_project', { p_ref: projectRef })) ?? [];
  return rows[0] ?? null;
}

/** Aʼzo uchun: guruh id si boʻyicha. */
export async function groupById(groupId: string): Promise<GroupRow | null> {
  const rows = (await rpc<GroupRow[]>('group_by_id', { p_group: groupId })) ?? [];
  return rows[0] ?? null;
}

export async function groupPeople(groupId: string): Promise<GroupMember[]> {
  return (await rpc<GroupMember[]>('group_people', { p_group: groupId })) ?? [];
}

/**
 * Odam qidirish.
 *
 * Butun roʻyxat ochilmaydi: toʻliq pochta yoki ismning kamida uch
 * harfi kerak, pochta esa niqoblab qaytadi.
 */
export async function findPeople(query: string): Promise<Person[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  return (await rpc<Person[]>('find_people', { p_query: q })) ?? [];
}

export async function invitePerson(groupId: string, userId: string): Promise<void> {
  await rpc('invite_to_group', { p_group: groupId, p_user: userId });
}

export async function myInvites(): Promise<GroupInvite[]> {
  return (await rpc<GroupInvite[]>('my_invites')) ?? [];
}

export async function respondInvite(inviteId: string, accept: boolean): Promise<void> {
  await rpc('respond_invite', { p_invite: inviteId, p_accept: accept });
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const { error } = await db()
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Umumiy loyiha                                                      */
/* ------------------------------------------------------------------ */

export interface SharedProject {
  project: Record<string, unknown>;
  version: number;
  updated_at: string;
}

export async function loadGroupProject(groupId: string): Promise<SharedProject | null> {
  return rpc<SharedProject | null>('group_project', { p_group: groupId });
}

/**
 * Saqlash. Versiya mos kelmasa `conflict` qaytadi — boshqa aʼzo
 * ulgurgan, demak avval uniki oʻqib olinadi. Jimgina ustidan
 * yozilmaydi.
 */
export async function saveGroupProject(
  groupId: string,
  project: Record<string, unknown>,
  version?: number,
): Promise<{ version?: number; conflict?: boolean }> {
  return rpc('save_group_project', {
    p_group: groupId,
    p_project: project,
    p_version: version ?? null,
  });
}

/* ------------------------------------------------------------------ */
/*  Suhbat                                                             */
/* ------------------------------------------------------------------ */

export async function groupFeed(groupId: string, limit = 100): Promise<GroupMessage[]> {
  const rows = (await rpc<GroupMessage[]>('group_feed', { p_group: groupId, p_limit: limit })) ?? [];
  // RPC eng yangisidan beradi — ekranda esa vaqt boʻyicha oʻqiladi.
  return rows.slice().reverse();
}

export async function postGroupMessage(groupId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const { data: me } = await db().auth.getUser();
  const { error } = await db()
    .from('group_messages')
    .insert({ group_id: groupId, user_id: me?.user?.id, body: text.slice(0, 4000) });
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/*  Hamyon                                                             */
/* ------------------------------------------------------------------ */

export async function moveCreditsToGroup(groupId: string, amount: number): Promise<number> {
  const out = await rpc<{ group_credits: number }>('move_credits_to_group', {
    p_group: groupId,
    p_amount: amount,
  });
  return Number(out?.group_credits ?? 0);
}
