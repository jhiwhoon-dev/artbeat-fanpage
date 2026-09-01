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

// ISO 8601 길이(예: "PT45S", "PT4M13S")를 초 단위로 변환
function parseDurationToSeconds(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

// Shorts 판별: 유튜브 기준(3분 이하)을 그대로 사용
const SHORTS_MAX_SECONDS = 180;

async function fetchVideoDetails(videoIds) {
  if (videoIds.length === 0) return {};
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "contentDetails,statistics,liveStreamingDetails");
  url.searchParams.set("id", videoIds.join(","));
  url.searchParams.set("key", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API(videos.list) 요청 실패 (${res.status}): ${body}`);
  }
  const data = await res.json();

  const details = {};
  for (const item of data.items ?? []) {
    const seconds = parseDurationToSeconds(item.contentDetails.duration);
    // liveStreamingDetails가 있으면(과거에 실시간 스트리밍했던 기록) live로 추정,
    // 아니면 길이 기준으로 short/video 추정. 어느 쪽이든 나중에 사람이 직접 덮어쓸 수 있음.
    let contentType = "video";
    if (item.liveStreamingDetails) contentType = "live";
    else if (seconds <= SHORTS_MAX_SECONDS) contentType = "short";

    details[item.id] = {
      seconds,
      view_count: Number(item.statistics?.viewCount ?? 0),
      content_type: contentType,
    };
  }
  return details;
}

function loadExistingVideos() {
  if (!fs.existsSync(VIDEOS_PATH)) return [];
  return JSON.parse(fs.readFileSync(VIDEOS_PATH, "utf-8"));
}

async function main() {
  const items = await fetchLatestUploads();
  const existing = loadExistingVideos();
  const existingIds = new Set(existing.map((v) => v.youtube_id));

  const candidates = items.filter(
    (item) => !existingIds.has(item.snippet.resourceId.videoId)
  );

  if (candidates.length === 0) {
    console.log("새로운 영상이 없습니다.");
    return;
  }

  const details = await fetchVideoDetails(
    candidates.map((item) => item.snippet.resourceId.videoId)
  );

  const newVideos = candidates.map((item) => {
    const id = item.snippet.resourceId.videoId;
    const d = details[id];
    return {
      youtube_id: id,
      title: item.snippet.title,
      covered_group: [], // 수동 태깅 필요
      tagged_members: [], // 수동 태깅 필요 (참여 멤버 id 배열)
      published_date: item.snippet.publishedAt.slice(0, 10),
      content_type: d ? d.content_type : "video", // video / short / live — 필요시 직접 수정 가능
      view_count: d ? d.view_count : 0,
    };
  });

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
