// videos / shorts 탭 통계 그래프용 집계 (빌드 시점에 한 번 계산되고, 브라우저로는 완성된 SVG만 전달됨).
//
// 입력: 해당 탭에 해당하는 영상 목록(videos.json 항목), 영상별 스냅샷 조회 함수(getViewHistory)
// 출력: 오늘 증가분, 일별 업로드, 연간 업로드/조회수/좋아요(업로드 연도 기준 + 연간 증가분 기준)
//
// 날짜 기준은 모두 KST(한국 시간). 스냅샷 날짜는 sync_videos.mjs가 저장한 값을 그대로 씀.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDateString(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortLabel(dateStr) {
  return `${Number(dateStr.slice(5, 7))}.${Number(dateStr.slice(8, 10))}`;
}

/**
 * @param videos         해당 탭의 영상 배열 (youtube_id, published_date, view_count, like_count)
 * @param getHistory     (youtube_id) => [{date, views, likes}, ...] 날짜 오름차순
 * @param opts.foundedYear  연도 축 시작 연도
 * @param opts.now       기준 시각(테스트용)
 */
export function buildStats(videos, getHistory, opts = {}) {
  const now = opts.now ?? new Date();
  const today = kstDateString(now);
  const thisYear = Number(today.slice(0, 4));

  // ---------- 연도 축 ----------
  const years = videos
    .map((v) => Number(String(v.published_date ?? '').slice(0, 4)))
    .filter((y) => y > 1990);
  const startYear = Math.min(opts.foundedYear ?? thisYear, ...(years.length ? years : [thisYear]));
  const endYear = Math.max(thisYear, ...years);
  const yearLabels = [];
  for (let y = startYear; y <= endYear; y++) yearLabels.push(String(y));

  // ---------- 업로드 연도 기준 ----------
  const uploadsByYear = Object.fromEntries(yearLabels.map((y) => [y, 0]));
  const viewsByYear = { ...uploadsByYear };
  const likesByYear = { ...uploadsByYear };
  for (const v of videos) {
    const y = String(v.published_date ?? '').slice(0, 4);
    if (!(y in uploadsByYear)) continue;
    uploadsByYear[y] += 1;
    viewsByYear[y] += v.view_count ?? 0;
    likesByYear[y] += v.like_count ?? 0;
  }

  // ---------- 스냅샷 기반: 연간 증가분 / 일별 증가분 / 오늘 증가분 ----------
  const gainViewsByYear = Object.fromEntries(yearLabels.map((y) => [y, 0]));
  const gainLikesByYear = { ...gainViewsByYear };
  const dayViews = {}; // { 'YYYY-MM-DD': 해당 날짜에 늘어난 조회수 } (오늘 제외)
  const dayLikes = {};
  let firstSnapshot = null; // 기록이 시작된 날짜
  let todayViews = 0;
  let todayLikes = 0;

  for (const v of videos) {
    const hist = getHistory(v.youtube_id).filter((e) => e.date < today);
    const published = String(v.published_date ?? '');

    // 과거 구간: 연속한 스냅샷 사이의 차이를 뒤쪽 날짜에 귀속
    let prev = null;
    for (const cur of hist) {
      if (!firstSnapshot || cur.date < firstSnapshot) firstSnapshot = cur.date;
      let dv = 0;
      let dl = 0;
      if (prev) {
        dv = cur.views - prev.views;
        dl = cur.likes - prev.likes;
      } else if (cur.date === published) {
        dv = cur.views; // 업로드 당일에 처음 잡힌 영상은 그 값 전체가 증가분
        dl = cur.likes;
      }
      if (dv < 0) dv = 0;
      if (dl < 0) dl = 0;
      if (dv || dl) {
        const y = cur.date.slice(0, 4);
        if (y in gainViewsByYear) {
          gainViewsByYear[y] += dv;
          gainLikesByYear[y] += dl;
        }
        dayViews[cur.date] = (dayViews[cur.date] ?? 0) + dv;
        dayLikes[cur.date] = (dayLikes[cur.date] ?? 0) + dl;
      }
      prev = cur;
    }

    // 오늘: 현재 값 − 오늘 이전 마지막 스냅샷 (없으면 오늘 올라온 영상만 전체를 증가분으로)
    const cv = v.view_count ?? 0;
    const cl = v.like_count ?? 0;
    if (prev) {
      todayViews += Math.max(0, cv - prev.views);
      todayLikes += Math.max(0, cl - prev.likes);
    } else if (published === today) {
      todayViews += cv;
      todayLikes += cl;
    }
  }

  // 오늘 증가분도 연간 증가분에 반영 (기록이 있는 해에만)
  const firstSnapshotYear = firstSnapshot ? firstSnapshot.slice(0, 4) : null;
  if (todayYearOk(gainViewsByYear, today)) {
    gainViewsByYear[today.slice(0, 4)] += todayViews;
    gainLikesByYear[today.slice(0, 4)] += todayLikes;
  }
  // 스냅샷이 시작되기 전 연도는 "집계 전"(null)
  const gainYears = (obj) =>
    yearLabels.map((y) => (firstSnapshotYear && y >= firstSnapshotYear ? obj[y] : null));

  // 최근 14일 일별 증가분 (마지막 칸은 오늘)
  const trendDates = [];
  for (let i = 13; i >= 0; i--) trendDates.push(addDays(today, -i));
  const trendViews = trendDates.map((d) => (d === today ? todayViews : dayViews[d] ?? null));
  const trendLikes = trendDates.map((d) => (d === today ? todayLikes : dayLikes[d] ?? null));
  // 기록이 시작되기 전 날짜는 null(집계 전)
  const beforeStart = (d) => !firstSnapshot || d < firstSnapshot;
  for (let i = 0; i < trendDates.length; i++) {
    if (trendDates[i] !== today && beforeStart(trendDates[i])) {
      trendViews[i] = null;
      trendLikes[i] = null;
    }
  }
  const yesterday = addDays(today, -1);

  // ---------- 일별 업로드 (최근 30일) ----------
  const dailyDates = [];
  for (let i = 29; i >= 0; i--) dailyDates.push(addDays(today, -i));
  const dailyCount = Object.fromEntries(dailyDates.map((d) => [d, 0]));
  for (const v of videos) {
    const d = String(v.published_date ?? '');
    if (d in dailyCount) dailyCount[d] += 1;
  }

  return {
    firstSnapshot,
    today: { date: today, views: todayViews, likes: todayLikes, yesterdayViews: dayViews[yesterday] ?? null, yesterdayLikes: dayLikes[yesterday] ?? null },
    trend: { labels: trendDates.map(shortLabel), views: trendViews, likes: trendLikes },
    daily: { labels: dailyDates.map(shortLabel), values: dailyDates.map((d) => dailyCount[d]) },
    yearly: {
      labels: yearLabels,
      uploads: yearLabels.map((y) => uploadsByYear[y]),
      byUpload: { views: yearLabels.map((y) => viewsByYear[y]), likes: yearLabels.map((y) => likesByYear[y]) },
      byGain: { views: gainYears(gainViewsByYear), likes: gainYears(gainLikesByYear) },
    },
  };
}

function todayYearOk(obj, today) {
  return today.slice(0, 4) in obj;
}
