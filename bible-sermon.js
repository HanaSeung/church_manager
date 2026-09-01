/* 설교준비 모드 (PC 전용 뷰) — bible.html 엔진(window.BIBLEVIEW) 재사용, 레이아웃만 담당.
   진입: window.SERMON.open() / 종료: window.SERMON.close()
   조건 게이팅(PC & 등급≥2)·진입 버튼은 bible.html이 담당. */
(function () {
  "use strict";
  if (window.SERMON) return;
  var LS = "sermonPrefs.v1";
  var st = { cols: null, sel: null, tab: "comm", stron: false, wonjeon: false, stronAct: null,
             wsFrac: 0.58, infoH: 230, cpVer: null, cpRef: "", cpNums: true, notes: {},
             mode: "par", cmpCols: null };
  try { var raw = localStorage.getItem(LS); if (raw) { var s = JSON.parse(raw); for (var k in s) st[k] = s[k]; } } catch (e) {}
  if (!st.notes) st.notes = {};
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

  function BV() { return window.BIBLEVIEW; }
  var root = null, book = 0, chap = 0, baseVer = "", dataCache = {}, wjData = null;

  function $(s) { return root ? root.querySelector(s) : null; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  /* ---------- 스타일 ---------- */
  var CSS = ""
    + "#sermonRoot{position:fixed;inset:0;z-index:4000;background:var(--bg,#f4f6f2);color:var(--text,#1f2421);display:flex;flex-direction:column;font-family:inherit}"
    + "#sermonRoot .sp-bar{display:flex;align-items:center;gap:10px;padding:11px 16px;background:linear-gradient(180deg,#44855f,#387050);color:#fff}"
    + "#sermonRoot .sp-bar .sp-ico{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.16);border:0;color:#fff;font-size:18px;display:grid;place-items:center;cursor:pointer}"
    + "#sermonRoot .sp-bar .sp-ttl{font-weight:700;font-size:16px}#sermonRoot .sp-bar .sp-sub{font-size:12px;opacity:.85;margin-left:2px}"
    + "#sermonRoot .sp-bar .sp-sp{flex:1}"
    + "#sermonRoot .sp-bar .sp-exit{border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;cursor:pointer}"
    + "#sermonRoot .sp-ws{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.5fr) 7px minmax(0,1fr)}"
    + "#sermonRoot .sp-div{background:#e0e5df;cursor:col-resize;position:relative}#sermonRoot .sp-div::after{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:2px;height:34px;border-radius:2px;background:#9aa89e}#sermonRoot .sp-div:hover{background:#e5f0e8}"
    + "#sermonRoot .sp-pane{display:flex;flex-direction:column;min-height:0;min-width:0;background:#fff}"
    + "#sermonRoot .sp-hd{display:flex;align-items:center;gap:9px;padding:9px 14px;border-bottom:1px solid #eef1ec;flex-wrap:wrap}"
    + "#sermonRoot .sp-nav{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}"
    + "#sermonRoot .sp-nsel{font-family:inherit;font-size:13px;font-weight:600;border:1px solid #e3e8e2;background:#fff;color:#232a24;border-radius:8px;padding:6px 8px;cursor:pointer}#sermonRoot .sp-nsel:focus{outline:none;border-color:#3f7d5c}#sermonRoot .sp-nbook{min-width:100px}"
    + "#sermonRoot .sp-narr{display:inline-flex;gap:4px;margin-left:2px}#sermonRoot .sp-nb{border:1px solid #e3e8e2;background:#fff;color:#2f6147;font-weight:700;border-radius:8px;padding:6px 9px;font-size:13px;line-height:1;cursor:pointer}#sermonRoot .sp-nb:hover{border-color:#3f7d5c;background:#e8f2ea}"
    + "#sermonRoot #spL.cmp .sp-scroll{overflow:hidden}"
    + "#sermonRoot .sp-cmp{display:flex;height:100%;overflow-x:auto;align-items:stretch}"
    + "#sermonRoot .sp-ccol{flex:1 0 360px;border-right:1px solid #e3e8e2;display:flex;flex-direction:column;min-width:0}"
    + "#sermonRoot .sp-chd{padding:8px 10px;border-bottom:1px solid #eef1ec;background:#f6f8f5;display:flex;align-items:center;gap:4px;flex-wrap:nowrap}"
    + "#sermonRoot .sp-chd select{font-family:inherit;font-size:12px;font-weight:600;border:1px solid #e3e8e2;background:#fff;color:#232a24;border-radius:7px;padding:4px 6px;cursor:pointer;min-width:0}#sermonRoot .sp-chd .sp-cvsel{color:#2f6147}#sermonRoot .sp-chd .sp-cbk{min-width:64px}#sermonRoot .sp-chd .sp-nb{flex:0 0 auto;padding:5px 7px}"
    + "#sermonRoot .sp-cx{border:0;background:transparent;color:#93a096;font-size:15px;cursor:pointer;margin-left:auto;padding:0 4px;flex:0 0 auto}#sermonRoot .sp-cx:hover{color:#c76}"
    + "#sermonRoot .sp-cgrip{height:15px;display:flex;align-items:center;justify-content:center;color:#b7c1b8;background:#eef2ec;border-bottom:1px solid #e3e8e2;cursor:grab;font-size:10px;letter-spacing:3px;line-height:1;user-select:none}#sermonRoot .sp-cgrip:hover{color:#3f7d5c;background:#e3ede4}#sermonRoot .sp-cgrip:active{cursor:grabbing}"
    + "#sermonRoot .sp-cbody{flex:1;overflow:auto;min-height:0}"
    + "#sermonRoot .sp-cvrow{display:grid;grid-template-columns:26px 1fr;gap:4px 8px;padding:8px 12px;border-bottom:1px solid #eef1ec;cursor:pointer}#sermonRoot .sp-cvrow:hover{background:#f3f5f2}#sermonRoot .sp-cvrow.sel{background:#fbf0cf}"
    + "#sermonRoot .sp-cvn{color:#3f7d5c;font-weight:700;font-size:12px;text-align:right}#sermonRoot .sp-cvt{font-size:14px;line-height:1.7}"
    + "#sermonRoot.sp-stron #spL.cmp .sp-cvt .w.has{border-bottom:1.5px dotted #3f7d5c;cursor:pointer}"
    + "#sermonRoot .sp-cempty{color:#93a096;font-size:12.5px;text-align:center;padding:24px 10px;line-height:1.6}"
    + "#sermonRoot .sp-tb.on{background:#3f7d5c;color:#fff;border-color:#3f7d5c}"
    + "#sermonRoot .sp-hdsp{flex:1}"
    + "#sermonRoot .sp-tb{border:1px solid #e3e8e2;background:#fff;color:#68766c;border-radius:8px;padding:5px 11px;font-size:12.5px;font-weight:600;cursor:pointer}#sermonRoot .sp-tb:hover{border-color:#3f7d5c;color:#2f6147}#sermonRoot .sp-tb.on{background:#3f7d5c;color:#fff;border-color:#3f7d5c}#sermonRoot .sp-tb:disabled{opacity:.4;cursor:not-allowed;background:#fff;color:#68766c;border-color:#e3e8e2}#sermonRoot .sp-tb:disabled:hover{border-color:#e3e8e2;color:#68766c}"
    + "#sermonRoot .sp-vers{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid #eef1ec}"
    + "#sermonRoot .sp-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #e3e8e2;background:#f6f8f5;border-radius:20px;padding:4px 6px 4px 11px;font-size:12.5px;font-weight:600}#sermonRoot .sp-chip .x{border:0;background:transparent;color:#93a096;font-size:15px;cursor:pointer;padding:0 2px}#sermonRoot .sp-chip .x:hover{color:#c76}"
    + "#sermonRoot .sp-chip[draggable=true]{cursor:grab}#sermonRoot .sp-gh[data-ver]{cursor:grab}#sermonRoot .sp-dragging{opacity:.45}#sermonRoot .sp-dropzone{outline:2px dashed #3f7d5c;outline-offset:-2px;background:#e8f2ea}"
    + "#sermonRoot .sp-add{position:relative}#sermonRoot .sp-addb{border:1px dashed #e3e8e2;background:transparent;color:#2f6147;font-weight:700;border-radius:20px;padding:5px 12px;font-size:12.5px;cursor:pointer}#sermonRoot .sp-addb:disabled{opacity:.4;cursor:not-allowed}"
    + "#sermonRoot .sp-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:30;background:#fff;border:1px solid #e3e8e2;border-radius:10px;box-shadow:0 8px 30px rgba(24,40,30,.14);padding:6px;min-width:150px;max-height:50vh;overflow:auto;display:none}#sermonRoot .sp-menu.open{display:block}#sermonRoot .sp-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#1f2421;padding:8px 10px;border-radius:7px;font-size:13px;cursor:pointer}#sermonRoot .sp-menu button:hover{background:#e8f2ea}"
    + "#sermonRoot .sp-vhint{font-size:12px;color:#93a096;margin-left:2px}"
    + "#sermonRoot .sp-scroll{flex:1;overflow:auto;min-height:0}"
    + "#sermonRoot .sp-head{display:grid;width:100%;min-width:100%;position:sticky;top:0;z-index:12;background:#f6f8f5}"
    + "#sermonRoot .sp-grid{display:grid;width:100%;min-width:100%}"
    + "#sermonRoot .sp-gh{background:#f6f8f5;font-weight:700;font-size:12.5px;color:#68766c;padding:9px 12px;border-bottom:1px solid #e3e8e2;white-space:nowrap}#sermonRoot .sp-gh.corner{position:sticky;left:0;z-index:13}#sermonRoot .sp-gh .lg{font-weight:500;font-size:10.5px;color:#93a096;margin-left:5px}"
    + "#sermonRoot .sp-gn{position:sticky;left:0;z-index:6;background:#fff;color:#3f7d5c;font-weight:700;font-variant-numeric:tabular-nums;font-size:12px;text-align:center;padding:12px 6px;border-bottom:1px solid #eef1ec;cursor:pointer}"
    + "#sermonRoot .sp-gc{padding:11px 13px;font-size:15px;line-height:1.75;border-bottom:1px solid #eef1ec;border-left:1px solid #eef1ec;cursor:pointer}#sermonRoot .sp-gc.en{font-size:13.5px}#sermonRoot .sp-gc:hover{background:#f3f5f2}"
    + "#sermonRoot .sp-row-sel .sp-gc,#sermonRoot .sp-row-sel.sp-gn{background:#fbf0cf !important}#sermonRoot .sp-row-sel .sp-gc{box-shadow:inset 0 0 0 1px rgba(63,125,92,.28)}"
    + "#sermonRoot .sp-note-dot{display:inline-block;margin-left:5px;width:6px;height:6px;border-radius:50%;background:#3f7d5c;vertical-align:middle}"
    + "#sermonRoot.sp-stron .sp-gc .w.has{border-bottom:1.5px dotted #3f7d5c;cursor:pointer;border-radius:2px}#sermonRoot.sp-stron .sp-gc .w.has:hover{background:#e8f2ea}"
    + "#sermonRoot .sp-gc .w{color:inherit}"
    + "#sermonRoot .sp-gwj{grid-column:1 / -1;padding:8px 12px 10px 44px;border-bottom:1px solid #eef1ec;background:#f6f8f5}#sermonRoot .sp-wjcell{display:flex;flex-wrap:wrap;gap:6px 12px}"
    + "#sermonRoot .sp-wt{display:inline-flex;flex-direction:column;align-items:center;line-height:1.25;cursor:pointer;padding:3px 6px;border-radius:7px;text-align:center}#sermonRoot .sp-wt:hover{background:#e8f2ea}#sermonRoot .sp-wt b{font-size:15px;font-weight:600}#sermonRoot .sp-wt em{font-size:11px;font-style:normal;color:#68766c;max-width:96px}#sermonRoot .sp-wt code{font-size:9.5px;color:#2f6147;font-weight:700}"
    + "#sermonRoot .sp-right{display:flex;flex-direction:column;min-height:0}"
    + "#sermonRoot .sp-rtop{display:flex;flex-direction:column;flex:1;min-height:0}"
    + "#sermonRoot .sp-tabs{display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid #eef1ec;flex-wrap:wrap}#sermonRoot .sp-tab{border:0;background:transparent;color:#68766c;font-weight:600;font-size:13px;padding:8px 12px;border-radius:8px 8px 0 0;cursor:pointer;position:relative}#sermonRoot .sp-tab:hover{color:#1f2421}#sermonRoot .sp-tab.on{color:#2f6147;background:#f6f8f5}#sermonRoot .sp-tab.on::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:#3f7d5c;border-radius:2px}"
    + "#sermonRoot .sp-tabbody{flex:1;overflow:auto;padding:15px 16px;min-height:0}"
    + "#sermonRoot .sp-empty{color:#93a096;font-size:13px;text-align:center;padding:32px 10px;line-height:1.7}"
    + "#sermonRoot .sp-cref{font-weight:700;font-size:15px;color:#2f6147;margin:0 0 6px}#sermonRoot .sp-csrc{font-size:11px;color:#93a096;font-weight:600;margin-bottom:10px}#sermonRoot .sp-ctxt{font-size:14px;line-height:1.8}"
    + "#sermonRoot .sp-xr{display:inline-block;border:1px solid #e3e8e2;background:#f6f8f5;color:#2f6147;font-weight:600;border-radius:8px;padding:7px 11px;font-size:13px;margin:0 8px 8px 0;cursor:pointer}#sermonRoot .sp-xr:hover{border-color:#3f7d5c;background:#e8f2ea}"
    + "#sermonRoot .sp-sbar{display:flex;gap:8px;margin-bottom:13px;flex-wrap:wrap}#sermonRoot .sp-sbar input{flex:1;min-width:110px;border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;border-radius:9px;padding:9px 11px;font-size:13.5px;font-family:inherit}#sermonRoot .sp-sbar input:focus{outline:none;border-color:#3f7d5c}#sermonRoot .sp-sbar select{border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;border-radius:9px;padding:0 8px;font-size:13px;font-weight:600}"
    + "#sermonRoot .sp-sres{border:1px solid #eef1ec;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;background:#f6f8f5}#sermonRoot .sp-sres:hover{border-color:#3f7d5c}#sermonRoot .sp-sres .r{font-weight:700;color:#2f6147;font-size:12px;margin-bottom:3px}#sermonRoot .sp-sres .t{font-size:13px;line-height:1.6}#sermonRoot .sp-scount{font-size:12px;color:#68766c;margin-bottom:10px}#sermonRoot mark.q{background:#ffe6a0;border-radius:3px;padding:0 2px;box-shadow:inset 0 -2px 0 #e0b73f}"
    + "#sermonRoot .sp-ta{width:100%;min-height:150px;border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;border-radius:10px;padding:11px 12px;font-size:13.5px;font-family:inherit;line-height:1.7;resize:vertical}#sermonRoot .sp-ta:focus{outline:none;border-color:#3f7d5c}#sermonRoot .sp-nhd{display:flex;align-items:center;gap:8px;margin-bottom:10px}#sermonRoot .sp-nhd .r{font-weight:700;color:#2f6147;font-size:14px}#sermonRoot .sp-saved{font-size:11.5px;color:#3f7d5c;font-weight:600;opacity:0;transition:opacity .2s}#sermonRoot .sp-saved.show{opacity:1}"
    + "#sermonRoot .sp-cprow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:13px}#sermonRoot .sp-cplab{font-size:11px;font-weight:700;color:#93a096;min-width:32px}#sermonRoot .sp-cpsel{border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;border-radius:9px;padding:8px 10px;font-size:13.5px;font-weight:600;font-family:inherit}#sermonRoot .sp-cpin{flex:1;min-width:92px;border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;border-radius:9px;padding:8px 11px;font-size:14px;font-weight:600;font-family:inherit}#sermonRoot .sp-cpin:focus{outline:none;border-color:#3f7d5c}#sermonRoot .sp-cpgo{border:1px solid #3f7d5c;background:#3f7d5c;color:#fff;font-weight:700;border-radius:9px;padding:8px 15px;font-size:13px;cursor:pointer}#sermonRoot .sp-cpgo:hover{background:#2f6147}#sermonRoot .sp-cpv{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}#sermonRoot .sp-mini{border:1px solid #e3e8e2;background:#f6f8f5;color:#1f2421;font-weight:600;border-radius:8px;padding:6px 11px;font-size:12.5px;cursor:pointer}#sermonRoot .sp-mini:hover{border-color:#3f7d5c;color:#2f6147}"
    + "#sermonRoot .sp-hdiv{flex:0 0 auto;height:7px;cursor:row-resize;background:#e0e5df;position:relative}#sermonRoot .sp-hdiv::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:2px;width:34px;border-radius:2px;background:#9aa89e}#sermonRoot .sp-hdiv:hover{background:#e5f0e8}"
    + "#sermonRoot .sp-info{flex:0 0 auto;height:230px;display:flex;flex-direction:column;background:#f6f8f5}#sermonRoot .sp-ihd{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #eef1ec}#sermonRoot .sp-it{font-weight:700;font-size:13px;color:#2f6147}#sermonRoot .sp-isub{font-size:11.5px;color:#93a096}#sermonRoot .sp-ix{border:0;background:transparent;color:#93a096;font-size:15px;cursor:pointer;padding:2px 6px;border-radius:6px}#sermonRoot .sp-ix:hover{color:#1f2421;background:#eef1ec}#sermonRoot .sp-ibody{flex:1;overflow:auto;padding:13px 16px}"
    + "#sermonRoot .sp-iw{font-weight:700;font-size:18px;margin-bottom:2px}#sermonRoot .sp-iref{font-size:11.5px;color:#93a096;font-weight:600;margin-bottom:12px}#sermonRoot .sp-irow{display:flex;gap:10px;margin:7px 0;font-size:14px}#sermonRoot .sp-irow .k{flex:0 0 52px;font-size:12px;font-weight:700;color:#93a096}#sermonRoot .sp-irow .v{flex:1;line-height:1.6}#sermonRoot .sp-icode{color:#2f6147;font-weight:700}#sermonRoot .sp-iempty{color:#93a096;font-size:12.5px;text-align:center;padding:26px 10px;line-height:1.7}"
    + "#sermonRoot .sp-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(12px);background:#1f2421;color:#fff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:10px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:4100}#sermonRoot .sp-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}"
    + "@media (max-width:860px){#sermonRoot .sp-ws{grid-template-columns:1fr}#sermonRoot .sp-div{display:none}}";

  function injectStyle() { if (document.getElementById("sermonStyle")) return; var s = document.createElement("style"); s.id = "sermonStyle"; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- 데이터 ---------- */
  function getData(name, cb) {
    if (dataCache[name]) { cb(dataCache[name]); return; }
    var bv = BV(); var fn = bv.getVersionData || bv.getVersion;
    fn(name, function (d) { if (d) dataCache[name] = d; cb(d); });
  }
  function chapVerses(data) { try { return data.books[book].chapters[chap]; } catch (e) { return null; } }
  function isEng(nm) { return /^(ESV|NIV|KJV|NASB|LXX|NKJV|NLT|NRSV|RSV|NET|AMP|CSB|GNT|MSG|YLT|MLV|Darby|NHEB)/i.test(nm); }
  function bookLabel() { try { var b = BV().bible.books[book]; return (b.abbr || b.name); } catch (e) { return ""; } }
  function bookFull() { try { return BV().bible.books[book].name; } catch (e) { return ""; } }
  function plain(txt) { try { return BV().parText(txt); } catch (e) { return String(txt || "").replace(/<[^>]*>/g, ""); } }
  function renderVT(txt, v, nm) { try { return BV().renderVerseText(txt, v, nm); } catch (e) { return esc(plain(txt)); } }

  var toastT;
  function toast(m) { var t = $(".sp-toast"); if (!t) return; t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("show"); }, 1600); }

  /* ---------- 마크업 ---------- */
  function build() {
    injectStyle();
    root = document.createElement("div"); root.id = "sermonRoot";
    root.innerHTML = ""
      + "<div class='sp-bar'><button class='sp-ico' id='spExit' title='뒤로'>&#8249;</button><span class='sp-ttl'>설교준비</span><span class='sp-sub' id='spSub'></span><span class='sp-sp'></span><button class='sp-exit' id='spExit2'>성경뷰어로</button></div>"
      + "<div class='sp-ws' id='spWs'>"
      +   "<div class='sp-pane' id='spL'>"
      +     "<div class='sp-hd'><span class='sp-nav' id='spNav'></span><span class='sp-hdsp'></span><button class='sp-tb' id='spMode' title='대조 모드: 열마다 다른 본문'>대조</button><button class='sp-tb' id='spAddCol' title='대조 열 추가 (최대 5)' disabled>열 추가</button><button class='sp-tb' id='spStron'>원어</button><button class='sp-tb' id='spWjb'>원전분해</button></div>"
      +     "<div class='sp-vers' id='spVers'></div>"
      +     "<div class='sp-scroll'><div class='sp-head' id='spHead'></div><div class='sp-grid' id='spGrid'></div><div class='sp-cmp' id='spCmp' style='display:none'></div></div>"
      +   "</div>"
      +   "<div class='sp-div' id='spDiv'></div>"
      +   "<div class='sp-pane sp-right' id='spR'>"
      +     "<div class='sp-rtop'>"
      +       "<div class='sp-tabs' id='spTabs'>"
      +         "<button class='sp-tab on' data-tab='comm'>주석</button><button class='sp-tab' data-tab='xref'>상호참조</button><button class='sp-tab' data-tab='search'>단어검색</button><button class='sp-tab' data-tab='note'>노트</button><button class='sp-tab' data-tab='passage'>본문복사</button>"
      +       "</div><div class='sp-tabbody' id='spTabBody'></div>"
      +     "</div>"
      +     "<div class='sp-hdiv' id='spHDiv'></div>"
      +     "<div class='sp-info'><div class='sp-ihd'><span class='sp-it'>정보</span><span class='sp-isub' id='spISub'>원어·원전분해에서 단어를 누르면 여기에 표시됩니다</span><span class='sp-hdsp'></span><button class='sp-ix' id='spIX' title='비우기'>&#10005;</button></div><div class='sp-ibody' id='spIBody'></div></div>"
      +   "</div>"
      + "</div>"
      + "<div class='sp-toast'></div>";
    document.body.appendChild(root);
    wire();
  }

  /* ---------- 렌더: 역본 칩 ---------- */
  function renderVers() {
    var row = $("#spVers"); row.innerHTML = "";
    var all = (BV().versions ? BV().versions() : []) || [];
    var chips = document.createElement("div"); chips.id = "spChips"; chips.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
    st.cols.forEach(function (nm) {
      var c = document.createElement("span"); c.className = "sp-chip"; c.setAttribute("draggable", "true"); c.setAttribute("data-ver", nm);
      c.innerHTML = "<span>" + esc(nm) + "</span>";
      var x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.title = "열 제거"; x.setAttribute("draggable", "false");
      x.onclick = function () { if (st.cols.length <= 1) { toast("역본은 최소 1개 필요합니다"); return; } st.cols = st.cols.filter(function (v) { return v !== nm; }); save(); renderVers(); renderGrid(); };
      c.appendChild(x); chips.appendChild(c);
    });
    row.appendChild(chips);
    var wrap = document.createElement("span"); wrap.className = "sp-add";
    var add = document.createElement("button"); add.className = "sp-addb"; add.textContent = "+ 역본";
    var rest = all.filter(function (n) { return st.cols.indexOf(n) < 0; });
    var full = st.cols.length >= 5 || !rest.length; add.disabled = full;
    var menu = document.createElement("div"); menu.className = "sp-menu";
    rest.forEach(function (n) { var b = document.createElement("button"); b.textContent = n; b.onclick = function () { if (st.cols.length >= 5) return; st.cols.push(n); save(); renderVers(); renderGrid(); }; menu.appendChild(b); });
    add.onclick = function (e) { e.stopPropagation(); menu.classList.toggle("open"); };
    wrap.appendChild(add); wrap.appendChild(menu); row.appendChild(wrap);
    var hint = document.createElement("span"); hint.className = "sp-vhint"; hint.textContent = st.cols.length + "/5 · 드래그로 순서 변경 · 함께 스크롤"; row.appendChild(hint);
    initChipSortable(chips);
  }
  function initChipSortable(chips) {
    if (window.Sortable) {
      if (chipSortable) { try { chipSortable.destroy(); } catch (e) {} chipSortable = null; }
      chipSortable = window.Sortable.create(chips, {
        animation: 150, draggable: ".sp-chip", filter: ".x", preventOnFilter: false,
        ghostClass: "sp-dropzone", chosenClass: "sp-dragging",
        onEnd: function () { st.cols = [].map.call(chips.querySelectorAll(".sp-chip"), function (c) { return c.getAttribute("data-ver"); }); save(); renderGrid(); }
      });
    } else {
      dndBind(chips); // SortableJS 미로드 시 기본 드래그로 폴백
    }
  }

  /* ---------- 렌더: 병행 그리드 ---------- */
  function wjRowFull(v, selc) {
    var toks = (wjData && wjData.verses && wjData.verses[String(v)]) || [];
    if (!toks.length) return "";
    var h = "<div class='sp-gwj rc-" + v + selc + "' data-n='" + v + "'><div class='sp-wjcell'>";
    toks.forEach(function (t, i) {
      var mean = (t.m && t.m !== "_") ? t.m : "";
      h += "<span class='sp-wt' data-v='" + v + "' data-i='" + i + "'><b>" + esc(t.w) + "</b><em>" + esc(mean) + "</em><code>" + esc(t.c) + "</code></span>";
    });
    return h + "</div></div>";
  }
  function renderGrid() {
    var g = $("#spGrid"); if (!g) return;
    var cols = st.cols, n = cols.length, wj = st.wonjeon;
    var datas = {}, pending = n, done = false;
    cols.forEach(function (nm) { getData(nm, function (d) { datas[nm] = d; if (--pending === 0 && !done) { done = true; paint(datas); } }); });
    function paint(datas) {
      var base = datas[cols[0]] || null; var vs = base ? chapVerses(base) : null;
      if (!vs) { for (var j = 0; j < n; j++) { if (datas[cols[j]] && chapVerses(datas[cols[j]])) { base = datas[cols[j]]; vs = chapVerses(base); break; } } }
      var cnt = vs ? vs.length : 0;
      var tmpl = "2.6rem repeat(" + n + ", minmax(180px,1fr))";
      var head = $("#spHead"); head.style.gridTemplateColumns = tmpl;
      var hh = "<div class='sp-gh corner'></div>";
      cols.forEach(function (nm) { hh += "<div class='sp-gh' draggable='true' data-ver='" + esc(nm) + "'>" + esc(nm) + "<span class='lg'>" + (isEng(nm) ? "영" : "한") + "</span></div>"; });
      head.innerHTML = hh;
      g.style.gridTemplateColumns = tmpl;
      var html = "";
      for (var v = 1; v <= cnt; v++) {
        var selc = (st.sel === v ? " sp-row-sel" : "");
        var noteKey = book + "|" + chap + "|" + v, dot = st.notes[noteKey] ? "<span class='sp-note-dot'></span>" : "";
        html += "<div class='sp-gn rc-" + v + selc + "' data-n='" + v + "'>" + v + dot + "</div>";
        cols.forEach(function (nm) {
          var d = datas[nm], txt = "";
          try { txt = d.books[book].chapters[chap][v - 1] || ""; } catch (e) {}
          html += "<div class='sp-gc rc-" + v + (isEng(nm) ? " en" : "") + selc + "' data-n='" + v + "'>" + renderVT(txt, v, nm) + "</div>";
        });
        if (wj) html += wjRowFull(v, selc);
      }
      g.innerHTML = html;
      g.onclick = gridClick;
      initHeadSortable(head);
    }
  }
  function initHeadSortable(head) {
    if (window.Sortable) {
      if (headSortable) { try { headSortable.destroy(); } catch (e) {} headSortable = null; }
      headSortable = window.Sortable.create(head, {
        animation: 150, draggable: ".sp-gh[data-ver]",
        ghostClass: "sp-dropzone", chosenClass: "sp-dragging",
        onEnd: function () { st.cols = [].map.call(head.querySelectorAll(".sp-gh[data-ver]"), function (c) { return c.getAttribute("data-ver"); }); save(); renderGrid(); }
      });
    } else {
      dndBind(head);
    }
  }
  function gridClick(e) {
    var w = e.target.closest ? e.target.closest(".w.has") : null;
    var t = e.target.closest ? e.target.closest(".sp-wt") : null;
    if (w) { var cell = e.target.closest("[data-n]"); if (cell) selectVerse(+cell.dataset.n); openLexInfo(w.getAttribute("data-code"), (w.textContent || "").trim()); return; }
    if (t) { selectVerse(+t.dataset.v); openWjInfo(+t.dataset.v, +t.dataset.i); return; }
    var c = e.target.closest ? e.target.closest("[data-n]") : null; if (c) selectVerse(parseInt(c.dataset.n, 10));
  }
  function markRow() {
    root.querySelectorAll(".sp-row-sel").forEach(function (el) { el.classList.remove("sp-row-sel"); });
    if (st.sel != null) root.querySelectorAll(".rc-" + st.sel).forEach(function (el) { el.classList.add("sp-row-sel"); });
  }
  function selectVerse(v) { st.sel = v; save(); markRow(); if (st.tab === "comm" || st.tab === "xref" || st.tab === "note") renderTab(); }

  /* 성경 이동 (책·장·절 리스트박스 + 이전/다음 장) */
  function books() { return (BV().bible && BV().bible.books) || []; }
  function renderNav() {
    var nav = $("#spNav"); if (!nav) return;
    var bs = books(); if (!bs.length) { nav.innerHTML = ""; return; }
    if (book < 0 || book >= bs.length) book = 0;
    var nch = (bs[book] && bs[book].chapters) ? bs[book].chapters.length : 1;
    if (chap < 0) chap = 0; if (chap >= nch) chap = nch - 1;
    var nv = 1; try { nv = bs[book].chapters[chap].length; } catch (e) {}
    var bopt = bs.map(function (bk, i) { return "<option value='" + i + "'" + (i === book ? " selected" : "") + ">" + esc(bk.name || (i + 1)) + "</option>"; }).join("");
    var copt = ""; for (var c = 0; c < nch; c++) copt += "<option value='" + c + "'" + (c === chap ? " selected" : "") + ">" + (c + 1) + "</option>";
    var vsel = st.sel || 1, vopt = ""; for (var v = 1; v <= nv; v++) vopt += "<option value='" + v + "'" + (v === vsel ? " selected" : "") + ">" + v + "</option>";
    nav.innerHTML = "<select class='sp-nsel sp-nbook' id='spNavB'>" + bopt + "</select>"
      + "<select class='sp-nsel' id='spNavC'>" + copt + "</select>"
      + "<select class='sp-nsel' id='spNavV'>" + vopt + "</select>"
      + "<span class='sp-narr'><button class='sp-nb' id='spNavPrev' title='이전 장'>&#9664;</button><button class='sp-nb' id='spNavNext' title='다음 장'>&#9654;</button></span>";
    $("#spNavB").onchange = function () { gotoPassage(+this.value, 0, null); };
    $("#spNavC").onchange = function () { gotoPassage(book, +this.value, null); };
    $("#spNavV").onchange = function () { gotoPassage(book, chap, +this.value); };
    $("#spNavPrev").onclick = function () { if (chap > 0) gotoPassage(book, chap - 1, null); };
    $("#spNavNext").onclick = function () { var m = (bs[book] && bs[book].chapters) ? bs[book].chapters.length : 1; if (chap < m - 1) gotoPassage(book, chap + 1, null); };
  }
  function scrollToVerse(v) { var g = $("#spGrid"); if (!g) return; var el = g.querySelector('[data-n="' + v + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); }
  function gotoPassage(b, c, v) {
    var bs = books(); if (!bs.length) return;
    if (b < 0 || b >= bs.length) return;
    book = b; var maxc = (bs[book] && bs[book].chapters) ? bs[book].chapters.length : 1;
    chap = Math.max(0, Math.min(c, maxc - 1));
    wjData = null; st.sel = v || null; save();
    $("#spSub").textContent = bookFull() + " " + (chap + 1) + "장";
    renderNav();
    var done = function () { renderGrid(); syncTabs(); renderTab(); if (v) setTimeout(function () { scrollToVerse(v); }, 0); };
    if (st.wonjeon) ensureWj(done); else done();
    if (BV().gotoRef) { try { BV().gotoRef(book, chap, v || 1); } catch (e) {} }
  }

  /* ---------- 대조 모드 (열별 독립 본문) ---------- */
  function chapCount(b) { var bs = books(); return (bs[b] && bs[b].chapters) ? bs[b].chapters.length : 1; }
  function ensureCmpCols() {
    var avail = (BV().versions ? BV().versions() : []) || [], bs = books();
    if (!st.cmpCols || !st.cmpCols.length) st.cmpCols = st.cols.map(function (v) { return { v: v, b: book, c: chap }; });
    st.cmpCols = st.cmpCols.filter(function (c) { return avail.indexOf(c.v) >= 0; });
    if (!st.cmpCols.length) st.cmpCols = [{ v: (st.cols[0] || avail[0]), b: book, c: chap }];
    st.cmpCols.forEach(function (c) { if (c.b < 0 || c.b >= bs.length) c.b = book; var m = chapCount(c.b); if (c.c < 0 || c.c >= m) c.c = 0; });
  }
  function cmpBodyHtml(col, idx) {
    var d = dataCache[col.v], vs = null;
    try { vs = d.books[col.b].chapters[col.c]; } catch (e) {}
    if (!vs || !vs.length) return "<div class='sp-cempty'>이 역본에 이 본문이 없습니다.</div>";
    var h = "";
    for (var i = 0; i < vs.length; i++) h += "<div class='sp-cvrow' data-v='" + (i + 1) + "' data-ci='" + idx + "'><div class='sp-cvn'>" + (i + 1) + "</div><div class='sp-cvt'>" + renderVT(vs[i], i + 1, col.v) + "</div></div>";
    return h;
  }
  function renderCmp() {
    ensureCmpCols();
    var need = {}; st.cmpCols.forEach(function (c) { need[c.v] = 1; });
    var names = Object.keys(need), pending = names.length;
    if (!pending) { paintCmp(); return; }
    names.forEach(function (nm) { getData(nm, function () { if (--pending === 0) paintCmp(); }); });
  }
  function paintCmp() {
    var wrap = $("#spCmp"); if (!wrap) return;
    var avail = (BV().versions ? BV().versions() : []) || [], bs = books();
    var html = "";
    st.cmpCols.forEach(function (col, idx) {
      var vopt = avail.map(function (v) { return "<option" + (v === col.v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
      var bopt = bs.map(function (bk, i) { return "<option value='" + i + "'" + (i === col.b ? " selected" : "") + ">" + esc(bk.name || (i + 1)) + "</option>"; }).join("");
      var nch = chapCount(col.b), copt = "";
      for (var c = 0; c < nch; c++) copt += "<option value='" + c + "'" + (c === col.c ? " selected" : "") + ">" + (c + 1) + "</option>";
      html += "<div class='sp-ccol' data-i='" + idx + "'>"
        + "<div class='sp-cgrip' title='드래그하여 열 순서 변경'>⠿⠿⠿</div>"
        + "<div class='sp-chd'>"
        + "<select class='sp-cvsel' data-k='v' data-i='" + idx + "'>" + vopt + "</select>"
        + "<select class='sp-cbk' data-k='b' data-i='" + idx + "'>" + bopt + "</select>"
        + "<select data-k='c' data-i='" + idx + "'>" + copt + "</select>"
        + "<button class='sp-nb' data-k='prev' data-i='" + idx + "' title='이전 장'>&#9664;</button><button class='sp-nb' data-k='next' data-i='" + idx + "' title='다음 장'>&#9654;</button>"
        + "<button class='sp-cx' data-k='x' data-i='" + idx + "' title='열 제거'>&times;</button>"
        + "</div><div class='sp-cbody'>" + cmpBodyHtml(col, idx) + "</div></div>";
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll("[data-k]").forEach(function (elm) {
      var i = +elm.getAttribute("data-i"), k = elm.getAttribute("data-k");
      if (k === "v") elm.onchange = function () { st.cmpCols[i].v = this.value; save(); renderCmp(); };
      else if (k === "b") elm.onchange = function () { st.cmpCols[i].b = +this.value; st.cmpCols[i].c = 0; save(); renderCmp(); };
      else if (k === "c") elm.onchange = function () { st.cmpCols[i].c = +this.value; save(); renderCmp(); };
      else if (k === "prev") elm.onclick = function () { if (st.cmpCols[i].c > 0) { st.cmpCols[i].c--; save(); renderCmp(); } };
      else if (k === "next") elm.onclick = function () { if (st.cmpCols[i].c < chapCount(st.cmpCols[i].b) - 1) { st.cmpCols[i].c++; save(); renderCmp(); } };
      else if (k === "x") elm.onclick = function () { if (st.cmpCols.length <= 1) { toast("열은 최소 1개 필요합니다"); return; } st.cmpCols.splice(i, 1); save(); renderCmp(); };
    });
    wrap.onclick = cmpClick;
    initCmpSortable(wrap);
    syncAddCol();
    applyWs();
  }
  function syncAddCol() {
    var btn = $("#spAddCol"); if (!btn) return;
    var cmp = st.mode === "cmp", full = !!(st.cmpCols && st.cmpCols.length >= 5);
    btn.disabled = !cmp || full;
    btn.title = !cmp ? "대조 모드에서만 사용할 수 있습니다" : (full ? "최대 5열입니다" : "대조 열 추가");
  }
  function initCmpSortable(wrap) {
    if (!window.Sortable) return;
    if (cmpSortable) { try { cmpSortable.destroy(); } catch (e) {} cmpSortable = null; }
    cmpSortable = window.Sortable.create(wrap, {
      animation: 150, draggable: ".sp-ccol", handle: ".sp-cgrip",
      ghostClass: "sp-dropzone", chosenClass: "sp-dragging",
      onEnd: function () {
        var order = [].map.call(wrap.querySelectorAll(".sp-ccol"), function (c) { return +c.getAttribute("data-i"); });
        st.cmpCols = order.map(function (i) { return st.cmpCols[i]; });
        save(); renderCmp();
      }
    });
  }
  function cmpClick(e) {
    var w = e.target.closest ? e.target.closest(".w.has") : null;
    var row = e.target.closest ? e.target.closest(".sp-cvrow") : null;
    if (row) focusCmp(+row.getAttribute("data-ci"), +row.getAttribute("data-v"));
    if (w) openLexInfo(w.getAttribute("data-code"), (w.textContent || "").trim());
  }
  function focusCmp(ci, v) {
    var col = st.cmpCols[ci]; if (!col) return;
    book = col.b; chap = col.c; st.sel = v; save();
    $("#spCmp").querySelectorAll(".sp-cvrow.sel").forEach(function (el) { el.classList.remove("sel"); });
    var el = $("#spCmp").querySelector(".sp-cvrow[data-ci='" + ci + "'][data-v='" + v + "']"); if (el) el.classList.add("sel");
    $("#spSub").textContent = "대조 · " + bookLabel() + " " + (chap + 1) + ":" + v;
    syncTabs(); renderTab();
  }
  function syncMode() {
    var cmp = st.mode === "cmp";
    $("#spMode").classList.toggle("on", cmp);
    $("#spL").classList.toggle("cmp", cmp);
    $("#spNav").style.display = cmp ? "none" : "";
    $("#spVers").style.display = cmp ? "none" : "";
    $("#spWjb").disabled = cmp; $("#spWjb").title = cmp ? "대조 모드에서는 사용할 수 없습니다" : "각 절 아래 원어 분해 줄";
    $("#spHead").style.display = cmp ? "none" : "";
    $("#spGrid").style.display = cmp ? "none" : "";
    $("#spCmp").style.display = cmp ? "flex" : "none";
    $("#spSub").textContent = cmp ? "대조 모드" : (bookFull() + " " + (chap + 1) + "장");
    syncAddCol();
    applyWs();
  }

  /* 역본 순서 드래그 (칩=SortableJS 애니메이션 / 머리글=기본 드래그) */
  var dragVer = null, chipSortable = null, headSortable = null, cmpSortable = null;
  function reorderCols(from, to) {
    if (from === to) return;
    var a = st.cols.slice(), fi = a.indexOf(from); if (fi < 0) return;
    a.splice(fi, 1);
    var ti = (to == null) ? a.length : a.indexOf(to);
    if (ti < 0) a.push(from); else a.splice(ti, 0, from);
    st.cols = a; save(); renderVers(); renderGrid();
  }
  function dndBind(container) {
    container.addEventListener("dragstart", function (e) {
      var t = e.target.closest ? e.target.closest("[data-ver]") : null; if (!t) return;
      dragVer = t.getAttribute("data-ver"); t.classList.add("sp-dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragVer); } catch (_) {}
    });
    container.addEventListener("dragend", function () {
      root.querySelectorAll(".sp-dragging,.sp-dropzone").forEach(function (el) { el.classList.remove("sp-dragging"); el.classList.remove("sp-dropzone"); });
      dragVer = null;
    });
    container.addEventListener("dragover", function (e) {
      if (dragVer == null) return; e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      root.querySelectorAll(".sp-dropzone").forEach(function (el) { el.classList.remove("sp-dropzone"); });
      var t = e.target.closest ? e.target.closest("[data-ver]") : null;
      if (t && t.getAttribute("data-ver") !== dragVer) t.classList.add("sp-dropzone");
    });
    container.addEventListener("drop", function (e) {
      if (dragVer == null) return; e.preventDefault();
      var t = e.target.closest ? e.target.closest("[data-ver]") : null;
      if (t) reorderCols(dragVer, t.getAttribute("data-ver"));
      dragVer = null;
    });
  }

  /* ---------- 정보 패널 ---------- */
  function showInfo(word, ref, rows) {
    $("#spISub").textContent = ref || "";
    var h = "<div class='sp-iw'>" + esc(word) + "</div>" + (ref ? "<div class='sp-iref'>" + esc(ref) + "</div>" : "");
    rows.forEach(function (r) { h += "<div class='sp-irow'><span class='k'>" + esc(r[0]) + "</span><span class='v" + (r[2] ? " " + r[2] : "") + "'>" + r[1] + "</span></div>"; });
    $("#spIBody").innerHTML = h;
  }
  function clearInfo() { $("#spISub").textContent = "원어·원전분해에서 단어를 누르면 여기에 표시됩니다"; $("#spIBody").innerHTML = "<div class='sp-iempty'>아직 선택한 단어가 없습니다.<br>왼쪽에서 <b>원어</b> 단어나 <b>원전분해</b> 항목을 눌러 보세요.</div>"; }
  function openLexInfo(code, word) {
    $("#spISub").textContent = code || "";
    $("#spIBody").innerHTML = "<div class='sp-iw'>" + esc(word) + "</div><div class='sp-iref'>" + esc(code) + " · 불러오는 중…</div>";
    BV().lexGet(code, function (txt) {
      var body = txt ? String(txt).replace("^", "<br>") : "<span style='color:#93a096'>이 단어의 원어 뜻 정보가 없습니다.</span>";
      showInfo(word, bookLabel() + " " + (chap + 1) + (st.sel ? ":" + st.sel : ""), [["스트롱", esc(code), "sp-icode"], ["뜻", body]]);
    });
  }
  function openWjInfo(v, i) {
    var toks = (wjData && wjData.verses && wjData.verses[String(v)]) || []; var t = toks[i]; if (!t) return;
    var rows = [["원어", esc(t.w)]];
    if (t.l) rows.push(["기본형", esc(t.l) + (t.p ? " <span style='color:#93a096'>" + esc(t.p) + "</span>" : "")]);
    if (t.m && t.m !== "_") rows.push(["뜻", esc(t.m)]);
    if (t.g) rows.push(["문법", esc(t.g)]);
    if (t.c) rows.push(["스트롱", "<span class='sp-icode' style='cursor:pointer;text-decoration:underline' data-code='" + esc(t.c) + "'>" + esc(t.c) + "</span>"]);
    showInfo(t.w, bookLabel() + " " + (chap + 1) + ":" + v, rows);
    var cc = $("#spIBody .sp-icode[data-code]"); if (cc) cc.onclick = function () { openLexInfo(cc.getAttribute("data-code"), t.w); };
  }

  /* ---------- 탭 ---------- */
  function syncTabs() { root.querySelectorAll(".sp-tab").forEach(function (t) { t.classList.toggle("on", t.dataset.tab === st.tab); }); }
  function renderTab() {
    var b = $("#spTabBody"); var ref = bookFull() + " " + (chap + 1) + (st.sel ? ":" + st.sel : "");
    if (st.tab === "comm") {
      if (st.sel == null) { b.innerHTML = "<div class='sp-empty'>왼쪽에서 절을 선택하면<br>그 절의 주석이 여기로 <b>따라옵니다</b>.</div>"; return; }
      var names = (BV().commNames ? BV().commNames() : []) || [];
      if (!names.length) { b.innerHTML = "<div class='sp-empty'>불러온 주석이 없습니다.<br>성경뷰어 옵션에서 주석을 불러오세요.</div>"; return; }
      b.innerHTML = "<div class='sp-cref'>" + esc(ref) + "</div><div id='spCommOut'><div class='sp-empty'>불러오는 중…</div></div>";
      var out = $("#spCommOut"), acc = [], pend = names.length;
      names.forEach(function (nm) {
        BV().getComm(nm, book + 1, chap + 1, function (rec) {
          var blocks = (rec && rec.blocks) || []; var hit = blocks.filter(function (x) { return (+x.v) === st.sel; });
          if (hit.length) acc.push("<div class='sp-csrc'>" + esc(nm) + "</div><div class='sp-ctxt'>" + hit.map(function (x) { return x.html || ""; }).join("<br>") + "</div>");
          if (--pend === 0) out.innerHTML = acc.length ? acc.join("<div style='height:12px'></div>") : "<div class='sp-empty'>이 절에 대한 주석이 없습니다.</div>";
        });
      });
    } else if (st.tab === "xref") {
      b.innerHTML = "<div class='sp-empty'>상호참조는 본문의 각주·참조 데이터가 있을 때 표시됩니다.<br>(현재 번역본에 참조 정보가 없으면 비어 있습니다.)</div>";
    } else if (st.tab === "search") {
      var cur = (st._sv && st.cols.indexOf(st._sv) >= 0) ? st._sv : st.cols[0];
      var opts = st.cols.map(function (n) { return "<option value='" + esc(n) + "'" + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
      b.innerHTML = "<div class='sp-sbar'><select id='spSVer'>" + opts + "</select><input id='spSIn' placeholder='이 역본·이 장에서 단어 검색' value='" + esc(st._sq || "") + "'></div><div id='spSOut'></div>";
      var run = function () { st._sv = $("#spSVer").value; st._sq = $("#spSIn").value; save(); runSearch(); };
      $("#spSVer").onchange = run; $("#spSIn").oninput = run; runSearch(); $("#spSIn").focus();
    } else if (st.tab === "note") {
      if (st.sel == null) { b.innerHTML = "<div class='sp-empty'>절을 선택하면 그 절에 대한<br>개인 노트를 적을 수 있습니다.</div>"; return; }
      var key = book + "|" + chap + "|" + st.sel;
      b.innerHTML = "<div class='sp-nhd'><span class='r'>" + esc(ref) + " 노트</span><span class='sp-saved' id='spSaved'>저장됨 &#10003;</span></div><textarea class='sp-ta' id='spNote' placeholder='관찰·묵상·적용을 적어 두세요. 같은 기기에 저장됩니다.'>" + esc(st.notes[key] || "") + "</textarea>";
      var box = $("#spNote"), tag = $("#spSaved"), tmr;
      box.addEventListener("input", function () { if (box.value.trim()) st.notes[key] = box.value; else delete st.notes[key]; save(); renderGrid(); tag.classList.add("show"); clearTimeout(tmr); tmr = setTimeout(function () { tag.classList.remove("show"); }, 1200); });
    } else if (st.tab === "passage") {
      var rv = esc(st.cpRef || ""), cv = st.cpVer || st.cols[0];
      var vopts = st.cols.map(function (n) { return "<option value='" + esc(n) + "'" + (n === cv ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("");
      b.innerHTML = "<div class='sp-cprow'><span class='sp-cplab'>본문</span><select id='spCpVer' class='sp-cpsel'>" + vopts + "</select><input id='spCpRef' class='sp-cpin' placeholder='예: 창1:1~10' value='" + rv + "'><button class='sp-cpgo' id='spCpGo'>검색</button></div>"
        + "<div class='sp-cprow'><span class='sp-cplab'>옵션</span><label class='sp-cpv'><input type='checkbox' id='spCpNums'" + (st.cpNums !== false ? " checked" : "") + ">절 번호 포함</label></div>"
        + "<textarea class='sp-ta' id='spCpOut' readonly style='min-height:190px' placeholder='본문을 입력하고 검색을 누르면 결과가 나옵니다.'></textarea>"
        + "<div style='margin-top:11px'><button class='sp-mini' id='spCpCopy'>&#10696; 본문 복사</button></div>";
      var go = function () { var txt = passageText(); if (!txt) { toast("본문 형식을 확인하세요 (예: 창1:1~10)"); return; } $("#spCpOut").value = txt; };
      $("#spCpRef").oninput = function () { st.cpRef = this.value; save(); };
      $("#spCpRef").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
      $("#spCpVer").onchange = function () { st.cpVer = this.value; save(); if ($("#spCpOut").value) go(); };
      $("#spCpNums").onchange = function () { st.cpNums = this.checked; save(); if ($("#spCpOut").value) go(); };
      $("#spCpGo").onclick = go;
      $("#spCpCopy").onclick = function () { var t = $("#spCpOut").value; if (!t) { toast("먼저 검색하세요"); return; } doCopy(t); };
      var init = passageText(); if (init) $("#spCpOut").value = init;
    }
  }
  function runSearch() {
    var out = $("#spSOut"), nm = st._sv || st.cols[0], q = (st._sq || "").trim();
    if (!q) { out.innerHTML = "<div class='sp-empty'>" + esc(nm) + "에서 검색할 단어를 입력하세요.</div>"; return; }
    getData(nm, function (d) {
      var vs = chapVerses(d) || []; var ql = q.toLowerCase(), hits = [];
      for (var i = 0; i < vs.length; i++) { var p = plain(vs[i]); if (p.toLowerCase().indexOf(ql) >= 0) hits.push({ v: i + 1, t: p }); }
      if (!hits.length) { out.innerHTML = "<div class='sp-scount'>‘" + esc(q) + "’ — 이 장에서 일치 없음</div>"; return; }
      var re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      var h = "<div class='sp-scount'>‘" + esc(q) + "’ · " + esc(nm) + " · " + hits.length + "절 일치</div>";
      hits.forEach(function (hh) { h += "<div class='sp-sres' data-v='" + hh.v + "'><div class='r'>" + esc(bookLabel()) + " " + (chap + 1) + ":" + hh.v + "</div><div class='t'>" + esc(hh.t).replace(re, "<mark class='q'>$1</mark>") + "</div></div>"; });
      out.innerHTML = h;
      out.querySelectorAll(".sp-sres").forEach(function (it) { it.onclick = function () { selectVerse(+it.dataset.v); }; });
    });
  }

  /* ---------- 본문복사 (참조 파싱) ---------- */
  function findBook(data, token) {
    var t = token.replace(/\s+/g, "");
    var bs = data.books || [];
    for (var i = 0; i < bs.length; i++) { var nm = (bs[i].name || "").replace(/\s+/g, ""), ab = (bs[i].abbr || "").replace(/\s+/g, ""); if (nm === t || ab === t) return i; }
    for (var j = 0; j < bs.length; j++) { var nm2 = (bs[j].name || "").replace(/\s+/g, ""); if (nm2.indexOf(t) === 0 || t.indexOf(nm2) === 0) return j; }
    return -1;
  }
  function parseRef(str) {
    var s = (str || "").trim(); if (!s) return null;
    var i = s.lastIndexOf(":"); if (i < 0) return null;
    var left = s.slice(0, i).replace(/\s+/g, ""), rest = s.slice(i + 1);
    var lm = left.match(/^(.+?)(\d+)$/); if (!lm) return null;
    var token = lm[1], ch = parseInt(lm[2], 10);
    var m = rest.match(/(\d+)\s*[-~–]\s*(\d+)/), from, to;
    if (m) { from = +m[1]; to = +m[2]; } else { var one = rest.match(/(\d+)/); if (!one) return null; from = to = +one[1]; }
    if (from > to) { var x = from; from = to; to = x; }
    if (to - from > 200) to = from + 200;
    return { token: token, chap: ch, from: from, to: to };
  }
  function passageText() {
    var p = parseRef(st.cpRef); if (!p) return "";
    var nm = st.cpVer || st.cols[0], d = dataCache[nm];
    if (!d) { getData(nm, function () { var o = $("#spCpOut"); if (o) { var t = passageText(); if (t) o.value = t; } }); }
    var nums = st.cpNums !== false;
    var bi = d ? findBook(d, p.token) : -1;
    var label = (bi >= 0 ? (d.books[bi].abbr || d.books[bi].name) : p.token) + " " + p.chap + ":" + (p.from === p.to ? p.from : p.from + "-" + p.to);
    var lines = [nm + " · " + label];
    for (var v = p.from; v <= p.to; v++) {
      var txt = "(본문 없음)";
      if (bi >= 0) { try { var raw = d.books[bi].chapters[p.chap - 1][v - 1]; if (raw != null) txt = plain(raw); } catch (e) {} }
      lines.push((nums ? v + " " : "") + txt);
    }
    return lines.join("\n");
  }
  function doCopy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast("복사했습니다"); }, function () { fb(text); }); } else fb(text);
    function fb(t) { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); toast("복사했습니다"); } catch (e) { toast("복사를 지원하지 않는 환경입니다"); } }
  }

  /* ---------- 토글·리사이저 ---------- */
  var CMP_COL_MIN = 361; // 열 1개 최소폭(360 + 우측 경계 1px)
  function applyWs() {
    var f = Math.max(.08, Math.min(.92, st.wsFrac || .58)), lmin = "0";
    if (st.mode === "cmp") {
      var n = (st.cmpCols && st.cmpCols.length) || 1;
      var need = n * CMP_COL_MIN;                  // 현재 열 전부를 담는 폭 = 대조창 최소 크기
      var ws = $("#spWs"), avail = ws ? (ws.clientWidth - 7) : need;
      lmin = Math.min(need, Math.max(200, avail)) + "px"; // 화면보다 크면 화면까지만
    }
    $("#spWs").style.gridTemplateColumns = "minmax(" + lmin + "," + f + "fr) 7px minmax(0," + (1 - f) + "fr)";
  }
  function applyInfoH() { var pr = $("#spR"); var max = pr ? Math.max(160, pr.clientHeight - 150) : 460; $(".sp-info").style.height = Math.max(110, Math.min(max, st.infoH || 230)) + "px"; }
  function syncStudy() { $("#spStron").classList.toggle("on", st.stron); $("#spWjb").classList.toggle("on", st.wonjeon); root.classList.toggle("sp-stron", st.stron); }
  function codedOf(name) { return name + "S"; }          // 스트롱판 이름 규칙 (개역개정 → 개역개정S)
  function isCodedTwin(name, avail) { return /S$/.test(name) && avail.indexOf(name.slice(0, -1)) >= 0; }
  // 원어 켜기: 개역개정 있으면 개역개정S로 교체 / 없으면 맨 오른쪽에 개역개정S 추가.
  function stronEnable() {
    var avail = (BV().versions ? BV().versions() : []) || [];
    if (st.cols.some(function (c) { return isCodedTwin(c, avail); })) { st.stronAct = { mode: "none" }; return true; }
    var idx = -1;
    if (st.cols.indexOf("개역개정") >= 0 && avail.indexOf("개역개정S") >= 0) idx = st.cols.indexOf("개역개정");
    else { for (var i = 0; i < st.cols.length; i++) { if (avail.indexOf(codedOf(st.cols[i])) >= 0) { idx = i; break; } } }
    if (idx >= 0) { var plain = st.cols[idx]; st.cols[idx] = codedOf(plain); st.stronAct = { mode: "swap", plain: plain, coded: codedOf(plain) }; return true; }
    if (avail.indexOf("개역개정S") >= 0) {
      if (st.cols.length >= 5) { toast("역본이 5개라 개역개정S를 추가할 수 없습니다 · 하나 제거 후 다시 시도하세요"); return false; }
      st.cols.push("개역개정S"); st.stronAct = { mode: "add", coded: "개역개정S" }; return true;
    }
    toast("개역개정S가 이 기기에 없습니다 · 성경뷰어 번역본 선택 → ＋불러오기로 먼저 임포트하세요"); return false;
  }
  // 원어 끄기: 켤 때 한 일을 되돌림 (교체→평문 복귀 / 추가→제거). 사용자가 직접 넣은 열은 안 건드림.
  function stronDisable() {
    var a = st.stronAct || { mode: "none" };
    if (a.mode === "swap") { var i = st.cols.indexOf(a.coded); if (i >= 0) st.cols[i] = a.plain; }
    else if (a.mode === "add") { var j = st.cols.indexOf(a.coded); if (j >= 0) st.cols.splice(j, 1); }
    st.stronAct = null;
  }
  // 모드 전환/열기 시 원어 상태를 깨끗이 초기화 (par·cmp 교체 모두 되돌림)
  function resetStron() {
    if (st.stronAct) { try { stronDisable(); } catch (e) {} }
    if (st.cmpCols) {
      st.cmpCols.forEach(function (col) { if (col._plain) { col.v = col._plain; delete col._plain; } });
      st.cmpCols = st.cmpCols.filter(function (col) { return !col._added; });
    }
    st.stron = false;
  }
  function ensureWj(cb) {
    if (wjData && wjData.b === book + 1 && wjData.c === chap + 1) { cb(); return; }
    if (!BV().getWonjeon) { wjData = { b: book + 1, c: chap + 1, verses: {} }; cb(); return; }
    BV().getWonjeon(book + 1, chap + 1, function (rec) { wjData = { b: book + 1, c: chap + 1, verses: (rec && rec.verses) || {} }; cb(); });
  }

  function wire() {
    $("#spExit").onclick = close; $("#spExit2").onclick = close;
    $("#spStron").onclick = function () {
      if (st.mode === "cmp") {
        st.stron = !st.stron;
        var av = (BV().versions ? BV().versions() : []) || [];
        if (st.stron) {
          st.cmpCols.forEach(function (col) { var cd = codedOf(col.v); if (!/S$/.test(col.v) && av.indexOf(cd) >= 0) { col._plain = col.v; col.v = cd; } });
          var hasCoded = st.cmpCols.some(function (col) { return /S$/.test(col.v); });
          if (!hasCoded && av.indexOf("개역개정S") >= 0) { var r0 = st.cmpCols[0] || { b: book, c: chap }; st.cmpCols.push({ v: "개역개정S", b: r0.b, c: r0.c, _added: true }); }  // 개역개정 없으면 맨 오른쪽에 생성
        } else {
          st.cmpCols.forEach(function (col) { if (col._plain) { col.v = col._plain; delete col._plain; } });
          st.cmpCols = st.cmpCols.filter(function (col) { return !col._added; });  // 원어가 생성한 열 제거
        }
        save(); syncStudy(); renderCmp();
        if (st.stron) { var any = st.cmpCols.some(function (col) { return /S$/.test(col.v); }); toast(any ? "각 열의 단어를 누르면 원어 뜻이 아래 ‘정보’에 표시됩니다" : "이 기기에 개역개정S가 없어 원어를 표시할 수 없습니다"); }
        return;
      }
      if (!st.stron) {
        if (!stronEnable()) return;               // 개역개정S 없으면 토글 안 됨 (안내만)
        st.stron = true; save(); syncStudy(); renderVers(); renderGrid();
        toast("본문 단어를 누르면 오른쪽 아래 ‘정보’에 원어 뜻이 표시됩니다");
      } else {
        stronDisable();
        st.stron = false; save(); syncStudy(); renderVers(); renderGrid();
      }
    };
    $("#spWjb").onclick = function () { st.wonjeon = !st.wonjeon; save(); syncStudy(); if (st.wonjeon) ensureWj(renderGrid); else renderGrid(); };
    $("#spAddCol").onclick = function () {
      if (st.mode !== "cmp") return;
      if (st.cmpCols.length >= 5) { toast("최대 5열입니다"); return; }
      var last = st.cmpCols[st.cmpCols.length - 1] || { v: st.cols[0], b: book, c: chap };
      st.cmpCols.push({ v: last.v, b: last.b, c: last.c }); save(); renderCmp();
    };
    $("#spMode").onclick = function () {
      resetStron();
      st.mode = (st.mode === "cmp") ? "par" : "cmp"; save(); syncMode(); syncStudy();
      if (st.mode === "cmp") { ensureCmpCols(); renderCmp(); }
      else { renderNav(); if (st.wonjeon) ensureWj(renderGrid); else renderGrid(); }
      syncTabs(); renderTab();
    };
    $("#spIX").onclick = clearInfo;
    $("#spTabs").onclick = function (e) { var t = e.target.closest(".sp-tab"); if (!t) return; st.tab = t.dataset.tab; save(); syncTabs(); renderTab(); };
    document.addEventListener("click", function () { var m = root && root.querySelector(".sp-menu.open"); if (m) m.classList.remove("open"); });
    // 세로 경계
    (function () { var dv = $("#spDiv"), ws = $("#spWs"), dr = false;
      function mv(e) { if (!dr) return; var r = ws.getBoundingClientRect(); var cx = e.touches ? e.touches[0].clientX : e.clientX; st.wsFrac = Math.max(.08, Math.min(.92, (cx - r.left) / r.width)); applyWs(); if (e.cancelable) e.preventDefault(); }
      function up() { if (dr) { dr = false; save(); document.body.style.userSelect = ""; } }
      dv.addEventListener("mousedown", function () { dr = true; document.body.style.userSelect = "none"; });
      dv.addEventListener("touchstart", function () { dr = true; }, { passive: true });
      window.addEventListener("mousemove", mv); window.addEventListener("touchmove", mv, { passive: false });
      window.addEventListener("mouseup", up); window.addEventListener("touchend", up);
    })();
    // 가로 경계 (정보 높이)
    (function () { var hd = $("#spHDiv"), pr = $("#spR"), dr = false;
      function mv(e) { if (!dr) return; var r = pr.getBoundingClientRect(); var cy = e.touches ? e.touches[0].clientY : e.clientY; st.infoH = r.bottom - cy; applyInfoH(); if (e.cancelable) e.preventDefault(); }
      function up() { if (dr) { dr = false; save(); document.body.style.userSelect = ""; } }
      hd.addEventListener("mousedown", function () { dr = true; document.body.style.userSelect = "none"; });
      hd.addEventListener("touchstart", function () { dr = true; }, { passive: true });
      window.addEventListener("mousemove", mv); window.addEventListener("touchmove", mv, { passive: false });
      window.addEventListener("mouseup", up); window.addEventListener("touchend", up);
    })();
    // ESC 닫기
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root && root.style.display !== "none") close(); });
  }

  /* ---------- open / close ---------- */
  function open() {
    var bv = BV();
    if (!bv) { alert("성경 데이터를 아직 불러오는 중입니다. 잠시 후 다시 시도해 주세요."); return; }
    if (!bv.bible) { alert("먼저 번역본을 불러와 성경을 연 뒤 설교준비를 사용하세요."); return; }
    if (!root) build();
    book = bv.curBook | 0; chap = bv.curChap | 0; baseVer = bv.curVersion || "";
    var avail = (bv.versions ? bv.versions() : []) || [];
    if (!st.cols || !st.cols.length) st.cols = [baseVer];
    // 사라진 역본 제거 + 중복 제거, 기준 역본(또는 그 스트롱판)이 없으면 앞에 추가
    st.cols = st.cols.filter(function (n, i, a) { return avail.indexOf(n) >= 0 && a.indexOf(n) === i; });
    if (st.cols.indexOf(baseVer) < 0 && st.cols.indexOf(codedOf(baseVer)) < 0 && avail.indexOf(baseVer) >= 0) st.cols.unshift(baseVer);
    if (!st.cols.length) st.cols = avail.slice(0, 1);
    if (!st.cpVer || st.cols.indexOf(st.cpVer) < 0) st.cpVer = st.cols[0];
    // 본문복사 기본값: 현재 장 전체
    var vs = chapVerses(bv.bible), cnt = vs ? vs.length : 1;
    st.cpRef = (bookLabel() || "창") + " " + (chap + 1) + ":1~" + cnt;
    st.sel = null; wjData = null;

    document.body.style.overflow = "hidden";
    root.style.display = "flex";
    $("#spSub").textContent = bookFull() + " " + (chap + 1) + "장";
    dataCache = {};
    resetStron();
    applyWs(); applyInfoH(); syncStudy(); clearInfo(); renderVers(); renderNav(); syncMode();
    if (st.mode === "cmp") { ensureCmpCols(); renderCmp(); }
    else { if (st.wonjeon) ensureWj(renderGrid); else renderGrid(); }
    syncTabs(); renderTab();
  }
  function close() { if (root) root.style.display = "none"; document.body.style.overflow = ""; }

  window.SERMON = { open: open, close: close };
})();
