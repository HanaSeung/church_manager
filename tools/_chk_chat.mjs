
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
      query, where, orderBy, limit, startAfter, onSnapshot,
      serverTimestamp, Timestamp, arrayUnion
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    // 방 id: URL ?room=… (없으면 전체방 'all'). 'all' 외에는 members 배열로 접근 판단.
    const ROOM = new URLSearchParams(location.search).get('room') || 'all';
    const IS_PRIVATE = ROOM !== 'all';   // dm/group 방
    const PAGE = 50;

    let me = { uid: null, name: '', level: 1 };
    let roomType = IS_PRIVATE ? 'dm' : 'all';
    let roomMembers = [];     // 이 방 멤버 uid 배열 (private 방)
    let roomName = '';        // 사용자가 정한 방 이름(있으면)
    let joinedMap = {};       // uid -> 합류 시각 ts
    let myJoinMs = 0;         // 내 합류 시각(ms). 이 이전 메시지는 화면에서 가림
    const byId = new Map();        // 메시지 id -> data (older + live 통합 저장소)
    const reads = new Map();       // 회원 uid -> { ms, name }  (각자 읽은 지점)
    let oldestTs = null;           // 더 불러오기 커서(가장 오래된 메시지 시각)
    let newestTs = null;           // 실시간 구독 기준(이 시각 이후만 구독)
    let unsubLive = null, unsubReads = null, unsubRoom = null;
    let loadingOlder = false, noMoreOlder = false;
    let memberCount = 0;
    let rosterArr = [];          // 2단계 이상 전체 명단 [{uid,name}] (관리자가 권한관리 창에서 저장)
    let audioCtx = null;

    const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ms = (ts) => ts && ts.toMillis ? ts.toMillis()
      : (ts && ts.seconds ? ts.seconds * 1000 : 0);

    function fmtTime(d) {
      let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
      const ap = h < 12 ? '오전' : '오후'; h = h % 12; if (h === 0) h = 12;
      return ap + ' ' + h + ':' + m;
    }
    function dayLabel(d) {
      const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
      return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + wk + '요일';
    }
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    // ── 인증 가드: 비로그인/등급 미달이면 메인으로 ──
    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.replace('index.html'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const lv = snap.exists() ? (snap.data().level || 1) : 1;
        if (lv < 2) { alert('채팅은 회원(2단계 이상)만 이용할 수 있습니다.'); location.replace('index.html'); return; }
        me = { uid: user.uid, name: (snap.data().name || user.displayName || '성도'), level: lv };
        if (IS_PRIVATE) {   // dm/group: 방 문서의 members에 내가 있어야 입장
          const rs = await getDoc(doc(db, 'rooms', ROOM));
          if (!rs.exists()) { alert('대화방이 없습니다.'); location.replace('chatlist.html'); return; }
          const data = rs.data();
          if (!(data.members || []).includes(me.uid)) {
            alert('이 대화방에 들어갈 수 없습니다.'); location.replace('chatlist.html'); return;
          }
          myJoinMs = data.joined && data.joined[me.uid] ? ms(data.joined[me.uid]) : 0;
        }
        await ensureRoom();
        subscribeRoom();
        if (ROOM === 'all' && me.level >= 4) refreshMemberCount();   // 전체방에서만 관리자 명단 갱신
        subscribeReads();
        await initialLoad();
      } catch (e) {
        alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        location.replace('index.html');
      }
    });

    // 방 문서가 없으면 최초 1회 생성 (고정 id 'all')
    async function ensureRoom() {
      if (IS_PRIVATE) return;   // dm/group 방은 명단/추가에서 미리 생성됨
      const ref = doc(db, 'rooms', ROOM);
      const s = await getDoc(ref);
      if (!s.exists()) {
        await setDoc(ref, { name: '전체방', type: 'all', createdAt: serverTimestamp() });
      }
    }

    // ── 방 문서 구독: 종류·멤버·이름·합류시각·회원수 반영 ──
    function subscribeRoom() {
      unsubRoom = onSnapshot(doc(db, 'rooms', ROOM), (s) => {
        const v = s.data() || {};
        memberCount = v.memberCount || 0;
        rosterArr = Array.isArray(v.roster) ? v.roster : [];
        roomType = v.type || (IS_PRIVATE ? 'dm' : 'all');
        roomMembers = Array.isArray(v.members) ? v.members : [];
        roomName = v.name || '';
        joinedMap = v.joined || {};
        if (joinedMap[me.uid]) myJoinMs = ms(joinedMap[me.uid]);
        updateHeader();
        render();   // 명단 갱신 시 안 읽은 수 재계산
      });
    }

    // 헤더 제목·인원수·버튼 갱신
    function updateHeader() {
      if (!IS_PRIVATE) {   // 전체방
        $('roomTitle').textContent = roomName || '전체방';
        $('memberInfo').textContent = memberCount ? (memberCount + '명') : '';
        $('editNameBtn').style.display = 'none';
        $('addPplBtn').style.display = 'none';
        return;
      }
      const cnt = memberCount || roomMembers.length;
      const others = rosterArr.filter((m) => m.uid !== me.uid);
      if (cnt <= 2) {   // 1:1
        $('roomTitle').textContent = roomName || (others[0] ? others[0].name : '대화');
        $('memberInfo').textContent = '';
        $('editNameBtn').style.display = 'none';
      } else {          // 그룹
        const base = roomName || ((others[0] ? others[0].name : '대화') + ' 외 ' + (cnt - 1) + '명');
        $('roomTitle').textContent = base;
        $('memberInfo').textContent = cnt + '명';
        $('editNameBtn').style.display = '';
      }
      $('addPplBtn').style.display = '';   // private 방이면 사람 추가 버튼 표시
    }
    // 관리자만: 2단계 이상 명단·수를 세어 방에 기록(권한관리 창 외 보조 갱신 경로)
    async function refreshMemberCount() {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('level', '>=', 2)));
        const members = [];
        snap.forEach((d) => members.push({ uid: d.id, name: d.data().name || '성도' }));
        await setDoc(doc(db, 'rooms', ROOM),
          { memberCount: members.length, roster: members }, { merge: true });
      } catch (e) {}
    }

    // ── 회원별 '읽은 지점' 실시간 구독 (A방식 핵심) ──
    function subscribeReads() {
      unsubReads = onSnapshot(collection(db, 'rooms', ROOM, 'reads'), (snap) => {
        reads.clear();
        snap.forEach((d) => {
          const v = d.data();
          reads.set(d.id, { ms: ms(v.lastReadAt), name: v.name || '' });
        });
        render();   // 안 읽은 수만 갱신
      });
    }

    // ── 최초 로드: 최근 50개 가져오고 이후 실시간 구독 시작 ──
    async function initialLoad() {
      const q = query(collection(db, 'rooms', ROOM, 'messages'),
        orderBy('createdAt', 'desc'), limit(PAGE));
      const snap = await getDocs(q);
      const arr = [];
      snap.forEach((d) => arr.push(Object.assign({ id: d.id }, d.data())));
      arr.reverse();
      arr.forEach((m) => byId.set(m.id, m));
      if (arr.length) { oldestTs = arr[0].createdAt; newestTs = arr[arr.length - 1].createdAt; }
      noMoreOlder = arr.length < PAGE;
      $('loadMore').style.display = noMoreOlder ? 'none' : 'block';
      render(true);
      markReadSoon();
      subscribeLive();
    }

    // 최초 로드 이후 새로 올라오는 메시지만 구독(window 밀림 방지, 비용 최소)
    function subscribeLive() {
      const base = newestTs || Timestamp.fromMillis(0);
      const q = query(collection(db, 'rooms', ROOM, 'messages'),
        where('createdAt', '>', base), orderBy('createdAt', 'asc'));
      unsubLive = onSnapshot(q, (snap) => {
        let incoming = false, fromOther = false;
        snap.docChanges().forEach((ch) => {
          const m = Object.assign({ id: ch.doc.id }, ch.doc.data());
          if (ch.type === 'removed') { byId.delete(m.id); return; }
          if (!byId.has(m.id)) { incoming = true; if (m.authorUid !== me.uid) fromOther = true; }
          byId.set(m.id, m);
          if (m.createdAt && ms(m.createdAt) > ms(newestTs)) newestTs = m.createdAt;
        });
        if (incoming) {
          const wasBottom = atBottom();
          render(wasBottom);
          if (fromOther && document.visibilityState === 'visible') ding();
          if (document.visibilityState === 'visible') markReadSoon();
        } else {
          render();
        }
      });
    }

    // ── 이전 메시지 더 불러오기 (위로 스크롤 / 버튼) ──
    async function loadOlder() {
      if (loadingOlder || noMoreOlder || !oldestTs) return;
      loadingOlder = true;
      const area = $('msgArea');
      const prevH = area.scrollHeight, prevTop = area.scrollTop;
      try {
        const q = query(collection(db, 'rooms', ROOM, 'messages'),
          orderBy('createdAt', 'desc'), startAfter(oldestTs), limit(PAGE));
        const snap = await getDocs(q);
        const arr = [];
        snap.forEach((d) => arr.push(Object.assign({ id: d.id }, d.data())));
        if (arr.length) { arr.reverse(); arr.forEach((m) => byId.set(m.id, m)); oldestTs = arr[0].createdAt; }
        if (arr.length < PAGE) { noMoreOlder = true; $('loadMore').style.display = 'none'; }
        render();
        area.scrollTop = prevTop + (area.scrollHeight - prevH);   // 스크롤 위치 보존
      } catch (e) {} finally { loadingOlder = false; }
    }

    function atBottom() {
      const a = $('msgArea');
      return a.scrollTop + a.clientHeight >= a.scrollHeight - 80;
    }

    // 메시지 1건의 '안 읽은 사람 수'
    //  - 명단(roster)이 있으면 2단계 이상 전원 기준(작성자 제외, 안 읽었거나 읽은 지점이 이전인 사람)
    //  - 명단이 아직 없으면(관리자 미저장) reads 기록이 있는 사람들 기준으로 임시 계산
    function computeUnread(m) {
      const t = ms(m.createdAt);
      if (!t) return 0;
      let n = 0;
      if (rosterArr.length) {
        rosterArr.forEach((u) => {
          if (u.uid === m.authorUid) return;
          const r = reads.get(u.uid);
          if (!r || r.ms < t) n++;
        });
      } else {
        reads.forEach((r, uid) => { if (uid !== m.authorUid && r.ms < t) n++; });
      }
      return n;
    }

    // ── 렌더 (날짜 구분 + 연속 묶기 + 말풍선 + 안 읽은 수) ──
    function render(toBottom) {
      const list = $('msgList');
      const arr = Array.from(byId.values()).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
      if (!arr.length) { list.innerHTML = '<div class="empty">첫 인사를 남겨 보세요.</div>'; return; }
      let html = '', prevDate = null, prevUid = null, prevMin = null;
      arr.forEach((m) => {
        const t = ms(m.createdAt);
        if (myJoinMs && t && t < myJoinMs) return;   // 합류 이전 메시지는 화면에서 가림
        const d = t ? new Date(t) : new Date();
        if (!prevDate || !sameDay(prevDate, d)) {
          html += '<div class="day"><span>' + dayLabel(d) + '</span></div>';
          prevUid = null;
        }
        if (m.system) {   // 입장/시스템 안내
          html += '<div class="sys"><span>' + esc(m.text) + '</span></div>';
          prevDate = d; prevUid = null; prevMin = null; return;
        }
        const mine = (m.authorUid === me.uid);
        const minute = Math.floor(t / 60000);
        const cont = (prevUid === m.authorUid && prevMin === minute);
        const unread = computeUnread(m);
        const ur = unread > 0 ? '<span class="unread">' + unread + '</span>' : '';
        const tm = '<span class="time">' + fmtTime(d) + '</span>';
        const bub = '<div class="bub">' + esc(m.text) + '</div>';
        const meta = '<div class="meta">' + ur + tm + '</div>';
        if (mine) {
          html += '<div class="line me' + (cont ? ' cont' : '') + '">' +
            '<div class="col"><div class="bubrow">' + bub + meta + '</div></div></div>';
        } else {
          const av = cont ? '<div class="av ph"></div>'
            : '<div class="av">' + esc((m.authorName || '?').slice(0, 1)) + '</div>';
          const nm = cont ? '' : '<div class="nm">' + esc(m.authorName || '') + '</div>';
          html += '<div class="line other' + (cont ? ' cont' : '') + '">' + av +
            '<div class="col">' + nm + '<div class="bubrow">' + bub + meta + '</div></div></div>';
        }
        prevDate = d; prevUid = m.authorUid; prevMin = minute;
      });
      list.innerHTML = html;
      if (toBottom) { const a = $('msgArea'); a.scrollTop = a.scrollHeight; }
    }

    // ── 내 '읽은 지점' 갱신 (디바운스로 묶어 비용 절감) ──
    let markTimer = null;
    function markReadSoon() { clearTimeout(markTimer); markTimer = setTimeout(markRead, 700); }
    async function markRead() {
      if (!newestTs) return;
      const mine = reads.get(me.uid);
      if (mine && mine.ms >= ms(newestTs)) return;   // 이미 최신까지 읽음 → 쓰기 생략
      try {
        await setDoc(doc(db, 'rooms', ROOM, 'reads', me.uid),
          { lastReadAt: newestTs, name: me.name, updatedAt: serverTimestamp() }, { merge: true });
      } catch (e) {}
    }

    // ── 전송 ──
    async function send() {
      const v = $('msgInput').value.trim();
      if (!v) return;
      $('sendBtn').disabled = true;
      resumeAudio();
      try {
        await addDoc(collection(db, 'rooms', ROOM, 'messages'),
          { text: v, authorUid: me.uid, authorName: me.name, createdAt: serverTimestamp() });
        await setDoc(doc(db, 'rooms', ROOM),
          { lastMessageAt: serverTimestamp(), lastMessageText: v.slice(0, 60), lastMessageBy: me.name },
          { merge: true });
        $('msgInput').value = '';
        togglePanel(false);
      } catch (e) { alert('전송에 실패했습니다.'); }
      finally { updateSendBtn(); $('msgInput').focus(); }
    }
    $('sendBtn').addEventListener('click', send);
    $('msgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    // 전송 버튼: 입력 없으면 비활성(회색), 있으면 활성(노랑)
    function updateSendBtn() { $('sendBtn').disabled = ($('msgInput').value.trim() === ''); }
    $('msgInput').addEventListener('input', updateSendBtn);
    updateSendBtn();
    $('loadMoreBtn').addEventListener('click', loadOlder);
    // 첨부·파일: 현재 표시만, 기능은 추후 (저장소 결정 후)
    ['attachBtn', 'fileBtn'].forEach((id) =>
      $(id).addEventListener('click', () => alert('준비 중입니다.')));

    // ── 이모지/스티커 패널 ──
    const EMOJIS = ['😊','😄','🙂','😉','😍','🥰','😂','🤣','😅','😎','🤔','😮',
      '😢','😭','🥳','😴','🙏','👍','👏','🙌','🤝','🫶','❤️','🧡',
      '💛','💚','💙','💜','🤍','🎉','✨','🔥','⭐','💯','🙇','✝️'];
    (function buildPanel() {
      const eg = $('epEmoji');
      EMOJIS.forEach((e) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ep-em'; b.textContent = e;
        b.addEventListener('click', () => { $('msgInput').value += e; updateSendBtn(); });
        eg.appendChild(b);
      });
      const sg = $('epStickerGrid');     // 스티커 자리표시(형태만)
      for (let i = 0; i < 12; i++) {
        const c = document.createElement('div'); c.className = 'ep-scell'; c.textContent = '그림';
        sg.appendChild(c);
      }
    })();
    function togglePanel(force) {
      const ep = $('emojiPanel');
      const open = (force !== undefined) ? force : (ep.style.display === 'none');
      ep.style.display = open ? 'block' : 'none';
      $('emojiBtn').classList.toggle('on', open);
    }
    $('emojiBtn').addEventListener('click', () => togglePanel());
    $('epAdd').addEventListener('click', () => alert('준비 중입니다.'));
    document.querySelectorAll('.ep-tab[data-tab]').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.ep-tab').forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        const isEmoji = t.getAttribute('data-tab') === 'emoji';
        $('epEmoji').style.display = isEmoji ? 'grid' : 'none';
        $('epSticker').style.display = isEmoji ? 'none' : 'block';
      });
    });
    $('msgArea').addEventListener('scroll', () => { if ($('msgArea').scrollTop < 40) loadOlder(); });

    // ── 방 이름 수정 (그룹) ──
    $('editNameBtn').addEventListener('click', async () => {
      const cur = roomName || $('roomTitle').textContent;
      const v = prompt('방 이름', cur);
      if (v === null) return;
      const name = v.trim();
      try {
        await setDoc(doc(db, 'rooms', ROOM), { name: name }, { merge: true });
      } catch (e) { alert('이름을 바꾸지 못했습니다.'); }
    });

    // ── 사람 추가 (명단에서 선택 → 이 방에 합류) ──
    const addSel = new Set();
    $('addPplBtn').addEventListener('click', openAddModal);
    $('addModal').addEventListener('click', (e) => { if (e.target.id === 'addModal') closeAddModal(); });
    $('addDone').addEventListener('click', applyAdd);

    async function openAddModal() {
      addSel.clear();
      $('addList').innerHTML = '<div class="empty">불러오는 중…</div>';
      $('addModal').classList.add('on');
      let all = [];
      try {
        const s = await getDoc(doc(db, 'rooms', 'all'));
        all = (s.exists() && Array.isArray(s.data().roster)) ? s.data().roster : [];
      } catch (e) {}
      const cand = all.filter((m) => m.uid && !roomMembers.includes(m.uid));
      cand.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      if (!cand.length) { $('addList').innerHTML = '<div class="empty">추가할 수 있는 사람이 없습니다.</div>'; return; }
      $('addList').innerHTML = cand.map((m) => (
        '<div class="prow" data-uid="' + esc(m.uid) + '" data-name="' + esc(m.name || '성도') + '">' +
        '<span class="ck">✓</span>' +
        '<span class="pav">' + esc((m.name || '성').slice(0, 1)) + '</span>' +
        '<span style="font-size:14px;">' + esc(m.name || '성도') + '</span></div>'
      )).join('');
      $('addList').querySelectorAll('.prow').forEach((el) => {
        el.addEventListener('click', () => {
          const uid = el.getAttribute('data-uid');
          if (addSel.has(uid)) { addSel.delete(uid); el.classList.remove('sel'); }
          else { addSel.add(uid); el.classList.add('sel'); }
        });
      });
    }
    function closeAddModal() { $('addModal').classList.remove('on'); }

    async function applyAdd() {
      if (!addSel.size) { closeAddModal(); return; }
      const chosen = [];
      $('addList').querySelectorAll('.prow').forEach((el) => {
        const uid = el.getAttribute('data-uid');
        if (addSel.has(uid)) chosen.push({ uid: uid, name: el.getAttribute('data-name') });
      });
      try {
        const ref = doc(db, 'rooms', ROOM);
        const newMembers = roomMembers.slice();
        const newRoster = rosterArr.slice();
        const joined = Object.assign({}, joinedMap);
        const now = Timestamp.now();
        chosen.forEach((c) => {
          if (!newMembers.includes(c.uid)) newMembers.push(c.uid);
          if (!newRoster.some((r) => r.uid === c.uid)) newRoster.push({ uid: c.uid, name: c.name });
          joined[c.uid] = now;   // 합류 시각 → 이전 메시지는 그 사람 화면에서 가려짐
        });
        await setDoc(ref, {
          type: newMembers.length > 2 ? 'group' : 'dm',
          members: newMembers, roster: newRoster, memberCount: newMembers.length, joined: joined
        }, { merge: true });
        // 입장 안내 메시지
        const names = chosen.map((c) => c.name).join(', ');
        await addDoc(collection(db, 'rooms', ROOM, 'messages'),
          { system: true, text: names + '님이 들어왔습니다', authorUid: me.uid, authorName: me.name, createdAt: serverTimestamp() });
        await setDoc(ref, { lastMessageAt: serverTimestamp(), lastMessageText: names + '님이 들어왔습니다', lastMessageBy: me.name }, { merge: true });
      } catch (e) { alert('추가하지 못했습니다.'); }
      closeAddModal();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markReadSoon();
    });

    // ── 알림음 (켜놓은 상태에서 남의 새 메시지 도착 시) ──
    function resumeAudio() {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
      } catch (e) {}
    }
    function ding() {
      try {
        resumeAudio(); if (!audioCtx) return;
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + 0.26);
      } catch (e) {}
    }
    window.addEventListener('pointerdown', resumeAudio, { once: true });
    window.addEventListener('beforeunload', () => {
      if (unsubLive) unsubLive(); if (unsubReads) unsubReads(); if (unsubRoom) unsubRoom();
    });
  