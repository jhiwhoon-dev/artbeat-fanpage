// 매일 실행되는 전체 동기화 스크립트.
// 1) 채널의 "업로드" 재생목록을 끝까지 페이지네이션하며 전체 영상 ID를 모으고
// 2) 각 영상의 길이/조회수/라이브 여부를 조회한 뒤
// 3) 기존 videos.json과 병합한다.
//    - 이미 있던 영상: view_count만 갱신, content_type은 없을 때만 채움,
//      covered_group / tagged_members 등 손으로 넣은 값은 절대 안 건드림
//    - 새로 발견된 영상: covered_group: [] / tagged_members: [] 로 새로 추가 (수동 태깅 필요)

import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UCgZlBRLRB1-0l-qL9BkecLQ"; // ARTBEAT (@artbeat.official)
const UPLOADS_PLAYLIST_ID = CHANNEL_ID.replace(/^UC/, "UU");
const API_KEY = process.env.YOUTUBE_API_KEY;
const VIDEOS_PATH = path.join(process.cwd(), "src", "data", "videos.json");
const SHORTS_MAX_SECONDS = 180;

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다. GitHub Secret 설정을 확인하세요.");
  process.exit(1);
}

function parseDurationToSeconds(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 채널 업로드 재생목록을 끝까지 페이지네이션하며 전체 항목 수집
async function fetchAllPlaylistItems() {
  let items = [];
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", UPLOADS_PLAYLIST_ID);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", API_KEY);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API(playlistItems) 요청 실패 (${res.status}): ${body}`);
    }
    const data = await res.json();
    items = items.concat(data.items ?? []);
    pageToken = data.nextPageToken ?? "";
    console.log(`  ...누적 ${items.length}개 조회됨`);
  } while (pageToken);

  return items;
}

// 영상 id 목록의 길이/조회수/라이브 여부를 50개씩 나눠서 조회
async function fetchDetailsForIds(ids) {
  const details = {};
  for (const group of chunk(ids, 50)) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "contentDetails,statistics,liveStreamingDetails");
    url.searchParams.set("id", group.join(","));
    url.searchParams.set("key", API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API(videos.list) 요청 실패 (${res.status}): ${body}`);
    }
    const data = await res.json();

    for (const item of data.items ?? []) {
      const seconds = parseDurationToSeconds(item.contentDetails.duration);
      let contentType = "video";
      if (item.liveStreamingDetails) contentType = "live";
      else if (seconds <= SHORTS_MAX_SECONDS) contentType = "short";

      details[item.id] = {
        view_count: Number(item.statistics?.viewCount ?? 0),
        content_type: contentType,
      };
    }
  }
  return details;
}

async function main() {
  console.log("채널 업로드 목록 전체 조회 중...");
  const playlistItems = await fetchAllPlaylistItems();
  console.log(`총 ${playlistItems.length}개 영상 발견`);

  const allIds = playlistItems.map((i) => i.snippet.resourceId.videoId);
  console.log("영상별 길이/조회수/라이브 여부 조회 중...");
  const details = await fetchDetailsForIds(allIds);

  const existing = fs.existsSync(VIDEOS_PATH)
    ? JSON.parse(fs.readFileSync(VIDEOS_PATH, "utf-8"))
    : [];
  const existingMap = Object.fromEntries(existing.map((v) => [v.youtube_id, v]));

  let addedCount = 0;
  let updatedCount = 0;

  const merged = playlistItems.map((item) => {
    const id = item.snippet.resourceId.videoId;
    const d = details[id];
    const prev = existingMap[id];

    if (prev) {
      updatedCount++;
      return {
        ...prev, // covered_group, tagged_members, title 등 기존 값 전부 유지
        view_count: d ? d.view_count : prev.view_count ?? 0,
        content_type: prev.content_type ?? (d ? d.content_type : "video"), // 이미 있으면 안 건드림
      };
    }

    addedCount++;
    return {
      youtube_id: id,
      title: item.snippet.title,
      covered_group: [], // 수동 태깅 필요
      tagged_members: [], // 수동 태깅 필요
      published_date: item.snippet.publishedAt.slice(0, 10),
      content_type: d ? d.content_type : "video",
      view_count: d ? d.view_count : 0,
    };
  });

  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`\n완료: 신규 ${addedCount}개, 기존 갱신 ${updatedCount}개, 총 ${merged.length}개`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
