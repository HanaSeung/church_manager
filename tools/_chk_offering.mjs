
  import { auth, db } from "./firebase-config.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
  import {
    collection, addDoc, getDoc, getDocs, doc, deleteDoc, setDoc,
    query, where, serverTimestamp
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

  // ----- 상태 -----
  let me = { uid: null, level: 1 };
  let config = null;
  let incomeNodes = [];   // 수입 항목 노드(전 연도). 날짜의 회계연도로 걸러 드롭다운 구성.
  let members = [];
  let membersOk = true;
  let curTab = 'inc';
  let linked = null;   // {id, no, name} 또는 null (없으면 무명 #0)

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
    // 지출 항목: 기존 단일 문서(finConfig/items). 지출은 아직 노드화 전.
    try {
      const s = await getDoc(doc(db, 'finConfig', 'items'));
      const d = s.exists() ? s.data() : DEFAULT_CONFIG;
      config = { income: [], expense: Array.isArray(d.expense) ? d.expense : [] };
    } catch (e) {
      config = { income: [], expense: JSON.parse(JSON.stringify(DEFAULT_CONFIG.expense)) };
    }
    // 결산월 + 수입 노드(전 연도) 로드. 실제 config.income은 입력 날짜의 회계연도로 refreshIncomeCats()에서 구성.
    try {
      const st = await getDoc(doc(db, 'finConfig', 'settings'));
      if (st.exists() && st.data().closeMonth) closeMonth = Number(st.data().closeMonth);
    } catch (e) { /* 기본 12 */ }
    try {
      const qs = await getDocs(collection(db, 'finConfig'));
      incomeNodes = qs.docs.map((x) => ({ id: x.id, ...x.data() })).filter((n) => n.kind === 'income');
    } catch (e) { incomeNodes = []; }
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
    // 지출 항목만 저장 (수입은 income.html 노드에서 관리)
    await setDoc(doc(db, 'finConfig', 'items'), { expense: config.expense });
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
    $('expCat').innerHTML = config.expense.map((it, i) => `<option value="${i}">${esc(pathOf(it))}</option>`).join('') || '<option value="">(항목 없음)</option>';
    refreshIncomeCats();
    updateCode();
  }
  function updateCode() {
    if (curTab === 'inc') { const it = config.income[+$('incCat').value]; $('incCode').textContent = it ? it.code : '–'; }
    else if (curTab === 'exp') { const it = config.expense[+$('expCat').value]; $('expCode').textContent = it ? it.code : '–'; }
  }
  // 닫힌 칸에는 선택한 항목의 '이름만' 표시(들여쓰기·표식 없이)
  function updateIncFace() {
    const it = config.income[+$('incCat').value];
    $('incCatText').textContent = it ? (it.c3 || it.c2 || it.c1 || '–')
      : ($('incCat').options[0] ? $('incCat').options[0].textContent : '–');
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
  function resetForm() {
    $('inAmount').value = ''; $('inMemo').value = '';
    $('expPayee').value = '';
    $('incName').value = ''; linked = null;
    $('incMemberNo').textContent = '–';
    $('nameStatus').innerHTML = '';
    $('spouseChk').checked = false; $('spouseName').disabled = true; $('spouseName').value = '';
  }
  async function save() {
    const date = $('inDate').value;
    const amount = onlyNum($('inAmount').value);
    const memo = $('inMemo').value.trim();
    if (!date) return showMsg('날짜를 선택하세요.');
    if (!amount) return showMsg('금액을 입력하세요.');
    if (curTab === 'inc' && !linked) return showMsg('이름을 입력하고 Enter로 검색해 명부와 연동하세요.');
    const btn = $('saveBtn'); btn.disabled = true; btn.textContent = '저장 중…';
    try {
      if (curTab === 'inc') {
        const it = config.income[+$('incCat').value];
        if (!it) throw { message: '헌금 항목을 선택하세요.' };
        await addDoc(collection(db, 'offerings'), {
          type: 'income', date, week: weekLabel(date),
          c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
          memberNo: linked.no || null,
          memberId: linked.id,
          memberName: linked.name,
          spouse: $('spouseChk').checked,
          spouseName: $('spouseChk').checked ? $('spouseName').value.trim() : '',
          amount, memo, no: await nextSeq('offerings'),
          createdAt: serverTimestamp(), createdBy: me.uid
        });
      } else {
        const it = config.expense[+$('expCat').value];
        if (!it) throw { message: '지출 항목을 선택하세요.' };
        await addDoc(collection(db, 'expenses'), {
          type: 'expense', date, week: weekLabel(date),
          c1: it.c1, c2: it.c2 || '', c3: it.c3 || '', catPath: pathOf(it), code: it.code || '',
          payee: $('expPayee').value.trim(),
          amount, memo, no: await nextSeq('expenses'),
          createdAt: serverTimestamp(), createdBy: me.uid
        });
      }
      resetForm();
      await loadList();
      return true;
    } catch (e) { showMsg('저장 실패: ' + (e.code || e.message)); }
    finally { btn.disabled = false; btn.textContent = '저장'; }
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
  function rowHtml(r, id) {
    const isInc = curTab === 'inc';
    const main = esc(r.catPath || '(항목 없음)');
    const who = isInc
      ? (r.memberName || '') + (r.memberNo ? (' #' + r.memberNo) : '') + (r.spouseName ? ` (배우자 ${r.spouseName})` : '')
      : (r.payee || '');
    const meta = [who, r.date].filter(Boolean).join(' · ');
    return `<div class="lrow">
      <div class="li"><div class="lname">${main}</div><div class="lmeta">${esc(meta)}</div></div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="lamt ${isInc ? 'inc' : 'exp'}">${wonFmt(r.amount)}</span>
        <button class="del" data-del="${id}">삭제</button>
      </div>
    </div>`;
  }
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
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => alert('수정 기능은 다음 단계에서 추가됩니다.'); });
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
        box.innerHTML = rows.map((r) => rowHtml(r, r.id)).join('');
        box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => delRec(coll, b.getAttribute('data-del')); });
      }
    } catch (e) { box.innerHTML = `<div class="empty">불러오지 못했습니다.<br>(${esc(e.code || e.message)})</div>`; }
  }
  async function delRec(coll, id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteDoc(doc(db, coll, id)); await loadList(); }
    catch (e) { alert('삭제 실패: ' + (e.code || e.message)); }
  }

  // ----- 설치: 항목 편집 -----
  let editType = null;
  function openEditor(type) { editType = type; $('itemEditor').classList.remove('hide'); renderEditor(); }
  function suggestCode() {
    const arr = config[editType]; const base = editType === 'income' ? 100000 : 200000;
    let mx = base; arr.forEach((it) => { const n = Number(it.code); if (Number.isFinite(n) && n > mx) mx = n; });
    return String(mx + 10);
  }
  function renderEditor() {
    const arr = config[editType];
    const title = editType === 'income' ? '수입 항목' : '지출 항목';
    let html = `<div class="settitle" style="margin-top:12px;">${title} (${arr.length})</div>`;
    html += arr.map((it, i) => `<div class="setrow">
      <div><div class="srt">${esc(pathOf(it))}</div><div class="srd">코드 ${esc(it.code || '')}</div></div>
      <button class="del" data-di="${i}">삭제</button></div>`).join('');
    html += `<div style="border:1px solid var(--line); border-radius:10px; padding:11px 13px;">
      <div class="srd" style="margin-bottom:7px;">새 항목 추가</div>
      <div style="margin-bottom:6px;"><input id="ni1" placeholder="항목1 (예: 일반재정)"></div>
      <div style="margin-bottom:6px;"><input id="ni2" placeholder="항목2 (예: 주일헌금)"></div>
      <div style="margin-bottom:6px;"><input id="ni3" placeholder="항목3 (선택)"></div>
      <div class="row"><input id="nic" class="grow" placeholder="코드" value="${suggestCode()}"><button class="qbtn" id="addItemBtn">추가</button></div>
    </div>`;
    $('itemEditor').innerHTML = html;
    $('itemEditor').querySelectorAll('[data-di]').forEach((b) => { b.onclick = () => delItem(+b.getAttribute('data-di')); });
    $('addItemBtn').onclick = addItem;
  }
  async function addItem() {
    const c1 = $('ni1').value.trim(), c2 = $('ni2').value.trim(), c3 = $('ni3').value.trim(), code = $('nic').value.trim();
    if (!c1) return alert('항목1을 입력하세요.');
    if (!code) return alert('코드를 입력하세요.');
    config[editType].push({ c1, c2, c3, code });
    try { await saveConfig(); populateSelects(); renderEditor(); }
    catch (e) { config[editType].pop(); alert('저장 실패: ' + (e.code || e.message)); }
  }
  async function delItem(i) {
    if (!confirm('이 항목을 삭제할까요?')) return;
    const removed = config[editType].splice(i, 1);
    try { await saveConfig(); populateSelects(); renderEditor(); }
    catch (e) { config[editType].splice(i, 0, removed[0]); alert('삭제 실패: ' + (e.code || e.message)); }
  }

  // ----- 탭 -----
  function setTab(t) {
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
    $('memoLabel').textContent = t === 'inc' ? '비고' : '적요';
    $('memoSub').textContent = t === 'inc' ? '(선택)' : '(내용)';
    resetForm();
    if (t === 'inc') refreshIncomeCats();
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
    $('rightBtn').onclick = () => alert('통계 화면은 이후 단계에서 추가됩니다.');
    $('inDate').addEventListener('change', () => { $('weekBadge').textContent = $('inDate').value ? weekLabel($('inDate').value) : '–'; refreshIncomeCats(); });
    $('incCat').addEventListener('change', () => { updateCode(); updateIncFace(); });
    $('expCat').addEventListener('change', updateCode);
    $('incName').addEventListener('input', onNameEdit);
    $('incName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doNameSearch(); if (linked) $('inAmount').focus(); } });
    $('incSearchBtn').addEventListener('click', doNameSearch);
    $('inAmount').addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); if (await save()) { if (curTab === 'inc') $('incName').focus(); } } });
    $('spouseChk').addEventListener('change', toggleSpouse);
    $('inAmount').addEventListener('input', () => { const n = onlyNum($('inAmount').value); $('inAmount').value = n ? wonFmt(n) : ''; });
    $('qaSubmit').onclick = submitQuickAdd;
    $('qaCancel').onclick = closeQuickAdd;
    $('saveBtn').onclick = save;
    $('searchBtn').onclick = loadList;
    $('viewDate').onclick = () => setIncView('date');
    $('viewGroup').onclick = () => setIncView('group');
    $('thisWeekBtn').onclick = () => { const [a, b] = weekRange($('inDate').value || today); $('fromDate').value = a; $('toDate').value = b; loadList(); };
    $('setIncBtn').onclick = () => { location.href = 'income.html'; };
    $('setExpBtn').onclick = () => openEditor('expense');
    $('setCloseBtn').onclick = openCloseMonth;
    $('cmCancel').onclick = closeCloseMonth;
    $('cmSave').onclick = saveCloseMonth;
    $('closeMonthSel').addEventListener('change', updateCloseHint);
    $('closeMonthModal').addEventListener('click', (e) => { if (e.target === $('closeMonthModal')) closeCloseMonth(); });

    setTab('inc');
  }
