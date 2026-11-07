// 통계 그래프용 SVG 문자열 생성기 (외부 라이브러리 없음). 빌드 때 호출되어 완성된 SVG가 HTML에 그대로 들어감.
// 호버 툴팁은 각 투명 영역의 data-tip 속성을 StatsPanel.astro의 작은 스크립트가 읽어서 보여줌.
// 값이 null인 칸은 "집계 전"(기록이 없는 구간)으로 처리됨.

const W = 560;
const H = 190;
const PAD = { l: 10, r: 10, t: 22, b: 24 };

export const fmtNum = (n) => Number(n).toLocaleString('ko-KR');

// 12480 -> 1.2만, 123456789 -> 1.2억
export function fmtCompact(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '')}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}만`;
  return fmtNum(n);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function pickLabelIdx(n, maxLabels) {
  if (n <= maxLabels) return [...Array(n).keys()];
  const step = Math.ceil((n - 1) / (maxLabels - 1));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

function frame(inner, defs, cls = '') {
  return `<svg viewBox="0 0 ${W} ${H}" class="chart ${cls}" role="img">${defs ? `<defs>${defs}</defs>` : ''}${inner}</svg>`;
}

function gridLines(max, unit, showMax = true) {
  let g = '';
  [0.5, 1].forEach((f) => {
    const y = PAD.t + (H - PAD.t - PAD.b) * (1 - f);
    g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="grid"/>`;
  });
  if (showMax) g += `<text x="${PAD.l}" y="${PAD.t - 8}" class="axis-max">${fmtCompact(Math.round(max))}${unit}</text>`;
  return g;
}

function xLabels(labels, xOf, maxLabels) {
  return pickLabelIdx(labels.length, maxLabels)
    .map((i) => `<text x="${xOf(i).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="xl">${esc(labels[i])}</text>`)
    .join('');
}

/** 영역(선) 차트. values 에 null 이 있으면 그 구간은 비워 둠. */
export function areaChart({ id, labels, values, color, unit = '', maxLabels = 7, notes = [] }) {
  const n = values.length;
  const real = values.filter((v) => v != null);
  const max = Math.max(1, ...real) * 1.12;
  const inset = n > 1 ? 14 : 0;
  const xOf = (i) => PAD.l + inset + (n > 1 ? (i / (n - 1)) * (W - PAD.l - PAD.r - inset * 2) : (W - PAD.l - PAD.r) / 2);
  const yOf = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const base = H - PAD.b;

  // 연속 구간 나누기
  const runs = [];
  let cur = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) runs.push(cur);

  let marks = '';
  for (const run of runs) {
    if (run.length >= 2) {
      const d = run.map((i, k) => `${k ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(values[i]).toFixed(1)}`).join(' ');
      marks += `<path d="${d} L${xOf(run[run.length - 1]).toFixed(1)} ${base} L${xOf(run[0]).toFixed(1)} ${base} Z" fill="url(#ag-${id})"/>`;
      marks += `<path d="${d}" class="line" stroke="${color}" filter="url(#gl-${id})"/>`;
    }
  }
  // 마지막 값 강조 (단일 점 구간 포함)
  const lastIdx = real.length ? values.map((v) => v != null).lastIndexOf(true) : -1;
  if (lastIdx >= 0) {
    marks += `<circle cx="${xOf(lastIdx).toFixed(1)}" cy="${yOf(values[lastIdx]).toFixed(1)}" r="4.5" fill="${color}" stroke="var(--stat-card)" stroke-width="2" filter="url(#gl-${id})"/>`;
  }
  // 값이 하나뿐인 구간(점)
  for (const run of runs) {
    if (run.length === 1 && run[0] !== lastIdx) {
      marks += `<circle cx="${xOf(run[0]).toFixed(1)}" cy="${yOf(values[run[0]]).toFixed(1)}" r="3.5" fill="${color}"/>`;
    }
  }

  // 호버 영역 + 가이드
  const slot = n > 1 ? (W - PAD.l - PAD.r - inset * 2) / (n - 1) : W;
  let hits = '';
  values.forEach((v, i) => {
    const note = notes[i];
    const tip = v == null ? (note ? `${labels[i]}|집계 오류|${note}` : `${labels[i]} · 집계 전`) : `${labels[i]} · ${fmtNum(v)}${unit}`;
    const x = xOf(i);
    hits += `<g class="hit-g"><rect x="${(x - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" class="hit" data-tip="${esc(tip)}"/>`;
    if (v == null && note) hits += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PAD.t}" y2="${base}" class="note-mark"/>`;
    if (v != null) {
      hits += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PAD.t}" y2="${base}" class="guide"/><circle cx="${x.toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="4" fill="${color}" class="hover-dot"/>`;
    }
    hits += '</g>';
  });

  const defs =
    `<linearGradient id="ag-${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>` +
    `<filter id="gl-${id}" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  const empty = real.length === 0 ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="empty">집계 전</text>` : '';
  return frame(gridLines(max, unit) + marks + empty + xLabels(labels, xOf, maxLabels) + hits, defs, 'area');
}

/** 막대 차트. showValues 가 true 면 막대 위에 값 표시. */
export function barChart({ id, labels, values, color, unit = '', maxLabels = 8, showValues = false }) {
  const n = values.length;
  const max = Math.max(1, ...values) * (showValues ? 1.2 : 1.1);
  const inner = W - PAD.l - PAD.r;
  const slot = inner / n;
  const bw = Math.min(slot * 0.66, 34);
  const xC = (i) => PAD.l + slot * i + slot / 2;
  const base = H - PAD.b;

  let bars = '';
  let texts = '';
  let hits = '';
  values.forEach((v, i) => {
    const h = (base - PAD.t) * (v / max);
    const x = xC(i) - bw / 2;
    bars += `<rect x="${x.toFixed(1)}" y="${(base - Math.max(h, 2)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="3.5" fill="${color}" opacity="${v ? 1 : 0.22}" class="bar"/>`;
    if (showValues && v) texts += `<text x="${xC(i).toFixed(1)}" y="${(base - h - 6).toFixed(1)}" text-anchor="middle" class="bv">${fmtNum(v)}</text>`;
    hits += `<g class="hit-g"><rect x="${(xC(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" class="hit" data-tip="${esc(`${labels[i]} · ${fmtNum(v)}${unit}`)}"/>` +
      `<rect x="${x.toFixed(1)}" y="${(base - Math.max(h, 2)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="3.5" class="bar-hl"/></g>`;
  });

  const glow = `<filter id="gl-${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const g = `<g filter="url(#gl-${id})">${bars}</g>`;
  const axis = `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${base}" y2="${base}" class="grid solid"/>`;
  return frame(gridLines(max, unit, !showValues) + axis + g + texts + xLabels(labels, xC, maxLabels) + hits, glow, 'bars');
}

// 눈금이 깔끔하게 떨어지도록 최대값을 1, 1.5, 2, 3, 5, 7.5, 10 × 10^n 중 하나로 올림
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 3, 5, 7.5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/**
 * 이중 y축 영역 차트. 왼쪽 축 = left 시리즈, 오른쪽 축 = right 시리즈.
 * 두 축의 눈금(0, 1/2, 최대)은 같은 높이에 놓여 가로 격자선이 하나로 이어짐.
 * 값이 null 인 칸은 "집계 전"으로 비우고, 툴팁에는 두 값을 함께 보여줌.
 */
export function dualAreaChart({ id, labels, left, right, maxLabels = 8 }) {
  const DP = { l: 46, r: 46, t: 22, b: 24 };
  const n = labels.length;
  const inset = n > 1 ? 14 : 0;
  const xOf = (i) => DP.l + inset + (n > 1 ? (i / (n - 1)) * (W - DP.l - DP.r - inset * 2) : (W - DP.l - DP.r) / 2);
  const base = H - DP.b;
  const mk = (series) => {
    const max = niceMax(Math.max(0, ...series.values.filter((v) => v != null)) * 1.04);
    return { ...series, max, yOf: (v) => DP.t + (base - DP.t) * (1 - v / max) };
  };
  const L = mk(left);
  const R = mk(right);

  // 눈금: 같은 높이에 좌/우 라벨, 격자선은 하나
  let axes = '';
  [0, 0.5, 1].forEach((f) => {
    const y = DP.t + (base - DP.t) * (1 - f);
    if (f > 0) axes += `<line x1="${DP.l}" x2="${W - DP.r}" y1="${y}" y2="${y}" class="grid"/>`;
    axes += `<text x="${DP.l - 8}" y="${y + 4}" text-anchor="end" class="tick" fill="${L.color}">${f === 0 ? '0' : fmtCompact(L.max * f)}</text>`;
    axes += `<text x="${W - DP.r + 8}" y="${y + 4}" text-anchor="start" class="tick" fill="${R.color}">${f === 0 ? '0' : fmtCompact(R.max * f)}</text>`;
  });
  axes += `<line x1="${DP.l}" x2="${W - DP.r}" y1="${base}" y2="${base}" class="grid solid"/>`;

  const lastIdx = (vals) => vals.map((v) => v != null).lastIndexOf(true);
  const series = (S, sid) => {
    const vals = S.values;
    const runs = [];
    let cur = [];
    vals.forEach((v, i) => {
      if (v == null) { if (cur.length) runs.push(cur); cur = []; } else cur.push(i);
    });
    if (cur.length) runs.push(cur);
    let m = '';
    for (const run of runs) {
      if (run.length >= 2) {
        const d = run.map((i, k) => `${k ? 'L' : 'M'}${xOf(i).toFixed(1)} ${S.yOf(vals[i]).toFixed(1)}`).join(' ');
        m += `<path d="${d} L${xOf(run[run.length - 1]).toFixed(1)} ${base} L${xOf(run[0]).toFixed(1)} ${base} Z" fill="url(#ag-${id}-${sid})"/>`;
        m += `<path d="${d}" class="line" stroke="${S.color}" filter="url(#gl-${id})"/>`;
      } else {
        m += `<circle cx="${xOf(run[0]).toFixed(1)}" cy="${S.yOf(vals[run[0]]).toFixed(1)}" r="3.5" fill="${S.color}"/>`;
      }
    }
    const li = lastIdx(vals);
    if (li >= 0) m += `<circle cx="${xOf(li).toFixed(1)}" cy="${S.yOf(vals[li]).toFixed(1)}" r="4.5" fill="${S.color}" stroke="var(--stat-card)" stroke-width="2" filter="url(#gl-${id})"/>`;
    return m;
  };

  const slot = n > 1 ? (W - DP.l - DP.r - inset * 2) / (n - 1) : W;
  let hits = '';
  labels.forEach((lab, i) => {
    const x = xOf(i);
    const a = left.values[i];
    const b = right.values[i];
    const lines = [lab];
    if (a == null && b == null) lines.push('집계 전');
    else {
      lines.push(`${left.name} ${a == null ? '-' : fmtNum(a) + left.unit}`);
      lines.push(`${right.name} ${b == null ? '-' : fmtNum(b) + right.unit}`);
    }
    hits += `<g class="hit-g"><rect x="${(x - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" class="hit" data-tip="${esc(lines.join('|'))}"/>`;
    if (a != null || b != null) hits += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${DP.t}" y2="${base}" class="guide"/>`;
    if (a != null) hits += `<circle cx="${x.toFixed(1)}" cy="${L.yOf(a).toFixed(1)}" r="4" fill="${L.color}" class="hover-dot"/>`;
    if (b != null) hits += `<circle cx="${x.toFixed(1)}" cy="${R.yOf(b).toFixed(1)}" r="4" fill="${R.color}" class="hover-dot"/>`;
    hits += '</g>';
  });

  const grad = (sid, c) => `<linearGradient id="ag-${id}-${sid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".30"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
  const defs = grad('l', L.color) + grad('r', R.color) +
    `<filter id="gl-${id}" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const empty = left.values.every((v) => v == null) && right.values.every((v) => v == null)
    ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="empty">집계 전</text>` : '';
  const inner = axes + series(L, 'l') + series(R, 'r') + empty + xLabels(labels, xOf, maxLabels) + hits;
  return frame(inner, defs, 'area dual');
}
