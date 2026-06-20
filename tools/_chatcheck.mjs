
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
      query, where, orderBy, limit, startAfter, onSnapshot,
      serverTimestamp, Timestamp, getCountFromServer
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    const ROOM = 'all';
    const PAGE = 50;

    let me = { uid: null, name: '', level: 1 };
    const byId = new Map();        // 메시지 id -> data (older + live 통합 저장소)
    const reads = new Map();       // 회원 uid -> { ms, name }  (각자 읽은 지점)
    let oldestTs = null;           // 더 불러오기 커서(가장 오래된 메시지 시각)
    let newestTs = null;           // 실시간 구독 기준(이 시각 이후만 구독)
    let unsubLive = null, unsubReads = null, unsubRoom = null;
    let loadingOlder = false, noMoreOlder = false;
    let memberCount = 0;
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
        if (lv < 2) { alert('전체방은 회원(2단계 이상)만 이용할 수 있습니다.'); location.replace('index.html'); return; }
        me = { uid: user.uid, name: (snap.data().name || user.displayName || '성도'), level: lv };
        await ensureRoom();
        subscribeRoom();
        if (me.level >= 4) refreshMemberCount();   // 관리자가 들어올 때 전체 회원 수 갱신
        subscribeReads();
        await initialLoad();
      } catch (e) {
        alert('정보를 불러오지 못했습니다. 다시 시도해 주세요.');
        location.replace('index.html');
      }
    });

    // 방 문서가 없으면 최초 1회 생성 (고정 id 'all')
    async function ensureRoom() {
      const ref = doc(db, 'rooms', ROOM);
      const s = await getDoc(ref);
      if (!s.exists()) {
        await setDoc(ref, { name: '전체방', type: 'all', createdAt: serverTimestamp() });
      }
    }

    // ── 방 문서 구독: 전체 회원 수(memberCount) 헤더 표시 ──
    function subscribeRoom() {
      unsubRoom = onSnapshot(doc(db, 'rooms', ROOM), (s) => {
        const v = s.data() || {};
        memberCount = v.memberCount || 0;
        $('memberInfo').textContent = memberCount ? (memberCount + '명') : '';
      });
    }
    // 관리자만: 2단계 이상 전체 회원 수를 세어 방에 기록(모든 회원이 읽어 표시)
    async function refreshMemberCount() {
      try {
        const q = query(collection(db, 'users'), where('level', '>=', 2));
        const c = await getCountFromServer(q);
        await setDoc(doc(db, 'rooms', ROOM), { memberCount: c.data().count }, { merge: true });
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

    // 메시지 1건의 '안 읽은 사람 수' = 작성자 제외, 읽은 지점이 이 메시지보다 이전인 회원 수
    function computeUnread(m) {
      const t = ms(m.createdAt);
      if (!t) return 0;
      let n = 0;
      reads.forEach((r, uid) => { if (uid !== m.authorUid && r.ms < t) n++; });
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
        const d = t ? new Date(t) : new Date();
        if (!prevDate || !sameDay(prevDate, d)) {
          html += '<div class="day"><span>' + dayLabel(d) + '</span></div>';
          prevUid = null;
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
      } catch (e) { alert('전송에 실패했습니다.'); }
      finally { $('sendBtn').disabled = false; $('msgInput').focus(); }
    }
    $('sendBtn').addEventListener('click', send);
    $('msgInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    $('loadMoreBtn').addEventListener('click', loadOlder);
    $('msgArea').addEventListener('scroll', () => { if ($('msgArea').scrollTop < 40) loadOlder(); });
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
  