import { useState } from 'react';
import {
  bookImages,
  bookMarkdown,
  bookProgress,
  createBook,
  deleteBook,
  getBook,
  illustrateChapter,
  removeChapterImage,
  writeChapter,
  writeWholeBook,
} from '../../lib/book';
import { DOC_LABEL, exportDocument, type DocFormat } from '../../lib/exporter';
import { isRunning, stopFor, useTasks } from '../../lib/tasks';
import { useStore } from '../../lib/store';
import type { Book, BookChapter } from '../../lib/types';
import { Markdown } from '../Markdown';
import { Empty, Sheet, Switch, toast } from '../ui';

const STATUS_LABEL: Record<BookChapter['status'], string> = {
  kutilmoqda: 'kutilmoqda',
  yozilmoqda: 'yozilmoqda',
  tayyor: 'tayyor',
  chala: 'chala',
  xato: 'xato',
};

const STATUS_CLASS: Record<BookChapter['status'], string> = {
  kutilmoqda: 'soft',
  yozilmoqda: 'queued',
  tayyor: 'done',
  chala: 'pending',
  xato: 'error',
};

/* ---------------------------------------------------------------- yangi */

function NewBook({ onDone }: { onDone: (id: string) => void }) {
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [style, setStyle] = useState('');
  const [chapters, setChapters] = useState(10);
  const [words, setWords] = useState(900);
  const [illustrated, setIllustrated] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!topic.trim()) {
      toast('Kitob mavzusini yozing');
      return;
    }
    setBusy(true);
    try {
      const book = await createBook({
        topic: topic.trim(),
        audience: audience.trim(),
        style: style.trim(),
        chapters,
        targetWords: words,
        illustrated,
      });
      toast(`«${book.title}» rejasi tayyor — ${book.chapters.length} bob`);
      onDone(book.id);
    } catch (err) {
      toast(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cloud-card">
      <div className="field">
        <label>Kitob nima haqida?</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Masalan: Sun'iy intellekt asoslari"
        />
      </div>
      <div className="row">
        <label className="mini-field grow">
          kim uchun
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="talabalar"
          />
        </label>
        <label className="mini-field grow">
          uslub
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="sodda, misolli" />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="mini-field grow">
          boblar soni
          <input
            type="number"
            min={3}
            max={40}
            value={chapters}
            onChange={(e) => setChapters(Number(e.target.value))}
          />
        </label>
        <label className="mini-field grow">
          bob hajmi (soʻz)
          <input
            type="number"
            min={300}
            max={4000}
            step={100}
            value={words}
            onChange={(e) => setWords(Number(e.target.value))}
          />
        </label>
      </div>
      <Switch
        on={illustrated}
        onChange={setIllustrated}
        label="Har bobga rasm chizilsin"
        hint="Bob yozilgach unga mos illyustratsiya chiziladi. Rasm token sarflaydi — istamasangiz oʻchiring, keyin qoʻlda ham qoʻshsa boʻladi."
      />

      <button className="btn wide" style={{ marginTop: 10 }} disabled={busy} onClick={() => void submit()}>
        {busy ? 'Reja tuzilmoqda…' : 'Reja tuzish'}
      </button>
      <div className="tiny" style={{ marginTop: 8 }}>
        Avval boblar rejasi tuziladi, keyin har bir bob ALOHIDA yoziladi — shuning
        uchun matn yarim joyda uzilib qolmaydi.
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- bitta kitob */

function BookView({ book, onBack }: { book: Book; onBack: () => void }) {
  const tasks = useTasks();
  const [preview, setPreview] = useState<BookChapter | null>(null);
  const [fixing, setFixing] = useState<BookChapter | null>(null);
  const [instruction, setInstruction] = useState('');
  const [drawing, setDrawing] = useState('');
  const [exporting, setExporting] = useState(false);

  const progress = bookProgress(book);
  const running = tasks.some((t) => t.kind === 'kitob');
  const wholeRunning = isRunning('kitob', book.id);

  const onExport = async (format: DocFormat) => {
    setExporting(false);
    try {
      toast(await exportDocument(bookMarkdown(book), format, book.title, bookImages(book)));
    } catch (err) {
      toast(`Chiqarib boʻlmadi: ${(err as Error).message}`);
    }
  };

  return (
    <div className="scroll">
      <div className="pad">
        <button className="btn ghost mini" onClick={onBack}>
          ← Kitoblar
        </button>

        <div className="h2" style={{ marginTop: 12 }}>
          {book.title}
        </div>
        <div className="tiny">
          {progress.done}/{progress.total} bob tayyor · {progress.words.toLocaleString('ru-RU')} soʻz
          {progress.images ? ` · ${progress.images} rasm` : ''}
        </div>
        <div className="meter" style={{ marginTop: 8 }}>
          <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          {wholeRunning ? (
            <button className="btn ghost grow" onClick={() => stopFor('kitob', book.id)}>
              Toʻxtatish
            </button>
          ) : (
            <button
              className="btn grow"
              disabled={running || progress.done === progress.total}
              onClick={() => void writeWholeBook(book.id)}
            >
              {progress.done ? 'Qolganini yozish' : 'Kitobni yozish'}
            </button>
          )}
          <button
            className="btn ghost"
            disabled={!progress.words}
            onClick={() => setExporting(true)}
          >
            Yuklab olish
          </button>
        </div>

        <div className="section-label">Boblar</div>
        {book.chapters.map((chapter, index) => {
          const busy = isRunning('kitob', chapter.id);
          const no = chapter.no ?? index + 1;
          return (
            <div className="cloud-card" key={chapter.id}>
              <div className="between">
                <div className="grow" onClick={() => chapter.content && setPreview(chapter)}>
                  <b>
                    {no}. {chapter.title}
                  </b>
                  <div className="tiny">
                    {chapter.brief}
                  </div>
                </div>
                <span className={`pill ${STATUS_CLASS[chapter.status]}`}>
                  {busy ? 'yozilmoqda' : STATUS_LABEL[chapter.status]}
                </span>
              </div>

              {chapter.words > 0 && (
                <div className="tiny" style={{ marginTop: 4 }}>
                  {chapter.words.toLocaleString('ru-RU')} soʻz
                </div>
              )}
              {chapter.error && <div className="tiny error">{chapter.error}</div>}

              {!!chapter.images?.length && (
                <div className="img-strip">
                  {chapter.images.map((image) => (
                    <img
                      key={image.id}
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={image.caption}
                      onClick={() => {
                        if (window.confirm('Shu rasm oʻchirilsinmi?')) {
                          removeChapterImage(book.id, chapter.id, image.id);
                        }
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="row" style={{ marginTop: 8 }}>
                {busy ? (
                  <button className="btn mini ghost" onClick={() => stopFor('kitob', chapter.id)}>
                    Toʻxtatish
                  </button>
                ) : (
                  <>
                    <button
                      className="btn mini"
                      disabled={running}
                      onClick={() => void writeChapter(book.id, chapter.id)}
                    >
                      {chapter.content ? 'Qayta yozish' : 'Yozish'}
                    </button>
                    {chapter.status === 'chala' && (
                      <button
                        className="btn mini ghost"
                        disabled={running}
                        onClick={() => void writeChapter(book.id, chapter.id, { append: true })}
                      >
                        Davom ettirish
                      </button>
                    )}
                    {chapter.content && (
                      <>
                        <button className="btn mini ghost" onClick={() => setPreview(chapter)}>
                          Oʻqish
                        </button>
                        <button
                          className="btn mini ghost"
                          disabled={drawing === chapter.id}
                          onClick={async () => {
                            setDrawing(chapter.id);
                            const ok = await illustrateChapter(book.id, chapter.id);
                            setDrawing('');
                            toast(ok ? 'Rasm qoʻshildi' : 'Rasm chizilmadi');
                          }}
                        >
                          {drawing === chapter.id ? 'Chizilmoqda…' : 'Rasm'}
                        </button>
                        <button
                          className="btn mini ghost"
                          disabled={running}
                          onClick={() => {
                            setFixing(chapter);
                            setInstruction('');
                          }}
                        >
                          Tuzatish
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        <button
          className="btn ghost wide"
          style={{ marginTop: 14 }}
          onClick={() => {
            if (window.confirm(`«${book.title}» oʻchirilsinmi?`)) {
              deleteBook(book.id);
              onBack();
            }
          }}
        >
          Kitobni oʻchirish
        </button>
      </div>

      {preview && (
        <Sheet title={`${preview.no ?? ''} ${preview.title}`.trim()} onClose={() => setPreview(null)}>
          {!!preview.images?.length && (
            <div className="img-strip">
              {preview.images.map((image) => (
                <img
                  key={image.id}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.caption}
                />
              ))}
            </div>
          )}
          <Markdown text={preview.content} />
        </Sheet>
      )}

      {fixing && (
        <Sheet title={`${fixing.no ?? ''}-bobni tuzatish`} onClose={() => setFixing(null)}>
          <div className="field">
            <label>Nimani oʻzgartirish kerak?</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Masalan: misollarni koʻpaytir, oxirgi qismi qisqa qolgan — kengaytir, uslubi ilmiyroq boʻlsin"
            />
          </div>
          <button
            className="btn wide"
            onClick={() => {
              const target = fixing;
              setFixing(null);
              void writeChapter(book.id, target.id, {
                extra:
                  instruction.trim() ||
                  'Bobni yaxshila: chala qolgan joylarini toʻldir, misollar qoʻsh.',
              });
              toast('Bob qayta yozilmoqda');
            }}
          >
            Qayta yozish
          </button>
          <div className="tiny" style={{ marginTop: 8 }}>
            Faqat shu bob qayta yoziladi — qolgan boblar oʻz joyida qoladi.
          </div>
        </Sheet>
      )}

      {exporting && (
        <Sheet title="Kitobni yuklab olish" onClose={() => setExporting(false)}>
          {(['docx', 'pdf', 'md'] as DocFormat[]).map((format) => (
            <button key={format} className="btn ghost wide" style={{ marginBottom: 8 }} onClick={() => void onExport(format)}>
              {DOC_LABEL[format]}
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- roʻyxat */

export function Books() {
  const books = useStore((s) => s.books);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const open = openId ? getBook(openId) : undefined;
  if (open) return <BookView book={open} onBack={() => setOpenId(null)} />;

  return (
    <div className="scroll">
      <div className="pad">
        {creating ? (
          <>
            <NewBook
              onDone={(id) => {
                setCreating(false);
                setOpenId(id);
              }}
            />
            <button className="btn ghost wide" onClick={() => setCreating(false)}>
              Bekor qilish
            </button>
          </>
        ) : (
          <button className="btn wide" onClick={() => setCreating(true)}>
            Yangi kitob
          </button>
        )}

        {books.length === 0 && !creating && (
          <Empty
            title="Hali kitob yoʻq"
            hint="«Yangi kitob» ni bosing yoki chatda «shu mavzuda kitob yozib ber» deb soʻrang."
          />
        )}

        {books.map((book) => {
          const progress = bookProgress(book);
          return (
            <button
              key={book.id}
              className="cloud-card"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setOpenId(book.id)}
            >
              <div className="between">
                <b>{book.title}</b>
                <span className="pill soft">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="tiny">
                {progress.words.toLocaleString('ru-RU')} soʻz · {book.audience}
              </div>
              <div className="meter" style={{ marginTop: 8 }}>
                <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
