import { streamGenerate, type FunctionDeclaration, type GeminiContent, type GeminiPart } from './gemini';
import {
  commitFiles,
  createRepo,
  enablePages,
  listContents,
  listRepos,
  readFile as ghReadFile,
} from './github';
import {
  deleteProjectFile,
  fileTree,
  getCodeProject,
  patchCodeProject,
  writeProjectFile,
} from './codeproject';
import { getState, setState } from './store';
import type { CodeProject, Message, ToolCallRecord } from './types';
import { uid } from './utils';

const MAX_ROUNDS = 14;
const MAX_HISTORY = 24;

/* ------------------------------------------------------------------ */
/*  Vositalar                                                          */
/* ------------------------------------------------------------------ */

export const CODE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Loyihadagi faylning toʻliq matnini oʻqiydi.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING', description: 'Fayl yoʻli, masalan "src/app.js"' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Faylni toʻliq yozadi (mavjud boʻlsa almashtiradi, boʻlmasa yaratadi). ' +
      'Fayl mazmunini butunlay ber — qisman emas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Fayl yoʻli' },
        content: { type: 'STRING', description: 'Faylning toʻliq yangi matni' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Fayl ichidagi aniq matn boʻlagini almashtiradi. Kichik tuzatishlar uchun ' +
      'write_file dan tejamkorroq. find matni faylda aynan bir marta uchrashi kerak.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING' },
        find: { type: 'STRING', description: 'Almashtiriladigan aynan matn' },
        replace: { type: 'STRING', description: 'Yangi matn' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'delete_file',
    description: 'Loyihadan faylni oʻchiradi.',
    parameters: {
      type: 'OBJECT',
      properties: { path: { type: 'STRING' } },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'Loyihadagi barcha fayllar roʻyxatini qaytaradi.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'github_list_repos',
    description: 'Foydalanuvchining GitHub repozitoriylari roʻyxati.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'github_read',
    description:
      'GitHub repozitoriysidan fayl yoki papka mazmunini oʻqiydi. ' +
      'Mavjud loyihani oʻrganish yoki koʻchirib olish uchun.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        path: { type: 'STRING', description: 'Fayl yoʻli; boʻsh boʻlsa papka roʻyxati' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'github_import',
    description:
      'GitHub’dagi faylni joriy loyihaga koʻchirib oladi (nusxalaydi).',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        path: { type: 'STRING' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_push',
    description:
      'Loyihadagi barcha fayllarni GitHub repozitoriysiga bitta commit qilib yuboradi. ' +
      'Repozitoriy ulanmagan boʻlsa avval connect_repo yoki create_repo ni chaqir.',
    parameters: {
      type: 'OBJECT',
      properties: {
        message: { type: 'STRING', description: 'Commit izohi' },
      },
      required: ['message'],
    },
  },
  {
    name: 'create_repo',
    description: 'Yangi GitHub repozitoriysi ochadi va loyihaga bogʻlaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Repozitoriy nomi (bo‘sh joysiz)' },
        description: { type: 'STRING' },
      },
      required: ['name'],
    },
  },
  {
    name: 'connect_repo',
    description: 'Mavjud GitHub repozitoriysini joriy loyihaga bogʻlaydi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        owner: { type: 'STRING' },
        repo: { type: 'STRING' },
        branch: { type: 'STRING', description: 'Tarmoq nomi, standart: main' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'publish',
    description:
      'Loyihani internetga chiqaradi: fayllarni yuboradi va GitHub Pages’ni yoqadi. ' +
      'Natijada jonli havola qaytadi.',
    parameters: {
      type: 'OBJECT',
      properties: {
        domain: { type: 'STRING', description: 'Oʻz domeningiz (ixtiyoriy)' },
      },
    },
  },
];

export interface ToolResult {
  ok: boolean;
  summary: string;
  payload: Record<string, unknown>;
}

async function runTool(
  projectId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const str = (v: unknown, fallback = '') =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback;
  const token = getState().settings.githubToken;
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, summary: 'Loyiha topilmadi', payload: { error: 'no_project' } };

  switch (name) {
    case 'list_files':
      return {
        ok: true,
        summary: `${project.files.length} ta fayl`,
        payload: { files: project.files.map((f) => f.path) },
      };

    case 'read_file': {
      const path = str(args.path);
      const file = project.files.find((f) => f.path === path);
      if (!file) {
        return {
          ok: false,
          summary: `Fayl yoʻq: ${path}`,
          payload: { error: 'topilmadi', mavjud: project.files.map((f) => f.path) },
        };
      }
      return { ok: true, summary: `Oʻqildi: ${path}`, payload: { content: file.content } };
    }

    case 'write_file': {
      const path = str(args.path);
      if (!path) return { ok: false, summary: 'Yoʻl berilmadi', payload: { error: 'yoq' } };
      writeProjectFile(projectId, path, String(args.content ?? ''));
      return { ok: true, summary: `Yozildi: ${path}`, payload: { status: 'yozildi' } };
    }

    case 'edit_file': {
      const path = str(args.path);
      const find = String(args.find ?? '');
      const file = project.files.find((f) => f.path === path);
      if (!file) return { ok: false, summary: `Fayl yoʻq: ${path}`, payload: { error: 'topilmadi' } };
      const count = file.content.split(find).length - 1;
      if (count === 0) {
        return { ok: false, summary: `Matn topilmadi: ${path}`, payload: { error: 'mos_kelmadi' } };
      }
      if (count > 1) {
        return {
          ok: false,
          summary: `${path}: matn ${count} marta uchradi`,
          payload: { error: 'bir nechta mos keldi — uzunroq boʻlak bering' },
        };
      }
      writeProjectFile(projectId, path, file.content.replace(find, String(args.replace ?? '')));
      return { ok: true, summary: `Tuzatildi: ${path}`, payload: { status: 'tuzatildi' } };
    }

    case 'delete_file': {
      const path = str(args.path);
      const ok = deleteProjectFile(projectId, path);
      return {
        ok,
        summary: ok ? `Oʻchirildi: ${path}` : `Fayl yoʻq: ${path}`,
        payload: { status: ok ? 'oʻchirildi' : 'topilmadi' },
      };
    }

    case 'github_list_repos': {
      const repos = await listRepos(token);
      return {
        ok: true,
        summary: `${repos.length} ta repozitoriy`,
        payload: {
          repos: repos.slice(0, 40).map((r) => `${r.full_name} (${r.default_branch})`),
        },
      };
    }

    case 'github_read': {
      const owner = str(args.owner);
      const repo = str(args.repo);
      const path = str(args.path);
      if (!path) {
        const entries = await listContents(token, owner, repo);
        return {
          ok: true,
          summary: `${owner}/${repo}: ${entries.length} ta element`,
          payload: { entries: entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`) },
        };
      }
      const content = await ghReadFile(token, owner, repo, path);
      return {
        ok: true,
        summary: `GitHub’dan oʻqildi: ${path}`,
        payload: { content: content.slice(0, 40000) },
      };
    }

    case 'github_import': {
      const owner = str(args.owner);
      const repo = str(args.repo);
      const path = str(args.path);
      const content = await ghReadFile(token, owner, repo, path);
      writeProjectFile(projectId, path.split('/').pop() ?? path, content);
      return {
        ok: true,
        summary: `Koʻchirildi: ${path}`,
        payload: { status: 'koʻchirildi', qatorlar: content.split('\n').length },
      };
    }

    case 'create_repo': {
      const name = str(args.name, project.name)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const repo = await createRepo(token, name, str(args.description, project.description));
      patchCodeProject(projectId, {
        repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
      });
      return {
        ok: true,
        summary: `Repozitoriy ochildi: ${repo.full_name}`,
        payload: { full_name: repo.full_name, url: repo.html_url },
      };
    }

    case 'connect_repo': {
      const link = {
        owner: str(args.owner),
        repo: str(args.repo),
        branch: str(args.branch, 'main'),
      };
      patchCodeProject(projectId, { repo: link });
      return {
        ok: true,
        summary: `Bogʻlandi: ${link.owner}/${link.repo}`,
        payload: { status: 'bogʻlandi' },
      };
    }

    case 'github_push': {
      const link = getCodeProject(projectId)?.repo;
      if (!link) {
        return {
          ok: false,
          summary: 'Repozitoriy ulanmagan',
          payload: { error: 'avval create_repo yoki connect_repo ni chaqiring' },
        };
      }
      const files = getCodeProject(projectId)?.files ?? [];
      const result = await commitFiles(
        token,
        link.owner,
        link.repo,
        link.branch,
        str(args.message, 'Daho Code orqali yangilandi'),
        files,
      );
      return {
        ok: true,
        summary: `${files.length} ta fayl yuborildi (${result.sha.slice(0, 7)})`,
        payload: { commit: result.sha },
      };
    }

    case 'publish': {
      const domain = str(args.domain, getState().settings.publishDomain);
      const result = await publishProject(projectId, domain);
      return {
        ok: true,
        summary: `Chiqarildi: ${result.url}`,
        payload: { url: result.url },
      };
    }

    default:
      return { ok: false, summary: `Nomaʼlum vosita: ${name}`, payload: { error: 'unknown' } };
  }
}

/* ------------------------------------------------------------------ */
/*  Nashr qilish                                                       */
/* ------------------------------------------------------------------ */

export interface PublishResult {
  url: string;
  domain?: string;
}

/** Loyihani GitHub Pages’ga chiqaradi va jonli havolani qaytaradi. */
export async function publishProject(
  projectId: string,
  domain?: string,
): Promise<PublishResult> {
  const token = getState().settings.githubToken;
  let project = getCodeProject(projectId);
  if (!project) throw new Error('Loyiha topilmadi');

  if (!project.repo) {
    const name = project.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `daho-${Date.now().toString(36)}`;
    const repo = await createRepo(token, name, project.description);
    patchCodeProject(projectId, {
      repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
    });
    project = getCodeProject(projectId)!;
  }

  const link = project.repo!;
  const files = [...project.files];

  // Oʻz domeningiz boʻlsa CNAME fayli kerak.
  if (domain) {
    files.push({ path: 'CNAME', content: `${domain}\n` });
  }
  // Jekyll fayllarni yashirmasligi uchun.
  if (!files.some((f) => f.path === '.nojekyll')) {
    files.push({ path: '.nojekyll', content: '' });
  }

  await commitFiles(token, link.owner, link.repo, link.branch, 'Daho Code: nashr', files);
  const pages = await enablePages(token, link.owner, link.repo, link.branch, domain);

  const url = domain ? `https://${domain}` : pages.html_url;
  patchCodeProject(projectId, { publish: { url, domain, at: Date.now() } });
  return { url, domain };
}

/* ------------------------------------------------------------------ */
/*  Agent sikli                                                        */
/* ------------------------------------------------------------------ */

function systemPrompt(project: CodeProject): string {
  const { settings } = getState();
  return `Sen — "Daho Code", telefonda ishlaydigan dasturchi agentsan. Oʻzbek tilida gaplashasan.

## Loyiha
Nomi: ${project.name}
${project.description ? `Tavsif: ${project.description}` : ''}
GitHub: ${project.repo ? `${project.repo.owner}/${project.repo.repo} (${project.repo.branch})` : 'ulanmagan'}
Jonli havola: ${project.publish?.url ?? 'hali chiqarilmagan'}
GitHub tokeni: ${settings.githubToken ? 'kiritilgan' : 'YOʻQ — github vositalari ishlamaydi'}

Fayllar:
${fileTree(project) || '(boʻsh)'}

## Qanday ishlaysan
1. Avval kerakli fayllarni \`read_file\` bilan oʻqi — koʻrmasdan yozma.
2. Ishni mayda qadamlarga boʻl. Har bir qadamda bitta faylni oʻzgartir.
3. Kichik tuzatishga \`edit_file\`, katta oʻzgarish yoki yangi faylga \`write_file\`.
4. Ish tugagach qisqacha xulosa yoz: nima oʻzgardi va qanday sinash kerak.
5. Foydalanuvchi "chiqar", "nashr qil", "linkga qoʻy" desa — \`publish\` ni chaqir.
6. "GitHub’ga yubor" desa — \`github_push\`.

## Kod qoidalari
- Loyiha statik boʻlsin: HTML + CSS + JS. Telefon ichida ham, GitHub Pages’da ham
  server’siz ishlashi kerak. Node/Express/build bosqichi ISHLATMA.
- Tashqi CDN, shrift yoki kutubxona ULAMA — internetsiz ishlamay qoladi.
  Kerakli kodni oʻzing yoz.
- \`<link href="style.css">\` va \`<script src="app.js">\` bemalol ishlat —
  ular avtomatik birlashtiriladi.
- Mobil ekranga moslashgan, katta tugmali, qorongʻi fon.
- Kod toza, funksiyalarga ajratilgan va oʻzbekcha izohli boʻlsin.
- Interfeys matni oʻzbek tilida.

## Uslub
Qisqa yoz. Kodni javob matniga koʻchirma — vositalar orqali faylga yoz.
Nima qilayotganingni bir jumlada ayt, keyin vositani chaqir.`;
}

function toContents(messages: Message[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const msg of messages.slice(-MAX_HISTORY)) {
    if (!msg.text.trim()) continue;
    out.push({ role: msg.role, parts: [{ text: msg.text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function patchMessage(projectId: string, messageId: string, patch: Partial<Message>): void {
  setState((s) => ({
    code: s.code.map((p) =>
      p.id === projectId
        ? {
            ...p,
            messages: p.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
          }
        : p,
    ),
  }));
}

export interface CodeRunResult {
  ok: boolean;
  text: string;
}

/** Foydalanuvchi topshirigʻini bajaradi: oʻqiydi, yozadi, yuboradi, chiqaradi. */
export async function runCodeAgent(
  projectId: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<CodeRunResult> {
  const { settings } = getState();
  const project = getCodeProject(projectId);
  if (!project) return { ok: false, text: '' };

  const userMsg: Message = {
    id: uid('m_'),
    role: 'user',
    text: instruction,
    createdAt: Date.now(),
  };
  const modelMsg: Message = { id: uid('m_'), role: 'model', text: '', createdAt: Date.now() };

  setState((s) => ({
    code: s.code.map((p) =>
      p.id === projectId
        ? { ...p, updatedAt: Date.now(), messages: [...p.messages, userMsg, modelMsg] }
        : p,
    ),
  }));

  const contents = toContents([...project.messages, userMsg]);
  const toolCalls: ToolCallRecord[] = [];
  let accumulated = '';
  let flush: ReturnType<typeof setTimeout> | null = null;

  const onText = (chunk: string) => {
    accumulated += chunk;
    if (!flush) {
      flush = setTimeout(() => {
        flush = null;
        patchMessage(projectId, modelMsg.id, { text: accumulated });
      }, 60);
    }
  };

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      // Har turda tizim koʻrsatmasi yangilanadi — fayl roʻyxati oʻzgargan boʻlishi mumkin.
      const current = getCodeProject(projectId);
      if (!current) break;

      const result = await streamGenerate({
        apiKey: settings.apiKey,
        model: settings.model,
        contents,
        systemInstruction: systemPrompt(current),
        tools: CODE_TOOLS,
        temperature: 0.4,
        signal,
        onText,
      });

      if (!result.functionCalls.length) break;

      contents.push({
        role: 'model',
        parts: result.functionCalls.map((fc) => ({ functionCall: fc })),
      });

      const responses: GeminiPart[] = [];
      for (const call of result.functionCalls) {
        let outcome: ToolResult;
        try {
          outcome = await runTool(projectId, call.name, call.args);
        } catch (err) {
          outcome = {
            ok: false,
            summary: `${call.name}: ${(err as Error).message}`,
            payload: { error: (err as Error).message },
          };
        }
        toolCalls.push({
          name: call.name,
          args: call.args,
          ok: outcome.ok,
          summary: outcome.summary,
        });
        responses.push({ functionResponse: { name: call.name, response: outcome.payload } });
      }
      contents.push({ role: 'user', parts: responses });
      patchMessage(projectId, modelMsg.id, { toolCalls: [...toolCalls] });
    }

    if (flush) clearTimeout(flush);
    patchMessage(projectId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    });
    return { ok: true, text: accumulated };
  } catch (err) {
    if (flush) clearTimeout(flush);
    const aborted = (err as Error)?.name === 'AbortError';
    patchMessage(projectId, modelMsg.id, {
      text: accumulated,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      error: aborted ? 'Toʻxtatildi.' : String((err as Error)?.message ?? err),
    });
    return { ok: false, text: accumulated };
  }
}
