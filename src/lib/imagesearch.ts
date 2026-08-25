/**
 * Internetdan rasm qidirish — Pinterest kabi, lekin manbasi bilan.
 *
 * Ikkita bepul, kalitsiz manba ishlatiladi:
 *  - **Openverse** (openverse.org) — CC litsenziyali 800 mln+ rasm;
 *  - **Wikimedia Commons** — ensiklopedik va tarixiy rasmlar.
 *
 * Ikkalasi ham brauzerdan toʻgʻridan-toʻgʻri soʻrovni qabul qiladi (CORS
 * ochiq) va har bir rasm bilan MANBA havolasi hamda muallifini qaytaradi —
 * shuning uchun natijani hujjatga qoʻyish yoki havolasini berish mumkin.
 */

export interface FoundImage {
  title: string;
  /** Toʻliq oʻlchamdagi rasm manzili */
  url: string;
  /** Kichik nusxa — roʻyxatda koʻrsatish uchun */
  thumb: string;
  /** Rasm turgan sahifa (manba) */
  source: string;
  author: string;
  license: string;
  provider: 'Openverse' | 'Wikimedia';
  width?: number;
  height?: number;
}

const TIMEOUT = 12000;

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Openverse — asosiy manba, xilma-xil va sifatli. */
async function searchOpenverse(query: string, limit: number, signal?: AbortSignal): Promise<FoundImage[]> {
  const url =
    'https://api.openverse.org/v1/images/?' +
    new URLSearchParams({
      q: query,
      page_size: String(Math.min(limit, 20)),
      mature: 'false',
    });
  const data = await getJson(url, signal);
  return (data?.results ?? []).map((r: any) => ({
    title: String(r.title ?? query).slice(0, 90),
    url: String(r.url ?? ''),
    thumb: String(r.thumbnail ?? r.url ?? ''),
    source: String(r.foreign_landing_url ?? r.url ?? ''),
    author: String(r.creator ?? 'nomaʼlum'),
    license: String(r.license ?? '').toUpperCase(),
    provider: 'Openverse' as const,
    width: r.width,
    height: r.height,
  }));
}

/** Wikimedia Commons — aniq mavzular (tarix, biologiya, geografiya) uchun. */
async function searchWikimedia(query: string, limit: number, signal?: AbortSignal): Promise<FoundImage[]> {
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: query,
      gsrlimit: String(Math.min(limit, 20)),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata|size',
      iiurlwidth: '400',
    });
  const data = await getJson(url, signal);
  const pages = data?.query?.pages ?? {};
  return Object.values(pages).map((page: any) => {
    const info = page?.imageinfo?.[0] ?? {};
    const meta = info.extmetadata ?? {};
    const strip = (html: string) => String(html ?? '').replace(/<[^>]*>/g, '').trim();
    return {
      title: String(page.title ?? '').replace(/^File:/, '').slice(0, 90),
      url: String(info.url ?? ''),
      thumb: String(info.thumburl ?? info.url ?? ''),
      source: String(info.descriptionurl ?? ''),
      author: strip(meta.Artist?.value) || 'nomaʼlum',
      license: strip(meta.LicenseShortName?.value) || 'Wikimedia',
      provider: 'Wikimedia' as const,
      width: info.width,
      height: info.height,
    };
  });
}

/**
 * Rasm qidiradi. Ikkala manbadan ham oladi va aralashtirib qaytaradi —
 * bittasi ishlamasa ikkinchisi qoladi.
 */
export async function searchImages(
  query: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<FoundImage[]> {
  const clean = query.trim();
  if (!clean) return [];

  const [openverse, wikimedia] = await Promise.allSettled([
    searchOpenverse(clean, limit, signal),
    searchWikimedia(clean, Math.ceil(limit / 2), signal),
  ]);

  const out: FoundImage[] = [];
  if (openverse.status === 'fulfilled') out.push(...openverse.value);
  if (wikimedia.status === 'fulfilled') out.push(...wikimedia.value);

  // Manzili boʻsh yoki takrorlanganlarini tashlaymiz.
  const seen = new Set<string>();
  return out
    .filter((img) => {
      if (!img.url || !img.thumb || seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    })
    .slice(0, limit);
}

/**
 * Rasmni yuklab, base64 ga oʻgiradi — hujjatga qoʻyish yoki galereyaga
 * saqlash uchun. Sayt CORS ni yopgan boʻlsa `null` qaytadi (bunda faqat
 * havola qoladi).
 */
export async function fetchImageData(
  url: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    // Juda katta rasmni olmaymiz — xotira va saqlash chegarasi bor.
    if (blob.size > 6 * 1024 * 1024) return null;

    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { data, mimeType: blob.type };
  } catch {
    return null;
  }
}
