// GitHub Actions가 주기적으로 실행하는 스크립트.
// 채널의 "업로드 목록" 재생목록에서 최신 영상 50개를 가져와,
// videos.json에 없는 영상만 새로 추가한다.
// covered_group은 API가 알 수 없는 정보라 항상 빈 배열([])로 추가되며,
// 이후 사람이 직접 채워 넣어야 한다 (수동 태깅).

import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UCgZlBRLRB1-0l-qL9BkecLQ"; // ARTBEAT (@artbeat.official)
const UPLOADS_PLAYLIST_ID = CHANNEL_ID.replace(/^UC/, "UU");
const API_KEY = process.env.YOUTUBE_API_KEY;
const VIDEOS_PATH = path.join(process.cwd(), "src", "data", "videos.json");

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다. GitHub Secret 설정을 확인하세요.");
  process.exit(1);
}

async function fetchLatestUploads() {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("playlistId", UPLOADS_PLAYLIST_ID);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API 요청 실패 (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.items ?? [];
}

function loadExistingVideos() {
  if (!fs.existsSync(VIDEOS_PATH)) return [];
  return JSON.parse(fs.readFileSync(VIDEOS_PATH, "utf-8"));
}

async function main() {
  const items = await fetchLatestUploads();
  const existing = loadExistingVideos();
  const existingIds = new Set(existing.map((v) => v.youtube_id));

  const newVideos = items
    .filter((item) => !existingIds.has(item.snippet.resourceId.videoId))
    .map((item) => ({
      youtube_id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      covered_group: [], // 수동 태깅 필요
      published_date: item.snippet.publishedAt.slice(0, 10),
    }));

  if (newVideos.length === 0) {
    console.log("새로운 영상이 없습니다.");
    return;
  }

  const merged = [...newVideos, ...existing];
  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");

  console.log(`새 영상 ${newVideos.length}개 추가됨:`);
  newVideos.forEach((v) => console.log(`  - [${v.published_date}] ${v.title}`));
  console.log("\ncovered_group이 빈 배열([])인 영상은 태그를 직접 채워주세요.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
