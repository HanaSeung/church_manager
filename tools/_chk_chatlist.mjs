
    import { auth, db } from "./firebase-config.js";
    import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
    import {
      collection, doc, getDoc, getDocs, setDoc, serverTimestamp, query, where, onSnapshot,
      Timestamp, getCountFromServer
    } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

    const $ = (id) => document.getElementById(id);
    const esc = (s) => (s || '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ms = (ts) => ts && ts.toMillis ? ts.toMillis()
      : (ts && ts.seconds ? ts.seconds * 1000 : 0);
    let me = { uid: null, name: '', level: 1 };

    // 시간 표시: 오늘이면 오전/오후 h:mm, 어제면 '어제', 그 외 m월 d일
    function fmtWhen(d) {
      if (!d) return '';
      const now = new Date();
      const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      if (sameDay) {
        let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
        const ap = h < 12 ? '오전' : '오후'; h = h % 12; if (h === 0) h = 12;
        return ap + ' ' + h + ':' + m;
      }
      const y = new Date(now); y.setDate(now.getDate() - 1);
      if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '어제';
      return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    }

    // ── 인증 가드 ──
    onAuthStateChanged(auth, async (user) => {
      if (!user) { location.replace('index.html'); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const lv = snap.exists() ? (snap.data().level || 1) : 1;
        if (lv < 2) { alert('채팅은 회원(2단계 이상)만 이용할 수 있습니다.'); location.replace('index.html'); return; }
        me = { uid: user.uid, name: (snap.data().name || user.displayName || '성도'), level: lv };
        watchRooms();
        loadRoster();
      } catch (e) {
        alert('정보를 불러오지 못했습니다.'); location.replace('index.html');
      }
    });

    // ── 채팅 탭: 방 목록 (전체방 + 내 1:1 방) ──
    const roomsMap = new Map();
    let renderSeq = 0;
    function watchRooms() {
      // 전체방
      onSnapshot(doc(db, 'rooms', 'all'), (s) => {
        if (s.exists()) roomsMap.set('all', { id: 'all', ...s.data() });
        else roomsMap.delete('all');
        renderRooms();
      });
      // 내가 속한 1:1 방
      onSnapshot(query(collection(db, 'rooms'), where('members', 'array-contains', me.uid)), (snap) => {
        [...roomsMap.keys()].forEach((k) => { if (k !== 'all') roomsMap.delete(k); });
        snap.forEach((d) => roomsMap.set(d.id, { id: d.id, ...d.data() }));
        renderRooms();
      });
    }

    async function renderRooms() {
      const seq = ++renderSeq;
      const rooms = [...roomsMap.values()].sort((a, b) => ms(b.lastMessageAt) - ms(a.lastMessageAt));
      if (!rooms.length) { $('viewChat').innerHTML = '<div class="empty">채팅방이 없습니다.</div>'; return; }
      const rows = await Promise.all(rooms.map(roomRow));
      if (seq !== renderSeq) return;   // 더 최신 렌더가 있으면 폐기
      $('viewChat').innerHTML = rows.join('');
      document.querySelectorAll('#viewChat .row').forEach((el) =>
        el.addEventListener('click', () => { location.href = 'chat.html?room=' + el.getAttribute('data-room'); }));
    }

    async function roomUnread(roomId) {
      let base = Timestamp.fromMillis(0);
      try {
        const rs = await getDoc(doc(db, 'rooms', roomId, 'reads', me.uid));
        if (rs.exists() && rs.data().lastReadAt) base = rs.data().lastReadAt;
      } catch (e) {}
      try {
        const c = await getCountFromServer(query(
          collection(db, 'rooms', roomId, 'messages'), where('createdAt', '>', base)));
        return c.data().count;
      } catch (e) { return 0; }
    }

    async function roomRow(r) {
      let name, cnt = '';
      const isPrivate = (r.id !== 'all' && r.type !== 'all');
      if (!isPrivate) {
        name = r.name || '전체방';
        if (r.memberCount) cnt = `<span class="cnt">${r.memberCount}</span>`;
      } else {
        const cntNum = r.memberCount || (Array.isArray(r.members) ? r.members.length : 0);
        const others = Array.isArray(r.roster) ? r.roster.filter((m) => m.uid !== me.uid) : [];
        if (cntNum <= 2) {
          name = r.name || (others[0] ? others[0].name : '대화');
        } else {
          name = r.name || ((others[0] ? others[0].name : '대화') + ' 외 ' + (cntNum - 1) + '명');
          cnt = `<span class="cnt">${cntNum}</span>`;
        }
      }
      const last = esc(r.lastMessageText || '메시지가 없습니다.');
      const when = fmtWhen(r.lastMessageAt ? new Date(ms(r.lastMessageAt)) : null);
      const unread = await roomUnread(r.id);
      const badge = unread > 0 ? `<span class="badge">${unread > 999 ? '999+' : unread}</span>` : '';
      return `<div class="row" data-room="${esc(r.id)}">
        <div class="av">${esc(name.slice(0, 1))}</div>
        <div class="mid"><div class="nm">${esc(name)}${cnt}</div><div class="sub">${last}</div></div>
        <div class="rt"><span class="tm">${when}</span>${badge}</div>
      </div>`;
    }

    // ── 명단 탭: 등록 회원 (rooms/all roster, 이름만) ──
    async function loadRoster() {
      try {
        const s = await getDoc(doc(db, 'rooms', 'all'));
        const roster = (s.exists() && Array.isArray(s.data().roster)) ? s.data().roster.slice() : [];
        roster.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
        if (!roster.length) {
          $('viewRoster').innerHTML = '<div class="empty">명단이 아직 없습니다.<br>관리자가 권한 관리를 한 번 열면 채워집니다.</div>';
          return;
        }
        let html = `<div class="sec">회원 ${roster.length}명</div>`;
        roster.forEach((m) => {
          const nm = esc(m.name || '성도');
          const meTag = (m.uid === me.uid) ? ' <span style="color:var(--faint); font-weight:400; font-size:13px;">(나)</span>' : '';
          html += `<div class="row roster-row" data-uid="${esc(m.uid || '')}" data-name="${nm}">
            <div class="av">${esc((m.name || '성').slice(0, 1))}</div>
            <div class="mid"><div class="nm">${nm}${meTag}</div></div>
          </div>`;
        });
        $('viewRoster').innerHTML = html;
        document.querySelectorAll('#viewRoster .roster-row').forEach((el) => {
          const uid = el.getAttribute('data-uid');
          if (!uid || uid === me.uid) { el.style.cursor = 'default'; return; }   // 본인/빈 uid는 방 생성 안 함
          el.addEventListener('click', () => openDM(uid, el.getAttribute('data-name')));
        });
      } catch (e) {
        $('viewRoster').innerHTML = '<div class="empty">명단을 불러오지 못했습니다.</div>';
      }
    }

    // ── 탭 전환 ──
    const TITLES = { roster: '명단', chat: '채팅', settings: '설정' };
    document.querySelectorAll('.tab[data-view]').forEach((t) => {
      t.addEventListener('click', () => {
        const v = t.getAttribute('data-view');
        document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        $('viewChat').style.display = v === 'chat' ? '' : 'none';
        $('viewRoster').style.display = v === 'roster' ? '' : 'none';
        $('viewSettings').style.display = v === 'settings' ? '' : 'none';
        $('barTitle').textContent = TITLES[v];
        $('addBtn').style.display = v === 'chat' ? '' : 'none';
      });
    });

    // ── 방 추가(누구나) · 현재 자리만 ──
    $('addBtn').addEventListener('click', () => alert('준비 중입니다.'));

    // ── 설정: 미구현 항목 안내 ──
    document.querySelectorAll('#viewSettings .soon').forEach((el) =>
      el.addEventListener('click', () => alert('준비 중입니다.')));

    // ── 1:1 대화방 열기 (명단에서 사람 클릭) ──
    async function openDM(otherUid, otherName) {
      if (!otherUid || otherUid === me.uid) return;   // 본인은 방 안 만듦
      const dmId = 'dm_' + [me.uid, otherUid].sort().join('_');
      try {
        const ref = doc(db, 'rooms', dmId);
        const s = await getDoc(ref);
        if (!s.exists()) {
          await setDoc(ref, {
            type: 'dm',
            members: [me.uid, otherUid],
            memberCount: 2,
            roster: [{ uid: me.uid, name: me.name }, { uid: otherUid, name: otherName || '성도' }],
            createdAt: serverTimestamp()
          });
        }
        location.href = 'chat.html?room=' + dmId;
      } catch (e) {
        alert('대화방을 열지 못했습니다.');
      }
    }

    // ── 로그아웃 ──
    $('logoutBtn').addEventListener('click', async () => {
      try { await signOut(auth); } catch (e) {}
      location.replace('index.html');
    });
  