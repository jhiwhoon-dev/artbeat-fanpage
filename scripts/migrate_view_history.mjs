// 일회용 마이그레이션: 예전 연도별 파일(src/data/view_history_2026.json 등)을
// 월별 파일(src/data/view_history/2026-10.json 등)로 나눠서 옮기고, 예전 파일은 삭제함.
//
// 실행: 프로젝트 루트에서  node scripts/migrate_view_history.mjs
// 여러 번 실행해도 안전함(옮길 예전 파일이 없으면 아무것도 안 함).
// 새 월별 파일에 같은 영상·같은 날짜의 기록이 이미 있으면 새 쪽을 유지함.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "src", "data");
const HISTORY_DIR = path.join(DATA_DIR, "view_history");

if (!fs.existsSync(DATA_DIR)) {
  console.error(`${DATA_DIR} 가 없습니다. 프로젝트 루트에서 실행했는지 확인해주세요.`);
  process.exit(1);
}

const legacyFiles = fs.readdirSync(DATA_DIR).filter((f) => /^view_history_\d{4}\.json$/.test(f)).sort();
if (legacyFiles.length === 0) {
  console.log("옮길 예전(연도별) 파일이 없습니다. 할 일 없음.");
  process.exit(0);
}
fs.mkdirSync(HISTORY_DIR, { recursive: true });

const monthData = {}; // { "2026-10": { youtube_id: { "2026-10-03": entry } } }
function ensureMonth(month) {
  if (monthData[month]) return monthData[month];
  const p = path.join(HISTORY_DIR, `${month}.json`);
  const existing = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
  const byId = {};
  for (const [id, entries] of Object.entries(existing)) {
    byId[id] = Object.fromEntries(entries.map((e) => [e.date, e]));
  }
  monthData[month] = byId;
  return byId;
}

let moved = 0;
let skipped = 0;
for (const f of legacyFiles) {
  const legacy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8"));
  for (const [id, entries] of Object.entries(legacy)) {
    for (const e of entries) {
      if (!e || typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
        skipped++;
        continue;
      }
      const byId = ensureMonth(e.date.slice(0, 7));
      if (!byId[id]) byId[id] = {};
      if (!byId[id][e.date]) {
        byId[id][e.date] = e;
        moved++;
      }
    }
  }
  console.log(`읽음: ${f}`);
}

for (const [month, byId] of Object.entries(monthData)) {
  const out = {};
  for (const [id, byDate] of Object.entries(byId)) {
    out[id] = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }
  fs.writeFileSync(path.join(HISTORY_DIR, `${month}.json`), JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log(`저장: src/data/view_history/${month}.json (영상 ${Object.keys(out).length}개)`);
}

// 월별 파일 저장까지 전부 성공한 뒤에만 예전 파일을 지움
for (const f of legacyFiles) fs.unlinkSync(path.join(DATA_DIR, f));

console.log(`\n완료: 기록 ${moved}건 이동${skipped ? `, 형식이 이상해서 건너뜀 ${skipped}건` : ""}, 예전 파일 ${legacyFiles.length}개 삭제`);
