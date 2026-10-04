// 영상 상세 페이지용: src/data/view_history/ 안의 월별 파일(2026-10.json 등)을 읽어서 영상별 기록으로 합쳐줌.
//
// 중요: 상세 페이지는 영상마다 하나씩(수천 개) 만들어지는데, 페이지 코드 안에서 파일을 읽으면 페이지마다
// 모든 월 파일을 다시 읽고 파싱하게 됨(월 파일 하나가 십수 MB). 그래서 이 모듈에서 "빌드 한 번에 딱 한 번만" 읽어서
// 메모리에 들고 있고, 페이지들은 거기서 자기 영상 기록만 꺼내 씀.
//
// 파일명 규칙(YYYY-MM.json)은 scripts/sync_videos.mjs가 저장하는 방식과 맞춰야 함.
import fs from 'node:fs';
import path from 'node:path';

const HISTORY_DIR = path.join(process.cwd(), 'src', 'data', 'view_history');

let cache = null; // Map<youtube_id, [{ date, views, likes }, ...]> — 날짜 오름차순

function loadAll() {
  const byVideo = new Map();
  if (!fs.existsSync(HISTORY_DIR)) return byVideo; // 아직 한 번도 기록이 안 쌓였으면 빈 상태

  const monthFiles = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort(); // 파일명이 연-월이라 이름순 = 시간순

  for (const f of monthFiles) {
    const monthData = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8'));
    for (const [id, entries] of Object.entries(monthData)) {
      const list = byVideo.get(id);
      if (list) {
        for (const e of entries) list.push(e);
      } else {
        byVideo.set(id, entries);
      }
    }
    // monthData 자체는 여기서 버려지고(가비지 컬렉션), 영상별 기록 배열만 byVideo에 남음
  }

  for (const list of byVideo.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byVideo;
}

export function getViewHistory(youtubeId) {
  if (!cache) cache = loadAll();
  return cache.get(youtubeId) ?? [];
}
