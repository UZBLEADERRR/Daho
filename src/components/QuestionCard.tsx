import { useState } from 'react';
import { answerQuestion, type PendingQuestion } from '../lib/ask';
import { Send } from './Icons';

/**
 * Agent aniqlik soʻraganda chiqadigan karta: tayyor variantlar va
 * erkin javob maydoni. Javob berilmaguncha ish shu yerda kutib turadi.
 */
export function QuestionCard({ question }: { question: PendingQuestion }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [free, setFree] = useState('');

  const send = (value: string) => {
    const answer = value.trim();
    if (!answer) return;
    answerQuestion(question.id, answer);
  };

  const toggle = (option: string) => {
    if (!question.multi) {
      send(option);
      return;
    }
    setPicked((prev) =>
      prev.includes(option) ? prev.filter((p) => p !== option) : [...prev, option],
    );
  };

  return (
    <div className="ask-card">
      <div className="ask-head">
        <span className="ask-icon">❓</span>
        <div className="grow">{question.question}</div>
      </div>

      {question.options.length > 0 && (
        <div className="ask-options">
          {question.options.map((option) => (
            <button
              key={option}
              className={picked.includes(option) ? 'ask-option on' : 'ask-option'}
              onClick={() => toggle(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {question.multi && picked.length > 0 && (
        <button className="btn wide mini" onClick={() => send(picked.join(', '))}>
          Tanlanganini yuborish ({picked.length})
        </button>
      )}

      <div className="ask-free">
        <input
          value={free}
          onChange={(e) => setFree(e.target.value)}
          placeholder="yoki oʻzingiz yozing…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(free);
          }}
        />
        <button
          className="round-btn primary"
          disabled={!free.trim()}
          onClick={() => send(free)}
          aria-label="Javob yuborish"
        >
          <Send size={17} />
        </button>
      </div>
    </div>
  );
}
