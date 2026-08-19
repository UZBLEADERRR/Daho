const API = 'https://api.github.com';

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

function humanError(status: number, detail: string): string {
  switch (status) {
    case 401:
      return 'GitHub token qabul qilinmadi. Sozlamalardan tokenni tekshiring.';
    case 403:
      return detail.includes('rate limit')
        ? 'GitHub soʻrov limiti tugadi — bir oz kutib qayta urining.'
        : `Ruxsat yoʻq. Token’da "repo" huquqi borligini tekshiring. (${detail})`;
    case 404:
      return `Topilmadi: ${detail}`;
    case 409:
      return 'Repozitoriy boʻsh yoki tarmoq mos kelmadi.';
    case 422:
      return `GitHub qabul qilmadi: ${detail}`;
    default:
      return detail || `GitHub xatosi (${status})`;
  }
}

async function gh<T>(
  token: string,
  path: string,
  init: RequestInit & { raw?: boolean } = {},
): Promise<T> {
  if (!token) throw new GitHubError('GitHub token kiritilmagan.', 0);

  let res: Response;
  try {
    res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GitHubError('GitHub’ga ulanib boʻlmadi. Internetni tekshiring.', 0);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new GitHubError(humanError(res.status, data?.message ?? String(text).slice(0, 160)), res.status);
  }
  return data as T;
}

/* ------------------------------------------------------------------ */

export interface GhUser {
  login: string;
  name?: string;
  avatar_url?: string;
}

export interface GhRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  html_url: string;
  updated_at: string;
  description?: string;
}

export function whoAmI(token: string): Promise<GhUser> {
  return gh<GhUser>(token, '/user');
}

export function getRepo(token: string, owner: string, repo: string): Promise<GhRepo> {
  return gh<GhRepo>(token, `/repos/${owner}/${repo}`);
}

export function listRepos(token: string): Promise<GhRepo[]> {
  return gh<GhRepo[]>(token, '/user/repos?per_page=100&sort=updated&affiliation=owner');
}

export function createRepo(
  token: string,
  name: string,
  description = '',
  isPrivate = false,
): Promise<GhRepo> {
  return gh<GhRepo>(token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      private: isPrivate,
      auto_init: true,
    }),
  });
}

export interface GhContentEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  sha: string;
}

export function listContents(
  token: string,
  owner: string,
  repo: string,
  path = '',
  ref?: string,
): Promise<GhContentEntry[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return gh<GhContentEntry[]>(token, `/repos/${owner}/${repo}/contents/${path}${q}`);
}

/** Fayl matnini o'qiydi (UTF-8). */
export async function readFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await gh<{ content?: string; encoding?: string }>(
    token,
    `/repos/${owner}/${repo}/contents/${encodeURI(path)}${q}`,
  );
  if (!data?.content) throw new GitHubError(`Fayl boʻsh yoki juda katta: ${path}`, 0);
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/* ---------- Bir nechta faylni bitta commit bilan yuborish ---------- */

export interface CommitFile {
  path: string;
  content: string;
  /** content allaqachon base64 boʻlsa (rasm va boshqa ikkilik fayllar) */
  base64?: boolean;
}

export interface CommitResult {
  sha: string;
  branch: string;
}

/**
 * Git Data API orqali bir nechta faylni bitta commit qilib yuboradi.
 * Repozitoriy boʻsh boʻlsa ham ishlaydi.
 */
export async function commitFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: CommitFile[],
): Promise<CommitResult> {
  if (!files.length) throw new GitHubError('Yuboriladigan fayl yoʻq.', 0);

  let parentSha: string | null = null;
  let baseTree: string | undefined;

  try {
    const ref = await gh<{ object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    parentSha = ref.object.sha;
    const commit = await gh<{ tree: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/commits/${parentSha}`,
    );
    baseTree = commit.tree.sha;
  } catch (err) {
    // 404/409 — tarmoq hali yoʻq yoki repo boʻsh; birinchi commit qilamiz.
    if (!(err instanceof GitHubError) || ![404, 409].includes(err.status)) throw err;
  }

  const blobs = await Promise.all(
    files.map((f) =>
      gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: f.base64 ? f.content : toBase64(f.content),
          encoding: 'base64',
        }),
      }).then((b) => ({ path: f.path, sha: b.sha })),
    ),
  );

  const tree = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    }),
  });

  const commit = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      ...(parentSha ? { parents: [parentSha] } : {}),
    }),
  });

  if (parentSha) {
    await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });
  } else {
    await gh(token, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return { sha: commit.sha, branch };
}

/* ---------- GitHub Pages — jonli havola ---------- */

export interface PagesInfo {
  html_url: string;
  status?: string;
  cname?: string | null;
}

export async function getPages(
  token: string,
  owner: string,
  repo: string,
): Promise<PagesInfo | null> {
  try {
    return await gh<PagesInfo>(token, `/repos/${owner}/${repo}/pages`);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Pages’ni yoqadi (yoki manbani yangilaydi) va jonli havolani qaytaradi.
 * `domain` berilsa oʻz domeningizga ulanadi.
 */
export async function enablePages(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  domain?: string,
): Promise<PagesInfo> {
  const existing = await getPages(token, owner, repo);

  if (!existing) {
    await gh(token, `/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      body: JSON.stringify({ source: { branch, path: '/' } }),
    });
  } else {
    await gh(token, `/repos/${owner}/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({
        source: { branch, path: '/' },
        ...(domain ? { cname: domain } : {}),
      }),
    }).catch(() => undefined);
  }

  if (domain && !existing) {
    await gh(token, `/repos/${owner}/${repo}/pages`, {
      method: 'PUT',
      body: JSON.stringify({ cname: domain, source: { branch, path: '/' } }),
    }).catch(() => undefined);
  }

  const info = await getPages(token, owner, repo);
  if (!info) throw new GitHubError('Pages yoqilmadi — repozitoriy ochiq (public) boʻlishi kerak.', 0);
  return info;
}

/** Repozitoriyni ochiq qiladi — Pages bepul rejada faqat ochiq repo’da ishlaydi. */
export function makePublic(token: string, owner: string, repo: string): Promise<GhRepo> {
  return gh<GhRepo>(token, `/repos/${owner}/${repo}`, {
    method: 'PATCH',
    body: JSON.stringify({ private: false }),
  });
}

/* ---------- GitHub Actions — telefondagi "build serveri" ---------- */

export interface WorkflowRunInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  head_sha: string;
}

/** Repozitoriydagi ishga tushishlar (eng yangisi birinchi). */
export async function listRuns(
  token: string,
  owner: string,
  repo: string,
  limit = 5,
): Promise<WorkflowRunInfo[]> {
  const data = await gh<{ workflow_runs: WorkflowRunInfo[] }>(
    token,
    `/repos/${owner}/${repo}/actions/runs?per_page=${limit}`,
  );
  return data.workflow_runs ?? [];
}

/** `workflow_dispatch` orqali ish oqimini qo'lda ishga tushiradi. */
export async function dispatchWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowFile: string,
  ref: string,
): Promise<void> {
  await gh(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

export interface RunArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
}

export async function listRunArtifacts(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<RunArtifact[]> {
  const data = await gh<{ artifacts: RunArtifact[] }>(
    token,
    `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`,
  );
  return data.artifacts ?? [];
}

/** Muvaffaqiyatsiz ishning qisqa jurnalini oladi (agentga tuzatish uchun). */
export async function runFailureLog(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<string> {
  const jobs = await gh<{ jobs: Array<{ id: number; name: string; conclusion: string; steps?: Array<{ name: string; conclusion: string }> }> }>(
    token,
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
  );
  const failed = jobs.jobs?.find((j) => j.conclusion === 'failure');
  if (!failed) return 'Muvaffaqiyatsiz ish topilmadi.';

  const badSteps = (failed.steps ?? [])
    .filter((s) => s.conclusion === 'failure')
    .map((s) => s.name)
    .join(', ');

  // Jurnal matni ZIP boʻlib keladi; bu yerda faqat qadam nomlarini qaytaramiz.
  return `Ish: ${failed.name}. Yiqilgan qadam(lar): ${badSteps || 'nomaʼlum'}.`;
}

/* ---------- Tarmoqlar ---------- */

export interface GhBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

export function listBranches(token: string, owner: string, repo: string): Promise<GhBranch[]> {
  return gh<GhBranch[]>(token, `/repos/${owner}/${repo}/branches?per_page=100`);
}

/** `from` tarmog'idan yangi tarmoq ochadi. */
export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  name: string,
  from: string,
): Promise<void> {
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(from)}`,
  );
  await gh(token, `/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }),
  });
}

/* ---------- Pull request ---------- */

export interface GhPull {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  draft?: boolean;
}

export function listPulls(
  token: string,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GhPull[]> {
  return gh<GhPull[]>(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30`);
}

export function createPull(
  token: string,
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body = '',
  draft = false,
): Promise<GhPull> {
  return gh<GhPull>(token, `/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title, head, base, body, draft }),
  });
}

export function mergePull(
  token: string,
  owner: string,
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<{ merged: boolean; message: string }> {
  return gh(token, `/repos/${owner}/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: method }),
  });
}

/* ---------- Issue ---------- */

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body?: string;
}

export function listIssues(
  token: string,
  owner: string,
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GhIssue[]> {
  return gh<GhIssue[]>(token, `/repos/${owner}/${repo}/issues?state=${state}&per_page=30`);
}

export function createIssue(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body = '',
): Promise<GhIssue> {
  return gh<GhIssue>(token, `/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

export function commentIssue(
  token: string,
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<{ html_url: string }> {
  return gh(token, `/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function closeIssue(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GhIssue> {
  return gh<GhIssue>(token, `/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  });
}

/* ---------- Reliz ---------- */

export interface GhAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface GhRelease {
  id: number;
  tag_name: string;
  name: string;
  html_url: string;
  assets?: GhAsset[];
}

export function createRelease(
  token: string,
  owner: string,
  repo: string,
  tag: string,
  name: string,
  body = '',
): Promise<GhRelease> {
  return gh<GhRelease>(token, `/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
  });
}

export function listReleases(token: string, owner: string, repo: string): Promise<GhRelease[]> {
  return gh<GhRelease[]>(token, `/repos/${owner}/${repo}/releases?per_page=20`);
}

/**
 * Fayl baytlarini oladi (APK, zip va h.k.).
 *
 * GitHub Actions artefakti faqat token bilan yuklanadi va u boshqa domenga
 * yoʻnaltiradi — brauzer bunday javobni oʻqishga har doim ham ruxsat bermaydi.
 * Shuning uchun chaqiruvchi xatoni ushlab, havolani tashqi brauzerda ochishi
 * kerak (u yerda tizim yuklab oluvchisi ishlaydi).
 */
export async function fetchBinary(url: string, token?: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: token
        ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
        : {},
    });
  } catch {
    throw new GitHubError('Faylni olib boʻlmadi (tarmoq yoki brauzer cheklovi).', 0);
  }
  if (!res.ok) throw new GitHubError(`Fayl yuklanmadi (HTTP ${res.status})`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

/** Ish natijasidagi artefakt (zip) baytlari. */
export function downloadArtifact(
  token: string,
  owner: string,
  repo: string,
  artifactId: number,
): Promise<Uint8Array> {
  return fetchBinary(`${API}/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`, token);
}

/* ---------- Qidiruv ---------- */

export interface CodeHit {
  path: string;
  repository: { full_name: string };
  html_url: string;
}

export function searchCode(token: string, query: string): Promise<{ items: CodeHit[] }> {
  return gh(token, `/search/code?q=${encodeURIComponent(query)}&per_page=20`);
}

/* ---------- Fayl o'chirish ---------- */

export async function deleteRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  message: string,
): Promise<void> {
  const meta = await gh<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`,
  );
  await gh(token, `/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: meta.sha, branch }),
  });
}

/* ---------- Repo sozlamalari ---------- */

export function updateRepo(
  token: string,
  owner: string,
  repo: string,
  patch: Record<string, unknown>,
): Promise<GhRepo> {
  return gh<GhRepo>(token, `/repos/${owner}/${repo}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function setTopics(
  token: string,
  owner: string,
  repo: string,
  topics: string[],
): Promise<{ names: string[] }> {
  return gh(token, `/repos/${owner}/${repo}/topics`, {
    method: 'PUT',
    body: JSON.stringify({ names: topics.map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, '-')) }),
    headers: { Accept: 'application/vnd.github.mercy-preview+json' },
  });
}

/** Oxirgi commitlar — o'zgarishlar tarixini ko'rish uchun. */
export interface GhCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
}

export function listCommits(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  limit = 10,
): Promise<GhCommit[]> {
  return gh<GhCommit[]>(
    token,
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`,
  );
}
