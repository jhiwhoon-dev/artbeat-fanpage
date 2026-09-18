// ARTBEAT v 전용 동기화 스크립트. 채널 전체가 아니라 "지정된 재생목록" 하나만 대상으로 함.
// 1) 재생목록(PLAYLIST_ID)을 끝까지 페이지네이션하며 그 안의 영상 전체를 모으고
// 2) 각 영상의 조회수를 조회한 뒤
// 3) 기존 artbeat_v_videos.json과 병합한다.
//    - 이미 있던 영상: view_count만 갱신, tagged_members는 "필드 자체가 없을 때만" 자동 추천으로 채움,
//      category / role_mapping 등 손으로 넣은 값은 절대 안 건드림
//    - 새로 발견된 영상: 제목+설명란을 스캔해서 ARTBEAT v 소속 멤버(members.json의 artbeat_v 필드가 있는
//      멤버)만 후보로 놓고 tagged_members를 "자동 추천"으로 채워 넣음 (틀릴 수 있으니 꼭 검수 필요).
//      category는 자동 분류 기준이 없어서 항상 비워두고, 사람이 직접 mv/teaser/trailer/behind/stage/vlog/live
//      중 하나로 채워야 함.
//
// ⚠️ 재생목록에 안 들어있는 영상은 이 스크립트가 절대 못 찾음 — 재생목록에 추가하거나,
//    videos.json처럼 artbeat_v_videos.json에 직접 수동으로 추가해야 함.

import fs from "node:fs";
import path from "node:path";

const PLAYLIST_ID = "PLg4JVHLUluEuXtEBafN6TPyATt0dWr9v3"; // ARTBEAT v 전용 재생목록
const API_KEY = process.env.YOUTUBE_API_KEY;
const VIDEOS_PATH = path.join(process.cwd(), "src", "data", "artbeat_v_videos.json");
const MEMBERS_PATH = path.join(process.cwd(), "src", "data", "members.json");

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다. GitHub Secret 설정을 확인하세요.");
  process.exit(1);
}

const allMembers = JSON.parse(fs.readFileSync(MEMBERS_PATH, "utf-8"));
// ARTBEAT v 소속 멤버만 후보로 사용 (artbeat_v 필드가 있는 멤버) — 다른 멤버 이름과 겹쳐서
// 엉뚱하게 태깅되는 걸 방지하기 위함
const artbeatVMembers = allMembers.filter((m) => m.artbeat_v);

function nameCandidates(member) {
  if (member.nickname) return [member.nickname];
  const candidates = [member.name];
  if (member.name.length > 2) candidates.push(member.name.slice(1));
  return candidates;
}

function suggestTaggedMembers(text) {
  const found = [];
  for (const m of artbeatVMembers) {
    if (!m.name) continue;
    if (nameCandidates(m).some((c) => text.includes(c))) {
      found.push(m.id);
    }
  }
  return found;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 재생목록을 끝까지 페이지네이션하며 전체 항목 수집
async function fetchAllPlaylistItems() {
  let items = [];
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", PLAYLIST_ID);
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

// 영상 id 목록의 조회수를 50개씩 나눠서 조회
async function fetchViewCounts(ids) {
  const views = {};
  for (const group of chunk(ids, 50)) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", group.join(","));
    url.searchParams.set("key", API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API(videos.list) 요청 실패 (${res.status}): ${body}`);
    }
    const data = await res.json();
    for (const item of data.items ?? []) {
      views[item.id] = Number(item.statistics?.viewCount ?? 0);
    }
  }
  return views;
}

async function main() {
  console.log("ARTBEAT v 재생목록 조회 중...");
  const playlistItems = await fetchAllPlaylistItems();
  console.log(`총 ${playlistItems.length}개 영상 발견`);

  const existing = fs.existsSync(VIDEOS_PATH)
    ? JSON.parse(fs.readFileSync(VIDEOS_PATH, "utf-8"))
    : [];
  const existingMap = Object.fromEntries(existing.map((v) => [v.youtube_id, v]));

  // 재생목록에서 찾은 영상 + 기존 파일에 이미 있는 영상(재생목록에 없어서 수기로 넣은 것 포함)을
  // 합쳐서 조회수 갱신 대상으로 삼음. 이러면 수기로 추가한 영상도 view_count는 계속 자동으로 최신 유지됨
  // (다만 "새로 발견"되는 건 여전히 재생목록 기준 — 재생목록에 없는 영상 자체를 처음 넣는 건 수기로 해야 함).
  const playlistIds = playlistItems.map((i) => i.snippet.resourceId.videoId);
  const manualOnlyIds = existing
    .map((v) => v.youtube_id)
    .filter((id) => !playlistIds.includes(id));
  if (manualOnlyIds.length > 0) {
    console.log(`재생목록엔 없지만 기존 파일에 있는(수기 추가) 영상 ${manualOnlyIds.length}개도 조회수 갱신 대상에 포함`);
  }
  const allIds = [...playlistIds, ...manualOnlyIds];
  console.log("영상별 조회수 조회 중...");
  const viewCounts = await fetchViewCounts(allIds);

  let addedCount = 0;
  let updatedCount = 0;
  let backfilledCount = 0;

  const merged = playlistItems.map((item) => {
    const id = item.snippet.resourceId.videoId;
    const viewCount = viewCounts[id];
    const prev = existingMap[id];
    const description = item.snippet.description ?? "";
    const text = `${item.snippet.title}\n${description}`;

    if (prev) {
      updatedCount++;

      // "필드가 없음(undefined)"과 "필드는 있는데 빈 배열([])"을 구분함 — 사람이 직접 확인하고
      // 일부러 비워둔 건 절대 안 건드림 (videos.json 쪽과 동일한 규칙)
      const hadEmptyMembers = prev.tagged_members === undefined;
      const taggedMembers = hadEmptyMembers ? suggestTaggedMembers(text) : prev.tagged_members;

      if (hadEmptyMembers && taggedMembers.length > 0) {
        backfilledCount++;
        console.log(`  [기존 영상 자동 보완] ${prev.title}`);
        console.log(`    멤버: ${taggedMembers.join(", ")}`);
      }

      return {
        ...prev, // title, published_date, category 등 나머지는 그대로 유지
        tagged_members: taggedMembers,
        view_count: viewCount !== undefined ? viewCount : prev.view_count ?? 0,
      };
    }

    addedCount++;
    const suggestedMembers = suggestTaggedMembers(text);
    if (suggestedMembers.length > 0) {
      console.log(`  [자동 추천] ${item.snippet.title}`);
      console.log(`    멤버: ${suggestedMembers.join(", ")}`);
    }

    return {
      youtube_id: id,
      title: item.snippet.title.normalize("NFC"),
      category: null, // 자동 분류 기준이 없어서 항상 비움 — mv/teaser/trailer/behind/stage/vlog/live 중 직접 선택 필요
      tagged_members: suggestedMembers, // 자동 추천됨 — 꼭 검수 필요
      published_date: item.snippet.publishedAt.slice(0, 10),
      view_count: viewCount !== undefined ? viewCount : 0,
    };
  });

  // 재생목록에 없어서 위 map에서 안 다뤄진(수기로 추가된) 기존 영상들도, 조회수만 갱신해서 그대로 유지
  const manualOnlyMerged = existing
    .filter((v) => !playlistIds.includes(v.youtube_id))
    .map((v) => ({
      ...v,
      view_count: viewCounts[v.youtube_id] !== undefined ? viewCounts[v.youtube_id] : v.view_count ?? 0,
    }));

  const finalMerged = [...merged, ...manualOnlyMerged];

  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(finalMerged, null, 2) + "\n", "utf-8");
  console.log(`\n완료: 신규 ${addedCount}개, 기존 갱신 ${updatedCount}개(그중 자동 보완 ${backfilledCount}개), 수기 추가분 조회수만 갱신 ${manualOnlyMerged.length}개, 총 ${finalMerged.length}개`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
