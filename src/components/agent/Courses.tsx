import { useMemo, useState } from 'react';
import { deleteCourse, generateLesson, markTopicDone } from '../../lib/creations';
import { setState } from '../../lib/store';
import { useStore } from '../../lib/store';
import type { Artifact, Course, CourseTopic } from '../../lib/types';
import { Back, Check, Play, Refresh, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast } from '../ui';

export function Courses({ onOpenArtifact }: { onOpenArtifact: (a: Artifact) => void }) {
  const courses = useStore((s) => s.courses);
  const [openId, setOpenId] = useState<string | null>(null);

  const course = courses.find((c) => c.id === openId) ?? null;
  if (course) return <CourseDetail course={course} onBack={() => setOpenId(null)} onOpenArtifact={onOpenArtifact} />;

  return (
    <div className="scroll">
      <div className="pad">
        {courses.length === 0 ? (
          <Empty
            title="Kurs yoʻq"
            hint="Chatda + tugmasidan «Kurs ochish» ni tanlang va nimani oʻrganmoqchi ekaningizni yozing — masalan «IELTS 7.0 olmoqchiman»."
          />
        ) : (
          courses.map((c) => {
            const done = c.topics.filter((t) => t.done).length;
            const pct = Math.round((done / c.topics.length) * 100);
            return (
              <button
                className="card"
                key={c.id}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 9 }}
                onClick={() => setOpenId(c.id)}
              >
                <div className="between">
                  <div className="grow" style={{ fontSize: 16, fontWeight: 580 }}>
                    {c.title}
                  </div>
                  <span className="chip">{c.level}</span>
                </div>
                {c.goal && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    {c.goal}
                  </div>
                )}
                <div className="progress">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="tiny" style={{ marginTop: 6 }}>
                  {done} / {c.topics.length} mavzu · {pct}%
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
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
  const [busyTopic, setBusyTopic] = useState<string | null>(null);
  const [chars, setChars] = useState(0);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<CourseTopic | null>(null);

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
    if (busyTopic) return;

    setBusyTopic(topic.id);
    setChars(0);
    try {
      const artifact = await generateLesson(course, topic, setChars);
      onOpenArtifact(artifact);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusyTopic(null);
    }
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

        {busyTopic && (
          <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
            <div style={{ fontSize: 14 }}>Dars tayyorlanmoqda…</div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {chars > 0 ? `${chars} belgi yozildi` : 'boshlandi'}
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
