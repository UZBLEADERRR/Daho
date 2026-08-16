import type { ToolCallRecord } from '../lib/types';
import { Check, Close } from './Icons';

export function ToolLine({ call }: { call: ToolCallRecord }) {
  return (
    <div className={call.ok ? 'tool-line' : 'tool-line bad'}>
      {call.ok ? <Check size={13} /> : <Close size={13} />}
      <span className="grow">{call.summary}</span>
    </div>
  );
}

export interface Block {
  /** Shu boʻlakda yozilgan matn */
  text: string;
  /** Shu matndan keyin bajarilgan ishlar */
  calls: ToolCallRecord[];
}

/**
 * Javob matnini vosita chaqiruvlari bilan TARTIBDA aralashtiradi: agent avval
 * nima qilishini yozadi, soʻng oʻsha ish koʻrinadi — chatdagidek.
 * Eski xabarlarda `at` boʻlmaydi, ular avvalgidek eng boshida chiqadi.
 */
export function splitByTools(text: string, calls: ToolCallRecord[] = []): Block[] {
  if (!calls.length) return [{ text, calls: [] }];

  const legacy = calls.filter((c) => typeof c.at !== 'number');
  const timed = calls
    .filter((c) => typeof c.at === 'number')
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));

  const blocks: Block[] = [];
  let cursor = 0;

  for (const call of timed) {
    const at = Math.max(cursor, Math.min(text.length, call.at ?? 0));
    if (at > cursor) {
      blocks.push({ text: text.slice(cursor, at), calls: [] });
      cursor = at;
    }
    const last = blocks[blocks.length - 1];
    if (last) last.calls.push(call);
    else blocks.push({ text: '', calls: [call] });
  }

  if (cursor < text.length || !blocks.length) {
    blocks.push({ text: text.slice(cursor), calls: [] });
  }
  if (legacy.length) blocks.unshift({ text: '', calls: legacy });
  return balance(blocks);
}

/**
 * Kod bloki (```) ikki boʻlakka boʻlinib qolmasin — yopilmagan boʻlakni
 * keyingisi bilan qoʻshib yuboramiz.
 */
function balance(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    const open = prev && (prev.text.match(/```/g)?.length ?? 0) % 2 === 1;
    if (open) {
      prev.text += block.text;
      prev.calls.push(...block.calls);
    } else {
      out.push({ text: block.text, calls: [...block.calls] });
    }
  }
  return out;
}
