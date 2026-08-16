import { useMemo, useState } from 'react';
import { splitSegments } from '../lib/artifacts';
import { copyText, exportDocument, DOC_LABEL, type DocFormat } from '../lib/exporter';
import { renderMarkdown } from '../lib/markdown';
import { speak, stopSpeaking } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Artifact, Message as Msg } from '../lib/types';
import { ArtifactCard } from './ArtifactView';
import { Check, Copy, Download, Refresh, Speaker } from './Icons';
import { VideoCard } from './VideoStudio';
import { Sheet, toast } from './ui';

interface Props {
  message: Msg;
  streaming: boolean;
  isLast: boolean;
  onOpenArtifact: (a: Artifact) => void;
  onOpenVideo: (id: string) => void;
  onRegenerate: () => void;
}

export function MessageView({
  message,
  streaming,
  isLast,
  onOpenArtifact,
  onOpenVideo,
  onRegenerate,
}: Props) {
  const artifacts = useStore((s) => s.artifacts);
  const [exporting, setExporting] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const segments = useMemo(() => splitSegments(message.text), [message.text]);

  const linked = useMemo(() => {
    const ids = message.artifactIds ?? [];
    return ids
      .map((id) => artifacts.find((a) => a.id === id))
      .filter((a): a is Artifact => Boolean(a));
  }, [message.artifactIds, artifacts]);

  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        {!!message.attachments?.length && (
          <div className="attach-grid" style={{ justifyContent: 'flex-end' }}>
            {message.attachments.map((a, i) => (
              <img key={i} src={`data:${a.mimeType};base64,${a.data}`} alt="" />
            ))}
          </div>
        )}
        {message.text && <div className="msg user">{message.text}</div>}
      </div>
    );
  }

  const onExport = async (format: DocFormat) => {
    setExporting(false);
    try {
      const title =
        message.text.match(/^#\s+(.+)$/m)?.[1] ??
        message.text.replace(/[#*`]/g, '').trim().split('\n')[0]?.slice(0, 50) ??
        'Daho hujjat';
      toast(await exportDocument(message.text, format, title));
    } catch (err) {
      toast(`Chiqarib boʻlmadi: ${(err as Error).message}`);
    }
  };

  const onSpeak = async () => {
    if (speaking) {
      await stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      await speak(message.text);
    } finally {
      setSpeaking(false);
    }
  };

  let codeIndex = -1;

  return (
    <div className="msg model">
      {message.toolCalls?.map((call, i) => (
        <div key={i} className={call.ok ? 'tool-line' : 'tool-line bad'}>
          <Check size={13} />
          <span className="grow">{call.summary}</span>
        </div>
      ))}

      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          if (!seg.value.trim()) return null;
          return (
            <div
              key={i}
              className="md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.value) }}
            />
          );
        }

        const substantial = seg.closed && seg.value.trim().split('\n').length >= 3;
        if (substantial) codeIndex += 1;
        const artifact = substantial ? linked[codeIndex] : undefined;

        if (artifact) {
          return <ArtifactCard key={i} artifact={artifact} onOpen={onOpenArtifact} />;
        }

        return (
          <div key={i} className="artifact-card">
            <div className="artifact-head">
              <span className="chip">{seg.lang || 'kod'}</span>
              <div className="grow">
                <div className="artifact-title">{seg.closed ? 'Kod' : 'Yozilmoqda…'}</div>
              </div>
            </div>
            <pre className="artifact-code">{seg.value}</pre>
          </div>
        );
      })}

      {message.videoId && <VideoCard projectId={message.videoId} onOpen={onOpenVideo} />}

      {streaming && <span className="typing" />}

      {message.error && <div className="err">{message.error}</div>}

      {!streaming && message.text.trim() && (
        <div className="msg-actions">
          <button
            onClick={async () =>
              toast((await copyText(message.text)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi')
            }
          >
            <Copy size={12} /> Nusxa
          </button>
          <button onClick={onSpeak}>
            <Speaker size={12} /> {speaking ? 'Toʻxtat' : 'Ovoz'}
          </button>
          <button onClick={() => setExporting(true)}>
            <Download size={12} /> Yuklash
          </button>
          {isLast && (
            <button onClick={onRegenerate}>
              <Refresh size={12} /> Qayta
            </button>
          )}
        </div>
      )}

      {exporting && (
        <Sheet title="Qaysi koʻrinishda?" onClose={() => setExporting(false)}>
          {(['docx', 'pdf', 'pptx', 'md'] as DocFormat[]).map((f) => (
            <button key={f} className="action-row" onClick={() => void onExport(f)}>
              <span className="action-icon">
                {f === 'docx' ? '📄' : f === 'pdf' ? '📕' : f === 'pptx' ? '📊' : '📝'}
              </span>
              <span className="grow">
                <b>{DOC_LABEL[f]}</b>
                <div className="tiny">
                  {f === 'docx'
                    ? 'Word va Google Docs’da ochiladi'
                    : f === 'pdf'
                      ? 'Har qanday qurilmada bir xil koʻrinadi'
                      : f === 'pptx'
                        ? 'Har bir sarlavha — alohida slayd'
                        : 'Oddiy matn fayli'}
                </div>
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
