import { useMemo, useState } from 'react';
import { isPreviewable, toPreviewDocument } from '../lib/artifacts';
import { IFRAME_ALLOW, IFRAME_SANDBOX } from '../lib/sandbox';
import { saveApp } from '../lib/creations';
import { copyText, saveArtifact } from '../lib/exporter';
import type { Artifact } from '../lib/types';
import { Back, Code, Copy, Download, Eye, Play, Plus, Refresh } from './Icons';
import { toast } from './ui';

const KIND_LABEL: Record<string, string> = {
  html: 'Ilova',
  image: 'Rasm',
  markdown: 'Matn',
  code: 'Kod',
};

export function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Artifact;
  onOpen: (a: Artifact) => void;
}) {
  if (artifact.kind === 'image') {
    return (
      <button
        className="msg-image"
        onClick={() => onOpen(artifact)}
        aria-label={artifact.title || 'Rasm'}
      >
        <img
          src={`data:${artifact.mimeType ?? 'image/png'};base64,${artifact.content}`}
          alt={artifact.title}
        />
      </button>
    );
  }

  // Xom kod koʻrsatilmaydi — bitta ochish tugmasi yetarli.
  return (
    <button className="artifact-card open" onClick={() => onOpen(artifact)}>
      <span className="artifact-play">{isPreviewable(artifact) ? <Play size={16} /> : <Eye size={16} />}</span>
      <span className="grow">
        <span className="artifact-title">{artifact.title}</span>
        <span className="tiny">
          {KIND_LABEL[artifact.kind] ?? 'Fayl'}
          {artifact.lang ? ` · ${artifact.lang}` : ''} · {artifact.content.split('\n').length} qator
        </span>
      </span>
      <span className="chip accent">{isPreviewable(artifact) ? 'Ochish' : 'Koʻrish'}</span>
    </button>
  );
}

export function ArtifactViewer({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const previewable = isPreviewable(artifact);
  const [mode, setMode] = useState<'preview' | 'code'>(previewable ? 'preview' : 'code');
  const [reloadKey, setReloadKey] = useState(0);

  const doc = useMemo(
    () => (artifact.kind === 'html' ? toPreviewDocument(artifact) : ''),
    [artifact],
  );

  const onCopy = async () => {
    if (artifact.kind === 'image') {
      toast('Rasmni saqlash tugmasidan foydalaning');
      return;
    }
    toast((await copyText(artifact.content)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi');
  };

  const onSave = async () => {
    try {
      toast(await saveArtifact(artifact));
    } catch (err) {
      toast(`Saqlab boʻlmadi: ${(err as Error).message}`);
    }
  };

  return (
    <div className="viewer">
      <div className="viewer-head">
        <button className="icon-btn" onClick={onClose} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="artifact-title">{artifact.title}</div>
        </div>
        {artifact.kind === 'html' && (
          <button
            className="icon-btn"
            onClick={() => {
              const app = saveApp(artifact.content, artifact.title);
              toast(`«${app.name}» Ilovalarimga qoʻshildi`);
            }}
            aria-label="Ilovalarimga qoʻshish"
          >
            <Plus size={19} />
          </button>
        )}
        {previewable && artifact.kind === 'html' && (
          <>
            <button
              className={mode === 'preview' ? 'icon-btn on' : 'icon-btn'}
              onClick={() => setMode('preview')}
              aria-label="Koʻrinish"
            >
              <Eye />
            </button>
            <button
              className={mode === 'code' ? 'icon-btn on' : 'icon-btn'}
              onClick={() => setMode('code')}
              aria-label="Kod"
            >
              <Code />
            </button>
            {mode === 'preview' && (
              <button
                className="icon-btn"
                onClick={() => setReloadKey((k) => k + 1)}
                aria-label="Qayta yuklash"
              >
                <Refresh />
              </button>
            )}
          </>
        )}
        <button className="icon-btn" onClick={onCopy} aria-label="Nusxalash">
          <Copy />
        </button>
        <button className="icon-btn" onClick={onSave} aria-label="Saqlash">
          <Download />
        </button>
      </div>

      <div className="viewer-body">
        {artifact.kind === 'image' ? (
          <div className="imgwrap">
            <img
              src={`data:${artifact.mimeType ?? 'image/png'};base64,${artifact.content}`}
              alt={artifact.title}
            />
          </div>
        ) : mode === 'preview' && artifact.kind === 'html' ? (
          <iframe
            key={reloadKey}
            title={artifact.title}
            srcDoc={doc}
            sandbox={IFRAME_SANDBOX}
            allow={IFRAME_ALLOW}
          />
        ) : (
          <pre>{artifact.content}</pre>
        )}
      </div>
    </div>
  );
}
