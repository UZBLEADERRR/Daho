export type ChartType = 'ustun' | 'chiziq' | 'doira' | 'raqam' | 'gorizontal';

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartSpec {
  type: ChartType;
  title?: string;
  subtitle?: string;
  unit?: string;
  labels: string[];
  series: ChartSeries[];
  /** raqam turi uchun: har bir koʻrsatkichga emoji */
  icons?: string[];
  /** eng muhim ustunni ajratib koʻrsatish */
  highlight?: number;
}

const TYPE_ALIASES: Record<string, ChartType> = {
  ustun: 'ustun',
  bar: 'ustun',
  column: 'ustun',
  chiziq: 'chiziq',
  line: 'chiziq',
  area: 'chiziq',
  doira: 'doira',
  pie: 'doira',
  donut: 'doira',
  raqam: 'raqam',
  stat: 'raqam',
  kpi: 'raqam',
  gorizontal: 'gorizontal',
  hbar: 'gorizontal',
};

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * ```chart bloki ichidagi JSON ni tekshirib, chizishga tayyor
 * spetsifikatsiyaga aylantiradi. Notoʻgʻri boʻlsa `null`.
 */
export function parseChart(raw: string): ChartSpec | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const type = TYPE_ALIASES[String(data.type ?? 'ustun').toLowerCase()] ?? 'ustun';
  const labels: string[] = Array.isArray(data.labels)
    ? data.labels.map((l: unknown) => String(l))
    : [];

  let series: ChartSeries[] = [];
  if (Array.isArray(data.series)) {
    series = data.series
      .map((s: any) => ({
        name: String(s?.name ?? 'Qiymat'),
        values: Array.isArray(s?.values) ? s.values.map(toNumber) : [],
      }))
      .filter((s: ChartSeries) => s.values.length > 0);
  } else if (Array.isArray(data.values)) {
    series = [{ name: String(data.name ?? 'Qiymat'), values: data.values.map(toNumber) }];
  }

  if (!series.length) return null;

  // Belgilar yetishmasa raqam bilan toʻldiramiz.
  const maxLen = Math.max(...series.map((s) => s.values.length));
  const filled = Array.from({ length: maxLen }, (_, i) => labels[i] ?? String(i + 1));

  return {
    type,
    title: data.title ? String(data.title) : undefined,
    subtitle: data.subtitle ? String(data.subtitle) : undefined,
    unit: data.unit ? String(data.unit) : undefined,
    labels: filled,
    // Sakkizta rangdan ortiq seriya oʻqilmaydi — qolganini kesamiz.
    series: series.slice(0, 8),
    icons: Array.isArray(data.icons) ? data.icons.map((i: unknown) => String(i)) : undefined,
    highlight:
      typeof data.highlight === 'number' && data.highlight >= 0 ? data.highlight : undefined,
  };
}

/** Oʻqdagi belgilar uchun ozoda qadam tanlaydi. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= rawStep) ?? candidates[candidates.length - 1];
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')} mln`;
  if (abs >= 10_000) return `${Math.round(value / 1000)} ming`;
  if (abs >= 1000) return value.toLocaleString('uz-UZ');
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}
