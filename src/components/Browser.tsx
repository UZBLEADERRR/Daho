import { useEffect, useRef, useState } from 'react';
import { saveLinkApp } from '../lib/creations';
import { blocksEmbedding, normalizeUrl, openExternal } from '../lib/openlink';
import { IFRAME_ALLOW } from '../lib/sandbox';
import { setState, useStore } from '../lib/store';
import { Back, Plus, Refresh } from './Icons';
import { toast } from './ui';

/** Qidiruv soʻzimi yoki manzilmi? */
function isAddress(text: string): boolean {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !t.includes(' ');
}

/** Qidiruv uchun iframe’ga ruxsat beradigan tizim. */
function searchUrl(query: string): string {
  return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
}

interface Props {
  initialUrl?: string;
  onClose: () => void;
}

/**
 * Ilova ichidagi brauzer.
 *
 * Koʻp sayt iframe ichida ochilishga ruxsat bermaydi (`X-Frame-Options`).
 * Shuning uchun: ochilishi mumkin boʻlganlari shu yerda, ochilmaydiganlari
 * telefonning brauzer oynasida (Android’da ilova ustida ochiladigan
 * «Custom Tab») koʻrsatiladi — foydalanuvchi baribir ilovadan chiqmaydi.
 */
export function Browser({ initialUrl = '', onClose }: Props) {
  const history = useStore((s) => s.browserHistory ?? []);
  const [input, setInput] = useState(initialUrl);
  const [url, setUrl] = useState(initialUrl ? normalizeUrl(initialUrl) : '');
  const [reload, setReload] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [slow, setSlow] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  const remember = (target: string) => {
    setState((s) => {
      const list = (s.browserHistory ?? []).filter((h) => h.url !== target);
      return {
        browserHistory: [{ url: target, at: Date.now() }, ...list].slice(0, 40),
      };
    });
  };

  const go = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const target = isAddress(text) ? normalizeUrl(text) : searchUrl(text);

    if (blocksEmbedding(target)) {
      setBlocked(true);
      setUrl(target);
      setInput(target);
      remember(target);
      void openExternal(target);
      return;
    }
    setBlocked(false);
    setSlow(false);
    setUrl(target);
    setInput(target);
    remember(target);
    setReload((n) => n + 1);
  };

  useEffect(() => {
    if (initialUrl) go(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  // Sahifa ochilmasa (sayt taqiqlagan yoki internet yoʻq) — yoʻl koʻrsatamiz.
  useEffect(() => {
    if (!url || blocked) return;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [url, reload, blocked]);

  return (
    <div className="viewer">
      <div className="viewer-head">
        <button className="icon-btn" onClick={onClose} aria-label="Yopish">
          <Back />
        </button>
        <input
          className="grow url-bar"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              go(input);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Manzil yoki qidiruv"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
        {url && (
          <>
            <button className="icon-btn" onClick={() => setReload((n) => n + 1)} aria-label="Yangilash">
              <Refresh />
            </button>
            <button
              className="icon-btn"
              aria-label="Ilovalarimga qoʻshish"
              onClick={() => {
                const host = (() => {
                  try {
                    return new URL(url).hostname.replace(/^www\./, '');
                  } catch {
                    return url;
                  }
                })();
                saveLinkApp(url, host, '🔗', 'Brauzerdan saqlangan');
                toast(`«${host}» Ilovalarimga qoʻshildi`);
              }}
            >
              <Plus size={19} />
            </button>
          </>
        )}
      </div>

      <div className="viewer-body">
        {!url ? (
          <div className="pad">
            <div className="section-label">Tez ochish</div>
            <div className="quick-grid">
              {['wikipedia.org', 'lite.duckduckgo.com', 'arxiv.org', 'stackoverflow.com', 'developer.mozilla.org', 'w3schools.com'].map(
                (site) => (
                  <button key={site} className="quick-site" onClick={() => go(site)}>
                    {site}
                  </button>
                ),
              )}
            </div>

            {history.length > 0 && (
              <>
                <div className="between" style={{ marginTop: 18 }}>
                  <span className="section-label" style={{ padding: 0 }}>
                    Tarix
                  </span>
                  <button
                    className="btn mini ghost"
                    onClick={() => setState({ browserHistory: [] })}
                  >
                    Tozalash
                  </button>
                </div>
                {history.map((h) => (
                  <button key={h.url} className="line-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => go(h.url)}>
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {h.url}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : blocked ? (
          <div className="pad">
            <div className="cloud-card warn">
              Bu sayt boshqa ilova ichida ochilishni taqiqlaydi, shuning uchun u
              alohida oynada ochildi.
            </div>
            <button className="btn wide" onClick={() => openExternal(url)}>
              Qaytadan ochish
            </button>
            <button
              className="btn ghost wide"
              style={{ marginTop: 8 }}
              onClick={() => {
                setBlocked(false);
                setReload((n) => n + 1);
              }}
            >
              Baribir shu yerda ochib koʻr
            </button>
          </div>
        ) : (
          <>
            {slow && (
              <div className="browser-hint">
                <span className="grow">Sahifa ochilmadimi? Baʼzi saytlar ilova ichida ochilmaydi.</span>
                <button className="btn mini" onClick={() => openExternal(url)}>
                  Alohida oynada ochish
                </button>
              </div>
            )}
            <iframe
              key={reload}
              ref={frame}
              title="Brauzer"
              src={url}
              allow={IFRAME_ALLOW}
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={() => setSlow(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
