import { useState } from 'react';
import { deleteMemory, addMemory, clearMemories, updateMemory } from '../lib/memory';
import { updateSettings, useStore } from '../lib/store';
import { byModel, clearUsage, money, totals } from '../lib/usage';
import { Trash } from './Icons';
import { Sheet, Switch, toast } from './ui';

/**
 * Xarajat va xotira boʻlimi.
 *
 * Xarajat: OpenRouter kabi provayderlar har javobda nechta token
 * sarflanganini aytadi — model narxiga koʻpaytirib haqiqiy pulni koʻrsatamiz.
 * Gemini bepul rejada token qaytarmaydi, shuning uchun u yerda faqat
 * soʻrovlar soni koʻrinadi.
 */
export function UsagePanel() {
  const [detail, setDetail] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const settings = useStore((s) => s.settings);
  const memories = useStore((s) => s.memories ?? []);

  const t = totals();

  return (
    <>
      <div className="section-label" style={{ padding: '14px 0 6px' }}>
        Xarajat
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div className="usage-row">
          <span>
            <div className="usage-num">{money(t.today.cost)}</div>
            <div className="tiny">bugun · {t.today.requests} soʻrov</div>
          </span>
          <span>
            <div className="usage-num">{money(t.week.cost)}</div>
            <div className="tiny">7 kun · {t.week.requests} soʻrov</div>
          </span>
          <span>
            <div className="usage-num">{money(t.all.cost)}</div>
            <div className="tiny">jami · {t.all.requests} soʻrov</div>
          </span>
        </div>
        <div className="tiny" style={{ marginTop: 8, opacity: 0.7 }}>
          Narx model roʻyxatidagi tarifdan hisoblanadi. Gemini bepul rejada token
          qaytarmaydi — u yerda faqat soʻrovlar sanaladi.
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <button className="btn ghost grow" onClick={() => setDetail(true)}>
          📊 Model boʻyicha
        </button>
        <button
          className="btn ghost grow"
          onClick={() => {
            if (window.confirm('Xarajat tarixi tozalansinmi?')) {
              clearUsage();
              toast('Tozalandi');
            }
          }}
        >
          <Trash size={14} /> Tozalash
        </button>
      </div>

      <div className="section-label" style={{ padding: '14px 0 6px' }}>
        Xotira
      </div>

      <div className="field">
        <Switch
          on={settings.memoryEnabled !== false}
          onChange={(on) => updateSettings({ memoryEnabled: on })}
          label="Meni eslab qolsin"
          hint="Suhbatlardan doimiy faktlarni oʻzi yozib boradi"
        />
      </div>

      <button className="btn ghost wide" onClick={() => setMemOpen(true)}>
        🧠 Eslab qolganlari ({memories.length})
      </button>

      {detail && <ModelCosts onClose={() => setDetail(false)} />}
      {memOpen && <MemorySheet onClose={() => setMemOpen(false)} />}
    </>
  );
}

function ModelCosts({ onClose }: { onClose: () => void }) {
  const rows = byModel(30);

  return (
    <Sheet title="Model boʻyicha sarf (30 kun)" onClose={onClose}>
      {rows.length === 0 ? (
        <p className="tiny">Hali sarf yozilmagan.</p>
      ) : (
        rows.map((r) => (
          <div className="card" key={r.model} style={{ marginBottom: 8 }}>
            <div className="between">
              <b style={{ fontSize: 14, minWidth: 0, wordBreak: 'break-word' }}>{r.label}</b>
              <span className="usage-num" style={{ fontSize: 15 }}>
                {money(r.cost)}
              </span>
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {r.requests} soʻrov · jami {(r.inTokens / 1000).toFixed(1)}k kirish ·{' '}
              {(r.outTokens / 1000).toFixed(1)}k chiqish
            </div>
            {/*
              «31.9k kirish» degan raqam bitta xabarga tegishli deb
              tushunilardi. Aslida u 30 kunlik JAMI. Bitta soʻrovga
              qancha tushgani muhimroq — shuni ham koʻrsatamiz.
            */}
            <div className="tiny">
              bitta soʻrovga ≈ {Math.round(r.inTokens / Math.max(1, r.requests))} kirish /{' '}
              {Math.round(r.outTokens / Math.max(1, r.requests))} chiqish token
            </div>
          </div>
        ))
      )}
    </Sheet>
  );
}

function MemorySheet({ onClose }: { onClose: () => void }) {
  const memories = useStore((s) => s.memories ?? []);
  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  return (
    <Sheet title="Daho sizni qanday eslaydi" onClose={onClose}>
      <div className="tiny" style={{ marginBottom: 10, lineHeight: 1.5 }}>
        Bu faktlar har bir yangi suhbatga qoʻshiladi. Notoʻgʻrisini tuzating yoki
        oʻchiring — xato fakt hamma javobni buzadi.
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input
          className="grow"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Masalan: QoraQosh brendi egasiman"
        />
        <button
          className="btn mini"
          onClick={() => {
            if (addMemory(draft)) {
              setDraft('');
              toast('Qoʻshildi');
            } else toast('Boʻsh yoki takror');
          }}
        >
          +
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="tiny">
          Hali hech narsa eslab qolinmagan. Suhbatlashsangiz oʻzi toʻplanadi.
        </p>
      ) : (
        memories.map((m) => (
          <div className="file-row" key={m.id}>
            {editId === m.id ? (
              <>
                <input
                  className="grow"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                />
                <button
                  className="btn mini"
                  onClick={() => {
                    updateMemory(m.id, editText);
                    setEditId(null);
                  }}
                >
                  ✓
                </button>
              </>
            ) : (
              <>
                <button
                  className="grow"
                  style={{ textAlign: 'left' }}
                  onClick={() => {
                    setEditId(m.id);
                    setEditText(m.text);
                  }}
                >
                  <div style={{ fontSize: 13.5 }}>{m.text}</div>
                  <div className="tiny">{m.source === 'suhbat' ? 'suhbatdan' : 'qoʻlda'}</div>
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 30, height: 30 }}
                  onClick={() => deleteMemory(m.id)}
                  aria-label="Oʻchirish"
                >
                  <Trash size={14} />
                </button>
              </>
            )}
          </div>
        ))
      )}

      {memories.length > 0 && (
        <button
          className="btn ghost wide"
          style={{ marginTop: 12, color: 'var(--danger)' }}
          onClick={() => {
            if (window.confirm('Hamma eslab qolinganlar oʻchirilsinmi?')) {
              clearMemories();
              toast('Xotira tozalandi');
            }
          }}
        >
          <Trash size={15} /> Hammasini oʻchirish
        </button>
      )}
    </Sheet>
  );
}
