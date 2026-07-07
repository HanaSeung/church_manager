
    function adjustHeadSpace() {
      var head = document.getElementById('fixedHead');
      var wrap = document.querySelector('.wrap');
      if (head && wrap) wrap.style.paddingTop = (head.offsetHeight + 12) + 'px';
    }
    window.addEventListener('resize', adjustHeadSpace);
    window.addEventListener('load', adjustHeadSpace);

    var BOOKS = [];
    var curBook = '';
    var maxNum = 645;
    var curNum = 1;
    var zoom = 100;

    var numInput = document.getElementById('numInput');
    var statusEl = document.getElementById('status');
    var stage = document.getElementById('stage');
    var img = document.getElementById('hymnImg');

    fetch('data/hymn/hymnbooks.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        BOOKS = (list && list.length) ? list : [];
        if (!BOOKS.length) throw new Error('no books');
        loadBook(BOOKS[0]);
      })
      .catch(function () {
        statusEl.textContent = '찬송가 데이터를 찾을 수 없습니다. data/hymn 폴더를 확인하세요.';
      });

    function loadBook(name) {
      fetch('data/hymn/' + encodeURIComponent(name) + '.json')
        .then(function (r) { return r.json(); })
        .then(function (meta) {
          curBook = name;
          maxNum = meta.max || 645;
          numInput.max = maxNum;
          statusEl.style.display = 'none';
          showNum(1);
          adjustHeadSpace();
        })
        .catch(function () {
          statusEl.style.display = 'block';
          statusEl.textContent = name + ' 정보를 불러오지 못했습니다.';
        });
    }

    function showNum(n) {
      n = parseInt(n, 10);
      if (isNaN(n) || n < 1) n = 1;
      if (n > maxNum) n = maxNum;
      curNum = n;
      numInput.value = n;
      zoom = 100;
      img.src = 'data/hymn/' + encodeURIComponent(curBook) + '/p' + n + '.png';
      img.alt = curBook + ' ' + n + '장';
      applyZoom();
      window.scrollTo(0, 0);
    }

    function applyZoom() {
      img.style.width = zoom + '%';
    }

    // 입력칸을 누르면 기존 숫자를 전체 선택 → 새 숫자 입력 시 바로 교체
    function selectNum() { numInput.select(); }
    numInput.addEventListener('focus', selectNum);
    numInput.addEventListener('click', selectNum);

    numInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { showNum(numInput.value); numInput.blur(); }
    });
    document.getElementById('prevBtn').addEventListener('click', function () {
      if (curNum > 1) showNum(curNum - 1);
    });
    document.getElementById('nextBtn').addEventListener('click', function () {
      if (curNum < maxNum) showNum(curNum + 1);
    });
    document.getElementById('zoomIn').addEventListener('click', function () {
      zoom = Math.min(zoom + 20, 300); applyZoom();
    });
    document.getElementById('zoomOut').addEventListener('click', function () {
      zoom = Math.max(zoom - 20, 60); applyZoom();
    });
  