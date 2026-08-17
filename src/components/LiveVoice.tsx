import { useEffect, useRef, useState } from 'react';
import { sendMessage } from '../lib/agent';
import { startListening, speak, stopSpeaking, type ListenHandle } from '../lib/speech';
import { canChat } from '../lib/providers';
import { Close, Mic } from './Icons';
import { toast } from './ui';

type Phase = 'tayyor' | 'tinglayapman' | 'oʻylayapman' | 'javob' | 'xato';

const PHASE_TEXT: Record<Phase, string> = {
  tayyor: 'Gapirish uchun bosing',
  tinglayapman: 'Tinglayapman…',
  oʻylayapman: 'Oʻylayapman…',
  javob: 'Javob berayapman',
  xato: 'Qaytadan urinib koʻring',
};

interface Props {
  chatId: string;
  onClose: () => void;
}

/**
 * Jonli suhbat — telefonni quloqqa tutib gaplashadigan rejim.
 *
 * Aylanish: tinglash → matnga oʻgirish → javob → ovoz bilan oʻqish →
 * yana tinglash. Gap tugagach mikrofon oʻzi toʻxtaydi (sukunat boʻyicha),
 * shuning uchun tugmani qayta bosish shart emas.
 */
export function LiveVoice({ chatId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('tayyor');
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [hands, setHands] = useState(true);

  const listenRef = useRef<ListenHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Oyna yopilganda davom etayotgan aylanishni toʻxtatish uchun */
  const aliveRef = useRef(true);
  /** «Suhbat davom etsin» rejimi — javobdan keyin oʻzi tinglaydi */
  const handsRef = useRef(true);

  useEffect(() => {
    handsRef.current = hands;
  }, [hands]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      listenRef.current?.cancel();
      abortRef.current?.abort();
      void stopSpeaking();
    };
  }, []);

  /** Bitta aylanish: tinglaydi, javob oladi, oʻqib beradi. */
  const cycle = async () => {
    if (!aliveRef.current) return;
    await stopSpeaking();
    setHeard('');
    setReply('');
    setPhase('tinglayapman');

    const handle = await startListening({
      // Gap tugab 1.4 soniya jim boʻlsa — oʻzi toʻxtaydi.
      autoStopAfterSilence: 1400,
      onLevel: (value) => setLevel(value),
      onState: (state) => setPhase(state === 'tahlil' ? 'oʻylayapman' : 'tinglayapman'),
      onError: (message) => {
        listenRef.current = null;
        setLevel(0);
        if (!aliveRef.current) return;
        setPhase('xato');
        toast(message);
      },
      onFinal: (text) => {
        listenRef.current = null;
        setLevel(0);
        if (!aliveRef.current) return;
        setHeard(text);
        void answer(text);
      },
    });

    listenRef.current = handle;
    if (!handle && aliveRef.current) setPhase('xato');
  };

  /** Javobni oladi va ovoz bilan oʻqiydi. */
  const answer = async (text: string) => {
    setPhase('oʻylayapman');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await sendMessage(
        chatId,
        text,
        [],
        controller.signal,
        // Jonli suhbatda uzun matn emas, gapiriladigan javob kerak.
        'Bu JONLI OVOZLI suhbat. Javobing ovoz bilan oʻqiladi, shuning uchun: ' +
          '2-4 jumla, oddiy soʻzlar, markdown belgilari, roʻyxat, jadval va kod YOZMA. ' +
          'Gapirayotgandek yoz. Uzun tushuntirish kerak boʻlsa — eng muhimini ayt va ' +
          '«batafsil aytaymi?» deb soʻra.',
      );
      if (!aliveRef.current) return;

      const clean = res.text.trim();
      setReply(clean);
      if (!clean) {
        setPhase('xato');
        return;
      }

      setPhase('javob');
      await speak(clean);
      if (!aliveRef.current) return;

      // Suhbat rejimida javobdan keyin oʻzi qayta tinglaydi.
      if (handsRef.current) void cycle();
      else setPhase('tayyor');
    } catch (err) {
      if (!aliveRef.current) return;
      setPhase('xato');
      toast(String((err as Error)?.message ?? err));
    } finally {
      abortRef.current = null;
    }
  };

  const tap = () => {
    if (phase === 'tinglayapman') {
      // Erta toʻxtatish — foydalanuvchi gapini tugatdi.
      void listenRef.current?.stop();
      return;
    }
    if (phase === 'javob') {
      void stopSpeaking();
      setPhase('tayyor');
      return;
    }
    if (phase === 'oʻylayapman') {
      abortRef.current?.abort();
      setPhase('tayyor');
      return;
    }
    void cycle();
  };

  // Suhbat uchun kamida bitta model ulangan boʻlishi kerak.
  useEffect(() => {
    if (!canChat()) {
      toast('Avval Sozlamalarda API kalit kiriting (Gemini yoki OpenRouter).');
      onClose();
    }
  }, [onClose]);

  const listening = phase === 'tinglayapman';
  const scale = 1 + Math.min(level * 1.6, 0.6);

  return (
    <div className="live-scrim">
      <div className="live">
        <div className="live-top">
          <button className="icon-btn" onClick={onClose} aria-label="Yopish">
            <Close />
          </button>
          <button
            className={hands ? 'chip on' : 'chip'}
            onClick={() => setHands((v) => !v)}
            title="Javobdan keyin oʻzi tinglashda davom etsin"
          >
            {hands ? '🔄 Suhbat rejimi' : '☝️ Bir martalik'}
          </button>
        </div>

        <div className="live-body">
          {heard && <div className="live-heard">«{heard}»</div>}
          {reply && <div className="live-reply">{reply}</div>}
          {!heard && !reply && (
            <div className="live-hint">
              Mikrofonni bosing va gapiring. Gapingiz tugagach oʻzi toʻxtaydi va
              Daho ovoz bilan javob beradi.
            </div>
          )}
        </div>

        <div className="live-controls">
          <div className={`live-status ${phase === 'xato' ? 'bad' : ''}`}>{PHASE_TEXT[phase]}</div>
          <button
            className={`live-mic ${listening ? 'on' : ''} ${phase === 'oʻylayapman' ? 'think' : ''}`}
            onClick={tap}
            aria-label="Mikrofon"
          >
            <span className="live-ring" style={{ transform: `scale(${scale})` }} />
            <Mic size={30} />
          </button>
          <div className="tiny">
            {listening ? 'toʻxtatish uchun bosing' : 'boshlash uchun bosing'}
          </div>
        </div>
      </div>
    </div>
  );
}
