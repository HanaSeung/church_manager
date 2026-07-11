
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, writeBatch, serverTimestamp
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    const COL = 'finConfig';   // 재정 설정 공용 컬렉션 (수입/지출 항목)
    const KIND = 'income';     // 이 화면은 수입항목만 다룸
    const MIN_LEVEL = 3;       // 재정담당(3단계) 이상만
    const BASE_CODE = 100010, STEP = 10, MAX_DEPTH = 3;

    // ---- 기금(fund) ----
    // 목적기금은 교회가 마음대로 쓸 수 없는 '별도 주머니'다. 결산에서 잔액을 분리해 집계한다.
    // 저장 규칙: 노드에 fund 가 없거나 '' 이면 상위에서 상속. 끝까지 없으면 '일반'.
    //   → 지출항목·일반 수입항목은 아무것도 저장하지 않아도 자동으로 '일반'이 된다 (백필 불필요).
    const FUNDS = ['일반', '선교', '장학', '건축', '차량'];
    const DEFAULT_FUND = '일반';

    // 상위로 거슬러 올라가며 명시된 fund 를 찾는다. byId 없으면 cats 에서 조회.
    function fundOf(node, byId) {
      let n = node, guard = 0;
      while (n && guard++ < 10) {
        if (n.fund && FUNDS.includes(n.fund)) return n.fund;
        if (!n.parentId) break;
        n = byId ? byId[n.parentId] : cats.find((c) => c.id === n.parentId);
      }
      return DEFAULT_FUND;
    }
    // 부모가 물려주는 기금 (신규 추가 시 '상위와 같음'이 무엇이 되는지 안내용)
    const inheritedFund = (parent) => (parent ? fundOf(parent) : DEFAULT_FUND);

    let me = { uid: null, level: 1 };
    let cats = [];        // 모든 연도의 수입항목 노드
    let curFY = null;     // 현재 편집 중인 회계연도
    let closeMonth = 12;  // 결산월 (finConfig/settings)
    let migrated = false; // 레거시(fy 없음) 1회 이전 플래그
    let editId = null;    // 수정 중 문서 id (null이면 신규)
    let addParent = null; // 신규 추가 시 부모 {id,code,name,level} 또는 null(대분류)

    // 회계연도 계산: 결산월 이하 달이면 그 해, 초과면 +1년 (결산월 = 끝나는 달)
    const fiscalYearOf = (d) => (d.getMonth() + 1) <= closeMonth ? d.getFullYear() : d.getFullYear() + 1;
    const currentFY = () => fiscalYearOf(new Date());
    const inFY = () => cats.filter((c) => Number(c.fy) === curFY);

    const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const codeNum = (c) => Number(String(c).replace(/[^0-9]/g, '')) || 0;

    $('backBtn').addEventListener('click', () => {
      if (history.length > 1) history.back(); else location.href = 'index.html';
    });

    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.replace('index.html'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const lv = snap.exists() ? (snap.data().level || 1) : 1;
        if (lv < MIN_LEVEL) { alert('수입항목 설정은 재정 담당자만 이용할 수 있습니다.'); location.replace('index.html'); return; }
        me = { uid: user.uid, level: lv };
        try {
          const s = await getDoc(doc(db, 'finConfig', 'settings'));
          if (s.exists() && s.data().closeMonth) closeMonth = Number(s.data().closeMonth);
        } catch (e) { /* 기본 12 */ }
        subscribe();
      } catch (e) {
        alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        location.replace('index.html');
      }
    });

    function subscribe() {
      onSnapshot(collection(db, COL), async (qs) => {
        cats = qs.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.kind === KIND);
        // 레거시(fy 없는) 항목을 2025로 1회 이전
        if (!migrated) {
          const legacy = cats.filter((c) => !c.fy);
          if (legacy.length) {
            migrated = true;
            try {
              for (let i = 0; i < legacy.length; i += 400) {
                const batch = writeBatch(db);
                legacy.slice(i, i + 400).forEach((c) => batch.update(doc(db, COL, c.id), { fy: 2025 }));
                await batch.commit();
              }
            } catch (e) { console.error(e); }
            return; // 이전 후 스냅샷이 다시 들어옴
          }
          migrated = true;
        }
        // 기본 선택 연도: 데이터가 있으면 가장 최근 연도, 없으면 현재 회계연도
        if (curFY == null) {
          const ys = [...new Set(cats.map((c) => Number(c.fy)).filter(Boolean))];
          curFY = ys.length ? Math.max(...ys) : currentFY();
        }
        buildYearSelect();
        render();
      }, (err) => {
        console.error(err);
        $('tree').innerHTML = '<div class="empty">목록을 불러오지 못했습니다.</div>';
      });
    }

    function buildYearSelect() {
      const ys = new Set(cats.map((c) => Number(c.fy)).filter(Boolean));
      ys.add(curFY);
      const arr = [...ys].sort((a, b) => b - a);
      $('fySel').innerHTML = arr.map((y) => `<option value="${y}"${y === curFY ? ' selected' : ''}>${y}년도</option>`).join('')
        + '<option value="__new__">+ 새 연도…</option>';
    }

    function onYearChange() {
      const v = $('fySel').value;
      if (v === '__new__') {
        const def = String((curFY || currentFY()) + 1);
        const inp = prompt('새로 만들 회계연도를 입력하세요 (예: ' + def + ')', def);
        if (inp == null) { buildYearSelect(); return; }
        const y = Number(String(inp).trim());
        if (!Number.isInteger(y) || y < 1900 || y > 3000) { alert('올바른 연도를 입력하세요.'); buildYearSelect(); return; }
        curFY = y;
      } else {
        curFY = Number(v);
      }
      buildYearSelect();
      render();
    }

    // ---- 계산 도우미 (현재 연도 기준) ----
    function nextCode() {
      let mx = 0; inFY().forEach((c) => { const n = codeNum(c.code); if (n > mx) mx = n; });
      return String(mx > 0 ? mx + STEP : BASE_CODE);
    }
    const childrenOf = (pid) => cats
      .filter((c) => Number(c.fy) === curFY && (c.parentId || null) === (pid || null))
      .sort((a, b) => codeNum(a.code) - codeNum(b.code));
    const hasChildren = (id) => cats.some((c) => Number(c.fy) === curFY && c.parentId === id);

    // ---- 기본 세트 (빈 화면일 때 '기본 항목 불러오기'로 1회 생성) ----
    // [코드, 항목명, 단계, 기금]  — 기금 생략 = 상위와 같음 (최상위면 '일반')
    const DEFAULT_INCOME = [
      ['100010', '일반재정', 1],
      ['100020', '주일헌금', 2], ['100030', '감사헌금', 2], ['100040', '십일조', 2],
      ['100050', '구역헌금', 2], ['100060', '절기헌금', 2],
      ['100070', '신년감사', 3], ['100080', '부활절감사', 3], ['100090', '맥추감사', 3],
      ['100100', '성탄감사', 3], ['100110', '추수감사', 3],
      ['100120', '기타헌금', 2],
      ['100130', '특별헌금', 1],
      ['100140', '선교헌금', 2, '선교'], ['100150', '장학헌금', 2, '장학'],
      ['100160', '건축헌금', 2, '건축'], ['100170', '차량구입', 2, '차량'],
      ['100180', '기타', 1],
      ['100190', '후원금', 2], ['100200', '이자', 2], ['100210', '기타', 2],
      ['100220', '이월', 1],
      ['100230', '일반재정 이월', 2],
      ['100240', '선교헌금 이월', 2, '선교'], ['100250', '장학헌금 이월', 2, '장학'],
      ['100260', '건축헌금 이월', 2, '건축'], ['100270', '차량헌금 이월', 2, '차량']
    ];
    async function seedDefaults() {
      if (inFY().length > 0) { alert('이미 이 연도에 항목이 있어 기본 세트를 불러오지 않습니다.'); return; }
      if (!confirm(`${curFY}년도에 기본 수입항목 세트를 불러올까요?`)) return;
      const btn = $('seedBtn');
      if (btn) { btn.disabled = true; btn.textContent = '불러오는 중…'; }
      try {
        let lastL1 = null, lastL2 = null;
        for (const [code, name, level, fund] of DEFAULT_INCOME) {
          const parentId = level === 1 ? null : (level === 2 ? lastL1 : lastL2);
          const ref = await addDoc(collection(db, COL), {
            kind: KIND, fy: curFY, code, name, level, parentId,
            fund: fund || '',
            active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
          if (level === 1) { lastL1 = ref.id; lastL2 = null; }
          else if (level === 2) { lastL2 = ref.id; }
        }
      } catch (e) {
        console.error(e); alert('기본 항목 불러오기에 실패했습니다.');
        if (btn) { btn.disabled = false; btn.textContent = '기본 항목 불러오기'; }
      }
    }

    // ---- 다른 해 복사 (빈 연도로만) ----
    async function copyFromYear() {
      if (inFY().length > 0) { alert('이 연도에 이미 항목이 있어 복사할 수 없습니다.'); return; }
      const srcYears = [...new Set(cats.map((c) => Number(c.fy)).filter((y) => y && y !== curFY))].sort((a, b) => b - a);
      if (!srcYears.length) { alert('복사해 올 다른 연도가 없습니다.'); return; }
      let src;
      if (srcYears.length === 1) { src = srcYears[0]; }
      else {
        const inp = prompt('어느 연도를 복사할까요?\n(' + srcYears.join(', ') + ')', String(srcYears[0]));
        if (inp == null) return;
        src = Number(String(inp).trim());
        if (!srcYears.includes(src)) { alert('목록에 없는 연도입니다.'); return; }
      }
      if (!confirm(`${src}년도 수입항목을 ${curFY}년도로 복사할까요?`)) return;
      const btn = $('copyBtn'); if (btn) { btn.disabled = true; btn.textContent = '복사 중…'; }
      try {
        const nodes = cats.filter((c) => Number(c.fy) === src);
        const idMap = {}; nodes.forEach((n) => { idMap[n.id] = doc(collection(db, COL)).id; });
        for (let i = 0; i < nodes.length; i += 400) {
          const batch = writeBatch(db);
          nodes.slice(i, i + 400).forEach((n) => {
            batch.set(doc(db, COL, idMap[n.id]), {
              kind: KIND, fy: curFY, code: n.code, name: n.name, level: n.level,
              parentId: n.parentId ? (idMap[n.parentId] || null) : null,
              fund: n.fund || '',
              active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
            });
          });
          await batch.commit();
        }
      } catch (e) {
        console.error(e); alert('복사에 실패했습니다.');
        if (btn) { btn.disabled = false; btn.textContent = '다른 해 복사'; }
      }
    }

    // ---- 전체 삭제 (2회 확인) ----
    async function clearAll() {
      const list = inFY();
      if (list.length === 0) return;
      if (!confirm(`${curFY}년도 수입항목 ${list.length}개를 모두 삭제할까요?\n되돌릴 수 없습니다.`)) return;
      if (!confirm('정말 이 연도 전체를 삭제할까요? 이 작업은 취소할 수 없습니다.')) return;
      const btn = $('clearAllBtn'); btn.disabled = true; const t = btn.textContent; btn.textContent = '삭제 중…';
      try {
        const ids = list.map((c) => c.id);
        for (let i = 0; i < ids.length; i += 400) {   // writeBatch 한도(500) 대비 청크
          const batch = writeBatch(db);
          ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, COL, id)));
          await batch.commit();
        }
      } catch (e) {
        console.error(e); alert('전체 삭제에 실패했습니다.');
      } finally {
        btn.disabled = false; btn.textContent = t;
      }
    }

    // ---- 자동번호 (트리 순서대로 100010부터 +10 재채번, 중지 포함, 확인 1회) ----
    async function renumberAll() {
      if (inFY().length === 0) return;
      if (!confirm('모든 항목의 코드를 10단위로 다시 매길까요?')) return;
      const btn = $('renumBtn'); btn.disabled = true; const t = btn.textContent; btn.textContent = '처리 중…';
      try {
        const ordered = [];
        const walk = (pid) => { childrenOf(pid).forEach((c) => { ordered.push(c); walk(c.id); }); };
        walk(null);   // childrenOf는 중지 포함, 형제 code 오름차순
        const updates = [];
        let code = BASE_CODE;
        ordered.forEach((c) => {
          const nc = String(code);
          if (String(c.code) !== nc) updates.push({ id: c.id, code: nc });
          code += STEP;
        });
        for (let i = 0; i < updates.length; i += 400) {
          const batch = writeBatch(db);
          updates.slice(i, i + 400).forEach((u) => batch.update(doc(db, COL, u.id), { code: u.code, updatedAt: serverTimestamp() }));
          await batch.commit();
        }
      } catch (e) {
        console.error(e); alert('자동번호 처리에 실패했습니다.');
      } finally {
        btn.disabled = false; btn.textContent = t;
      }
    }
    function render() {
      const rows = [];
      const byId = {};
      cats.forEach((c) => { byId[c.id] = c; });
      const walk = (pid, level) => {
        childrenOf(pid).forEach((c) => {
          rows.push(rowHtml(c, level, fundOf(c, byId)));
          walk(c.id, level + 1);
        });
      };
      walk(null, 1);
      $('tree').innerHTML = rows.join('');
      const has = rows.length > 0;
      $('renumBtn').style.display = has ? '' : 'none';
      $('clearAllBtn').style.display = has ? '' : 'none';
      const box = $('emptyBox');
      if (!has) {
        const others = [...new Set(cats.map((c) => Number(c.fy)).filter((y) => y && y !== curFY))];
        const copyBtn = others.length
          ? '<button class="btn-line-green" id="copyBtn" style="margin-left:8px;">다른 해 복사</button>' : '';
        box.style.display = 'block';
        box.innerHTML = `${curFY}년도에 등록된 수입항목이 없습니다.<br>기본 세트를 불러오거나 다른 해를 복사하거나 ‘대분류 추가’로 시작하세요.`
          + `<div style="margin-top:14px;"><button class="btn" id="seedBtn">기본 항목 불러오기</button>${copyBtn}</div>`;
        $('seedBtn').onclick = seedDefaults;
        if (others.length) $('copyBtn').onclick = copyFromYear;
      } else {
        box.style.display = 'none';
      }
      bindRowEvents();
    }

    function rowHtml(c, level, fund) {
      const pad = level * 18;
      const canAdd = level < MAX_DEPTH;
      const icon = level === 1 ? '📁' : (level === 2 ? '↳' : '·');
      const addBtn = canAdd
        ? `<button class="iconbtn add" data-add="${c.id}" aria-label="하위 추가">＋</button>`
        : '<span style="width:30px;"></span>';
      // 목적기금만 뱃지로 표시 (일반재정은 기본값이라 표시하지 않는다)
      const fundTag = (fund && fund !== DEFAULT_FUND)
        ? `<span class="fundtag">${esc(fund)}</span>` : '';
      return `<div class="trow lvl${level}">
        <span class="t-code">${esc(c.code)}</span>
        <span class="t-name" style="padding-left:${pad}px;">
          <span style="color:var(--muted); font-size:13px;">${icon}</span>
          <span class="nm">${esc(c.name)}</span>${fundTag}
        </span>
        <span class="t-acts">${addBtn}<button class="iconbtn" data-edit="${c.id}" aria-label="수정">✎</button><button class="iconbtn del" data-del="${c.id}" aria-label="삭제">🗑</button></span>
      </div>`;
    }

    function bindRowEvents() {
      const t = $('tree');
      t.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => openAdd(b.dataset.add));
      t.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openEdit(b.dataset.edit));
      t.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => onDelete(b.dataset.del));
    }

    // ---- 모달 (추가/수정) ----
    function openTop() { addParent = null; editId = null; openModal('대분류 추가', '최상위(1단계) 항목입니다.'); }
    function openAdd(pid) {
      const p = cats.find((c) => c.id === pid); if (!p) return;
      addParent = p; editId = null;
      openModal('하위 항목 추가', `상위: ${p.name} (${p.code}) · ${(p.level || 1) + 1}단계`);
    }
    function openEdit(id) {
      const c = cats.find((x) => x.id === id); if (!c) return;
      editId = id; addParent = null;
      const p = c.parentId ? cats.find((x) => x.id === c.parentId) : null;
      openModal('항목 수정', p ? `상위: ${p.name} (${p.code})` : '최상위(1단계) 항목입니다.');
      $('mCode').value = c.code || '';
      $('mName').value = c.name || '';
      $('mFund').value = FUNDS.includes(c.fund) ? c.fund : '';
      syncFundHint(p);
    }
    // 기금 셀렉트: '' = 상위와 같음(상속)
    function buildFundSelect() {
      $('mFund').innerHTML = '<option value="">상위와 같음</option>'
        + FUNDS.map((f) => `<option value="${f}">${f}</option>`).join('');
    }
    // '상위와 같음'을 골랐을 때 실제로 무엇이 되는지 안내
    function syncFundHint(parent) {
      const inh = inheritedFund(parent);
      $('mFundHint').textContent = $('mFund').value
        ? '이 항목과 그 하위가 이 기금으로 집계됩니다.'
        : `상위와 같음 → 현재 ‘${inh}’ 로 집계됩니다.`;
    }
    function curParent() {
      if (editId) {
        const c = cats.find((x) => x.id === editId);
        return c && c.parentId ? cats.find((x) => x.id === c.parentId) : null;
      }
      return addParent;
    }
    function openModal(title, parentText) {
      $('mTitle').textContent = title;
      $('mParent').textContent = parentText || '';
      clearErr();
      if (!editId) {
        $('mCode').value = nextCode(); $('mName').value = '';
        $('mFund').value = '';
        syncFundHint(addParent);
      }
      $('mask').classList.add('on');
      setTimeout(() => $('mName').focus(), 50);
    }
    function closeModal() { $('mask').classList.remove('on'); editId = null; addParent = null; }
    function clearErr() {
      ['mCode', 'mName'].forEach((id) => $(id).classList.remove('invalid'));
      $('mCodeErr').classList.remove('show'); $('mNameErr').classList.remove('show');
    }
    function showErr(id, msg) {
      $(id).classList.add('invalid');
      const e = $(id + 'Err'); e.textContent = msg; e.classList.add('show');
    }

    async function save() {
      clearErr();
      const code = $('mCode').value.trim();
      const name = $('mName').value.trim();
      let bad = false;
      if (!/^\d+$/.test(code)) { showErr('mCode', '숫자 코드를 입력하세요.'); bad = true; }
      else if (cats.some((c) => Number(c.fy) === curFY && c.code === code && c.id !== editId)) { showErr('mCode', '이미 사용 중인 코드입니다.'); bad = true; }
      if (!name) { showErr('mName', '항목명을 입력하세요.'); bad = true; }
      if (bad) return;
      const fund = FUNDS.includes($('mFund').value) ? $('mFund').value : '';   // '' = 상위와 같음
      const btn = $('mSave'); btn.disabled = true; btn.textContent = '저장 중…';
      try {
        if (editId) {
          await updateDoc(doc(db, COL, editId), { code, name, fund, updatedAt: serverTimestamp() });
        } else {
          const level = addParent ? ((addParent.level || 1) + 1) : 1;
          await addDoc(collection(db, COL), {
            kind: KIND, fy: curFY, code, name, level,
            parentId: addParent ? addParent.id : null,
            fund,
            active: true,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
        }
        closeModal();
      } catch (e) {
        console.error(e); alert('저장에 실패했습니다. 다시 시도해 주세요.');
      } finally {
        btn.disabled = false; btn.textContent = '저장';
      }
    }

    // ---- 삭제 ----
    async function onDelete(id) {
      const c = cats.find((x) => x.id === id); if (!c) return;
      if (hasChildren(id)) {
        alert(`‘${c.name}’ 아래에 하위 항목이 있어 삭제할 수 없습니다.\n하위 항목을 먼저 삭제하세요.`);
        return;
      }
      if (!confirm(`‘${c.name}’ 항목을 삭제할까요?`)) return;
      try { await deleteDoc(doc(db, COL, id)); }
      catch (e) { console.error(e); alert('삭제에 실패했습니다.'); }
    }

    // ---- 이벤트 연결 ----
    buildFundSelect();
    $('mFund').onchange = () => syncFundHint(curParent());
    $('addTopBtn').onclick = openTop;
    $('fySel').onchange = onYearChange;
    $('renumBtn').onclick = renumberAll;
    $('clearAllBtn').onclick = clearAll;
    $('mCancel').onclick = closeModal;
    $('mSave').onclick = save;
    $('mask').addEventListener('click', (e) => { if (e.target === $('mask')) closeModal(); });
  