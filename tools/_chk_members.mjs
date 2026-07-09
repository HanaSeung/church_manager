
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, addDoc, getDoc, getDocs, doc, deleteDoc,
      updateDoc, serverTimestamp
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    let me = { uid: null, name: '', level: 1 };
    let allMembers = [];
    let currentFilter = 'all';
    let currentSort = localStorage.getItem('cm_members_sort') || 'name';
    let extraOpen = false, extraOpenHH = null;
    let editingId = null;
    let detailId = null;
    let overlayPushed = false;
    // 편집 중 선택된 참조(세대주/배우자)의 문서 id
    let pickHeadId = null, pickSpouseId = null, pickGuideId = null;

    const ROLE_GROUPS = {
      '목사': ['담임목사', '부목사', '소속목사', '원로목사'],
      '강도사': ['강도사'],
      '전도사': ['교육전도사', '교육사', '심방전도사', '전도사'],
      '장로': ['시무장로', '원로장로', '은퇴장로', '협동장로', '장로'],
      '안수집사': ['안수집사', '피택안수집사', '은퇴안수집사', '협동안수집사'],
      '권사': ['권사', '원로권사', '명예권사', '시무권사', '은퇴권사', '무임권사'],
      '집사': ['집사', '원로집사', '서리집사', '명예집사', '은퇴집사'],
      '성도': ['성도'],
      '선교사': ['선교사'],
      '사모': ['사모'],
    };
    const ROLE_CATS = Object.keys(ROLE_GROUPS);
    const OFFICER_CATS = ['목사', '장로', '안수집사', '권사'];
    function roleCatOf(sub) { return ROLE_CATS.find((c) => ROLE_GROUPS[c].includes(sub)) || ''; }
    function fillRoleCat(sel) { sel.innerHTML = ROLE_CATS.map((c) => `<option${c === '성도' ? ' selected' : ''}>${c}</option>`).join(''); }
    function fillRoleSub(sel, cat, pick) { sel.innerHTML = (ROLE_GROUPS[cat] || []).map((s) => `<option${s === pick ? ' selected' : ''}>${s}</option>`).join(''); }
    const padNo = (n) => (Number.isFinite(Number(n)) && Number(n) > 0) ? '#' + String(Number(n)).padStart(3, '0') : '';
    function roleRank(m) {
      const c = m.roleCat || roleCatOf(m.role) || '성도';
      const ci = ROLE_CATS.indexOf(c); const si = (ROLE_GROUPS[c] || []).indexOf(m.role);
      return [ci < 0 ? 99 : ci, si < 0 ? 99 : si];
    }
    function sortRows(rows) {
      const arr = rows.slice();
      if (currentSort === 'no') arr.sort((a, b) => (Number(a.memberNo) || 1e9) - (Number(b.memberNo) || 1e9));
      else if (currentSort === 'created') arr.sort((a, b) => ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0));
      else if (currentSort === 'role') arr.sort((a, b) => {
        const ra = roleRank(a), rb = roleRank(b);
        return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (a.name || '').localeCompare(b.name || '', 'ko');
      });
      else arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      return arr;
    }

    const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const initial = (name) => (name || '?').trim().charAt(0) || '?';
    const dot = (s) => (s || '').replace(/-/g, '.');

    function calcAge(birth) {
      const m = (birth || '').trim().match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
      if (!m) return null;
      const by = +m[1], bm = +m[2], bd = +m[3];
      const t = new Date();
      let age = t.getFullYear() - by;
      if ((t.getMonth() + 1) < bm || ((t.getMonth() + 1) === bm && t.getDate() < bd)) age--;
      return (age >= 0 && age < 130) ? age : null;
    }

    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.replace('index.html'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const lv = snap.exists() ? (snap.data().level || 1) : 1;
        if (lv < 4) { alert('성도 관리는 관리자만 이용할 수 있습니다.'); location.replace('index.html'); return; }
        me = { uid: user.uid, name: (snap.data().name || user.displayName || '관리자'), level: lv };
        fillRoleCat($('fRoleCat'));
        fillRoleSub($('fRole'), $('fRoleCat').value, '성도');
        $('fRoleCat').addEventListener('change', () => fillRoleSub($('fRole'), $('fRoleCat').value));
        loadMembers();
      } catch (e) {
        alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        location.replace('index.html');
      }
    });

    // 회원번호: 현재 최댓값 + 1 (없으면 1부터)
    function nextMemberNo() {
      let mx = 0;
      allMembers.forEach((m) => {
        const n = Number(m.memberNo);
        if (Number.isFinite(n) && n > mx) mx = n;
      });
      return mx + 1;
    }

    // 회원번호가 없는 성도에게 등록순(createdAt)으로 번호 일괄 부여
    async function assignAllMemberNos() {
      const has = (m) => Number.isFinite(Number(m.memberNo)) && Number(m.memberNo) > 0;
      const missing = allMembers.filter((m) => !has(m));
      if (missing.length === 0) { alert('모든 성도에게 이미 회원번호가 있습니다.'); return; }
      if (!confirm(`회원번호가 없는 성도 ${missing.length}명에게 등록순으로 번호를 부여할까요?`)) return;
      const ts = (m) => (m.createdAt && m.createdAt.seconds) ? m.createdAt.seconds : Number.MAX_SAFE_INTEGER;
      missing.sort((a, b) => ts(a) - ts(b));
      let start = 0;
      allMembers.forEach((m) => { const n = Number(m.memberNo); if (Number.isFinite(n) && n > start) start = n; });
      const btn = $('assignNoBtn');
      btn.disabled = true; btn.textContent = '부여 중…';
      try {
        let no = start;
        for (const m of missing) {
          no += 1;
          await updateDoc(doc(db, 'members', m.id), { memberNo: no });
        }
        await loadMembers();
        alert(`${missing.length}명에게 회원번호를 부여했습니다. (${start + 1}~${no}번)`);
      } catch (e) {
        alert('번호 부여 실패: ' + (e.code || e.message));
      } finally {
        btn.disabled = false; btn.textContent = '번호 일괄 부여';
      }
    }

    // ── 일괄 가져오기 (일회용, 관리자) ──
    let importParsed = null;
    const IMPORT_FIELDS = ['name', 'gender', 'birth', 'birthCal', 'phone', 'phoneHome', 'zipcode', 'address', 'addressDetail', 'email', 'regDate', 'regType', 'guide', 'prevChurch', 'grade', 'gradeDate', 'gradeChurch', 'officiant', 'roleCat', 'role', 'memberType', 'status', 'marriage', 'wedDate', 'spouseName', 'memo'];
    function importLog(msg, color) {
      $('importLog').innerHTML += `<div${color ? ` style="color:var(--${color});"` : ''}>${esc(msg)}</div>`;
    }
    $('importBtn').addEventListener('click', () => {
      const p = $('importPanel');
      p.style.display = (p.style.display === 'none') ? 'block' : 'none';
    });
    $('importPreviewBtn').addEventListener('click', () => {
      $('importLog').innerHTML = ''; importParsed = null; $('importRunBtn').disabled = true;
      let arr;
      try { arr = JSON.parse($('importText').value); }
      catch (e) { importLog('JSON 파싱 실패: ' + e.message, 'danger'); return; }
      if (!Array.isArray(arr) || !arr.length) { importLog('배열이 비어 있습니다.', 'danger'); return; }
      importParsed = arr;
      const heads = arr.filter((r) => r.headName).length;
      const spouses = arr.filter((r) => r.spouseName).length;
      importLog(`총 ${arr.length}명 · 세대주 연결 ${heads}건 · 배우자 연결 ${spouses}건`);
      importLog('“가져오기”를 누르면 등록을 시작합니다.');
      $('importRunBtn').disabled = false;
    });
    $('importRunBtn').addEventListener('click', async () => {
      if (!importParsed) return;
      if (!confirm(`${importParsed.length}명을 등록합니다. 계속할까요?`)) return;
      const btn = $('importRunBtn'); btn.disabled = true; $('importPreviewBtn').disabled = true;
      try {
        let no = nextMemberNo() - 1;
        const created = [];
        for (const r of importParsed) {
          no += 1;
          const base = {}; IMPORT_FIELDS.forEach((f) => { base[f] = (r[f] !== undefined && r[f] !== null) ? r[f] : ''; });
          base.prayers = Array.isArray(r.prayers) ? r.prayers : [];
          base.createdAt = serverTimestamp(); base.createdBy = me.uid; base.memberNo = no; base.updatedAt = serverTimestamp();
          const ref = await addDoc(collection(db, 'members'),
            { ...base, householdId: null, headId: null, headName: '', relation: r.relation || '' });
          created.push({ id: ref.id, name: r.name, relation: r.relation || '', headName: r.headName || '', spouseName: r.spouseName || '' });
        }
        importLog(`✓ 1단계 등록 완료 — ${created.length}명`, 'green');
        const nameToId = {};
        allMembers.forEach((m) => { if (m.name) nameToId[m.name] = m.id; });
        created.forEach((c) => { nameToId[c.name] = c.id; });
        let hc = 0, sc = 0;
        for (const c of created) {
          const patch = {};
          if (c.relation && c.relation !== '본인' && c.headName) {
            const hid = nameToId[c.headName];
            if (hid) { patch.headId = hid; patch.householdId = hid; patch.headName = c.headName; hc++; }
            else importLog(`⚠ 세대주 미발견: ${c.name} → ${c.headName}`, 'danger');
          } else {
            patch.householdId = c.id; patch.headId = c.id; patch.headName = ''; if (!c.relation) patch.relation = '본인';
          }
          if (c.spouseName) { const sid = nameToId[c.spouseName]; if (sid) { patch.spouseId = sid; sc++; } }
          if (Object.keys(patch).length) await updateDoc(doc(db, 'members', c.id), patch);
        }
        importLog(`✓ 2단계 세대주 연결 — ${hc}건`, 'green');
        importLog(`✓ 2단계 배우자 연결 — ${sc}건`, 'green');
        await loadMembers();
        importLog('완료. 목록을 새로고침했습니다.', 'green');
        $('importText').value = ''; importParsed = null;
      } catch (e) {
        importLog('실패: ' + (e.code || e.message), 'danger');
      } finally {
        btn.disabled = false; $('importPreviewBtn').disabled = false;
      }
    });

    async function loadMembers() {
      try {
        const qs = await getDocs(collection(db, 'members'));
        allMembers = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
        allMembers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
        renderList();
      } catch (e) {
        $('memberList').innerHTML = `<div class="empty">불러오지 못했습니다.<br>(${esc(e.code || e.message)})</div>`;
      }
    }

    function renderList() {
      const na = allMembers.filter((m) => m.archived).length;
      const ta = $('ftabArchived');
      ta.style.display = na ? '' : 'none';
      ta.textContent = '보관됨 ' + na;
      if (currentFilter === 'archived' && na === 0) {
        currentFilter = 'all';
        document.querySelectorAll('.ftab').forEach((x) => x.classList.toggle('ftab-on', x.dataset.filter === 'all'));
      }
      const live = allMembers.filter((m) => !m.archived);
      const catOf = (m) => m.roleCat || roleCatOf(m.role) || '성도';
      $('cntAll').textContent = live.length;
      $('cntNew').textContent = live.filter((m) => m.memberType === '새가족').length;
      $('cntOfficer').textContent = live.filter((m) => OFFICER_CATS.includes(catOf(m))).length;
      $('cntBaptized').textContent = live.filter((m) => m.memberType === '교인' && (m.grade === '세례' || m.grade === '입교')).length;
      $('cntMember').textContent = live.filter((m) => m.memberType === '교인').length;
      const kw = $('searchInput').value.trim().toLowerCase();
      let rows;
      if (currentFilter === 'archived') rows = allMembers.filter((m) => m.archived);
      else {
        rows = allMembers.filter((m) => !m.archived);
        if (currentFilter === 'new') rows = rows.filter((m) => m.memberType === '새가족');
        else if (currentFilter === 'officer') rows = rows.filter((m) => OFFICER_CATS.includes(m.roleCat || roleCatOf(m.role) || '성도'));
        else if (currentFilter === 'baptized') rows = rows.filter((m) => m.memberType === '교인' && (m.grade === '세례' || m.grade === '입교'));
        else if (currentFilter === 'member') rows = rows.filter((m) => m.memberType === '교인');
      }
      if (kw) rows = rows.filter((m) =>
        (m.name || '').toLowerCase().includes(kw) || (m.phone || '').includes(kw));
      rows = sortRows(rows);

      if (rows.length === 0) {
        $('memberList').innerHTML = `<div class="empty">${(kw || currentFilter !== 'all') ? '해당하는 성도가 없습니다.' : '아직 등록된 성도가 없습니다.<br>＋ 버튼으로 추가하세요.'}</div>`;
        return;
      }
      $('memberList').innerHTML = '';
      rows.forEach((m) => {
        const row = document.createElement('div');
        row.className = 'mrow';
        const isNew = m.memberType === '새가족';
        const sub = m.phone || (m.address ? m.address : '연락처 없음');
        row.innerHTML =
          `<div class="avatar">${esc(initial(m.name))}</div>
           <div style="flex:1; min-width:0;">
             <div style="display:flex; align-items:center; gap:7px;">
               ${padNo(m.memberNo) ? `<span style="font-size:12px; color:var(--muted); flex-shrink:0; font-family:monospace;">${padNo(m.memberNo)}</span>` : ''}
               <span style="font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.name || '(이름 없음)')}</span>
               ${m.role ? `<span class="badge">${esc(m.role)}</span>` : ''}
               ${isNew ? '<span class="badge badge-new">새가족</span>' : ''}
             </div>
             <div style="font-size:13px; color:var(--muted); margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(sub)}</div>
           </div>
           <span style="color:#c4c9c4; font-size:18px;">›</span>`;
        row.addEventListener('click', () => openDetail(m.id));
        $('memberList').appendChild(row);
      });
    }

    $('searchInput').addEventListener('input', renderList);
    $('sortSel').value = currentSort;
    $('sortSel').addEventListener('change', (e) => {
      currentSort = e.target.value;
      localStorage.setItem('cm_members_sort', currentSort);
      renderList();
    });
    document.querySelectorAll('.ftab').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.ftab').forEach((x) => x.classList.remove('ftab-on'));
        b.classList.add('ftab-on');
        currentFilter = b.dataset.filter;
        renderList();
      });
    });

    $('assignNoBtn').addEventListener('click', assignAllMemberNos);

    function openLayoutSheet() {
      const cur = getLayout();
      const ln = (w) => `<div style="height:4px; border-radius:2px; background:var(--line); width:${w};"></div>`;
      const dt = (c) => `<div style="width:14px; height:14px; border-radius:50%; background:${c || '#cfe0d7'};"></div>`;
      const bt = (f) => `<div style="flex:1; height:12px; border-radius:3px; background:${f ? 'var(--green)' : 'var(--line)'};"></div>`;
      const thumbs = {
        '1': `<div style="display:flex; flex-direction:column; align-items:center; gap:5px;">${dt()}${ln('50%')}<div style="display:flex; gap:4px; width:100%;">${bt()}${bt()}${bt()}${bt()}</div><div style="width:100%; display:flex; flex-direction:column; gap:4px; margin-top:2px;">${ln('90%')}${ln('80%')}${ln('85%')}</div></div>`,
        '2': `<div style="display:flex; flex-direction:column; gap:5px;"><div style="height:20px; border-radius:5px; background:var(--green); display:flex; align-items:center; padding:0 5px; gap:4px;"><div style="width:11px; height:11px; border-radius:50%; background:rgba(255,255,255,.33);"></div><div style="height:4px; width:40%; background:rgba(255,255,255,.47); border-radius:2px;"></div></div><div style="display:flex; gap:4px;"><div style="flex:1; height:20px; background:var(--bg); border-radius:4px;"></div><div style="flex:1; height:20px; background:var(--bg); border-radius:4px;"></div><div style="flex:1; height:20px; background:var(--bg); border-radius:4px;"></div></div><div style="border:1px solid var(--line); border-radius:5px; padding:5px; display:flex; flex-direction:column; gap:4px;">${ln('80%')}${ln('70%')}</div></div>`,
        '3': `<div style="display:flex; flex-direction:column; align-items:center; gap:5px;">${dt()}${ln('45%')}<div style="width:100%; border:1px solid var(--line); border-radius:5px; padding:5px; display:flex; flex-direction:column; gap:6px; margin-top:2px;"><div style="display:flex; gap:6px; align-items:center;">${dt('var(--green-soft)')}${ln('70%')}</div><div style="display:flex; gap:6px; align-items:center;">${dt('var(--green-soft)')}${ln('60%')}</div><div style="display:flex; gap:6px; align-items:center;">${dt('var(--green-soft)')}${ln('75%')}</div></div></div>`,
        '4': `<div style="display:flex; flex-direction:column; align-items:center; gap:5px;">${dt()}<div style="display:flex; gap:4px; width:100%;">${bt(1)}${bt()}${bt()}${bt()}</div><div style="width:100%; border:1px solid var(--line); border-radius:5px; padding:5px; display:flex; flex-direction:column; gap:6px;"><div style="display:flex; gap:6px; align-items:center;">${dt('var(--green-soft)')}${ln('70%')}</div><div style="display:flex; gap:6px; align-items:center;">${dt('var(--green-soft)')}${ln('65%')}</div></div></div>`,
      };
      $('layoutList').innerHTML = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:14px;">${Object.entries(DETAIL_LAYOUTS).map(([n, t]) => {
        const on = n === cur;
        return `<div data-lay="${n}" style="border:${on ? '2px solid var(--green)' : '1px solid var(--line)'}; border-radius:10px; overflow:hidden; background:var(--card); cursor:pointer;">
          <div style="height:96px; background:var(--bg); padding:9px; overflow:hidden;">${thumbs[n]}</div>
          <div style="display:flex; align-items:center; gap:5px; padding:7px 9px; border-top:1px solid var(--line); ${on ? 'background:var(--green-soft);' : ''}">
            <span style="width:17px; height:17px; border-radius:50%; background:${on ? 'var(--green)' : '#eceeea'}; color:${on ? '#fff' : 'var(--muted)'}; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0;">${n}</span>
            <span style="flex:1; font-size:12px; color:var(--text); ${on ? 'font-weight:700;' : ''}">${t.replace(' (액션+리스트)', '')}${n === '1' ? ' · 기본' : ''}</span>
            ${on ? '<span style="color:var(--green); font-size:14px;">✓</span>' : ''}</div></div>`;
      }).join('')}</div>`;
      $('layoutBk').style.display = 'flex';
    }
    $('layoutBtn').addEventListener('click', openLayoutSheet);
    $('layoutList').addEventListener('click', (e) => {
      const r = e.target.closest('[data-lay]'); if (!r) return;
      localStorage.setItem('cm_detail_layout', r.dataset.lay);
      $('layoutBk').style.display = 'none';
      if (detailId) openDetail(detailId);
    });
    $('layoutClose').addEventListener('click', () => { $('layoutBk').style.display = 'none'; });
    $('layoutBk').addEventListener('click', (e) => { if (e.target === $('layoutBk')) $('layoutBk').style.display = 'none'; });

    const BADGE_GRADE = (m) => {
      if (!m.grade) return '';
      return m.grade + (m.gradeDate ? ' · ' + dot(m.gradeDate) : '');
    };
    function drow(k, v) {
      if (!v) return '';
      return `<div class="drow"><div class="dk">${k}</div><div class="dv">${v}</div></div>`;
    }
    let _relRank = null;
    function relRank(rel) {
      if (!_relRank) {
        _relRank = {};
        document.querySelectorAll('#fRel option').forEach((o, i) => { _relRank[o.value] = i; });
      }
      const k = (rel || '').replace('(세대주)', '');
      return (k in _relRank) ? _relRank[k] : 999;
    }
    function relLabel(rel) { const k = (rel || '').replace('(세대주)', ''); return k === '본인' ? '세대주' : k; }
    function householdMembers(m) {
      if (!m.householdId) return [];
      return allMembers.filter((x) => x.householdId === m.householdId)
        .sort((a, b) => relRank(a.relation) - relRank(b.relation) || (a.name || '').localeCompare(b.name || '', 'ko'));
    }

    // ── 상세화면 디자인(레이아웃) ──
    const DETAIL_LAYOUTS = { '1': '액션 우선형', '2': '요약 카드형', '3': '아이콘 리스트형', '4': '추천안 (액션+리스트)' };
    function getLayout() { const v = localStorage.getItem('cm_detail_layout') || '1'; return DETAIL_LAYOUTS[v] ? v : '1'; }
    const telClean = (v) => (v || '').replace(/[^0-9+]/g, '');
    function mapUrl(m) { const a = [m.address, m.addressDetail].filter(Boolean).join(' '); return a ? 'https://map.kakao.com/link/search/' + encodeURIComponent(a) : ''; }
    const ICONS = {
      phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
      message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
      map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
      mobile: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
      cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3M12 8v3M17 8v3"/><path d="M7 4h.01M12 4h.01M17 4h.01"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
      award: '<circle cx="12" cy="8" r="6"/><path d="M8.21 13.89 7 23l5-3 5 3-1.21-9.12"/>',
      church: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      guide: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
      user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>',
    };
    function svg(name, size) {
      const s = size || 20;
      return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    }

    function dIdentity(m) {
      const age = calcAge(m.birth);
      const top = [m.gender, (age != null ? age + '세' : null), m.memberType, m.status].filter(Boolean).join(' · ');
      return `<div style="text-align:center; margin-bottom:14px;">
        <div class="avatar" style="width:66px; height:66px; font-size:26px; margin:0 auto 8px;">${esc(initial(m.name))}</div>
        <div style="font-size:19px; font-weight:700;">${esc(m.name || '(이름 없음)')}${m.role ? ` <span class="badge" style="vertical-align:3px;">${esc(m.role)}</span>` : ''}${m.memberType === '새가족' ? ' <span class="badge badge-new" style="vertical-align:3px;">새가족</span>' : ''}</div>
        <div style="font-size:13px; color:var(--muted); margin-top:3px;">${esc(top)}</div></div>`;
    }
    function dIdentityGreen(m) {
      const age = calcAge(m.birth);
      const meta = [m.role, m.gender, (age != null ? age + '세' : null), m.status].filter(Boolean).join(' · ');
      return `<div style="background:var(--green); border-radius:14px; padding:16px; color:#fff; display:flex; align-items:center; gap:12px; margin-bottom:10px;">
        <div style="width:54px; height:54px; border-radius:50%; background:rgba(255,255,255,.18); color:#fff; font-size:22px; font-weight:700; display:flex; align-items:center; justify-content:center;">${esc(initial(m.name))}</div>
        <div><div style="font-size:19px; font-weight:700;">${esc(m.name || '(이름 없음)')}</div><div style="font-size:12px; color:#d7e7df; margin-top:2px;">${esc(meta)}</div></div></div>`;
    }
    function dActions(m, primaryPhone) {
      const tel = m.phone || m.phoneHome; const map = mapUrl(m);
      const cell = (href, icon, label, primary) => {
        const on = !!href;
        const box = (primary && on) ? 'background:var(--green); color:#fff;' : 'background:var(--card); border:1px solid var(--line); color:var(--green);';
        return `<a ${on ? `href="${href}"` : ''} style="flex:1; text-decoration:none; ${on ? '' : 'opacity:.35; pointer-events:none;'}">
          <div style="height:44px; ${box} border-radius:11px; display:flex; align-items:center; justify-content:center;">${svg(icon)}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:4px; text-align:center;">${label}</div></a>`;
      };
      return `<div style="display:flex; gap:8px; margin:2px 0 14px;">
        ${cell(tel ? 'tel:' + telClean(tel) : '', 'phone', '전화', primaryPhone)}
        ${cell(tel ? 'sms:' + telClean(tel) : '', 'message', '문자', false)}
        ${cell(m.email ? 'mailto:' + m.email : '', 'mail', '메일', false)}
        ${cell(map, 'map', '지도', false)}</div>`;
    }
    function dFields(m) {
      const age = calcAge(m.birth);
      const birthTxt = m.birth ? (m.birth + (m.birthCal === 'lunar' ? ' (음)' : '') + (age != null ? ` · 만 ${age}세` : '')) : '';
      const addr = [m.zipcode ? '(' + m.zipcode + ')' : '', m.address, m.addressDetail].filter(Boolean).join(' ');
      const reg = [dot(m.regDate), m.regType].filter(Boolean).join(' · ');
      const wed = [m.marriage, dot(m.wedDate)].filter(Boolean).join(' · ');
      const core = [
        ['mobile', '휴대폰', m.phone || ''], ['cake', '생일', birthTxt], ['map', '주소', addr],
        ['calendar', '등록', reg], ['award', '신급', BADGE_GRADE(m)], ['heart', '결혼', wed],
      ];
      const extra = [
        ['phone', '집전화', m.phoneHome], ['mail', '이메일', m.email],
        ['church', '이전교회', m.prevChurch], ['church', '옮긴교회', m.movedChurch], ['guide', '인도자', m.guide],
        ['church', '신급교회', m.gradeChurch], ['user', '집례자', m.officiant],
        ['calendar', '임명일', dot(m.roleDate)], ['church', '임직교회', m.roleChurch],
      ];
      return { core, extra };
    }
    function dIconCard(m) {
      const { core, extra } = dFields(m);
      const row = (r, top, muted) => `<div style="display:flex; align-items:center; gap:11px; padding:11px 14px; ${top ? 'border-top:1px solid var(--line);' : ''}">
          <span style="width:20px; color:var(--green); display:flex; align-items:center; justify-content:center; flex-shrink:0;">${svg(r[0], 18)}</span>
          <span style="font-size:12px; color:var(--muted); width:52px; flex-shrink:0;">${r[1]}</span>
          <span style="flex:1; font-size:14px; color:${muted ? 'var(--muted)' : 'var(--text)'};">${esc(r[2] || '—')}</span></div>`;
      const coreHtml = core.map((r, i) => row(r, i > 0, !r[2])).join('');
      const extraHtml = extra.map((r) => row(r, true, !r[2])).join('');
      return `<div style="background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden;">
        ${coreHtml}
        <div id="extraFields" style="display:none;">${extraHtml}</div>
        <div id="extraToggle" style="display:flex; align-items:center; justify-content:center; gap:5px; padding:9px; border-top:1px solid var(--line); color:var(--green); font-size:13px; cursor:pointer;"><span id="extraToggleLabel">전체 보기</span><span id="extraToggleArrow" style="font-size:11px;">▾</span></div>
      </div>`;
    }
    function dSummaryTiles(m) {
      const yr = (m.regDate || '').slice(0, 4);
      const tiles = [['신급', m.grade || '—'], ['등록', yr || '—'], ['상태', m.status || '—']];
      return `<div style="display:flex; gap:8px; margin-bottom:10px;">${tiles.map((t) =>
        `<div style="flex:1; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; text-align:center;"><div style="font-size:11px; color:var(--muted);">${t[0]}</div><div style="font-size:14px; font-weight:700; color:var(--text); margin-top:2px;">${esc(t[1])}</div></div>`).join('')}</div>`;
    }
    function dFamilyChips(m) {
      const fam = householdMembers(m);
      if (!(fam.length > 1 || (m.relation && m.relation !== ''))) return '';
      const chips = fam.map((x) => {
        const self = x.id === m.id;
        const style = self ? 'background:var(--green); color:#fff; font-weight:700;' : 'background:var(--bg); opacity:.55; cursor:pointer;';
        return `<span ${self ? '' : `data-openid="${x.id}"`} style="font-size:12.5px; padding:4px 10px; border-radius:99px; ${style}">${esc(x.name)}${relLabel(x.relation) ? ' · ' + esc(relLabel(x.relation)) : ''}</span>`;
      }).join(' ');
      return `<div style="margin-top:10px;"><div style="font-size:12px; color:var(--muted); margin-bottom:7px;">가정 구성원</div><div style="display:flex; gap:7px; flex-wrap:wrap;">${chips || '—'}</div></div>`;
    }
    function dFamilyCard(m) {
      const fam = householdMembers(m);
      if (!(fam.length > 1 || (m.relation && m.relation !== ''))) return '';
      return `<div style="font-size:12px; color:var(--muted); margin:14px 4px 6px;">가정 구성원</div>
        <div style="background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden;">${fam.map((x, i) => {
          const self = x.id === m.id; const relD = relLabel(x.relation);
          const kage = calcAge(x.birth); const relTxt = relD + ((kage != null && /아들|딸|손자|손녀/.test(relD)) ? ` · ${kage}세` : '');
          const av = self ? 'background:var(--green); color:#fff;' : 'background:var(--green-soft); color:var(--green);';
          return `<div ${self ? '' : `data-openid="${x.id}"`} style="display:flex; align-items:center; gap:11px; padding:11px 14px; ${i ? 'border-top:1px solid var(--line);' : ''} ${self ? 'background:var(--green-soft);' : 'opacity:.55; cursor:pointer;'}">
            <span style="width:30px; height:30px; border-radius:50%; ${av} font-size:12px; display:flex; align-items:center; justify-content:center;">${esc(initial(x.name))}</span>
            <span style="flex:1; font-size:14px; color:var(--text); ${self ? 'font-weight:700;' : ''}">${esc(x.name)}</span>
            <span style="font-size:12px; color:var(--muted);">${esc(relTxt)}</span></div>`;
        }).join('')}</div>`;
    }
    function dColsBody(m) {
      const age = calcAge(m.birth);
      const birthTxt = m.birth ? (esc(m.birth) + (m.birthCal === 'lunar' ? ' (음)' : '') + (age != null ? ` · 만 ${age}세` : '')) : '';
      return `<div class="dsec">기본</div>
         ${drow('휴대폰', m.phone ? `<a href="tel:${esc(telClean(m.phone))}" style="color:var(--green); text-decoration:none;">${esc(m.phone)}</a>` : '')}
         ${drow('집전화', m.phoneHome ? `<a href="tel:${esc(telClean(m.phoneHome))}" style="color:var(--green); text-decoration:none;">${esc(m.phoneHome)}</a>` : '')}
         ${drow('생일', birthTxt)}
         ${drow('이메일', esc(m.email))}
         ${drow('주소', esc([m.zipcode ? '(' + m.zipcode + ')' : '', m.address, m.addressDetail].filter(Boolean).join(' ')))}
         <div class="dsec">등록</div>
         ${drow('등록일', esc(dot(m.regDate)))}
         ${drow('등록배경', esc(m.regType))}
         ${drow('인도자', esc(m.guide))}
         ${drow('이전교회', esc(m.prevChurch))}
         ${drow('옮긴교회', esc(m.movedChurch))}
         ${drow('신급', esc(BADGE_GRADE(m)))}
         ${drow('신급교회', esc(m.gradeChurch))}
         ${drow('집례자', esc(m.officiant))}
         ${drow('임명일', esc(dot(m.roleDate)))}
         ${drow('임직교회', esc(m.roleChurch))}
         <div class="dsec">가족</div>
         ${drow('결혼관계', esc(m.marriage))}
         ${drow('결혼일', esc(dot(m.wedDate)))}
         ${drow('배우자', esc(m.spouseName))}
         ${dFamilyChips(m)}`;
    }
    function dMemoPrayers(m) {
      return `${m.memo ? `<div class="dsec">메모</div><div style="font-size:14px; color:var(--text); white-space:pre-wrap; padding-top:6px;">${esc(m.memo)}</div>` : ''}
         ${(Array.isArray(m.prayers) && m.prayers.length) ? `<div class="dsec">기도제목</div>${[...m.prayers].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => `<div style="padding:7px 0; border-top:1px solid var(--line);"><span style="font-size:12px; color:var(--muted); margin-right:8px;">${esc(p.date || '')}</span><span style="font-size:14px; color:var(--text); white-space:pre-wrap;">${esc(p.text || '')}</span></div>`).join('')}` : ''}`;
    }
    function dFooter(m) {
      return `${m.archived
        ? `<div style="background:var(--amber-soft); color:var(--amber-text); border-radius:8px; padding:8px 12px; font-size:13px; text-align:center; margin-top:22px;">보관됨 · 명부 목록에서 숨겨진 상태입니다.</div>
           <button id="dRestore" class="btn-line" style="width:100%; height:46px; margin-top:10px; color:var(--green); border-color:var(--green);">명부로 복원</button>`
        : `<button id="dArchive" class="btn-line" style="width:100%; height:46px; margin-top:22px;">명부에서 숨김</button>`}
         <div style="text-align:center; margin-top:14px;">
           <span id="dHardDelete" style="font-size:13px; color:var(--danger); cursor:pointer; border-bottom:1px solid #e7c9c4;">완전 삭제</span>
           <div style="font-size:11px; color:var(--muted); margin-top:4px;">되돌릴 수 없음 · 참조·헌금 확인 후</div></div>`;
    }
    function renderDetailBody(m) {
      const L = getLayout();
      if (L === '2') return dIdentityGreen(m) + dSummaryTiles(m) + dIconCard(m) + dFamilyCard(m);
      if (L === '3') return dIdentity(m) + dIconCard(m) + dFamilyCard(m);
      if (L === '4') return dIdentity(m) + dActions(m, true) + dIconCard(m) + dFamilyCard(m);
      return dIdentity(m) + dActions(m, false) + dColsBody(m);
    }

    function openDetail(id) {
      const m = allMembers.find((x) => x.id === id);
      if (!m) return;
      detailId = id;
      const hh = m.householdId || m.id;
      if (hh !== extraOpenHH) { extraOpen = false; extraOpenHH = hh; }
      $('detailView').innerHTML = renderDetailBody(m) + dMemoPrayers(m) + dFooter(m);
      if (m.archived) $('dRestore').addEventListener('click', () => restoreMember(id));
      else $('dArchive').addEventListener('click', () => archiveMember(id));
      $('dHardDelete').addEventListener('click', () => hardDeleteMember(id));
      $('detailView').querySelectorAll('[data-openid]').forEach((el) =>
        el.addEventListener('click', () => openDetail(el.dataset.openid)));
      const et = $('extraToggle');
      if (et) {
        if (extraOpen) {
          $('extraFields').style.display = '';
          $('extraToggleLabel').textContent = '접기';
          $('extraToggleArrow').textContent = '▴';
        }
        et.addEventListener('click', () => {
          const nowOpen = $('extraFields').style.display === 'none';
          $('extraFields').style.display = nowOpen ? '' : 'none';
          $('extraToggleLabel').textContent = nowOpen ? '접기' : '전체 보기';
          $('extraToggleArrow').textContent = nowOpen ? '▴' : '▾';
          extraOpen = nowOpen;
        });
      }
      show('detail');
    }

    function setAcc(open1) {
      ['acc1', 'acc2', 'acc3', 'acc4', 'acc5'].forEach((a, i) => {
        const el = $(a);
        if (i === 0 && open1) el.classList.add('open'); else el.classList.remove('open');
        const s = el.querySelector('.h-s');
        s.firstChild.textContent = el.classList.contains('open') ? '접기 ' : '펼치기 ';
      });
    }

    function openEdit(id) {
      editingId = id;
      const m = id ? allMembers.find((x) => x.id === id) : null;
      $('fName').value = m?.name || '';
      $('fGender').value = m?.gender || '';
      $('fBirth').value = m?.birth || '';
      $('fBirthCal').value = m?.birthCal || 'solar';
      $('fPhone').value = fmtPhone(m?.phone || '');
      $('fPhone').classList.remove('invalid'); $('ePhoneErr').classList.remove('show');
      $('fPhoneHome').value = fmtPhone(m?.phoneHome || '');
      $('fPhoneHome').classList.remove('invalid'); $('ePhoneHomeErr').classList.remove('show');
      $('fZip').value = m?.zipcode || '';
      $('fAddress').value = m?.address || '';
      $('fAddressDetail').value = m?.addressDetail || '';
      setEmailFields(m?.email || '');
      $('fRegDate').value = m?.regDate || new Date().toISOString().slice(0, 10);
      $('fRegType').value = m?.regType || '';
      $('fGuide').value = m?.guide || '';
      $('fPrev').value = m?.prevChurch || '';
      $('fMoved').value = m?.movedChurch || '';
      $('fGrade').value = m?.grade || '';
      $('fGradeDate').value = m?.gradeDate || '';
      $('fGradeChurch').value = m?.gradeChurch || '';
      $('fOfficiant').value = m?.officiant || '';
      { const rc = m?.roleCat || roleCatOf(m?.role) || '성도';
        $('fRoleCat').value = rc;
        fillRoleSub($('fRole'), rc, m?.role || (ROLE_GROUPS[rc] || [])[0] || '성도'); }
      $('fRoleDate').value = m?.roleDate || '';
      $('fRoleChurch').value = m?.roleChurch || '';
      $('fType').value = m?.memberType || '교인';
      $('fStatus').value = m?.status || '예배출석';
      $('fHead').value = m?.headName || '';
      $('fRel').value = m?.relation || '';
      if (m && !$('fHead').value && ((m.headId && m.headId === m.id) || m.relation === '본인')) {
        $('fHead').value = m.name || '';
      }
      $('fMarriage').value = m?.marriage || '';
      $('fWed').value = m?.wedDate || '';
      $('fSpouse').value = m?.spouseName || '';
      $('fMemo').value = m?.memo || '';
      loadPrayers(m?.prayers);
      pickHeadId = m?.headId || null;
      pickSpouseId = m?.spouseId || null;
      const _headM = m?.headId ? allMembers.find((x) => x.id === m.headId) : null;
      setHeadBadge(_headM ? _headM.memberNo : null);
      const _spouseM = m?.spouseId ? allMembers.find((x) => x.id === m.spouseId) : null;
      setSpouseBadge(_spouseM ? _spouseM.memberNo : null);
      pickGuideId = m?.guideId || null;
      const _guideM = m?.guideId ? allMembers.find((x) => x.id === m.guideId) : null;
      setGuideBadge(_guideM ? _guideM.memberNo : null);
      $('dupHint').className = 'hint'; $('dupHint').textContent = '';
      $('editMsg').style.display = 'none';
      updateAge();
      setAcc(true);
      show('edit');
    }

    // 생일 자동 하이픈: 8자리→YYYY-MM-DD, 4자리→MM-DD(연도 모름)
    function fmtBirth(v) {
      const d = (v || '').replace(/\D/g, '').slice(0, 8);
      if (d.length <= 4) return d;
      if (d.length <= 6) return d.slice(0, 4) + '-' + d.slice(4);
      return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    }
    function fmtBirthBlur(v) {
      const d = (v || '').replace(/\D/g, '');
      if (d.length === 4) return d.slice(0, 2) + '-' + d.slice(2);
      return fmtBirth(v);
    }
    function updateAge() {
      const a = calcAge($('fBirth').value);
      $('ageBox').textContent = (a != null) ? (a + '세') : '–';
    }
    $('fBirth').addEventListener('input', (e) => { e.target.value = fmtBirth(e.target.value); updateAge(); });
    $('fBirth').addEventListener('blur', (e) => { e.target.value = fmtBirthBlur(e.target.value); updateAge(); });

    // 임명일: 숫자 8자리 → blur/엔터 시 YYYY-MM-DD, 달력 버튼은 네이티브 선택기
    function dateOk(v) {
      v = (v || '').trim(); if (!v) return true;
      const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!mm) return false;
      const y = +mm[1], mo = +mm[2], d = +mm[3];
      const dt = new Date(y, mo - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
    }
    function normRoleDate(v) {
      const digits = (v || '').replace(/\D/g, '');
      if (digits === '') return { val: '', ok: true };
      if (digits.length !== 8) return { val: '', ok: false };
      const f = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
      return dateOk(f) ? { val: f, ok: true } : { val: '', ok: false };
    }
    function applyRoleDate() {
      const r = normRoleDate($('fRoleDate').value);
      $('fRoleDate').value = r.val;
      $('fRoleDate').classList.toggle('invalid', !r.ok);
      $('eRoleDateErr').classList.toggle('show', !r.ok);
      return r;
    }
    $('fRoleDate').addEventListener('blur', applyRoleDate);
    $('fRoleDate').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    $('fRoleDate').addEventListener('input', () => { $('fRoleDate').classList.remove('invalid'); $('eRoleDateErr').classList.remove('show'); });
    $('fRoleDateCal').addEventListener('click', () => {
      const p = $('fRoleDatePick');
      p.value = /^\d{4}-\d{2}-\d{2}$/.test($('fRoleDate').value) ? $('fRoleDate').value : '';
      if (p.showPicker) { try { p.showPicker(); } catch (_) { p.click(); } } else { p.click(); }
    });
    $('fRoleDatePick').addEventListener('change', () => { if ($('fRoleDatePick').value) { $('fRoleDate').value = $('fRoleDatePick').value; $('fRoleDate').classList.remove('invalid'); $('eRoleDateErr').classList.remove('show'); } });

    // 공용 날짜 입력: 숫자 입력 → blur/엔터 시 하이픈, 무효면 값 비우고 경고, 달력 버튼 병행
    const CAL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
    function normDateStr(v, precision) {
      const digits = (v || '').replace(/\D/g, '');
      const need = precision === 'month' ? 6 : 8;
      if (digits === '') return { val: '', ok: true };
      if (digits.length !== need) return { val: '', ok: false };
      if (precision === 'month') {
        const mo = +digits.slice(4, 6);
        return (mo >= 1 && mo <= 12) ? { val: digits.slice(0, 4) + '-' + digits.slice(4, 6), ok: true } : { val: '', ok: false };
      }
      const f = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
      return dateOk(f) ? { val: f, ok: true } : { val: '', ok: false };
    }
    function setupDateInput(id, errId, calId, pickId, precision) {
      const inp = $(id), err = $(errId), cal = $(calId), pick = $(pickId);
      const re = precision === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
      function apply() {
        const r = normDateStr(inp.value, precision);
        inp.value = r.val;
        inp.classList.toggle('invalid', !r.ok);
        err.classList.toggle('show', !r.ok);
        return r;
      }
      inp.addEventListener('blur', apply);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('input', () => { inp.classList.remove('invalid'); err.classList.remove('show'); });
      if (cal && pick) {
        cal.innerHTML = CAL_SVG;
        cal.addEventListener('click', () => {
          pick.value = re.test(inp.value) ? inp.value : '';
          if (pick.showPicker) { try { pick.showPicker(); } catch (_) { pick.click(); } } else { pick.click(); }
        });
        pick.addEventListener('change', () => { if (pick.value) { inp.value = pick.value; inp.classList.remove('invalid'); err.classList.remove('show'); } });
      }
      return apply;
    }
    const applyRegDate = setupDateInput('fRegDate', 'eRegDateErr', 'fRegDateCal', 'fRegDatePick', 'date');
    const applyGradeDate = setupDateInput('fGradeDate', 'eGradeDateErr', 'fGradeDateCal', 'fGradeDatePick', 'month');
    const applyWedDate = setupDateInput('fWed', 'eWedErr', 'fWedCal', 'fWedPick', 'month');
    const applyPrayDate = setupDateInput('fPrayDate', 'ePrayDateErr', 'prayDateCal', 'prayDatePick', 'date');

    // ── 기도제목 (날짜별) ──
    let prayers = [];          // [{date, text}]
    let prayShow = 3;          // 표시 개수
    let prayEdit = -1;         // 인라인 수정 중 원본 인덱스
    let prayOpen = new Set();  // 펼쳐진 원본 인덱스
    function prayToday() { return new Date().toISOString().slice(0, 10); }
    function sortedPrayers() {
      return prayers.map((p, i) => ({ p, i })).sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
    }
    function renderPrayers() {
      const list = $('prayList'); const arr = sortedPrayers();
      if (arr.length === 0) {
        list.innerHTML = '<div class="hint" style="margin-top:0;">등록된 기도제목이 없습니다.</div>';
        $('prayMoreWrap').style.display = 'none'; return;
      }
      const shown = arr.slice(0, prayShow);
      list.innerHTML = shown.map(({ p, i }) => {
        if (prayEdit === i) {
          return `<div class="pray-row"><div style="display:flex; gap:6px; align-items:center; padding:7px 9px;">
            <input type="date" id="prayEditDate" value="${esc(p.date || '')}" style="width:148px; flex-shrink:0; height:38px;">
            <input type="text" id="prayEditText" value="${esc(p.text || '')}" style="flex:1; min-width:0; height:38px;">
            <button class="btn-line" data-act="savep" data-i="${i}" style="padding:0 10px; height:38px;">확인</button>
            <button class="btn-line" data-act="cancelp" style="padding:0 10px; height:38px;">취소</button>
          </div></div>`;
        }
        const open = prayOpen.has(i);
        const first = esc((p.text || '').split('\n')[0]);
        return `<div class="pray-row"><div style="display:flex; align-items:center; gap:8px; padding:9px 10px;">
          <span class="pray-tog" data-i="${i}" style="cursor:pointer; color:var(--muted); width:14px; flex-shrink:0; text-align:center;">${open ? '▾' : '▸'}</span>
          <span style="font-size:12px; color:var(--muted); width:74px; flex-shrink:0;">${esc(p.date || '')}</span>
          <span class="pray-tog" data-i="${i}" style="flex:1; min-width:0; font-size:13px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${first}</span>
          <button class="btn-line" data-act="editp" data-i="${i}" style="padding:2px 8px; font-size:12px;">수정</button>
          <button class="btn-line" data-act="delp" data-i="${i}" style="padding:2px 8px; font-size:12px;">삭제</button>
        </div>${open ? `<div class="pray-full">${esc(p.text || '')}</div>` : ''}</div>`;
      }).join('');
      if (arr.length > 3) {
        $('prayMoreWrap').style.display = 'block';
        $('prayMoreBtn').textContent = (prayShow >= arr.length) ? '접기' : '더 보기';
      } else { $('prayMoreWrap').style.display = 'none'; }
    }
    function loadPrayers(src) {
      prayers = Array.isArray(src) ? src.map((p) => ({ date: p.date || '', text: p.text || '' })) : [];
      prayShow = 3; prayEdit = -1; prayOpen = new Set();
      $('fPrayDate').value = prayToday(); $('fPrayText').value = '';
      renderPrayers();
    }
    $('prayAddBtn').addEventListener('click', () => {
      applyPrayDate();
      const t = $('fPrayText').value.trim();
      if (!t) { alert('기도제목 내용을 입력하세요.'); return; }
      prayers.push({ date: $('fPrayDate').value || prayToday(), text: t });
      $('fPrayText').value = ''; $('fPrayDate').value = prayToday();
      renderPrayers();
    });
    $('prayMoreBtn').addEventListener('click', () => {
      const total = prayers.length;
      if (prayShow >= total) prayShow = 3;
      else if (prayShow < 5) prayShow = 5;
      else if (prayShow < 10) prayShow = 10;
      else prayShow = total;
      renderPrayers();
    });
    $('prayList').addEventListener('click', (e) => {
      const tog = e.target.closest('.pray-tog');
      if (tog) { const i = +tog.dataset.i; prayOpen.has(i) ? prayOpen.delete(i) : prayOpen.add(i); renderPrayers(); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const i = btn.dataset.i != null ? +btn.dataset.i : -1;
      if (act === 'editp') { prayEdit = i; renderPrayers(); }
      else if (act === 'cancelp') { prayEdit = -1; renderPrayers(); }
      else if (act === 'savep') {
        const t = $('prayEditText').value.trim();
        if (!t) { alert('기도제목 내용을 입력하세요.'); return; }
        prayers[i] = { date: $('prayEditDate').value || prayToday(), text: t };
        prayEdit = -1; renderPrayers();
      } else if (act === 'delp') {
        if (!confirm('이 기도제목을 삭제할까요?')) return;
        prayers.splice(i, 1); prayEdit = -1; prayOpen = new Set(); renderPrayers();
      }
    });

    $('dupBtn').addEventListener('click', () => {
      const name = $('fName').value.trim();
      const h = $('dupHint');
      if (!name) { h.className = 'hint warn'; h.textContent = '먼저 이름을 입력하세요.'; return; }
      const hit = allMembers.filter((x) => x.name === name && x.id !== editingId);
      if (hit.length) { h.className = 'hint warn'; h.textContent = `⚠ 명부에 「${name}」 님이 이미 ${hit.length}명 있습니다. 동명이인인지 확인하세요.`; }
      else { h.className = 'hint ok'; h.textContent = '✓ 같은 이름이 없습니다.'; }
    });

    // ── 명부 검색 오버레이 ──
    let pickTarget = null;
    function openPicker(target, kw) {
      pickTarget = target;
      $('pickInput').value = kw || '';
      renderPick(kw || '');
      $('pickBk').classList.add('on');
      $('pickInput').focus();
    }
    function renderPick(kw) {
      const rows = allMembers.filter((x) => x.id !== editingId &&
        (!kw || (x.name || '').toLowerCase().includes(kw.toLowerCase())));
      $('pickList').innerHTML = rows.length
        ? rows.map((x) => `<div class="pickrow" data-id="${x.id}">${esc(x.name)}${x.role ? ` <span style="font-size:12px; color:var(--muted);">${esc(x.role)}</span>` : ''}</div>`).join('')
        : '<div class="empty">검색 결과가 없습니다.</div>';
      $('pickList').querySelectorAll('.pickrow').forEach((r) => {
        r.addEventListener('click', () => choosePick(r.dataset.id));
      });
    }
    function choosePick(id) {
      const m = allMembers.find((x) => x.id === id);
      if (!m) return;
      if (pickTarget === 'head') { connectHead(m); }
      else if (pickTarget === 'spouse') { $('fSpouse').value = m.name; pickSpouseId = id; setSpouseBadge(m.memberNo); }
      else if (pickTarget === 'guide') { connectGuide(m); }
      $('pickBk').classList.remove('on');
    }
    // 세대주 연결 + 회원번호 배지
    function connectHead(m) {
      pickHeadId = m.id;
      $('fHead').value = m.name;
      setHeadBadge(m.memberNo);
    }
    function connectGuide(m) {
      pickGuideId = m.id;
      $('fGuide').value = m.name;
      setGuideBadge(m.memberNo);
    }
    function setNoBadge(b, no) {
      b.style.display = 'flex';
      b.style.background = ''; b.style.color = ''; b.style.border = '';
      const has = (no !== null && no !== undefined && no !== '');
      b.textContent = has ? (padNo(no) || ('#' + no)) : '#';
    }
    function setHeadBadge(no) { setNoBadge($('headNoBadge'), no); }
    function setSpouseBadge(no) { setNoBadge($('spouseNoBadge'), no); }
    function setGuideBadge(no) { setNoBadge($('guideNoBadge'), no); }
    // [검색] 클릭: 본인 이름 비교 → 명부 조회 → 연결/팝업/안내
    function handleHeadSearch() {
      const typed = $('fHead').value.trim();
      const selfName = $('fName').value.trim();
      if (!typed) { openPicker('head'); return; }
      if (selfName && typed === selfName) {
        pickHeadId = editingId || null;
        const _selfM = editingId ? allMembers.find((x) => x.id === editingId) : null;
        setHeadBadge(_selfM ? _selfM.memberNo : null);
        $('fRel').value = '본인';
        return;
      }
      const matches = allMembers.filter((x) => x.name === typed && x.id !== editingId);
      if (matches.length === 0) { setHeadBadge(null); pickHeadId = null; alert('명부에 없는 이름입니다.'); return; }
      if (matches.length === 1) { connectHead(matches[0]); return; }
      openPicker('head', typed);
    }
    function handleGuideSearch() {
      const typed = $('fGuide').value.trim();
      if (!typed) { openPicker('guide'); return; }
      const matches = allMembers.filter((x) => x.name === typed && x.id !== editingId);
      if (matches.length === 0) { setGuideBadge(null); pickGuideId = null; alert('명부에 없는 이름입니다.'); return; }
      if (matches.length === 1) { connectGuide(matches[0]); return; }
      openPicker('guide', typed);
    }
    function handleSpouseSearch() {
      const typed = $('fSpouse').value.trim();
      if (!typed) { openPicker('spouse'); return; }
      const matches = allMembers.filter((x) => x.name === typed && x.id !== editingId);
      if (matches.length === 0) { setSpouseBadge(null); pickSpouseId = null; alert('명부에 없는 이름입니다.'); return; }
      if (matches.length === 1) { $('fSpouse').value = matches[0].name; pickSpouseId = matches[0].id; setSpouseBadge(matches[0].memberNo); return; }
      openPicker('spouse', typed);
    }
    $('headBtn').addEventListener('click', handleHeadSearch);
    $('fHead').addEventListener('input', () => { pickHeadId = null; setHeadBadge(null); });
    $('spouseBtn').addEventListener('click', handleSpouseSearch);
    $('fSpouse').addEventListener('input', () => { pickSpouseId = null; setSpouseBadge(null); });
    $('guideBtn').addEventListener('click', handleGuideSearch);
    $('fGuide').addEventListener('input', () => { pickGuideId = null; setGuideBadge(null); });
    $('pickInput').addEventListener('input', (e) => renderPick(e.target.value));
    $('pickClose').addEventListener('click', () => $('pickBk').classList.remove('on'));
    $('pickBk').addEventListener('click', (e) => { if (e.target === $('pickBk')) $('pickBk').classList.remove('on'); });

    async function resolveHousehold(selfId) {
      const relation = $('fRel').value;
      if (pickHeadId) {
        const head = allMembers.find((x) => x.id === pickHeadId);
        let hh = head?.householdId;
        if (!hh && head) {
          hh = head.id;
          await updateDoc(doc(db, 'members', head.id), {
            householdId: hh, headId: hh, headName: head.name,
            relation: head.relation || '본인'
          });
        }
        return { householdId: hh || selfId, headId: pickHeadId, headName: $('fHead').value, relation: relation || '' };
      }
      const _selfName = $('fName').value.trim();
      const _typedHead = $('fHead').value.trim();
      const _isSelf = _typedHead && _typedHead === _selfName;
      return { householdId: selfId, headId: selfId, headName: _isSelf ? _selfName : '', relation: relation || '본인' };
    }

    // ── 연락처·이메일 유틸 ──
    function fmtPhone(v) {
      const d = (v || '').replace(/\D/g, '').slice(0, 11);
      if (!d) return '';
      if (d.startsWith('02')) {
        if (d.length < 3) return d;
        if (d.length < 6) return d.slice(0, 2) + '-' + d.slice(2);
        if (d.length < 10) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
        return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10);
      }
      if (d.length < 4) return d;
      if (d.length < 7) return d.slice(0, 3) + '-' + d.slice(3);
      if (d.length < 11) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
      return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7, 11);
    }
    function phoneOk(v) { const d = (v || '').replace(/\D/g, ''); return d.length >= 9 && d.length <= 11; }
    function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

    const EMAIL_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'nate.com'];
    function onEmailDomainChange() {
      if ($('fEmailDomain').value === '__custom') {
        $('fEmailDomain').style.display = 'none';
        $('fEmailCustom').style.display = '';
        $('fEmailCustom').value = '';
        $('fEmailCustom').focus();
      }
    }
    // 직접입력 칸을 비우면 드롭다운으로 복귀
    function revertEmailDomainIfEmpty() {
      if (!$('fEmailCustom').value.trim()) {
        $('fEmailCustom').style.display = 'none';
        $('fEmailCustom').classList.remove('invalid');
        $('fEmailDomain').value = 'naver.com';
        $('fEmailDomain').style.display = '';
      }
    }
    // 저장된 email 문자열 → 아이디/도메인 칸으로 분리 로딩
    function setEmailFields(email) {
      $('fEmailId').classList.remove('invalid'); $('fEmailCustom').classList.remove('invalid');
      $('eEmailErr').classList.remove('show');
      const at = (email || '').lastIndexOf('@');
      if (at < 0) {
        $('fEmailId').value = email || ''; $('fEmailDomain').value = 'naver.com';
        $('fEmailDomain').style.display = ''; $('fEmailCustom').style.display = 'none'; $('fEmailCustom').value = ''; return;
      }
      $('fEmailId').value = email.slice(0, at);
      const dom = email.slice(at + 1);
      if (EMAIL_DOMAINS.includes(dom)) {
        $('fEmailDomain').value = dom; $('fEmailDomain').style.display = '';
        $('fEmailCustom').style.display = 'none'; $('fEmailCustom').value = '';
      } else {
        $('fEmailDomain').value = '__custom'; $('fEmailDomain').style.display = 'none';
        $('fEmailCustom').style.display = ''; $('fEmailCustom').value = dom;
      }
    }
    // 현재 입력 칸 → email 문자열 (아이디·도메인 모두 비면 '')
    function getEmailValue() {
      const id = $('fEmailId').value.trim();
      const dom = ($('fEmailDomain').value === '__custom' ? $('fEmailCustom').value.trim() : $('fEmailDomain').value);
      if (!id && ($('fEmailDomain').value === '__custom' && !dom)) return '';
      if (!id && !dom) return '';
      if (!id) return '';
      return id + '@' + dom;
    }

    async function saveMember() {
      const name = $('fName').value.trim();
      if (!name) {
        $('editMsg').textContent = '이름을 입력해 주세요.'; $('editMsg').style.display = 'block';
        $('acc1').classList.add('open');
        return;
      }
      // 연락처·이메일 검증 (비어 있으면 통과, 값이 있으면 형식 확인)
      $('fPhone').classList.remove('invalid'); $('ePhoneErr').classList.remove('show');
      $('fPhoneHome').classList.remove('invalid'); $('ePhoneHomeErr').classList.remove('show');
      $('fEmailId').classList.remove('invalid'); $('fEmailCustom').classList.remove('invalid'); $('eEmailErr').classList.remove('show');
      const phoneVal = $('fPhone').value.trim();
      if (phoneVal && !phoneOk(phoneVal)) {
        $('fPhone').classList.add('invalid'); $('ePhoneErr').classList.add('show');
        $('acc1').classList.add('open'); $('fPhone').focus();
        return;
      }
      const phoneHomeVal = $('fPhoneHome').value.trim();
      if (phoneHomeVal && !phoneOk(phoneHomeVal)) {
        $('fPhoneHome').classList.add('invalid'); $('ePhoneHomeErr').classList.add('show');
        $('acc1').classList.add('open'); $('fPhoneHome').focus();
        return;
      }
      const emailVal = getEmailValue();
      if (emailVal && !emailOk(emailVal)) {
        $('fEmailId').classList.add('invalid');
        if ($('fEmailDomain').value === '__custom') $('fEmailCustom').classList.add('invalid');
        $('eEmailErr').classList.add('show');
        $('acc1').classList.add('open');
        ($('fEmailDomain').value === '__custom' && !$('fEmailCustom').value.trim() ? $('fEmailCustom') : $('fEmailId')).focus();
        return;
      }
      applyRoleDate();
      applyRegDate();
      applyGradeDate();
      applyWedDate();
      const base = {
        name,
        gender: $('fGender').value,
        birth: $('fBirth').value.trim(),
        birthCal: $('fBirthCal').value,
        phone: phoneVal,
        phoneHome: phoneHomeVal,
        zipcode: $('fZip').value.trim(),
        address: $('fAddress').value.trim(),
        addressDetail: $('fAddressDetail').value.trim(),
        email: emailVal,
        regDate: $('fRegDate').value,
        regType: $('fRegType').value,
        guide: $('fGuide').value.trim(),
        guideId: pickGuideId || null,
        prevChurch: $('fPrev').value.trim(),
        movedChurch: $('fMoved').value.trim(),
        grade: $('fGrade').value,
        gradeDate: $('fGradeDate').value,
        gradeChurch: $('fGradeChurch').value.trim(),
        officiant: $('fOfficiant').value.trim(),
        roleCat: $('fRoleCat').value,
        role: $('fRole').value,
        roleDate: fmtBirth($('fRoleDate').value),
        roleChurch: $('fRoleChurch').value.trim(),
        memberType: $('fType').value,
        status: $('fStatus').value,
        marriage: $('fMarriage').value,
        wedDate: $('fWed').value,
        spouseId: pickSpouseId || null,
        spouseName: $('fSpouse').value.trim(),
        memo: $('fMemo').value.trim(),
        prayers: prayers.map((p) => ({ date: p.date || '', text: p.text || '' })),
        updatedAt: serverTimestamp(),
      };
      const btn = $('eSave');
      btn.disabled = true; btn.textContent = '저장 중…';
      try {
        if (editingId) {
          const hh = await resolveHousehold(editingId);
          await updateDoc(doc(db, 'members', editingId), { ...base, ...hh });
        } else {
          base.createdAt = serverTimestamp();
          base.createdBy = me.uid;
          base.memberNo = nextMemberNo();
          const ref = await addDoc(collection(db, 'members'),
            { ...base, householdId: null, headId: null, headName: '', relation: $('fRel').value || '' });
          editingId = ref.id;
          const hh = await resolveHousehold(ref.id);
          await updateDoc(ref, hh);
        }
        await loadMembers();
        openDetail(editingId);
      } catch (e) {
        $('editMsg').textContent = '저장 실패: ' + (e.code || e.message);
        $('editMsg').style.display = 'block';
      } finally {
        btn.disabled = false; btn.textContent = '저장';
      }
    }

    async function archiveMember(id) {
      const m = allMembers.find((x) => x.id === id);
      if (!confirm(`'${m?.name || '이 성도'}' 님을 명부에서 숨길까요?\n문서는 보존되며 언제든 복원할 수 있습니다.`)) return;
      try {
        await updateDoc(doc(db, 'members', id), { archived: true, archivedAt: serverTimestamp(), archivedBy: me.uid });
        await loadMembers();
        leaveToList(); closeViaBack();
      } catch (e) {
        alert('숨김 실패: ' + (e.code || e.message));
      }
    }
    async function restoreMember(id) {
      try {
        await updateDoc(doc(db, 'members', id), { archived: false, archivedAt: null, archivedBy: null });
        await loadMembers();
        leaveToList(); closeViaBack();
      } catch (e) {
        alert('복원 실패: ' + (e.code || e.message));
      }
    }
    async function hardDeleteMember(id) {
      const m = allMembers.find((x) => x.id === id);
      const refs = allMembers.filter((x) => x.id !== id && (x.headId === id || x.spouseId === id));
      if (refs.length) {
        const names = refs.map((x) => `· ${x.name || '(이름 없음)'} (${x.spouseId === id ? '배우자' : '세대원'})`).join('\n');
        alert(`'${m?.name || '이 성도'}' 님을 세대주/배우자로 참조하는 성도가 있어 완전 삭제할 수 없습니다.\n\n${names}\n\n먼저 연결을 정리하거나 “명부에서 숨김”을 사용하세요.`);
        return;
      }
      if (!confirm(`'${m?.name || '이 성도'}' 님을 완전히 삭제합니다.\n\n· 되돌릴 수 없습니다.\n· 헌금 내역이 있으면 영수증 보존을 위해 삭제하지 말고 “명부에서 숨김”을 사용하세요.\n\n계속할까요?`)) return;
      try {
        await deleteDoc(doc(db, 'members', id));
        await loadMembers();
        leaveToList(); closeViaBack();
      } catch (e) {
        alert('삭제 실패: ' + (e.code || e.message));
      }
    }

    // 연락처 실시간 하이픈 + 이메일 도메인 선택 전환
    // 카카오 우편번호 검색 (임베드: 설치형 PWA에서도 동작)
    function openPostcode() {
      if (typeof daum === 'undefined' || !daum.Postcode) {
        alert('우편번호 서비스를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
        return;
      }
      const wrap = $('postEmbed');
      wrap.innerHTML = '';
      $('postBk').style.display = 'flex';
      new daum.Postcode({
        oncomplete: function (data) {
          $('fZip').value = data.zonecode;
          $('fAddress').value = data.roadAddress || data.jibunAddress;
          $('fAddressDetail').value = '';
          closePostcode();
          $('fAddressDetail').focus();
        },
        width: '100%',
        height: '100%'
      }).embed(wrap);
    }
    function closePostcode() {
      $('postBk').style.display = 'none';
      $('postEmbed').innerHTML = '';
    }

    $('fPhone').addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
    $('fPhoneHome').addEventListener('input', (e) => { e.target.value = fmtPhone(e.target.value); });
    $('fZipBtn').addEventListener('click', openPostcode);
    $('postClose').addEventListener('click', closePostcode);
    $('postBk').addEventListener('click', (e) => { if (e.target === $('postBk')) closePostcode(); });
    $('fEmailDomain').addEventListener('change', onEmailDomainChange);
    $('fEmailCustom').addEventListener('blur', revertEmailDomainIfEmpty);

    // 접이식 토글
    document.querySelectorAll('.acc-head').forEach((h) => {
      h.addEventListener('click', () => {
        const acc = $(h.dataset.acc);
        acc.classList.toggle('open');
        const s = h.querySelector('.h-s');
        s.firstChild.textContent = acc.classList.contains('open') ? '접기 ' : '펼치기 ';
      });
    });

    // ── 화면 전환 (list=기본, detail/edit=오버레이) ──
    function applyView(view) {
      $('listView').style.display = (view === 'list') ? '' : 'none';
      $('detailView').style.display = (view === 'detail') ? '' : 'none';
      $('editView').style.display = (view === 'edit') ? '' : 'none';
      $('fab').style.display = (view === 'list') ? 'flex' : 'none';
      $('editBtn').style.display = (view === 'detail') ? 'block' : 'none';
      $('layoutBtn').style.display = (view === 'detail') ? 'block' : 'none';
      $('barTitle').textContent =
        (view === 'list') ? '성도 관리' :
        (view === 'detail') ? '성도 정보' :
        (editingId ? '성도 편집' : '성도 추가');
      window.scrollTo(0, 0);
    }
    function pushOverlay() { if (!overlayPushed) { history.pushState({ o: 1 }, ''); overlayPushed = true; } }
    function closeViaBack() { if (overlayPushed) { overlayPushed = false; history.back(); } }
    function leaveToList() { editingId = null; detailId = null; applyView('list'); }
    function show(view) {
      if (view === 'list') { leaveToList(); return; }
      pushOverlay(); applyView(view);
    }
    window.addEventListener('popstate', () => {
      if ($('pickBk').classList.contains('on')) { $('pickBk').classList.remove('on'); history.pushState({ o: 1 }, ''); return; }
      if (!overlayPushed) return;
      overlayPushed = false;
      leaveToList();
    });

    // ── 버튼 핸들러 ──
    $('fab').addEventListener('click', () => openEdit(null));
    $('editBtn').addEventListener('click', () => { if (detailId) openEdit(detailId); });
    $('eSave').addEventListener('click', saveMember);
    $('eCancel').addEventListener('click', () => {
      if (editingId && detailId === editingId) { applyView('detail'); }
      else { leaveToList(); closeViaBack(); }
    });
    $('backBtn').addEventListener('click', () => {
      if (overlayPushed) { leaveToList(); closeViaBack(); }
      else { location.href = 'index.html'; }
    });
  