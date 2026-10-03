// 채널 전체(구독자 수 / 총 조회수 / 업로드 영상 수)를 가져와서,
// 1) channel.json의 표시용 숫자(SUBSCRIBERS/TOTAL VIEWS/VIDEOS UPLOADED)를 최신 값으로 갱신하고
// 2) 구독자 수는 날짜별로 subscriber_history.json에 계속 쌓아서 "구독자 수 추이" 그래프의 재료로 씀.
// channels.list는 호출당 1유닛이라 아주 저렴함(하루 1회 = 1유닛).

import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UCgZlBRLRB1-0l-qL9BkecLQ"; // ARTBEAT (@artbeat.official) — sync_videos.mjs와 동일
const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_DIR = path.join(process.cwd(), "src", "data");
const CHANNEL_PATH = path.join(DATA_DIR, "channel.json");
const HISTORY_PATH = path.join(DATA_DIR, "subscriber_history.json");

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다. GitHub Secret 설정을 확인하세요.");
  process.exit(1);
}

// 1200000 -> "1.2M", 27000000000 -> "27B", 7500 -> "7.5K" 같은 식으로, 기존 channel.json에 쓰여있던
// 표기 스타일(정수면 소수점 없이, 아니면 소수점 1자리)에 맞춰 변환.
function formatCount(n) {
  const fmt = (v, suffix) => {
    const rounded = Math.round(v * 10) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + suffix;
  };
  if (n >= 1e9) return fmt(n / 1e9, "B");
  if (n >= 1e6) return fmt(n / 1e6, "M");
  if (n >= 1e3) return fmt(n / 1e3, "K");
  return String(n);
}

async function main() {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", CHANNEL_ID);
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API(channels.list) 요청 실패 (${res.status}): ${body}`);
  }
  const data = await res.json();
  const stats = data.items?.[0]?.statistics;
  if (!stats) {
    throw new Error("채널 통계를 가져오지 못했습니다 (채널 ID를 확인해주세요).");
  }

  const subscriberCount = Number(stats.subscriberCount ?? 0);
  const totalViewCount = Number(stats.viewCount ?? 0);
  const videoCount = Number(stats.videoCount ?? 0);

  // channel.json: tagline/description처럼 사람이 직접 쓰는 필드는 그대로 두고, 숫자 표시 필드만 갱신
  const prevChannel = fs.existsSync(CHANNEL_PATH) ? JSON.parse(fs.readFileSync(CHANNEL_PATH, "utf-8")) : {};
  const newChannel = {
    ...prevChannel,
    subscribers: formatCount(subscriberCount),
    total_views: formatCount(totalViewCount),
    videos_uploaded: formatCount(videoCount),
  };
  fs.writeFileSync(CHANNEL_PATH, JSON.stringify(newChannel, null, 2) + "\n", "utf-8");

  // 구독자 수 추이 — 날짜 하나당 1개 기록(하루에 여러 번 돌려도 오늘 기록은 갱신만 되고 안 늘어남).
  // 영상별 view_history와 달리 채널 전체 통째로 하나뿐이라 양이 아주 작아서, 연도별로 나눌 필요 없이 파일 하나로 계속 누적해도 안전함.
  const today = new Date().toISOString().slice(0, 10);
  const history = fs.existsSync(HISTORY_PATH) ? JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8")) : [];
  if (history.length > 0 && history[history.length - 1].date === today) {
    history[history.length - 1] = { date: today, subscribers: subscriberCount };
  } else {
    history.push({ date: today, subscribers: subscriberCount });
  }
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");

  console.log(`완료: 구독자 ${subscriberCount.toLocaleString()}명(${formatCount(subscriberCount)}) / 총 조회수 ${formatCount(totalViewCount)} / 영상 수 ${formatCount(videoCount)}`);
  console.log(`구독자 추이 기록: 총 ${history.length}일치`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
