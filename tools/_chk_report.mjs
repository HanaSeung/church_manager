
  import { auth, db } from "./firebase-config.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
  import {
    collection, query, where, getDocs, doc, getDoc, deleteDoc, updateDoc, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

  const $ = (id) => document.getElementById(id);
  const MIN_LEVEL = 3;
  const COL = 'finConfig';

  const FUNDS = ['일반', '선교', '장학', '건축', '차량'];
  const DEFAULT_FUND = '일반';
  const CARRY_C1 = '이월';          // 이월 대분류 이름 (offering.html 의 isCarryOver 와 같은 규칙)

  // ---- 보고서 종류 ----
  // 파일을 5개로 쪼개면 조회·매칭 로직이 5벌 복사된다. 한 파일에서 ?type= 로 갈아끼운다.
  const TYPES = {
    bs:      { title: '예결산표',         ctrl: ['xls'] },
    monthly: { title: '년간 월별 집계표', ctrl: ['kind'] },
    weekly:  { title: '월간 주별 집계표', ctrl: ['mo', 'kind'] },
    range:   { title: '기간 단위 검색',   ctrl: ['kind', 'cat', 'period'] },
    member:  { title: '성도별 헌금 집계', ctrl: ['q'] }
  };
  const P = new URLSearchParams(location.search);
  const TYPE = TYPES[P.get('type')] ? P.get('type') : 'bs';
  const CTRL = TYPES[TYPE].ctrl;
  document.title = TYPES[TYPE].title + ' · 재정 관리';
  $('ttl').textContent = TYPES[TYPE].title;

  // 결산월. 실제로는 finConfig/settings 에서 읽어 덮어쓴다.
  // 못 읽으면 이 값을 쓰는 게 아니라 화면을 '차단'한다(blockNoSettings). 최후의 안전망일 뿐이다.
  let closeMonth = 11;
  let curFY = Number(P.get('fy')) || null;
  let curMo = 0;                    // weekly: 회기 내 월 순번 0~11
  let curKind = 'income';           // monthly/weekly/range: 구분 라디오 (수입 | 지출)
  let showSp = false;               // monthly/weekly: 특별헌금 블록을 낼지. 기본은 꺼짐(수입만).
  let curCat = '';                  // range: 선택한 항목의 이름경로 ('' = 전체)
  let ppFy = null, ppSel = null;    // 기간선택 모달 상태
  let nodes = [];                   // finConfig 전체 노드
  let incDocs = [], expDocs = [];   // 조회된 문서
  let agg = null;                   // 집계 결과
  let memQ = '';                    // 성도별: '적용된' 이름 검색어 (입력칸 값과 별개다)
  // 성도별 정렬. 기본은 ID 오름차순 = 명부 순서 (members.html 의 'no' 정렬과 같은 관례).
  // key: 'no' | 'name' | 'total' | 'i:<열번호>'
  let memSort = { key: 'no', dir: 1 };
  let me = null;                    // 로그인 사용자 (updatedBy 기록용)
  let selIds = new Set();           // 기간검색: 일괄 수정으로 고른 문서 id
  let bulkOpen = false;             // 일괄 수정 패널이 열려 있나
  let bulkInit = null;              // 패널을 열 때의 '시작값'. 저장 시 지금 값과 비교해 달라진 칸만 덮는다.

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  // 금액 입력칸에서 콤마·공백을 걷어낸다 (offering.html 과 같은 규칙).
  // ※ 임포트용 impAmt 와 다르다. 여기 입력값에는 소수점이 없다.
  const onlyNum = (s) => Number(String(s == null ? '' : s).replace(/[^0-9]/g, '') || 0);
  const pad = (n) => String(n).padStart(2, '0');
  const codeNum = (c) => Number(String(c).replace(/[^0-9]/g, '')) || 0;
  // 경로 비교 키: 공백 차이를 흡수한다 ('일반재정 › 주일헌금' === '일반재정›주일헌금')
  const catKey = (s) => String(s || '').replace(/\s+/g, '');
  const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 성도 ID 표시 형식. members.html 516행 · offering.html 과 같은 규칙으로 맞춘다 (#001).
  const padNo = (n) => {
    const v = Number(n);
    return (Number.isFinite(v) && v > 0) ? '#' + String(v).padStart(3, '0') : '';
  };
  const parseYMD = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

  // ---- 회기 범위 (offering.html 과 동일 규칙) ----
  // 회기 N = (결산월 다음달, N-1년) ~ (결산월, N년)
  const lastDay = (y, m) => new Date(y, m, 0).getDate();
  function fyStart(fy) {
    const m = closeMonth === 12 ? 1 : closeMonth + 1;
    const y = closeMonth === 12 ? fy : fy - 1;
    return { y, m };
  }
  function fyMonth(fy, i) {
    const s = fyStart(fy);
    const t = s.m - 1 + i;
    return { y: s.y + Math.floor(t / 12), m: (t % 12) + 1 };
  }
  function fyRange(fy) {
    const a = fyMonth(fy, 0), b = fyMonth(fy, 11);
    return { from: `${a.y}-${pad(a.m)}-01`, to: `${b.y}-${pad(b.m)}-${pad(lastDay(b.y, b.m))}` };
  }
  // 회기 내 i0~i1 번째 달만 잘라낸 기간 (기간선택 모달의 반기·분기·월 버튼용)
  function fyRangeIdx(fy, i0, i1) {
    const a = fyMonth(fy, i0), b = fyMonth(fy, i1);
    return { from: `${a.y}-${pad(a.m)}-01`, to: `${b.y}-${pad(b.m)}-${pad(lastDay(b.y, b.m))}` };
  }
  // 'YYYY-MM-DD' → 회기 내 월 순번 0~11 (범위 밖이면 -1)
  function monthIdx(fy, ymd) {
    const s = fyStart(fy);
    const y = Number(String(ymd).slice(0, 4)), m = Number(String(ymd).slice(5, 7));
    if (!y || !m) return -1;
    const i = (y - s.y) * 12 + (m - s.m);
    return (i >= 0 && i < 12) ? i : -1;
  }
  const monthLabels = (fy) => Array.from({ length: 12 }, (_, i) => pad(fyMonth(fy, i).m) + '월');
  const fiscalYearOf = (d) => (d.getMonth() + 1) <= closeMonth ? d.getFullYear() : d.getFullYear() + 1;

  // ---- 주차 (offering.html 의 weekLabel 과 완전히 같은 규칙) ----
  // 그 날짜가 속한 주의 '일요일'을 찾아, 그 일요일의 날짜로 주차를 매긴다.
  // 일요일 1~7일=1주, 8~14=2주 … 29~31=5주. 그래서 4/2(수)는 '3월 5주'가 된다.
  function weekOf(ymd) {
    const d = parseYMD(ymd);
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    return { y: sun.getFullYear(), m: sun.getMonth() + 1, no: Math.floor((sun.getDate() - 1) / 7) + 1 };
  }
  // 문서의 week 필드에 저장되는 문자열. offering.html 의 weekLabel 과 글자까지 같아야 한다.
  // 일괄 수정으로 날짜를 바꾸면 week 도 함께 다시 찍는다. 안 그러면 날짜와 주차가 어긋난다.
  const weekLabel = (ymd) => { const w = weekOf(ymd); return `${w.m}월 ${w.no}주`; };
  // 그 달에 실제로 존재하는 주차 번호 (일요일이 몇 번 오는지에 따라 4개 또는 5개)
  function weekNos(y, m) {
    const out = [];
    for (let d = 1, ld = lastDay(y, m); d <= ld; d++) {
      if (new Date(y, m - 1, d).getDay() === 0) out.push(Math.floor((d - 1) / 7) + 1);
    }
    return out;
  }

  // ---- 가로표의 칸(bucket) 정의 ----
  // 년간 = 12개월, 월간 = 그 달의 주차. 집계 로직은 하나만 쓰고 이 객체만 갈아끼운다.
  // strict:true 면 칸에 안 들어가는 문서는 합계에서도 뺀다 (주별표는 조회 범위를 ±7일 넓게 잡으므로 필수).
  let BK = null;
  function setBucket() {
    if (TYPE === 'weekly') {
      const { y, m } = fyMonth(curFY, curMo);
      const nos = weekNos(y, m);
      BK = {
        n: nos.length, strict: true,
        labels: nos.map((k) => `${k}주`),
        of: (ymd) => { const w = weekOf(ymd); return (w.y === y && w.m === m) ? nos.indexOf(w.no) : -1; }
      };
    } else {
      BK = { n: 12, strict: false, labels: monthLabels(curFY), of: (ymd) => monthIdx(curFY, ymd) };
    }
  }

  // ---- 트리 도우미 ----
  const scope = (kind) => nodes.filter((c) => Number(c.fy) === curFY && c.kind === kind);
  const childrenOf = (kind, pid) => scope(kind)
    .filter((c) => (c.parentId || null) === (pid || null))
    .sort((a, b) => codeNum(a.code) - codeNum(b.code));
  const isLeaf = (kind, id) => !scope(kind).some((c) => c.parentId === id);

  function fundOf(node, byId) {
    let n = node, guard = 0;
    while (n && guard++ < 10) {
      if (n.fund && FUNDS.includes(n.fund)) return n.fund;
      if (!n.parentId) break;
      n = byId[n.parentId];
    }
    return DEFAULT_FUND;
  }
  function pathOf(node, byId) {
    const parts = []; let n = node, guard = 0;
    while (n && guard++ < 10) { parts.unshift(String(n.name || '').trim()); n = n.parentId ? byId[n.parentId] : null; }
    return parts.join(' › ');
  }
  function rootOf(node, byId) {
    let n = node, guard = 0;
    while (n && n.parentId && guard++ < 10) n = byId[n.parentId];
    return n;
  }

  // ---- 뒤로 ----
  // PC 는 새 창으로 열렸다(opener 가 있다) → 창을 닫는다. 폰은 같은 탭이므로 메뉴로 되돌린다.
  $('backBtn').onclick = () => {
    if (window.opener && !window.opener.closed) { window.close(); return; }
    location.href = 'stats.html';
  };

  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace('index.html'); return; }
    me = user;
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const lv = snap.exists() ? (snap.data().level || 1) : 1;
      if (lv < MIN_LEVEL) { alert('통계는 재정 담당자만 이용할 수 있습니다.'); location.replace('index.html'); return; }

      // 결산월을 못 읽으면 회기 기간이 통째로 어긋난다.
      // 통계는 숫자가 곧 결과물이라, 조용히 기본값으로 계산하지 않고 '멈춘다'.
      if (!(await loadCloseMonth())) { blockNoSettings(); return; }

      await loadNodes();
      buildControls();
      await reload();
    } catch (e) {
      console.error(e);
      $('body').innerHTML = '<div class="loading">불러오지 못했습니다.</div>';
    }
  });

  // 성공하면 true. settings 문서가 없거나 closeMonth 가 비정상이면 false.
  async function loadCloseMonth() {
    try {
      const s = await getDoc(doc(db, 'finConfig', 'settings'));
      if (!s.exists()) return false;
      const m = Number(s.data().closeMonth);
      if (!Number.isInteger(m) || m < 1 || m > 12) return false;
      closeMonth = m;
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function blockNoSettings() {
    $('fySel').disabled = true;
    $('xlsBtn').disabled = true;
    $('rangeTxt').textContent = '';
    $('warnBox').classList.remove('on');
    $('body').innerHTML = `<div class="blocked">
      <div class="bt">결산 월 설정을 불러오지 못했습니다.</div>
      <p>결산 월을 모르면 회계연도 기간을 계산할 수 없습니다.
         틀린 숫자를 보여드리지 않기 위해 통계를 표시하지 않습니다.</p>
      <p>인터넷 연결을 확인하고 새로고침하거나, <b>설치 › 결산 월 설정</b>에서 결산 월을 먼저 지정하세요.</p>
      <div class="bbtn">
        <button id="retryBtn">다시 시도</button>
        <button id="goSetBtn">결산 월 설정으로</button>
      </div>
    </div>`;
    $('retryBtn').onclick = () => location.reload();
    $('goSetBtn').onclick = () => { location.href = 'offering.html?tab=set'; };
  }

  async function loadNodes() {
    const qs = await getDocs(collection(db, COL));
    nodes = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.kind === 'income' || c.kind === 'expense');
    const ys = [...new Set(nodes.map((c) => Number(c.fy)).filter(Boolean))];
    if (curFY == null || !ys.length) curFY = ys.length ? Math.max(...ys) : fiscalYearOf(new Date());
  }

  // 일괄 수정 선택 해제. 구분·항목·기간이 바뀌면 이전 선택은 의미가 없다.
  // (수입 문서를 골라 놓고 지출로 넘어가면, 그 id 로 expenses 를 고치려 든다)
  const clearSel = () => { selIds.clear(); bulkOpen = false; bulkInit = null; };

  // ---- 상단 컨트롤 (보고서 종류마다 다르다) ----
  function buildControls() {
    const ys = new Set(nodes.map((c) => Number(c.fy)).filter(Boolean));
    ys.add(curFY);
    $('fySel').innerHTML = [...ys].sort((a, b) => b - a)
      .map((y) => `<option value="${y}"${y === curFY ? ' selected' : ''}>${y}년도</option>`).join('');
    $('fySel').onchange = async () => { curFY = Number($('fySel').value); syncControls(); await reload(); };

    if (CTRL.includes('mo')) { $('moSel').hidden = false; $('moSel').onchange = async () => { curMo = Number($('moSel').value); await reload(); }; }
    if (CTRL.includes('kind')) {
      $('kindBox').hidden = false;
      // 기간검색에는 특별헌금 체크박스를 두지 않는다. 거기는 항목 select 로 직접 고른다.
      const useSp = (TYPE === 'monthly' || TYPE === 'weekly');
      $('spLab').hidden = $('ksep').hidden = !useSp;
      if (useSp) $('spChk').onchange = () => { showSp = $('spChk').checked; if (agg) renderAll(); };
      document.querySelectorAll('input[name="kind"]').forEach((el) => {
        el.onchange = () => {
          curKind = el.value;
          // 수입·지출 문서는 이미 둘 다 읽어 뒀다. 재조회하지 않고 그리기만 다시 한다.
          if (useSp) syncSpChk();
          // 항목 목록은 구분마다 다른 트리라 다시 채운다 (선택은 '전체'로 초기화).
          if (CTRL.includes('cat')) { curCat = ''; fillCats(); }
          clearSel();
          if (agg) renderAll();
        };
      });
      if (useSp) syncSpChk();
    }
    if (CTRL.includes('cat')) {
      $('catSel').hidden = false;
      $('catSel').onchange = () => { curCat = $('catSel').value; clearSel(); if (agg) renderAll(); };
    }
    if (CTRL.includes('period')) {
      $('periodBox').hidden = false;
      $('goBtn').onclick = () => reload();
      $('periodPickBtn').onclick = openPeriodPick;
      $('ppCancel').onclick = closePeriodPick;
      $('ppApply').onclick = applyPeriodPick;
      $('ppFySel').onchange = () => ppSetFy(Number($('ppFySel').value));
      $('periodModal').onclick = (e) => { if (e.target === $('periodModal')) closePeriodPick(); };
      // 구분·항목은 둘째 줄로 내린다. 첫 줄은 회기 + 조회기간만 남긴다.
      // appendChild 는 '이동'이다. 노드를 다시 만들지 않으므로 위에서 붙인 핸들러가 그대로 살아 있다.
      $('row2').appendChild($('kindBox'));
      $('row2').appendChild($('catSel'));
      $('row2').hidden = false;
      $('bar').classList.add('tight');   // 첫 줄 아래 여백을 줄여 두 줄 간격을 맞춘다
    }
    if (CTRL.includes('q')) {
      $('qNo').hidden = $('qName').hidden = $('qBtn').hidden = false;
      $('qName').enterKeyHint = 'search';
      // 검색은 '적용된 값'(memQ)으로만 거른다. 입력칸을 직접 읽으면
      // 타자 도중의 미완성 이름으로 표가 계속 다시 그려진다(52명 × 항목 수).
      $('qBtn').onclick = doSearch;
      $('qName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    }
    if (CTRL.includes('xls')) $('xlsBtn').hidden = false;
    syncControls();
  }

  // 검색어를 '적용'하고 다시 그린다. 재조회는 하지 않는다(이미 읽어 둔 문서로 거른다).
  function doSearch() {
    memQ = String($('qName').value || '').trim();
    if (agg) renderAll();
  }

  // ---- 성도별 정렬 ----
  // 헤더는 매번 새로 그려지므로 개별 바인딩 대신 #body 에 한 번만 위임한다.
  $('body').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sk]');
    if (!th || !agg) return;
    const k = th.dataset.sk;
    if (memSort.key === k) memSort.dir = -memSort.dir;
    // 새 열을 누를 때: 이름·ID 는 오름차순, 금액은 '많은 순'이 먼저 보고 싶은 게 상식이다.
    else memSort = { key: k, dir: (k === 'no' || k === 'name') ? 1 : -1 };
    renderAll();
  });

  function memCmp(a, b) {
    const { key: k, dir: d } = memSort;
    if (k === 'name') return d * a.name.localeCompare(b.name, 'ko');
    if (k === 'no') {
      const na = Number(a.no) || 0, nb = Number(b.no) || 0;
      // 명부 미연동(번호 없음)은 방향과 무관하게 항상 맨 뒤. seqCmp 에 d 를 곱하면 여기가 뒤집힌다.
      if (!na !== !nb) return na ? -1 : 1;
      if (na !== nb) return d * (na - nb);
      return a.name.localeCompare(b.name, 'ko');
    }
    const va = (k === 'total') ? a.total : a.cells[Number(k.slice(2))];
    const vb = (k === 'total') ? b.total : b.cells[Number(k.slice(2))];
    if (va !== vb) return d * (va - vb);
    return seqCmp(a, b);   // 동점은 명부 순 (순서가 흔들리지 않게)
  }

  // 명부 순서 = ID 오름차순. 번호 없는 사람(명부 미연동)은 항상 맨 뒤.
  // No. 를 매기는 기준이자, 정렬 동점일 때의 최종 기준이다.
  function seqCmp(a, b) {
    const na = Number(a.no) || 0, nb = Number(b.no) || 0;
    if (!na !== !nb) return na ? -1 : 1;
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name, 'ko');
  }
  const arrow = (k) => (memSort.key === k ? `<span class="ar">${memSort.dir === 1 ? '▲' : '▼'}</span>` : '');

  // 지출에는 특별헌금이 없다 (목적기금은 수입 쪽 개념).
  // 숨기지 않고 '비활성'으로 남긴다 — 사라졌다 나타나면 바 폭이 출렁인다.
  function syncSpChk() {
    const on = (curKind === 'income');
    $('spChk').disabled = !on;
    $('spLab').classList.toggle('off', !on);
    $('spLab').title = on ? '' : '지출에는 특별헌금이 없습니다';
  }

  // 회기가 바뀌면 월 목록과 기간 기본값도 그 회기에 맞춰 다시 채운다.
  function syncControls() {
    if (CTRL.includes('mo')) {
      $('moSel').innerHTML = monthLabels(curFY)
        .map((l, i) => `<option value="${i}"${i === curMo ? ' selected' : ''}>${l}</option>`).join('');
    }
    if (CTRL.includes('period')) {
      const r = fyRange(curFY);
      $('fromD').value = r.from; $('toD').value = r.to;
    }
    if (CTRL.includes('cat')) { curCat = ''; fillCats(); }
  }

  // ---- 항목 선택 ----
  // 트리 순서대로 들여쓴다. 값은 '이름 경로'다 (문서가 이름 경로로 저장되므로 그대로 대조된다).
  // 상위를 고르면 그 아래 전부가 걸린다.
  function fillCats() {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const out = ['<option value="">전체 항목</option>'];
    const walk = (pid, depth) => {
      childrenOf(curKind, pid).forEach((c) => {
        const p = pathOf(c, byId);
        out.push(`<option value="${esc(p)}">${'　'.repeat(depth)}${esc(c.name)}</option>`);
        walk(c.id, depth + 1);
      });
    };
    walk(null, 0);
    $('catSel').innerHTML = out.join('');
    $('catSel').value = curCat;
  }
  // ---- 기간 선택 모달 (offering.html 과 같은 규칙) ----
  function ppRangeOf(kind, mi) {
    switch (kind) {
      case 'all': return { i0: 0, i1: 11 };
      case 'h1': return { i0: 0, i1: 5 };
      case 'h2': return { i0: 6, i1: 11 };
      case 'q1': return { i0: 0, i1: 2 };
      case 'q2': return { i0: 3, i1: 5 };
      case 'q3': return { i0: 6, i1: 8 };
      case 'q4': return { i0: 9, i1: 11 };
      case 'mon': return { i0: mi, i1: mi };
    }
    return null;
  }
  function ppRenderMonths() {
    $('ppMonths').innerHTML = Array.from({ length: 12 }, (_, i) => {
      const d = fyMonth(ppFy, i);
      return `<button type="button" class="ppbtn mo" data-pp="mon" data-mi="${i}">${String(d.y).slice(2)}.${pad(d.m)}</button>`;
    }).join('');
    ppBind();
  }
  function ppBind() {
    document.querySelectorAll('#periodModal .ppbtn[data-pp]').forEach((b) => {
      const kind = b.getAttribute('data-pp');
      if (kind === 'none') return;
      b.onclick = () => {
        ppSel = ppRangeOf(kind, Number(b.getAttribute('data-mi')));
        document.querySelectorAll('#periodModal .ppbtn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        ppShowRange();
      };
    });
  }
  function ppShowRange() {
    const s = ppSel || { i0: 0, i1: 11 };
    const r = fyRangeIdx(ppFy, s.i0, s.i1);
    $('ppFyRange').textContent = `${r.from} ~ ${r.to}`;
  }
  function ppSetFy(fy) {
    ppFy = fy; ppSel = null;
    ppRenderMonths();
    document.querySelectorAll('#periodModal .ppbtn').forEach((b) => b.classList.remove('on'));
    ppShowRange();
  }
  function openPeriodPick() {
    const ys = [...new Set(nodes.map((c) => Number(c.fy)).filter(Boolean))].sort((a, b) => b - a);
    if (!ys.length) ys.push(curFY);
    const cur = ys.includes(curFY) ? curFY : ys[0];
    $('ppFySel').innerHTML = ys.map((y) => `<option value="${y}"${y === cur ? ' selected' : ''}>${y} 회기</option>`).join('');
    ppSetFy(cur);
    $('periodModal').style.display = 'flex';
  }
  function closePeriodPick() { $('periodModal').style.display = 'none'; }
  async function applyPeriodPick() {
    if (!ppSel) { alert('범위를 선택하세요.'); return; }
    const r = fyRangeIdx(ppFy, ppSel.i0, ppSel.i1);
    $('fromD').value = r.from;
    $('toD').value = r.to;
    closePeriodPick();
    // 모달에서 회기를 바꿨으면 상단 회기도 따라간다.
    // 안 그러면 예산·항목 트리는 옛 회기 것인데 날짜만 새 회기라 숫자가 뒤섞인다.
    if (ppFy !== curFY) {
      curFY = ppFy;
      $('fySel').value = String(curFY);
      if (CTRL.includes('cat')) { curCat = ''; fillCats(); }
    }
    await reload();
  }

  // ---- 조회 범위 ----
  // weekly 는 ±7일 넓게 잡는다. 주차는 '일요일' 기준이라 4/2(수)가 '3월 5주'로 가는 등
  // 달 경계를 넘나든다. 넓게 읽고 BK.of() 로 정확히 거른다(BK.strict).
  function qRange() {
    if (TYPE === 'range') {
      const f = $('fromD').value, t = $('toD').value;
      if (f && t && f <= t) return { from: f, to: t };
      return fyRange(curFY);
    }
    if (TYPE === 'weekly') {
      const { y, m } = fyMonth(curFY, curMo);
      const a = new Date(y, m - 1, 1); a.setDate(a.getDate() - 7);
      const b = new Date(y, m - 1, lastDay(y, m)); b.setDate(b.getDate() + 7);
      return { from: toYMD(a), to: toYMD(b) };
    }
    return fyRange(curFY);
  }

  async function reload() {
    setBucket();
    // 조회 대상이 바뀌면 이전 선택은 무효다. 안 지우면 화면에 없는 문서를 일괄 수정하게 된다.
    clearSel();
    const r = qRange();
    // range 는 기간을 .period 섹션에 크게 띄우므로 바에는 건수만 나중에 채운다.
    const shown = (TYPE === 'weekly')
      ? (() => { const { y, m } = fyMonth(curFY, curMo); return `${y}-${pad(m)} (${BK.n}개 주)`; })()
      : (TYPE === 'range') ? '' : `${r.from} ~ ${r.to}`;
    $('rangeTxt').textContent = shown;
    $('xlsBtn').disabled = true;
    $('body').innerHTML = '<div class="loading">불러오는 중…</div>';
    try {
      // 문서에는 fy 가 저장되지 않는다. 날짜 범위로 조회한다.
      const [a, b] = await Promise.all([
        getDocs(query(collection(db, 'offerings'), where('date', '>=', r.from), where('date', '<=', r.to))),
        getDocs(query(collection(db, 'expenses'), where('date', '>=', r.from), where('date', '<=', r.to)))
      ]);
      // 문서 id 를 남긴다. 기간검색의 명세 목록에서 수정·삭제에 쓴다.
      incDocs = a.docs.map((d) => ({ id: d.id, ...d.data() }));
      expDocs = b.docs.map((d) => ({ id: d.id, ...d.data() }));
      agg = aggregate();
      renderAll();
      $('xlsBtn').disabled = false;
    } catch (e) {
      console.error(e);
      $('body').innerHTML = '<div class="loading">조회에 실패했습니다.</div>';
    }
  }

  // ---- 집계 ----
  // 문서는 항목 노드를 참조하지 않고 이름·코드를 '복사'해 저장한다(스냅샷).
  // 따라서 이름 경로(catPath)로 노드를 되찾는다. code 는 재채번으로 바뀔 수 있어 믿지 않는다.
  function leafMap(kind, byId) {
    const m = {};
    scope(kind).forEach((n) => { m[catKey(pathOf(n, byId))] = n; });
    return m;
  }
  const docPath = (d) => d.catPath || [d.c1, d.c2, d.c3].filter(Boolean).join(' › ');

  function aggregate() {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });

    const build = (kind, docs) => {
      const keyMap = leafMap(kind, byId);
      const actual = {};                       // nodeId → 결산 합계
      const buckets = {};                      // nodeId → [칸별 금액]
      let unmatchedCnt = 0, unmatchedAmt = 0;  // 항목을 못 찾은 기록
      let nonLeafCnt = 0, nonLeafAmt = 0;      // 하위항목이 생겨 표에 자리가 없는 기록
      docs.forEach((d) => {
        const amt = Number(d.amount || 0);
        const bi = BK.of(d.date);
        if (BK.strict && bi < 0) return;       // 조회 범위는 넓지만 이 칸에 속하지 않는다
        const n = keyMap[catKey(docPath(d))];
        if (!n) { unmatchedCnt++; unmatchedAmt += amt; return; }
        if (!isLeaf(kind, n.id)) { nonLeafCnt++; nonLeafAmt += amt; return; }
        actual[n.id] = (actual[n.id] || 0) + amt;
        if (bi >= 0) {
          if (!buckets[n.id]) buckets[n.id] = new Array(BK.n).fill(0);
          buckets[n.id][bi] += amt;
        }
      });

      // 트리 순서대로 리프를 뽑는다 (엑셀 행 순서와 같다)
      const leaves = [];
      const walk = (pid) => {
        childrenOf(kind, pid).forEach((c) => {
          if (isLeaf(kind, c.id)) leaves.push(c); else walk(c.id);
        });
      };
      walk(null);

      const rows = leaves.map((n) => {
        const root = rootOf(n, byId);
        return {
          id: n.id, code: n.code || '',
          c1: root ? String(root.name || '') : '',
          name: String(n.name || ''),
          path: pathOf(n, byId),
          fund: fundOf(n, byId),
          carry: root && String(root.name || '').trim() === CARRY_C1,
          budget: Number(n.budget || 0),
          actual: Number(actual[n.id] || 0),
          months: buckets[n.id] || new Array(BK.n).fill(0)
        };
      });
      return { rows, unmatchedCnt, unmatchedAmt, nonLeafCnt, nonLeafAmt };
    };

    const inc = build('income', incDocs);
    const exp = build('expense', expDocs);

    // 수입 3분류:
    //   이월    = 대분류가 '이월'          (수입부총계에 넣지 않는다)
    //   경상    = 기금 '일반' & 이월 아님   → 수입부총계
    //   목적기금 = 기금 '일반' 아님 & 이월 아님 → 특별헌금 블록
    const carry   = inc.rows.filter((r) => r.carry);
    const normal  = inc.rows.filter((r) => !r.carry && r.fund === DEFAULT_FUND);
    const special = inc.rows.filter((r) => !r.carry && r.fund !== DEFAULT_FUND);

    return { inc, exp, carry, normal, special, expRows: exp.rows };
  }

  // c1 단위로 묶는다 (엑셀의 세로병합 + 소계 구조)
  function groupByC1(rows) {
    const out = [], idx = {};
    rows.forEach((r) => {
      if (!(r.c1 in idx)) { idx[r.c1] = out.length; out.push({ c1: r.c1, rows: [] }); }
      out[idx[r.c1]].rows.push(r);
    });
    out.forEach((g) => {
      g.budget = g.rows.reduce((s, r) => s + r.budget, 0);
      g.actual = g.rows.reduce((s, r) => s + r.actual, 0);
    });
    return out;
  }
  const sumB = (rows) => rows.reduce((s, r) => s + r.budget, 0);
  const sumA = (rows) => rows.reduce((s, r) => s + r.actual, 0);

  // ---- 렌더 ----
  function renderAll() {
    renderWarn();
    const html = [];
    if (TYPE === 'bs') {
      html.push(tableHtml('수입부', '기금 · 일반재정', groupByC1(agg.normal), '수입부 총계'));
      if (agg.special.length) html.push(tableHtml('특별헌금', '목적기금 · 수입부 총계에 포함되지 않는다', groupByC1(agg.special), '특별헌금 소계'));
      if (agg.carry.length) html.push(tableHtml('이월', '전 회기에서 넘어온 잔액 · 수입이 아니다', groupByC1(agg.carry), '이월 합계'));
      html.push(tableHtml('지출부', '', groupByC1(agg.expRows), '지출 총계'));
      html.push(balanceHtml());
      // 예결산표 창은 '원래 통계탭 한 화면'이다. 월별 내역까지 이어서 보여준다.
      html.push(gridHtml('수입내역 (월별)', agg.normal, agg.special));
      html.push(gridHtml('지출내역 (월별)', agg.expRows));
    } else if (TYPE === 'range') {
      html.push(rangeHtml());
    } else if (TYPE === 'monthly') {
      // 구분 라디오로 하나만 낸다. 12개월 × 항목 15개짜리 표를 둘 다 쌓으면
      // 지출을 보려고 수입표를 통째로 지나쳐야 한다.
      // 특별헌금 체크를 끄면 tail 을 빈 배열로 넘긴다 → 합계(헌금+기타)만 남는다.
      if (curKind === 'income') html.push(gridHtml('수입내역 (월별)', agg.normal, showSp ? agg.special : []));
      else html.push(gridHtml('지출내역 (월별)', agg.expRows));
    } else if (TYPE === 'weekly') {
      if (!BK.n) html.push('<div class="loading">해당 월에 주일이 없습니다.</div>');
      if (curKind === 'income') html.push(gridHtml('수입내역 (주별)', agg.normal, showSp ? agg.special : []));
      else html.push(gridHtml('지출내역 (주별)', agg.expRows));
    } else if (TYPE === 'member') {
      html.push(memberHtml());
    }
    $('body').innerHTML = html.join('');
    fitHead();
    // 찾은 사람이 50번째면 화면 밖이다. 강조만 해 놓고 안 데려오면 못 찾는다.
    // block:'center' — 표 안(스크롤 컨테이너)에서 가운데로 온다.
    const hit = $('firstHit');
    if (hit) hit.scrollIntoView({ block: 'center' });
  }

  // ---- 표 헤더 고정: 상단 블록의 실제 높이를 재서 --topH 에 넣는다 ----
  // 창마다 컨트롤 줄 수가 다르고(기간검색은 2줄), 폭이 좁으면 flex-wrap 으로 더 늘어난다.
  // 하드코딩하면 헤더가 상단 바에 가리거나 틈이 생긴다.
  // 예결산표(bs)는 뺀다 — 한 화면에 표가 6개라 각 표에 높이 제한을 주면 화면이 조각난다.
  const STICK_HEAD = (TYPE === 'member' || TYPE === 'range' || TYPE === 'weekly' || TYPE === 'monthly');
  function fitHead() {
    if (!STICK_HEAD) return;
    document.body.classList.add('stickhead');
    document.documentElement.style.setProperty('--topH', $('top').offsetHeight + 'px');
  }
  window.addEventListener('resize', fitHead);

  // ---- 기간 단위 검색 ----
  // 개별 명세만 낸다 (offering.html 수입·지출 목록과 동일한 컬럼).
  // 집계표는 두지 않는다 — 명세 제목줄의 '건수 · 합계'와 표 안의 합계 행까지 세 번 겹친다.
  // 기간이 자유라 예산·기금별잔액도 의미가 없다. 예산 비교는 예결산표 창에서.
  function rangeHtml() {
    const title = curKind === 'income' ? '수입' : '지출';
    const catTxt = curCat ? esc(curCat) : '전체 항목';
    const recs = catFilterDocs(curKind === 'income' ? incDocs : expDocs);
    const sum = recs.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    if (!recs.length) {
      return `<div class="sect">
        <div class="sh">${title} 명세<span class="sub">${catTxt} · 0건</span></div>
        <div class="loading">이 기간에 기록이 없습니다.</div></div>`;
    }
    return `<div class="sect">
      <div class="sh">${title} 명세<span class="sub">${catTxt} · ${recs.length}건, 합계: ${fmt(sum)}원 · 헤더를 눌러 정렬</span></div>
      <div id="bulkHost">${bulkHtml(recs)}</div>
      ${curKind === 'income' ? incTable(recs) : expTable(recs)}
      <div id="memoBar" class="imemo"></div>
    </div>`;
  }

  // ---- 일괄 수정 ----
  // 고른 건들의 값이 같으면 그 값을, 다르면 빈칸 + placeholder '-' (칸 전체를 흐리게).
  // 저장할 때 '연 시점의 값(bulkInit)'과 비교해 **달라진 칸만** 덮어쓴다.
  // 그래서 서로 다른 칸은 건드리지 않는 한 그대로 남고, 일부러 비우면 그건 '삭제'로 인정된다.
  const MIXED = '\u0000MIXED';      // 값이 제각각임을 나타내는 표식. 실제 데이터에 나올 수 없는 문자.
  function commonVal(docs, get) {
    if (!docs.length) return '';
    const first = get(docs[0]);
    return docs.every((d) => get(d) === first) ? first : MIXED;
  }
  // 저장은 리프(말단) 항목에만 한다. 상위에 저장하면 부모가 자식 합계를 또 더해 이중계상된다.
  function leafOpts(sel) {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const out = [];
    const walk = (pid) => {
      childrenOf(curKind, pid).forEach((c) => {
        const kids = childrenOf(curKind, c.id);
        if (kids.length) { walk(c.id); return; }             // 부모는 고를 수 없다
        const p = pathOf(c, byId);
        out.push(`<option value="${esc(c.id)}"${catKey(p) === catKey(sel) ? ' selected' : ''}>${esc(p)}</option>`);
      });
    };
    walk(null);
    return out.join('');
  }
  function bulkHtml(recs) {
    if (!bulkOpen) return '';
    const picked = recs.filter((r) => selIds.has(r.id));
    if (!picked.length) return '';

    const isInc = curKind === 'income';
    const vDate = commonVal(picked, (d) => d.date || '');
    const vPath = commonVal(picked, (d) => d.catPath || '');
    const vAmt = commonVal(picked, (d) => String(d.amount || ''));
    const vMemo = commonVal(picked, (d) => d.memo || '');
    const vPayee = isInc ? '' : commonVal(picked, (d) => d.payee || '');

    // 패널을 여는 지금이 '시작값'이다. 저장 시 이것과 비교한다.
    bulkInit = { date: vDate, path: vPath, amount: vAmt, memo: vMemo, payee: vPayee };

    const mx = (v) => (v === MIXED ? ' mixed' : '');
    const val = (v) => (v === MIXED ? '' : esc(v));
    const ph = (v) => (v === MIXED ? ' placeholder="-"' : '');

    const payeeRow = isInc ? '' : `
      <div class="fld${mx(vPayee)}"><span class="lab">수령인</span>
        <input id="bPayee" type="text" value="${val(vPayee)}"${ph(vPayee)}></div>`;

    return `<div class="bulk">
      <div class="bh"><span>일괄 수정</span><span class="cnt">${picked.length}건 선택</span>
        <button class="bx" id="bClose" aria-label="닫기">✕</button></div>
      <div class="fld${mx(vDate)}"><span class="lab">날짜</span>
        <input id="bDate" type="date" value="${val(vDate)}"></div>
      <div class="fld${mx(vPath)}"><span class="lab">항목</span>
        <select id="bCat">${vPath === MIXED ? '<option value="">-</option>' : ''}${leafOpts(vPath === MIXED ? '' : vPath)}</select></div>
      <div class="fld${mx(vAmt)}"><span class="lab">금액</span>
        <input id="bAmt" type="text" inputmode="numeric" value="${vAmt === MIXED ? '' : fmt(vAmt)}"${ph(vAmt)}></div>
      ${payeeRow}
      <div class="fld${mx(vMemo)}"><span class="lab">${isInc ? '비고' : '적요'}</span>
        <input id="bMemo" type="text" value="${val(vMemo)}"${ph(vMemo)}></div>
      <div class="bmsg" id="bMsg" hidden></div>
      <div class="bf">
        <button class="bsave" id="bSave">${picked.length}건 일괄 수정 저장</button>
        <button class="bcancel" id="bCancel">취소</button>
      </div>
    </div>`;
  }

  // 날짜가 mixed 라 빈칸으로 열렸을 때, 사용자가 안 건드렸으면 빈칸 그대로다 → 안 바뀐 것.
  // 시작값도 MIXED(=화면상 빈칸)였으므로 '' !== MIXED 가 되어 오탐이 난다. 그래서 따로 판정한다.
  const changed = (now, init) => (init === MIXED ? now !== '' : now !== init);

  async function bulkSave() {
    const recs = catFilterDocs(curKind === 'income' ? incDocs : expDocs);
    const picked = recs.filter((r) => selIds.has(r.id));
    if (!picked.length) return;

    const msg = (t) => { const b = $('bMsg'); b.textContent = t; b.hidden = !t; };
    msg('');

    const isInc = curKind === 'income';
    const nDate = $('bDate').value;
    const nPath = $('bCat').value ? pathOfId($('bCat').value) : '';
    const nAmt = String(onlyNum($('bAmt').value) || '');
    const nMemo = $('bMemo').value.trim();
    const nPayee = isInc ? '' : $('bPayee').value.trim();

    const patch = {};
    if (changed(nDate, bulkInit.date)) {
      if (!nDate) return msg('날짜를 비울 수는 없습니다.');
      patch.date = nDate;
      patch.week = weekLabel(nDate);       // 날짜만 바꾸고 주차를 안 바꾸면 둘이 어긋난다
    }
    if (changed(nPath, bulkInit.path)) {
      const it = nodes.find((n) => n.id === $('bCat').value);
      if (!it) return msg('항목을 다시 고르세요.');
      const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
      const parts = pathOf(it, byId).split(' › ');
      // 항목은 한 벌로 갱신해야 한다. code 만 바꾸고 c1/c2/c3 를 놔두면 집계가 어긋난다.
      patch.c1 = parts[0] || '';
      patch.c2 = parts[1] || '';
      patch.c3 = parts[2] || '';
      patch.catPath = parts.join(' › ');
      patch.code = it.code || '';
    }
    if (changed(nAmt, bulkInit.amount)) {
      const a = Number(nAmt);
      if (!a) return msg('금액을 비우거나 0 으로 할 수는 없습니다.');
      patch.amount = a;
    }
    if (changed(nMemo, bulkInit.memo)) patch.memo = nMemo;
    if (!isInc && changed(nPayee, bulkInit.payee)) patch.payee = nPayee;

    const keys = Object.keys(patch);
    if (!keys.length) return msg('바뀐 칸이 없습니다.');
    if (!confirm(`${picked.length}건의 [${keys.filter((k) => k !== 'week').join(', ')}] 을(를) 바꿉니다. 진행할까요?`)) return;

    const btn = $('bSave'); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      const coll = isInc ? 'offerings' : 'expenses';
      // 56명 규모라 건수가 많지 않다. 순차 저장으로 충분하고, 실패 지점을 알기 쉽다.
      for (const r of picked) {
        await updateDoc(doc(db, coll, r.id), { ...patch, updatedAt: serverTimestamp(), updatedBy: me.uid });
      }
      bulkOpen = false;
      selIds.clear();
      await reload();
    } catch (e) {
      btn.disabled = false; btn.textContent = `${picked.length}건 일괄 수정 저장`;
      msg('저장 실패: ' + (e.code || e.message));
    }
  }
  const pathOfId = (id) => {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    return byId[id] ? pathOf(byId[id], byId) : '';
  };

  // 항목 필터를 '문서'에 적용한다 (집계행이 아니라 원본 기록).
  function catFilterDocs(docs) {
    if (!curCat) return docs;
    const k = catKey(curCat);
    return docs.filter((d) => {
      const dk = catKey(docPath(d));
      return dk === k || dk.startsWith(k + '›');
    });
  }

  // ---- 명세 목록 (offering.html 919·1094행과 같은 컬럼·같은 정렬 규칙) ----
  const SVG_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const SVG_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const SVG_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';

  let recSort = { key: 'date', dir: 'desc' };
  const wkNo = (r) => { const m = (r.week || '').match(/(\d+)\s*주/); return m ? m[1] : ''; };

  function recSortVal(r, k) {
    switch (k) {
      // 'no' 는 없다. 그 열 자리에 체크박스가 들어가 헤더가 사라졌다.
      // (문서의 no 필드는 그대로 있고, 동점 처리에는 여전히 쓴다)
      case 'fy': return fiscalYearOf(parseYMD(r.date));
      case 'week': return Number(wkNo(r)) || 0;
      case 'date': return r.date || '';
      case 'item': return r.code || '';
      case 'id': return Number(curKind === 'income' ? r.memberNo : r.claimantNo) || 0;
      case 'name': return (curKind === 'income' ? r.memberName : r.claimantName) || '';
      case 'amt': return Number(r.amount) || 0;
      case 'sub': return (curKind === 'income' ? r.spouseName : r.payee) || '';
    }
    return '';
  }
  function sortRecs(rows) {
    const k = recSort.key, sign = recSort.dir === 'asc' ? 1 : -1;
    const strKey = (k === 'date' || k === 'item' || k === 'name' || k === 'sub');
    return rows.sort((a, b) => {
      const x = recSortVal(a, k), y = recSortVal(b, k);
      let c = strKey ? String(x).localeCompare(String(y), 'ko') : (x - y);
      if (c === 0) c = (Number(a.no) || 0) - (Number(b.no) || 0);
      return sign * c;
    });
  }
  const recTh = (k, label) => `<th class="sortable" data-rk="${k}">${label}${
    recSort.key === k ? `<span class="sar">${recSort.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`;

  function recRow(r, idno, who, sub) {
    const item = esc(r.c3 || r.c2 || r.c1 || '');
    const ymd = esc((r.date || '').replace(/-/g, ''));
    const on = selIds.has(r.id);
    // No. 열 자리에 체크박스를 넣는다. no 필드·offering.html 의 No. 열은 그대로 둔다.
    return `<tr class="${on ? 'sel' : ''}">
      <td class="ce"><input type="checkbox" class="ck" data-ck="${r.id}"${on ? ' checked' : ''} aria-label="선택"></td>
      <td>${fiscalYearOf(parseYMD(r.date))}</td><td>${wkNo(r)}</td><td>${ymd}</td>
      <td>${item}</td><td>${esc(idno)}</td><td>${esc(who)}</td>
      <td class="ra amt">${fmt(r.amount)}</td><td>${esc(sub)}</td>
      <td class="ce">${r.memo ? `<button class="iact i-note" data-note="${r.id}" aria-label="메모 보기">${SVG_NOTE}</button>` : '–'}</td>
      <td class="ce"><button class="iact i-edit" data-edit="${r.id}" aria-label="수정">${SVG_EDIT}</button><button class="iact i-del" data-del="${r.id}" aria-label="삭제">${SVG_DEL}</button></td>
    </tr>`;
  }
  // 헤더 체크박스 = 지금 보이는 목록 전체 토글. (검색·항목 필터로 걸러진 것만 대상이다)
  function ckAllTh(recs) {
    const all = recs.length > 0 && recs.every((r) => selIds.has(r.id));
    return `<th class="ce"><input type="checkbox" class="ck" id="ckAll"${all ? ' checked' : ''} aria-label="전체 선택"></th>`;
  }
  function incTable(rows) {
    const sorted = sortRecs(rows.slice());
    const body = sorted.map((r) =>
      recRow(r, r.memberNo ? '#' + r.memberNo : '', r.memberName || '', r.spouseName || '–')).join('');
    return `<div class="itblwrap"><table class="itbl">
      <thead><tr>${ckAllTh(sorted)}${recTh('fy', '회계년도')}${recTh('week', '주')}${recTh('date', '날짜')}${recTh('item', '항목')}${recTh('id', 'id')}${recTh('name', '이름')}${recTh('amt', '금액')}${recTh('sub', '배우자')}<th class="ce">비고</th><th class="ce">수정·삭제</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }
  function expTable(rows) {
    const sorted = sortRecs(rows.slice());
    const body = sorted.map((r) =>
      recRow(r, r.claimantNo ? '#' + r.claimantNo : '', r.claimantName || '', r.payee || '–')).join('');
    return `<div class="itblwrap"><table class="itbl">
      <thead><tr>${ckAllTh(sorted)}${recTh('fy', '회계년도')}${recTh('week', '주')}${recTh('date', '날짜')}${recTh('item', '항목')}${recTh('id', 'id')}${recTh('name', '청구인')}${recTh('amt', '금액')}${recTh('sub', '수령인')}<th class="ce">적요</th><th class="ce">수정·삭제</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // 명세 목록의 정렬·메모·수정·삭제·일괄수정. renderAll 마다 새로 그려지므로 #body 에 위임한다.
  // ★ 체크박스는 renderAll() 을 부르지 않는다. 표를 통째로 다시 그리면 스크롤이 맨 위로 튄다.
  //   행 색과 패널만 손본다.
  function refreshBulk() {
    const recs = catFilterDocs(curKind === 'income' ? incDocs : expDocs);
    const host = $('bulkHost');
    if (host) host.innerHTML = bulkHtml(recs);
    const ckAll = $('ckAll');
    if (ckAll) ckAll.checked = recs.length > 0 && recs.every((r) => selIds.has(r.id));
  }
  $('body').addEventListener('change', (e) => {
    if (TYPE !== 'range' || !agg) return;
    const recs = catFilterDocs(curKind === 'income' ? incDocs : expDocs);
    if (e.target.id === 'ckAll') {
      // 지금 화면에 보이는 것만 토글한다. 항목 필터로 걸러진 건 건드리지 않는다.
      const on = e.target.checked;
      recs.forEach((r) => { if (on) selIds.add(r.id); else selIds.delete(r.id); });
      document.querySelectorAll('.itbl [data-ck]').forEach((el) => {
        el.checked = on;
        el.closest('tr').classList.toggle('sel', on);
      });
      bulkOpen = selIds.size > 0;
      refreshBulk();
      return;
    }
    const ck = e.target.closest('[data-ck]');
    if (ck) {
      if (ck.checked) selIds.add(ck.dataset.ck); else selIds.delete(ck.dataset.ck);
      ck.closest('tr').classList.toggle('sel', ck.checked);
      bulkOpen = selIds.size > 0;   // 한 건이라도 고르면 패널이 열린다. 다 풀면 닫힌다.
      refreshBulk();
    }
  });

  $('body').addEventListener('click', async (e) => {
    if (TYPE !== 'range' || !agg) return;
    if (e.target.closest('#bSave')) { await bulkSave(); return; }
    if (e.target.closest('#bCancel') || e.target.closest('#bClose')) {
      bulkOpen = false; selIds.clear(); renderAll(); return;
    }
    const th = e.target.closest('th[data-rk]');
    if (th) {
      const k = th.dataset.rk;
      if (recSort.key === k) recSort.dir = (recSort.dir === 'asc' ? 'desc' : 'asc');
      else recSort = { key: k, dir: 'asc' };
      renderAll();
      return;
    }
    const note = e.target.closest('[data-note]');
    if (note) {
      const docs = curKind === 'income' ? incDocs : expDocs;
      const r = docs.find((x) => x.id === note.dataset.note);
      const bar = $('memoBar');
      if (r && bar) {
        bar.innerHTML = `<b>${curKind === 'income' ? '비고' : '적요'}:</b> ` + esc(r.memo || '');
        bar.style.display = 'block';
      }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      // 편집 폼은 offering.html 에만 있다. 기간까지 넘겨야 그 기록이 목록에 잡혀 편집이 열린다.
      const r = qRange();
      const tab = curKind === 'income' ? 'inc' : 'exp';
      location.href = `offering.html?tab=${tab}&edit=${encodeURIComponent(ed.dataset.edit)}&from=${r.from}&to=${r.to}`;
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('이 기록을 삭제할까요?')) return;
      try {
        await deleteDoc(doc(db, curKind === 'income' ? 'offerings' : 'expenses', del.dataset.del));
        await reload();
      } catch (err) { alert('삭제 실패: ' + (err.code || err.message)); }
    }
  });

  function renderWarn() {
    const w = [];
    const add = (label, o) => {
      if (o.unmatchedCnt) w.push(`<b>${label} ${o.unmatchedCnt}건(${fmt(o.unmatchedAmt)}원)</b> 이 항목설정에 없는 이름으로 저장되어 있어 <b>표에서 빠졌습니다.</b> 항목명이 바뀌었는지 확인하세요.`);
      if (o.nonLeafCnt) w.push(`<b>${label} ${o.nonLeafCnt}건(${fmt(o.nonLeafAmt)}원)</b> 이 하위항목을 가진 항목에 저장되어 있어 표에서 빠졌습니다.`);
    };
    add('수입', agg.inc);
    add('지출', agg.exp);
    const box = $('warnBox');
    box.classList.toggle('on', w.length > 0);
    box.innerHTML = w.join('<br>');
  }

  function tableHtml(title, sub, groups, totLabel) {
    const b = sumB(groups.flatMap((g) => g.rows));
    const a = sumA(groups.flatMap((g) => g.rows));
    const rows = [];
    groups.forEach((g) => {
      g.rows.forEach((r, i) => {
        rows.push(`<tr>
          <td class="g">${i === 0 ? esc(g.c1) : ''}</td>
          <td class="n">${esc(r.name)}</td>
          <td class="m">${r.budget ? fmt(r.budget) : ''}</td>
          <td class="m">${r.actual ? fmt(r.actual) : ''}</td>
          <td class="m${r.actual - r.budget < 0 ? ' neg' : ''}">${diff(r.budget, r.actual)}</td>
        </tr>`);
      });
      // 대분류가 하나뿐이면 소계 = 총계라 중복이다. 2개 이상일 때만 소계를 낸다.
      if (groups.length > 1) {
        rows.push(`<tr class="sub">
          <td class="g"></td><td class="n">소계</td>
          <td class="m">${fmt(g.budget)}</td><td class="m">${fmt(g.actual)}</td>
          <td class="m${g.actual - g.budget < 0 ? ' neg' : ''}">${diff(g.budget, g.actual)}</td>
        </tr>`);
      }
    });
    rows.push(`<tr class="tot">
      <td class="g"></td><td class="n">${esc(totLabel)}</td>
      <td class="m">${fmt(b)}</td><td class="m">${fmt(a)}</td>
      <td class="m${a - b < 0 ? ' neg' : ''}">${diff(b, a)}</td>
    </tr>`);
    return `<div class="sect">
      <div class="sh">${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
      <table class="t">
        <colgroup><col class="c-g"><col class="c-n"><col class="c-m"><col class="c-m"><col class="c-m"></colgroup>
        <thead><tr><th class="hl">항목</th><th class="hn">소항목</th><th class="hr">예산</th><th class="hr">결산</th><th class="hr">차액</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  }

  // 차액 = 결산 − 예산 (예산이 0이면 비교 의미가 없어 비워 둔다)
  function diff(budget, actual) {
    if (!budget) return '';
    const d = actual - budget;
    return (d > 0 ? '+' : '') + fmt(d);
  }

  // ---- 기금별 잔액 ----
  // 통장은 하나지만 주머니는 5개다. 합산하면 일반재정 잔액이 부풀려진다.
  // ※ 목적기금 지출은 앱에 입력되어 있지 않다(엑셀에서 수기 입력). 여기서는 0으로 나온다.
  function fundBalance() {
    const out = FUNDS.map((f) => ({
      fund: f,
      carry: sumA(agg.carry.filter((r) => r.fund === f)),
      income: sumA(agg.normal.concat(agg.special).filter((r) => r.fund === f)),
      expense: sumA(agg.expRows.filter((r) => r.fund === f))
    }));
    out.forEach((o) => { o.bal = o.carry + o.income - o.expense; });
    return out.filter((o) => o.fund === DEFAULT_FUND || o.carry || o.income || o.expense);
  }

  function balanceHtml() {
    const list = fundBalance();
    const t = { carry: 0, income: 0, expense: 0, bal: 0 };
    list.forEach((o) => { t.carry += o.carry; t.income += o.income; t.expense += o.expense; t.bal += o.bal; });
    const rows = list.map((o) => `<tr>
      <td class="n" style="padding-left:10px;">${esc(o.fund === DEFAULT_FUND ? '일반재정' : o.fund)}</td>
      <td class="m">${fmt(o.carry)}</td>
      <td class="m">${fmt(o.income)}</td>
      <td class="m">${fmt(o.expense)}</td>
      <td class="m" style="font-weight:700;">${fmt(o.bal)}</td>
    </tr>`).join('');
    return `<div class="sect">
      <div class="sh">기금별 잔액<span class="sub">이월 + 수입 − 지출 = 잔액</span></div>
      <div class="lead">목적기금 지출은 앱에 입력되어 있지 않아 0으로 나옵니다. 엑셀에서 직접 채우세요.</div>
      <table class="t" style="margin-top:8px;">
        <colgroup><col><col class="c-m"><col class="c-m"><col class="c-m"><col class="c-m"></colgroup>
        <thead><tr><th class="hl">기금</th><th class="hr">이월금</th><th class="hr">수입</th><th class="hr">지출</th><th class="hr">잔액</th></tr></thead>
        <tbody>${rows}
          <tr class="tot">
            <td class="n" style="padding-left:10px;">합계</td>
            <td class="m">${fmt(t.carry)}</td><td class="m">${fmt(t.income)}</td>
            <td class="m">${fmt(t.expense)}</td><td class="m">${fmt(t.bal)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }

  // ---- 가로표 (년간 12개월 / 월간 주차 공용) ----
  // 이월은 넣지 않는다. 수입이 아니고, 한 칸에 뭉쳐 표를 왜곡한다.
  // tailRows(특별헌금)는 목적기금이라 합계에 넣지 않는다. 합계 '아래'에 별도 블록으로 붙인다.
  //   헌금 › 기타 › [합계 = 헌금+기타] › 특별헌금
  function gridHtml(title, rows, tailRows) {
    const tail = tailRows || [];
    if (!rows.length && !tail.length) return '';
    const labels = BK.labels;
    const cell = (v) => v ? fmt(v) : '';
    const line = (cls, g, nm, ms, tot) => `<tr class="${cls}">
      <td class="g fix1">${esc(g)}</td>
      <td class="n fix2">${esc(nm)}</td>
      ${ms.map((v) => `<td>${cell(v)}</td>`).join('')}
      <td class="sumcol">${fmt(tot)}</td>
    </tr>`;
    // forceSub: 블록에 대분류가 1개뿐이어도 소계를 낸다 (특별헌금은 합계와 겹치지 않으므로 필요하다)
    const block = (gs, forceSub) => {
      const out = [];
      gs.forEach((g) => {
        const gm = new Array(BK.n).fill(0);
        g.rows.forEach((r, i) => {
          r.months.forEach((v, k) => { gm[k] += v; });
          out.push(line('', i === 0 ? g.c1 : '', r.name, r.months, r.actual));
        });
        if (forceSub || gs.length > 1) out.push(line('sub', '', '소계', gm, g.actual));
      });
      return out;
    };

    const totM = new Array(BK.n).fill(0);
    rows.forEach((r) => r.months.forEach((v, k) => { totM[k] += v; }));

    const body = block(groupByC1(rows), false);
    body.push(line('tot', '', '합계', totM, sumA(rows)));   // 헌금 + 기타 (특별헌금 제외)
    if (tail.length) {
      // 합계와 특별헌금 사이에 빈 줄 하나 (엑셀 출력과 같은 모양)
      body.push(`<tr class="spc"><td class="g fix1"></td><td class="n fix2"></td>${'<td></td>'.repeat(BK.n)}<td class="sumcol"></td></tr>`);
      block(groupByC1(tail), true).forEach((s) => body.push(s));
    }

    return `<div class="sect">
      <div class="sh">${esc(title)}<span class="sub">가로로 밀어서 보세요</span></div>
      <div class="scrollx">
        <table class="m">
          <thead><tr>
            <th class="fix1">항목</th><th class="fix2">소항목</th>
            ${labels.map((l) => `<th>${esc(l)}</th>`).join('')}
            <th>합계</th>
          </tr></thead>
          <tbody>${body.join('')}</tbody>
        </table>
      </div>
    </div>`;
  }

  // ---- 성도별 헌금 집계 ----
  // 수입(offerings)만. 이월은 사람이 없으니 뺀다. 열 = 헌금 항목(리프), 행 = 성도.
  // ※ 헌금 문서의 이름 필드는 name 이 아니라 memberName 이다. ID 는 memberNo, 명부 링크는 memberId.
  //   (offering.html 수동저장 804행 / 임포트 1502행 — 두 경로 모두 같은 필드로 쓴다)
  function memberHtml() {
    const cols = agg.normal.concat(agg.special);      // 이월 제외한 수입 리프 (트리 순서)
    if (!cols.length) return '<div class="loading">수입 항목이 없습니다.</div>';

    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const keyMap = leafMap('income', byId);
    const colIdx = {}; cols.forEach((r, i) => { colIdx[r.id] = i; });

    const map = {};
    incDocs.forEach((d) => {
      const bi = BK.of(d.date);
      if (BK.strict && bi < 0) return;
      const n = keyMap[catKey(docPath(d))];
      if (!n || !(n.id in colIdx)) return;            // 미매칭·이월·비리프는 제외
      const nm = String(d.memberName || '').trim();
      const no = (d.memberNo === 0 || d.memberNo) ? String(d.memberNo) : '';
      // 사람을 가르는 기준은 명부 링크(memberId) 다. 이름만으로 묶으면 동명이인이 한 줄로 합쳐진다.
      const key = d.memberId || (nm ? 'N:' + nm : '(무기명)');
      if (!map[key]) map[key] = { no, name: nm || '(무기명)', cells: new Array(cols.length).fill(0), total: 0 };
      if (!map[key].no && no) map[key].no = no;       // 일부 문서에만 ID 가 붙어 있을 수 있다
      const amt = Number(d.amount || 0);
      map[key].cells[colIdx[n.id]] += amt;
      map[key].total += amt;
    });

    // ★ 검색은 '걸러내기'가 아니라 '찾아 주기'다. 목록은 늘 전원 그대로 두고 해당 행만 강조한다.
    //    걸러내면 앞뒤 사람과 견줘 볼 수가 없다.
    const qn = memQ;
    const list = Object.values(map).sort(memCmp);     // 기본 ID↑ · 헤더 클릭으로 바뀐다
    const all = list.length;
    const isHit = (m) => !!qn && m.name.includes(qn);
    const hits = list.filter(isHit);

    // 한 명으로 좁혀지면 ID 칸에 그 사람의 ID 를 띄운다.
    // (offering.html 에서 이름 Enter 치면 왼쪽 번호칸이 채워지는 것과 같은 동작)
    $('qNo').textContent = (hits.length === 1 && hits[0].no) ? padNo(hits[0].no) : '–';

    // '전체' 행은 언제나 전원 기준이다. 강조는 표시일 뿐 집계를 건드리지 않는다.
    const totC = new Array(cols.length).fill(0);
    let totS = 0;
    list.forEach((m) => { m.cells.forEach((v, i) => { totC[i] += v; }); totS += m.total; });

    // 아무도 안 낸 항목(구역헌금·기타헌금 등)은 열 자체를 뺀다. 빈 열이 가로 스크롤만 늘린다.
    // ※ 검색 결과가 아니라 '전체' 기준으로 판단한다. 검색할 때마다 열이 사라졌다 나타나면 어지럽다.
    // ※ data-sk 는 원래 열번호(i)를 유지한다. 화면 위치로 바꾸면 정렬 키가 어긋난다.
    const vis = cols.map((c, i) => i).filter((i) => totC[i] !== 0);
    const hidden = cols.length - vis.length;

    const cell = (v) => v ? fmt(v) : '';
    const sortName = memSort.key === 'no' ? 'ID'
      : memSort.key === 'name' ? '이름'
      : memSort.key === 'total' ? '합계'
      : (cols[Number(memSort.key.slice(2))] || {}).name || '';
    const sortTxt = `${sortName} ${memSort.dir === 1 ? '↑' : '↓'} · 헤더를 눌러 정렬`;
    // 열이 조용히 사라지면 데이터가 빠진 걸로 오해한다. 몇 개를 왜 숨겼는지 밝힌다.
    const hidTxt = hidden ? ` · 실적 없는 항목 ${hidden}개 숨김` : '';
    const findTxt = qn
      ? (hits.length ? `'${esc(qn)}' ${hits.length}명 찾음` : `'${esc(qn)}' 일치하는 성도 없음`)
      : '';
    const head = `<div class="sh">성도별 헌금<span class="sub">${
      [findTxt, `${all}명 · 합계 ${fmt(totS)}원`, esc(sortTxt)].filter(Boolean).join(' · ')}${hidTxt}</span></div>`;

    // No. = 화면 행번호. 항상 위에서부터 1,2,3… 이다.
    // 정렬을 바꾸면 '누가 몇 번인지'가 바뀔 뿐, 열 자체는 언제나 1,2,3… 으로 읽힌다.
    let first = true;
    const body = list.map((m, i) => {
      const hit = isHit(m);
      // 첫 일치 행에만 앵커를 단다. 렌더 후 여기로 스크롤한다.
      const anchor = (hit && first) ? ((first = false), ' id="firstHit"') : '';
      return `<tr class="${hit ? 'hit' : ''}"${anchor}>
      <td class="seq fix1">${i + 1}</td>
      <td class="g fix2">${esc(padNo(m.no))}</td>
      <td class="n fix3">${esc(m.name)}</td>
      <td class="tsum fix4">${fmt(m.total)}</td>
      ${vis.map((k) => `<td>${cell(m.cells[k])}</td>`).join('')}
    </tr>`;
    }).join('');

    return `<div class="sect">
      ${head}
      <div class="scrollx">
        <table class="m mem">
          <thead><tr>
            <th class="fix1">No.</th>
            <th class="fix2" data-sk="no">ID${arrow('no')}</th>
            <th class="fix3" data-sk="name">이름${arrow('name')}</th>
            <th class="fix4" data-sk="total">합계${arrow('total')}</th>
            ${vis.map((k) => `<th data-sk="i:${k}" title="${esc(cols[k].path)}">${esc(cols[k].name)}${arrow('i:' + k)}</th>`).join('')}
          </tr></thead>
          <tbody>${body}
            <tr class="tot">
              <td class="seq fix1"></td>
              <td class="g fix2"></td>
              <td class="n fix3">전체</td>
              <td class="tsum fix4">${fmt(totS)}</td>
              ${vis.map((k) => `<td>${cell(totC[k])}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // ---- 성도 1명: 세로 카드 ---- (제거됨)
  // 검색을 '걸러내기'에서 '강조하기'로 바꾸면서 1명만 남는 상황 자체가 없어졌다.
  // 목록은 늘 전원을 보여주고, 찾은 행에 노란 배경을 입힌 뒤 그 자리로 스크롤한다.

  // ======================= 엑셀 내보내기 (예결산표 창에서만) =======================
  // 앱 데이터는 건드리지 않는다. 출력 시점에만 이름을 갈아끼운다.
  const XL_NAME = {
    '일반재정': '헌금',            // 예결산표 대분류 이름
    '주일헌금': '주일', '감사헌금': '감사',
    '신년감사': '신년', '부활절감사': '부활', '맥추감사': '맥추',
    '성탄감사': '성탄', '추수감사': '추수',
    '신년감사헌금': '신년', '부활절감사헌금': '부활', '맥추감사헌금': '맥추',
    '성탄감사헌금': '성탄', '추수감사헌금': '추수',
    '선교헌금': '선교', '장학헌금': '장학', '건축헌금': '건축',
    '차량헌금': '차량', '차량구입': '차량'
  };
  const xn = (s) => XL_NAME[String(s || '').trim()] || String(s || '');
  // 기금별 잔액표에서만 쓰는 이름 (예결산표의 '헌금'과 다르다)
  const XL_FUND = { '일반': '경상비', '선교': '선교헌금', '장학': '장학헌금', '건축': '건축헌금', '차량': '차량구입' };
  const ETC_C1 = '기타';           // 예결산표에서 한 줄로 접는 대분류 (A안)

  const SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SHEETJS_CDN;
      s.onload = () => res();
      s.onerror = () => rej(new Error('SheetJS 로드 실패'));
      document.head.appendChild(s);
    });
  }

  // 차년(회기+1) 예산: 이름 경로로 매칭한다. code 는 회기마다 달라질 수 있다.
  function nextBudgetMap(kind) {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const m = {};
    nodes.filter((n) => Number(n.fy) === curFY + 1 && n.kind === kind)
      .forEach((n) => { m[catKey(pathOf(n, byId))] = Number(n.budget || 0); });
    return m;
  }

  const cellNum = (v) => (v ? v : '');          // 0 은 빈칸으로 (엑셀 원본과 동일)
  const mg = (r1, c1, r2, c2) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });

  // ---- 시트1: 예결산표 (좌 수입부 / 우 지출부) ----
  // 열: A항목 B소항목 C예산 D결산 E차년예산 | F공백 | G항목 H소항목 I예산 J결산 K차년예산
  function sheetBudgetActual() {
    const nbInc = nextBudgetMap('income');
    const nbExp = nextBudgetMap('expense');
    const nb = (map, r) => Number(map[catKey(r.path)] || 0);

    // 한쪽(수입 또는 지출)의 5열 블록을 만든다. merges 는 블록 내부 0-based 행번호로 기록.
    const block = (groups, totalLabel, nbMap, opt) => {
      const rows = [], merges = [];
      const etc = (opt && opt.etc) || null;   // '기타' 한 줄 (A안)
      groups.forEach((g) => {
        const s = rows.length;
        const gNext = g.rows.reduce((a, r) => a + nb(nbMap, r), 0);
        g.rows.forEach((r, i) => rows.push([
          i === 0 ? xn(g.c1) : '', xn(r.name),
          cellNum(r.budget), cellNum(r.actual), cellNum(nb(nbMap, r))
        ]));
        rows.push(['', '소계', cellNum(g.budget), cellNum(g.actual), cellNum(gNext)]);
        if (rows.length - 1 > s) merges.push([s, rows.length - 1, 0]);   // A열 세로병합
      });
      let tB = groups.reduce((a, g) => a + g.budget, 0);
      let tA = groups.reduce((a, g) => a + g.actual, 0);
      let tN = groups.reduce((a, g) => a + g.rows.reduce((x, r) => x + nb(nbMap, r), 0), 0);
      if (etc) {   // '기타'는 하위를 접어 한 줄로 (상세는 아래 소표에서)
        rows.push([xn(ETC_C1), '', cellNum(etc.budget), cellNum(etc.actual), cellNum(etc.next)]);
        tB += etc.budget; tA += etc.actual; tN += etc.next;
      }
      const tr = rows.length;
      rows.push([totalLabel, '', cellNum(tB), cellNum(tA), cellNum(tN)]);
      merges.push([tr, tr, 1]);   // 총계행: A:B 가로병합
      return { rows, merges };
    };

    // 수입부: '기타' 대분류는 한 줄로 접는다
    const normalG = groupByC1(agg.normal).filter((g) => g.c1 !== ETC_C1);
    const etcRows = agg.normal.filter((r) => r.c1 === ETC_C1);
    const etcBlock = etcRows.length ? {
      budget: sumB(etcRows), actual: sumA(etcRows),
      next: etcRows.reduce((a, r) => a + nb(nbInc, r), 0)
    } : null;
    const L = block(normalG, '수입부총계', nbInc, { etc: etcBlock });
    const R = block(groupByC1(agg.expRows), '총계', nbExp, null);

    // 특별헌금 블록 (수입부 아래, 한 줄 띄우고)
    const spG = groupByC1(agg.special);
    if (spG.length) {
      L.rows.push(['', '', '', '', '']);
      spG.forEach((g) => {
        const s = L.rows.length;
        g.rows.forEach((r, i) => L.rows.push([
          i === 0 ? xn(g.c1) : '', xn(r.name),
          cellNum(r.budget), cellNum(r.actual), cellNum(nb(nbInc, r))
        ]));
        L.rows.push(['', '소계', cellNum(g.budget), cellNum(g.actual),
          cellNum(g.rows.reduce((a, r) => a + nb(nbInc, r), 0))]);
        if (L.rows.length - 1 > s) L.merges.push([s, L.rows.length - 1, 0]);
      });
    }

    // *기타수입내역 소표 (기타의 하위 내역)
    if (etcRows.length) {
      L.rows.push(['', '', '', '', '']);
      const t = L.rows.length;
      L.rows.push(['*기타수입내역', '', '', '', '']);
      L.merges.push([t, t, 1]);
      L.rows.push(['항목', '', '', '금액', '비고']);
      L.merges.push([L.rows.length - 1, L.rows.length - 1, 1]);
      etcRows.forEach((r) => {
        L.rows.push([xn(r.name), '', '', cellNum(r.actual), '']);
        L.merges.push([L.rows.length - 1, L.rows.length - 1, 1]);
      });
      L.rows.push(['총수입', '', '', cellNum(sumA(etcRows)), '']);
      L.merges.push([L.rows.length - 1, L.rows.length - 1, 1]);
    }

    // ---- 두 블록을 나란히 합친다 ----
    const HDR = 3;                                  // 0-based: 4행이 헤더
    const aoa = [
      [`${curFY}~${curFY + 1} 예결산`],
      [],
      ['수입부', '', '', '', '', '', '지출부'],
      ['항목', '소항목', `${curFY}년 예산`, `${curFY}년 결산`, `${curFY + 1}년 예산`, '',
       '항목', '소항목', `${curFY}년 예산`, `${curFY}년 결산`, `${curFY + 1}년 예산`]
    ];
    const n = Math.max(L.rows.length, R.rows.length);
    for (let i = 0; i < n; i++) {
      const l = L.rows[i] || ['', '', '', '', ''];
      const r = R.rows[i] || ['', '', '', '', ''];
      aoa.push([...l, '', ...r]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const merges = [mg(0, 0, 0, 10), mg(2, 0, 2, 4), mg(2, 6, 2, 10)];
    L.merges.forEach(([a, b, kind]) => {
      merges.push(kind === 0 ? mg(HDR + 1 + a, 0, HDR + 1 + b, 0) : mg(HDR + 1 + a, 0, HDR + 1 + a, 1));
    });
    R.merges.forEach(([a, b, kind]) => {
      merges.push(kind === 0 ? mg(HDR + 1 + a, 6, HDR + 1 + b, 6) : mg(HDR + 1 + a, 6, HDR + 1 + a, 7));
    });
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 },
                   { wch: 2 },
                   { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }];
    styleNums(ws);
    return ws;
  }

  // ---- 시트2/3: 월별 내역 ----
  // 열: A항목 B소항목 C~N 12개월 O합계
  // tailRows(특별헌금)는 총계에 넣지 않는다. 총계 '아래'에 빈 줄 하나 두고 별도로 붙인다.
  //   헌금 › 기타 › [총계 = 헌금+기타] › (빈 줄) › 특별헌금
  function sheetMonthly(kind, rows, title, tailRows) {
    const tail = tailRows || [];
    const labels = monthLabels(curFY);
    const aoa = [[title], [], ['항목', '소항목', ...labels, '합계']];
    const merges = [mg(0, 0, 0, 14)];
    const HDR = 2;                                   // 0-based: 3행이 헤더

    const putGroups = (gs) => {
      gs.forEach((g) => {
        const s = aoa.length;
        const gm = new Array(12).fill(0);
        g.rows.forEach((r, i) => {
          r.months.forEach((v, k) => { gm[k] += v; });
          aoa.push([i === 0 ? xn(g.c1) : '', xn(r.name), ...r.months.map(cellNum), cellNum(r.actual)]);
        });
        aoa.push(['', '소계', ...gm.map(cellNum), cellNum(g.actual)]);
        if (aoa.length - 1 > s) merges.push(mg(s, 0, aoa.length - 1, 0));
      });
    };

    putGroups(groupByC1(rows));

    const totM = new Array(12).fill(0);
    rows.forEach((r) => r.months.forEach((v, k) => { totM[k] += v; }));
    const tr = aoa.length;
    aoa.push(['총계', '', ...totM.map(cellNum), cellNum(sumA(rows))]);
    merges.push(mg(tr, 0, tr, 1));

    if (tail.length) {
      aoa.push([]);                                  // 총계와 특별헌금 사이 빈 줄
      putGroups(groupByC1(tail));                    // 특별헌금 = 총계 아래에 별도
    }

    // 수입 시트에만 기금별 잔액표를 덧붙인다 (엑셀 원본과 같은 위치)
    let fundInfo = null;
    if (kind === 'income') fundInfo = appendFundTable(aoa, merges);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 10 }, { wch: 12 }, ...labels.map(() => ({ wch: 11 })), { wch: 13 }];
    if (fundInfo) applyFundFormulas(ws, fundInfo);
    styleNums(ws);
    void HDR;
    return ws;
  }

  // ---- 기금별 잔액표 (수입내역 시트 하단) ----
  // 합계·잔액을 '숫자'가 아니라 '엑셀 수식'으로 넣는다.
  // → 아이삭이 목적기금 지출(G열)만 채우면 합계·잔액이 자동으로 다시 계산된다.
  function appendFundTable(aoa, merges) {
    aoa.push([]);
    const hr = aoa.length;                            // 헤더 행 (0-based)
    aoa.push(['', '', '이월금', '총수입', '기타', '합계', '지출', '잔액', '비고']);
    merges.push(mg(hr, 8, hr, 9));

    const etcRows = agg.normal.filter((r) => r.c1 === ETC_C1);
    const list = [];
    FUNDS.forEach((f) => {
      const carry = sumA(agg.carry.filter((r) => r.fund === f));
      let income, etc;
      if (f === DEFAULT_FUND) {
        income = sumA(agg.normal.filter((r) => r.c1 !== ETC_C1));   // 헌금 소계
        etc = sumA(etcRows);                                        // 기타(이자·후원 등)
      } else {
        income = sumA(agg.special.filter((r) => r.fund === f));
        etc = 0;                                                    // 기금별 이자는 앱에 없다 → 빈칸
      }
      const expense = sumA(agg.expRows.filter((r) => r.fund === f));
      if (f !== DEFAULT_FUND && !carry && !income && !expense) return;   // 안 쓰는 기금은 생략
      const r = aoa.length;
      aoa.push([XL_FUND[f] || f, '', cellNum(carry), cellNum(income), cellNum(etc), '', cellNum(expense), '', '']);
      merges.push(mg(r, 0, r, 1));
      merges.push(mg(r, 8, r, 9));
      list.push(r);
    });
    return { rows: list };
  }

  function applyFundFormulas(ws, info) {
    info.rows.forEach((r) => {
      const n = r + 1;                                // 엑셀 행번호 (1-based)
      ws[`F${n}`] = { t: 'n', f: `C${n}+D${n}+E${n}`, z: '#,##0' };   // 합계 = 이월+총수입+기타
      ws[`H${n}`] = { t: 'n', f: `F${n}-G${n}`, z: '#,##0' };         // 잔액 = 합계-지출
    });
  }

  // 숫자 셀에 천단위 서식
  function styleNums(ws) {
    const ref = ws['!ref']; if (!ref) return;
    const R = XLSX.utils.decode_range(ref);
    for (let r = R.s.r; r <= R.e.r; r++) {
      for (let c = R.s.c; c <= R.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && (cell.t === 'n' || cell.f)) cell.z = '#,##0';
      }
    }
  }

  // ---- 내보내기 ----
  $('xlsBtn').onclick = async () => {
    if (!agg) return;
    const btn = $('xlsBtn');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      await loadSheetJS();
      const r = fyRange(curFY);
      const mm = (s) => s.slice(0, 7).replace('-', '.');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetBudgetActual(), '예결산표');
      XLSX.utils.book_append_sheet(wb,
        sheetMonthly('income', agg.normal, `${curFY}년 수입내역(${mm(r.from)}~${mm(r.to)})`, agg.special),
        '수입내역');
      XLSX.utils.book_append_sheet(wb,
        sheetMonthly('expense', agg.expRows, `${curFY}년 지출내역(${mm(r.from)}~${mm(r.to)})`),
        '지출내역');
      XLSX.writeFile(wb, `${curFY}년_회계_예결산.xlsx`);
    } catch (e) {
      console.error(e);
      alert('엑셀을 만들지 못했습니다. 인터넷 연결을 확인해 주세요.');
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  };
