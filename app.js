/* ───────── 데이터 ───────── */
const DAY = 864e5;
const TODAY = new Date(); TODAY.setHours(0,0,0,0);

// 소식이 흩어져 있던 곳
const SOURCES = {
  official: { name: "공식 홈페이지", icon: "i-globe" },
  everytime: { name: "에브리타임", icon: "i-msg" },
  instagram: { name: "인스타그램", icon: "i-camera" },
  other: { name: "기타", icon: "i-pin" },
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
const BOARD_ICON = { job: "i-brief", ctl: "i-cap", intl: "i-globe", counsel: "i-heart", innov: "i-zap", aac: "i-target", lib: "i-book", liberal: "i-cap", acad: "i-cal" };
const SCHOOL_SUBS = ["학사", "비교과·프로그램", "공모전", "장학·지원", "일반 공지"];
// 기간이 여러 개(1차·2차)면 아직 안 끝난 것 중 가장 가까운 끝나는 날을, 모두 끝났으면 마지막 날을 마감으로 본다
function pickDeadline(c) {
  if (c.deadline) return parseDay(c.deadline);
  const ends = (c.periods || []).map(p => p.end).sort();
  if (!ends.length) return undefined;
  return parseDay(ends.find(e => parseDay(e) >= TODAY) || ends[ends.length - 1]);
}
if (Array.isArray(window.CRAWLED) && window.CRAWLED.length) {
  const crawled = window.CRAWLED.map(c => ({
    id: c.id, cat: "school", sub: c.sub, icon: BOARD_ICON[c.board] || "i-mega",
    title: c.title, host: c.host, source: "official", campus: c.campus,
    deadline: pickDeadline(c), date: parseDay(c.date), dateEnd: parseDay(c.dateEnd), posted: parseDay(c.posted),
    place: c.place, mileage: c.mileage, desc: c.text, link: c.link,
  }));
  NEWS.splice(0, NEWS.length, ...crawled, ...NEWS.filter(n => n.cat !== "school"));
}
NEWS.forEach(n => { n.id = String(n.id); });
BOOTHS.forEach(b => { b.id = String(b.id); });

/* ───────── 직접 입력한 소식 ─────────
   data/manual.js(GitHub에 저장된 것) + 이 기기에만 있는 것(아직 동기화 전) + 삭제 표시를 합친다. */
const STUDENT_SUBS = ["동아리 행사", "동아리 모집", "학생회", "소규모 행사"];
const MANUAL_ICON = { "비교과·프로그램": "i-zap", "공모전": "i-trophy", "장학·지원": "i-globe", "일반 공지": "i-mega", "동아리 행사": "i-music", "동아리 모집": "i-heart", "학생회": "i-mega", "소규모 행사": "i-users" };
const LOCAL_KEY = "eulji-manual-local", DEL_KEY = "eulji-manual-del";
const readList = k => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { return []; } };
const writeList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

function manualToNews(m) {
  return {
    id: m.id, cat: m.cat, sub: m.sub, icon: MANUAL_ICON[m.sub] || "i-mega", title: m.title, host: m.host || "",
    source: SOURCES[m.source] ? m.source : "other", deadline: parseDay(m.deadline), date: parseDay(m.date),
    posted: parseDay(m.posted), place: m.place, mileage: m.mileage, desc: m.desc, link: m.link, manual: true,
  };
}
function reloadManual() {
  const synced = Array.isArray(window.MANUAL) ? window.MANUAL : [];
  const syncedIds = new Set(synced.map(m => m.id));
  const del = new Set(readList(DEL_KEY));
  writeList(DEL_KEY, [...del].filter(id => syncedIds.has(id)));            // 배포에서 사라진 삭제 표시는 정리
  const local = readList(LOCAL_KEY).filter(m => !syncedIds.has(m.id));     // 배포에 반영된 로컬 글은 정리
  writeList(LOCAL_KEY, local);
  for (let i = NEWS.length - 1; i >= 0; i--) if (NEWS[i].manual) NEWS.splice(i, 1);
  NEWS.push(...[...synced.filter(m => !del.has(m.id)), ...local].map(manualToNews));
}
reloadManual();

/* ───────── State ───────── */
const state = { tab: "home", chip: "전체", festSeg: "booth", query: "", saved: new Set(), done: new Map(), hideDone: true };
// '신청 완료 숨기기' 스위치는 기기마다 따로 둔다 (동기화하지 않는다)
try { if (localStorage.getItem("eulji-hide-done") === "0") state.hideDone = false; } catch (e) {}
const persistHide = () => { try { localStorage.setItem("eulji-hide-done", state.hideDone ? "1" : "0"); } catch (e) {} };

/* ───────── 신청 완료·저장(북마크), 폰·PC 동기화 ─────────
   항목마다 { on, at } 을 두고 '나중에 한 동작'(at이 큰 쪽)이 이긴다.
   체크를 푼 것도 on:false 로 남겨야 다른 기기에서도 풀린다.
   done 항목에는 글 사본(s)도 같이 둔다: 학교 게시판에서 글이 내려가거나 마감이 지나도 '신청 완료' 탭에는 남도록.
   GitHub 연결이 있으면 input.js 가 data/state.js 로 주고받는다. 연결이 없으면 이 기기에만 저장된다. */
const SYNC_KEY = "eulji-sync";
let sync = { done: {}, saved: {} };
function mergeSync(a, b) {
  const out = { done: {}, saved: {} };
  for (const k of ["done", "saved"]) {
    for (const src of [(a && a[k]) || {}, (b && b[k]) || {}]) {
      for (const [id, e] of Object.entries(src)) {
        const cur = out[k][id];
        if (!cur || (e.at || 0) > (cur.at || 0)) out[k][id] = e;
      }
    }
  }
  return out;
}
function pruneSync(s) { // 풀어 둔 지 90일 넘은 기록은 정리한다
  const limit = Date.now() - 90 * DAY;
  for (const k of ["done", "saved"]) for (const [id, e] of Object.entries(s[k])) if (!e.on && (e.at || 0) < limit) delete s[k][id];
  return s;
}
function deriveState() {
  state.saved = new Set(Object.entries(sync.saved).filter(([, e]) => e.on).map(([id]) => id));
  state.done = new Map(Object.entries(sync.done).filter(([, e]) => e.on).map(([id, e]) => [id, e.s]));
}
const saveSyncLocal = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {} };
// 다른 곳(GitHub)에서 받은 기록을 합친다. 이 기기 기록이 바뀌었으면 true
function applyRemote(remote) {
  const merged = pruneSync(mergeSync(sync, remote));
  const changed = JSON.stringify(merged) !== JSON.stringify(sync);
  sync = merged; deriveState(); saveSyncLocal();
  return changed;
}
function markChanged() { saveSyncLocal(); deriveState(); if (window.syncSoon) window.syncSoon(); }
const setDone = (n, on) => { sync.done[n.id] = on ? { on: true, at: Date.now(), s: snapOf(n) } : { on: false, at: Date.now() }; markChanged(); };
const setSaved = (id, on) => { sync.saved[id] = { on, at: Date.now() }; markChanged(); };

try { sync = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); } catch (e) { sync = null; }
if (!sync) { // 예전 방식(이 기기에만 저장)에서 옮겨 온다
  sync = { done: {}, saved: {} };
  try { JSON.parse(localStorage.getItem("eulji-saved") || "[]").forEach(id => { sync.saved[String(id)] = { on: true, at: 1 }; }); } catch (e) {}
  try { Object.entries(JSON.parse(localStorage.getItem("eulji-done") || "{}")).forEach(([id, s]) => { sync.done[id] = { on: true, at: 1, s }; }); } catch (e) {}
}
applyRemote(window.USER_STATE); // 배포된 data/state.js (다른 기기에서 한 것)

const ymdS = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : undefined;
const snapOf = n => ({
  id: n.id, cat: n.cat, sub: n.sub, icon: n.icon, title: n.title, host: n.host, source: n.source, campus: n.campus,
  place: n.place, mileage: n.mileage, desc: n.desc ? n.desc.slice(0, 300) : undefined, link: n.link, manual: n.manual,
  deadline: ymdS(n.deadline), date: ymdS(n.date), dateEnd: ymdS(n.dateEnd), posted: ymdS(n.posted),
});
const fromSnap = s => ({ ...s, deadline: parseDay(s.deadline), date: parseDay(s.date), dateEnd: parseDay(s.dateEnd), posted: parseDay(s.posted) });

/* ───────── Helpers ───────── */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const W = ["일","월","화","수","목","금","토"];
const fmt = dt => `${dt.getMonth()+1}월 ${dt.getDate()}일(${W[dt.getDay()]})`;
const daysLeft = dt => Math.round((dt - TODAY) / DAY);
const dday = dt => { const n = daysLeft(dt); return n === 0 ? "오늘 마감" : n > 0 ? `D-${n}` : "마감"; };
const icon = (id, cls = "") => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;
// 목록에서 내려간 글도 신청 완료한 것이면 사본으로 되살려서 함께 돌려준다
const allItems = () => {
  const live = [...NEWS, ...BOOTHS.map(b => ({ ...b, cat: "festival", sub: b.type, source: "everytime" }))];
  const ids = new Set(live.map(x => x.id));
  return [...live, ...[...state.done].filter(([id]) => !ids.has(id)).map(([, s]) => fromSnap(s))];
};
const byId = id => allItems().find(x => x.id === String(id));
const isDone = n => state.done.has(n.id);
const shown = n => !(state.hideDone && isDone(n));   // '신청 완료 숨기기'가 켜져 있으면 완료한 글을 목록에서 뺀다
// 마감이 지났거나, 행사가 끝났거나, 마감·일시 없이 30일 넘은 글은 숨긴다
// 모집·신청이 아닌 "결과 발표"류 글은 숨긴다 (합격자·수상자·선정 결과 등)
const RESULT_RE = /결과|합격자|수상자|당첨자|선정자|명단|(참여자|참가자|팀) ?발표/;
// 중요한 학사 안내는 날짜 정보가 없어도 오래 보여 준다 (제목에 이 말이 들어 있으면). 마감이 지나면 숨긴다.
// 더 오래 보고 싶은 글이 있으면 여기에 단어를 추가한다.
const ALWAYS_SHOW_RE = /강의 ?평가|추가 ?학기|계절 ?학기/;
const alive = n => {
  if (RESULT_RE.test(n.title)) return false;
  if (n.deadline) return daysLeft(n.deadline) >= 0;
  if (n.date) return daysLeft(n.dateEnd || n.date) >= 0;
  if (ALWAYS_SHOW_RE.test(n.title)) return true;
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
  if (n.deadline && !noDday) { const k = daysLeft(n.deadline); b.push(`<span class="badge ${k >= 0 && k <= 3 ? "danger" : ""}">${dday(n.deadline)}</span>`); }
  if (n.mileage) b.push(`<span class="badge brand">마일리지 ${n.mileage}점</span>`);
  if (n.prize) b.push(`<span class="badge">${esc(n.prize)}</span>`);
  return b.join("");
}

// 목록에 보여 줄 제목: 맨 앞의 "2026학년도 2학기", "2026-2", "2026년 하반기" 같은 연도·학기 말머리를 뗀다.
// 보여 주는 용도뿐이라 원래 제목은 그대로 두고(상세 창, 검색), "2026 EU 취업박람회"처럼 행사 이름에 든 연도는 건드리지 않는다.
const YEAR_PREFIX_RE = /^20\d{2}\s*(?:학년도|년도|년)\s*(?:[12]\s*학기|전기|후기|상반기|하반기)?\s*|^20\d{2}\s*-\s*[12]\s+|^20\d{2}\s+[12]\s*학기\s*/;
function shortTitle(t) {
  const m = t.match(/^(\[[^\]]*\]\s*)?([\s\S]*)$/); // 앞의 [말머리]는 남기고 그 뒤에서 뗀다
  const rest = m[2].replace(YEAR_PREFIX_RE, "");
  return rest.trim().length >= 4 ? (m[1] || "") + rest : t;
}

function row(n) {
  const saved = state.saved.has(n.id);
  const done = isDone(n);
  // 오른쪽에 둘 마감/날짜(dd)와 보조 글(wh). 좁은 화면에서는 제목 아래 한 줄로 합쳐 보여 준다
  let dd = "", hot = false, wh = "";
  if (n.deadline) { const k = daysLeft(n.deadline); dd = dday(n.deadline); hot = k >= 0 && k <= 3; wh = `${n.deadline.getMonth()+1}.${n.deadline.getDate()} 마감`; }
  else if (n.date && n.dateEnd) { dd = `~${n.dateEnd.getMonth()+1}.${n.dateEnd.getDate()}`; wh = daysLeft(n.date) > 0 ? `시작 ${n.date.getMonth()+1}.${n.date.getDate()}` : "진행 중"; }
  else if (n.date) { dd = `${n.date.getMonth()+1}.${n.date.getDate()}`; wh = `${W[n.date.getDay()]}요일`; }
  else if (n.time) wh = n.time;
  else if (n.posted) wh = `${n.posted.getMonth()+1}.${n.posted.getDate()} 게시`;
  const right = `${dd ? `<span class="dday ${hot ? "hot" : ""}">${esc(dd)}</span>` : ""}<span class="when">${esc(wh)}</span>`;
  // 크롤링한 글은 전부 공식 홈페이지 것이라 출처를 적지 않고, 에타·인스타 같은 직접 입력 글만 출처를 보여 준다
  const srcName = n.source === "official" ? "" : (SOURCES[n.source] || SOURCES.other).name;
  const sub = n.cat === "festival" ? `${esc(n.place)} · ${esc(n.host)}` : [esc(n.host), srcName].filter(Boolean).join(" · ");
  const mline = [dd ? `<b class="dday ${hot ? "hot" : ""}">${esc(dd)}</b>` : "", wh ? esc(wh) : "", sub].filter(Boolean).join(" · ");
  const bd = n.mileage || n.prize ? badgesFor(n, { noDday: true }) : ""; // 마일리지·상금 배지
  // 아이콘 칸이 곧 '신청 완료' 버튼이다. 누르면 진분홍으로 바뀐다 (축전 부스는 해당 없음)
  const avatar = n.cat === "festival" ? `<span class="avatar">${icon(n.icon)}</span>` :
    `<button class="avatar" data-done="${n.id}" role="checkbox" aria-checked="${done}" aria-label="신청 완료 표시">${icon(n.icon)}</button>`;
  return `<div class="row${done && state.tab !== "done" ? " is-done" : ""}" role="button" tabindex="0" data-open="${n.id}">
    ${avatar}
    <span class="body"><span class="ttl">${esc(shortTitle(n.title))}</span><span class="sub">${sub}</span><span class="mline"><span class="mtxt">${mline}</span>${bd ? `<span class="mbadges">${bd}</span>` : ""}</span>
      ${bd ? `<span class="badges" style="margin-top:4px">${bd}</span>` : ""}</span>
    <span class="right">${right}</span>
    <button class="save-btn" data-save="${n.id}" aria-pressed="${saved}" aria-label="${saved ? "저장 취소" : "저장"}">${icon("i-bookmark", "s20")}</button>
  </div>`;
}

// '신청 완료한 소식 숨기기' 스위치 (켜고 끌 수 있고, 마지막 상태를 기억한다)
function doneFilter() {
  const n = state.done.size;
  return `<div class="filter-row"><span>신청 완료한 소식 숨기기${n ? `<em>${n}</em>` : ""}</span>
    <button class="sw" role="switch" aria-checked="${state.hideDone}" data-hidedone aria-label="신청 완료한 소식 숨기기"></button></div>`;
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
  const t = [["home","홈"],["school","학교 소식"],["student","학생 소식"],["done","신청 완료"]];
  if (FESTIVAL.active) t.push(["festival","을지축전"]);
  return t;
}
function renderTabs() {
  const el = $("#tabs");
  if (state.tab === "saved") { el.innerHTML = `<button class="tab" aria-selected="true" role="tab">저장한 소식</button><button class="tab" data-tab="home" role="tab">돌아가기</button>`; return; }
  el.innerHTML = tabsDef().map(([k, v]) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${v}${k === "done" && state.done.size ? `<span class="tabn">${state.done.size}</span>` : ""}${k === "festival" ? `<span class="limited">기간 한정</span>` : ""}</button>`).join("");
}

/* ───────── Views ───────── */
function viewHome() {
  const live = NEWS.filter(alive).filter(matchQ).filter(shown);
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
        <span class="ttl">${esc(shortTitle(n.title))}</span>
        <span class="meta">${esc(n.host)}<br>${fmt(n.deadline)}까지</span>
      </button>`).join("")}</div>` : emptyBlock("급하게 챙길 소식이 없어요", "여유롭게 둘러봐도 괜찮아요")}
  </section>

  <section class="section">
    <div class="sec-head"><div class="sec-title">새로 올라온 소식</div><button class="text-btn" data-tab="school">전체보기${icon("i-chev","s16")}</button></div>
    ${doneFilter()}
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
  const subs = cat === "school" ? SCHOOL_SUBS : STUDENT_SUBS;
  const base = NEWS.filter(n => n.cat === cat).filter(alive).filter(matchQ).filter(shown);
  const list = base.filter(n => state.chip === "전체" || n.sub === state.chip)
    .sort(byUrgency);
  const title = cat === "school" ? "학교 소식" : "학생 소식";
  const sub = cat === "school" ? "학교 기관 공지 게시판 9곳에서 모았어요" : "동아리, 학생회, 조별 모임 같은 소규모 행사 소식이에요";
  return `<section class="section">
    <div class="sec-head"><div><div class="sec-title">${title}</div><div class="sec-sub">${sub}</div></div></div>
    ${doneFilter()}
    ${chipsBar(subs, base)}
    <div class="list">${list.map(row).join("") || emptyBlock("아직 올라온 소식이 없어요", "오른쪽 아래 + 버튼으로 소식을 추가해 보세요")}</div>
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

// 신청 완료한 소식 모아보기. 마감이 지난 것도 보이고, 지난 것은 아래로 보낸다
function viewDone() {
  const past = n => (n.deadline && daysLeft(n.deadline) < 0) || (!n.deadline && n.date && daysLeft(n.dateEnd || n.date) < 0);
  const list = allItems().filter(isDone).filter(matchQ).sort((a, b) => past(a) - past(b) || byUrgency(a, b));
  return `<section class="section">
    <div class="sec-head"><div><div class="sec-title">신청 완료</div><div class="sec-sub">${list.length ? `${list.length}개를 신청했어요` : "체크한 소식이 여기에 모여요"}</div></div></div>
    <div class="list">${list.map(row).join("") || emptyBlock("신청 완료한 소식이 없어요", "소식에서 '신청 완료'를 체크하면 여기에 모여요")}</div>
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
    state.tab === "saved" ? viewSaved() :
    state.tab === "done" ? viewDone() : viewCategory(state.tab)
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
  if (n.date) rows.push(["i-cal", n.dateEnd ? "기간" : "일시", n.dateEnd ? `${fmt(n.date)} ~ ${fmt(n.dateEnd)}` : fmt(n.date)]);
  if (n.time) rows.push(["i-clock", "운영", n.time]);
  if (n.place) rows.push(["i-pin", "장소", n.place]);
  if (n.mileage) rows.push(["i-zap", "혜택", `마일리지 ${n.mileage}점`]);
  if (n.prize) rows.push(["i-trophy", "상금", n.prize]);
  if (n.campus) rows.push(["i-pin", "캠퍼스", n.campus]);
  rows.push(["i-msg", "출처", n.source === "official" ? `${n.host} 공지` : (SOURCES[n.source] || SOURCES.other).name]);

  $("#sheetContent").innerHTML = `
    <div class="badges"><span class="badge">${esc(n.sub)}</span>${badgesFor(n)}</div>
    <h3 id="sheetTitle">${esc(n.title)}</h3>
    <div class="sec-sub" style="margin-top:4px">${esc(n.host)}</div>
    <p class="desc">${esc(n.desc || "")}</p>
    <div class="info">${rows.map(([ic, k, v]) => `<div class="info-row"><span class="k">${icon(ic, "s16")}${k}</span><span class="v">${esc(v)}</span></div>`).join("")}</div>
    ${n.cat === "festival" ? "" : `<button class="done-row" data-done="${n.id}" role="checkbox" aria-checked="${isDone(n)}"><span>신청 완료했어요</span><span class="box">${icon("i-check", "s16")}</span></button>`}`;
  const canOpen = n.cat === "festival" || n.link;
  $("#sheetActions").innerHTML = `
    <button class="btn secondary" data-save="${n.id}" aria-pressed="${saved}">${saved ? "저장됨" : "저장"}</button>
    ${n.manual ? `<button class="btn secondary" data-delete="${n.id}">삭제</button>` : ""}
    ${canOpen ? `<button class="btn primary" data-origin="${n.id}">${n.cat === "festival" ? "위치 보기" : "원문 보기"}${icon("i-ext", "s20")}</button>` : ""}`;
  $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
  document.body.style.overflow = "hidden";
  sheetPush();
}
/* ───────── 뒤로 가기 ─────────
   탭 이동과 상세 창 열기를 브라우저 이동 기록에 남긴다 (주소는 그대로).
   그래서 폰의 뒤로 가기는 사이트를 나가지 않고: 창이 열려 있으면 창을 내리고, 아니면 이전 탭으로 돌아간다. */
function sheetPush() { // 창이 열릴 때 기록을 한 칸 쌓는다. 이미 창 기록 위라면(창 안에서 내용만 바뀌는 경우) 쌓지 않는다
  if (!(history.state && history.state.sheet)) history.pushState({ tab: state.tab, sheet: true }, "");
}
function hideSheet() { // 화면에서만 창을 내린다
  $("#scrim").classList.remove("on"); $("#sheet").classList.remove("on");
  document.body.style.overflow = "";
}
function closeSheet() { // 창 기록이 있으면 뒤로 가서 지우고 (popstate가 창을 내린다), 없으면 바로 내린다
  if (history.state && history.state.sheet) history.back(); else hideSheet();
}
function goTab(t) {
  state.chip = "전체";
  if (state.tab !== t) { state.tab = t; history.pushState({ tab: t }, ""); }
  render(); window.scrollTo({ top: 0 });
}
window.addEventListener("popstate", e => {
  const s = e.state || { tab: "home" };
  const open = $("#sheet").classList.contains("on");
  if (!s.sheet && open) hideSheet();
  if (s.sheet && !open) history.replaceState({ tab: s.tab }, ""); // 앞으로 가기로 창 기록에 닿아도 내용을 되살릴 수 없으니 탭 기록으로 바꾼다
  const t = s.tab || "home";
  if (t !== state.tab) { state.tab = t; state.chip = "전체"; render(); window.scrollTo({ top: 0 }); }
});

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

function toggleDone(id) {
  const n = byId(id); if (!n) return;
  if (state.done.has(id)) { setDone(n, false); toast("신청 완료 표시를 풀었어요"); }
  else { setDone(n, true); toast("신청 완료로 표시했어요"); }
  render();
  if ($("#sheet").classList.contains("on")) { if (byId(id)) openSheet(id); else closeSheet(); }
}

function toggleSave(id) {
  if (state.saved.has(id)) { setSaved(id, false); toast("저장을 취소했어요"); }
  else { setSaved(id, true); toast("저장했어요"); }
  render();
  if ($("#sheet").classList.contains("on")) openSheet(id);
}

/* ───────── Events ───────── */
document.addEventListener("click", e => {
  const s = e.target.closest("[data-save]");
  if (s) { e.stopPropagation(); toggleSave(s.dataset.save); return; }
  const dn = e.target.closest("[data-done]");
  if (dn) { e.stopPropagation(); toggleDone(dn.dataset.done); return; }
  const hd = e.target.closest("[data-hidedone]");
  if (hd) { state.hideDone = !state.hideDone; persistHide(); render(); return; }
  const del = e.target.closest("[data-delete]");
  if (del) { window.deleteManual && window.deleteManual(del.dataset.delete); return; }
  const og = e.target.closest("[data-origin]");
  if (og) { openOriginal(byId(og.dataset.origin)); return; }
  const t = e.target.closest("[data-tab]");
  if (t) { goTab(t.dataset.tab); return; }
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
$("#savedBtn").addEventListener("click", () => goTab(state.tab === "saved" ? "home" : "saved"));
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
if (["home","school","student","done","festival","saved"].includes(h)) state.tab = h;
// 이동 기록의 바닥은 항상 홈으로 둔다. 그러면 어느 탭으로 들어와도 뒤로 가기는 홈으로 가고, 홈에서 한 번 더 누르면 사이트를 나간다
history.replaceState({ tab: "home" }, "");
if (state.tab !== "home") history.pushState({ tab: state.tab }, "");
render();
