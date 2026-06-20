
    import { auth, db } from "./firebase-config.js";
    import {
      onAuthStateChanged, createUserWithEmailAndPassword,
      signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup,
      updateProfile, sendPasswordResetEmail
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      doc, getDoc, setDoc, serverTimestamp,
      collection, getDocs, updateDoc
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    const modal = $('authModal');
    let mode = 'login'; // 'login' | 'signup'
    let pendingName = null; // 이메일 회원가입에서 받은 이름을 resolveProfile로 전달
    let pwFailCount = 0;    // 로그인 비밀번호 불일치 연속 실패 횟수

    function setMode(m) {
      mode = m;
      const signup = (mode === 'signup');
      $('authTitle').textContent = signup ? '회원가입' : '로그인';
      $('authSubmit').textContent = signup ? '회원가입' : '로그인';
      $('authToggleText').textContent = signup ? '이미 계정이 있으신가요? ' : '계정이 없으신가요? ';
      $('authToggle').textContent = signup ? '로그인' : '회원가입';
      $('authNameRow').style.display = signup ? 'block' : 'none';
      $('authPw2Row').style.display = signup ? 'block' : 'none';
      $('authPw').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
      $('forgotRow').style.display = 'none';
      $('authMsg').style.display = 'none';
    }
    function openModal() { pwFailCount = 0; setMode('login'); modal.style.display = 'flex'; $('authEmail').focus(); }
    function closeModal() { modal.style.display = 'none'; pwFailCount = 0; $('forgotRow').style.display = 'none'; }
    function showMsg(t, ok) {
      const e = $('authMsg');
      e.textContent = t;
      e.style.color = ok ? 'var(--green)' : '#c0392b';
      e.style.display = 'block';
      if (!ok) shake();
    }
    // 오류 시 모달 카드를 좌우로 흔들고, 가능한 기기에서는 진동
    function shake() {
      const el = $('authCard');
      if (!el) return;
      el.classList.remove('shake');
      void el.offsetWidth;       // 리플로우로 애니메이션 재실행 보장
      el.classList.add('shake');
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    }

    function krError(code) {
      const map = {
        'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
        'auth/missing-password': '비밀번호를 입력하세요.',
        'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
        'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인해 주세요.',
        'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
        'auth/too-many-requests': '시도가 많아 잠시 후 다시 시도해 주세요.',
        'auth/popup-closed-by-user': '구글 로그인 창이 닫혔습니다.',
        'auth/unauthorized-domain': '이 주소는 아직 허용되지 않았습니다(콘솔에서 도메인 승인 필요).'
      };
      return map[code] || ('오류: ' + code);
    }

    // 신규 사용자 식별 시 실명을 받는 모달 (확인=이름반환 / 취소=null)
    function askRealName(prefill) {
      return new Promise((resolve) => {
        const m = $('nameModal'), input = $('nameInput'), msg = $('nameMsg');
        input.value = prefill || '';
        msg.style.display = 'none';
        m.style.display = 'flex';
        input.focus();
        function cleanup() {
          $('nameSubmit').removeEventListener('click', onSubmit);
          $('nameCancel').removeEventListener('click', onCancel);
          input.removeEventListener('keydown', onKey);
          m.style.display = 'none';
        }
        function onSubmit() {
          const v = input.value.trim();
          if (!v) { msg.textContent = '이름을 입력하세요.'; msg.style.display = 'block'; return; }
          cleanup(); resolve(v);
        }
        function onCancel(e) { if (e) e.preventDefault(); cleanup(); resolve(null); }
        function onKey(e) { if (e.key === 'Enter') onSubmit(); }
        $('nameSubmit').addEventListener('click', onSubmit);
        $('nameCancel').addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
      });
    }

    // 프로필 확인/생성 → 등급(level) 반환. 실명 입력 취소 시 null(로그아웃).
    async function resolveProfile(user) {
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const lv = snap.data().level;
        return (typeof lv === 'number') ? lv : 1;
      }
      // 신규 사용자: 실명 확보
      let name = pendingName;   // 이메일 회원가입에서 입력한 이름
      pendingName = null;
      if (!name) {
        // 구글 첫 로그인 등 — 실명을 직접 입력받음(빈칸으로 시작)
        name = await askRealName('');
        if (name === null) { await signOut(auth); return null; }
      }
      await setDoc(ref, {
        email: user.email || '',
        name: name,
        level: 1,
        createdAt: serverTimestamp()
      });
      try { await updateProfile(user, { displayName: name }); } catch (e) {}
      return 1;
    }

    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let level;
        try { level = await resolveProfile(user); }
        catch (e) { console.error('프로필 처리 실패:', e); level = 1; }
        if (level === null) return; // 실명 입력 취소 → 로그아웃됨
        $('loginBtn').style.display = 'none';
        $('logoutBtn').style.display = '';
        const info = $('userInfo');
        info.style.display = '';
        info.textContent = user.displayName || user.email || '';
        window.applyPermission(level);
        closeModal();
      } else {
        $('loginBtn').style.display = '';
        $('logoutBtn').style.display = 'none';
        $('userInfo').style.display = 'none';
        window.applyPermission(1); // 게스트
      }
    });

    $('loginBtn').addEventListener('click', openModal);
    $('logoutBtn').addEventListener('click', () => signOut(auth));
    $('authClose').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    $('authToggle').addEventListener('click', (e) => {
      e.preventDefault();
      setMode(mode === 'login' ? 'signup' : 'login');
    });

    $('authSubmit').addEventListener('click', async () => {
      const email = $('authEmail').value.trim();
      const pw = $('authPw').value;
      try {
        if (mode === 'signup') {
          const name = $('authName').value.trim();
          const pw2 = $('authPw2').value;
          if (!name) { showMsg('이름을 입력하세요.'); return; }
          if (pw !== pw2) { showMsg('비밀번호가 일치하지 않습니다.'); return; }
          pendingName = name;   // resolveProfile에서 문서 생성 시 사용
          await createUserWithEmailAndPassword(auth, email, pw);
          // 프로필 문서 생성·이름 저장은 onAuthStateChanged → resolveProfile이 담당
        } else {
          await signInWithEmailAndPassword(auth, email, pw);
        }
        // 이후 처리(모달 닫기·권한 적용)는 onAuthStateChanged가 담당
      } catch (e) {
        if (mode === 'login' && e.code === 'auth/invalid-credential') {
          pwFailCount++;
          if (pwFailCount >= 3) $('forgotRow').style.display = 'block';
        }
        showMsg(krError(e.code));
      }
    });

    $('googleBtn').addEventListener('click', async () => {
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (e) { showMsg(krError(e.code)); }
    });

    $('forgotPw').addEventListener('click', async (e) => {
      e.preventDefault();
      const email = $('authEmail').value.trim();
      if (!email) { showMsg('이메일을 먼저 입력해 주세요.'); return; }
      try {
        await sendPasswordResetEmail(auth, email);
        showMsg('재설정 메일을 보냈습니다. 메일함을 확인해 주세요.', true);
      } catch (err) { showMsg(krError(err.code)); }
    });

    // 비밀번호 표시/숨김 토글 (눈 아이콘)
    const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    document.querySelectorAll('.pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = $(btn.getAttribute('data-target'));
        const reveal = (input.type === 'password');
        input.type = reveal ? 'text' : 'password';
        btn.innerHTML = reveal ? EYE_OFF : EYE;
        btn.setAttribute('aria-label', reveal ? '비밀번호 숨기기' : '비밀번호 표시');
      });
    });

    // ===== 회원 권한 관리 (관리자 전용) =====
    const TIER_LABEL = { 1: '예배', 2: '사랑방', 3: '헌금', 4: '전체' };

    async function loadMembers() {
      pendingChanges = {};
      updateSaveBtn();
      const listEl = $('permList');
      listEl.innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">불러오는 중…</div>';
      try {
        const snap = await getDocs(collection(db, 'users'));
        const meUid = auth.currentUser ? auth.currentUser.uid : null;
        const rows = [];
        snap.forEach((d) => rows.push(Object.assign({ uid: d.id }, d.data())));
        rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
        lastRows = rows;
        saveRoster(rows);   // 창 열 때 명단/인원수 저장
        listEl.innerHTML = '';
        if (rows.length === 0) {
          listEl.innerHTML = '<div style="font-size:13px; color:var(--muted); text-align:center; padding:20px;">등록된 회원이 없습니다.</div>';
          return;
        }
        rows.forEach((m) => listEl.appendChild(memberRow(m, meUid)));
      } catch (e) {
        listEl.innerHTML = '<div style="font-size:13px; color:#c0392b; text-align:center; padding:20px;">불러오기 실패: ' + (e.code || e.message) + '</div>';
      }
    }

    let pendingChanges = {};
    let lastRows = [];

    // 2단계 이상 명단(이름만)과 수를 회원이 읽을 수 있는 곳(rooms/all)에 저장.
    // 채팅창이 헤더 인원수·(향후)명단·메시지별 안 읽은 수(전원 기준)에 사용.
    async function saveRoster(rows) {
      try {
        const members = rows
          .filter((m) => (m.level || 1) >= 2)
          .map((m) => ({ uid: m.uid, name: m.name || '성도' }));
        await setDoc(doc(db, 'rooms', 'all'),
          { memberCount: members.length, roster: members }, { merge: true });
      } catch (e) {}
    }

    function updateSaveBtn() {
      const n = Object.keys(pendingChanges).length;
      const btn = $('permSave');
      if (!btn) return;
      btn.disabled = (n === 0);
      btn.style.opacity = (n === 0) ? '.4' : '1';
      btn.textContent = (n === 0) ? '변경사항 저장' : (n + '명 변경 저장');
    }

    function memberRow(m, meUid) {
      const isMe = (m.uid === meUid);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:10px; padding:10px 12px;';

      const av = document.createElement('div');
      av.style.cssText = 'width:34px; height:34px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; background:var(--green-soft); color:var(--green);';
      av.textContent = (m.name || '?').slice(0, 1);

      const who = document.createElement('div');
      who.style.cssText = 'flex:1; min-width:0;';
      const nm = document.createElement('div');
      nm.style.cssText = 'font-size:14px; font-weight:700; display:flex; align-items:center; gap:6px; min-width:0;';
      const nameText = document.createElement('span');
      nameText.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      nameText.textContent = m.name || '(이름 없음)';
      nm.appendChild(nameText);
      if (isMe) {
        const tag = document.createElement('span');
        tag.textContent = '본인';
        tag.style.cssText = 'flex-shrink:0; font-size:11px; font-weight:400; background:var(--bg); color:var(--muted); border-radius:6px; padding:1px 7px;';
        nm.appendChild(tag);
        const lock = document.createElement('span');
        lock.textContent = '🔒';
        lock.style.cssText = 'flex-shrink:0; font-size:13px;';
        nm.appendChild(lock);
      }
      who.appendChild(nm);

      const sel = document.createElement('select');
      sel.style.cssText = 'flex-shrink:0; padding:7px 10px; border:1px solid var(--line); border-radius:8px; font-size:13px; background:var(--card); color:var(--text);';
      [1, 2, 3, 4].forEach((v) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v + '·' + TIER_LABEL[v];
        if (v === (m.level || 1)) o.selected = true;
        sel.appendChild(o);
      });

      if (isMe) {
        sel.disabled = true; sel.style.opacity = '.6';
        row.append(av, who, sel);
        return row;
      }

      // 등급 변경 시 일괄 저장 대상으로 추적 + 변경된 행 강조
      sel.addEventListener('change', () => {
        const nv = parseInt(sel.value, 10);
        if (nv !== (m.level || 1)) {
          pendingChanges[m.uid] = nv;
          row.style.borderColor = 'var(--green)';
          row.style.background = 'var(--green-soft)';
        } else {
          delete pendingChanges[m.uid];
          row.style.borderColor = 'var(--line)';
          row.style.background = '';
        }
        updateSaveBtn();
      });

      row.append(av, who, sel);
      return row;
    }

    function tryClosePerm() {
      if (Object.keys(pendingChanges).length > 0 &&
          !confirm('저장하지 않은 변경이 있습니다. 닫으시겠어요?')) return;
      pendingChanges = {};
      updateSaveBtn();
      $('permModal').style.display = 'none';
    }

    $('adminPermCard').addEventListener('click', () => {
      $('permModal').style.display = 'flex';
      loadMembers();
    });
    $('permClose').addEventListener('click', tryClosePerm);
    $('permModal').addEventListener('click', (e) => { if (e.target === $('permModal')) tryClosePerm(); });
    $('permSave').addEventListener('click', async () => {
      const entries = Object.entries(pendingChanges);
      if (entries.length === 0) return;
      const btn = $('permSave');
      btn.disabled = true; btn.textContent = '저장 중…';
      try {
        await Promise.all(entries.map(([uid, lv]) => updateDoc(doc(db, 'users', uid), { level: lv })));
        // 변경분을 명단에 반영해 다시 저장 (채팅 인원수·안 읽은 수 최신화)
        entries.forEach(([uid, lv]) => { const r = lastRows.find((x) => x.uid === uid); if (r) r.level = lv; });
        await saveRoster(lastRows);
        pendingChanges = {};
        $('permModal').style.display = 'none';
      } catch (e) {
        alert('일부 저장에 실패했습니다: ' + (e.code || e.message));
        loadMembers();
      }
    });
  