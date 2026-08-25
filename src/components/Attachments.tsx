/**
 * Yuborilgan fayllar — xabar ostida koʻrinadi va istalgan vaqtda
 * qayta yuklab olinadi.
 *
 * Avval HAR QANDAY biriktirma `<img>` bilan chizilardi. Rasm boʻlsa
 * ishlardi, PDF yoki .docx boʻlsa esa buzuq rasm — yaʼni foydalanuvchi
 * yuborgan fayli chatda umuman koʻrinmasdi va uni qaytarib ololmasdi.
 * Endi rasm — kichik surat, qolgani — nomi va hajmi bilan karta.
 */
import { b64ToBytes } from '../lib/audio';
import { fileIcon } from '../lib/attach';
import { saveBytes } from '../lib/exporter';
import type { Attachment } from '../lib/types';
import { toast } from './ui';

/** base64 uzunligidan haqiqiy hajmni chiqaradi. */
function hajm(b64: string): string {
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function nomi(a: Attachment, index: number): string {
  if (a.name) return a.name;
  const ext = (a.mimeType.split('/')[1] || 'fayl').replace('jpeg', 'jpg').split('+')[0];
  return `fayl-${index + 1}.${ext}`;
}

export async function saveAttachment(a: Attachment, index = 0): Promise<void> {
  try {
    const message = await saveBytes(nomi(a, index), b64ToBytes(a.data), a.mimeType);
    toast(message);
  } catch (err) {
    toast(`Saqlanmadi: ${String((err as Error)?.message ?? err)}`);
  }
}

export function Attachments({
  items,
  align = 'end',
}: {
  items: Attachment[];
  align?: 'start' | 'end';
}) {
  if (!items.length) return null;

  return (
    <div className="attach-grid" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {items.map((a, i) =>
        a.mimeType.startsWith('image/') ? (
          <button
            key={i}
            className="attach-image"
            title={`${nomi(a, i)} — saqlash uchun bosing`}
            onClick={() => void saveAttachment(a, i)}
          >
            <img src={`data:${a.mimeType};base64,${a.data}`} alt={nomi(a, i)} />
          </button>
        ) : (
          <button
            key={i}
            className="attach-file"
            title="Yuklab olish"
            onClick={() => void saveAttachment(a, i)}
          >
            <span className="attach-icon">{fileIcon(a.name ?? '', a.mimeType)}</span>
            <span className="attach-meta">
              <b>{nomi(a, i)}</b>
              <i>{hajm(a.data)}</i>
            </span>
          </button>
        ),
      )}
    </div>
  );
}
