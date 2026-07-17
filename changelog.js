// 변경 로그 — 재정 데이터(offerings / expenses)의 모든 변경을 기록한다.
//
// 왜 필요한가:
//   리포트는 회기 전체(~2,000건)를 매번 읽는다. 통계를 몇 번만 열어도 무료 한도(5만/일)를 태운다.
//   로컬에 사본을 두고 '바뀐 것만' 받아오면 읽기가 사실상 0이 된다.
//   그 '바뀐 것'을 알아내는 장치가 이 로그다.
//
// 급소:
//   본체는 저장됐는데 로그가 빠지면 그 변경은 아무도 모른다 → 로컬이 영영 낡고 통계가 조용히 틀린다.
//   그래서 로그는 반드시 본체와 '같은 writeBatch'로 커밋한다. 둘 다 되거나, 둘 다 안 되거나.
//
// 시각:
//   at 은 반드시 serverTimestamp(). 기기 시계는 믿지 않는다.
//   기기 시계가 어긋나면 '내 마지막 동기화 이후'라는 기준이 무너져 로그를 통째로 건너뛴다.

import { db } from "./firebase-config.js";
import {
  collection, doc, serverTimestamp, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

export const LOG_COL = 'changes';
const TTL_DAYS = 30;          // 로그 보관 기간. 콘솔의 TTL 정책이 expireAt 을 보고 자동 삭제한다.

// 로그 문서를 '배치에 실어준다'. 커밋은 호출한 쪽이 본체와 함께 한다.
//   op: 'add' | 'update' | 'delete'  → docId 필수
//       'bulk'                        → docId 없음. 받는 쪽은 전체 재적재한다.
export function addLog(batch, { coll, docId, op, by }) {
  const expireAt = Timestamp.fromDate(new Date(Date.now() + TTL_DAYS * 86400000));
  batch.set(doc(collection(db, LOG_COL)), {
    coll,
    docId: docId || null,
    op,
    at: serverTimestamp(),
    by: by || null,
    expireAt
  });
}

// 대량 변경(임포트·되돌리기)은 로그를 건별로 남기지 않는다.
//   1,114건이면 로그도 1,114건 → 쓰기 낭비. 'bulk' 한 건만 남기고 받는 쪽이 전체 재적재한다.
export async function logBulk(coll, by) {
  const b = writeBatch(db);
  addLog(b, { coll, docId: null, op: 'bulk', by });
  await b.commit();
}
