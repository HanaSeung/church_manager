
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, onSnapshot, doc, getDoc, writeBatch, serverTimestamp
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    const COL = 'finConfig';   // 수입/지출 항목 노드 공용 컬렉션
    const MIN_LEVEL = 3;       // 재정담당 이상

    const FUNDS = ['일반', '선교', '장학', '건축', '차량'];
    const DEFAULT_FUND = '일반';

    let cats = [];          // finConfig 전체 노드 (income + expense, 전 연도)
    let curFY = null;
    let curKind = 'income';  // 'income' | 'expense'
    let closeMonth = 12;
    let edited = {};        // { nodeId: 숫자 }  저장 전 변경분만
    let loaded = false;

    const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const codeNum = (c) => Number(String(c).replace(/[^0-9]/g, '')) || 0;
    const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');

    // 예산 입력 파서: 콤마·공백만 제거. 소수점은 들어올 일이 없다(사람이 직접 입력).
    const parseAmt = (s) => {
      const t = String(s == null ? '' : s).replace(/[,\s\u00A0₩원]/g, '');
      if (!t) return 0;
      if (!/^\d+$/.test(t)) return NaN;
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    };

    const fiscalYearOf = (d) => (d.getMonth() + 1) <= closeMonth ? d.getFullYear() : d.getFullYear() + 1;
    const currentFY = () => fiscalYearOf(new Date());

    // ---- 트리 도우미 (현재 회기 + 현재 종류) ----
    const inScope = () => cats.filter((c) => Number(c.fy) === curFY && c.kind === curKind);
    const childrenOf = (pid) => inScope()
      .filter((c) => (c.parentId || null) === (pid || null))
      .sort((a, b) => codeNum(a.code) - codeNum(b.code));
    const isLeaf = (id) => !inScope().some((c) => c.parentId === id);

    // 기금 상속 (income.html 과 동일 규칙)
    function fundOf(node, byId) {
      let n = node, guard = 0;
      while (n && guard++ < 10) {
        if (n.fund && FUNDS.includes(n.fund)) return n.fund;
        if (!n.parentId) break;
        n = byId[n.parentId];
      }
      return DEFAULT_FUND;
    }

    // 현재 화면상의 예산값 (수정 중이면 수정값, 아니면 저장값)
    const budgetOf = (c) => (Object.prototype.hasOwnProperty.call(edited, c.id)
      ? edited[c.id] : Number(c.budget || 0));

    // 상위 노드의 합계 = 하위 리프 예산의 총합 (예산은 리프에만 입력한다)
    function rollup(id) {
      if (isLeaf(id)) { const c = inScope().find((x) => x.id === id); return c ? budgetOf(c) : 0; }
      return childrenOf(id).reduce((s, c) => s + rollup(c.id), 0);
    }
    const grandTotal = () => childrenOf(null).reduce((s, c) => s + rollup(c.id), 0);

    // ---- 이름 경로 (다른 회기 복사 시 매칭 키) ----
    function pathOfIn(list, node) {
      const byId = {}; list.forEach((c) => { byId[c.id] = c; });
      const parts = []; let n = node, guard = 0;
      while (n && guard++ < 10) { parts.unshift(String(n.name || '').replace(/\s+/g, ' ').trim()); n = n.parentId ? byId[n.parentId] : null; }
      return parts.join(' › ');
    }

    $('backBtn').addEventListener('click', () => {
      if (dirtyCount() && !confirm('저장하지 않은 예산이 있습니다. 나갈까요?')) return;
      if (history.length > 1) history.back(); else location.href = 'offering.html';
    });

    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.replace('index.html'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const lv = snap.exists() ? (snap.data().level || 1) : 1;
        if (lv < MIN_LEVEL) { alert('예산 설정은 재정 담당자만 이용할 수 있습니다.'); location.replace('index.html'); return; }
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
      onSnapshot(collection(db, COL), (qs) => {
        cats = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => c.kind === 'income' || c.kind === 'expense');
        if (curFY == null) {
          const ys = [...new Set(cats.map((c) => Number(c.fy)).filter(Boolean))];
          curFY = ys.length ? Math.max(...ys) : currentFY();
        }
        loaded = true;
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
      $('fySel').innerHTML = arr.map((y) => `<option value="${y}"${y === curFY ? ' selected' : ''}>${y}년도</option>`).join('');
    }

    const dirtyCount = () => Object.keys(edited).length;

    function setKind(k) {
      if (k === curKind) return;
      if (dirtyCount() && !confirm('저장하지 않은 예산이 있습니다. 버리고 이동할까요?')) {
        return;
      }
      edited = {};
      curKind = k;
      $('tabInc').classList.toggle('on', k === 'income');
      $('tabExp').classList.toggle('on', k === 'expense');
      showMsg('');
      render();
    }

    function onYearChange() {
      const y = Number($('fySel').value);
      if (y === curFY) return;
      if (dirtyCount() && !confirm('저장하지 않은 예산이 있습니다. 버리고 이동할까요?')) {
        buildYearSelect(); return;
      }
      edited = {};
      curFY = y;
      showMsg('');
      render();
    }

    function showMsg(html) { $('msg').innerHTML = html || ''; }

    // ---- 렌더 ----
    function render() {
      if (!loaded) return;
      const list = inScope();
      const box = $('emptyBox');
      if (!list.length) {
        $('tree').innerHTML = '';
        box.style.display = 'block';
        box.textContent = `${curFY}년도에 등록된 ${curKind === 'income' ? '수입' : '지출'}항목이 없습니다. 항목 설정에서 먼저 항목을 만드세요.`;
        updateTotal();
        return;
      }
      box.style.display = 'none';
      const byId = {}; cats.forEach((c) => { byId[c.id] = c; });
      const rows = [];
      const walk = (pid, level) => {
        childrenOf(pid).forEach((c) => {
          rows.push(rowHtml(c, level, fundOf(c, byId)));
          walk(c.id, level + 1);
        });
      };
      walk(null, 1);
      $('tree').innerHTML = rows.join('');
      bindRows();
      updateTotal();
    }

    function rowHtml(c, level, fund) {
      const pad = level * 18;
      const leaf = isLeaf(c.id);
      const icon = level === 1 ? '📁' : (level === 2 ? '↳' : '·');
      const fundTag = (fund && fund !== DEFAULT_FUND) ? `<span class="fundtag">${esc(fund)}</span>` : '';
      // 예산은 리프에만 입력한다. 상위는 하위 합계를 회색으로 보여준다 (이중계상 방지)
      const right = leaf
        ? `<span class="t-amt"><input type="text" inputmode="numeric" data-bg="${c.id}" value="${budgetOf(c) ? fmt(budgetOf(c)) : ''}" placeholder="0"></span>`
        : `<span class="sum">${fmt(rollup(c.id))}</span>`;
      return `<div class="trow lvl${level}${leaf ? '' : ' grp'}">
        <span class="t-code">${esc(c.code)}</span>
        <span class="t-name" style="padding-left:${pad}px;">
          <span style="color:var(--muted); font-size:13px;">${icon}</span>
          <span class="nm">${esc(c.name)}</span>${fundTag}
        </span>
        ${right}
      </div>`;
    }

    function bindRows() {
      // 화면에 보이는 순서 = 트리 순서. 엔터로 이 순서대로 훑어 내려간다.
      // 수입·지출 탭은 각각 render() → bindRows() 를 다시 타므로 양쪽 모두 적용된다.
      const inputs = [...$('tree').querySelectorAll('[data-bg]')];
      inputs.forEach((inp, i) => {
        const last = (i === inputs.length - 1);
        inp.enterKeyHint = last ? 'done' : 'next';   // 폰 키보드의 엔터키 라벨
        inp.addEventListener('input', () => onAmtInput(inp));
        inp.addEventListener('blur', () => onAmtBlur(inp));
        inp.addEventListener('keydown', (e) => onAmtKey(e, inputs, i));
      });
    }

    // 엔터 = 다음 입력칸으로. 예산은 수십 칸을 연속으로 치는 작업이라 손이 마우스로 가면 안 된다.
    // ※ 다음 칸으로 focus 가 옮겨가면 blur 가 먼저 돌아 콤마가 정리된다(onAmtBlur).
    function onAmtKey(e, inputs, i) {
      const dir = e.key === 'Enter' ? 1 : (e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowUp' ? -1 : 0));
      if (!dir) return;
      e.preventDefault();
      const next = inputs[i + dir];
      if (!next) { inputs[i].blur(); return; }        // 끝이면 키보드를 내린다
      next.focus();
      next.select();                                  // 바로 덮어쓸 수 있게 전체 선택
      next.scrollIntoView({ block: 'center' });       // 폰에서 키보드에 가리지 않게
    }

    function onAmtInput(inp) {
      const id = inp.dataset.bg;
      const c = cats.find((x) => x.id === id); if (!c) return;
      const v = parseAmt(inp.value);
      if (Number.isNaN(v)) { inp.classList.remove('dirty'); showMsg('<span class="err">숫자만 입력하세요.</span>'); return; }
      showMsg('');
      const saved = Number(c.budget || 0);
      if (v === saved) delete edited[id]; else edited[id] = v;
      inp.classList.toggle('dirty', Object.prototype.hasOwnProperty.call(edited, id));
      refreshSums();
      updateTotal();
    }

    // 입력 중에는 콤마를 넣지 않는다(커서가 튄다). 포커스가 빠질 때만 정리한다.
    function onAmtBlur(inp) {
      const v = parseAmt(inp.value);
      if (Number.isNaN(v)) return;
      inp.value = v ? fmt(v) : '';
    }

    // 상위 합계 셀만 다시 그린다 (입력칸을 건드리면 포커스가 날아간다)
    function refreshSums() {
      const rows = $('tree').querySelectorAll('.trow');
      const ordered = [];
      const walk = (pid) => { childrenOf(pid).forEach((c) => { ordered.push(c); walk(c.id); }); };
      walk(null);
      rows.forEach((row, i) => {
        const c = ordered[i]; if (!c) return;
        const cell = row.querySelector('.sum');
        if (cell) cell.textContent = fmt(rollup(c.id));
      });
    }

    function updateTotal() {
      $('totBox').textContent = fmt(grandTotal());
      const n = dirtyCount();
      $('saveBtn').disabled = n === 0;
      $('saveBtn').textContent = n ? `저장 (${n})` : '저장';
    }

    // ---- 저장 (변경분만) ----
    async function save() {
      const ids = Object.keys(edited);
      if (!ids.length) return;
      const btn = $('saveBtn'); btn.disabled = true; btn.textContent = '저장 중…';
      try {
        for (let i = 0; i < ids.length; i += 400) {   // writeBatch 한도(500) 대비
          const batch = writeBatch(db);
          ids.slice(i, i + 400).forEach((id) => {
            batch.update(doc(db, COL, id), { budget: edited[id], updatedAt: serverTimestamp() });
          });
          await batch.commit();
        }
        const n = ids.length;
        edited = {};
        showMsg(`<span class="ok">${n}개 항목의 예산을 저장했습니다.</span>`);
        // onSnapshot 이 새 값을 실어 오면 render() 가 다시 돈다
      } catch (e) {
        console.error(e);
        showMsg('<span class="err">저장에 실패했습니다. 다시 시도해 주세요.</span>');
      } finally {
        updateTotal();
      }
    }

    // ---- 다른 회기 예산 복사 (이름 경로로 매칭) ----
    // code 는 재채번으로 바뀔 수 있으므로 믿지 않는다. 이름 경로가 안전하다.
    function copyFromYear() {
      const others = [...new Set(cats.filter((c) => c.kind === curKind).map((c) => Number(c.fy)))]
        .filter((y) => y && y !== curFY).sort((a, b) => b - a);
      if (!others.length) { alert('복사해 올 다른 회기가 없습니다.'); return; }
      let src = others[0];
      if (others.length > 1) {
        const inp = prompt('어느 회기의 예산을 복사할까요?\n(' + others.join(', ') + ')', String(others[0]));
        if (inp == null) return;
        src = Number(String(inp).trim());
        if (!others.includes(src)) { alert('목록에 없는 회기입니다.'); return; }
      }
      const srcList = cats.filter((c) => Number(c.fy) === src && c.kind === curKind);
      const srcMap = {};
      srcList.forEach((c) => { srcMap[pathOfIn(srcList, c)] = Number(c.budget || 0); });

      const dstList = inScope();
      let hit = 0, miss = 0;
      const next = {};
      dstList.forEach((c) => {
        if (!isLeaf(c.id)) return;                    // 예산은 리프에만
        const key = pathOfIn(dstList, c);
        if (!Object.prototype.hasOwnProperty.call(srcMap, key)) { miss++; return; }
        const v = srcMap[key];
        if (v !== Number(c.budget || 0)) next[c.id] = v;
        hit++;
      });
      if (!hit) { alert(`${src}년도와 이름이 같은 항목을 찾지 못했습니다.`); return; }
      if (!confirm(`${src}년도 예산을 ${curFY}년도로 불러올까요?\n· 이름이 일치한 항목 ${hit}개\n· 짝을 찾지 못한 항목 ${miss}개(그대로 둠)\n\n※ 아직 저장되지 않습니다. 확인 후 [저장]을 누르세요.`)) return;
      edited = { ...edited, ...next };
      showMsg(`<span class="ok">${src}년도 예산을 불러왔습니다. 확인 후 [저장]을 누르세요.</span>`);
      render();
    }

    // ---- 이벤트 ----
    $('tabInc').onclick = () => setKind('income');
    $('tabExp').onclick = () => setKind('expense');
    $('fySel').onchange = onYearChange;
    $('copyBtn').onclick = copyFromYear;
    $('saveBtn').onclick = save;
    window.addEventListener('beforeunload', (e) => {
      if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; }
    });
  