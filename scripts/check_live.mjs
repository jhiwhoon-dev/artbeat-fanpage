// 30분마다 실행되어, 채널이 "지금 이 순간" 라이브 방송 중인지 확인하는 스크립트.
// search.list(eventType=live)는 호출당 100유닛으로 비싼 편이라, 이 스크립트만 따로 분리해
// 짧은 주기로 돌리고 나머지(영상 목록 동기화)는 하루 1회로 유지한다.

import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UCgZlBRLRB1-0l-qL9BkecLQ"; // ARTBEAT (@artbeat.official)
const API_KEY = process.env.YOUTUBE_API_KEY;
const OUT_PATH = path.join(process.cwd(), "src", "data", "live_status.json");

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다.");
  process.exit(1);
}

async function checkLive() {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("channelId", CHANNEL_ID);
  url.searchParams.set("eventType", "live");
  url.searchParams.set("type", "video");
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API(search.list) 요청 실패 (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.items?.[0] ?? null;
}

async function main() {
  const live = await checkLive();

  const status = {
    is_live: !!live,
    video_id: live?.id?.videoId ?? null,
    title: live?.snippet?.title ?? null,
    checked_at: new Date().toISOString(),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(status, null, 2) + "\n", "utf-8");
  console.log(status.is_live ? `현재 라이브 중: ${status.title}` : "현재 라이브 아님");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
