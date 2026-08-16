import { useMemo } from 'react';
import { splitSegments } from '../lib/artifacts';
import { copyText } from '../lib/exporter';
import { renderMarkdown } from '../lib/markdown';
import { speak } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Artifact, Message as Msg } from '../lib/types';
import { ArtifactCard } from './ArtifactView';
import { Check, Copy, Refresh, Speaker } from './Icons';
import { toast } from './ui';

interface Props {
  message: Msg;
  streaming: boolean;
  isLast: boolean;
  onOpenArtifact: (a: Artifact) => void;
  onRegenerate: () => void;
}

export function MessageView({
  message,
  streaming,
  isLast,
  onOpenArtifact,
  onRegenerate,
}: Props) {
  const artifacts = useStore((s) => s.artifacts);
  const settings = useStore((s) => s.settings);

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
          const html = renderMarkdown(seg.value);
          if (!seg.value.trim()) return null;
          return (
            <div key={i} className="md" dangerouslySetInnerHTML={{ __html: html }} />
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
                <div className="artifact-title">
                  {seg.closed ? 'Kod' : 'Yozilmoqda…'}
                </div>
              </div>
            </div>
            <pre className="artifact-code">{seg.value}</pre>
          </div>
        );
      })}

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
          <button
            onClick={() =>
              speak(message.text, {
                lang: settings.ttsLang,
                rate: settings.ttsRate,
                voiceUri: settings.ttsVoiceUri,
              })
            }
          >
            <Speaker size={12} /> Ovoz
          </button>
          {isLast && (
            <button onClick={onRegenerate}>
              <Refresh size={12} /> Qayta
            </button>
          )}
        </div>
      )}
    </div>
  );
}
