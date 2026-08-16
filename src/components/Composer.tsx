import { useEffect, useRef, useState } from 'react';
import { startListening, type ListenHandle } from '../lib/speech';
import type { Attachment } from '../lib/types';
import { shrinkImage } from '../lib/utils';
import { Close, Mic, Plus, Send, Stop } from './Icons';
import { Sheet, toast } from './ui';

export type ComposerMode = 'chat' | 'rasm' | 'video' | 'ilova' | 'kurs' | 'hujjat';

interface ModeInfo {
  id: ComposerMode;
  icon: string;
  label: string;
  hint: string;
  placeholder: string;
}

export const MODES: ModeInfo[] = [
  {
    id: 'rasm',
    icon: '✨',
    label: 'Rasm yaratish',
    hint: 'Tasvirlab bering — chizib beraman',
    placeholder: 'Qanday rasm chizay?',
  },
  {
    id: 'video',
    icon: '🎬',
    label: 'Video yasash',
    hint: 'Ssenariy, ovoz, subtitr — hammasi avtomatik',
    placeholder: 'Video mavzusi?',
  },
  {
    id: 'ilova',
    icon: '🧩',
    label: 'Ilova yasash',
    hint: 'Ishlaydigan mini ilova, telefoningizga saqlanadi',
    placeholder: 'Qanday ilova kerak?',
  },
  {
    id: 'kurs',
    icon: '🎓',
    label: 'Kurs ochish',
    hint: 'Mavzular roʻyxati va interaktiv darslar',
    placeholder: 'Qaysi sohani oʻrganmoqchisiz?',
  },
  {
    id: 'hujjat',
    icon: '📄',
    label: 'Hujjat yasash',
    hint: 'Word, PDF yoki slayd qilib yuklab olasiz',
    placeholder: 'Qanday hujjat kerak?',
  },
];

interface Props {
  busy: boolean;
  mode: ComposerMode;
  onMode: (m: ComposerMode) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

export function Composer({ busy, mode, onMode, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mic, setMic] = useState<'oʻchiq' | 'yozilmoqda' | 'tahlil'>('oʻchiq');
  const [menu, setMenu] = useState(false);
  const listenRef = useRef<ListenHandle | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = MODES.find((m) => m.id === mode) ?? null;
  const canSend = Boolean(text.trim() || attachments.length);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(
    () => () => {
      listenRef.current?.cancel();
    },
    [],
  );

  const submit = () => {
    if (busy || !canSend) return;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
  };

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      try {
        const shrunk = await shrinkImage(file);
        next.push({ ...shrunk, name: file.name });
      } catch {
        toast(`Rasmni oʻqib boʻlmadi: ${file.name}`);
      }
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 4));
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
      onState: (s) => setMic(s),
      onFinal: (value) => {
        setText((prev) => (prev ? `${prev} ${value}` : value));
        setMic('oʻchiq');
        listenRef.current = null;
        requestAnimationFrame(() => areaRef.current?.focus());
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

  const placeholder =
    mic === 'yozilmoqda'
      ? 'Tinglayapman…'
      : mic === 'tahlil'
        ? 'Matnga oʻgirilmoqda…'
        : (active?.placeholder ?? 'Savolingizni yozing…');

  return (
    <div className="composer">
      {active && (
        <div className="mode-chip">
          <span>{active.icon}</span>
          <span className="grow">{active.label}</span>
          <button onClick={() => onMode('chat')} aria-label="Rejimni bekor qilish">
            <Close size={14} />
          </button>
        </div>
      )}

      {!!attachments.length && (
        <div className="pending-strip">
          {attachments.map((a, i) => (
            <div className="thumb" key={i}>
              <img src={`data:${a.mimeType};base64,${a.data}`} alt="" />
              <button
                className="x"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Olib tashlash"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={mic === 'oʻchiq' ? 'composer-box' : 'composer-box listening'}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void pickFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <button className="round-btn" onClick={() => setMenu(true)} aria-label="Qoʻshish">
          <Plus size={21} />
        </button>

        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        {busy ? (
          <button className="round-btn primary" onClick={onStop} aria-label="Toʻxtatish">
            <Stop size={16} />
          </button>
        ) : canSend ? (
          <button className="round-btn primary" onClick={submit} aria-label="Yuborish">
            <Send size={19} />
          </button>
        ) : (
          <button
            className={mic === 'oʻchiq' ? 'round-btn' : 'round-btn rec'}
            onClick={toggleMic}
            disabled={mic === 'tahlil'}
            aria-label="Ovozli kiritish"
          >
            <Mic size={20} />
          </button>
        )}
      </div>

      {menu && (
        <Sheet title="Nima qilamiz?" onClose={() => setMenu(false)}>
          <button
            className="action-row"
            onClick={() => {
              setMenu(false);
              fileRef.current?.click();
            }}
          >
            <span className="action-icon">🖼</span>
            <span className="grow">
              <b>Rasm biriktirish</b>
              <div className="tiny">Daftar yoki kitob sahifasini surat qilib soʻrang</div>
            </span>
          </button>

          {MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? 'action-row on' : 'action-row'}
              onClick={() => {
                onMode(mode === m.id ? 'chat' : m.id);
                setMenu(false);
                requestAnimationFrame(() => areaRef.current?.focus());
              }}
            >
              <span className="action-icon">{m.icon}</span>
              <span className="grow">
                <b>{m.label}</b>
                <div className="tiny">{m.hint}</div>
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
