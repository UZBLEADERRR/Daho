import { useMemo, useState } from 'react';
import { deleteCourse, generateLesson, markTopicDone } from '../../lib/creations';
import { jsonAny } from '../../lib/providers';
import { uid } from '../../lib/utils';
import { noteTask, startTask, stopFor, useTaskFor } from '../../lib/tasks';
import { setState, updateView, useStore } from '../../lib/store';
import type { Artifact, Course, CourseTopic } from '../../lib/types';
import { Back, Check, Play, Refresh, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast } from '../ui';

export function Courses({ onOpenArtifact }: { onOpenArtifact: (a: Artifact) => void }) {
  const courses = useStore((s) => s.courses);
  // Ochiq kurs store da — boshqa boʻlimga oʻtib qaytsangiz shu joyda qolasiz.
  const openId = useStore((s) => s.view.courseId);
  const [wizard, setWizard] = useState(false);

  const course = courses.find((c) => c.id === openId) ?? null;
  if (course) {
    return (
      <CourseDetail
        course={course}
        onBack={() => updateView({ courseId: null })}
        onOpenArtifact={onOpenArtifact}
      />
    );
  }

  return (
    <div className="scroll">
      <div className="pad">
        {/*
          * Kurs ochish shu yerda ham boʻlsin.
          * Ilgari faqat chat orqali ochilardi — odam boʻlimga kirib,
          * boʻsh roʻyxatni koʻrib, nima qilishni bilmasdi.
          */}
        <button className="btn wide" style={{ marginBottom: 12 }} onClick={() => setWizard(true)}>
          + Yangi kurs ochish
        </button>

        {courses.length === 0 ? (
          <Empty
            title="Kurs yoʻq"
            hint="Yuqoridagi tugmani bosing yoki chatda nimani oʻrganmoqchi ekaningizni yozing — masalan «IELTS 7.0 olmoqchiman»."
          />
        ) : (
          /*
           * Kartalar toʻri — kitoblar bilan bir xil koʻrinish.
           * Avval har bir kurs butun kenglikdagi qator edi va roʻyxat
           * uzun boʻlganda faqat surish qolardi.
           */
          <div className="card-grid">
            {courses.map((c) => {
              const done = c.topics.filter((t) => t.done).length;
              const pct = c.topics.length ? Math.round((done / c.topics.length) * 100) : 0;
              return (
                <button
                  className="cover-card"
                  key={c.id}
                  onClick={() => updateView({ courseId: c.id })}
                >
                  <div className="cover-art" style={{ aspectRatio: '4 / 3' }}>
                    <span>{pct === 100 ? '🏆' : '🎓'}</span>
                    <span className="cover-badge">{c.level}</span>
                  </div>
                  <div className="cover-body">
                    <div className="cover-title">{c.title}</div>
                    <div className="progress" style={{ marginTop: 6 }}>
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <div className="cover-sub">
                      {done} / {c.topics.length} mavzu · {pct}%
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {wizard && <CourseWizard onClose={() => setWizard(false)} />}
    </div>
  );
}

/* ---------- Yangi kurs ---------- */

const REJA_SCHEMA = {
  type: 'object',
  properties: {
    sarlavha: { type: 'string' },
    soha: { type: 'string' },
    daraja: { type: 'string' },
    mavzular: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nomi: { type: 'string' }, izoh: { type: 'string' } },
        required: ['nomi'],
      },
    },
  },
  required: ['sarlavha', 'mavzular'],
};

const DARAJALAR = ['boshlangʻich', 'oʻrta', 'yuqori'];

/**
 * Kurs sehrgari.
 *
 * Foydalanuvchi nimani oʻrganmoqchi ekanini yozadi, model mavzular
 * rejasini tuzadi. Dars matni bu yerda YOZILMAYDI — u har bir mavzu
 * ochilganda talab boʻyicha tayyorlanadi, aks holda bir bosishda
 * oʻnlab dars uchun token sarflanardi.
 */
function CourseWizard({ onClose }: { onClose: () => void }) {
  const [goal, setGoal] = useState('');
  const [level, setLevel] = useState(DARAJALAR[0]);
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState(false);

  const build = async () => {
    if (goal.trim().length < 5) {
      toast('Nimani oʻrganmoqchisiz — biroz batafsilroq yozing');
      return;
    }
    setBusy(true);
    try {
      const res = await jsonAny<{
        sarlavha: string;
        soha?: string;
        daraja?: string;
        mavzular: Array<{ nomi: string; izoh?: string }>;
      }>(
        `Foydalanuvchi shuni oʻrganmoqchi: «${goal.trim()}».
Daraja: ${level}. Taxminan ${count} ta mavzudan iborat kurs rejasini tuz.

Qoidalar:
- Hammasi oʻzbek tilida.
- Mavzular OSONDAN QIYINGA qarab tartiblansin, biri ikkinchisiga tayansin.
- Har bir mavzuga bir gaplik izoh yoz: nima oʻrganiladi.
- Umumiy gap emas, aniq mavzu nomi ber.`,
        REJA_SCHEMA,
      );

      const topics: CourseTopic[] = (res.mavzular ?? []).slice(0, 60).map((t) => ({
        id: uid('ct_'),
        title: String(t.nomi ?? 'Mavzu'),
        summary: String(t.izoh ?? ''),
        done: false,
      }));

      if (!topics.length) {
        toast('Reja tuzilmadi — soʻrovni boshqacharoq yozib koʻring');
        return;
      }

      const course: Course = {
        id: uid('k_'),
        title: String(res.sarlavha || goal.trim()),
        field: String(res.soha || res.sarlavha || 'Umumiy'),
        goal: goal.trim(),
        level: String(res.daraja || level),
        topics,
        createdAt: Date.now(),
      };
      setState((s) => ({ courses: [course, ...s.courses] }));
      onClose();
      updateView({ courseId: course.id });
      toast(`Kurs ochildi — ${topics.length} ta mavzu`);
    } catch (err) {
      toast(`Reja tuzilmadi: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Yangi kurs" onClose={onClose}>
      <div className="field">
        <label>Nimani oʻrganmoqchisiz?</label>
        <textarea
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Masalan: noldan Python oʻrganib, oddiy bot yozmoqchiman"
        />
      </div>

      <div className="field">
        <label>Daraja</label>
        <div className="seg">
          {DARAJALAR.map((d) => (
            <button key={d} className={level === d ? 'on' : ''} onClick={() => setLevel(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Mavzular soni: {count}</label>
        <input
          type="range"
          min={5}
          max={40}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </div>

      <button className="btn wide" disabled={busy} onClick={() => void build()}>
        {busy ? 'Reja tuzilmoqda…' : 'Kurs ochish'}
      </button>

      <div className="tiny" style={{ marginTop: 10, opacity: 0.75 }}>
        Hozir faqat reja tuziladi. Har bir darsning matni siz mavzuni ochganingizda
        tayyorlanadi — shunda token behuda sarflanmaydi.
      </div>
    </Sheet>
  );
}

function CourseDetail({
  course,
  onBack,
  onOpenArtifact,
}: {
  course: Course;
  onBack: () => void;
  onOpenArtifact: (a: Artifact) => void;
}) {
  const artifacts = useStore((s) => s.artifacts);
  // Dars tayyorlash — global vazifa reyestrida. Boshqa boʻlimga oʻtsangiz
  // ham davom etadi va qaytganingizda holati joyida turadi.
  const running = useTaskFor('dars', course.id);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<CourseTopic | null>(null);
  const busyTopic = running ? running.targetId : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? course.topics.filter((t) => t.title.toLowerCase().includes(q)) : course.topics;
  }, [course.topics, query]);

  const done = course.topics.filter((t) => t.done).length;

  const openLesson = async (topic: CourseTopic, regenerate = false) => {
    setSheet(null);
    const existing = topic.lessonArtifactId
      ? artifacts.find((a) => a.id === topic.lessonArtifactId)
      : undefined;

    if (existing && !regenerate) {
      onOpenArtifact(existing);
      return;
    }
    if (running) {
      toast('Bir dars tayyorlanmoqda — tugashini kuting.');
      return;
    }

    await startTask(
      { kind: 'dars', targetId: course.id, title: topic.title, note: 'boshlandi' },
      async (signal, taskId) => {
        try {
          const artifact = await generateLesson(
            course,
            topic,
            (chars) => noteTask(taskId, `${chars} belgi yozildi`),
            signal,
          );
          onOpenArtifact(artifact);
        } catch (err) {
          if ((err as Error)?.name !== 'AbortError') {
            toast(String((err as Error)?.message ?? err));
          }
        }
      },
    );
  };

  return (
    <div className="scroll">
      <div className="course-head">
        <button className="icon-btn" onClick={onBack} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{course.title}</div>
          <div className="tiny">
            {done} / {course.topics.length} mavzu oʻrganilgan
          </div>
        </div>
      </div>

      <div className="pad">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Mavzu qidirish…"
          style={{ marginBottom: 12 }}
        />

        <Switch
          on={Boolean(course.illustrated)}
          onChange={(value) =>
            setState((s) => ({
              courses: s.courses.map((c) =>
                c.id === course.id ? { ...c, illustrated: value } : c,
              ),
            }))
          }
          label="Darslarga rasm chizilsin"
          hint="Har bir yangi dars uchun mavzuga mos rasm yasaladi. Rasm token sarflaydi, shuning uchun oʻzingiz yoqasiz."
        />

        {running && (
          <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
            <div className="between">
              <div style={{ fontSize: 14 }}>«{running.title}» tayyorlanmoqda…</div>
              <button className="btn mini ghost" onClick={() => stopFor('dars', course.id)}>
                Toʻxtatish
              </button>
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {running.note}
            </div>
            <div className="tiny" style={{ marginTop: 6, opacity: 0.7 }}>
              Boshqa boʻlimga oʻtsangiz ham tayyorlanish davom etadi.
            </div>
          </div>
        )}

        {visible.map((topic, i) => {
          const ready = Boolean(topic.lessonArtifactId);
          return (
            <div className="topic-row" key={topic.id}>
              <button
                className={topic.done ? 'check on' : 'check'}
                onClick={() => markTopicDone(course.id, topic.id, !topic.done)}
                aria-label="Belgilash"
              >
                <Check size={13} />
              </button>
              <button className="grow" style={{ textAlign: 'left' }} onClick={() => setSheet(topic)}>
                <div className={topic.done ? 'done-text' : ''} style={{ fontSize: 14.5 }}>
                  <span className="topic-num">{course.topics.indexOf(topic) + 1 || i + 1}.</span>{' '}
                  {topic.title}
                </div>
                {topic.summary && (
                  <div className="tiny" style={{ marginTop: 3 }}>
                    {topic.summary}
                  </div>
                )}
              </button>
              <button
                className="btn mini"
                disabled={Boolean(busyTopic)}
                onClick={() => void openLesson(topic)}
              >
                {ready ? <Play size={13} /> : '✨'}
              </button>
            </div>
          );
        })}

        <button
          className="btn ghost wide"
          style={{ marginTop: 16, color: 'var(--danger)' }}
          onClick={() => {
            if (window.confirm(`"${course.title}" kursi oʻchirilsinmi?`)) {
              deleteCourse(course.id);
              onBack();
            }
          }}
        >
          <Trash size={15} /> Kursni oʻchirish
        </button>
      </div>

      {sheet && (
        <Sheet title={sheet.title} onClose={() => setSheet(null)}>
          {sheet.summary && <p className="muted">{sheet.summary}</p>}
          <button className="btn wide" onClick={() => void openLesson(sheet)}>
            {sheet.lessonArtifactId ? (
              <>
                <Play size={15} /> Darsni ochish
              </>
            ) : (
              <>✨ Darsni tayyorlash</>
            )}
          </button>
          {sheet.lessonArtifactId && (
            <button
              className="btn ghost wide"
              style={{ marginTop: 8 }}
              onClick={() => void openLesson(sheet, true)}
            >
              <Refresh size={15} /> Darsni qaytadan yasash
            </button>
          )}
          <button
            className="btn ghost wide"
            style={{ marginTop: 8 }}
            onClick={() => {
              markTopicDone(course.id, sheet.id, !sheet.done);
              setSheet(null);
            }}
          >
            {sheet.done ? 'Oʻrganilmagan deb belgilash' : 'Oʻrganildi deb belgilash'}
          </button>
        </Sheet>
      )}
    </div>
  );
}
