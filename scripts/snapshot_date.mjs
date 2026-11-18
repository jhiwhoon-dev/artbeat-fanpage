// 조회수/좋아요 스냅샷에 찍을 날짜(KST, YYYY-MM-DD)를 정하는 규칙.
//
// 예약 실행(schedule)은 GitHub 사정으로 몇 시간씩 늦게 돌 수 있음.
// 한국 시간 자정 전에 돌았어야 할 수집이 밀려서 00:00~06:00 사이에 돌면, 그 값은 "전날의 마지막 수집"으로 보고 전날 날짜로 저장함.
//   - 예약된 수집 시각은 23:33, 06:33, 12:33, 18:33(KST)이라 06:00 전에 도는 수집은 전날 밤 수집이 밀린 것으로 볼 수 있음
//   - 수동 실행(workflow_dispatch)이나 로컬 실행은 지연과 무관하므로 실제 날짜 그대로 사용
//   - 단, 수동 실행에서 '전날 최종 데이터로 저장'(SNAPSHOT_AS_PREVIOUS_DAY=true)을 체크하면
//     예약 실행과 똑같이 00:00~06:00 실행을 전날로 저장함 (자정 전에 깜빡하고 못 돌린 수집을 보충할 때 사용)
//     06:00 이후에는 체크해도 무시하고 실제 날짜로 저장 (낮 시간 값이 전날 기록을 덮어쓰지 않도록)
// 구간을 바꾸려면 GRACE_END_HOUR_KST만 수정하면 됨 (이 값을 키우면 06:33 정상 수집과 겹치지 않도록 예약 시각도 함께 조정할 것).
export const GRACE_END_HOUR_KST = 6;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function snapshotDate(now = new Date(), eventName = process.env.GITHUB_EVENT_NAME, asPreviousDay = process.env.SNAPSHOT_AS_PREVIOUS_DAY === "true") {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  let label = kst;
  if ((eventName === "schedule" || asPreviousDay) && kst.getUTCHours() < GRACE_END_HOUR_KST) {
    label = new Date(kst.getTime() - 24 * 60 * 60 * 1000); // 전날로 취급
  }
  return label.toISOString().slice(0, 10);
}

export function kstDateTimeString(now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 16).replace("T", " ");
}
