
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
    let editingId = null;
    let detailId = null;
    let overlayPushed = false;
    // 편집 중 선택된 참조(세대주/배우자)의 문서 id
    let pickHeadId = null, pickSpouseId = null;

    const ROLES = ['목사', '전도사', '장로', '권사', '안수집사', '서리집사', '성도'];

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
        $('fRole').innerHTML = ROLES.map((r) => `<option${r === '성도' ? ' selected' : ''}>${r}</option>`).join('');
        loadMembers();
      } catch (e) {
        alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        location.replace('index.html');
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
      const kw = $('searchInput').value.trim().toLowerCase();
      let rows = allMembers;
      if (currentFilter === 'new') rows = rows.filter((m) => m.memberType === '새가족');
      if (kw) rows = rows.filter((m) =>
        (m.name || '').toLowerCase().includes(kw) || (m.phone || '').includes(kw));

      if (rows.length === 0) {
        $('memberList').innerHTML = `<div class="empty">${(kw || currentFilter === 'new') ? '해당하는 성도가 없습니다.' : '아직 등록된 성도가 없습니다.<br>＋ 버튼으로 추가하세요.'}</div>`;
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
    document.querySelectorAll('.ftab').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.ftab').forEach((x) => x.classList.remove('ftab-on'));
        b.classList.add('ftab-on');
        currentFilter = b.dataset.filter;
        renderList();
      });
    });

    const BADGE_GRADE = (m) => {
      if (!m.grade) return '';
      return m.grade + (m.gradeDate ? ' · ' + dot(m.gradeDate) : '');
    };
    function drow(k, v) {
      if (!v) return '';
      return `<div class="drow"><div class="dk">${k}</div><div class="dv">${v}</div></div>`;
    }
    function householdMembers(m) {
      if (!m.householdId) return [];
      return allMembers.filter((x) => x.householdId === m.householdId)
        .sort((a, b) => (a.relation === '본인(세대주)' ? -1 : 0) - (b.relation === '본인(세대주)' ? -1 : 0));
    }

    function openDetail(id) {
      const m = allMembers.find((x) => x.id === id);
      if (!m) return;
      detailId = id;
      const age = calcAge(m.birth);
      const top = [m.gender, (age != null ? age + '세' : null), m.memberType, m.status].filter(Boolean).join(' · ');
      const birthTxt = m.birth ? (esc(m.birth) + (m.birthCal === 'lunar' ? ' (음)' : '') + (age != null ? ` · 만 ${age}세` : '')) : '';

      const fam = householdMembers(m);
      let famHtml = '';
      if (fam.length > 1 || (m.relation && m.relation !== '')) {
        const chips = fam.map((x) =>
          `<span style="font-size:12.5px; padding:4px 10px; border-radius:99px; background:var(--bg);">${esc(x.name)}${x.relation ? ' · ' + esc(x.relation.replace('(세대주)', '')) : ''}</span>`).join(' ');
        famHtml = `<div style="margin-top:10px;"><div style="font-size:12px; color:var(--muted); margin-bottom:7px;">가정 구성원</div><div style="display:flex; gap:7px; flex-wrap:wrap;">${chips || '—'}</div></div>`;
      }

      $('detailView').innerHTML =
        `<div style="display:flex; flex-direction:column; align-items:center; gap:8px; margin-bottom:8px;">
           <div class="avatar" style="width:72px; height:72px; font-size:26px;">${esc(initial(m.name))}</div>
           <div style="text-align:center;">
             <div style="font-size:19px; font-weight:700;">${esc(m.name || '(이름 없음)')}
               ${m.role ? `<span class="badge" style="vertical-align:3px;">${esc(m.role)}</span>` : ''}
               ${m.memberType === '새가족' ? '<span class="badge badge-new" style="vertical-align:3px;">새가족</span>' : ''}
             </div>
             <div style="font-size:13px; color:var(--muted); margin-top:3px;">${esc(top)}</div>
           </div>
         </div>

         <div class="dsec">기본</div>
         ${drow('연락처', m.phone ? `<a href="tel:${esc(m.phone)}" style="color:var(--green); text-decoration:none;">${esc(m.phone)}</a>` : '')}
         ${drow('생일', birthTxt)}
         ${drow('이메일', esc(m.email))}
         ${drow('주소', esc(m.address))}

         <div class="dsec">등록</div>
         ${drow('등록일', esc(dot(m.regDate)))}
         ${drow('등록배경', esc(m.regType))}
         ${drow('인도자', esc(m.guide))}
         ${drow('이전교회', esc(m.prevChurch))}
         ${drow('신급', esc(BADGE_GRADE(m)))}
         ${drow('신급교회', esc(m.gradeChurch))}
         ${drow('집례자', esc(m.officiant))}

         <div class="dsec">가족</div>
         ${drow('결혼관계', esc(m.marriage))}
         ${drow('결혼일', esc(dot(m.wedDate)))}
         ${drow('배우자', esc(m.spouseName))}
         ${famHtml}

         ${m.memo ? `<div class="dsec">메모 · 기도제목</div><div style="font-size:14px; color:var(--text); white-space:pre-wrap; padding-top:6px;">${esc(m.memo)}</div>` : ''}

         <button id="dDelete" class="btn-line" style="width:100%; height:46px; margin-top:22px; color:var(--danger); border-color:#e7c9c4;">삭제</button>`;
      $('dDelete').addEventListener('click', () => removeMember(id));
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
      $('fPhone').value = m?.phone || '';
      $('fAddress').value = m?.address || '';
      $('fEmail').value = m?.email || '';
      $('fRegDate').value = m?.regDate || new Date().toISOString().slice(0, 10);
      $('fRegType').value = m?.regType || '';
      $('fGuide').value = m?.guide || '';
      $('fPrev').value = m?.prevChurch || '';
      $('fGrade').value = m?.grade || '';
      $('fGradeDate').value = m?.gradeDate || '';
      $('fGradeChurch').value = m?.gradeChurch || '';
      $('fOfficiant').value = m?.officiant || '';
      $('fRole').value = m?.role || '성도';
      $('fType').value = m?.memberType || '교인';
      $('fStatus').value = m?.status || '예배출석';
      $('fHead').value = m?.headName || '';
      $('fRel').value = m?.relation || '';
      $('fMarriage').value = m?.marriage || '';
      $('fWed').value = m?.wedDate || '';
      $('fSpouse').value = m?.spouseName || '';
      $('fMemo').value = m?.memo || '';
      pickHeadId = m?.headId || null;
      pickSpouseId = m?.spouseId || null;
      $('dupHint').className = 'hint'; $('dupHint').textContent = '명부에 같은 이름이 있으면 알려드립니다.';
      $('editMsg').style.display = 'none';
      updateAge();
      setAcc(true);
      show('edit');
    }

    function updateAge() {
      const a = calcAge($('fBirth').value);
      $('ageBox').textContent = (a != null) ? (a + '세') : '–';
    }
    $('fBirth').addEventListener('input', updateAge);

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
    function openPicker(target) {
      pickTarget = target;
      $('pickInput').value = '';
      renderPick('');
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
      if (pickTarget === 'head') { $('fHead').value = m.name; pickHeadId = id; }
      else if (pickTarget === 'spouse') { $('fSpouse').value = m.name; pickSpouseId = id; }
      $('pickBk').classList.remove('on');
    }
    $('headBtn').addEventListener('click', () => openPicker('head'));
    $('spouseBtn').addEventListener('click', () => openPicker('spouse'));
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
            relation: head.relation || '본인(세대주)'
          });
        }
        return { householdId: hh || selfId, headId: pickHeadId, headName: $('fHead').value, relation: relation || '' };
      }
      return { householdId: selfId, headId: selfId, headName: '', relation: relation || '본인(세대주)' };
    }

    async function saveMember() {
      const name = $('fName').value.trim();
      if (!name) {
        $('editMsg').textContent = '이름을 입력해 주세요.'; $('editMsg').style.display = 'block';
        $('acc1').classList.add('open');
        return;
      }
      const base = {
        name,
        gender: $('fGender').value,
        birth: $('fBirth').value.trim(),
        birthCal: $('fBirthCal').value,
        phone: $('fPhone').value.trim(),
        address: $('fAddress').value.trim(),
        email: $('fEmail').value.trim(),
        regDate: $('fRegDate').value,
        regType: $('fRegType').value,
        guide: $('fGuide').value.trim(),
        prevChurch: $('fPrev').value.trim(),
        grade: $('fGrade').value,
        gradeDate: $('fGradeDate').value,
        gradeChurch: $('fGradeChurch').value.trim(),
        officiant: $('fOfficiant').value.trim(),
        role: $('fRole').value,
        memberType: $('fType').value,
        status: $('fStatus').value,
        marriage: $('fMarriage').value,
        wedDate: $('fWed').value,
        spouseId: pickSpouseId || null,
        spouseName: $('fSpouse').value.trim(),
        memo: $('fMemo').value.trim(),
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

    async function removeMember(id) {
      const m = allMembers.find((x) => x.id === id);
      if (!confirm(`'${m?.name || '이 성도'}' 님을 명부에서 삭제할까요?`)) return;
      try {
        await deleteDoc(doc(db, 'members', id));
        await loadMembers();
        closeViaBack();
      } catch (e) {
        alert('삭제 실패: ' + (e.code || e.message));
      }
    }

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
  