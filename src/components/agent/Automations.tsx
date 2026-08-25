import { useState } from 'react';
import {
  createAutomation,
  deleteAutomation,
  describeDays,
  nextRunAt,
  patchAutomation,
  runAutomation,
} from '../../lib/automation';
import { ModelPickButton } from '../ModelPicker';
import { useStore } from '../../lib/store';
import { stopFor, useTasks } from '../../lib/tasks';
import type { Automation } from '../../lib/types';
import { Play, Stop, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast } from '../ui';

const DAY_NAMES = ['Du', 'Se', 'Cho', 'Pay', 'Ju', 'Sha', 'Yak'];

/**
 * Keyingi ishga tushish vaqti oʻzbekcha.
 * `toLocaleString('uz-UZ')` hafta kunini inglizcha qaytaradi, shuning
 * uchun kun nomini oʻzimiz yozamiz.
 */
function describeNext(at: number): string {
  const date = new Date(at);
  const time = date.toTimeString().slice(0, 5);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `bugun ${time}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `ertaga ${time}`;

  return `${DAY_NAMES[(date.getDay() + 6) % 7]} ${time}`;
}

const TEMPLATES = [
  {
    icon: '📰',
    title: 'Kunlik yangiliklar',
    prompt:
      'Bugungi eng muhim 5 ta yangilikni internetdan topib, har biriga 2 jumladan ' +
      'qisqacha izoh yozib ber. Manbalarni ham koʻrsat.',
    time: '08:00',
  },
  {
    icon: '📅',
    title: 'Kun rejasi',
    prompt:
      'Bugungi dars jadvalim va vazifalarimni koʻrib chiq, kunimni soatlab rejalashtirib ber. ' +
      'Eng muhim ishni birinchi qoʻy.',
    time: '07:30',
  },
  {
    icon: '🧠',
    title: 'Takrorlash',
    prompt:
      'Konspektlarimdan bittasini tanlab, undagi asosiy fikrlarni 5 ta savol-javob ' +
      'koʻrinishida takrorlab ber.',
    time: '21:00',
  },
  {
    icon: '📊',
    title: 'Kun yakuni',
    prompt:
      'Bugun nima qilganimni (vazifalar, ish vaqti) koʻrib chiqib, qisqa hisobot yoz: ' +
      'nima bajarildi, nima qoldi, ertaga nimadan boshlash kerak.',
    time: '22:00',
  },
];

export function Automations() {
  const items = useStore((s) => s.automations);
  const [editing, setEditing] = useState<Automation | 'yangi' | null>(null);
  const tasks = useTasks();

  return (
    <div className="scroll">
      <div className="pad">
        <button className="btn wide" style={{ marginBottom: 12 }} onClick={() => setEditing('yangi')}>
          + Yangi avtomatlashtirish
        </button>

        {items.length === 0 ? (
          <Empty
            title="Avtomatlashtirish yoʻq"
            hint="Har kuni belgilangan vaqtda oʻzi bajariladigan topshiriq qoʻshing — masalan har ertalab 8:00 da yangiliklar."
          />
        ) : (
          items.map((item) => {
            const running = tasks.find((t) => t.kind === 'avto' && t.targetId === item.id);
            const next = nextRunAt(item);
            return (
              <div className="card" key={item.id} style={{ marginBottom: 9 }}>
                <div className="between">
                  <button
                    className="grow"
                    style={{ textAlign: 'left', minWidth: 0 }}
                    onClick={() => setEditing(item)}
                  >
                    <div style={{ fontSize: 15.5, fontWeight: 580 }}>{item.title}</div>
                    <div className="tiny" style={{ marginTop: 3 }}>
                      ⏰ {item.time} · {describeDays(item.days)}
                      {item.target === 'kod' ? ' · Code' : ''}
                    </div>
                  </button>
                  <Switch
                    compact
                    on={item.enabled}
                    label={`${item.title} — yoqish`}
                    onChange={(on) => patchAutomation(item.id, { enabled: on })}
                  />
                </div>

                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  {item.prompt.slice(0, 120)}
                  {item.prompt.length > 120 ? '…' : ''}
                </div>

                {running ? (
                  <div className="tiny" style={{ marginTop: 8, color: 'var(--accent)' }}>
                    ⏳ {running.note}
                  </div>
                ) : (
                  <div className="tiny" style={{ marginTop: 8, opacity: 0.75 }}>
                    {item.lastRunAt
                      ? `Oxirgi: ${describeNext(item.lastRunAt)}${
                          item.lastOk === false ? ' — xato' : ''
                        }`
                      : 'Hali ishlamagan'}
                    {next ? ` · Keyingi: ${describeNext(next)}` : ''}
                  </div>
                )}

                <div className="row" style={{ marginTop: 10, gap: 8 }}>
                  {running ? (
                    <button className="btn mini" onClick={() => stopFor('avto', item.id)}>
                      <Stop size={13} /> Toʻxtatish
                    </button>
                  ) : (
                    <button className="btn mini" onClick={() => void runAutomation(item.id)}>
                      <Play size={13} /> Hozir ishlat
                    </button>
                  )}
                  <button
                    className="btn mini ghost"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => {
                      if (window.confirm(`"${item.title}" oʻchirilsinmi?`)) deleteAutomation(item.id);
                    }}
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}

        <div className="tiny" style={{ marginTop: 14, opacity: 0.65, lineHeight: 1.5 }}>
          Topshiriqlar ilova ochiq boʻlganda bajariladi. Belgilangan vaqtda ilova yopiq
          boʻlsa, keyingi ochilishda (12 soat ichida) oʻzi bajariladi.
        </div>
      </div>

      {editing && (
        <AutomationEditor
          item={editing === 'yangi' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AutomationEditor({ item, onClose }: { item: Automation | null; onClose: () => void }) {
  const projects = useStore((s) => s.code);
  const [title, setTitle] = useState(item?.title ?? '');
  const [prompt, setPrompt] = useState(item?.prompt ?? '');
  const [time, setTime] = useState(item?.time ?? '08:00');
  const [days, setDays] = useState<number[]>(item?.days ?? []);
  const [target, setTarget] = useState<'chat' | 'kod'>(item?.target ?? 'chat');
  const [projectId, setProjectId] = useState(item?.projectId ?? '');
  const [fresh, setFresh] = useState(item?.freshChat ?? true);
  const [model, setModel] = useState(item?.model ?? '');

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = () => {
    if (!prompt.trim()) {
      toast('Topshiriq matnini yozing');
      return;
    }
    const patch = {
      title: title.trim() || prompt.trim().slice(0, 30),
      prompt: prompt.trim(),
      time,
      days,
      target,
      projectId: target === 'kod' ? projectId : undefined,
      freshChat: fresh,
      model: model || undefined,
    };
    if (item) patchAutomation(item.id, patch);
    else createAutomation(patch);
    onClose();
  };

  return (
    <Sheet title={item ? 'Topshiriqni tahrirlash' : 'Yangi avtomatlashtirish'} onClose={onClose}>
      {!item && (
        <>
          <div className="tiny" style={{ marginBottom: 6, opacity: 0.7 }}>
            Tayyor namunalar
          </div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {TEMPLATES.map((t) => (
              <button
                key={t.title}
                className="chip"
                onClick={() => {
                  setTitle(t.title);
                  setPrompt(t.prompt);
                  setTime(t.time);
                }}
              >
                {t.icon} {t.title}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="field">
        <span>Nomi</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Masalan: Kunlik yangiliklar"
        />
      </label>

      <label className="field">
        <span>Topshiriq — Dahoga nima deyilsin</span>
        <textarea
          value={prompt}
          rows={5}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Bugungi eng muhim yangiliklarni topib, qisqacha yozib ber…"
        />
      </label>

      <label className="field">
        <span>Vaqti</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>

      <div className="field">
        <span>Kunlari {days.length === 0 && '(har kuni)'}</span>
        <div className="chips">
          {DAY_NAMES.map((name, i) => (
            <button
              key={name}
              className={days.includes(i) ? 'chip on' : 'chip'}
              onClick={() => toggleDay(i)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Qayerda bajarilsin</span>
        <div className="chips">
          <button className={target === 'chat' ? 'chip on' : 'chip'} onClick={() => setTarget('chat')}>
            💬 Chat
          </button>
          <button
            className={target === 'kod' ? 'chip on' : 'chip'}
            onClick={() => setTarget('kod')}
            disabled={!projects.length}
          >
            ⌨️ Code loyihasi
          </button>
        </div>
      </div>

      {target === 'kod' && (
        <label className="field">
          <span>Loyiha</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— tanlang —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="field">
        <span>Model</span>
        <ModelPickButton
          value={model}
          onChange={setModel}
          title="Topshiriq modeli"
          allowEmpty
          emptyLabel="Asosiy model"
        />
      </div>

      {target === 'chat' && (
        <Switch
          on={fresh}
          onChange={setFresh}
          label="Har safar yangi suhbat"
          hint="Oʻchirilsa hammasi bitta suhbatda toʻplanadi"
        />
      )}

      <button className="btn wide" style={{ marginTop: 14 }} onClick={save}>
        Saqlash
      </button>
    </Sheet>
  );
}
