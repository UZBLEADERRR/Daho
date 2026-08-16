import { useMemo, useState } from 'react';
import { formatNumber, niceTicks, type ChartSpec } from '../lib/charts';

/**
 * Kategorik palitra — dataviz tekshiruvchisidan oʻtgan tartib.
 * Ranglar CSS oʻzgaruvchilari orqali beriladi (styles.css da tun/kun qadamlari).
 */
const SLOTS = 8;
const seriesColor = (i: number) => `var(--viz-${(i % SLOTS) + 1})`;

const PAD = { top: 14, right: 12, bottom: 30, left: 40 };
const W = 320;
const H = 190;

interface Props {
  spec: ChartSpec;
}

export function Chart({ spec }: Props) {
  const [view, setView] = useState<'grafik' | 'jadval'>('grafik');
  const [active, setActive] = useState<{ s: number; i: number } | null>(null);

  const multi = spec.series.length > 1;

  const body = (() => {
    switch (spec.type) {
      case 'raqam':
        return <StatTiles spec={spec} />;
      case 'doira':
        return <Pie spec={spec} active={active} setActive={setActive} />;
      case 'chiziq':
        return <Line spec={spec} active={active} setActive={setActive} />;
      case 'gorizontal':
        return <HBars spec={spec} active={active} setActive={setActive} />;
      default:
        return <Bars spec={spec} active={active} setActive={setActive} />;
    }
  })();

  return (
    <figure className="viz">
      {(spec.title || spec.subtitle) && (
        <figcaption className="viz-head">
          {spec.title && <div className="viz-title">{spec.title}</div>}
          {spec.subtitle && <div className="viz-sub">{spec.subtitle}</div>}
        </figcaption>
      )}

      {view === 'grafik' ? body : <TableView spec={spec} />}

      {/* Ikkitadan ortiq seriyada legenda doim boʻladi — identifikatsiya
          faqat rangga tayanmasligi uchun. */}
      {multi && spec.type !== 'raqam' && (
        <div className="viz-legend">
          {spec.series.map((s, i) => (
            <span key={s.name + i}>
              <i style={{ background: seriesColor(i) }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      {spec.type !== 'raqam' && (
        <div className="viz-foot">
          {active && (
            <span className="viz-tip">
              {spec.labels[active.i]} · {multi ? `${spec.series[active.s].name} · ` : ''}
              {formatNumber(spec.series[active.s].values[active.i])}
              {spec.unit ? ` ${spec.unit}` : ''}
            </span>
          )}
          <button
            className="viz-toggle"
            onClick={() => setView(view === 'grafik' ? 'jadval' : 'grafik')}
          >
            {view === 'grafik' ? 'Jadval' : 'Grafik'}
          </button>
        </div>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */

type Sel = { s: number; i: number } | null;
interface SubProps {
  spec: ChartSpec;
  active: Sel;
  setActive: (v: Sel) => void;
}

function Grid({ ticks, max }: { ticks: number[]; max: number }) {
  const plotH = H - PAD.top - PAD.bottom;
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              className="viz-grid"
            />
            <text x={PAD.left - 6} y={y + 3} className="viz-axis" textAnchor="end">
              {formatNumber(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Bars({ spec, active, setActive }: SubProps) {
  const max = Math.max(...spec.series.flatMap((s) => s.values), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / spec.labels.length;
  const groups = spec.series.length;
  // Ustun ≤ 24px, oraliqda 2px sirt bo'shligi
  const barW = Math.min(24, (band * 0.62) / groups - (groups > 1 ? 2 : 0));
  const single = groups === 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img">
      <Grid ticks={ticks} max={top} />
      {spec.series.map((s, si) =>
        s.values.map((v, i) => {
          const h = Math.max(1, (v / top) * plotH);
          const groupW = barW * groups + (groups - 1) * 2;
          const x = PAD.left + band * i + (band - groupW) / 2 + si * (barW + 2);
          const y = PAD.top + plotH - h;
          const dim = spec.highlight !== undefined && spec.highlight !== i;
          return (
            <g key={`${si}-${i}`} onClick={() => setActive({ s: si, i })}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={4}
                fill={dim ? 'var(--viz-dim)' : seriesColor(si)}
                opacity={active && (active.s !== si || active.i !== i) ? 0.55 : 1}
              />
              {/* Pastki uch to'g'ri burchak bo'lishi uchun ustiga kichik to'rtburchak */}
              {h > 5 && (
                <rect x={x} y={y + h - 4} width={barW} height={4} fill={dim ? 'var(--viz-dim)' : seriesColor(si)} />
              )}
              {single && (
                <text x={x + barW / 2} y={y - 5} className="viz-value" textAnchor="middle">
                  {formatNumber(v)}
                </text>
              )}
            </g>
          );
        }),
      )}
      {spec.labels.map((l, i) => (
        <text
          key={l + i}
          x={PAD.left + band * i + band / 2}
          y={H - PAD.bottom + 15}
          className="viz-axis"
          textAnchor="middle"
        >
          {l.length > 7 ? `${l.slice(0, 6)}…` : l}
        </text>
      ))}
    </svg>
  );
}

function HBars({ spec, setActive }: SubProps) {
  const values = spec.series[0].values;
  const max = Math.max(...values, 1);
  const rowH = 30;
  const height = values.length * rowH + 8;

  return (
    <div className="viz-hbars" style={{ minHeight: height }}>
      {values.map((v, i) => {
        const dim = spec.highlight !== undefined && spec.highlight !== i;
        return (
          <div className="viz-hrow" key={i} onClick={() => setActive({ s: 0, i })}>
            <span className="viz-hlabel">{spec.labels[i]}</span>
            <span className="viz-htrack">
              <i
                style={{
                  width: `${Math.max(2, (v / max) * 100)}%`,
                  background: dim ? 'var(--viz-dim)' : seriesColor(i),
                }}
              />
            </span>
            <span className="viz-hvalue">
              {formatNumber(v)}
              {spec.unit ? ` ${spec.unit}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Line({ spec, active, setActive }: SubProps) {
  const max = Math.max(...spec.series.flatMap((s) => s.values), 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = spec.labels.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (plotW / (n - 1)) * i);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img">
      <Grid ticks={ticks} max={top} />
      {spec.series.map((s, si) => {
        const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
        const last = s.values.length - 1;
        return (
          <g key={si}>
            <path
              d={d}
              fill="none"
              stroke={seriesColor(si)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {s.values.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v)}
                r={active?.s === si && active?.i === i ? 5.5 : 4}
                fill={seriesColor(si)}
                stroke="var(--viz-surface)"
                strokeWidth={2}
                onClick={() => setActive({ s: si, i })}
              />
            ))}
            {/* Faqat oxirgi nuqta belgilanadi — har nuqtaga raqam qoʻyilmaydi */}
            <text x={x(last)} y={y(s.values[last]) - 10} className="viz-value" textAnchor="end">
              {formatNumber(s.values[last])}
            </text>
          </g>
        );
      })}
      {spec.labels.map((l, i) =>
        n <= 8 || i % Math.ceil(n / 6) === 0 ? (
          <text key={i} x={x(i)} y={H - PAD.bottom + 15} className="viz-axis" textAnchor="middle">
            {l.length > 7 ? `${l.slice(0, 6)}…` : l}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function Pie({ spec, setActive }: SubProps) {
  const values = spec.series[0].values.slice(0, 6);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const R = 62;
  const INNER = 36;
  const cx = 84;
  const cy = 84;

  let angle = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    // 2px sirt bo'shligi uchun kichik burchak ayiramiz
    const gap = 0.028;
    const a0 = angle + gap / 2;
    const a1 = angle + sweep - gap / 2;
    angle += sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    const d =
      `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} ` +
      `L${p(INNER, a1)} A${INNER},${INNER} 0 ${large} 0 ${p(INNER, a0)} Z`;
    return { d, i, v };
  });

  return (
    <div className="viz-pie">
      <svg viewBox="0 0 168 168" className="viz-donut" role="img">
        {arcs.map((a) => (
          <path key={a.i} d={a.d} fill={seriesColor(a.i)} onClick={() => setActive({ s: 0, i: a.i })} />
        ))}
        <text x={cx} y={cy - 2} className="viz-hero" textAnchor="middle">
          {formatNumber(total)}
        </text>
        <text x={cx} y={cy + 14} className="viz-axis" textAnchor="middle">
          {spec.unit || 'jami'}
        </text>
      </svg>
      <div className="viz-pie-list">
        {values.map((v, i) => (
          <div key={i}>
            <i style={{ background: seriesColor(i) }} />
            <span className="grow">{spec.labels[i]}</span>
            <b>{Math.round((v / total) * 100)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatTiles({ spec }: { spec: ChartSpec }) {
  const values = spec.series[0].values;
  return (
    <div className="viz-stats">
      {values.map((v, i) => (
        <div className="viz-stat" key={i}>
          {spec.icons?.[i] && <span className="viz-stat-icon">{spec.icons[i]}</span>}
          <b>{formatNumber(v)}</b>
          <span>{spec.labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ spec }: { spec: ChartSpec }) {
  const rows = useMemo(
    () =>
      spec.labels.map((label, i) => ({
        label,
        values: spec.series.map((s) => s.values[i] ?? 0),
      })),
    [spec],
  );

  return (
    <div className="viz-table-wrap">
      <table className="viz-table">
        <thead>
          <tr>
            <th></th>
            {spec.series.map((s, i) => (
              <th key={i}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className="num">
                  {formatNumber(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
