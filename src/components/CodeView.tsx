import { useEffect, useMemo, useRef, useState } from 'react';
import { publishProject, runCodeAgent } from '../lib/codeagent';
import {
  bundlePreview,
  createCodeProject,
  deleteCodeProject,
  langOf,
  patchCodeProject,
  totalSize,
  writeProjectFile,
} from '../lib/codeproject';
import { saveBytes } from '../lib/exporter';
import { listRepos, type GhRepo } from '../lib/github';
import { renderMarkdown } from '../lib/markdown';
import { useStore, updateSettings } from '../lib/store';
import type { CodeProject } from '../lib/types';
import { relativeTime } from '../lib/utils';
import { Back, Check, Close, Copy, Download, Plus, Refresh, Send, Stop, Trash } from './Icons';
import { copyText } from '../lib/exporter';
import { Empty, Sheet, toast } from './ui';

/* ------------------------------------------------------------------ */
/*  Loyihalar roʻyxati                                                 */
/* ------------------------------------------------------------------ */

export function CodeView() {
  const projects = useStore((s) => s.code);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const project = projects.find((p) => p.id === openId) ?? null;
  if (project) return <Workspace project={project} onBack={() => setOpenId(null)} />;

  return (
    <div className="scroll">
      <div className="pad">
        <button
          className="btn wide"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setName('');
            setCreating(true);
          }}
        >
          <Plus size={17} /> Yangi loyiha
        </button>

        {projects.length === 0 ? (
          <Empty
            title="Loyiha yoʻq"
            hint="Daho Code — telefoningizdagi dasturchi. Loyiha ochib «menga portfolio sayt yasab ber» deng; u fayllarni oʻzi yozadi, GitHub’ga yuboradi va jonli havola beradi."
          />
        ) : (
          projects.map((p) => (
            <button
              className="card"
              key={p.id}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 9 }}
              onClick={() => setOpenId(p.id)}
            >
              <div className="between">
                <div className="grow" style={{ fontSize: 15.5, fontWeight: 580 }}>
                  {p.name}
                </div>
                {p.publish && <span className="chip accent">jonli</span>}
              </div>
              {p.description && (
                <div className="muted" style={{ marginTop: 3 }}>
                  {p.description}
                </div>
              )}
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <span className="chip">{p.files.length} fayl</span>
                {p.repo && (
                  <span className="chip">
                    {p.repo.owner}/{p.repo.repo}
                  </span>
                )}
                <span className="tiny" style={{ marginLeft: 'auto' }}>
                  {relativeTime(p.updatedAt)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {creating && (
        <Sheet title="Yangi loyiha" onClose={() => setCreating(false)}>
          <div className="field">
            <label>Loyiha nomi</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Portfolio sayt"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) {
                  const p = createCodeProject(name);
                  setCreating(false);
                  setOpenId(p.id);
                }
              }}
            />
          </div>
          <button
            className="btn wide"
            disabled={!name.trim()}
            onClick={() => {
              const p = createCodeProject(name);
              setCreating(false);
              setOpenId(p.id);
            }}
          >
            Yaratish
          </button>
        </Sheet>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ish maydoni                                                        */
/* ------------------------------------------------------------------ */

type Tab = 'suhbat' | 'fayllar' | 'korinish' | 'nashr';

function Workspace({ project, onBack }: { project: CodeProject; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('suhbat');

  return (
    <>
      <div className="course-head">
        <button className="icon-btn" onClick={onBack} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600 }}>{project.name}</div>
          <div className="tiny">
            {project.files.length} fayl · {(totalSize(project) / 1024).toFixed(1)} KB
            {project.repo ? ` · ${project.repo.owner}/${project.repo.repo}` : ''}
          </div>
        </div>
      </div>

      <div className="seg">
        {(['suhbat', 'fayllar', 'korinish', 'nashr'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'suhbat'
              ? 'Suhbat'
              : t === 'fayllar'
                ? 'Fayllar'
                : t === 'korinish'
                  ? 'Koʻrinish'
                  : 'Nashr'}
          </button>
        ))}
      </div>

      {tab === 'suhbat' && <CodeChat project={project} />}
      {tab === 'fayllar' && <Files project={project} />}
      {tab === 'korinish' && <Preview project={project} />}
      {tab === 'nashr' && <Publish project={project} onDeleted={onBack} />}
    </>
  );
}

/* ---------- Suhbat ---------- */

const CODE_STARTERS = [
  'Portfolio sayt yasab ber',
  'Bosh sahifaga qorongʻi/yorugʻ tugmasi qoʻsh',
  'GitHub’dagi repolarimni koʻrsat',
  'Loyihani internetga chiqar',
];

function CodeChat({ project }: { project: CodeProject }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [project.messages]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = async (value: string) => {
    const instruction = value.trim();
    if (!instruction || busy) return;
    setText('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    await runCodeAgent(project.id, instruction, controller.signal);
    abortRef.current = null;
    setBusy(false);
  };

  return (
    <>
      <div className="scroll" ref={scrollRef}>
        {project.messages.length === 0 ? (
          <div style={{ padding: '24px 14px' }}>
            <Empty
              title="Nima quramiz?"
              hint="Fayllarni oʻzim oʻqiyman va yozaman, GitHub bilan ishlayman, tayyor boʻlgach internetga chiqarib havola beraman."
            />
            <div style={{ display: 'grid', gap: 8 }}>
              {CODE_STARTERS.map((s) => (
                <button
                  key={s}
                  className="btn ghost"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="msgs">
            {project.messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div className="msg user">{m.text}</div>
                </div>
              ) : (
                <div key={m.id} className="msg model">
                  {m.toolCalls?.map((call, i) => (
                    <div key={i} className={call.ok ? 'tool-line' : 'tool-line bad'}>
                      <Check size={13} />
                      <span className="grow">{call.summary}</span>
                    </div>
                  ))}
                  {m.text.trim() && (
                    <div
                      className="md"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                    />
                  )}
                  {m.error && <div className="err">{m.error}</div>}
                </div>
              ),
            )}
            {busy && <span className="typing" />}
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-box">
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder="Nima qilay?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          {busy ? (
            <button
              className="round-btn primary"
              onClick={() => abortRef.current?.abort()}
              aria-label="Toʻxtatish"
            >
              <Stop size={16} />
            </button>
          ) : (
            <button
              className="round-btn primary"
              disabled={!text.trim()}
              onClick={() => void send(text)}
              aria-label="Yuborish"
            >
              <Send size={19} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Fayllar ---------- */

function Files({ project }: { project: CodeProject }) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newFile, setNewFile] = useState(false);
  const [newPath, setNewPath] = useState('');

  const file = project.files.find((f) => f.path === open);

  useEffect(() => {
    setDraft(file?.content ?? '');
  }, [file?.path, file?.content]);

  if (file) {
    return (
      <>
        <div className="course-head">
          <button className="icon-btn" onClick={() => setOpen(null)} aria-label="Orqaga">
            <Back />
          </button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="artifact-title">{file.path}</div>
            <div className="tiny">{langOf(file.path)}</div>
          </div>
          <button
            className="icon-btn"
            onClick={async () => toast((await copyText(file.content)) ? 'Nusxalandi' : 'Xato')}
            aria-label="Nusxalash"
          >
            <Copy />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              writeProjectFile(project.id, file.path, draft);
              toast('Saqlandi');
            }}
            aria-label="Saqlash"
          >
            <Check size={19} />
          </button>
        </div>
        <textarea
          className="code-editor"
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setDraft(e.target.value)}
        />
      </>
    );
  }

  return (
    <div className="scroll">
      <div className="pad">
        <button
          className="btn ghost wide"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setNewPath('');
            setNewFile(true);
          }}
        >
          <Plus size={16} /> Fayl qoʻshish
        </button>

        {project.files.map((f) => (
          <div className="file-row" key={f.path}>
            <button className="grow" style={{ textAlign: 'left' }} onClick={() => setOpen(f.path)}>
              <div style={{ fontSize: 14 }}>{f.path}</div>
              <div className="tiny">
                {f.content.split('\n').length} qator · {(f.content.length / 1024).toFixed(1)} KB
              </div>
            </button>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30 }}
              onClick={() => {
                if (window.confirm(`${f.path} oʻchirilsinmi?`)) {
                  patchCodeProject(project.id, {
                    files: project.files.filter((x) => x.path !== f.path),
                  });
                }
              }}
              aria-label="Oʻchirish"
            >
              <Trash size={15} />
            </button>
          </div>
        ))}
      </div>

      {newFile && (
        <Sheet title="Yangi fayl" onClose={() => setNewFile(false)}>
          <div className="field">
            <label>Fayl yoʻli</label>
            <input
              autoFocus
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="about.html"
            />
          </div>
          <button
            className="btn wide"
            disabled={!newPath.trim()}
            onClick={() => {
              writeProjectFile(project.id, newPath.trim(), '');
              setNewFile(false);
              setOpen(newPath.trim());
            }}
          >
            Yaratish
          </button>
        </Sheet>
      )}
    </div>
  );
}

/* ---------- Koʻrinish ---------- */

function Preview({ project }: { project: CodeProject }) {
  const [key, setKey] = useState(0);
  const doc = useMemo(() => bundlePreview(project), [project]);

  return (
    <>
      <div className="preview-bar">
        <span className="tiny grow">Telefoningizda ishlayapti · server kerak emas</span>
        <button className="btn mini ghost" onClick={() => setKey((k) => k + 1)}>
          <Refresh size={14} /> Yangilash
        </button>
      </div>
      <div className="viewer-body" style={{ flex: '1 1 auto' }}>
        <iframe
          key={key}
          title={project.name}
          srcDoc={doc}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
        />
      </div>
    </>
  );
}

/* ---------- Nashr ---------- */

function Publish({ project, onDeleted }: { project: CodeProject; onDeleted: () => void }) {
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = useState(false);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [picker, setPicker] = useState(false);
  const [domain, setDomain] = useState(project.publish?.domain ?? settings.publishDomain);

  const publish = async () => {
    if (!settings.githubToken) {
      toast('Avval Sozlamalarda GitHub tokenini kiriting');
      return;
    }
    setBusy(true);
    try {
      const result = await publishProject(project.id, domain.trim() || undefined);
      if (domain.trim()) updateSettings({ publishDomain: domain.trim() });
      toast(`Chiqarildi: ${result.url}`);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const loadRepos = async () => {
    setBusy(true);
    try {
      setRepos(await listRepos(settings.githubToken));
      setPicker(true);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll">
      <div className="pad">
        {project.publish && (
          <div className="card" style={{ borderColor: 'var(--accent)' }}>
            <div className="tiny">Jonli havola</div>
            <div style={{ fontSize: 14.5, wordBreak: 'break-all', marginTop: 3 }}>
              {project.publish.url}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn mini ghost grow"
                onClick={async () =>
                  toast((await copyText(project.publish!.url)) ? 'Nusxalandi' : 'Xato')
                }
              >
                <Copy size={14} /> Nusxa
              </button>
              <a
                className="btn mini grow"
                href={project.publish.url}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none' }}
              >
                Ochish
              </a>
            </div>
            <div className="tiny" style={{ marginTop: 8 }}>
              {relativeTime(project.publish.at)} chiqarilgan. Birinchi marta yoqilganda
              GitHub 1–2 daqiqa tayyorlaydi.
            </div>
          </div>
        )}

        <div className="section-label">GitHub</div>
        {!settings.githubToken ? (
          <div className="err">
            GitHub tokeni kiritilmagan. Sozlamalar → GitHub boʻlimiga oʻting.
          </div>
        ) : project.repo ? (
          <div className="card">
            <div className="between">
              <div className="grow">
                <div style={{ fontSize: 14.5 }}>
                  {project.repo.owner}/{project.repo.repo}
                </div>
                <div className="tiny">tarmoq: {project.repo.branch}</div>
              </div>
              <button
                className="icon-btn"
                onClick={() => patchCodeProject(project.id, { repo: undefined })}
                aria-label="Uzish"
              >
                <Close size={18} />
              </button>
            </div>
          </div>
        ) : (
          <button className="btn ghost wide" disabled={busy} onClick={() => void loadRepos()}>
            Mavjud repozitoriyni ulash
          </button>
        )}

        <div className="section-label">Oʻz domeningiz</div>
        <div className="field">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim())}
            placeholder="masalan: daho.uz yoki app.daho.uz"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="tiny" style={{ marginTop: 6 }}>
            Domen kiritsangiz CNAME fayli avtomatik qoʻshiladi. Domen sozlamasida DNS
            yozuvini qoʻshing:
            <br />• pastki domen (app.daho.uz) uchun <b>CNAME</b> →{' '}
            <b>{'<login>'}.github.io</b>
            <br />• asosiy domen (daho.uz) uchun toʻrtta <b>A</b> yozuvi:
            185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
          </div>
        </div>

        <button className="btn wide" disabled={busy} onClick={() => void publish()}>
          {busy ? 'Chiqarilmoqda…' : project.publish ? 'Qayta chiqarish' : 'Internetga chiqarish'}
        </button>

        <button
          className="btn ghost wide"
          style={{ marginTop: 8 }}
          onClick={async () => {
            const html = bundlePreview(project);
            try {
              toast(
                await saveBytes(
                  `${project.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.html`,
                  new TextEncoder().encode(html),
                  'text/html',
                ),
              );
            } catch (err) {
              toast(`Xato: ${(err as Error).message}`);
            }
          }}
        >
          <Download size={15} /> Bitta HTML fayl qilib saqlash
        </button>

        <button
          className="btn ghost wide"
          style={{ marginTop: 16, color: 'var(--danger)' }}
          onClick={() => {
            if (window.confirm(`"${project.name}" loyihasi oʻchirilsinmi?`)) {
              deleteCodeProject(project.id);
              onDeleted();
            }
          }}
        >
          <Trash size={15} /> Loyihani oʻchirish
        </button>
      </div>

      {picker && repos && (
        <Sheet title="Repozitoriyni tanlang" onClose={() => setPicker(false)}>
          {repos.slice(0, 60).map((r) => (
            <button
              key={r.full_name}
              className="action-row"
              onClick={() => {
                patchCodeProject(project.id, {
                  repo: { owner: r.owner.login, repo: r.name, branch: r.default_branch },
                });
                setPicker(false);
              }}
            >
              <span className="action-icon">{r.private ? '🔒' : '📦'}</span>
              <span className="grow">
                <b>{r.name}</b>
                <div className="tiny">{r.description || r.full_name}</div>
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
