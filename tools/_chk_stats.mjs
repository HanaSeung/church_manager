
  import { auth, db } from "./firebase-config.js";
  import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
  import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

  const $ = (id) => document.getElementById(id);
  const MIN_LEVEL = 3;

  // PC 는 표를 새 창에 띄운다(가로 제한 없이 전체화면). 폰은 새 창이 어색해서 그대로 이동한다.
  const PC = window.matchMedia('(min-width:900px)').matches;
  if (PC) $('note').textContent = '표는 새 창으로 열립니다. 창을 닫으면 이 화면으로 돌아옵니다.';

  $('backBtn').onclick = () => { location.href = 'index.html'; };
  document.querySelectorAll('[data-go]').forEach((el) => {
    el.onclick = () => { location.href = 'offering.html?tab=' + el.dataset.go; };
  });

  document.querySelectorAll('[data-type]').forEach((el) => {
    el.onclick = () => {
      const url = 'report.html?type=' + el.dataset.type;
      if (!PC) { location.href = url; return; }
      // 팝업이 차단되면 같은 탭으로 떨어뜨린다. 눌렀는데 아무 일도 안 일어나면 안 된다.
      const w = window.open(url, '_blank');
      if (!w) location.href = url;
    };
  });

  // 메뉴는 권한만 확인한다. 데이터는 각 보고서 창에서 읽는다(메뉴가 즉시 뜬다).
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace('index.html'); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      const lv = snap.exists() ? (snap.data().level || 1) : 1;
      if (lv < MIN_LEVEL) { alert('통계는 재정 담당자만 이용할 수 있습니다.'); location.replace('index.html'); }
    } catch (e) {
      console.error(e);
    }
  });
