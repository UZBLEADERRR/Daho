import { useEffect, useRef, useState } from 'react';
import { startListening, type ListenHandle } from '../lib/speech';
import { useStore } from '../lib/store';
import type { Attachment } from '../lib/types';
import { shrinkImage } from '../lib/utils';
import { Image, Mic, Send, Sparkle, Stop } from './Icons';
import { toast } from './ui';

interface Props {
  busy: boolean;
  imageMode: boolean;
  onToggleImageMode: () => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

export function Composer({ busy, imageMode, onToggleImageMode, onSend, onStop }: Props) {
  const sttLang = useStore((s) => s.settings.sttLang);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [listening, setListening] = useState(false);
  const listenRef = useRef<ListenHandle | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(
    () => () => {
      listenRef.current?.stop().catch(() => undefined);
    },
    [],
  );

  const submit = () => {
    const value = text.trim();
    if (!value && !attachments.length) return;
    if (busy) return;
    onSend(value, attachments);
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
    if (listening) {
      await listenRef.current?.stop();
      listenRef.current = null;
      setListening(false);
      return;
    }
    setListening(true);
    const handle = await startListening(sttLang, {
      onPartial: (value) => setText(value),
      onFinal: (value) => {
        setText(value);
        setListening(false);
        listenRef.current = null;
      },
      onError: (message) => {
        toast(message);
        setListening(false);
        listenRef.current = null;
      },
    });
    listenRef.current = handle;
    if (!handle) setListening(false);
  };

  return (
    <div className="composer">
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

      <div className="composer-box">
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
        <button
          className="icon-btn"
          onClick={() => fileRef.current?.click()}
          aria-label="Rasm biriktirish"
        >
          <Image />
        </button>
        <button
          className={imageMode ? 'icon-btn on' : 'icon-btn'}
          onClick={onToggleImageMode}
          aria-label="Rasm yaratish rejimi"
        >
          <Sparkle />
        </button>

        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={
            listening
              ? 'Tinglanmoqda…'
              : imageMode
                ? 'Qanday rasm chizay?'
                : 'Savolingizni yozing…'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              submit();
            }
          }}
        />

        <button
          className={listening ? 'icon-btn rec' : 'icon-btn'}
          onClick={toggleMic}
          aria-label="Ovozli kiritish"
        >
          <Mic />
        </button>

        {busy ? (
          <button className="send" onClick={onStop} aria-label="Toʻxtatish">
            <Stop />
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim() && !attachments.length}
            aria-label="Yuborish"
          >
            <Send />
          </button>
        )}
      </div>
    </div>
  );
}
