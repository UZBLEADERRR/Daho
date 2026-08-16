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
        body: JSON.stringify({ content: toBase64(f.content), encoding: 'base64' }),
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
