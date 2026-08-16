import { useMemo, useState } from 'react';
import { isPreviewable, toPreviewDocument } from '../lib/artifacts';
import { copyText, saveArtifact } from '../lib/exporter';
import type { Artifact } from '../lib/types';
import { Back, Code, Copy, Download, Eye, Play, Refresh } from './Icons';
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
  return (
    <div className="artifact-card">
      <div className="artifact-head">
        <span className="chip accent">{KIND_LABEL[artifact.kind] ?? 'Fayl'}</span>
        <div className="grow">
          <div className="artifact-title">{artifact.title}</div>
          {artifact.lang && artifact.kind !== 'image' && (
            <div className="tiny">{artifact.lang}</div>
          )}
        </div>
        <button className="btn mini" onClick={() => onOpen(artifact)}>
          {isPreviewable(artifact) ? <Play size={14} /> : <Eye size={14} />}
          {isPreviewable(artifact) ? 'Ochish' : 'Koʻrish'}
        </button>
      </div>

      {artifact.kind === 'image' ? (
        <img
          className="artifact-img"
          src={`data:${artifact.mimeType ?? 'image/png'};base64,${artifact.content}`}
          alt={artifact.title}
          onClick={() => onOpen(artifact)}
        />
      ) : (
        <pre className="artifact-code">
          {artifact.content.split('\n').slice(0, 12).join('\n')}
          {artifact.content.split('\n').length > 12 ? '\n…' : ''}
        </pre>
      )}
    </div>
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
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        ) : (
          <pre>{artifact.content}</pre>
        )}
      </div>
    </div>
  );
}
