import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ensureActiveChat, regenerate, sendMessage } from '../lib/agent';
import { generateImage } from '../lib/gemini';
import { speak } from '../lib/speech';
import { getState, setState, useStore } from '../lib/store';
import type { Artifact, Attachment, Message } from '../lib/types';
import { uid } from '../lib/utils';
import { Composer } from './Composer';
import { MessageView } from './Message';
import { Empty, toast } from './ui';

const STARTERS = [
  'Bugungi darslarim boʻyicha reja tuz',
  'Hosila mavzusini misollar bilan tushuntir',
  'Menga formulalar yodlash uchun test ilovasi yasab ber',
  'Kurs ishim uchun bosqichli reja tuz',
];

export function ChatView({ onOpenArtifact }: { onOpenArtifact: (a: Artifact) => void }) {
  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const settings = useStore((s) => s.settings);
  const [busy, setBusy] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const chat = chats.find((c) => c.id === activeChatId) ?? null;
  const messages = chat?.messages ?? [];

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const runImage = async (chatId: string, prompt: string, refs: Attachment[]) => {
    const userMsg: Message = {
      id: uid('m_'),
      role: 'user',
      text: prompt,
      attachments: refs.length ? refs : undefined,
      createdAt: Date.now(),
    };
    const modelMsg: Message = {
      id: uid('m_'),
      role: 'model',
      text: 'Rasm chizilmoqda…',
      createdAt: Date.now(),
    };
    setState((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId
          ? { ...c, updatedAt: Date.now(), messages: [...c.messages, userMsg, modelMsg] }
          : c,
      ),
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (patchValue: Partial<Message>) =>
      setState((s) => ({
        chats: s.chats.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === modelMsg.id ? { ...m, ...patchValue } : m,
                ),
              }
            : c,
        ),
      }));

    try {
      const result = await generateImage(
        settings.apiKey,
        settings.imageModel,
        prompt,
        refs,
        controller.signal,
      );
      const artifacts: Artifact[] = result.images.map((img, i) => ({
        id: uid('a_'),
        kind: 'image',
        title: prompt.slice(0, 40) || `Rasm ${i + 1}`,
        content: img.data,
        mimeType: img.mimeType,
        chatId,
        createdAt: Date.now(),
      }));
      setState((s) => ({ artifacts: [...artifacts, ...s.artifacts] }));
      patch({
        text: result.text || 'Rasm tayyor.',
        artifactIds: artifacts.map((a) => a.id),
      });
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      patch({
        text: '',
        error: aborted ? 'Toʻxtatildi.' : String((err as Error)?.message ?? err),
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const onSend = async (text: string, attachments: Attachment[]) => {
    if (!settings.apiKey) {
      toast('Avval Sozlamalarda Gemini API kalitini kiriting');
      return;
    }
    const chatId = ensureActiveChat();
    stickRef.current = true;
    setBusy(true);

    if (imageMode) {
      await runImage(chatId, text, attachments);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const result = await sendMessage(chatId, text, attachments, controller.signal);
    abortRef.current = null;
    setBusy(false);

    if (result.ok && settings.autoSpeak && result.text) {
      void speak(result.text, {
        lang: settings.ttsLang,
        rate: settings.ttsRate,
        voiceUri: settings.ttsVoiceUri,
      });
    }
  };

  const onRegenerate = async () => {
    const chatId = getState().activeChatId;
    if (!chatId || busy) return;
    stickRef.current = true;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    await regenerate(chatId, controller.signal);
    abortRef.current = null;
    setBusy(false);
  };

  const lastModelIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'model') return i;
    }
    return -1;
  })();

  return (
    <>
      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div style={{ padding: '30px 16px' }}>
            <Empty
              title="Salom! Men Dahoman."
              hint="Fanlarni tushuntiraman, jadval va rejalaringizni yuritaman, ilova yasab beraman."
            />
            <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
              {STARTERS.map((s) => (
                <button
                  key={s}
                  className="btn ghost"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => void onSend(s, [])}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="msgs">
            {messages.map((m, i) => (
              <MessageView
                key={m.id}
                message={m}
                streaming={busy && i === messages.length - 1 && m.role === 'model'}
                isLast={i === lastModelIndex && !busy}
                onOpenArtifact={onOpenArtifact}
                onRegenerate={onRegenerate}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        busy={busy}
        imageMode={imageMode}
        onToggleImageMode={() => setImageMode((v) => !v)}
        onSend={onSend}
        onStop={stop}
      />
    </>
  );
}
