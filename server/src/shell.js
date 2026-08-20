import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from './env.js';

/**
 * Buyruqni bajaradi — Daho Code uchun HAQIQIY terminal.
 *
 * Brauzerdagi ilova `npm install`, `node`, `python`, `git` ni ishlata
 * olmaydi. Server bor boʻlsa — ishlatadi.
 *
 * Xavfsizlik: bu foydalanuvchining OʻZ serveri. Baribir chegaralar bor —
 * har foydalanuvchiga alohida papka, vaqt chegarasi, chiqish hajmi
 * chegarasi. ENABLE_SHELL=1 boʻlmasa umuman ishlamaydi.
 */
export async function runCommand(userId, command, { cwd, timeoutMs } = {}) {
  if (!env.shellEnabled) {
    return {
      ok: false,
      code: -1,
      stdout: '',
      stderr: 'Terminal oʻchirilgan. Railway sozlamalarida ENABLE_SHELL=1 qoʻying.',
    };
  }
  if (!command || typeof command !== 'string') {
    return { ok: false, code: -1, stdout: '', stderr: 'Buyruq boʻsh.' };
  }

  // Har foydalanuvchiga oʻz papkasi — bir-birining fayliga tegmaydi.
  const safeUser = String(userId || 'mehmon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'mehmon';
  const base = join(env.workDir, safeUser);
  const dir = cwd ? join(base, String(cwd).replace(/\.\./g, '.')) : base;
  await mkdir(dir, { recursive: true });

  const limit = Math.min(Number(timeoutMs) || env.shellTimeoutMs, 600000);

  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: base,
        LANG: 'C.UTF-8',
        // Maxfiy kalitlar buyruqqa oʻtmaydi
      },
    });

    let stdout = '';
    let stderr = '';
    let done = false;
    const cap = 200_000;

    const finish = (code, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch {
        /* allaqachon tugagan */
      }
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.slice(-cap),
        stderr: (stderr + extra).slice(-cap),
        dir: dir.replace(env.workDir, ''),
      });
    };

    const timer = setTimeout(
      () => finish(124, `\n[vaqt tugadi: ${limit} ms]`),
      limit,
    );

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > cap * 2) stdout = stdout.slice(-cap);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > cap * 2) stderr = stderr.slice(-cap);
    });
    child.on('error', (err) => finish(-1, `\n${err.message}`));
    child.on('close', (code) => finish(code ?? 0));
  });
}
