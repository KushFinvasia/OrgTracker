import { useState } from "react";

/** Small SVG charts. Every chart has a table alternative (toggle) and readable labels. */

export function LineChart({ points, max, label, unit = "" }: { points: { label: string; value: number }[]; max?: number; label: string; unit?: string }) {
  const [table, setTable] = useState(false);
  const w = 520;
  const h = 200;
  const pad = { l: 36, r: 34, t: 14, b: 28 }; // room for the last x label
  const top = Math.max(max ?? 0, ...points.map((p) => p.value), 1);
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(points.length - 1, 1);
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / top);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  return (
    <div>
      <div className="row between">
        <span className="sr-only">{label}</span>
        <button className="link-btn small" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <table className="table">
          <thead><tr><th>Period</th><th>Value</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.label}><td>{p.label}</td><td className="num">{p.value}{unit}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label={label}>
          {Array.from(new Set([0, Math.round(top / 2), Math.round(top)])).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#e2eae4" />
              <text x={pad.l - 8} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#69766f">{v}</text>
            </g>
          ))}
          <path d={area} fill="#e7f5eb" />
          <path d={line} fill="none" stroke="#23763f" strokeWidth="2.5" />
          {points.map((p, i) => (
            <g key={p.label}>
              <circle cx={x(i)} cy={y(p.value)} r="4" fill="#23763f" />
              <text x={x(i)} y={h - 8} fontSize="11" textAnchor="middle" fill="#69766f">{p.label}</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function BarList({ items, label, unit = "" }: { items: { label: string; value: number }[]; label: string; unit?: string }) {
  const [table, setTable] = useState(false);
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div>
      <div className="row between mb">
        <span className="sr-only">{label}</span>
        <button className="link-btn small" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <table className="table">
          <thead><tr><th>Item</th><th>Value</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.label}><td>{i.label}</td><td className="num">{i.value}{unit}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="stack" style={{ gap: 12 }} role="img" aria-label={label}>
          {items.map((i) => (
            <div key={i.label} style={{ display: "grid", gridTemplateColumns: "140px 1fr 48px", gap: 12, alignItems: "center" }}>
              <span>{i.label}</span>
              <div className="progress" style={{ height: 10 }}><i style={{ width: `${(i.value / max) * 100}%` }} /></div>
              <span className="num strong">{i.value}{unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
