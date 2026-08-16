import { useEffect, useRef, useState } from 'react';
import { saveBytes } from '../lib/exporter';
import { playWavBase64, stopPlayback } from '../lib/audio';
import { VOICES } from '../lib/speech';
import { useStore } from '../lib/store';
import type { SubtitleStyle, VideoProject } from '../lib/types';
import {
  SUBTITLE_PRESETS,
  VIDEO_STYLES,
  deleteProject,
  dimensionsFor,
  generateSceneImages,
  generateSceneVoices,
  getRendered,
  patchProject,
  patchScene,
  renderVideo,
} from '../lib/video';
import { Back, Close, Download, Play, Refresh, Speaker, Trash } from './Icons';
import { Sheet, toast } from './ui';

const STAGE_LABEL: Record<VideoProject['stage'], string> = {
  reja: 'Reja tuzilmoqda',
  ssenariy: 'Ssenariy yozilmoqda',
  sahnalar: 'Sahnalar tayyor',
  rasmlar: 'Rasmlar chizilmoqda',
  ovoz: 'Ovoz yozilmoqda',
  tayyor: 'Yigʻishga tayyor',
  render: 'Video yigʻilmoqda',
  yakunlandi: 'Video tayyor',
};

/* ------------------------------------------------------------------ */
/*  Chatdagi karta                                                     */
/* ------------------------------------------------------------------ */

export function VideoCard({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (id: string) => void;
}) {
  const project = useStore((s) => s.videos.find((v) => v.id === projectId));
  if (!project) return null;

  const ready = project.scenes.filter((s) => s.imageData).length;
  const voiced = project.scenes.filter((s) => s.audioWav).length;
  const cover = project.scenes.find((s) => s.imageData);

  return (
    <button className="video-card" onClick={() => onOpen(project.id)}>
      <div className="video-cover">
        {cover ? (
          <img src={`data:${cover.imageMime};base64,${cover.imageData}`} alt="" />
        ) : (
          <span className="video-cover-empty">🎬</span>
        )}
        <span className="video-aspect">{project.aspect}</span>
      </div>
      <div className="grow" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 15, fontWeight: 570 }}>{project.title}</div>
        <div className="tiny" style={{ marginTop: 3 }}>
          {project.scenes.length} sahna · {ready} rasm · {voiced} ovoz
        </div>
        <div className="row" style={{ marginTop: 7, gap: 6 }}>
          <span className="chip accent">{STAGE_LABEL[project.stage]}</span>
          {project.stage === 'yakunlandi' && (
            <span className="chip">{Math.round((project.outputSize ?? 0) / 1024 / 1024 * 10) / 10} MB</span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  To'liq ekran studiya                                               */
/* ------------------------------------------------------------------ */

type Tab = 'sahnalar' | 'subtitr' | 'qahramon' | 'sozlama';

export function VideoStudio({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = useStore((s) => s.videos.find((v) => v.id === projectId));
  const [tab, setTab] = useState<Tab>('sahnalar');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [editScene, setEditScene] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => () => stopPlayback(), []);

  // Subtitr koʻrinishini jonli koʻrsatish
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !project || tab !== 'subtitr') return;
    const { w, h } = dimensionsFor(project.aspect);
    const scale = 260 / h;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scene = project.scenes[0];
    ctx.fillStyle = '#15151b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const paint = () => {
      const st = project.subtitle;
      const k = scale;
      ctx.font = `700 ${st.size * k}px ${st.font}, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = st.uppercase ? 'NAMUNA SUBTITR' : 'Namuna subtitr';
      const y =
        st.position === 'yuqori'
          ? canvas.height * 0.18
          : st.position === 'orta'
            ? canvas.height / 2
            : canvas.height * 0.82;

      if (st.background && st.background !== 'transparent') {
        const width = ctx.measureText(text).width;
        ctx.fillStyle = st.background;
        ctx.fillRect(
          (canvas.width - width) / 2 - 10,
          y - st.size * k * 0.75,
          width + 20,
          st.size * k * 1.5,
        );
      }
      if (st.strokeWidth > 0) {
        ctx.lineWidth = st.strokeWidth * k;
        ctx.strokeStyle = st.stroke;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, canvas.width / 2, y);
      }
      ctx.fillStyle = st.color;
      ctx.fillText(text, canvas.width / 2, y);
    };

    if (scene?.imageData) {
      const img = new Image();
      img.onload = () => {
        const s = Math.max(canvas.width / img.width, canvas.height / img.height);
        ctx.drawImage(
          img,
          (canvas.width - img.width * s) / 2,
          (canvas.height - img.height * s) / 2,
          img.width * s,
          img.height * s,
        );
        paint();
      };
      img.src = `data:${scene.imageMime};base64,${scene.imageData}`;
    } else {
      paint();
    }
  }, [project, tab]);

  if (!project) return null;

  const imagesDone = project.scenes.filter((s) => s.imageData).length;
  const voicesDone = project.scenes.filter((s) => s.audioWav).length;
  const allReady = imagesDone === project.scenes.length && voicesDone === project.scenes.length;

  const run = async (
    label: string,
    fn: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(label);
    setProgress(0);
    try {
      await fn(controller.signal);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast(String((err as Error)?.message ?? err));
        patchProject(project.id, { error: String((err as Error)?.message ?? err) });
      }
    } finally {
      setBusy(null);
      setProgress(0);
      abortRef.current = null;
    }
  };

  const makeImages = () =>
    run('Rasmlar chizilmoqda', (signal) =>
      generateSceneImages(
        project.id,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        signal,
      ),
    );

  const makeVoices = () =>
    run('Ovoz yozilmoqda', (signal) =>
      generateSceneVoices(
        project.id,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        signal,
      ),
    );

  const makeAll = async () => {
    await makeImages();
    await makeVoices();
  };

  const doRender = () =>
    run('Video yigʻilmoqda', async () => {
      const result = await renderVideo(project.id, setProgress);
      toast(`Video tayyor — ${Math.round(result.durationSec)} soniya`);
    });

  const download = async () => {
    const blob = getRendered(project.id);
    if (!blob) {
      toast('Avval videoni yigʻing');
      return;
    }
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      toast(await saveBytes(`${project.title.slice(0, 40) || 'video'}.${ext}`, bytes, blob.type));
    } catch (err) {
      toast(`Saqlab boʻlmadi: ${(err as Error).message}`);
    }
  };

  const setSubtitle = (patch: Partial<SubtitleStyle>) =>
    patchProject(project.id, { subtitle: { ...project.subtitle, ...patch } });

  const scene = project.scenes.find((s) => s.id === editScene);

  return (
    <div className="viewer">
      <div className="viewer-head">
        <button className="icon-btn" onClick={onClose} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="artifact-title">{project.title}</div>
          <div className="tiny">{STAGE_LABEL[project.stage]}</div>
        </div>
        {project.stage === 'yakunlandi' && (
          <button className="icon-btn" onClick={download} aria-label="Yuklab olish">
            <Download />
          </button>
        )}
      </div>

      <div className="seg">
        {(['sahnalar', 'subtitr', 'qahramon', 'sozlama'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'sahnalar'
              ? 'Sahnalar'
              : t === 'subtitr'
                ? 'Subtitr'
                : t === 'qahramon'
                  ? 'Qahramonlar'
                  : 'Sozlama'}
          </button>
        ))}
      </div>

      <div className="scroll">
        <div className="pad">
          {busy && (
            <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
              <div className="between">
                <span style={{ fontSize: 14 }}>{busy}</span>
                <button
                  className="tiny"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => abortRef.current?.abort()}
                >
                  Toʻxtatish
                </button>
              </div>
              <div className="progress">
                <i style={{ width: `${progress}%` }} />
              </div>
              <div className="tiny" style={{ marginTop: 5 }}>
                {progress}%
              </div>
            </div>
          )}

          {project.error && !busy && <div className="err" style={{ marginBottom: 12 }}>{project.error}</div>}

          {tab === 'sahnalar' && (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <button className="btn grow" disabled={!!busy} onClick={makeAll}>
                  <Refresh size={15} /> Rasm + ovoz
                </button>
                <button className="btn ghost" disabled={!!busy} onClick={makeImages}>
                  🖼
                </button>
                <button className="btn ghost" disabled={!!busy} onClick={makeVoices}>
                  <Speaker size={15} />
                </button>
              </div>

              {allReady && (
                <button
                  className="btn wide"
                  disabled={!!busy}
                  style={{ marginBottom: 14 }}
                  onClick={project.stage === 'yakunlandi' ? download : doRender}
                >
                  {project.stage === 'yakunlandi' ? (
                    <>
                      <Download size={16} /> Videoni yuklab olish
                    </>
                  ) : (
                    <>
                      <Play size={15} /> Videoni yigʻish
                    </>
                  )}
                </button>
              )}

              {project.scenes.map((s, i) => (
                <div className="scene-row" key={s.id}>
                  <div className="scene-thumb" onClick={() => setEditScene(s.id)}>
                    {s.imageData ? (
                      <img src={`data:${s.imageMime};base64,${s.imageData}`} alt="" />
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                  <div className="grow" onClick={() => setEditScene(s.id)}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>{s.narration}</div>
                    <div className="row" style={{ gap: 5, marginTop: 6 }}>
                      <span className="chip">{i + 1}-sahna</span>
                      {s.audioWav && <span className="chip accent">ovozli</span>}
                    </div>
                  </div>
                  {s.audioWav && (
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={() => playWavBase64(s.audioWav!)}
                      aria-label="Tinglash"
                    >
                      <Play size={14} />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {tab === 'subtitr' && (
            <>
              <canvas ref={previewRef} className="subtitle-preview" />

              <div className="section-label" style={{ padding: '10px 0 6px' }}>
                Tayyor uslublar
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {SUBTITLE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className="btn mini ghost"
                    onClick={() => patchProject(project.id, { subtitle: { ...p.style } })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              <div className="field">
                <label>Oʻlchami: {project.subtitle.size}px</label>
                <input
                  type="range"
                  min={24}
                  max={80}
                  value={project.subtitle.size}
                  onChange={(e) => setSubtitle({ size: Number(e.target.value) })}
                  style={{ padding: 0, background: 'none', border: 'none' }}
                />
              </div>

              <div className="field-row">
                <div className="field">
                  <label>Matn rangi</label>
                  <input
                    type="color"
                    value={project.subtitle.color}
                    onChange={(e) => setSubtitle({ color: e.target.value })}
                    style={{ height: 44, padding: 4 }}
                  />
                </div>
                <div className="field">
                  <label>Chekka rangi</label>
                  <input
                    type="color"
                    value={project.subtitle.stroke}
                    onChange={(e) => setSubtitle({ stroke: e.target.value })}
                    style={{ height: 44, padding: 4 }}
                  />
                </div>
              </div>

              <div className="field">
                <label>Chekka qalinligi: {project.subtitle.strokeWidth}</label>
                <input
                  type="range"
                  min={0}
                  max={14}
                  value={project.subtitle.strokeWidth}
                  onChange={(e) => setSubtitle({ strokeWidth: Number(e.target.value) })}
                  style={{ padding: 0, background: 'none', border: 'none' }}
                />
              </div>

              <div className="field">
                <label>Joylashuvi</label>
                <select
                  value={project.subtitle.position}
                  onChange={(e) =>
                    setSubtitle({ position: e.target.value as SubtitleStyle['position'] })
                  }
                >
                  <option value="past">Pastda</option>
                  <option value="orta">Oʻrtada</option>
                  <option value="yuqori">Yuqorida</option>
                </select>
              </div>

              <div className="field">
                <label>Orqa fon</label>
                <select
                  value={project.subtitle.background}
                  onChange={(e) => setSubtitle({ background: e.target.value })}
                >
                  <option value="transparent">Yoʻq</option>
                  <option value="rgba(0,0,0,0.35)">Yengil qora</option>
                  <option value="rgba(0,0,0,0.75)">Toʻq qora</option>
                  <option value="rgba(107,86,232,0.9)">Binafsha</option>
                </select>
              </div>

              <button
                className="btn ghost wide"
                onClick={() => setSubtitle({ uppercase: !project.subtitle.uppercase })}
              >
                {project.subtitle.uppercase ? 'BOSH HARFLAR yoqilgan' : 'Bosh harflar oʻchiq'}
              </button>
            </>
          )}

          {tab === 'qahramon' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Qahramon tavsifi har bir sahna rasmiga qoʻshiladi — shunda u barcha kadrlarda
                bir xil koʻrinadi.
              </p>
              {project.characters.length === 0 && (
                <div className="empty">
                  <b>Qahramon yoʻq</b>
                  Pastdagi tugma bilan qoʻshing.
                </div>
              )}
              {project.characters.map((c) => (
                <div className="card" key={c.id}>
                  <div className="field">
                    <label>Ismi</label>
                    <input
                      value={c.name}
                      onChange={(e) =>
                        patchProject(project.id, {
                          characters: project.characters.map((x) =>
                            x.id === c.id ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Tashqi koʻrinishi (inglizcha yozilsa rasm aniqroq chiqadi)</label>
                    <textarea
                      value={c.look}
                      onChange={(e) =>
                        patchProject(project.id, {
                          characters: project.characters.map((x) =>
                            x.id === c.id ? { ...x, look: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Ovozi</label>
                    <select
                      value={c.voiceId}
                      onChange={(e) =>
                        patchProject(project.id, {
                          characters: project.characters.map((x) =>
                            x.id === c.id ? { ...x, voiceId: e.target.value } : x,
                          ),
                        })
                      }
                    >
                      {VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} — {v.note}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn ghost mini"
                    style={{ color: 'var(--danger)' }}
                    onClick={() =>
                      patchProject(project.id, {
                        characters: project.characters.filter((x) => x.id !== c.id),
                      })
                    }
                  >
                    <Trash size={14} /> Oʻchirish
                  </button>
                </div>
              ))}
              <button
                className="btn ghost wide"
                style={{ marginTop: 10 }}
                onClick={() =>
                  patchProject(project.id, {
                    characters: [
                      ...project.characters,
                      {
                        id: `vc_${Date.now().toString(36)}`,
                        name: 'Yangi qahramon',
                        look: 'young man, short dark hair, blue shirt, friendly face',
                        voiceId: project.voiceId,
                      },
                    ],
                  })
                }
              >
                Qahramon qoʻshish
              </button>
            </>
          )}

          {tab === 'sozlama' && (
            <>
              <div className="field">
                <label>Sarlavha</label>
                <input
                  value={project.title}
                  onChange={(e) => patchProject(project.id, { title: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Format</label>
                <select
                  value={project.aspect}
                  onChange={(e) =>
                    patchProject(project.id, { aspect: e.target.value as VideoProject['aspect'] })
                  }
                >
                  <option value="9:16">Tik (9:16) — Reels, Shorts</option>
                  <option value="16:9">Keng (16:9) — YouTube</option>
                  <option value="1:1">Kvadrat (1:1)</option>
                </select>
              </div>
              <div className="field">
                <label>Rasm uslubi</label>
                <select
                  value={project.style}
                  onChange={(e) => patchProject(project.id, { style: e.target.value })}
                >
                  {[project.style, ...VIDEO_STYLES.filter((s) => s !== project.style)].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div className="tiny" style={{ marginTop: 5 }}>
                  Uslubni oʻzgartirgach rasmlarni qaytadan chizdiring.
                </div>
              </div>
              <div className="field">
                <label>Diktor ovozi</label>
                <select
                  value={project.voiceId}
                  onChange={(e) => patchProject(project.id, { voiceId: e.target.value })}
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.note}
                    </option>
                  ))}
                </select>
              </div>

              <button
                className="btn ghost wide"
                onClick={() =>
                  patchProject(project.id, {
                    scenes: project.scenes.map((s) => ({
                      ...s,
                      imageData: undefined,
                      imageMime: undefined,
                    })),
                  })
                }
              >
                Rasmlarni tozalash
              </button>
              <button
                className="btn ghost wide"
                style={{ marginTop: 8 }}
                onClick={() =>
                  patchProject(project.id, {
                    scenes: project.scenes.map((s) => ({ ...s, audioWav: undefined })),
                  })
                }
              >
                Ovozlarni tozalash
              </button>
              <button
                className="btn ghost wide"
                style={{ marginTop: 8, color: 'var(--danger)' }}
                onClick={() => {
                  if (window.confirm('Video loyihasi oʻchirilsinmi?')) {
                    deleteProject(project.id);
                    onClose();
                  }
                }}
              >
                <Trash size={15} /> Loyihani oʻchirish
              </button>
            </>
          )}
        </div>
      </div>

      {scene && (
        <Sheet title={`${project.scenes.indexOf(scene) + 1}-sahna`} onClose={() => setEditScene(null)}>
          {scene.imageData && (
            <img
              src={`data:${scene.imageMime};base64,${scene.imageData}`}
              alt=""
              style={{ width: '100%', borderRadius: 12, marginBottom: 12 }}
            />
          )}
          <div className="field">
            <label>Ovoz matni (subtitr ham shu)</label>
            <textarea
              value={scene.narration}
              onChange={(e) =>
                patchScene(project.id, scene.id, {
                  narration: e.target.value,
                  audioWav: undefined,
                })
              }
            />
          </div>
          <div className="field">
            <label>Rasm soʻrovi</label>
            <textarea
              value={scene.imagePrompt}
              onChange={(e) =>
                patchScene(project.id, scene.id, {
                  imagePrompt: e.target.value,
                  imageData: undefined,
                })
              }
            />
          </div>
          <div className="row">
            <button
              className="btn ghost grow"
              onClick={() => {
                patchScene(project.id, scene.id, { imageData: undefined });
                setEditScene(null);
                void makeImages();
              }}
            >
              Rasmni qayta chizish
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                patchProject(project.id, {
                  scenes: project.scenes.filter((s) => s.id !== scene.id),
                })
              }
              aria-label="Sahnani oʻchirish"
            >
              <Close size={16} />
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
