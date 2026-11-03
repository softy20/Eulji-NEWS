// 을지대 공지 게시판 크롤러
// 실행: node crawler/crawl.mjs
// 결과: data/notices.js (window.CRAWLED = [...]) — file:// 로 열어도 읽히도록 JS로 저장한다.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "notices.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 EuljiNewsPersonal/1.0";
const DELAY_MS = 700;        // 요청 사이 간격 (서버 배려)
const MAX_AGE_DAYS = 90;     // 이보다 오래된 글은 버린다
const MAX_DETAIL_PER_BOARD = 15;

// 학교 CMS 게시판 (table.board-list + submitForm 구조 공통)
const CMS_BOARDS = [
  { key: "job",     host: "진로취창업센터",   list: "https://job.eulji.ac.kr/index.html?menuno=4371" },
  { key: "ctl",     host: "교수학습지원센터", list: "https://ctl.eulji.ac.kr/?menuno=4104" },
  { key: "intl",    host: "국제교류팀",       list: "https://eulji.ac.kr/international/index.html?menuno=4856" },
  { key: "counsel", host: "인권센터",         list: "https://counsel.eulji.ac.kr/?menuno=4056" },
  { key: "innov",   host: "대학혁신지원사업단", list: "https://www.eulji.ac.kr/renewal-innovation/index.html?menuno=6006" },
  { key: "aac",     host: "전공설계지원센터", list: "https://eulji.ac.kr/aac/index.html?menuno=7191" },
  { key: "liberal", host: "교양학부",         list: "https://liberal.eulji.ac.kr/?menuno=3273" },
  // 다른 게시판과 같은 글이 겹치면 앞쪽 게시판 것이 남으므로 맨 뒤에 둔다
  { key: "acad",    host: "학사 공지",        list: "https://eulji.ac.kr/renewal/index.html?menuno=3160", defaultSub: "학사" },
];
const LIB = { key: "lib", host: "학술정보원", list: "https://lib.eulji.ac.kr/eul/community/sc.csp?sccode=eulnotice", view: "https://lib.eulji.ac.kr/eul/community/view.csp?sccode=eulnotice&scKey=" };

/* ───────── utils ───────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// 학교 서버가 이름에 공백이 든 헤더("Referrer Policy: ...")를 보내서
// Node의 HTTP 파서(fetch, node:https 모두)가 응답을 거부한다. curl은 이를 받아주므로 curl을 쓴다.
// (curl은 Windows 10+ 와 GitHub Actions 우분투에 기본 포함)
function request(url, body) {
  const args = ["-s", "-S", "-L", "--max-time", "20", "-A", UA, "-H", "Accept-Language: ko-KR,ko;q=0.9", "-w", "\n%{http_code}"];
  if (body) for (const [k, v] of Object.entries(body)) args.push("--data-urlencode", `${k}=${v}`);
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr.trim() || err.message));
      const i = stdout.lastIndexOf("\n");
      const code = +stdout.slice(i + 1);
      if (code >= 400) return reject(new Error(`HTTP ${code}`));
      resolve(stdout.slice(0, i));
    });
  });
}

async function http(url, body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await request(url, body); }
    catch (e) { if (attempt === 2) throw e; await sleep(2000); }
  }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…" };
const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

function htmlToText(html) {
  return decode(html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* ───────── 본문에서 정보 뽑기 ───────── */
// 게시일 기준으로 연도가 없는 "11/6", "11. 6." 같은 날짜에 연도를 붙인다.
function withYear(m, d, posted) {
  const p = new Date(posted);
  let y = p.getFullYear();
  if (m < p.getMonth() + 1 - 6) y += 1; // 11월 글의 "1/10"은 다음 해
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) || dt.getMonth() !== m - 1 ? null : ymd(dt);
}

// "2026. 11. 6." / "11/6" / "11.6(금)" / "11월 6일"
const DATE_RE = /(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*(?:[./]|월)\s*(\d{1,2})\s*일?\.?/g;

function datesIn(str, posted) {
  const out = [];
  for (const m of str.matchAll(DATE_RE)) {
    const mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    out.push(m[1] ? ymd(new Date(+m[1], mo - 1, da)) : withYear(mo, da, posted));
  }
  return out.filter(Boolean);
}

function extract(title, text, posted) {
  const info = {};
  const lines = text.split("\n");

  // 마감일: 제목의 "(~11/6)" → 본문의 신청/접수/모집/마감 줄의 마지막 날짜
  const t = title.match(/~\s*(\d{1,2})\s*[./]\s*(\d{1,2})/);
  if (t) info.deadline = withYear(+t[1], +t[2], posted);
  if (!info.deadline) {
    const line = lines.find(l => /(신청|접수|모집|마감|제출)\s*(기간|기한|일정|마감)?\s*[:：]?/.test(l) && datesIn(l, posted).length);
    if (line) { const ds = datesIn(line, posted); info.deadline = ds[ds.length - 1]; }
  }

  // 행사 일시
  const when = lines.find(l => /^(일\s*시|행사\s*일시|교육\s*일시|일\s*정|기\s*간)\s*[:：]/.test(l.replace(/^[^\w가-힣]+/, "")));
  if (when) { const ds = datesIn(when, posted); if (ds.length) { info.date = ds[0]; if (ds.length > 1 && ds[ds.length - 1] !== ds[0]) info.dateEnd = ds[ds.length - 1]; } }

  // 장소
  const place = lines.map(l => l.replace(/^[^\w가-힣]+/, "")).find(l => /^장\s*소\s*[:：]/.test(l));
  if (place) info.place = place.replace(/^장\s*소\s*[:：]\s*/, "").slice(0, 60);

  // 마일리지 / 포인트
  const mi = text.match(/(마일리지|비교과\s*포인트|EU\s*포인트|포인트)[^\d\n]{0,12}(\d{1,3})\s*(점|포인트|P|p)/);
  if (mi) info.mileage = +mi[2];

  // "시작일 ~ 종료일" 기간. 강의평가처럼 '마감'이라는 말 없이 기간만 적힌 글에 쓴다 (1차·2차처럼 여러 개일 수 있다)
  const periods = [];
  for (const l of lines) {
    const k = l.search(/[~∼～]/);
    if (k < 0) continue;
    const left = datesIn(l.slice(0, k), posted), right = datesIn(l.slice(k + 1), posted);
    if (left.length && right.length) periods.push({ start: left[left.length - 1], end: right[0] });
  }
  if (periods.length) info.periods = periods;

  return info;
}

function classify(title, text) {
  const s = title + " " + text.slice(0, 400);
  if (/공모전|경진대회|대회|챌린지|콘테스트|서포터즈/.test(s)) return "공모전";
  if (/장학|등록금|지원금|교환학생|연수|파견/.test(s)) return "장학·지원";
  if (/비교과|마일리지|특강|캠프|프로그램|워크숍|세미나|교육\s*안내|강좌|멘토링|박람회/.test(s)) return "비교과·프로그램";
  return "일반 공지";
}

/* ───────── CMS 게시판 ───────── */
function parseCmsList(html) {
  const form = name => (html.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1] || "";
  const meta = { siteno: form("siteno"), no: form("no"), ztag: form("ztag") };
  const tbody = (html.match(/<table class="board-list"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || "";
  const rows = [];
  for (const tr of tbody.split(/<tr>/).slice(1)) {
    const v = tr.match(/submitForm\(this,'view',(\d+)\);"\s*title="([^"]*)"/);
    if (!v) continue;
    const date = (tr.match(/<td>\s*(20\d{2}-\d{2}-\d{2})\s*<\/td>/) || [])[1];
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => htmlToText(c[1]));
    rows.push({
      bbsno: v[1],
      title: decode(v[2]).trim(),
      date,
      pinned: /icon_notice/.test(tr.split("</td>")[0]),
      author: cells.find(c => c && !/^\d+$/.test(c) && c !== "-" && !/20\d{2}-/.test(c) && c !== decode(v[2]).trim()) || "",
    });
  }
  return { meta, rows };
}

async function crawlCms(board, known) {
  const html = await http(board.list);
  const { meta, rows } = parseCmsList(html);
  if (!rows.length) throw new Error("목록을 찾지 못했어요 (구조가 바뀌었을 수 있어요)");
  const base = board.list.split("?")[0];
  const action = board.list;
  const out = [];
  let detailCount = 0;

  for (const r of rows) {
    const id = `${board.key}-${r.bbsno}`;
    if (!r.date || (Date.now() - new Date(r.date)) / 864e5 > MAX_AGE_DAYS) continue;
    const fields = { act: "view", bbsno: r.bbsno, siteno: meta.siteno, no: meta.no, page: "1", ztag: meta.ztag };
    const item = {
      id, source: "official", board: board.key, host: board.host,
      title: r.title, posted: r.date, pinned: r.pinned,
      link: { url: action, method: "POST", fields },
      list: base === action ? action : board.list,
    };

    const prev = known.get(id);
    if (prev && prev.text !== undefined) {
      // 이미 받은 본문은 다시 요청하지 않고, 저장된 본문에서 정보만 다시 뽑는다 (추출 규칙을 고치면 바로 반영돼요)
      Object.assign(item, { text: prev.text, ...extract(r.title, prev.text, r.date) });
    } else if (detailCount < MAX_DETAIL_PER_BOARD) {
      detailCount++;
      await sleep(DELAY_MS);
      try {
        const v = await http(action, fields);
        const body = (v.match(/<div class="b-contants">([\s\S]*?)<div class="c-sns">/) || v.match(/<div class="b-contants">([\s\S]*?)<ul class="prev-next">/) || [])[1] || "";
        const text = htmlToText(body);
        Object.assign(item, { text: text.slice(0, 1500), ...extract(r.title, text, r.date) });
      } catch (e) {
        log(`   ! 본문 실패 ${id}: ${e.message}`);
      }
    }
    item.sub = board.defaultSub || classify(item.title, item.text || "");
    out.push(item);
  }
  return out;
}

/* ───────── 학술정보원 ───────── */
async function crawlLib(known) {
  const html = await http(LIB.list);
  const out = [];
  let detailCount = 0;
  for (const tr of html.split(/<tr>/).slice(1)) {
    const v = tr.match(/go_viewPage\('([^']+)'\);"\s*>([^<]+)<\/a>/);
    if (!v) continue;
    const date = (tr.match(/text-center">(20\d{2}-\d{2}-\d{2})</) || [])[1];
    const author = (tr.match(/hidden-sm text-center">([^<]+)</) || [])[1] || "";
    const campus = (tr.match(/<font[^>]*>\[([^\]]+)\]<\/font>/) || [])[1];
    if (!date || (Date.now() - new Date(date)) / 864e5 > MAX_AGE_DAYS) continue;
    const key = v[1], title = decode(v[2]).trim();
    const id = `lib-${key}`;
    const item = {
      id, source: "official", board: "lib", host: LIB.host, title, posted: date,
      campus, pinned: false, link: { url: LIB.view + encodeURIComponent(key), method: "GET" },
    };
    const prev = known.get(id);
    if (prev && prev.text !== undefined) Object.assign(item, { text: prev.text, ...extract(title, prev.text, date) });
    else if (detailCount < MAX_DETAIL_PER_BOARD) {
      detailCount++;
      await sleep(DELAY_MS);
      try {
        const page = await http(item.link.url);
        const body = (page.match(/<div[^>]*class="[^"]*(?:view_content|board_view_content|sc_content|scContents)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) || [])[1]
          || (page.match(/<td[^>]*class="[^"]*(?:content|cont)[^"]*"[^>]*>([\s\S]*?)<\/td>/i) || [])[1] || "";
        const text = htmlToText(body).split(/\n(?:이전글|다음글)\s*:/)[0].replace(/\n리스트$/, "");
        Object.assign(item, { text: text.slice(0, 1500), ...extract(title, text, date) });
      } catch (e) {
        log(`   ! 본문 실패 ${id}: ${e.message}`);
      }
    }
    item.sub = classify(title, item.text || "");
    out.push(item);
  }
  return out;
}


/* ───────── main ───────── */
async function loadPrevious() {
  try {
    const src = await readFile(OUT, "utf8");
    const json = src.slice(src.indexOf("["), src.lastIndexOf("]") + 1);
    return JSON.parse(json);
  } catch { return []; }
}

const prev = await loadPrevious();
const known = new Map(prev.map(p => [p.id, p]));
const all = [];
const status = {};

for (const b of CMS_BOARDS) {
  log(`· ${b.host}`);
  try {
    const items = await crawlCms(b, known);
    all.push(...items); status[b.key] = { ok: true, count: items.length };
    log(`  ${items.length}개`);
  } catch (e) {
    // 실패하면 이전 데이터를 유지한다
    const kept = prev.filter(p => p.board === b.key);
    all.push(...kept); status[b.key] = { ok: false, error: e.message, count: kept.length };
    log(`  실패: ${e.message} (이전 ${kept.length}개 유지)`);
  }
  await sleep(DELAY_MS);
}

log(`· ${LIB.host}`);
try {
  const items = await crawlLib(known);
  all.push(...items); status.lib = { ok: true, count: items.length };
  log(`  ${items.length}개`);
} catch (e) {
  const kept = prev.filter(p => p.board === "lib");
  all.push(...kept); status.lib = { ok: false, error: e.message, count: kept.length };
  log(`  실패: ${e.message} (이전 ${kept.length}개 유지)`);
}

// 여러 게시판에 같은 글이 올라오는 경우(예: 진로취창업센터 글을 혁신사업단이 며칠 뒤 재게시)를 하나로 합친다.
// 제목이 같고 게시일 차이가 14일 이내면 같은 글로 보고, 먼저 올라온 원본만 남긴다.
const norm = s => s.replace(/\s+/g, "").replace(/^\[[^\]]*\]/, "");
const keptByTitle = new Map(); // 제목 → 남긴 글들의 게시일
const unique = [...all].sort((a, b) => a.posted.localeCompare(b.posted)).filter(n => {
  const k = norm(n.title), t = new Date(n.posted);
  const dup = (keptByTitle.get(k) || []).some(d => Math.abs(t - d) / 864e5 <= 14);
  if (dup) return false;
  keptByTitle.set(k, [...(keptByTitle.get(k) || []), t]);
  return true;
});
all.length = 0; all.push(...unique);

all.sort((a, b) => b.posted.localeCompare(a.posted));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT,
  `// 자동 생성 파일 — node crawler/crawl.mjs 로 갱신해요. 직접 고치지 마세요.\n` +
  `window.CRAWLED_AT = ${JSON.stringify(new Date().toISOString())};\n` +
  `window.CRAWL_STATUS = ${JSON.stringify(status)};\n` +
  `window.CRAWLED = ${JSON.stringify(all, null, 1)};\n`, "utf8");
log(`\n완료: ${all.length}개 → ${OUT}`);
