/* ───────── 데이터 ───────── */
const DAY = 864e5;
const TODAY = new Date(); TODAY.setHours(0,0,0,0);

// 소식이 흩어져 있던 곳
const SOURCES = {
  official: { name: "공식 홈페이지", icon: "i-globe" },
  everytime: { name: "에브리타임", icon: "i-msg" },
  kakaowork: { name: "카카오워크", icon: "i-work" },
  dept: { name: "학과 단톡", icon: "i-users" },
};

// 기간 한정 카테고리: 축제 기간에만 active: true 로 켜고 날짜를 넣는다
// 예) { active: true, name: "2027 을지축전", start: new Date(2027, 4, 20), end: new Date(2027, 4, 22) }
const FESTIVAL = { active: false, name: "을지축전", start: TODAY, end: TODAY };

// 학교 소식은 data/notices.js(크롤러)에서 채워진다. 학생 소식은 직접 입력 기능이 생기면 여기에 들어온다.
const NEWS = [];

// 을지축전 데이터 (축제 기간에 채운다)
const BOOTHS = [];       // { id, type: "먹거리"|"체험"|"굿즈", icon, title, host, place, time, desc }
const SHOWS = [];        // { time: "18:30", title, host, state: "past"|"live"|"next" }
const FEST_NOTICES = []; // { title, sub, when }

/* ───────── 공식 홈페이지 크롤링 데이터 (data/notices.js) ─────────
   학교 소식(cat: "school")으로 넣는다. */
const parseDay = s => { if (!s) return undefined; const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
const BOARD_ICON = { job: "i-brief", ctl: "i-cap", intl: "i-globe", counsel: "i-heart", innov: "i-zap", aac: "i-target", lib: "i-book", liberal: "i-cap" };
const SCHOOL_SUBS = ["비교과·프로그램", "공모전", "장학·지원", "일반 공지"];
if (Array.isArray(window.CRAWLED) && window.CRAWLED.length) {
  const crawled = window.CRAWLED.map(c => ({
    id: c.id, cat: "school", sub: c.sub, icon: BOARD_ICON[c.board] || "i-mega",
    title: c.title, host: c.host, source: "official", campus: c.campus,
    deadline: parseDay(c.deadline), date: parseDay(c.date), posted: parseDay(c.posted),
    place: c.place, mileage: c.mileage, desc: c.text, link: c.link,
  }));
  NEWS.splice(0, NEWS.length, ...crawled, ...NEWS.filter(n => n.cat !== "school"));
}
NEWS.forEach(n => { n.id = String(n.id); });
BOOTHS.forEach(b => { b.id = String(b.id); });

/* ───────── State ───────── */
const state = { tab: "home", chip: "전체", festSeg: "booth", query: "", saved: new Set() };
try { JSON.parse(localStorage.getItem("eulji-saved") || "[]").forEach(id => state.saved.add(String(id))); } catch (e) {}
const persist = () => { try { localStorage.setItem("eulji-saved", JSON.stringify([...state.saved])); } catch (e) {} };

/* ───────── Helpers ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const W = ["일","월","화","수","목","금","토"];
const fmt = dt => `${dt.getMonth()+1}월 ${dt.getDate()}일(${W[dt.getDay()]})`;
const daysLeft = dt => Math.round((dt - TODAY) / DAY);
const dday = dt => { const n = daysLeft(dt); return n === 0 ? "오늘 마감" : n > 0 ? `D-${n}` : "마감"; };
const icon = (id, cls = "") => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;
const ALL = [...NEWS, ...BOOTHS.map(b => ({ ...b, cat: "festival", sub: b.type, source: "everytime" }))];
const byId = id => ALL.find(x => x.id === String(id));
// 마감이 지났거나, 행사가 끝났거나, 마감·일시 없이 30일 넘은 글은 숨긴다
// 모집·신청이 아닌 "결과 발표"류 글은 숨긴다 (합격자·수상자·선정 결과 등)
const RESULT_RE = /결과|합격자|수상자|당첨자|선정자|명단|(참여자|참가자|팀) ?발표/;
const alive = n => {
  if (RESULT_RE.test(n.title)) return false;
  if (n.deadline) return daysLeft(n.deadline) >= 0;
  if (n.date) return daysLeft(n.date) >= 0;
  return !n.posted || -daysLeft(n.posted) <= 30;
};
// 마감 있는 글은 마감 빠른 순, 나머지는 최신순
const byUrgency = (a, b) => {
  const ka = a.deadline || a.date, kb = b.deadline || b.date;
  if (ka && kb) return ka - kb;
  if (ka || kb) return ka ? -1 : 1;
  return (b.posted || 0) - (a.posted || 0);
};
const matchQ = n => !state.query || [n.title, n.host, n.sub, n.place].join(" ").toLowerCase().includes(state.query.toLowerCase());

function badgesFor(n, { noDday } = {}) {
  const b = [];
  if (n.deadline && !noDday) { const k = daysLeft(n.deadline); b.push(`<span class="badge ${k <= 3 ? "danger" : ""}">${dday(n.deadline)}</span>`); }
  if (n.mileage) b.push(`<span class="badge brand">마일리지 ${n.mileage}점</span>`);
  if (n.prize) b.push(`<span class="badge">${esc(n.prize)}</span>`);
  return b.join("");
}

function row(n) {
  const saved = state.saved.has(n.id);
  let right = "";
  if (n.deadline) right = `<span class="dday ${daysLeft(n.deadline) <= 3 ? "hot" : ""}">${dday(n.deadline)}</span><span class="when">${n.deadline.getMonth()+1}.${n.deadline.getDate()} 마감</span>`;
  else if (n.date) right = `<span class="dday">${n.date.getMonth()+1}.${n.date.getDate()}</span><span class="when">${W[n.date.getDay()]}요일</span>`;
  else if (n.time) right = `<span class="when">${esc(n.time)}</span>`;
  else if (n.posted) right = `<span class="when">${n.posted.getMonth()+1}.${n.posted.getDate()} 게시</span>`;
  const sub = n.cat === "festival" ? `${esc(n.place)} · ${esc(n.host)}` : `${esc(n.host)} · ${SOURCES[n.source].name}`;
  return `<div class="row" role="button" tabindex="0" data-open="${n.id}">
    <span class="avatar">${icon(n.icon)}</span>
    <span class="body"><span class="ttl">${esc(n.title)}</span><span class="sub">${sub}</span>
      ${n.mileage || n.prize ? `<span class="badges" style="margin-top:4px">${badgesFor(n, { noDday: true })}</span>` : ""}</span>
    <span class="right">${right}</span>
    <button class="save-btn" data-save="${n.id}" aria-pressed="${saved}" aria-label="${saved ? "저장 취소" : "저장"}">${icon("i-bookmark", "s20")}</button>
  </div>`;
}

function emptyBlock(t, s) {
  return `<div class="empty">${$("#emptyArt").innerHTML}<div class="t">${t}</div><div>${s}</div></div>`;
}

function chipsBar(items, list) {
  return `<div class="chips">${["전체", ...items].map(c => {
    const n = c === "전체" ? list.length : list.filter(x => x.sub === c).length;
    return `<button class="chip" data-chip="${c}" aria-pressed="${state.chip === c}">${c}<span class="n">${n}</span></button>`;
  }).join("")}</div>`;
}

/* ───────── Tabs ───────── */
function tabsDef() {
  const t = [["home","홈"],["school","학교 소식"],["student","학생 소식"]];
  if (FESTIVAL.active) t.push(["festival","을지축전"]);
  return t;
}
function renderTabs() {
  const el = $("#tabs");
  if (state.tab === "saved") { el.innerHTML = `<button class="tab" aria-selected="true" role="tab">저장한 소식</button><button class="tab" data-tab="home" role="tab">돌아가기</button>`; return; }
  el.innerHTML = tabsDef().map(([k, v]) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${v}${k === "festival" ? `<span class="limited">기간 한정</span>` : ""}</button>`).join("");
}

/* ───────── Views ───────── */
function viewHome() {
  const live = NEWS.filter(alive).filter(matchQ);
  const urgent = live.filter(n => n.deadline && daysLeft(n.deadline) <= 7).sort((a, b) => a.deadline - b.deadline);
  const latest = [...live].sort((a, b) => b.posted - a.posted).slice(0, 6);
  const weekCnt = urgent.length;
  const srcCount = k => NEWS.filter(n => n.source === k).length;

  return `
  <div class="greet">
    <div class="date">${TODAY.getMonth()+1}월 ${TODAY.getDate()}일 ${W[TODAY.getDay()]}요일</div>
    <h1>${weekCnt ? `이번 주에 마감되는 소식이<br><em>${weekCnt}개</em> 있어요` : "이번 주에 마감되는<br>소식은 없어요"}</h1>
  </div>

  ${FESTIVAL.active ? `
  <button class="fest-banner" data-tab="festival">
    <span><span class="eyebrow">지금 진행 중 · ${FESTIVAL.start.getMonth()+1}.${FESTIVAL.start.getDate()} – ${FESTIVAL.end.getMonth()+1}.${FESTIVAL.end.getDate()}</span>
    <span class="t" style="display:block">${FESTIVAL.name} 부스 보러 가기</span></span>
    ${$("#festArt").innerHTML}
  </button>` : ""}

  <section class="section">
    <div class="sec-head"><div><div class="sec-title">마감이 다가와요</div><div class="sec-sub">7일 안에 신청이 끝나는 소식이에요</div></div></div>
    ${urgent.length ? `<div class="carousel">${urgent.map(n => `
      <button class="u-card" data-open="${n.id}">
        <span class="badges">${badgesFor(n)}</span>
        <span class="ttl">${esc(n.title)}</span>
        <span class="meta">${esc(n.host)}<br>${fmt(n.deadline)}까지</span>
      </button>`).join("")}</div>` : emptyBlock("급하게 챙길 소식이 없어요", "여유롭게 둘러봐도 괜찮아요")}
  </section>

  <section class="section">
    <div class="sec-head"><div class="sec-title">새로 올라온 소식</div><button class="text-btn" data-tab="school">전체보기${icon("i-chev","s16")}</button></div>
    <div class="list">${latest.map(row).join("") || emptyBlock("검색 결과가 없어요", "다른 단어로 찾아볼까요")}</div>
  </section>

  <section class="section">
    <div class="sec-head"><div><div class="sec-title">여기저기 흩어진 소식을 모았어요</div><div class="sec-sub">출처별로 모은 소식 개수예요</div></div></div>
    <div class="sources">${Object.entries(SOURCES).map(([k, s]) => `
      <div class="src"><span class="ic">${icon(s.icon, "s20")}</span><span><div class="name">${s.name}</div><div class="cnt">소식 ${srcCount(k)}개</div></span></div>`).join("")}</div>
  </section>
  <p class="foot">${crawledAgo()}을지소식은 개인이 만든 비공식 페이지예요. 정확한 내용은 원문에서 확인해 주세요.</p>`;
}

function crawledAgo() {
  if (!window.CRAWLED_AT) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(window.CRAWLED_AT)) / 6e4));
  const t = min < 1 ? "방금" : min < 60 ? `${min}분 전` : min < 1440 ? `${Math.round(min / 60)}시간 전` : `${Math.round(min / 1440)}일 전`;
  return `공식 홈페이지 공지는 ${t}에 가져왔어요.<br>`;
}

function viewCategory(cat) {
  const subs = cat === "school" ? SCHOOL_SUBS : ["동아리 행사", "동아리 모집", "학생회"];
  const base = NEWS.filter(n => n.cat === cat).filter(alive).filter(matchQ);
  const list = base.filter(n => state.chip === "전체" || n.sub === state.chip)
    .sort(byUrgency);
  const title = cat === "school" ? "학교 소식" : "학생 소식";
  const sub = cat === "school" ? "학교 기관 공지 게시판 8곳에서 모았어요" : "동아리 행사와 모집, 학생회 소식이에요";
  return `<section class="section">
    <div class="sec-head"><div><div class="sec-title">${title}</div><div class="sec-sub">${sub}</div></div></div>
    ${chipsBar(subs, base)}
    <div class="list">${list.map(row).join("") || emptyBlock("아직 올라온 소식이 없어요", "새 소식이 생기면 여기에 보여드릴게요")}</div>
  </section>`;
}

function viewFestival() {
  const total = Math.round((FESTIVAL.end - FESTIVAL.start) / DAY) + 1;
  const days = Array.from({ length: total }, (_, i) => new Date(FESTIVAL.start.getTime() + i * DAY));
  const types = ["먹거리", "체험", "굿즈"];
  const booths = BOOTHS.filter(matchQ).map(b => ({ ...b, cat: "festival", sub: b.type }));
  const filtered = booths.filter(b => state.chip === "전체" || b.type === state.chip);

  let body = "";
  if (state.festSeg === "booth") body = chipsBar(types, booths) + `<div class="list">${filtered.map(row).join("") || emptyBlock("찾는 부스가 없어요", "다른 단어로 찾아볼까요")}</div>`;
  if (state.festSeg === "show") body = `<div class="tl">${SHOWS.map(s => `
    <div class="tl-item ${s.state}">
      <div class="tl-time ${s.state === "past" ? "past" : ""}">${s.time}</div>
      <div class="tl-rail"><span class="tl-node ${s.state}"></span></div>
      <div class="tl-body"><div class="ttl">${esc(s.title)}${s.state === "live" ? `<span class="badge brand">지금 공연 중</span>` : ""}</div><div class="sub">${esc(s.host)}</div></div>
    </div>`).join("")}</div>`;
  if (state.festSeg === "notice") body = FEST_NOTICES.map(n => `<div class="notice"><div class="ttl">${esc(n.title)}</div><div class="sub">${esc(n.sub)}</div><div class="when">${esc(n.when)}</div></div>`).join("") + `<div style="height:4px"></div>`;

  return `
  <div class="fest-hero">
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="flex:1"><span class="badge brand">기간 한정</span>
        <h2>${FESTIVAL.name}</h2>
        <p class="lead">부스 위치, 공연 시간, 공지를 한 번에 볼 수 있어요</p></div>
      ${$("#festArt").innerHTML}
    </div>
    <div class="days">${days.map((dt, i) => `
      <div class="day ${+dt === +TODAY ? "now" : ""}"><span class="d">${i+1}일차${+dt === +TODAY ? " · 오늘" : ""}</span><span class="v">${dt.getMonth()+1}.${dt.getDate()} ${W[dt.getDay()]}</span></div>`).join("")}</div>
  </div>
  <section class="section">
    <div class="seg" role="tablist">
      ${[["booth","부스 " + BOOTHS.length],["show","공연"],["notice","공지"]].map(([k, v]) => `<button role="tab" data-seg="${k}" aria-selected="${state.festSeg === k}">${v}</button>`).join("")}
    </div>
    ${body}
  </section>`;
}

function viewSaved() {
  const list = [...state.saved].map(byId).filter(Boolean);
  return `<section class="section">
    <div class="sec-head"><div><div class="sec-title">저장한 소식</div><div class="sec-sub">${list.length ? `${list.length}개를 저장했어요` : "북마크를 누르면 여기에 모여요"}</div></div></div>
    <div class="list">${list.map(row).join("") || emptyBlock("저장한 소식이 없어요", "관심 있는 소식에서 북마크를 눌러 주세요")}</div>
  </section>`;
}

function render() {
  renderTabs();
  const m = $("#main");
  m.innerHTML = `<div class="view">${
    state.tab === "home" ? viewHome() :
    state.tab === "festival" ? viewFestival() :
    state.tab === "saved" ? viewSaved() : viewCategory(state.tab)
  }</div>`;
  const dot = $("#savedDot");
  dot.hidden = !state.saved.size; dot.textContent = state.saved.size;
}

/* ───────── Sheet ───────── */
function openSheet(id) {
  const n = byId(id); if (!n) return;
  const saved = state.saved.has(n.id);
  const rows = [];
  if (n.deadline) rows.push(["i-clock", "마감", `${fmt(n.deadline)} · ${dday(n.deadline)}`]);
  if (n.date) rows.push(["i-cal", "일시", fmt(n.date)]);
  if (n.time) rows.push(["i-clock", "운영", n.time]);
  if (n.place) rows.push(["i-pin", "장소", n.place]);
  if (n.mileage) rows.push(["i-zap", "혜택", `마일리지 ${n.mileage}점`]);
  if (n.prize) rows.push(["i-trophy", "상금", n.prize]);
  if (n.campus) rows.push(["i-pin", "캠퍼스", n.campus]);
  rows.push(["i-msg", "출처", n.source === "official" ? `${n.host} 공지` : SOURCES[n.source].name]);

  $("#sheetContent").innerHTML = `
    <div class="badges"><span class="badge">${esc(n.sub)}</span>${badgesFor(n)}</div>
    <h3 id="sheetTitle">${esc(n.title)}</h3>
    <div class="sec-sub" style="margin-top:4px">${esc(n.host)}</div>
    <p class="desc">${esc(n.desc || "")}</p>
    <div class="info">${rows.map(([ic, k, v]) => `<div class="info-row"><span class="k">${icon(ic, "s16")}${k}</span><span class="v">${esc(v)}</span></div>`).join("")}</div>`;
  $("#sheetActions").innerHTML = `
    <button class="btn secondary" data-save="${n.id}" aria-pressed="${saved}">${saved ? "저장됨" : "저장"}</button>
    <button class="btn primary" data-origin="${n.id}">${n.cat === "festival" ? "위치 보기" : "원문 보기"}${icon("i-ext", "s20")}</button>`;
  $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#scrim").classList.remove("on"); $("#sheet").classList.remove("on");
  document.body.style.overflow = "";
}

let toastT;
function toast(msg) {
  $("#toastMsg").textContent = msg; $("#toast").classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("on"), 1800);
}

// 학교 CMS 게시판은 글 주소가 없고 POST로만 열려서, 숨은 폼을 만들어 새 탭으로 보낸다
function openOriginal(n) {
  if (!n || !n.link) { toast("원문 링크가 아직 없어요"); return; }
  if (n.link.method !== "POST") { window.open(n.link.url, "_blank", "noopener"); return; }
  const f = document.createElement("form");
  f.method = "POST"; f.action = n.link.url; f.target = "_blank"; f.style.display = "none";
  for (const [k, v] of Object.entries(n.link.fields || {})) {
    const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i);
  }
  document.body.appendChild(f); f.submit(); f.remove();
}

function toggleSave(id) {
  if (state.saved.has(id)) { state.saved.delete(id); toast("저장을 취소했어요"); }
  else { state.saved.add(id); toast("저장했어요"); }
  persist(); render();
  if ($("#sheet").classList.contains("on")) openSheet(id);
}

/* ───────── Events ───────── */
document.addEventListener("click", e => {
  const s = e.target.closest("[data-save]");
  if (s) { e.stopPropagation(); toggleSave(s.dataset.save); return; }
  const og = e.target.closest("[data-origin]");
  if (og) { openOriginal(byId(og.dataset.origin)); return; }
  const t = e.target.closest("[data-tab]");
  if (t) { state.tab = t.dataset.tab; state.chip = "전체"; render(); window.scrollTo({ top: 0 }); return; }
  const c = e.target.closest("[data-chip]");
  if (c) { state.chip = c.dataset.chip; render(); return; }
  const g = e.target.closest("[data-seg]");
  if (g) { state.festSeg = g.dataset.seg; state.chip = "전체"; render(); return; }
  const o = e.target.closest("[data-open]");
  if (o) { openSheet(o.dataset.open); return; }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeSheet();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".row[data-open]")) { e.preventDefault(); openSheet(e.target.dataset.open); }
});
$("#scrim").addEventListener("click", closeSheet);
$("#savedBtn").addEventListener("click", () => { state.tab = state.tab === "saved" ? "home" : "saved"; render(); });
$("#searchBtn").addEventListener("click", () => {
  const w = $("#searchWrap"); w.classList.toggle("on");
  if (w.classList.contains("on")) $("#q").focus(); else { $("#q").value = ""; state.query = ""; render(); }
});
$("#q").addEventListener("input", e => { state.query = e.target.value.trim(); render(); });

/* Theme */
const root = document.documentElement;
function applyThemeIcon() {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#themeBtn use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
}
try { const t = localStorage.getItem("eulji-theme"); if (t) root.dataset.theme = t; } catch (e) {}
$("#themeBtn").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("eulji-theme", root.dataset.theme); } catch (e) {}
  applyThemeIcon();
});
applyThemeIcon();
const h = location.hash.slice(1);
if (["home","school","student","festival","saved"].includes(h)) state.tab = h;
render();
