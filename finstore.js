// 로컬 사본 + 증분 동기화 — 재정 데이터(offerings / expenses / finConfig)
//
// 왜:
//   리포트는 회기 전체(~2,000건)를 매번 읽었다. 통계 몇 번이면 무료 한도(5만/일)를 태운다.
//   여기서는 로컬(IndexedDB)에 사본을 두고, changes 로그로 '바뀐 것만' 따라잡는다.
//   → 통계를 몇 번을 열어도 Firestore 읽기 0.
//
// 진실은 언제나 Firestore 다. 로컬은 사본일 뿐이다.
//   어긋났다고 의심되면 resetAll() 로 버리고 전체를 다시 받는다. 그 탈출구가 설계의 일부다.
//
// 급소:
//   로그가 하나라도 빠지면 로컬은 조용히 낡는다. 그래서 쓰는 쪽(changelog.js)이 본체와
//   같은 배치로 커밋한다. 그래도 콘솔 직접 수정 등은 로그를 남기지 않으므로 [전체 다시 읽기]가 필요하다.

import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { LOG_COL } from "./changelog.js";

const DB_NAME = 'church_fin';
const DB_VER = 1;
const STORES = ['offerings', 'expenses', 'finConfig'];
const META = 'meta';                 // { key:'sync', lastSync: <ms>, at: <ISO> }
const MAX_AGE_DAYS = 30;             // 로그 보관 기간과 같다. 넘으면 로그를 믿을 수 없다.

// ---- IndexedDB 기본 ----
let _db = null;
function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      STORES.forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'key' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}
function tx(store, mode, fn) {
  return open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    // IDBRequest 는 값이 없어도 result 프로퍼티를 갖는다(undefined).
    // 예전 코드는 값이 없을 때 IDBRequest 객체 자체를 돌려줘서,
    // getMeta() 가 늘 truthy 를 반환했다 → 동기화 판정이 어긋났다.
    t.oncomplete = () => res(rq && typeof rq === 'object' && 'result' in rq ? rq.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}
const getAll = (store) => tx(store, 'readonly', (os) => os.getAll());
const putAll = (store, rows) => tx(store, 'readwrite', (os) => { rows.forEach((r) => os.put(r)); });
const delOne = (store, id) => tx(store, 'readwrite', (os) => os.delete(id));
const clear = (store) => tx(store, 'readwrite', (os) => os.clear());

// ---- 동기화 시각 ----
async function getMeta() {
  try { return await tx(META, 'readonly', (os) => os.get('sync')); }
  catch (e) { return null; }
}
const setMeta = (ms) => tx(META, 'readwrite', (os) =>
  os.put({ key: 'sync', lastSync: ms, at: new Date(ms).toISOString() }));

// ---- 전체 적재 ----
// 첫 설치 / 30일 초과 / bulk 로그 / 사용자가 [전체 다시 읽기] 를 눌렀을 때.
// 여기서만 Firestore 를 크게 읽는다(~2,000건). 그 외에는 읽지 않는다.
async function full() {
  const [inc, exp, cfg] = await Promise.all([
    getDocs(collection(db, 'offerings')),
    getDocs(collection(db, 'expenses')),
    getDocs(collection(db, 'finConfig'))
  ]);
  const map = (qs) => qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  await Promise.all(STORES.map((s) => clear(s)));
  await putAll('offerings', map(inc));
  await putAll('expenses', map(exp));
  await putAll('finConfig', map(cfg));
  // 다음 증분의 기준 시각. 서버 시각이어야 한다 — 기기 시계로 찍으면 그 오차만큼 로그를 건너뛴다.
  //   → 가장 최근 로그 1건의 at 을 기준으로 쓴다. (전체를 읽을 필요가 없다. limit(1))
  //   로그가 아예 없으면 받을 것도 없다. 기기 시계에서 1분 빼 여유를 둔다(시계가 조금 빨라도 안 놓치게).
  const last = await getDocs(query(collection(db, LOG_COL), orderBy('at', 'desc'), limit(1)));
  const top = last.docs[0];
  const ms = (top && top.data().at) ? top.data().at.toMillis() : (Date.now() - 60000);
  await setMeta(ms);
  return { mode: 'full', reads: inc.size + exp.size + cfg.size + last.size };
}

// ---- 증분 동기화 ----
// 로그만 읽고, 바뀐 문서만 골라 읽는다. 변경이 없으면 읽기 0.
async function incremental(lastSync) {
  const qs = await getDocs(query(
    collection(db, LOG_COL),
    where('at', '>', new Date(lastSync)),
    orderBy('at', 'asc')
  ));
  if (qs.empty) return { mode: 'none', reads: 0 };

  const logs = qs.docs.map((d) => d.data());
  // bulk 가 하나라도 있으면 개별 추적을 포기하고 전체를 다시 받는다.
  if (logs.some((l) => l.op === 'bulk')) return full();

  // 같은 문서가 여러 번 바뀌었을 수 있다. 마지막 상태만 남긴다.
  const want = new Map();                       // `${coll}/${docId}` → op
  logs.forEach((l) => { if (l.docId && l.coll) want.set(`${l.coll}/${l.docId}`, l.op); });

  let reads = qs.size;
  const fetch = [];
  for (const [key, op] of want) {
    const [coll, id] = key.split('/');
    if (op === 'delete') { await delOne(coll, id); continue; }
    fetch.push({ coll, id });
  }
  // add·update 는 그 문서만 읽어 로컬을 갈아끼운다.
  const got = await Promise.all(fetch.map((f) => getDoc(doc(db, f.coll, f.id))));
  reads += got.length;
  const byColl = {};
  got.forEach((s, i) => {
    if (!s.exists()) return;                    // 로그 뒤에 지워졌다면 무시 (delete 로그가 따로 온다)
    const c = fetch[i].coll;
    (byColl[c] = byColl[c] || []).push({ id: s.id, ...s.data() });
  });
  for (const c of Object.keys(byColl)) await putAll(c, byColl[c]);

  const maxAt = logs[logs.length - 1].at;
  await setMeta(maxAt ? maxAt.toMillis() : Date.now());
  return { mode: 'inc', reads, changed: want.size };
}

// ---- 공개 API ----

// 앱을 열 때 한 번 부른다. 로컬을 최신으로 맞추고, 무엇을 했는지 돌려준다.
//   mode: 'full'(전량) | 'inc'(증분) | 'none'(변경 없음)
export async function sync() {
  const m = await getMeta();
  let r;
  if (!m || !m.lastSync) {
    r = await full();                                          // 첫 설치
  } else if (Date.now() - m.lastSync > MAX_AGE_DAYS * 86400000) {
    // 로그는 30일만 보관된다. 그보다 오래 쉬었으면 '무엇이 바뀌었는지' 알 방법이 없다.
    // 이때 증분을 시도하면 빠진 변경을 영영 모른 채 조용히 틀린 장부를 보게 된다.
    r = await full();
  } else {
    r = await incremental(m.lastSync);
  }
  // 진단: 실제로 무엇이 돌았고 몇 건을 읽었는지. 추측 대신 사실을 본다. (F12 콘솔)
  console.log('[finstore]', r.mode, 'reads=' + r.reads,
    'lastSync=' + (m && m.lastSync ? new Date(m.lastSync).toLocaleString('ko-KR') : '없음'));
  return r;
}

// 로컬을 버리고 전체를 다시 받는다. [전체 다시 읽기] 버튼용.
// 콘솔에서 직접 고치면 로그가 안 남는다 — 그때의 탈출구다.
export async function resetAll() {
  await Promise.all(STORES.map((s) => clear(s)));
  await setMeta(0);
  return full();
}

// 로컬에서 읽는다. Firestore 를 건드리지 않는다 → 읽기 0.
export const localNodes = () => getAll('finConfig');

// 날짜 범위로 거른다 (기존 where('date','>=',from) 쿼리와 같은 결과).
export async function localRange(coll, from, to) {
  const all = await getAll(coll);
  return all.filter((r) => r.date >= from && r.date <= to);
}

// 문서 하나를 로컬 사본에 즉시 반영한다 (신규·수정 공용).
//   서버 커밋이 성공한 '뒤에만' 부른다. 순서를 뒤집으면 서버엔 없고 로컬에만 있는
//   유령 데이터가 생겨 장부가 조용히 틀린다. (진실은 언제나 Firestore 다.)
//   ⚠ createdAt/updatedAt 같은 serverTimestamp 필드는 넣지 말 것 — 로컬에선 확정되지 않은
//     특수 값이라 이상하게 저장된다. 목록·정렬은 date/id 만 쓰므로 없어도 무해하다.
export const localPut = (coll, docObj) => putAll(coll, [docObj]);

// 문서 하나를 로컬 사본에서 지운다. 서버 삭제가 성공한 뒤에만 부른다.
export const localDelete = (coll, id) => delOne(coll, id);

// 마지막 동기화 시각. "몇 시 기준 자료인가"를 화면에 띄우기 위한 것이다.
// 사용자가 지금 보는 숫자가 언제 것인지 몰라선 안 된다.
export async function lastSyncAt() {
  const m = await getMeta();
  return (m && m.lastSync) ? new Date(m.lastSync) : null;
}
