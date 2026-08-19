import { useMemo, useState } from 'react';
import { splitSegments, type Segment } from '../lib/artifacts';
import { copyText, exportDocument, DOC_LABEL, type DocFormat } from '../lib/exporter';
import { Markdown } from './Markdown';
import { speak, stopSpeaking } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Artifact, Message as Msg } from '../lib/types';
import { parseChart } from '../lib/charts';
import { ArtifactCard } from './ArtifactView';
import { Chart } from './Chart';
import { Copy, Download, Refresh, Speaker } from './Icons';
import { RouteCard } from './RouteCard';
import { ToolLine, splitByTools } from './ToolLine';
import { VideoCard } from './VideoStudio';
import { YouTubeCard } from './VideoLink';
import { findVideos } from '../lib/ytube';
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

  // Matn vositalar bajarilgan nuqtalar boʻyicha boʻlinadi — tartib saqlanadi.
  const blocks = useMemo(
    () => splitByTools(message.text, message.toolCalls),
    [message.text, message.toolCalls],
  );

  const linked = useMemo(() => {
    const ids = message.artifactIds ?? [];
    return ids
      .map((id) => artifacts.find((a) => a.id === id))
      .filter((a): a is Artifact => Boolean(a));
  }, [message.artifactIds, artifacts]);

  // Javobdagi YouTube havolalari — chatning oʻzida pleyer boʻlib chiqadi.
  const videoLinks = useMemo(() => findVideos(message.text), [message.text]);

  // Rasmlar chatda oʻzi koʻrinadi, qolganlari kod bloklariga bogʻlanadi.
  const pictures = useMemo(() => linked.filter((a) => a.kind === 'image'), [linked]);
  const codeLinked = useMemo(() => linked.filter((a) => a.kind !== 'image'), [linked]);

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
        {message.text && (
          <div
            className="msg user"
            onDoubleClick={async () =>
              toast((await copyText(message.text)) ? 'Nusxalandi' : 'Nusxalab boʻlmadi')
            }
          >
            {message.text}
          </div>
        )}
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

  const renderSegment = (seg: Segment, key: string) => {
    if (seg.type === 'text') {
      if (!seg.value.trim()) return null;
      return <Markdown key={key} text={seg.value} />;
    }

    if (seg.lang === 'chart') {
      const spec = seg.closed ? parseChart(seg.value) : null;
      if (spec) return <Chart key={key} spec={spec} />;
      if (!seg.closed) {
        return (
          <div key={key} className="viz viz-loading">
            Grafik tayyorlanmoqda…
          </div>
        );
      }
    }

    const lines = seg.value.trim().split('\n').length;
    const substantial = seg.closed && seg.lang !== 'chart' && lines >= 3;
    if (substantial) codeIndex += 1;
    const artifact = substantial ? codeLinked[codeIndex] : undefined;

    if (artifact) return <ArtifactCard key={key} artifact={artifact} onOpen={onOpenArtifact} />;

    // Yozilayotgan yoki hali saqlanmagan katta blok — xom kodni koʻrsatmaymiz.
    if (!seg.closed || lines >= 3) {
      return (
        <div key={key} className="artifact-card pending">
          <span className="chip accent">{seg.lang === 'html' ? 'Ilova' : 'Kod'}</span>
          <span className="grow artifact-title">
            {seg.closed ? 'Tayyorlanmoqda…' : 'Yozilmoqda…'}
          </span>
          <span className="typing" />
        </div>
      );
    }

    // Qisqa parcha — oddiy misol, shundayligicha koʻrsatiladi.
    return (
      <pre key={key} className="snippet">
        {seg.value}
      </pre>
    );
  };

  return (
    <div className="msg model">
      {blocks.map((block, bi) => (
        <div key={bi}>
          {splitSegments(block.text).map((seg, si) => renderSegment(seg, `${bi}-${si}`))}
          {block.calls.map((call, ci) => (
            <ToolLine key={ci} call={call} />
          ))}
        </div>
      ))}

      {videoLinks.map((v) => (
        <YouTubeCard key={v.id} video={v} />
      ))}

      {pictures.map((img) => (
        <button
          key={img.id}
          className="msg-image"
          onClick={() => onOpenArtifact(img)}
          aria-label={img.title || 'Rasm'}
        >
          <img src={`data:${img.mimeType ?? 'image/png'};base64,${img.content}`} alt={img.title} />
        </button>
      ))}

      {message.routeId && <RouteCard routeId={message.routeId} />}

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
