import { getState, setState } from './store';
import { templateById } from './templates';
import type { CodeFile, CodeProject } from './types';
import { uid } from './utils';

/* ------------------------------------------------------------------ */
/*  Loyihalarni boshqarish                                             */
/* ------------------------------------------------------------------ */

export function createCodeProject(
  name: string,
  templateId = 'statik',
  description = '',
): CodeProject {
  const template = templateById(templateId);
  const project: CodeProject = {
    id: uid('cp_'),
    name: name.trim() || 'Yangi loyiha',
    description,
    template: template.id,
    files: structuredClone(template.files),
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  setState((s) => ({ code: [project, ...s.code] }));
  return project;
}

export function getCodeProject(id: string): CodeProject | undefined {
  return getState().code.find((p) => p.id === id);
}

export function patchCodeProject(id: string, patch: Partial<CodeProject>): void {
  setState((s) => ({
    code: s.code.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
  }));
}

export function deleteCodeProject(id: string): void {
  setState((s) => ({ code: s.code.filter((p) => p.id !== id) }));
}

export function writeProjectFile(
  id: string,
  path: string,
  content: string,
  /** Rasm/shrift kabi ikkilik fayl boʻlsa turi va base64 bayrogʻi */
  binary?: { mimeType: string },
): void {
  const clean = path.replace(/^\.?\//, '').trim();
  const extra = binary ? { base64: true as const, mimeType: binary.mimeType } : {};
  setState((s) => ({
    code: s.code.map((p) => {
      if (p.id !== id) return p;
      const exists = p.files.some((f) => f.path === clean);
      return {
        ...p,
        updatedAt: Date.now(),
        files: exists
          ? p.files.map((f) =>
              f.path === clean
                ? // Matn faylga aylantirilsa eski ikkilik bayroq qolib ketmasin
                  { path: clean, content, ...extra }
                : f,
            )
          : [...p.files, { path: clean, content, ...extra }],
      };
    }),
  }));
}

export function deleteProjectFile(id: string, path: string): boolean {
  const project = getCodeProject(id);
  if (!project?.files.some((f) => f.path === path)) return false;
  setState((s) => ({
    code: s.code.map((p) =>
      p.id === id ? { ...p, updatedAt: Date.now(), files: p.files.filter((f) => f.path !== path) } : p,
    ),
  }));
  return true;
}

/* ------------------------------------------------------------------ */
/*  Telefonda ishlaydigan "server" — koʻp fayldan bitta sahifa         */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function findFile(files: CodeFile[], href: string): CodeFile | undefined {
  const clean = href.replace(/^\.?\//, '').split(/[?#]/)[0];
  return files.find((f) => f.path === clean) ?? files.find((f) => f.path.endsWith(`/${clean}`));
}

function escapeForScript(code: string): string {
  // </script> ni ichkarida qoldirmaslik uchun
  return code.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * Loyihaning barcha fayllarini bitta HTML hujjatga yigʻadi.
 * Shu tarzda `<link>` va `<script src>` telefon ichida server’siz ishlaydi.
 */
export function bundlePreview(project: CodeProject, entry = 'index.html'): string {
  const files = project.files;
  const index = findFile(files, entry) ?? files.find((f) => f.path.endsWith('.html'));
  if (!index) {
    return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0e0e12;color:#ededf0;padding:24px">
      <h3>index.html topilmadi</h3><p>Loyihaga HTML fayl qoʻshing.</p></body>`;
  }

  let html = index.content;

  /*
   * Loyihadagi ikkilik fayllar (rasm, shrift, audio) koʻrinishda alohida
   * fayl boʻlib ochilmaydi — qumbox ularni topa olmaydi. Shuning uchun
   * havolalarni data URI ga aylantiramiz.
   *
   * Bu yordamchilar pastdagi almashtirishlardan OLDIN eʼlon qilinishi
   * kerak: CSS inline qilish ularni darhol chaqiradi.
   */
  const asset = (ref: string): string | null => {
    if (/^(https?:|data:|#)/i.test(ref)) return null;
    const file = findFile(files, ref);
    if (!file?.base64) return null;
    return `data:${file.mimeType ?? 'application/octet-stream'};base64,${file.content}`;
  };

  const inlineCssUrls = (css: string): string =>
    css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match: string, ref: string) => {
      const uri = asset(ref.trim());
      return uri ? `url("${uri}")` : match;
    });

  html = html.replace(
    /(<(?:img|source|audio|video)[^>]*\ssrc=)["']([^"']+)["']/gi,
    (match: string, head: string, ref: string) => {
      const uri = asset(ref);
      return uri ? `${head}"${uri}"` : match;
    },
  );

  // <link rel="stylesheet" href="style.css"> → <style>…</style>
  html = html.replace(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
    (match: string, href: string) => {
      if (/^https?:/i.test(href)) return match;
      const file = findFile(files, href);
      return file ? `<style>\n${inlineCssUrls(file.content)}\n</style>` : '';
    },
  );
  html = html.replace(
    /<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi,
    (match: string, href: string) => {
      if (/^https?:/i.test(href)) return match;
      const file = findFile(files, href);
      return file ? `<style>\n${inlineCssUrls(file.content)}\n</style>` : match;
    },
  );

  // <script src="app.js"></script> → inline
  html = html.replace(
    /<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (match: string, before: string, src: string, after: string) => {
      if (/^https?:/i.test(src)) return match;
      const file = findFile(files, src);
      if (!file) return '';
      const isModule = /type=["']module["']/i.test(before + after);
      return `<script${isModule ? ' type="module"' : ''}>\n${escapeForScript(file.content)}\n</script>`;
    },
  );

  // Mahalliy rasm yoʻllari (base64 sifatida saqlangan boʻlsa)
  html = html.replace(/(src|href)=["'](?!https?:|data:|#)([^"']+\.(png|jpe?g|gif|svg|webp))["']/gi,
    (match: string, attr: string, path: string, ext: string) => {
      const file = findFile(files, path);
      if (!file) return match;
      const mime = MIME[ext.toLowerCase()] ?? 'application/octet-stream';
      if (file.content.startsWith('data:')) return `${attr}="${file.content}"`;
      if (ext.toLowerCase() === 'svg') {
        return `${attr}="data:image/svg+xml;utf8,${encodeURIComponent(file.content)}"`;
      }
      return `${attr}="data:${mime};base64,${file.content}"`;
    },
  );

  return html;
}

/** Loyihaning fayl daraxti — modelga koʻrsatish uchun. */
export function fileTree(project: CodeProject): string {
  return project.files
    .map((f) => `- ${f.path} (${f.content.split('\n').length} qator)`)
    .join('\n');
}

export function totalSize(project: CodeProject): number {
  return project.files.reduce((sum, f) => sum + f.content.length, 0);
}

export function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    py: 'python',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] ?? 'text';
}
