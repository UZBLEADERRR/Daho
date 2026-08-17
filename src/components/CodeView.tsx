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
import { getRepo, listRepos, whoAmI, type GhRepo } from '../lib/github';
import { saveLinkApp } from '../lib/creations';
import { modelLabel, parseRef, usableChatModels } from '../lib/providers';
import { TEMPLATES } from '../lib/templates';
import { renderMarkdown } from '../lib/markdown';
import { sandboxDocument } from '../lib/sandbox';
import { getState, useStore, updateSettings, updateView } from '../lib/store';
import type { Attachment, CodeProject } from '../lib/types';
import { relativeTime } from '../lib/utils';
import { prepareFile, fileIcon } from '../lib/attach';
import { startListening, type ListenHandle } from '../lib/speech';
import { interject, usePendingQuestion } from '../lib/ask';
import { noteTask, startTask, stopFor, useTaskFor } from '../lib/tasks';
import { QuestionCard } from './QuestionCard';
import { ToolLine, splitByTools } from './ToolLine';
import { Back, Check, Close, Copy, Download, Mic, Plus, Refresh, Send, Stop, Trash } from './Icons';
import { copyText } from '../lib/exporter';
import { Empty, Sheet, toast } from './ui';

/* ------------------------------------------------------------------ */
/*  Loyihalar roʻyxati                                                 */
/* ------------------------------------------------------------------ */

export function CodeView() {
  const projects = useStore((s) => s.code);
  // Ochiq loyiha store da — boshqa bo'limga o'tib qaytsangiz ish joyingiz saqlanadi.
  const openId = useStore((s) => s.view.codeId);
  const setOpenId = (id: string | null) => updateView({ codeId: id });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('statik');

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
            setTemplate('statik');
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
                <span className="chip">
                  {TEMPLATES.find((t) => t.id === p.template)?.icon ?? '📦'}{' '}
                  {TEMPLATES.find((t) => t.id === p.template)?.name ?? 'Loyiha'}
                </span>
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
            />
          </div>

          <div className="section-label" style={{ padding: '4px 0 8px' }}>
            Turi
          </div>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={template === t.id ? 'action-row on' : 'action-row'}
              onClick={() => setTemplate(t.id)}
            >
              <span className="action-icon">{t.icon}</span>
              <span className="grow">
                <b>{t.name}</b>
                <div className="tiny">{t.hint}</div>
              </span>
            </button>
          ))}

          <button
            className="btn wide"
            style={{ marginTop: 10 }}
            disabled={!name.trim()}
            onClick={() => {
              const p = createCodeProject(name, template);
              setCreating(false);
              setOpenId(p.id);
              // «Oʻzim» shabloni — Daho repozitoriysiga avtomatik ulanamiz.
              if (template === 'ozim') void connectSelfRepo(p.id);
            }}
          >
            Yaratish
          </button>
        </Sheet>
      )}
    </div>
  );
}

/** Daho ilovasining oʻz repozitoriysini topib ulaydi. */
async function connectSelfRepo(projectId: string): Promise<void> {
  const { settings } = getState();
  if (!settings.githubToken) {
    toast('GitHub token kerak — Sozlamalardan kiriting');
    return;
  }
  try {
    const me = await whoAmI(settings.githubToken);
    const repo = await getRepo(settings.githubToken, me.login, 'Daho');
    patchCodeProject(projectId, {
      repo: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch },
    });
    toast(`Ulandi: ${repo.full_name}`);
  } catch {
    toast('Daho repozitoriysi topilmadi — «Nashr» boʻlimidan qoʻlda ulang');
  }
}

/* ------------------------------------------------------------------ */
/*  Ish maydoni                                                        */
/* ------------------------------------------------------------------ */

type Tab = 'suhbat' | 'fayllar' | 'korinish' | 'nashr';

/**
 * Agentning joriy rejasi. Nima bajarilgani va nima qolganini koʻrsatadi —
 * katta loyihada ish qayerga yetganini kuzatib turish uchun.
 */
function PlanCard({ project }: { project: CodeProject }) {
  const [open, setOpen] = useState(true);
  const plan = project.plan ?? [];
  if (!plan.length) return null;

  const done = plan.filter((s) => s.done).length;
  const next = plan.find((s) => !s.done);

  return (
    <div className="plan-card">
      <button className="plan-head" onClick={() => setOpen((v) => !v)}>
        <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
          <b>
            📋 Reja — {done}/{plan.length}
          </b>
          {!open && next && <div className="tiny">Keyingi: {next.title}</div>}
        </span>
        <span className="tiny">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="plan-steps">
          {plan.map((step, i) => (
            <div key={step.id} className={step.done ? 'plan-step done' : 'plan-step'}>
              <span className="plan-mark">{step.done ? '✓' : i + 1}</span>
              <span className="grow">{step.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Workspace({ project, onBack }: { project: CodeProject; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('suhbat');
  const [modelPicker, setModelPicker] = useState(false);
  const settings = useStore((s) => s.settings);
  // Barcha ulangan provayderlarning modellari — Gemini, Kimi, Qwen, GPT…
  const chatModels = usableChatModels();
  const activeModel = project.model || settings.model;

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
        <button className="model-chip" onClick={() => setModelPicker(true)}>
          {parseRef(activeModel).model.replace(/^gemini-/, '')}
        </button>
      </div>

      {modelPicker && (
        <Sheet title="Model tanlang" onClose={() => setModelPicker(false)}>
          <button
            className={!project.model ? 'action-row on' : 'action-row'}
            onClick={() => {
              patchCodeProject(project.id, { model: undefined });
              setModelPicker(false);
            }}
          >
            <span className="action-icon">⚙️</span>
            <span className="grow">
              <b>Umumiy sozlama</b>
              <div className="tiny">{modelLabel(settings.model)}</div>
            </span>
          </button>
          {chatModels.map((m) => (
            <button
              key={m.id}
              className={project.model === m.id ? 'action-row on' : 'action-row'}
              onClick={() => {
                patchCodeProject(project.id, { model: m.id });
                setModelPicker(false);
              }}
            >
              <span className="action-icon">🧠</span>
              <span className="grow">
                <b>{m.label}</b>
                <div className="tiny">
                  {m.providerLabel ?? 'Gemini'}
                  {m.preview ? ' · sinov' : ''}
                </div>
              </span>
            </button>
          ))}
          {chatModels.length === 0 && (
            <div className="tiny">
              Roʻyxat boʻsh. Sozlamalar → «Modellarni yangilash» tugmasini bosing.
            </div>
          )}
          <div className="tiny" style={{ marginTop: 10, opacity: 0.7 }}>
            Yordamchi agentlar (dizayn, kod, tekshir) uchun alohida model tanlash —
            Sozlamalar → AI modellar → Rollar.
          </div>
        </Sheet>
      )}

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
  const [shots, setShots] = useState<Attachment[]>([]);
  const [extraText, setExtraText] = useState<string[]>([]);
  const [mic, setMic] = useState<'oʻchiq' | 'yozilmoqda' | 'tahlil'>('oʻchiq');
  const listenRef = useRef<ListenHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const running = useTaskFor('code', project.id);
  const busy = Boolean(running);
  const question = usePendingQuestion('code', project.id);

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
    // Ish ketayotgan boʻlsa — qoʻshimcha koʻrsatma sifatida qabul qilamiz.
    if (busy) {
      if (!instruction) return;
      interject('code', project.id, instruction);
      setText('');
      toast('Qoʻshimcha koʻrsatma qabul qilindi');
      return;
    }
    if (!instruction && !shots.length && !extraText.length) return;
    const files = shots;
    const texts = extraText;
    setText('');
    setShots([]);
    setExtraText([]);
    const full = [instruction || 'Biriktirilgan faylni koʻrib chiq.', ...texts].join('\n\n');
    await startTask(
      { kind: 'code', targetId: project.id, title: project.name, note: instruction.slice(0, 40) },
      (signal, taskId) =>
        runCodeAgent(project.id, full, signal, files, (step) => noteTask(taskId, step)),
    );
  };

  /** Istalgan fayl: rasm, PDF, matn, kod, audio. */
  const pickFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    for (const file of Array.from(list).slice(0, 5)) {
      const prepared = await prepareFile(file);
      if (prepared.error) toast(prepared.error);
      else if (prepared.attachment) setShots((prev) => [...prev, prepared.attachment!].slice(0, 5));
      else if (prepared.text) setExtraText((prev) => [...prev, prepared.text!].slice(0, 5));
    }
  };

  const toggleMic = async () => {
    if (mic !== 'oʻchiq') {
      const handle = listenRef.current;
      listenRef.current = null;
      await handle?.stop();
      return;
    }
    setMic('yozilmoqda');
    const handle = await startListening({
      onState: (st) => setMic(st),
      onFinal: (value) => {
        setText((prev) => (prev ? `${prev} ${value}` : value));
        setMic('oʻchiq');
        listenRef.current = null;
      },
      onError: (message) => {
        toast(message);
        setMic('oʻchiq');
        listenRef.current = null;
      },
    });
    listenRef.current = handle;
    if (!handle) setMic('oʻchiq');
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
                <div
                  key={m.id}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}
                >
                  {!!m.attachments?.length && (
                    <div className="attach-grid" style={{ justifyContent: 'flex-end' }}>
                      {m.attachments.map((a, i) => (
                        <img key={i} src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                      ))}
                    </div>
                  )}
                  {m.text && (
                    <div
                      className="msg user"
                      onDoubleClick={async () => {
                        toast((await copyText(m.text)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi');
                      }}
                    >
                      {m.text}
                    </div>
                  )}
                </div>
              ) : (
                <div key={m.id} className="msg model">
                  {splitByTools(m.text, m.toolCalls).map((block, bi) => (
                    <div key={bi}>
                      {block.text.trim() && (
                        <div
                          className="md"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
                        />
                      )}
                      {block.calls.map((call, ci) => (
                        <ToolLine key={ci} call={call} />
                      ))}
                    </div>
                  ))}
                  {m.error && <div className="err">{m.error}</div>}
                  {m.text.trim() && (
                    <div className="msg-actions">
                      <button
                        onClick={async () =>
                          toast((await copyText(m.text)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi')
                        }
                      >
                        <Copy size={12} /> Nusxa
                      </button>
                    </div>
                  )}
                </div>
              ),
            )}
            {question && <QuestionCard question={question} />}
            {busy && !question && <span className="typing" />}
          </div>
        )}
      </div>

      <PlanCard project={project} />

      {busy && !question && (
        <div className="interject-hint">
          💬 Ish davom etyapti — qoʻshimcha koʻrsatma yozsangiz hisobga oladi
        </div>
      )}

      <div className="composer">
        {(!!shots.length || !!extraText.length) && (
          <div className="pending-strip">
            {shots.map((a, i) => (
              <div className="thumb" key={`s${i}`}>
                {a.mimeType.startsWith('image/') ? (
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                ) : (
                  <span className="file-chip">
                    {fileIcon(a.name ?? '', a.mimeType)}
                    <i>{(a.name ?? 'fayl').slice(0, 12)}</i>
                  </span>
                )}
                <button
                  className="x"
                  onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Olib tashlash"
                >
                  ×
                </button>
              </div>
            ))}
            {extraText.map((t, i) => (
              <div className="thumb" key={`t${i}`}>
                <span className="file-chip">
                  📄<i>{(t.match(/^Fayl: (.+)$/m)?.[1] ?? 'matn').slice(0, 12)}</i>
                </span>
                <button
                  className="x"
                  onClick={() => setExtraText((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Olib tashlash"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-box">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void pickFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            className="round-btn"
            onClick={() => fileRef.current?.click()}
            aria-label="Fayl qoʻshish"
          >
            <Plus size={21} />
          </button>
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder={
              mic === 'yozilmoqda'
                ? 'Tinglayapman…'
                : mic === 'tahlil'
                  ? 'Matnga oʻgirilmoqda…'
                  : busy
                    ? 'Qoʻshimcha koʻrsatma…'
                    : 'Nima qilay?'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          {busy && text.trim() ? (
            <button
              className="round-btn primary"
              onClick={() => void send(text)}
              aria-label="Qoʻshimcha yuborish"
            >
              <Send size={19} />
            </button>
          ) : busy ? (
            <button
              className="round-btn primary"
              onClick={() => stopFor('code', project.id)}
              aria-label="Toʻxtatish"
            >
              <Stop size={16} />
            </button>
          ) : text.trim() || shots.length || extraText.length ? (
            <button
              className="round-btn primary"
              onClick={() => void send(text)}
              aria-label="Yuborish"
            >
              <Send size={19} />
            </button>
          ) : (
            <button
              className={mic === 'oʻchiq' ? 'round-btn' : 'round-btn rec'}
              onClick={toggleMic}
              disabled={mic === 'tahlil'}
              aria-label="Ovozli xabar"
            >
              <Mic size={20} />
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
  const doc = useMemo(
    () => sandboxDocument(bundlePreview(project), project.id),
    [project],
  );

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
            <button
              className="btn mini ghost wide"
              style={{ marginTop: 8 }}
              onClick={() => {
                const app = saveLinkApp(project.publish!.url, project.name, '🌐');
                toast(`«${app.name}» Ilovalarimga qoʻshildi`);
              }}
            >
              🔗 Ilovalarimga qoʻshish
            </button>
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
