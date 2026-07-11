
  import { auth, db } from "./firebase-config.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
  import {
    collection, addDoc, getDoc, getDocs, doc, deleteDoc, setDoc, updateDoc,
    query, where, writeBatch, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ----- 날짜 유틸 -----
  const pad = (n) => String(n).padStart(2, '0');
  const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYMD = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  function weekLabel(ymd) {
    const d = parseYMD(ymd);
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const n = Math.floor((sun.getDate() - 1) / 7) + 1;
    return `${sun.getMonth() + 1}월 ${n}주`;
  }
  function weekRange(ymd) {
    const d = parseYMD(ymd);
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    return [toYMD(sun), toYMD(sat)];
  }
  const wonFmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  const onlyNum = (s) => Number(String(s).replace(/[^0-9]/g, '') || 0);

  // ----- 기본 항목 (설치에서 편집 가능) -----
  const DEFAULT_CONFIG = {
    income: [
      { c1: '일반재정', c2: '주일헌금', c3: '', code: '100010' },
      { c1: '일반재정', c2: '십일조', c3: '', code: '100020' },
      { c1: '일반재정', c2: '감사헌금', c3: '', code: '100030' },
      { c1: '일반재정', c2: '선교헌금', c3: '', code: '100040' },
      { c1: '일반재정', c2: '장학헌금', c3: '', code: '100050' },
      { c1: '일반재정', c2: '차량헌금', c3: '', code: '100060' },
      { c1: '일반재정', c2: '절기헌금', c3: '맥추감사', code: '100071' },
      { c1: '일반재정', c2: '절기헌금', c3: '추수감사', code: '100072' },
      { c1: '일반재정', c2: '절기헌금', c3: '성탄감사', code: '100073' },
      { c1: '일반재정', c2: '절기헌금', c3: '신년감사', code: '100074' },
      { c1: '특별헌금', c2: '건축헌금', c3: '', code: '100110' },
      { c1: '특별헌금', c2: '선교헌금', c3: '', code: '100120' }
    ],
    expense: [
      { c1: '운영비', c2: '사무용품', c3: '', code: '200010' },
      { c1: '운영비', c2: '식당', c3: '', code: '200020' },
      { c1: '관리비', c2: '공과금', c3: '', code: '200030' },
      { c1: '사역비', c2: '선교', c3: '', code: '200040' },
      { c1: '기타', c2: '', c3: '', code: '200090' }
    ]
  };
  const pathOf = (it) => [it.c1, it.c2, it.c3].filter(Boolean).join(' › ');

  // ----- 항목 역매핑 (수정 화면) -----
  // offering 문서는 항목 노드를 참조하지 않고 이름·코드를 '복사'해 저장한다.
  // 재채번·항목 재생성으로 code가 어긋나면 예전엔 조용히 첫 항목으로 잘못 잡혔다.
  // → ① code 매칭 → ② 실패 시 이름 경로(catPath)로 재시도 → ③ 둘 다 실패면 저장 차단.
  // ②가 핵심: 재채번을 해도 이름은 바뀌지 않으므로 대부분 자동 복구된다.
  let catMiss = false;   // true면 save() 차단
  const catKey = (s) => String(s == null ? '' : s).replace(/\s/g, '');
  function resolveCatIdx(list, r) {
    const code = r.code || '';
    if (code) {
      const i = list.findIndex((it) => (it.code || '') === code);
      if (i >= 0) return i;
    }
    const want = catKey(r.catPath || [r.c1, r.c2, r.c3].filter(Boolean).join(' › '));
    if (!want) return -1;
    return list.findIndex((it) => catKey(pathOf(it)) === want);
  }
  function setCatMiss(on, r) {
    catMiss = !!on;
    const box = $('catMissMsg');
    if (!box) return;
    box.classList.toggle('hide', !catMiss);
    if (catMiss && r) {
      const p = r.catPath || [r.c1, r.c2, r.c3].filter(Boolean).join(' › ') || '(항목 없음)';
      box.textContent = `이 기록의 항목 "${p}" 을(를) 현재 항목 목록에서 찾을 수 없습니다. 항목을 다시 선택하세요.`;
    }
  }

  // ----- 상태 -----
  let me = { uid: null, level: 1 };
  let config = null;
  let incomeNodes = [];   // 수입 항목 노드(전 연도). 날짜의 회계연도로 걸러 드롭다운 구성.
  let expenseNodes = [];  // 지출 항목 노드(전 연도). expense.html에서 관리.
  let members = [];
  let membersOk = true;
  let curTab = 'inc';
  let linked = null;   // {id, no, name} 또는 null (없으면 무명 #0)
  let claimant = null; // 지출 청구인 {id, no, name} 또는 null (명부 미연동 시 이름만 저장)

  // ----- 인증: 3단계(재정담당) 이상 -----
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace('index.html'); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const lv = snap.exists() ? (snap.data().level || 1) : 1;
      if (lv < 3) { alert('재정 관리는 재정담당(3단계) 이상만 이용할 수 있습니다.'); location.replace('index.html'); return; }
      me = { uid: user.uid, level: lv };
      await loadConfig();
      await loadMembers();
      initUI();
    } catch (e) {
      alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
      location.replace('index.html');
    }
  });

  async function loadConfig() {
    // 지출 항목: expense.html이 만든 노드에서 구성(옛 finConfig/items.expense는 더 이상 읽지 않음).
    config = { income: [], expense: [] };
    // 결산월 + 수입/지출 노드(전 연도) 로드. 실제 config.*는 입력 날짜의 회계연도로 refresh*Cats()에서 구성.
    try {
      const st = await getDoc(doc(db, 'finConfig', 'settings'));
      if (st.exists() && st.data().closeMonth) closeMonth = Number(st.data().closeMonth);
    } catch (e) { /* 기본 12 */ }
    try {
      const qs = await getDocs(collection(db, 'finConfig'));
      const all = qs.docs.map((x) => ({ id: x.id, ...x.data() }));
      incomeNodes = all.filter((n) => n.kind === 'income');
      expenseNodes = all.filter((n) => n.kind === 'expense');
    } catch (e) { incomeNodes = []; expenseNodes = []; }
  }
  // 노드 → 활성 말단 경로 배열 {c1,c2,c3,code} (income.html이 만든 트리를 헌금 드롭다운용으로 평탄화)
  function leavesFromNodes(nodes) {
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const hasChild = {}; nodes.forEach((n) => { if (n.parentId) hasChild[n.parentId] = true; });
    const codeNum = (c) => Number(String(c).replace(/[^0-9]/g, '')) || 0;
    const activeChain = (n) => { let cur = n, g = 0; while (cur && g++ < 10) { if (cur.active === false) return false; cur = cur.parentId ? byId[cur.parentId] : null; } return true; };
    const nameChain = (n) => { const a = []; let cur = n, g = 0; while (cur && g++ < 10) { a.unshift(cur.name || ''); cur = cur.parentId ? byId[cur.parentId] : null; } return a; };
    return nodes
      .filter((n) => !hasChild[n.id] && activeChain(n))
      .map((n) => { const ch = nameChain(n); return { c1: ch[0] || '', c2: ch[1] || '', c3: ch[2] || '', code: n.code || '' }; })
      .sort((a, b) => codeNum(a.code) - codeNum(b.code));
  }

  // ----- 회계연도(결산월 기준) -----
  function currentFY() { const d = new Date(); return (d.getMonth() + 1) <= closeMonth ? d.getFullYear() : d.getFullYear() + 1; }
  function fiscalYearOf(ymd) {
    const [y, m] = (ymd || '').split('-').map(Number);
    if (!y || !m) return currentFY();
    return m <= closeMonth ? y : y + 1;
  }
  // 노드(현재 연도) → 들여쓰기 옵션 + 말단 목록. 부모(자식 있음)는 선택 불가 제목 줄.
  function buildIncomeTreeOptions(nodes) {
    const codeNum = (c) => Number(String(c).replace(/[^0-9]/g, '')) || 0;
    const childrenOf = (pid) => nodes
      .filter((n) => (n.parentId || null) === (pid || null))
      .sort((a, b) => codeNum(a.code) - codeNum(b.code));
    const hasChild = {}; nodes.forEach((n) => { if (n.parentId) hasChild[n.parentId] = true; });
    const IND = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0';
    const leaves = [], opts = [];
    const walk = (pid, level, anc) => {
      childrenOf(pid).forEach((n) => {
        const chain = anc.concat(n.name || '');
        const indent = IND.repeat(level - 1);
        if (hasChild[n.id]) {
          opts.push(`<option disabled style="color:var(--hint);">${indent}${esc(n.name || '')}</option>`);
          walk(n.id, level + 1, chain);
        } else {
          const idx = leaves.length;
          leaves.push({ c1: chain[0] || '', c2: chain[1] || '', c3: chain[2] || '', code: n.code || '' });
          opts.push(`<option value="${idx}">${indent}·\u00A0${esc(n.name || '')}</option>`);
        }
      });
    };
    walk(null, 1, []);
    return { opts, leaves };
  }
  // 입력 날짜가 속한 회계연도의 세트로 수입 드롭다운 구성 (B안: 들여쓰기, 부모는 선택 불가)
  function refreshIncomeCats() {
    const fy = fiscalYearOf($('inDate') ? $('inDate').value : '');
    const { opts, leaves } = buildIncomeTreeOptions(incomeNodes.filter((n) => Number(n.fy) === fy));
    config.income = leaves;
    if (leaves.length) {
      $('incCat').innerHTML = opts.join('');
      $('incCat').value = '0';   // 첫 말단 항목 기본 선택(부모 줄은 선택 불가)
    } else {
      $('incCat').innerHTML = `<option value="">(${fy}년도 항목 없음)</option>`;
    }
    if (curTab === 'inc') updateCode();
    updateIncFace();
  }
  async function saveConfig() {
    // 사용 안 함: 수입=income.html, 지출=expense.html 노드에서 관리.
  }

  // ----- 결산 월 설정 (finConfig/settings.closeMonth, 기본 12) -----
  let closeMonth = 12;
  async function openCloseMonth() {
    try {
      const s = await getDoc(doc(db, 'finConfig', 'settings'));
      closeMonth = (s.exists() && s.data().closeMonth) ? Number(s.data().closeMonth) : 12;
    } catch (e) { closeMonth = 12; }
    $('closeMonthSel').innerHTML = Array.from({ length: 12 }, (_, i) =>
      `<option value="${i + 1}"${(i + 1) === closeMonth ? ' selected' : ''}>${i + 1}월</option>`).join('');
    updateCloseHint();
    $('closeMonthModal').style.display = 'flex';
  }
  function updateCloseHint() {
    const m = Number($('closeMonthSel').value);
    const nextStart = m === 12 ? '내년 1월 1일' : `${m + 1}월 1일`;
    $('closeMonthHint').textContent = `${m}월 말일에 결산하고, ${nextStart}부터 새 회계연도가 시작됩니다.`;
  }
  function closeCloseMonth() { $('closeMonthModal').style.display = 'none'; }
  async function saveCloseMonth() {
    const m = Number($('closeMonthSel').value);
    const btn = $('cmSave'); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      await setDoc(doc(db, 'finConfig', 'settings'), { closeMonth: m }, { merge: true });
      closeMonth = m;
      closeCloseMonth();
      showMsg(`결산 월을 ${m}월로 저장했습니다.`);
    } catch (e) { alert('저장에 실패했습니다: ' + (e.code || e.message)); }
    finally { btn.disabled = false; btn.textContent = '수정'; }
  }

  async function loadMembers() {
    try {
      const qs = await getDocs(collection(db, 'members'));
      members = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      membersOk = true;
    } catch (e) {
      members = []; membersOk = false;
    }
  }
  function nextMemberNo() {
    let mx = 0;
    members.forEach((m) => { const n = Number(m.memberNo); if (Number.isFinite(n) && n > mx) mx = n; });
    return mx + 1;
  }

  // ----- 항목 셀렉트 -----
  function populateSelects() {
    refreshIncomeCats();
    refreshExpenseCats();
    updateCode();
  }
  // 입력 날짜가 속한 회계연도의 세트로 지출 드롭다운 구성 (수입과 동일: 들여쓰기, 부모는 선택 불가)
  function refreshExpenseCats() {
    const fy = fiscalYearOf($('inDate') ? $('inDate').value : '');
    const { opts, leaves } = buildIncomeTreeOptions(expenseNodes.filter((n) => Number(n.fy) === fy));
    config.expense = leaves;
    if (leaves.length) {
      $('expCat').innerHTML = opts.join('');
      $('expCat').value = '0';   // 첫 말단 항목 기본 선택(부모 줄은 선택 불가)
    } else {
      $('expCat').innerHTML = `<option value="">(${fy}년도 항목 없음)</option>`;
    }
    if (curTab === 'exp') updateCode();
    updateExpFace();
  }
  function updateCode() {
    if (curTab === 'inc') { const it = config.income[+$('incCat').value]; $('incCode').textContent = it ? it.code : '–'; }
    else if (curTab === 'exp') { const it = config.expense[+$('expCat').value]; $('expCode').textContent = it ? it.code : '–'; }
  }
  // '이월' 대분류 여부 (전기이월 등). 코드는 자동번호로 바뀔 수 있어 대분류명으로 판별.
  const isCarryOver = (it) => !!it && (it.c1 || '') === '이월';
  // 닫힌 칸에는 선택한 항목의 '이름만' 표시(들여쓰기·표식 없이)
  function updateIncFace() {
    const it = config.income[+$('incCat').value];
    $('incCatText').textContent = it ? (it.c3 || it.c2 || it.c1 || '–')
      : ($('incCat').options[0] ? $('incCat').options[0].textContent : '–');
    applyCarryOverUI();
  }
  // 이월 항목이면 이름/배우자 줄을 비우고 잠금(사람이 낸 헌금이 아니므로)
  function applyCarryOverUI() {
    const co = isCarryOver(config.income[+$('incCat').value]);
    const nf = $('incNameField');
    if (nf) nf.classList.toggle('hide', co);
    if (co) {
      linked = null;
      $('incName').value = '';
      $('incMemberNo').textContent = '–';
      $('nameStatus').innerHTML = '';
      $('spouseChk').checked = false;
      $('spouseName').disabled = true;
      $('spouseName').value = '';
    }
  }
  function updateExpFace() {
    const it = config.expense[+$('expCat').value];
    $('expCatText').textContent = it ? (it.c3 || it.c2 || it.c1 || '–')
      : ($('expCat').options[0] ? $('expCat').options[0].textContent : '–');
  }

  // ----- 이름 검색 / 연동 / 간편등록 -----
  function setLinked(m) {
    linked = { id: m.id, no: Number(m.memberNo) || 0, name: m.name };
    $('incName').value = m.name;
    $('incMemberNo').textContent = linked.no || '–';
    $('nameStatus').innerHTML = `<div class="status st-ok">✓ ${esc(m.name)} 성도로 연동됨${linked.no ? (' · #' + linked.no) : ''}</div>`;
    // 배우자 체크 시: 등록된 배우자 이름 자동입력(덮어쓰기). 없으면 비움(직접 입력 가능).
    if ($('spouseChk').checked) {
      const sp = m.spouseId ? members.find((x) => x.id === m.spouseId) : null;
      $('spouseName').value = sp ? (sp.name || '') : '';
    }
  }
  function onNameEdit() {
    // 이름을 고치면 연동 해제 (다시 Enter로 검색)
    linked = null;
    $('incMemberNo').textContent = '–';
    $('nameStatus').innerHTML = '';
  }
  function doNameSearch() {
    const val = $('incName').value.trim();
    const box = $('nameStatus');
    linked = null; $('incMemberNo').textContent = '–';
    if (!val) { box.innerHTML = ''; return; }
    if (!membersOk) { box.innerHTML = '<div class="status st-warn">명부 조회 권한이 없습니다</div>'; return; }
    const exact = members.filter((m) => (m.name || '').trim() === val);
    if (exact.length === 1) { setLinked(exact[0]); return; }
    if (exact.length > 1) {
      box.innerHTML = '<div class="status st-warn" style="display:block;">동명이인입니다. 선택하세요</div><div class="st-pick" id="pickList"></div>';
      const pl = $('pickList');
      exact.forEach((m) => {
        const el = document.createElement('div');
        const info = [m.gender].filter(Boolean).join(' · ');
        el.innerHTML = `${esc(m.name)}${m.memberNo ? ` <span style="color:var(--hint)">#${m.memberNo}</span>` : ''}${info ? ` · ${esc(info)}` : ''}`;
        el.onclick = () => setLinked(m);
        pl.appendChild(el);
      });
      return;
    }
    // 명부에 없음 → 등록 여부 확인 → 간편등록 창
    box.innerHTML = '<div class="status st-warn">명부에 없는 이름입니다</div>';
    if (confirm(`'${val}' 님이 명부에 없습니다. 등록하시겠습니까?`)) openQuickAdd(val);
  }
  // ----- 청구인 검색 / 연동 (지출 전용, 배우자·간편등록 없음) -----
  function setClaimant(m) {
    claimant = { id: m.id, no: Number(m.memberNo) || 0, name: m.name };
    $('expClaimName').value = m.name;
    $('expClaimNo').textContent = claimant.no || '–';
    $('claimStatus').innerHTML = `<div class="status st-ok">✓ ${esc(m.name)} 성도로 연동됨${claimant.no ? (' · #' + claimant.no) : ''}</div>`;
  }
  function onClaimEdit() {
    claimant = null;
    $('expClaimNo').textContent = '–';
    $('claimStatus').innerHTML = '';
  }
  function doClaimSearch() {
    const val = $('expClaimName').value.trim();
    const box = $('claimStatus');
    claimant = null; $('expClaimNo').textContent = '–';
    if (!val) { box.innerHTML = ''; return; }
    if (!membersOk) { box.innerHTML = '<div class="status st-warn">명부 조회 권한이 없습니다</div>'; return; }
    const exact = members.filter((m) => (m.name || '').trim() === val);
    if (exact.length === 1) { setClaimant(exact[0]); return; }
    if (exact.length > 1) {
      box.innerHTML = '<div class="status st-warn" style="display:block;">동명이인입니다. 선택하세요</div><div class="st-pick" id="claimPickList"></div>';
      const pl = $('claimPickList');
      exact.forEach((m) => {
        const el = document.createElement('div');
        const info = [m.gender].filter(Boolean).join(' · ');
        el.innerHTML = `${esc(m.name)}${m.memberNo ? ` <span style="color:var(--hint)">#${m.memberNo}</span>` : ''}${info ? ` · ${esc(info)}` : ''}`;
        el.onclick = () => setClaimant(m);
        pl.appendChild(el);
      });
      return;
    }
    // 명부에 없어도 저장 허용 (이름만 기록). 간편등록은 띄우지 않음.
    box.innerHTML = '<div class="status st-warn">명부에 없는 이름입니다 (이름만 저장됩니다)</div>';
  }

  function openQuickAdd(name) {
    $('qaName').value = name || '';
    $('qaGender').value = '';
    $('qaModal').style.display = 'flex';
    $('qaName').focus();
  }
  function closeQuickAdd() { $('qaModal').style.display = 'none'; }
  async function submitQuickAdd() {
    const name = $('qaName').value.trim();
    const gender = $('qaGender').value;
    if (!name) { alert('이름을 입력하세요.'); return; }
    const btn = $('qaSubmit'); btn.disabled = true; btn.textContent = '등록 중…';
    try {
      const no = nextMemberNo();
      const ref = await addDoc(collection(db, 'members'),
        { name, gender: gender || '', memberNo: no, createdAt: serverTimestamp(), createdBy: me.uid, quickAdd: true });
      members.push({ id: ref.id, name, gender: gender || '', memberNo: no });
      closeQuickAdd();
      setLinked({ id: ref.id, name, memberNo: no });
    } catch (e) { alert('간편등록 실패: ' + (e.code || e.message)); }
    finally { btn.disabled = false; btn.textContent = '등록'; }
  }
  function toggleSpouse() {
    const on = $('spouseChk').checked;
    $('spouseName').disabled = !on;
    if (!on) $('spouseName').value = '';
    else $('spouseName').focus();
  }
  // ----- 저장 -----
  function showMsg(t) { const m = $('formMsg'); m.textContent = t; m.style.display = 'block'; setTimeout(() => { m.style.display = 'none'; }, 4000); }
  async function nextSeq(coll) {
    try { const qs = await getDocs(collection(db, coll)); let mx = 0; qs.forEach((d) => { const n = Number(d.data().no); if (Number.isFinite(n) && n > mx) mx = n; }); return mx + 1; }
    catch (e) { return Date.now(); }
  }
  let editId = null;   // null=신규 추가, 값 있으면 해당 offerings 문서 수정 모드
  function exitEditMode() {
    editId = null;
    $('editBanner').classList.add('hide');
    $('saveBtn').textContent = '저장';
    setCatMiss(false);   // 수정 모드를 벗어나면 항목 미발견 경고·저장차단도 해제
  }
  function resetForm() {
    $('inAmount').value = ''; $('inMemo').value = '';
    $('expPayee').value = '';
    $('expClaimName').value = ''; claimant = null;
    $('expClaimNo').textContent = '–';
    $('claimStatus').innerHTML = '';
    $('incName').value = ''; linked = null;
    $('incMemberNo').textContent = '–';
    $('nameStatus').innerHTML = '';
    $('spouseChk').checked = false; $('spouseName').disabled = true; $('spouseName').value = '';
    exitEditMode();
  }
  async function save() {
    const date = $('inDate').value;
    const amount = onlyNum($('inAmount').value);
    const memo = $('inMemo').value.trim();
    if (!date) return showMsg('날짜를 선택하세요.');
    if (!amount) return showMsg('금액을 입력하세요.');
    // 항목 역매핑 실패 상태에서 저장하면 엉뚱한 항목으로 덮어써진다. 반드시 차단.
    if (catMiss) return showMsg('항목을 다시 선택한 뒤 저장하세요.');
    // '이월' 대분류(전기이월 등)는 명부 연동 없이 저장 허용 (사람이 낸 헌금이 아님)
    if (curTab === 'inc' && !linked && !isCarryOver(config.income[+$('incCat').value])) {
      return showMsg('이름을 입력하고 Enter로 검색해 명부와 연동하세요.');
    }
    const btn = $('saveBtn'); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      if (curTab === 'inc') {
        const it = config.income[+$('incCat').value];
        if (!it) throw { message: '헌금 항목을 선택하세요.' };
        const payload = {
          type: 'income', date, week: weekLabel(date),
          c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
          memberNo: linked ? (linked.no || null) : null,
          memberId: linked ? linked.id : null,
          memberName: linked ? linked.name : ($('incName').value.trim() || ''),
          spouse: $('spouseChk').checked,
          spouseName: $('spouseChk').checked ? $('spouseName').value.trim() : '',
          amount, memo
        };
        if (editId) {
          // 수정: no·createdAt·createdBy 보존, updatedAt만 추가
          await updateDoc(doc(db, 'offerings', editId), { ...payload, updatedAt: serverTimestamp(), updatedBy: me.uid });
        } else {
          await addDoc(collection(db, 'offerings'), { ...payload, no: await nextSeq('offerings'), createdAt: serverTimestamp(), createdBy: me.uid });
        }
      } else {
        const it = config.expense[+$('expCat').value];
        if (!it) throw { message: '지출 항목을 선택하세요.' };
        const payload = {
          type: 'expense', date, week: weekLabel(date),
          c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
          claimantNo: claimant ? (claimant.no || null) : null,
          claimantId: claimant ? claimant.id : null,
          claimantName: $('expClaimName').value.trim(),
          payee: $('expPayee').value.trim(),
          amount, memo
        };
        if (editId) {
          // 수정: no·createdAt·createdBy 보존, updatedAt만 추가
          await updateDoc(doc(db, 'expenses', editId), { ...payload, updatedAt: serverTimestamp(), updatedBy: me.uid });
        } else {
          await addDoc(collection(db, 'expenses'), { ...payload, no: await nextSeq('expenses'), createdAt: serverTimestamp(), createdBy: me.uid });
        }
      }
      resetForm();
      await loadList();
      return true;
    } catch (e) { showMsg('저장 실패: ' + (e.code || e.message)); }
    finally { btn.disabled = false; btn.textContent = editId ? '수정 저장' : '저장'; }
  }

  // ----- 수입 기록 수정 (A안: 상단 폼 재사용) -----
  function startEditInc(id) {
    const r = lastIncRows.find((x) => x.id === id);
    if (!r) return;
    // 1) 날짜 → 해당 회계연도 항목 세트로 재구성
    $('inDate').value = r.date || '';
    $('weekBadge').textContent = r.date ? weekLabel(r.date) : '–';
    refreshIncomeCats();
    // 2) 항목 역매핑: code → 실패 시 이름 경로(catPath) → 둘 다 실패면 경고+저장차단
    const idx = resolveCatIdx(config.income, r);
    if (idx >= 0) $('incCat').value = String(idx);
    setCatMiss(idx < 0, r);
    updateCode(); updateIncFace();
    // 3) 이름/명부 연동 복원 (배우자 자동덮어쓰기 방지 위해 먼저 체크 해제 후 setLinked)
    $('spouseChk').checked = false;
    if (r.memberId) {
      setLinked({ id: r.memberId, name: r.memberName || '', memberNo: r.memberNo || 0 });
    } else {
      linked = null;
      $('incName').value = r.memberName || '';
      $('incMemberNo').textContent = r.memberNo || '–';
      $('nameStatus').innerHTML = '';
    }
    // 4) 배우자 복원
    const hasSp = !!r.spouse || !!r.spouseName;
    $('spouseChk').checked = hasSp;
    $('spouseName').disabled = !hasSp;
    $('spouseName').value = r.spouseName || '';
    // 5) 금액 / 비고
    $('inAmount').value = r.amount ? wonFmt(r.amount) : '';
    $('inMemo').value = r.memo || '';
    // 6) 수정 모드 진입
    editId = id;
    $('editBannerText').textContent = `수정 중 · ${r.memberName || ''} ${(r.date || '').replace(/-/g, '').slice(4)}`;
    $('editBanner').classList.remove('hide');
    $('saveBtn').textContent = '수정 저장';
    // (항목 미발견 경고는 setCatMiss()의 #catMissMsg 가 전담 — 저장도 함께 차단된다)
    $('formSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ----- 지출 기록 수정 (수입과 동일: 상단 폼 재사용) -----
  function startEditExp(id) {
    const r = lastExpRows.find((x) => x.id === id);
    if (!r) return;
    $('inDate').value = r.date || '';
    $('weekBadge').textContent = r.date ? weekLabel(r.date) : '–';
    refreshExpenseCats();
    // 항목 역매핑: code → 실패 시 이름 경로(catPath) → 둘 다 실패면 경고+저장차단
    const idx = resolveCatIdx(config.expense, r);
    if (idx >= 0) $('expCat').value = String(idx);
    setCatMiss(idx < 0, r);
    updateCode(); updateExpFace();
    // 청구인 복원
    if (r.claimantId) {
      setClaimant({ id: r.claimantId, name: r.claimantName || '', memberNo: r.claimantNo || 0 });
    } else {
      claimant = null;
      $('expClaimName').value = r.claimantName || '';
      $('expClaimNo').textContent = r.claimantNo || '–';
      $('claimStatus').innerHTML = '';
    }
    $('expPayee').value = r.payee || '';
    $('inAmount').value = r.amount ? wonFmt(r.amount) : '';
    $('inMemo').value = r.memo || '';
    editId = id;
    $('editBannerText').textContent = `수정 중 · ${r.claimantName || r.payee || ''} ${(r.date || '').replace(/-/g, '').slice(4)}`;
    $('editBanner').classList.remove('hide');
    $('saveBtn').textContent = '수정 저장';
    // (항목 미발견 경고는 setCatMiss()의 #catMissMsg 가 전담 — 저장도 함께 차단된다)
    $('formSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ----- 목록 -----
  const SVG_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const SVG_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const SVG_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';
  function incTable(rows) {
    rows = sortInc(rows.slice());
    const body = rows.map((r) => {
      const item = esc(r.c3 || r.c2 || r.c1 || '');
      const ymd = esc((r.date || '').replace(/-/g, ''));
      const fy = fiscalYearOf(r.date);
      const idno = r.memberNo ? ('#' + r.memberNo) : '';
      const sp = r.spouseName ? esc(r.spouseName) : '–';
      const wkm = (r.week || '').match(/(\d+)\s*주/); const wkNo = wkm ? wkm[1] : '';
      return `<tr>
        <td>${r.no || ''}</td><td>${fy}</td><td>${wkNo}</td><td>${ymd}</td>
        <td>${item}</td><td>${esc(idno)}</td><td>${esc(r.memberName || '')}</td>
        <td class="ra amt">${wonFmt(r.amount)}</td><td>${sp}</td>
        <td class="ce">${r.memo ? `<button class="iact i-note" data-note="${r.id}" aria-label="비고 보기">${SVG_NOTE}</button>` : '–'}</td>
        <td class="ce"><button class="iact i-edit" data-edit="${r.id}" aria-label="수정">${SVG_EDIT}</button><button class="iact i-del" data-del="${r.id}" aria-label="삭제">${SVG_DEL}</button></td>
      </tr>`;
    }).join('');
    const sar = (k) => incSortKey === k ? `<span class="sar">${incSortDir === 'asc' ? '▲' : '▼'}</span>` : '';
    const th = (k, label) => `<th class="sortable" data-sk="${k}">${label}${sar(k)}</th>`;
    return `<div class="itblwrap"><table class="itbl">
      <thead><tr>${th('no', 'No.')}${th('fy', '회계년도')}${th('week', '주')}${th('date', '날짜')}${th('item', '항목')}${th('id', 'id')}${th('name', '이름')}${th('amt', '금액')}${th('spouse', '배우자')}<th class="ce">비고</th><th class="ce">수정·삭제</th></tr></thead>
      <tbody>${body}</tbody></table></div><div id="incMemoBar" class="imemo"></div>`;
  }
  function incGroupTable(rows) {
    const codeNum = (c) => Number(String(c || '').replace(/[^0-9]/g, '')) || 0;
    const fy = fiscalYearOf($('toDate').value || (rows[0] && rows[0].date) || '');
    const nodes = incomeNodes.filter((n) => Number(n.fy) === fy);
    const childrenOf = (pid) => nodes
      .filter((n) => (n.parentId || null) === (pid || null))
      .sort((a, b) => codeNum(a.code) - codeNum(b.code));
    const hasChild = {}; nodes.forEach((n) => { if (n.parentId) hasChild[n.parentId] = true; });
    const codeToLeaf = {}; nodes.forEach((n) => { if (!hasChild[n.id]) codeToLeaf[n.code] = n; });
    // 기록을 말단 코드에 매칭, 매칭 안 되면 미분류
    const recOf = {}; const unmatched = [];
    rows.forEach((r) => { if (codeToLeaf[r.code]) (recOf[r.code] = recOf[r.code] || []).push(r); else unmatched.push(r); });
    const roll = (n) => {
      if (!hasChild[n.id]) { const rs = recOf[n.code] || []; return { cnt: rs.length, amt: rs.reduce((s, r) => s + (Number(r.amount) || 0), 0) }; }
      let c = 0, a = 0; childrenOf(n.id).forEach((ch) => { const v = roll(ch); c += v.cnt; a += v.amt; }); return { cnt: c, amt: a };
    };
    const detailRows = (n) => (recOf[n.code] || [])
      .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((r) => {
        const ymd = esc((r.date || '').replace(/-/g, ''));
        const who = esc(r.memberName || '') + (r.spouseName ? `<span class="gsp">(배우자 ${esc(r.spouseName)})</span>` : '');
        const mo = r.memo ? `<span class="gmemo">${esc(r.memo)}</span>` : '';
        return `<tr class="gdet" data-of="${esc(n.code)}" style="display:none"><td></td><td></td><td class="gwho">${ymd} <span class="gnm2">${who}</span>${mo}</td><td></td><td class="ra">${wonFmt(r.amount)}</td></tr>`;
      }).join('');
    let body = '', no = 0, grand = 0;
    const walk = (pid, level) => {
      childrenOf(pid).forEach((n) => {
        const v = roll(n); if (v.cnt === 0) return;
        no++; if (level === 1) grand += v.amt;
        const leaf = !hasChild[n.id];
        const pfx = level === 2 ? '<span class="gpfx">- </span>' : level >= 3 ? '<span class="gpfx">= </span>' : '';
        const car = leaf ? '<span class="gcar">▸</span>' : '';
        body += `<tr class="glv${level}${leaf ? ' gleaf' : ''}">
          <td class="gno">${no}</td><td class="gcode">${esc(n.code || '')}</td>
          <td class="gitem"${leaf ? ` data-gc="${esc(n.code)}"` : ''}><span class="gnm">${car}${pfx}${esc(n.name || '')}</span></td>
          <td class="gcnt">${v.cnt}</td><td class="ra amt">${wonFmt(v.amt)}</td></tr>`;
        if (leaf) body += detailRows(n); else walk(n.id, level + 1);
      });
    };
    walk(null, 1);
    if (unmatched.length) {
      no++; const uamt = unmatched.reduce((s, r) => s + (Number(r.amount) || 0), 0); grand += uamt;
      const udet = unmatched.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((r) => {
        const ymd = esc((r.date || '').replace(/-/g, ''));
        const who = esc(r.memberName || '') + (r.spouseName ? `<span class="gsp">(배우자 ${esc(r.spouseName)})</span>` : '');
        const mo = r.memo ? `<span class="gmemo">${esc(r.memo)}</span>` : '';
        return `<tr class="gdet" data-of="__u" style="display:none"><td></td><td></td><td class="gwho">${ymd} <span class="gnm2">${who}</span>${mo}</td><td></td><td class="ra">${wonFmt(r.amount)}</td></tr>`;
      }).join('');
      body += `<tr class="glv1 gleaf"><td class="gno">${no}</td><td class="gcode"></td>
        <td class="gitem" data-gc="__u"><span class="gnm"><span class="gcar">▸</span>(미분류)</span></td>
        <td class="gcnt">${unmatched.length}</td><td class="ra amt">${wonFmt(uamt)}</td></tr>` + udet;
    }
    body += `<tr class="gtot"><td colspan="3" class="ra">총합계</td><td></td><td class="ra gtotv">${wonFmt(grand)}</td></tr>`;
    return `<div class="itblwrap"><table class="itbl gtbl">
      <colgroup><col style="width:40px"><col style="width:74px"><col><col style="width:56px"><col style="width:96px"></colgroup>
      <thead><tr><th>No.</th><th>CODE</th><th class="gitemh">항목</th><th>건수</th><th>금액</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }
  // rowHtml(카드형 목록)은 수입·지출 모두 표(incTable/expTable)로 대체되어 제거함.
  let incView = 'date';
  let lastIncRows = [];
  let incSortKey = 'date', incSortDir = 'desc';
  function incSortVal(r, k) {
    switch (k) {
      case 'no': return Number(r.no) || 0;
      case 'fy': return fiscalYearOf(r.date);
      case 'week': { const m = (r.week || '').match(/(\d+)\s*주/); return m ? Number(m[1]) : 0; }
      case 'date': return r.date || '';
      case 'item': return r.code || '';
      case 'id': return Number(r.memberNo) || 0;
      case 'name': return r.memberName || '';
      case 'amt': return Number(r.amount) || 0;
      case 'spouse': return r.spouseName || '';
    }
    return '';
  }
  function sortInc(rows) {
    const k = incSortKey, sign = incSortDir === 'asc' ? 1 : -1;
    const strKey = (k === 'date' || k === 'item' || k === 'name' || k === 'spouse');
    return rows.sort((a, b) => {
      const x = incSortVal(a, k), y = incSortVal(b, k);
      let c = strKey ? String(x).localeCompare(String(y), 'ko') : (x - y);
      if (c === 0) c = (Number(a.no) || 0) - (Number(b.no) || 0);
      return sign * c;
    });
  }
  function setIncSort(k) {
    if (incSortKey === k) incSortDir = incSortDir === 'asc' ? 'desc' : 'asc';
    else { incSortKey = k; incSortDir = 'asc'; }
    renderIncList(lastIncRows);
  }
  function setIncView(v) {
    incView = v;
    $('viewDate').classList.toggle('on', v === 'date');
    $('viewGroup').classList.toggle('on', v === 'group');
    renderIncList(lastIncRows);
  }
  function renderIncList(rows) {
    const box = $('listRows');
    box.innerHTML = incView === 'group' ? incGroupTable(rows) : incTable(rows);
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => startEditInc(b.getAttribute('data-edit')); });
    const memoMap = {}; rows.forEach((r) => { if (r.memo) memoMap[r.id] = r.memo; });
    const memoBar = box.querySelector('#incMemoBar');
    box.querySelectorAll('[data-note]').forEach((b) => {
      const m = memoMap[b.getAttribute('data-note')] || '';
      b.title = m;
      b.onclick = () => { memoBar.innerHTML = '<b>비고:</b> ' + esc(m); memoBar.style.display = 'block'; };
    });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => delRec('offerings', b.getAttribute('data-del')); });
    box.querySelectorAll('th[data-sk]').forEach((th) => { th.onclick = () => setIncSort(th.getAttribute('data-sk')); });
    box.querySelectorAll('.gitem[data-gc]').forEach((el) => {
      el.onclick = () => {
        const code = el.getAttribute('data-gc');
        const dets = box.querySelectorAll('.gdet[data-of="' + code + '"]');
        if (!dets.length) return;
        const show = dets[0].style.display === 'none';
        dets.forEach((tr) => { tr.style.display = show ? 'table-row' : 'none'; });
        const car = el.querySelector('.gcar'); if (car) car.classList.toggle('gopen', show);
      };
    });
  }
  // ----- 지출 표 (수입과 대칭) -----
  let lastExpRows = [];
  let expSortKey = 'date', expSortDir = 'desc';
  function expSortVal(r, k) {
    switch (k) {
      case 'no': return Number(r.no) || 0;
      case 'fy': return fiscalYearOf(r.date);
      case 'week': { const m = (r.week || '').match(/(\d+)\s*주/); return m ? Number(m[1]) : 0; }
      case 'date': return r.date || '';
      case 'item': return r.code || '';
      case 'id': return Number(r.claimantNo) || 0;
      case 'claim': return r.claimantName || '';
      case 'amt': return Number(r.amount) || 0;
      case 'payee': return r.payee || '';
    }
    return '';
  }
  function sortExp(rows) {
    const k = expSortKey, sign = expSortDir === 'asc' ? 1 : -1;
    const strKey = (k === 'date' || k === 'item' || k === 'claim' || k === 'payee');
    return rows.sort((a, b) => {
      const x = expSortVal(a, k), y = expSortVal(b, k);
      let c = strKey ? String(x).localeCompare(String(y), 'ko') : (x - y);
      if (c === 0) c = (Number(a.no) || 0) - (Number(b.no) || 0);
      return sign * c;
    });
  }
  function setExpSort(k) {
    if (expSortKey === k) expSortDir = expSortDir === 'asc' ? 'desc' : 'asc';
    else { expSortKey = k; expSortDir = 'asc'; }
    renderExpList(lastExpRows);
  }
  function expTable(rows) {
    rows = sortExp(rows.slice());
    const body = rows.map((r) => {
      const item = esc(r.c3 || r.c2 || r.c1 || '');
      const ymd = esc((r.date || '').replace(/-/g, ''));
      const fy = fiscalYearOf(r.date);
      const idno = r.claimantNo ? ('#' + r.claimantNo) : '';
      const payee = r.payee ? esc(r.payee) : '–';
      const wkm = (r.week || '').match(/(\d+)\s*주/); const wkNo = wkm ? wkm[1] : '';
      return `<tr>
        <td>${r.no || ''}</td><td>${fy}</td><td>${wkNo}</td><td>${ymd}</td>
        <td>${item}</td><td>${esc(idno)}</td><td>${esc(r.claimantName || '')}</td>
        <td class="ra amt">${wonFmt(r.amount)}</td><td>${payee}</td>
        <td class="ce">${r.memo ? `<button class="iact i-note" data-note="${r.id}" aria-label="적요 보기">${SVG_NOTE}</button>` : '–'}</td>
        <td class="ce"><button class="iact i-edit" data-edit="${r.id}" aria-label="수정">${SVG_EDIT}</button><button class="iact i-del" data-del="${r.id}" aria-label="삭제">${SVG_DEL}</button></td>
      </tr>`;
    }).join('');
    const sar = (k) => expSortKey === k ? `<span class="sar">${expSortDir === 'asc' ? '▲' : '▼'}</span>` : '';
    const th = (k, label) => `<th class="sortable" data-sk="${k}">${label}${sar(k)}</th>`;
    return `<div class="itblwrap"><table class="itbl">
      <thead><tr>${th('no', 'No.')}${th('fy', '회계년도')}${th('week', '주')}${th('date', '날짜')}${th('item', '항목')}${th('id', 'id')}${th('claim', '청구인')}${th('amt', '금액')}${th('payee', '수령인')}<th class="ce">적요</th><th class="ce">수정·삭제</th></tr></thead>
      <tbody>${body}</tbody></table></div><div id="expMemoBar" class="imemo"></div>`;
  }
  function renderExpList(rows) {
    const box = $('listRows');
    box.innerHTML = expTable(rows);
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => startEditExp(b.getAttribute('data-edit')); });
    const memoMap = {}; rows.forEach((r) => { if (r.memo) memoMap[r.id] = r.memo; });
    const memoBar = box.querySelector('#expMemoBar');
    box.querySelectorAll('[data-note]').forEach((b) => {
      const m = memoMap[b.getAttribute('data-note')] || '';
      b.title = m;
      b.onclick = () => { memoBar.innerHTML = '<b>적요:</b> ' + esc(m); memoBar.style.display = 'block'; };
    });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => delRec('expenses', b.getAttribute('data-del')); });
    box.querySelectorAll('th[data-sk]').forEach((th) => { th.onclick = () => setExpSort(th.getAttribute('data-sk')); });
  }

  // ----- 기간 선택 모달 -----
  // 회기(FY) N = (결산월 다음달, N-1년) ~ (결산월, N년)
  // 예) 결산월 11 → FY2026 = 2025-12-01 ~ 2026-11-30. 결산월 12 → FY2026 = 2026-01-01 ~ 2026-12-31.
  const lastDay = (y, m) => new Date(y, m, 0).getDate();   // m: 1~12
  function fyStart(fy) {
    const m = closeMonth === 12 ? 1 : closeMonth + 1;
    const y = closeMonth === 12 ? fy : fy - 1;
    return { y, m };
  }
  // 회기 시작에서 i(0-based)번째 달 → {y, m}
  function fyMonth(fy, i) {
    const s = fyStart(fy);
    const t = s.m - 1 + i;
    return { y: s.y + Math.floor(t / 12), m: (t % 12) + 1 };
  }
  // 회기 내 월 구간(0-based, 포함) → {from, to} YYMD
  function fyRange(fy, i0, i1) {
    const a = fyMonth(fy, i0), b = fyMonth(fy, i1);
    return {
      from: `${a.y}-${pad(a.m)}-01`,
      to: `${b.y}-${pad(b.m)}-${pad(lastDay(b.y, b.m))}`
    };
  }
  let ppFy = null, ppSel = null;   // ppSel: {i0, i1} 선택된 월 구간
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
  function ppSetFy(fy) {
    ppFy = fy;
    ppSel = null;
    ppRenderMonths();
    ppClearOn();
    ppShowRange();   // 선택 전에는 회기 전체 기간 표시
  }
  function ppClearOn() {
    document.querySelectorAll('#periodModal .ppbtn').forEach((b) => b.classList.remove('on'));
  }
  // 선택된 범위(없으면 회기 전체)의 실제 기간을 표시
  function ppShowRange() {
    const s = ppSel || { i0: 0, i1: 11 };
    const r = fyRange(ppFy, s.i0, s.i1);
    $('ppFyRange').textContent = `${r.from} ~ ${r.to}`;
  }
  function ppBind() {
    document.querySelectorAll('#periodModal .ppbtn[data-pp]').forEach((b) => {
      const kind = b.getAttribute('data-pp');
      if (kind === 'none') return;
      b.onclick = () => {
        const mi = Number(b.getAttribute('data-mi'));
        ppSel = ppRangeOf(kind, mi);
        ppClearOn();
        b.classList.add('on');
        ppShowRange();
      };
    });
  }
  function openPeriodPick() {
    // 회기 목록: finConfig 노드의 fy 값들 (없으면 현재 회기)
    const years = [...new Set([...incomeNodes, ...expenseNodes]
      .map((n) => Number(n.fy)).filter(Boolean))].sort((a, b) => b - a);
    if (!years.length) years.push(currentFY());
    const cur = years.includes(currentFY()) ? currentFY() : years[0];
    $('ppFySel').innerHTML = years.map((y) =>
      `<option value="${y}"${y === cur ? ' selected' : ''}>${y} 회기</option>`).join('');
    ppSetFy(cur);
    $('periodModal').style.display = 'flex';
  }
  function closePeriodPick() { $('periodModal').style.display = 'none'; }
  function applyPeriodPick() {
    if (!ppSel) { alert('범위를 선택하세요.'); return; }
    const r = fyRange(ppFy, ppSel.i0, ppSel.i1);
    $('fromDate').value = r.from;
    $('toDate').value = r.to;
    closePeriodPick();
    loadList();
  }

  async function loadList() {
    const coll = curTab === 'inc' ? 'offerings' : 'expenses';
    const from = $('fromDate').value, to = $('toDate').value;
    $('segView').classList.toggle('hide', curTab !== 'inc');
    const box = $('listRows'); box.innerHTML = '<div class="empty">불러오는 중…</div>';
    try {
      const qs = await getDocs(query(collection(db, coll), where('date', '>=', from), where('date', '<=', to)));
      let rows = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : ((b.no || 0) - (a.no || 0))));
      const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      $('listSum').textContent = `${rows.length}건 · ${wonFmt(sum)}원`;
      if (!rows.length) { box.innerHTML = '<div class="empty">이 기간에 기록이 없습니다.</div>'; return; }
      if (curTab === 'inc') {
        lastIncRows = rows;
        renderIncList(rows);
      } else {
        lastExpRows = rows;
        renderExpList(rows);
      }
    } catch (e) { box.innerHTML = `<div class="empty">불러오지 못했습니다.<br>(${esc(e.code || e.message)})</div>`; }
  }
  async function delRec(coll, id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteDoc(doc(db, coll, id)); await loadList(); }
    catch (e) { alert('삭제 실패: ' + (e.code || e.message)); }
  }

  // ----- 설치: 항목 편집 -----
  // 수입=income.html, 지출=expense.html 로 이관됨. 옛 인페이지 flat 편집기(openEditor/saveConfig)는
  // 호출부가 없고 옛 finConfig/items 문서를 덮어쓸 위험이 있어 제거함.

  // ===== 이전 자료 불러오기 (교적 프로그램 .xls = 실제로는 HTML 표) =====
  // 수입·지출 공용. 패널을 연 시점의 탭(impKind)으로 대상이 결정된다.
  // ⚠ 엑셀 CODE는 앱 코드와 의미가 완전히 다르다(엑셀 200440=식당›식대지원 / 앱 200440=차량관리).
  //    → CODE·ID 열은 읽지 않는다. 항목명 경로로만 매칭한다.
  // 회계년도·주는 저장하지 않고 날짜에서 재계산한다.
  const IMP_CARRY = '전기이월';   // ※ 엑셀 원본의 항목명이다(앱 항목명 '일반재정 이월'과 무관). 수입에서만 이 행을 제외(직접 입력)
  const IMP_META = {
    inc: {
      kind: 'income', coll: 'offerings', label: '수입',
      title: '이전 헌금 자료 불러오기',
      hint: '교적 프로그램의 ‘헌금 검색결과 리스트’ 파일(.xls)을 선택한 뒤 [미리보기]로 확인하고 등록하세요.<br>전기이월 행은 자동 제외됩니다(직접 입력).'
    },
    exp: {
      kind: 'expense', coll: 'expenses', label: '지출',
      title: '이전 지출 자료 불러오기',
      hint: '교적 프로그램의 ‘지출 검색결과 리스트’ 파일(.xls)을 선택한 뒤 [미리보기]로 확인하고 등록하세요.<br>원본에 청구인·수령인 정보가 없으면 해당 칸은 비워집니다.'
    }
  };
  let impKind = 'inc';            // 'inc' | 'exp' — 패널을 연 탭
  let impRows = null;             // 검증 통과한 저장용 payload 배열
  let impFileName = '';

  const nsp = (s) => String(s == null ? '' : s).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const nokey = (s) => nsp(s).replace(/\s/g, '');
  // ⚠ 임포트 전용 금액 파서. onlyNum()을 쓰면 안 된다.
  //    원본 금액은 '2500000.0000' 형태인데 onlyNum은 숫자 아닌 문자를 '제거'하므로
  //    '25000000000'(250억)이 되어 값이 정확히 10,000배로 부풀려진다.
  //    → 소수점을 살려 Number로 파싱한 뒤 반올림한다.
  const impAmt = (s) => {
    const t = String(s == null ? '' : s).replace(/[,\s\u00A0₩원]/g, '');
    if (!t || !/^-?\d*\.?\d+$/.test(t)) return 0;
    const n = Math.round(Number(t));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // 적요/비고 전용: 줄바꿈은 살리고 각 줄만 정리한다. nsp()를 쓰면 여러 줄이 한 줄로 뭉개진다.
  const nspMulti = (s) => String(s == null ? '' : s)
    .replace(/\u00A0/g, ' ').replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[^\S\n]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();

  function toggleImportPanel() {
    const p = $('importPanel');
    const willShow = p.classList.contains('hide');
    if (willShow) {
      impKind = (curTab === 'exp') ? 'exp' : 'inc';   // 연 시점의 탭으로 고정
      const M = IMP_META[impKind];
      $('impTitle').textContent = M.title;
      $('impHint').innerHTML = M.hint;
      impRows = null; $('impRunBtn').disabled = true; $('impRunBtn').textContent = '등록';
      $('impLog').innerHTML = ''; $('impFile').value = '';
    }
    p.classList.toggle('hide', !willShow);
    if (willShow) loadImportHistory();
  }
  function closeImportPanel() {
    $('importPanel').classList.add('hide');
    impRows = null; $('impRunBtn').disabled = true; $('impRunBtn').textContent = '등록';
    $('impLog').innerHTML = ''; $('impFile').value = '';
  }

  // 파일 → 텍스트 (UTF-8 우선, 깨지면 EUC-KR 재해석)
  function readTextSmart(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('파일을 읽지 못했습니다.'));
      fr.onload = () => {
        const buf = fr.result;
        let t = new TextDecoder('utf-8').decode(buf);
        if (t.indexOf('\uFFFD') >= 0) {
          try { t = new TextDecoder('euc-kr').decode(buf); } catch (e) { /* utf-8 유지 */ }
        }
        res(t);
      };
      fr.readAsArrayBuffer(file);
    });
  }

  // HTML 표 파싱 → {head, rows}
  function parseTableHtml(text) {
    const dom = new DOMParser().parseFromString(text, 'text/html');
    const trs = Array.from(dom.querySelectorAll('tr'));
    if (trs.length < 2) throw new Error('표를 찾지 못했습니다. (엑셀 원본 형식이 맞는지 확인하세요)');
    const cellsOf = (tr) => Array.from(tr.querySelectorAll('td,th')).map((td) => nsp(td.textContent));
    return { head: cellsOf(trs[0]), rows: trs.slice(1).map(cellsOf).filter((r) => r.length >= 8) };
  }

  // 회계연도별 말단 항목 캐시 (종류별로 분리)
  const impLeafCache = { inc: {}, exp: {} };
  function leavesForFY(kind, fy) {
    const c = impLeafCache[kind];
    if (!c[fy]) {
      const src = (kind === 'exp') ? expenseNodes : incomeNodes;
      c[fy] = leavesFromNodes(src.filter((n) => Number(n.fy) === fy));
    }
    return c[fy];
  }
  // 엑셀 항목문자열("식당  식대지원") → 앱 말단 항목. CODE는 쓰지 않는다.
  function matchLeaf(kind, fy, catText) {
    const leaves = leavesForFY(kind, fy);
    if (!leaves.length) return null;
    const key = nokey(catText);
    // 1) 전체 경로 일치
    let hit = leaves.filter((l) => nokey([l.c1, l.c2, l.c3].filter(Boolean).join('')) === key);
    if (hit.length === 1) return hit[0];
    // 2) 말단명 단독 일치 (유일할 때만)
    const last = nokey(nsp(catText).split(' ').pop());
    hit = leaves.filter((l) => nokey(l.c3 || l.c2 || l.c1) === last);
    if (hit.length === 1) return hit[0];
    return null;
  }

  async function previewImport() {
    const f = $('impFile').files[0];
    const box = $('impLog');
    impRows = null; $('impRunBtn').disabled = true; $('impRunBtn').textContent = '등록';
    if (!f) { box.innerHTML = '<div class="err">파일을 선택하세요.</div>'; return; }
    impFileName = f.name;
    box.innerHTML = '<div>읽는 중…</div>';
    let head, rows;
    try {
      const { head: h, rows: r } = parseTableHtml(await readTextSmart(f));
      head = h; rows = r;
    } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }

    const ix = {}; head.forEach((h, i) => { if (ix[nokey(h)] === undefined) ix[nokey(h)] = i; });
    if (impKind === 'exp') previewExp(head, rows, ix, box);
    else previewInc(head, rows, ix, box);
  }

  // ----- 지출 미리보기 -----
  // 쓰는 열: 날짜 · 항목 · 금액 · 적요. (No·회계년도·주·CODE·청구인ID·청구인·수령인·출금구분·예금주 → 버림)
  // 원본 282건 전수 확인 결과 청구인·수령인·예금주 열은 전부 비어 있었으나,
  // 값이 들어 있는 파일도 받을 수 있으므로 있으면 읽어 둔다(명부 매칭은 하지 않고 이름만 저장).
  function previewExp(head, rows, ix, box) {
    const cDate = ix['날짜'], cCat = ix['항목'], cAmt = ix['금액'];
    const cClaim = ix['청구인'], cPayee = ix['수령인'], cMemo = ix['적요'];
    if ([cDate, cCat, cAmt].some((v) => v === undefined)) {
      box.innerHTML = '<div class="err">필요한 열(날짜·항목·금액)을 찾지 못했습니다.<br>읽은 헤더: '
        + esc(head.join(' | ')) + '</div>';
      return;
    }
    const out = [], errs = [];
    const catMiss = {};
    rows.forEach((r, i) => {
      const ln = i + 2;   // 엑셀 행 번호(헤더 포함)
      const catText = nsp(r[cCat] || '');
      const rawDate = String(r[cDate] || '').replace(/[^0-9]/g, '');
      const amount = impAmt(r[cAmt]);
      const claimantName = cClaim === undefined ? '' : nsp(r[cClaim] || '');
      const payee = cPayee === undefined ? '' : nsp(r[cPayee] || '');
      const memo = cMemo === undefined ? '' : nspMulti(r[cMemo] || '');   // 적요는 줄바꿈 보존

      if (!catText && !rawDate && !amount) return;                 // 빈 줄
      if (rawDate.length !== 8) { errs.push(`${ln}행: 날짜 형식 오류 (${esc(r[cDate] || '')})`); return; }
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      if (!amount) { errs.push(`${ln}행: 금액 없음`); return; }

      const fy = fiscalYearOf(date);
      const it = matchLeaf('exp', fy, catText);
      if (!it) { catMiss[`${fy}|${catText}`] = (catMiss[`${fy}|${catText}`] || 0) + 1; return; }

      out.push({
        type: 'expense', date, week: weekLabel(date),
        c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
        claimantNo: null, claimantId: null, claimantName,   // 원본에 명부 ID가 없으므로 이름만
        payee,
        amount, memo
      });
    });

    const catMissList = Object.entries(catMiss);
    const blocked = errs.length + catMissList.length;
    const sum = out.reduce((a, b) => a + b.amount, 0);

    let h = `<div class="ok">읽은 행 ${rows.length}건 · 등록 대상 <b>${out.length}건</b> · 합계 ${wonFmt(sum)}원</div>`;
    if (catMissList.length) {
      h += `<div class="err">항목 미매칭 ${catMissList.length}종 — 등록할 수 없습니다</div><ul>`;
      catMissList.forEach(([k, v]) => { const [fy, t] = k.split('|'); h += `<li class="err">[${fy}회기] ${esc(t)} — ${v}건</li>`; });
      h += '</ul><div class="ihint">지출항목 설정에서 해당 항목을 만든 뒤 다시 [미리보기] 하세요.</div>';
    }
    if (errs.length) {
      h += `<div class="err">데이터 오류 ${errs.length}건</div><ul>`;
      errs.slice(0, 20).forEach((e) => { h += `<li class="err">${e}</li>`; });
      if (errs.length > 20) h += `<li class="err">… 외 ${errs.length - 20}건</li>`;
      h += '</ul>';
    }
    const noClaim = out.filter((p) => !p.claimantName).length;
    if (noClaim) h += `<div class="warn">청구인 없음 ${noClaim}건 — 원본에 값이 없어 빈칸으로 등록됩니다</div>`;

    if (blocked) {
      h += '<div class="err" style="margin-top:6px;">오류를 해결한 뒤 다시 미리보기 하세요.</div>';
      box.innerHTML = h;
      return;
    }
    if (!out.length) { h += '<div class="err">등록할 행이 없습니다.</div>'; box.innerHTML = h; return; }

    impRows = out;
    $('impRunBtn').disabled = false;
    $('impRunBtn').textContent = `${out.length}건 등록`;
    box.innerHTML = h;
  }

  // ----- 수입 미리보기 -----
  function previewInc(head, rows, ix, box) {
    const cDate = ix['날짜'], cCat = ix['항목'], cName = ix['이름'], cAmt = ix['금액'];
    const cSpouse = ix['배우자'], cMemo = ix['비고'];
    if ([cDate, cCat, cName, cAmt].some((v) => v === undefined)) {
      box.innerHTML = '<div class="err">필요한 열(날짜·항목·이름·금액)을 찾지 못했습니다.<br>읽은 헤더: '
        + esc(head.join(' | ')) + '</div>';
      return;
    }

    // 명부 이름 맵
    const nameMap = {};
    members.forEach((m) => { const n = nsp(m.name); if (n) (nameMap[n] = nameMap[n] || []).push(m); });

    const out = [], errs = [], skipped = [];
    const catMiss = {}, nameMiss = {}, dupName = {};
    rows.forEach((r, i) => {
      const ln = i + 2;   // 엑셀 행 번호(헤더 포함)
      const catText = nsp(r[cCat] || '');
      const rawDate = String(r[cDate] || '').replace(/[^0-9]/g, '');
      const name = nsp(r[cName] || '');
      const amount = impAmt(r[cAmt]);
      const spouseName = cSpouse === undefined ? '' : nsp(r[cSpouse] || '');
      const memo = cMemo === undefined ? '' : nspMulti(r[cMemo] || '');   // 비고도 줄바꿈 보존

      if (!catText && !rawDate && !amount) return;                 // 빈 줄
      if (nokey(catText).indexOf(nokey(IMP_CARRY)) >= 0) { skipped.push(ln); return; }  // 전기이월 제외
      if (rawDate.length !== 8) { errs.push(`${ln}행: 날짜 형식 오류 (${esc(r[cDate] || '')})`); return; }
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      if (!amount) { errs.push(`${ln}행: 금액 없음`); return; }

      const fy = fiscalYearOf(date);
      const it = matchLeaf('inc', fy, catText);
      if (!it) { catMiss[`${fy}|${catText}`] = (catMiss[`${fy}|${catText}`] || 0) + 1; return; }

      const cand = nameMap[name] || [];
      if (cand.length > 1) { dupName[name] = (dupName[name] || 0) + 1; return; }
      const m = cand[0] || null;
      if (!m) nameMiss[name] = (nameMiss[name] || 0) + 1;

      out.push({
        type: 'income', date, week: weekLabel(date),
        c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
        memberNo: m ? (m.memberNo || null) : null,
        memberId: m ? m.id : null,
        memberName: name,
        spouse: !!spouseName,
        spouseName,
        amount, memo
      });
    });

    const catMissList = Object.entries(catMiss);
    const dupList = Object.entries(dupName);
    const nameMissList = Object.entries(nameMiss).sort((a, b) => b[1] - a[1]);
    const blocked = errs.length + catMissList.length + dupList.length;
    const sum = out.reduce((a, b) => a + b.amount, 0);

    let h = `<div class="ok">읽은 행 ${rows.length}건 · 등록 대상 <b>${out.length}건</b> · 합계 ${wonFmt(sum)}원</div>`;
    if (skipped.length) h += `<div class="warn">전기이월 ${skipped.length}건 제외 (직접 입력)</div>`;

    if (catMissList.length) {
      h += `<div class="err">항목 미매칭 ${catMissList.length}종 — 등록할 수 없습니다</div><ul>`;
      catMissList.forEach(([k, v]) => { const [fy, t] = k.split('|'); h += `<li class="err">[${fy}회기] ${esc(t)} — ${v}건</li>`; });
      h += '</ul>';
    }
    if (dupList.length) {
      h += `<div class="err">명부 동명이인 — 등록할 수 없습니다</div><ul>`;
      dupList.forEach(([k, v]) => { h += `<li class="err">${esc(k)} — ${v}건</li>`; });
      h += '</ul>';
    }
    if (errs.length) {
      h += `<div class="err">데이터 오류 ${errs.length}건</div><ul>`;
      errs.slice(0, 20).forEach((e) => { h += `<li class="err">${e}</li>`; });
      if (errs.length > 20) h += `<li class="err">… 외 ${errs.length - 20}건</li>`;
      h += '</ul>';
    }
    if (nameMissList.length) {
      h += `<div class="warn">명부에 없는 이름 ${nameMissList.length}종 — 이름만 저장됩니다</div><ul>`;
      nameMissList.forEach(([k, v]) => { h += `<li class="warn">${esc(k)} — ${v}건</li>`; });
      h += '</ul><div class="ihint">명부에 등록해야 할 이름이 있으면 성도관리에서 등록 후 다시 [미리보기] 하세요.</div>';
    }

    if (blocked) {
      h += '<div class="err" style="margin-top:6px;">오류를 해결한 뒤 다시 미리보기 하세요.</div>';
      box.innerHTML = h;
      return;
    }
    if (!out.length) { h += '<div class="err">등록할 행이 없습니다.</div>'; box.innerHTML = h; return; }

    impRows = out;
    $('impRunBtn').disabled = false;
    $('impRunBtn').textContent = `${out.length}건 등록`;
    box.innerHTML = h;
  }

  async function runImport() {
    if (!impRows || !impRows.length) return;
    const M = IMP_META[impKind];
    if (!confirm(`${M.label} ${impRows.length}건을 등록할까요?`)) return;
    const btn = $('impRunBtn'); const box = $('impLog');
    btn.disabled = true; $('impPreviewBtn').disabled = true;
    const importId = 'imp_' + toYMD(new Date()).replace(/-/g, '') + '_' + String(Date.now()).slice(-6);
    try {
      let seq = await nextSeq(M.coll);
      const CH = 400;
      for (let i = 0; i < impRows.length; i += CH) {
        const batch = writeBatch(db);
        impRows.slice(i, i + CH).forEach((p) => {
          batch.set(doc(collection(db, M.coll)),
            { ...p, importId, no: seq++, createdAt: serverTimestamp(), createdBy: me.uid });
        });
        await batch.commit();
        btn.textContent = `등록 중… ${Math.min(i + CH, impRows.length)}/${impRows.length}`;
      }
      const n = impRows.length;
      await addImportHistory({ importId, file: impFileName, count: n, coll: M.coll, label: M.label, at: new Date().toISOString() });
      impRows = null; $('impFile').value = '';
      btn.textContent = '등록'; btn.disabled = true;
      box.innerHTML = `<div class="ok">${M.label} ${n}건을 등록했습니다. (임포트 번호 ${esc(importId)})</div>`;
      await loadImportHistory();
      await loadList();
    } catch (e) {
      box.innerHTML = `<div class="err">등록 실패: ${esc(e.code || e.message)}<br>`
        + `일부만 등록됐을 수 있습니다. 아래 이력에서 [${esc(importId)}]를 취소한 뒤 다시 시도하세요.</div>`;
      await addImportHistory({ importId, file: impFileName, count: -1, coll: M.coll, label: M.label, at: new Date().toISOString() });
      await loadImportHistory();
    } finally { $('impPreviewBtn').disabled = false; }
  }

  // ----- 임포트 이력 (finConfig/imports) + 롤백 -----
  async function getImportHistory() {
    try {
      const s = await getDoc(doc(db, 'finConfig', 'imports'));
      return (s.exists() && Array.isArray(s.data().list)) ? s.data().list : [];
    } catch (e) { return []; }
  }
  async function addImportHistory(rec) {
    const list = await getImportHistory();
    list.unshift(rec);
    await setDoc(doc(db, 'finConfig', 'imports'), { list: list.slice(0, 30) }, { merge: true });
  }
  async function loadImportHistory() {
    const box = $('impHist');
    box.innerHTML = '<span style="color:var(--hint);">불러오는 중…</span>';
    const list = await getImportHistory();
    if (!list.length) { box.innerHTML = '<span style="color:var(--hint);">이력이 없습니다.</span>'; return; }
    box.innerHTML = list.map((r) => `
      <div class="impitem">
        <div style="flex:1 1 auto; min-width:0;">
          <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(r.file || '–')}</div>
          <div style="color:var(--hint);">${esc((r.at || '').slice(0, 10))} · ${esc(r.label || '수입')} · ${r.count >= 0 ? r.count + '건' : '실패(부분등록 가능)'} · ${esc(r.importId)}</div>
        </div>
        <button type="button" class="impbtn2 dgr" data-imp="${esc(r.importId)}">취소</button>
      </div>`).join('');
    box.querySelectorAll('button[data-imp]').forEach((b) => { b.onclick = () => undoImport(b.dataset.imp); });
  }
  async function undoImport(importId) {
    // 삭제 대상 컬렉션은 이력에 기록된 coll 을 따른다.
    // (coll 이 없는 옛 이력 = 지출 임포트 도입 전 = 전부 수입이므로 offerings 로 폴백)
    const rec = (await getImportHistory()).find((r) => r.importId === importId) || {};
    const coll = rec.coll || 'offerings';
    const label = rec.label || '수입';
    if (!confirm(`임포트 [${importId}] 로 등록된 ${label} 기록을 모두 삭제할까요?\n되돌릴 수 없습니다.`)) return;
    const box = $('impLog');
    box.innerHTML = '<div>삭제 중…</div>';
    try {
      const qs = await getDocs(query(collection(db, coll), where('importId', '==', importId)));
      const ds = qs.docs;
      for (let i = 0; i < ds.length; i += 400) {
        const b = writeBatch(db);
        ds.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
      const list = (await getImportHistory()).filter((r) => r.importId !== importId);
      await setDoc(doc(db, 'finConfig', 'imports'), { list }, { merge: true });
      box.innerHTML = `<div class="ok">${ds.length}건을 삭제했습니다.</div>`;
      await loadImportHistory();
      await loadList();
    } catch (e) { box.innerHTML = `<div class="err">삭제 실패: ${esc(e.code || e.message)}</div>`; }
  }

  // ----- 탭 -----
  const TABS = ['inc', 'exp', 'set'];   // 이 파일이 실제로 그리는 탭 ('stats'는 별도 파일)
  function setTab(t) {
    if (t === 'stats') { location.href = 'stats.html'; return; }   // 통계는 stats.html 로 이동
    curTab = t;
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('on', el.dataset.tab === t));
    const isSet = t === 'set';
    $('periodSec').classList.toggle('hide', isSet);
    $('formSec').classList.toggle('hide', isSet);
    $('listSec').classList.toggle('hide', isSet);
    $('setSec').classList.toggle('hide', !isSet);
    if (isSet) { $('itemEditor').classList.add('hide'); return; }
    $('incFields').classList.toggle('hide', t !== 'inc');
    $('expFields').classList.toggle('hide', t !== 'exp');
    $('importBtn').classList.remove('hide');   // 불러오기: 수입·지출 탭 모두 (설치탭은 위에서 return)
    closeImportPanel();   // 탭을 바꾸면 패널을 닫는다 (열린 채로 두면 impKind가 실제 탭과 어긋난다)
    $('memoLabel').textContent = t === 'inc' ? '비고' : '적요';
    $('memoSub').textContent = '';
    resetForm();
    if (t === 'inc') refreshIncomeCats();
    else if (t === 'exp') refreshExpenseCats();
    updateCode();
    loadList();
  }

  // ----- 초기화 -----
  function initUI() {
    const today = toYMD(new Date());
    $('inDate').value = today;
    $('weekBadge').textContent = weekLabel(today);
    const [s, e] = weekRange(today);
    $('fromDate').value = s; $('toDate').value = e;
    populateSelects();

    document.querySelectorAll('.tab').forEach((el) => { el.onclick = () => setTab(el.dataset.tab); });
    $('backBtn').onclick = () => { location.href = 'index.html'; };
    $('inDate').addEventListener('change', () => { $('weekBadge').textContent = $('inDate').value ? weekLabel($('inDate').value) : '–'; refreshIncomeCats(); refreshExpenseCats(); });
    $('incCat').addEventListener('change', () => { setCatMiss(false); updateCode(); updateIncFace(); });
    $('expCat').addEventListener('change', () => { setCatMiss(false); updateCode(); updateExpFace(); });
    $('incName').addEventListener('input', onNameEdit);
    $('incName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doNameSearch(); if (linked) $('inAmount').focus(); } });
    $('incSearchBtn').addEventListener('click', doNameSearch);
    $('expClaimName').addEventListener('input', onClaimEdit);
    $('expClaimName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doClaimSearch(); if (claimant) $('expPayee').focus(); } });
    $('expClaimSearchBtn').addEventListener('click', doClaimSearch);
    $('inAmount').addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (await save()) { if (curTab === 'inc') $('incName').focus(); } } });
    $('spouseChk').addEventListener('change', toggleSpouse);
    $('inAmount').addEventListener('input', () => { const n = onlyNum($('inAmount').value); $('inAmount').value = n ? wonFmt(n) : ''; });
    $('qaSubmit').onclick = submitQuickAdd;
    $('qaCancel').onclick = closeQuickAdd;
    $('saveBtn').onclick = save;
    $('importBtn').onclick = toggleImportPanel;
    $('impPreviewBtn').onclick = previewImport;
    $('impRunBtn').onclick = runImport;
    $('impCloseBtn').onclick = closeImportPanel;
    $('impFile').addEventListener('change', () => {
      impRows = null; $('impRunBtn').disabled = true; $('impRunBtn').textContent = '등록'; $('impLog').innerHTML = '';
    });
    $('editCancelBtn').onclick = () => {
      resetForm();
      const t = toYMD(new Date());
      $('inDate').value = t; $('weekBadge').textContent = weekLabel(t);
      refreshIncomeCats();
    };
    $('searchBtn').onclick = loadList;
    $('periodPickBtn').onclick = openPeriodPick;
    $('ppCancel').onclick = closePeriodPick;
    $('ppApply').onclick = applyPeriodPick;
    $('ppFySel').addEventListener('change', () => ppSetFy(Number($('ppFySel').value)));
    $('periodModal').addEventListener('click', (e) => { if (e.target === $('periodModal')) closePeriodPick(); });
    $('viewDate').onclick = () => setIncView('date');
    $('viewGroup').onclick = () => setIncView('group');
    $('thisWeekBtn').onclick = () => { const [a, b] = weekRange($('inDate').value || today); $('fromDate').value = a; $('toDate').value = b; loadList(); };
    $('setIncBtn').onclick = () => { location.href = 'income.html'; };
    $('setExpBtn').onclick = () => { location.href = 'expense.html'; };
    $('setBudgetBtn').onclick = () => { location.href = 'budget.html'; };
    $('setCloseBtn').onclick = openCloseMonth;
    $('cmCancel').onclick = closeCloseMonth;
    $('cmSave').onclick = saveCloseMonth;
    $('closeMonthSel').addEventListener('change', updateCloseHint);
    $('closeMonthModal').addEventListener('click', (e) => { if (e.target === $('closeMonthModal')) closeCloseMonth(); });

    // stats.html 에서 돌아올 때 ?tab=exp 처럼 탭을 지정할 수 있다
    const qTab = new URLSearchParams(location.search).get('tab');
    setTab(TABS.includes(qTab) ? qTab : 'inc');
  }
