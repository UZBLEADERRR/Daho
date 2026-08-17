import { useState } from 'react';
import {
  askBookQuestions,
  bookProgress,
  bookToMarkdown,
  createBook,
  deleteBook,
  makeCover,
  rewriteChapter,
  writeBook,
  type BookQuestion,
} from '../../lib/book';
import { exportDocument, type DocFormat } from '../../lib/exporter';
import { updateView, useStore } from '../../lib/store';
import { stopFor, useTaskFor } from '../../lib/tasks';
import type { Artifact, Book, BookChapter } from '../../lib/types';
import { Back, Download, Play, Refresh, Stop, Trash } from '../Icons';
import { Empty, Sheet, Switch, toast } from '../ui';

const STAGE_TEXT: Record<Book['stage'], string> = {
  soʻrov: 'savollar kutilmoqda',
  reja: 'reja tuzilmoqda',
  muqova: 'muqova chizilmoqda',
  yozilmoqda: 'boblar yozilmoqda',
  tayyor: 'tayyor',
  xato: 'xato',
};

export function Books({ onOpenArtifact }: { onOpenArtifact: (a: Artifact) => void }) {
  const books = useStore((s) => s.books);
  // Ochiq kitob store da saqlanadi — boʻlim almashsangiz ham shu joyda qolasiz.
  const openId = useStore((s) => s.view.bookId);
  const [wizard, setWizard] = useState(false);

  const book = books.find((b) => b.id === openId) ?? null;
  if (book) {
    return (
      <BookDetail
        book={book}
        onBack={() => updateView({ bookId: null })}
        onOpenArtifact={onOpenArtifact}
      />
    );
  }

  return (
    <div className="scroll">
      <div className="pad">
        <button className="btn wide" style={{ marginBottom: 12 }} onClick={() => setWizard(true)}>
          + Yangi kitob yozdirish
        </button>

        {books.length === 0 ? (
          <Empty
            title="Kitob yoʻq"
            hint="Yuqoridagi tugmani bosing yoki chatda «kitob yozmoqchiman» deng. Daho savollar beradi, rejasini tuzadi, muqova chizadi va boblarni bittalab yozadi."
          />
        ) : (
          books.map((b) => <BookCard key={b.id} book={b} onOpen={() => updateView({ bookId: b.id })} />)
        )}
      </div>

      {wizard && <BookWizard onClose={() => setWizard(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Yangi kitob — savol-javob                                          */
/* ------------------------------------------------------------------ */

/**
 * Kitob boshlash sehrgari. Foydalanuvchi gʻoyasini yozadi, Daho unga qarab
 * aniqlovchi savollar tuzadi (tayyor variantlar bilan — telefonda yozish
 * qiyin), javoblar toʻplangach yozish boshlanadi.
 */
function BookWizard({ onClose }: { onClose: () => void }) {
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<BookQuestion[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [step, setStep] = useState(0);
  const [chapters, setChapters] = useState(12);
  const [words, setWords] = useState(1200);
  const [images, setImages] = useState(true);

  const ask = async () => {
    if (idea.trim().length < 8) {
      toast('Kitob haqida biroz batafsilroq yozing');
      return;
    }
    setBusy(true);
    try {
      const list = await askBookQuestions(idea.trim());
      setQuestions(list);
      setAnswers(new Array(list.length).fill(''));
    } catch (err) {
      // Savollar chiqmasa ham kitob yozilaveradi — toʻxtatib qoʻymaymiz.
      toast(`Savollar tuzilmadi (${String((err as Error)?.message ?? err)}) — toʻgʻridan-toʻgʻri boshlaymiz`);
      setQuestions([]);
      setAnswers([]);
    } finally {
      setBusy(false);
    }
  };

  const answer = (value: string) => {
    const next = [...answers];
    next[step] = value;
    setAnswers(next);
    setCustom('');
    setStep((s) => s + 1);
  };

  const start = () => {
    const summary = (questions ?? [])
      .map((q, i) => (answers[i] ? `${q.question} → ${answers[i]}` : ''))
      .filter(Boolean)
      .join('\n');

    const book = createBook({
      request: summary ? `${idea.trim()}\n\nAniqlashtirilgan javoblar:\n${summary}` : idea.trim(),
      wordsPerChapter: words,
      withImages: images,
    });
    void writeBook(book.id, { chapterCount: chapters, answers: summary });
    updateView({ bookId: book.id });
    onClose();
  };

  // 1-bosqich: gʻoya
  if (!questions) {
    return (
      <Sheet title="Yangi kitob" onClose={onClose}>
        <label className="field">
          <span>Qanday kitob yozdirmoqchisiz?</span>
          <textarea
            autoFocus
            rows={5}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Masalan: Samarqandda yashovchi yosh dasturchi haqida qissa — u eski qoʻlyozmadan sirli algoritm topib oladi…"
          />
        </label>
        <div className="tiny" style={{ marginBottom: 12 }}>
          Qancha koʻp aytsangiz, kitob shuncha sizniki boʻladi. Qolganini Daho soʻraydi.
        </div>
        <button className="btn wide" disabled={busy} onClick={() => void ask()}>
          {busy ? 'Savollar tayyorlanmoqda…' : 'Davom etish'}
        </button>
      </Sheet>
    );
  }

  // 2-bosqich: savollar
  if (step < questions.length) {
    const q = questions[step];
    return (
      <Sheet title={`Savol ${step + 1}/${questions.length}`} onClose={onClose}>
        <div style={{ fontSize: 16, marginBottom: 14 }}>{q.question}</div>
        {q.options.map((option) => (
          <button key={option} className="action-row" onClick={() => answer(option)}>
            <span className="action-icon">•</span>
            <span className="grow">
              <b>{option}</b>
            </span>
          </button>
        ))}
        <label className="field" style={{ marginTop: 12 }}>
          <span>Yoki oʻzingiz yozing</span>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Erkin javob…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) answer(custom.trim());
            }}
          />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost grow" onClick={() => answer('')}>
            Oʻtkazib yuborish
          </button>
          <button className="btn grow" disabled={!custom.trim()} onClick={() => answer(custom.trim())}>
            Keyingisi
          </button>
        </div>
      </Sheet>
    );
  }

  // 3-bosqich: hajm
  return (
    <Sheet title="Kitob hajmi" onClose={onClose}>
      <div className="field">
        <label>Boblar soni: {chapters}</label>
        <input
          type="range"
          min={3}
          max={40}
          value={chapters}
          onChange={(e) => setChapters(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label>Har bobda taxminan: {words.toLocaleString('uz-UZ')} soʻz</label>
        <input
          type="range"
          min={400}
          max={3000}
          step={100}
          value={words}
          onChange={(e) => setWords(Number(e.target.value))}
        />
      </div>
      <Switch
        on={images}
        onChange={setImages}
        label="Rasmlar bilan"
        hint="Muqova va har bobga bir uslubdagi illyustratsiya"
      />
      <div className="tiny" style={{ margin: '12px 0' }}>
        Jami taxminan {(chapters * words).toLocaleString('uz-UZ')} soʻz. Yozish fonda
        davom etadi — boshqa boʻlimga oʻtsangiz ham toʻxtamaydi.
      </div>
      <button className="btn wide" onClick={start}>
        📚 Yozishni boshlash
      </button>
    </Sheet>
  );
}

function BookCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const cover = useStore((s) => s.artifacts.find((a) => a.id === book.coverArtifactId));
  const running = useTaskFor('kitob', book.id);
  const { done, total, words } = bookProgress(book);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <button
      className="card book-card"
      style={{ display: 'flex', width: '100%', textAlign: 'left', marginBottom: 9, gap: 12 }}
      onClick={onOpen}
    >
      <div className="book-cover">
        {cover ? (
          <img src={`data:${cover.mimeType ?? 'image/png'};base64,${cover.content}`} alt="" />
        ) : (
          <span>📖</span>
        )}
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 580 }}>{book.title}</div>
        {book.subtitle && (
          <div className="muted" style={{ marginTop: 2 }}>
            {book.subtitle}
          </div>
        )}
        <div className="progress">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="tiny" style={{ marginTop: 6 }}>
          {running ? (
            <span style={{ color: 'var(--accent)' }}>⏳ {running.note}</span>
          ) : (
            <>
              {done} / {total} bob · {words.toLocaleString('uz-UZ')} soʻz ·{' '}
              {STAGE_TEXT[book.stage]}
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function BookDetail({
  book,
  onBack,
  onOpenArtifact,
}: {
  book: Book;
  onBack: () => void;
  onOpenArtifact: (a: Artifact) => void;
}) {
  const artifacts = useStore((s) => s.artifacts);
  const running = useTaskFor('kitob', book.id);
  const [sheet, setSheet] = useState<BookChapter | null>(null);
  const [reading, setReading] = useState<BookChapter | null>(null);
  const [exportOpen, setExport] = useState(false);

  const cover = artifacts.find((a) => a.id === book.coverArtifactId);
  const { done, total, words } = bookProgress(book);

  const download = async (format: DocFormat) => {
    setExport(false);
    try {
      toast(await exportDocument(bookToMarkdown(book), format, book.title));
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    }
  };

  if (reading) {
    return (
      <ChapterReader
        book={book}
        chapter={reading}
        onBack={() => setReading(null)}
        onOpenArtifact={onOpenArtifact}
      />
    );
  }

  return (
    <div className="scroll">
      <div className="course-head">
        <button className="icon-btn" onClick={onBack} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{book.title}</div>
          <div className="tiny">
            {done} / {total} bob · {words.toLocaleString('uz-UZ')} soʻz
          </div>
        </div>
        {running ? (
          <button className="icon-btn" onClick={() => stopFor('kitob', book.id)} aria-label="Toʻxtatish">
            <Stop size={16} />
          </button>
        ) : (
          <button className="icon-btn" onClick={() => setExport(true)} aria-label="Yuklab olish">
            <Download />
          </button>
        )}
      </div>

      <div className="pad">
        {cover && (
          <button
            className="book-hero"
            onClick={() => onOpenArtifact(cover)}
            aria-label="Muqovani ochish"
          >
            <img src={`data:${cover.mimeType ?? 'image/png'};base64,${cover.content}`} alt="" />
          </button>
        )}

        {book.error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 12 }}>
            <div style={{ fontSize: 14 }}>⚠️ {book.error}</div>
            <button
              className="btn wide"
              style={{ marginTop: 10 }}
              onClick={() => void writeBook(book.id)}
            >
              <Refresh size={15} /> Davom ettirish
            </button>
          </div>
        )}

        {running && (
          <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
            <div style={{ fontSize: 14 }}>Kitob yozilmoqda…</div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {running.note}
            </div>
            <div className="tiny" style={{ marginTop: 6, opacity: 0.7 }}>
              Boshqa boʻlimga oʻtsangiz ham yozish davom etadi.
            </div>
          </div>
        )}

        {!running && book.stage !== 'tayyor' && !book.error && (
          <button className="btn wide" style={{ marginBottom: 12 }} onClick={() => void writeBook(book.id)}>
            <Play size={15} /> {done ? 'Davom ettirish' : 'Yozishni boshlash'}
          </button>
        )}

        {!!book.bible.premise && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="tiny" style={{ marginBottom: 4, opacity: 0.7 }}>
              Gʻoya
            </div>
            <div style={{ fontSize: 14 }}>{book.bible.premise}</div>
            {!!book.bible.cast.length && (
              <>
                <div className="tiny" style={{ margin: '10px 0 4px', opacity: 0.7 }}>
                  Qahramonlar
                </div>
                {book.bible.cast.map((c) => (
                  <div key={c.name} className="tiny" style={{ marginBottom: 3 }}>
                    <b>{c.name}</b> — {c.detail}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {book.chapters.map((c) => (
          <div className="topic-row" key={c.id}>
            <span className={c.done ? 'ch-num done' : 'ch-num'}>{c.number}</span>
            <button
              className="grow"
              style={{ textAlign: 'left' }}
              onClick={() => (c.done ? setReading(c) : setSheet(c))}
            >
              <div style={{ fontSize: 14.5 }}>{c.title}</div>
              <div className="tiny" style={{ marginTop: 3 }}>
                {c.done ? `${c.words.toLocaleString('uz-UZ')} soʻz` : c.brief}
              </div>
            </button>
            {c.done && (
              <button className="btn mini" onClick={() => setReading(c)}>
                <Play size={13} />
              </button>
            )}
          </div>
        ))}

        {!book.coverArtifactId && !running && (
          <button
            className="btn ghost wide"
            style={{ marginTop: 14 }}
            onClick={() => void makeCover(book.id).then(() => toast('Muqova tayyor'))}
          >
            🎨 Muqova chizish
          </button>
        )}

        <button
          className="btn ghost wide"
          style={{ marginTop: 10, color: 'var(--danger)' }}
          onClick={() => {
            if (window.confirm(`"${book.title}" kitobi oʻchirilsinmi?`)) {
              deleteBook(book.id);
              onBack();
            }
          }}
        >
          <Trash size={15} /> Kitobni oʻchirish
        </button>
      </div>

      {exportOpen && (
        <Sheet title="Kitobni yuklab olish" onClose={() => setExport(false)}>
          <button className="action-row" onClick={() => void download('docx')}>
            <span className="action-icon">📄</span>
            <span className="grow">
              <b>Word (.docx)</b>
              <div className="tiny">Tahrirlash va chop etish uchun</div>
            </span>
          </button>
          <button className="action-row" onClick={() => void download('pdf')}>
            <span className="action-icon">📕</span>
            <span className="grow">
              <b>PDF</b>
              <div className="tiny">Oʻqish va ulashish uchun</div>
            </span>
          </button>
          <button className="action-row" onClick={() => void download('md')}>
            <span className="action-icon">📝</span>
            <span className="grow">
              <b>Matn (.md)</b>
              <div className="tiny">Boshqa dasturga koʻchirish uchun</div>
            </span>
          </button>
        </Sheet>
      )}

      {sheet && (
        <Sheet title={`${sheet.number}. ${sheet.title}`} onClose={() => setSheet(null)}>
          <p className="muted">{sheet.brief}</p>
          {sheet.done ? (
            <button
              className="btn wide"
              onClick={() => {
                setReading(sheet);
                setSheet(null);
              }}
            >
              <Play size={15} /> Oʻqish
            </button>
          ) : (
            <p className="tiny">Bu bob hali yozilmagan.</p>
          )}
          <button
            className="btn ghost wide"
            style={{ marginTop: 8 }}
            disabled={Boolean(running)}
            onClick={() => {
              void rewriteChapter(book.id, sheet.id);
              setSheet(null);
            }}
          >
            <Refresh size={15} /> Qaytadan yozish
          </button>
        </Sheet>
      )}
    </div>
  );
}

function ChapterReader({
  book,
  chapter,
  onBack,
  onOpenArtifact,
}: {
  book: Book;
  chapter: BookChapter;
  onBack: () => void;
  onOpenArtifact: (a: Artifact) => void;
}) {
  const image = useStore((s) => s.artifacts.find((a) => a.id === chapter.imageArtifactId));
  // Store dan yangilangan nusxani olamiz — qayta yozilsa matn oʻzi yangilanadi.
  const live = useStore(
    (s) => s.books.find((b) => b.id === book.id)?.chapters.find((c) => c.id === chapter.id),
  );
  const text = live?.text ?? chapter.text;

  return (
    <div className="scroll">
      <div className="course-head">
        <button className="icon-btn" onClick={onBack} aria-label="Orqaga">
          <Back />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{chapter.title}</div>
          <div className="tiny">
            {chapter.number}-bob · {book.title}
          </div>
        </div>
      </div>

      <div className="pad reader">
        {image && (
          <button className="book-illus" onClick={() => onOpenArtifact(image)}>
            <img src={`data:${image.mimeType ?? 'image/png'};base64,${image.content}`} alt="" />
          </button>
        )}
        {text.split('\n').map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} style={{ height: 8 }} />;
          if (trimmed.startsWith('###')) return <h4 key={i}>{trimmed.replace(/^#+\s*/, '')}</h4>;
          if (trimmed.startsWith('##')) return <h3 key={i}>{trimmed.replace(/^#+\s*/, '')}</h3>;
          return <p key={i}>{trimmed}</p>;
        })}
      </div>
    </div>
  );
}
