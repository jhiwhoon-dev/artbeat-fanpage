// 매일 실행되는 전체 동기화 스크립트.
// 1) 채널의 "업로드" 재생목록을 끝까지 페이지네이션하며 전체 영상 ID를 모으고
// 2) 각 영상의 길이/조회수/라이브 여부를 조회한 뒤
// 3) 기존 videos.json과 병합한다.
//    - 이미 있던 영상: view_count만 갱신, content_type은 없을 때만 채움,
//      covered_group / tagged_members 등 손으로 넣은 값은 절대 안 건드림
//    - 새로 발견된 영상: 제목+설명란을 스캔해서 covered_group / tagged_members를
//      "자동 추천"으로 채워 넣음 (틀릴 수 있으니 꼭 검수 필요)

import fs from "node:fs";
import path from "node:path";

const CHANNEL_ID = "UCgZlBRLRB1-0l-qL9BkecLQ"; // ARTBEAT (@artbeat.official)
const UPLOADS_PLAYLIST_ID = CHANNEL_ID.replace(/^UC/, "UU");
const API_KEY = process.env.YOUTUBE_API_KEY;
const VIDEOS_PATH = path.join(process.cwd(), "src", "data", "videos.json");
const MEMBERS_PATH = path.join(process.cwd(), "src", "data", "members.json");
const GROUPS_PATH = path.join(process.cwd(), "src", "data", "covered_groups.json");
const SERIES_PATH = path.join(process.cwd(), "src", "data", "content_series.json");
const SHORTS_MAX_SECONDS = 180;

if (!API_KEY) {
  console.error("환경변수 YOUTUBE_API_KEY가 없습니다. GitHub Secret 설정을 확인하세요.");
  process.exit(1);
}

const members = JSON.parse(fs.readFileSync(MEMBERS_PATH, "utf-8"));
const coveredGroups = JSON.parse(fs.readFileSync(GROUPS_PATH, "utf-8"));
const contentSeries = JSON.parse(fs.readFileSync(SERIES_PATH, "utf-8"));

// 대소문자 무시 + 공백 전부 제거 후 비교 ("New Jeans" === "newjeans") — 한글 등에 사용
function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, "");
}

// 후보 문자열(그룹명/별칭) 하나에 대한 매칭 함수를 만든다.
// - 영문/숫자/공백으로만 된 이름(예: "IVE", "New Jeans")은 "단어 경계" 매칭을 써서,
//   "LIVE" 안의 "ive"처럼 다른 단어 속에 우연히 낀 경우를 걸러낸다.
//   여러 단어(New Jeans)는 단어 사이에 공백이 있어도/없어도 매칭되게 \s*를 넣는다.
// - 한글 등 그 외 이름은 기존처럼 공백 무시 부분일치를 그대로 쓴다 (오탐 위험이 낮음).
function buildMatcher(candidate) {
  const isAsciiOnly = /^[\x00-\x7F\s]+$/.test(candidate);
  if (isAsciiOnly) {
    const pattern = candidate
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    const re = new RegExp(`\\b${pattern}\\b`, "i");
    return (text) => re.test(text);
  }
  const norm = normalize(candidate);
  return (text) => normalize(text).includes(norm);
}

// covered_groups.json / content_series.json처럼 [{name, aliases}] 형태의 "태그 사전"을
// 매칭 함수 목록으로 미리 변환해두는 공용 헬퍼 (그룹, 콘텐츠 시리즈 둘 다 이걸로 처리)
function buildTagMatchers(tagList) {
  return tagList.map((t) => ({
    name: t.name,
    matchers: [t.name, ...(t.aliases ?? [])].map(buildMatcher),
  }));
}

// 텍스트 안에서 사전에 등록된 태그(그룹 또는 콘텐츠 시리즈)를 찾아서 추천
function suggestTags(text, tagMatchers) {
  const found = [];
  for (const t of tagMatchers) {
    if (t.matchers.some((match) => match(text))) {
      found.push(t.name);
    }
  }
  return found;
}

const groupMatchers = buildTagMatchers(coveredGroups);
const seriesMatchers = buildTagMatchers(contentSeries);

// 크레딧에는 보통 성 없이 이름만 적혀있는 경우가 많음 (예: "김소은" -> "소은 SoEun")
// 그래서 전체 이름뿐 아니라, 성 한 글자를 뗀 이름도 같이 후보로 확인한다.
// 단, 활동명(nickname)이 따로 있는 멤버는 본명 대신 활동명으로만 매칭한다.
// (본명이 다른 멤버와 겹쳐서 활동명으로 개명한 경우, 본명으로 매칭하면 오탐이 나기 때문)
function nameCandidates(member) {
  if (member.nickname) {
    return [member.nickname];
  }
  const candidates = [member.name];
  if (member.name.length > 2) {
    candidates.push(member.name.slice(1));
  }
  return candidates;
}

// 제목+설명란 텍스트에서 우리 멤버(members.json) 이름이 등장하는지 찾아서 추천
// 주의: 원곡 아이돌 멤버 실명이 우연히 우리 멤버 이름과 같으면 오탐 가능 (검수 필요)
function suggestTaggedMembers(text) {
  const found = [];
  for (const m of members) {
    if (!m.name) continue;
    if (nameCandidates(m).some((c) => text.includes(c))) {
      found.push(m.id);
    }
  }
  return found;
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
  let backfilledCount = 0;

  const merged = playlistItems.map((item) => {
    const id = item.snippet.resourceId.videoId;
    const d = details[id];
    const prev = existingMap[id];
    const description = item.snippet.description ?? "";
    const text = `${item.snippet.title}\n${description}`;

    if (prev) {
      updatedCount++;

      // 기존 영상이라도 covered_group/content_series/tagged_members가 "비어있을 때만" 자동 추천으로 채움.
      // 이미 뭔가 채워져 있으면(직접 태깅했든, 예전에 추천됐든) 절대 안 건드림.
      const hadEmptyGroup = !prev.covered_group || prev.covered_group.length === 0;
      const hadEmptySeries = !prev.content_series || prev.content_series.length === 0;
      const hadEmptyMembers = !prev.tagged_members || prev.tagged_members.length === 0;
      const coveredGroup = hadEmptyGroup ? suggestTags(text, groupMatchers) : prev.covered_group;
      const series = hadEmptySeries ? suggestTags(text, seriesMatchers) : prev.content_series;
      const taggedMembers = hadEmptyMembers ? suggestTaggedMembers(text) : prev.tagged_members;

      const backfilled =
        (hadEmptyGroup && coveredGroup.length > 0) ||
        (hadEmptySeries && series.length > 0) ||
        (hadEmptyMembers && taggedMembers.length > 0);
      if (backfilled) {
        backfilledCount++;
        console.log(`  [기존 영상 자동 보완] ${prev.title}`);
        if (hadEmptyGroup && coveredGroup.length > 0) console.log(`    그룹: ${coveredGroup.join(', ')}`);
        if (hadEmptySeries && series.length > 0) console.log(`    시리즈: ${series.join(', ')}`);
        if (hadEmptyMembers && taggedMembers.length > 0) console.log(`    멤버: ${taggedMembers.join(', ')}`);
      }

      return {
        ...prev, // title, published_date 등 나머지는 그대로 유지
        covered_group: coveredGroup,
        content_series: series,
        tagged_members: taggedMembers,
        view_count: d ? d.view_count : prev.view_count ?? 0,
        content_type: prev.content_type ?? (d ? d.content_type : "video"),
      };
    }

    addedCount++;
    const suggestedGroups = suggestTags(text, groupMatchers);
    const suggestedSeries = suggestTags(text, seriesMatchers);
    const suggestedMembers = suggestTaggedMembers(text);

    if (suggestedGroups.length > 0 || suggestedSeries.length > 0 || suggestedMembers.length > 0) {
      console.log(`  [자동 추천] ${item.snippet.title}`);
      if (suggestedGroups.length > 0) console.log(`    그룹: ${suggestedGroups.join(', ')}`);
      if (suggestedSeries.length > 0) console.log(`    시리즈: ${suggestedSeries.join(', ')}`);
      if (suggestedMembers.length > 0) console.log(`    멤버: ${suggestedMembers.join(', ')}`);
    }

    return {
      youtube_id: id,
      title: item.snippet.title,
      covered_group: suggestedGroups, // 자동 추천됨 — 꼭 검수 필요
      content_series: suggestedSeries, // 자동 추천됨 — 꼭 검수 필요
      tagged_members: suggestedMembers, // 자동 추천됨 — 꼭 검수 필요
      published_date: item.snippet.publishedAt.slice(0, 10),
      content_type: d ? d.content_type : "video",
      view_count: d ? d.view_count : 0,
    };
  });

  fs.writeFileSync(VIDEOS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  console.log(`\n완료: 신규 ${addedCount}개, 기존 갱신 ${updatedCount}개(그중 자동 보완 ${backfilledCount}개), 총 ${merged.length}개`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
