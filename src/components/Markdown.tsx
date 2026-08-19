import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import { Close } from './Icons';

/**
 * Markdown matnini koʻrsatadi va **rasmlarni tartibga soladi**.
 *
 * Model internetdan topgan rasmlarni `![](url)` koʻrinishida yozadi. Ular
 * xom holida ulkan boʻlib chiqadi yoki umuman yuklanmay, interfeysni buzadi.
 * Shuning uchun:
 *   - ketma-ket kelgan rasmlar bitta GORIZONTAL lentaga yigʻiladi;
 *   - har biri bir xil balandlikda, bosilganda toʻliq ekranda ochiladi;
 *   - yuklanmagan rasm jimgina olib tashlanadi (buzuq belgi qolmaydi);
 *   - lenta boʻshab qolsa, u ham yoʻqoladi.
 */
export function Markdown({ text, className = 'md' }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    /** Element faqat rasm(lar)dan iboratmi? */
    const onlyImages = (el: Element): boolean => {
      const images = el.querySelectorAll('img');
      if (!images.length) return false;
      return el.textContent?.trim() === '';
    };

    const children = Array.from(root.children);
    let group: Element[] = [];

    const flush = () => {
      if (!group.length) return;
      const strip = document.createElement('div');
      strip.className = 'img-strip';
      for (const node of group) {
        node.querySelectorAll('img').forEach((img) => strip.appendChild(img));
      }
      group[0].replaceWith(strip);
      group.slice(1).forEach((n) => n.remove());
      group = [];
    };

    for (const child of children) {
      if (child.tagName === 'IMG' || onlyImages(child)) group.push(child);
      else flush();
    }
    flush();

    // Matn ichida qolgan yolgʻiz rasmlar ham chegaralansin.
    root.querySelectorAll('img').forEach((img) => {
      const image = img as HTMLImageElement;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      if (!image.alt) image.alt = 'rasm';

      image.addEventListener('error', () => {
        const strip = image.closest('.img-strip');
        image.remove();
        if (strip && !strip.querySelector('img')) strip.remove();
      });

      image.addEventListener('click', () => {
        setZoom({ src: image.currentSrc || image.src, alt: image.alt });
      });
    });
  }, [html]);

  return (
    <>
      <div className={className} ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <button className="icon-btn" aria-label="Yopish" onClick={() => setZoom(null)}>
            <Close />
          </button>
          <img src={zoom.src} alt={zoom.alt} referrerPolicy="no-referrer" />
        </div>
      )}
    </>
  );
}
