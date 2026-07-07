
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
    try {
      const s = await getDoc(doc(db, 'finConfig', 'items'));
      config = s.exists() ? s.data() : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (!Array.isArray(config.income)) config.income = [];
      if (!Array.isArray(config.expense)) config.expense = [];
    } catch (e) {
      config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }
  async function saveConfig() {
    await setDoc(doc(db, 'finConfig', 'items'), config);
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
    $('incCat').innerHTML = config.income.map((it, i) => `<option value="${i}">${esc(pathOf(it))}</option>`).join('') || '<option value="">(항목 없음)</option>';
    $('expCat').innerHTML = config.expense.map((it, i) => `<option value="${i}">${esc(pathOf(it))}</option>`).join('') || '<option value="">(항목 없음)</option>';
    updateCode();
  }
  function updateCode() {
    if (curTab === 'inc') { const it = config.income[+$('incCat').value]; $('incCode').textContent = it ? it.code : '–'; }
    else if (curTab === 'exp') { const it = config.expense[+$('expCat').value]; $('expCode').textContent = it ? it.code : '–'; }
  }

  // ----- 이름 검색 / 연동 / 간편등록 -----
  function setLinked(m) {
    linked = { id: m.id, no: Number(m.memberNo) || 0, name: m.name };
    $('incName').value = m.name;
    $('incMemberNo').textContent = linked.no || '–';
    $('nameStatus').innerHTML = `<div class="status st-ok">✓ ${esc(m.name)} 성도로 연동됨${linked.no ? (' · #' + linked.no) : ''}</div>`;
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
    } catch (e) { showMsg('저장 실패: ' + (e.code || e.message)); }
    finally { btn.disabled = false; btn.textContent = '저장'; }
  }

  // ----- 목록 -----
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
  async function loadList() {
    const coll = curTab === 'inc' ? 'offerings' : 'expenses';
    const from = $('fromDate').value, to = $('toDate').value;
    $('listTitle').textContent = '이 기간 ' + (curTab === 'inc' ? '수입' : '지출');
    const box = $('listRows'); box.innerHTML = '<div class="empty">불러오는 중…</div>';
    try {
      const qs = await getDocs(query(collection(db, coll), where('date', '>=', from), where('date', '<=', to)));
      let rows = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : ((b.no || 0) - (a.no || 0))));
      const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      $('listSum').textContent = `${rows.length}건 · ${wonFmt(sum)}원`;
      if (!rows.length) { box.innerHTML = '<div class="empty">이 기간에 기록이 없습니다.</div>'; return; }
      box.innerHTML = rows.map((r) => rowHtml(r, r.id)).join('');
      box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => delRec(coll, b.getAttribute('data-del')); });
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
    $('inDate').addEventListener('change', () => { $('weekBadge').textContent = $('inDate').value ? weekLabel($('inDate').value) : '–'; });
    $('incCat').addEventListener('change', updateCode);
    $('expCat').addEventListener('change', updateCode);
    $('incName').addEventListener('input', onNameEdit);
    $('incName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doNameSearch(); } });
    $('spouseChk').addEventListener('change', toggleSpouse);
    $('inAmount').addEventListener('input', () => { const n = onlyNum($('inAmount').value); $('inAmount').value = n ? wonFmt(n) : ''; });
    $('qaSubmit').onclick = submitQuickAdd;
    $('qaCancel').onclick = closeQuickAdd;
    $('saveBtn').onclick = save;
    $('searchBtn').onclick = loadList;
    $('thisWeekBtn').onclick = () => { const [a, b] = weekRange($('inDate').value || today); $('fromDate').value = a; $('toDate').value = b; loadList(); };
    $('setIncBtn').onclick = () => openEditor('income');
    $('setExpBtn').onclick = () => openEditor('expense');

    setTab('inc');
  }
