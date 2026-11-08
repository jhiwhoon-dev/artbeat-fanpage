// 영상 상세 페이지 "조회수 · 좋아요 추이" 구역용 계산 + SVG 문자열 생성.
//
// 이 파일은 두 곳에서 같이 쓰임:
//  - 빌드 때(VideoTrend.astro 머리말): 요약 카드, 전체 기간 누적 그래프, 기본 상태의 일별 그래프를 미리 그려 둠
//  - 브라우저(VideoTrend.astro 스크립트): 증가량/증가율, 꺾은선/막대, 7/14/30일 버튼을 눌렀을 때 일별 그래프만 다시 그림
// 그래서 Node 전용 모듈을 import하지 않는 순수 함수로만 구성함.
//
// 입력은 기록 배열 3개(dates, views, likes: 날짜 오름차순). 영상 한 편당 약 1~3KB라 페이지에 그대로 실어 보냄.
import { KNOWN_GAPS } from './stats.mjs';

export const COL = { v: '#4cc2ff', l: '#ff6fa5' };
const W = 560;
const H = 200;
const P = { l: 36, r: 36, t: 14, b: 26 };
const DAY = 864e5;

// 증가율을 비교할 때 기준값이 너무 작으면 몇 개만 늘어도 수백 %가 나오므로 후보에서 뺌
const MIN_BASE_VIEWS = 100;
const MIN_BASE_LIKES = 10;

export const fmt = (n) => Number(n).toLocaleString('ko-KR');
export const cmp = (n) => {
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '만';
  return n < 10 && !Number.isInteger(n) ? n.toFixed(1) : fmt(Math.round(n));
};
export const pct = (r) => {
  const a = Math.abs(r);
  return (r * 100).toFixed(a >= 1 ? 0 : a >= 0.001 ? 1 : 2) + '%';
};
export const lab = (d) => Number(d.slice(5, 7)) + '.' + Number(d.slice(8, 10));
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addDay = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const sgn = (n, u) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n)) + u;

function nice(v) {
  if (v <= 0) return 1;
  const m = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.5, 2, 3, 5, 7.5, 10]) if (k * m >= v) return k * m;
  return 10 * m;
}

/**
 * 기록 → 날짜별 칸(기록 없는 날은 null) + 기록 간 증가량/증가율 + 가장 가파른 날
 * step[i] = 직전 기록 대비 변화 (span = 직전 기록과의 간격 일수. 1이 아니면 여러 날 합산값)
 */
export function buildModel(dates, views, likes, gaps = KNOWN_GAPS) {
  const n = dates.length;
  const days = [];
  for (let d = dates[0]; d <= dates[n - 1]; d = addDay(d, 1)) days.push(d);
  const at = Object.fromEntries(days.map((d, i) => [d, i]));
  const V = days.map(() => null);
  const L = days.map(() => null);
  dates.forEach((d, j) => {
    V[at[d]] = views[j];
    L[at[d]] = likes[j];
  });
  const step = days.map(() => null);
  for (let j = 1; j < n; j++) {
    const span = dayDiff(dates[j - 1], dates[j]);
    const dv = views[j] - views[j - 1];
    const dl = likes[j] - likes[j - 1];
    step[at[dates[j]]] = {
      dv,
      dl,
      rv: views[j - 1] > 0 ? dv / views[j - 1] : null,
      rl: likes[j - 1] > 0 ? dl / likes[j - 1] : null,
      span,
      from: dates[j - 1],
      okV: span === 1 && views[j - 1] >= MIN_BASE_VIEWS,
      okL: span === 1 && likes[j - 1] >= MIN_BASE_LIKES,
    };
  }
  const best = (rk, ok) => {
    let b = -1;
    step.forEach((s, i) => {
      if (s && s[ok] && s[rk] != null && s[rk] > 0 && (b < 0 || s[rk] > step[b][rk])) b = i;
    });
    return b;
  };
  return { n, dates, views, likes, days, V, L, step, gaps, peakV: best('rv', 'okV'), peakL: best('rl', 'okL') };
}

// ---------------------------------------------------------------- 요약 카드
export function summaryCard(m, k) {
  const key = k === 'v' ? 'views' : 'likes';
  const arr = m[key];
  const cur = arr[m.n - 1];
  const col = COL[k];
  const unit = k === 'v' ? '회' : '개';
  const name = k === 'v' ? '조회수' : '좋아요';
  let d = '<div class="vt-delta"><span class="flat">직전 기록 없음</span></div>';
  if (m.n >= 2) {
    const prev = arr[m.n - 2];
    const diff = cur - prev;
    const r = prev > 0 ? diff / prev : null;
    const span = dayDiff(m.dates[m.n - 2], m.dates[m.n - 1]);
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const ar = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';
    d =
      `<div class="vt-delta"><b class="${cls}">${r == null ? '-' : ar + ' ' + pct(Math.abs(r))}</b>` +
      `<span class="cnt">(${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}${unit})</span>` +
      `<span class="base">${span === 1 ? '전일 대비' : lab(m.dates[m.n - 2]) + ' 대비'}</span></div>`;
  }
  return (
    `<article class="vt-card"><header><span class="l"><span class="dot" style="background:${col}"></span>${name}</span></header>` +
    `<div class="vt-kpi"><b style="color:${col}">${fmt(cur)}</b><span>${unit}</span></div>${d}</article>`
  );
}

// ---------------------------------------------------------------- 최고 증가율 (고정 표시)
export function peakBanner(m) {
  const mk = (k, i, rk, dk, key, nm, u) => {
    if (i < 0) return `<div class="vt-pk"><span>${nm} 최고 증가율</span><em>비교할 구간이 아직 없습니다</em></div>`;
    const st = m.step[i];
    const from = m[key][m.dates.indexOf(st.from)];
    const to = m[key][m.dates.indexOf(m.days[i])];
    return (
      `<div class="vt-pk" style="--c:${COL[k]}"><span>${nm} 최고 증가율</span><b>▲ ${pct(st[rk])}</b>` +
      `<em>${lab(m.days[i])} · +${fmt(st[dk])}${u} (${fmt(from)} → ${fmt(to)})</em></div>`
    );
  };
  return `<div class="vt-peaks">${mk('v', m.peakV, 'rv', 'dv', 'views', '조회수', '회')}${mk('l', m.peakL, 'rl', 'dl', 'likes', '좋아요', '개')}</div>`;
}

// ---------------------------------------------------------------- 전체 기간 누적 그래프 (좌: 조회수, 우: 좋아요)
export function areaSvg(m) {
  const { days, V, L } = m;
  const N = days.length;
  const base = H - P.b;
  const xo = (i) => P.l + 8 + (N > 1 ? (i / (N - 1)) * (W - P.l - P.r - 16) : 0);
  const mk = (a) => {
    const mx = nice(Math.max(...a.filter((x) => x != null)) * 1.04);
    return { mx, y: (v) => P.t + (base - P.t) * (1 - v / mx) };
  };
  const A = mk(V);
  const B = mk(L);

  let g = '';
  [0, 0.5, 1].forEach((f) => {
    const y = P.t + (base - P.t) * (1 - f);
    if (f > 0) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" class="gridl"/>`;
    g +=
      `<text x="${P.l - 8}" y="${y + 4}" text-anchor="end" class="tick" fill="${COL.v}">${f ? cmp(A.mx * f) : 0}</text>` +
      `<text x="${W - P.r + 8}" y="${y + 4}" class="tick" fill="${COL.l}">${f ? cmp(B.mx * f) : 0}</text>`;
  });
  g += `<line x1="${P.l}" x2="${W - P.r}" y1="${base}" y2="${base}" class="gridl solid"/>`;

  // 가장 가파른 구간(직전 기록 ~ 해당 기록) 띠 + 해당 시점 강조 점. 글자는 그래프 위 고정 칸에서 보여줌.
  const peaks = [['v', m.peakV], ['l', m.peakL]].filter((p) => p[1] >= 0);
  const same = m.peakV >= 0 && m.peakV === m.peakL;
  let bands = '';
  let marks = '';
  peaks.forEach(([k, i]) => {
    const from = days.indexOf(m.step[i].from);
    bands += `<rect x="${xo(from)}" y="${P.t}" width="${xo(i) - xo(from)}" height="${base - P.t}" fill="${COL[k]}" opacity="${same ? 0.12 : 0.16}" rx="3"/>`;
    const a = k === 'v' ? V : L;
    const Y = k === 'v' ? A.y : B.y;
    marks += `<circle cx="${xo(i)}" cy="${Y(a[i])}" r="6" fill="none" stroke="${COL[k]}" stroke-width="2"/><circle cx="${xo(i)}" cy="${Y(a[i])}" r="2.5" fill="${COL[k]}"/>`;
  });

  // 기록이 없는 날(집계 오류 등)은 선을 이어서 그리고 점선 표시만 남김
  const run = (a) => a.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  const pathOf = (a, Y) => run(a).map((i, k) => (k ? 'L' : 'M') + xo(i).toFixed(1) + ' ' + Y(a[i]).toFixed(1)).join(' ');
  const fills = (a, Y, id) => {
    const r = run(a);
    return r.length >= 2 ? `<path d="${pathOf(a, Y)} L${xo(r[r.length - 1])} ${base} L${xo(r[0])} ${base}Z" fill="url(#vtag${id})"/>` : '';
  };
  const lines = (a, Y, c) => {
    const r = run(a);
    const li = r[r.length - 1];
    return (
      (r.length >= 2 ? `<path d="${pathOf(a, Y)}" class="vt-line" stroke="${c}" filter="url(#vtgl)"/>` : '') +
      `<circle cx="${xo(li)}" cy="${Y(a[li])}" r="4.5" fill="${c}" stroke="#131318" stroke-width="2" filter="url(#vtgl)"/>`
    );
  };

  let notes = '';
  days.forEach((d, i) => {
    if (V[i] == null && m.gaps[d]) notes += `<line x1="${xo(i)}" x2="${xo(i)}" y1="${P.t}" y2="${base}" class="note-mark"/>`;
  });

  const stepX = Math.ceil((N - 1) / 6) || 1;
  let xl = '';
  for (let i = 0; i < N; i += stepX) xl += `<text x="${xo(i)}" y="${H - 7}" text-anchor="middle" class="xl">${lab(days[i])}</text>`;
  if ((N - 1) % stepX) xl += `<text x="${xo(N - 1)}" y="${H - 7}" text-anchor="middle" class="xl">${lab(days[N - 1])}</text>`;

  const slot = N > 1 ? (W - P.l - P.r - 16) / (N - 1) : W;
  let hits = '';
  days.forEach((d, i) => {
    hits +=
      `<rect class="hit" data-i="${i}" data-x="${xo(i).toFixed(1)}" data-yv="${V[i] == null ? '' : A.y(V[i]).toFixed(1)}" data-yl="${L[i] == null ? '' : B.y(L[i]).toFixed(1)}"` +
      ` x="${(xo(i) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}"/>`;
  });

  const defs =
    `<defs><linearGradient id="vtagv" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${COL.v}" stop-opacity=".3"/><stop offset="1" stop-color="${COL.v}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="vtagl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${COL.l}" stop-opacity=".3"/><stop offset="1" stop-color="${COL.l}" stop-opacity="0"/></linearGradient>` +
    `<filter id="vtgl" filterUnits="userSpaceOnUse" x="0" y="-20" width="${W}" height="${H + 40}"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" class="vt-area">${defs}${g}${bands}${notes}${fills(V, A.y, 'v')}${fills(L, B.y, 'l')}${lines(V, A.y, COL.v)}${lines(L, B.y, COL.l)}${marks}${xl}` +
    `<line class="guide" y1="${P.t}" y2="${base}"/><circle class="hdot dv" r="4" fill="${COL.v}"/><circle class="hdot dl" r="4" fill="${COL.l}"/>${hits}</svg>`
  );
}

// ---------------------------------------------------------------- 최근 일별 증가량/증가율 (꺾은선 또는 막대)
// key: 'dv'(조회수) | 'dl'(좋아요), mode: 'count'|'rate', s0: 표시를 시작할 날짜 칸 번호, shape: 'line'|'bar'
export function dailySvg(m, key, mode, s0, shape) {
  const N = m.days.length;
  const c = COL[key === 'dv' ? 'v' : 'l'];
  const rk = key === 'dv' ? 'rv' : 'rl';
  const peak = key === 'dv' ? m.peakV : m.peakL;
  const idx = [];
  for (let i = s0; i < N; i++) idx.push(i);
  const n = idx.length;
  const vals = idx.map((i) => {
    const s = m.step[i];
    return s ? (mode === 'rate' ? s[rk] : s[key]) : null;
  });
  const mx = nice(Math.max(1e-9, ...vals.filter((v) => v != null)) * 1.1);
  const Hh = 170;
  const pt = 14;
  const base = Hh - 24;
  const x0 = P.l + 8;
  const x1 = W - 14;
  const slot = (x1 - x0) / n;
  const xc = (k) => x0 + slot * k + slot / 2;
  const y = (v) => base - ((base - pt) * Math.max(v, 0)) / mx;
  const T = (v) => (mode === 'rate' ? pct(v) : cmp(v));

  let g = '';
  [0.5, 1].forEach((f) => {
    g += `<line x1="${P.l}" x2="${x1}" y1="${y(mx * f)}" y2="${y(mx * f)}" class="gridl"/>`;
  });
  [0, 0.5, 1].forEach((f) => {
    g += `<text x="${P.l - 8}" y="${y(mx * f) + 4}" text-anchor="end" class="tick" fill="${c}">${f ? T(mx * f) : 0}</text>`;
  });
  g += `<line x1="${P.l}" x2="${x1}" y1="${base}" y2="${base}" class="gridl solid"/>`;

  let gp = '';
  let body = '';
  let hits = '';
  idx.forEach((i, k) => {
    if (m.V[i] == null && m.gaps[m.days[i]]) gp += `<line x1="${xc(k)}" x2="${xc(k)}" y1="${pt}" y2="${base}" class="note-mark"/>`;
    hits += `<rect class="hit" data-b="${i}" data-x="${xc(k).toFixed(1)}" x="${(xc(k) - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${Hh}"/>`;
  });

  if (shape === 'bar') {
    const bw = Math.min(slot * 0.66, 30);
    idx.forEach((i, k) => {
      const v = vals[k];
      const st = m.step[i];
      if (v == null) return;
      const ht = Math.max(2, base - y(v));
      const pk = i === peak;
      body += `<rect x="${xc(k) - bw / 2}" y="${base - ht}" width="${bw}" height="${ht}" rx="3.5" fill="${c}" opacity="${pk ? 1 : 0.5}"${st.span > 1 ? ` stroke="${c}" stroke-dasharray="3 3" fill-opacity=".25"` : ''}/>`;
      if (pk) body += `<text x="${xc(k)}" y="${base - ht - 6}" text-anchor="middle" class="callout" fill="${c}">▲ ${mode === 'rate' ? pct(v) : '+' + fmt(v)}</text>`;
    });
  } else {
    const pts = idx.map((i, k) => (vals[k] == null ? null : [xc(k), y(vals[k]), i])).filter(Boolean);
    if (pts.length > 1) {
      const d = pts.map((q, j) => (j ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
      body += `<path d="${d} L${pts[pts.length - 1][0]} ${base} L${pts[0][0]} ${base}Z" fill="url(#vtgd${key})"/><path d="${d}" class="vt-line" stroke="${c}" filter="url(#vtgl2)"/>`;
    }
    pts.forEach((q) => {
      const pk = q[2] === peak;
      const sp = m.step[q[2]].span > 1;
      body += pk
        ? `<circle cx="${q[0]}" cy="${q[1]}" r="6" fill="none" stroke="${c}" stroke-width="2"/><circle cx="${q[0]}" cy="${q[1]}" r="2.8" fill="${c}"/>`
        : `<circle cx="${q[0]}" cy="${q[1]}" r="${n > 16 ? 2 : 2.8}" fill="${sp ? '#131318' : c}" stroke="${c}" stroke-width="1.4"/>`;
    });
  }

  const stepX = Math.ceil(n / 7) || 1;
  let xl = '';
  for (let k = 0; k < n; k += stepX) xl += `<text x="${xc(k)}" y="${Hh - 6}" text-anchor="middle" class="xl">${lab(m.days[idx[k]])}</text>`;
  const defs =
    `<defs><linearGradient id="vtgd${key}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>` +
    `<filter id="vtgl2" filterUnits="userSpaceOnUse" x="0" y="-20" width="${W}" height="${Hh + 40}"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" class="vt-daily" data-key="${key}">${defs}${g}${gp}${body}${xl}<line class="guide" y1="${pt}" y2="${base}"/>${hits}</svg>`;
}

// ---------------------------------------------------------------- 툴팁 (브라우저에서만 호출)
export function areaTip(m, i) {
  const d = m.days[i];
  const s = m.step[i];
  if (m.V[i] == null) {
    return m.gaps[d]
      ? `<div class="t">${lab(d)}</div><div class="w">집계 오류</div><div>${m.gaps[d]}</div>`
      : `<div class="t">${lab(d)}</div><div>기록 없음</div>`;
  }
  let h = `<div class="t">${lab(d)}</div><div style="color:${COL.v}">누적 조회수 ${fmt(m.V[i])}회</div><div style="color:${COL.l}">누적 좋아요 ${fmt(m.L[i])}개</div>`;
  if (s) {
    const sp = s.span > 1 ? ` (${lab(s.from)}→${lab(d)} ${s.span}일 합산)` : '';
    h +=
      `<div class="t" style="margin-top:3px">${s.span > 1 ? '직전 기록 대비' : '전일 대비'}${sp}</div>` +
      `<div>조회수 ${s.rv == null ? '-' : (s.rv >= 0 ? '▲' : '▼') + pct(Math.abs(s.rv))} (${sgn(s.dv, '회')})</div>` +
      `<div>좋아요 ${s.rl == null ? '-' : (s.rl >= 0 ? '▲' : '▼') + pct(Math.abs(s.rl))} (${sgn(s.dl, '개')})</div>`;
  }
  return h;
}

export function dailyTip(m, key, i) {
  const s = m.step[i];
  const d = m.days[i];
  let h = `<div class="t">${lab(d)}</div>`;
  if (!s) {
    return h + (m.V[i] == null && m.gaps[d] ? `<div class="w">집계 오류</div><div>${m.gaps[d]}</div>` : '<div>비교할 직전 기록 없음</div>');
  }
  const rk = key === 'dv' ? 'rv' : 'rl';
  const u = key === 'dv' ? '회' : '개';
  const nm = key === 'dv' ? '조회수' : '좋아요';
  h += `<div style="color:${COL[key === 'dv' ? 'v' : 'l']}">${nm} ${sgn(s[key], u)}</div>`;
  h += `<div>${s[rk] == null ? '-' : (s[rk] >= 0 ? '▲' : '▼') + pct(Math.abs(s[rk]))}${s.span > 1 ? ` · ${s.span}일 합산` : ''}</div>`;
  if ((key === 'dv' ? m.peakV : m.peakL) === i) h += '<div class="t" style="margin-top:3px">이 영상에서 증가율이 가장 높았던 날</div>';
  return h;
}

export { addDay, dayDiff };

// 일별 그래프 아래 안내 문구: 최고 증가율 날짜가 표시 기간 밖이면 위 그래프에서 보라고 알려줌
export function dailyCaption(m, s0) {
  const out = [m.peakV, m.peakL].filter((i) => i >= 0 && i < s0).map((i) => lab(m.days[i]));
  const uniq = [...new Set(out)];
  return (
    '위 그래프는 기록 전체 기간, 아래는 최근 며칠의 하루 변화입니다.' +
    (uniq.length ? ` 최고 증가율 날짜(${uniq.join(', ')})는 이 기간 밖이라 위 그래프에서 확인할 수 있어요.` : '') +
    ' 속이 빈 점·점선은 기록이 하루 이상 비어 있던 구간의 합산값입니다.' +
    (Object.keys(m.gaps).some((d) => m.days.includes(d)) ? ' 주황 점선은 집계 오류가 있었던 날입니다.' : '')
  );
}
