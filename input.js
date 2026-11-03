/* ───────── 소식 직접 입력 + GitHub 동기화 ─────────
   에타·단톡 글을 붙여넣으면 제목·마감일·장소·마일리지를 뽑아 채우고,
   저장하면 data/manual.js 를 GitHub 저장소에 기록해서 폰·PC가 같이 본다.
   app.js 다음에 불러온다 (state, NEWS, render, TODAY 등을 쓴다). */
(() => {
  const GH_KEY = "eulji-gh", SRC_KEY = "eulji-last-src";
  const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch (e) { return d; } };
  const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  /* ───────── 붙여넣은 글에서 정보 뽑기 (crawler/crawl.mjs 와 같은 규칙) ───────── */
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const DATE_RE = /(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*(?:[./]|월)\s*(\d{1,2})\s*일?\.?/g;

  function mkDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let dt = new Date(y || TODAY.getFullYear(), m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    if (!y && (TODAY - dt) / DAY > 180) dt = new Date(dt.getFullYear() + 1, m - 1, d); // 연도 없는 날짜가 한참 과거면 내년
    return ymd(dt);
  }
  const datesIn = s => [...s.matchAll(DATE_RE)].map(m => mkDate(m[1] && +m[1], +m[2], +m[3])).filter(Boolean);
  const bare = l => l.replace(/^[^\w가-힣]+/, "");

  function extract(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const out = { title: (lines.find(l => bare(l).length >= 4) || lines[0] || "").replace(/\s+/g, " ").slice(0, 80) };

    const dl = lines.find(l => /(신청|접수|모집|마감|제출)\s*(기간|기한|일정|마감)?\s*[:：~]?/.test(l) && datesIn(l).length);
    if (dl) out.deadline = datesIn(dl).pop();
    else { const t = text.match(/~\s*(\d{1,2})\s*[./월]\s*(\d{1,2})/); if (t) out.deadline = mkDate(null, +t[1], +t[2]); }

    const when = lines.find(l => /^(일\s*시|행사\s*일시|교육\s*일시|일\s*정|날\s*짜|기\s*간)\s*[:：]/.test(bare(l)));
    if (when && datesIn(when).length) out.date = datesIn(when)[0];

    const place = lines.map(bare).find(l => /^(장\s*소|위\s*치)\s*[:：]/.test(l));
    if (place) out.place = place.replace(/^(장\s*소|위\s*치)\s*[:：]\s*/, "").slice(0, 60);

    const mi = text.match(/(마일리지|비교과\s*포인트|EU\s*포인트|포인트)[^\d\n]{0,12}(\d{1,3})\s*(점|포인트|P|p)/);
    if (mi) out.mileage = +mi[2];

    out.desc = lines.slice(1).join("\n").slice(0, 300);
    return out;
  }

  const STUDENT_RE = /동아리|학생회|총학|부원|새내기|MT|OT|과\s*행사|학회|소모임/;
  function guessCat(text) { return STUDENT_RE.test(text.slice(0, 200)) ? "student" : "school"; }
  function guessSub(cat, text) {
    const s = text.slice(0, 300);
    if (cat === "student") return /총학|학생회/.test(s) ? "학생회" : /모집|지원|부원|신입/.test(s) ? "동아리 모집" : "동아리 행사";
    if (/공모전|경진대회|대회|챌린지|콘테스트/.test(s)) return "공모전";
    if (/장학|지원금|교환학생|연수|파견/.test(s)) return "장학·지원";
    if (/비교과|마일리지|특강|캠프|프로그램|워크숍|세미나|교육|멘토링|박람회/.test(s)) return "비교과·프로그램";
    return "일반 공지";
  }

  /* ───────── GitHub API (data/manual.js 읽고 쓰기) ───────── */
  const getGh = () => readJson(GH_KEY, null);
  const hdr = gh => ({ Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json" });
  const b64enc = s => { let bin = ""; new TextEncoder().encode(s).forEach(c => (bin += String.fromCharCode(c))); return btoa(bin); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const api = (gh, path) => `https://api.github.com/repos/${gh.repo}/${path}`;

  async function fail(r) {
    if (r.status === 401) return new Error("토큰이 올바르지 않아요");
    if (r.status === 403 || r.status === 404) return new Error("저장소를 찾지 못했거나 토큰 권한이 부족해요");
    if (r.status === 409 || r.status === 422) return new Error("저장소가 그 사이에 바뀌었어요");
    return new Error(`GitHub 오류 (${r.status})`);
  }
  async function readRemote(gh) {
    const r = await fetch(api(gh, `contents/data/manual.js?ref=${encodeURIComponent(gh.branch)}`), { headers: hdr(gh), cache: "no-store" });
    if (r.status === 404) return { list: [], sha: undefined };
    if (!r.ok) throw await fail(r);
    const j = await r.json(), src = b64dec(j.content);
    const a = src.indexOf("["), z = src.lastIndexOf("]");
    return { list: a >= 0 && z > a ? JSON.parse(src.slice(a, z + 1)) : [], sha: j.sha };
  }
  async function writeRemote(gh, list, sha, message) {
    const body = {
      message, branch: gh.branch,
      content: b64enc(`// 직접 입력한 소식. 페이지의 "소식 추가"가 갱신해요.\nwindow.MANUAL = ${JSON.stringify(list, null, 1)};\n`),
    };
    if (sha) body.sha = sha;
    const r = await fetch(api(gh, "contents/data/manual.js"), { method: "PUT", headers: { ...hdr(gh), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw await fail(r);
  }
  // 목록을 읽어 고친 뒤 다시 쓴다. 그 사이 바뀌었으면 한 번 더 시도한다
  async function mutateRemote(gh, edit, message) {
    for (let attempt = 0; ; attempt++) {
      const { list, sha } = await readRemote(gh);
      try { return await writeRemote(gh, edit(list), sha, message); }
      catch (e) { if (attempt >= 1 || !/바뀌었어요/.test(e.message)) throw e; }
    }
  }

  /* ───────── 시트 ───────── */
  const showSheet = (html, actions) => {
    $("#sheetContent").innerHTML = html;
    $("#sheetActions").innerHTML = actions;
    $("#scrim").classList.add("on"); $("#sheet").classList.add("on");
    document.body.style.overflow = "hidden";
  };
  const val = id => ($("#" + id).value || "").trim();
  const sourceOptions = sel => Object.entries(SOURCES).filter(([k]) => k !== "official")
    .map(([k, s]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${s.name}</option>`).join("");
  const subOptions = (cat, sel) => (cat === "school" ? SCHOOL_SUBS : STUDENT_SUBS)
    .map(s => `<option ${s === sel ? "selected" : ""}>${s}</option>`).join("");

  let cat = "school";
  const dirty = new Set();

  function openAdd() {
    cat = "school"; dirty.clear();
    const lastSrc = readJson(SRC_KEY, "everytime");
    showSheet(`
      <h3 id="sheetTitle">소식 추가</h3>
      <p class="desc" style="margin-top:8px">에브리타임이나 단톡 글을 붙여넣으면 알아서 채워 줘요.</p>
      <label class="lbl" for="mText">글 붙여넣기</label>
      <textarea id="mText" class="field area" rows="5" placeholder="여기에 붙여넣어요"></textarea>
      <div class="seg" id="mCat" style="margin:16px 0 0">
        <button type="button" data-mcat="school" aria-selected="true">학교 소식</button>
        <button type="button" data-mcat="student" aria-selected="false">학생 소식</button>
      </div>
      <label class="lbl" for="mSub">분류</label>
      <select id="mSub" class="field">${subOptions("school")}</select>
      <label class="lbl" for="mTitle">제목</label>
      <input id="mTitle" class="field" autocomplete="off">
      <div class="two">
        <div><label class="lbl" for="mDeadline">마감일</label><input id="mDeadline" type="date" class="field"></div>
        <div><label class="lbl" for="mDate">행사 일시</label><input id="mDate" type="date" class="field"></div>
      </div>
      <label class="lbl" for="mPlace">장소</label>
      <input id="mPlace" class="field" autocomplete="off">
      <div class="two">
        <div><label class="lbl" for="mMileage">마일리지(점)</label><input id="mMileage" type="number" inputmode="numeric" min="0" class="field"></div>
        <div><label class="lbl" for="mSource">출처</label><select id="mSource" class="field">${sourceOptions(lastSrc)}</select></div>
      </div>
      <label class="lbl" for="mHost">주최 <span class="opt">선택</span></label>
      <input id="mHost" class="field" placeholder="동아리, 학과 이름" autocomplete="off">
      <label class="lbl" for="mDesc">메모 <span class="opt">선택</span></label>
      <textarea id="mDesc" class="field area" rows="3"></textarea>
      <button type="button" class="text-btn" data-mact="settings" style="margin:16px 0 8px">${getGh() ? "동기화 설정 바꾸기" : "폰과 PC에서 같이 보려면 동기화 설정"}</button>`,
      `<button class="btn secondary" data-mact="close">취소</button><button class="btn primary" data-mact="save">저장</button>`);
  }

  function fillFrom(text) {
    const x = extract(text);
    if (!dirty.has("cat")) { cat = guessCat(text); setCat(cat); }
    if (!dirty.has("sub")) $("#mSub").value = guessSub(cat, text);
    const set = (id, v) => { if (!dirty.has(id)) $("#" + id).value = v ?? ""; };
    set("mTitle", x.title); set("mDeadline", x.deadline); set("mDate", x.date);
    set("mPlace", x.place); set("mMileage", x.mileage); set("mDesc", x.desc);
  }
  function setCat(c) {
    cat = c;
    document.querySelectorAll("#mCat button").forEach(b => b.setAttribute("aria-selected", b.dataset.mcat === c));
    const sel = $("#mSub"), keep = sel.value;
    const list = c === "school" ? SCHOOL_SUBS : STUDENT_SUBS;
    sel.innerHTML = subOptions(c, list.includes(keep) ? keep : list[0]);
  }

  async function save() {
    const title = val("mTitle");
    if (!title) { toast("제목을 입력해 주세요"); $("#mTitle").focus(); return; }
    const item = {
      id: "m-" + Date.now().toString(36), cat, sub: val("mSub"), title, source: val("mSource"),
      host: val("mHost"), deadline: val("mDeadline"), date: val("mDate"), place: val("mPlace"),
      mileage: val("mMileage") ? +val("mMileage") : undefined, desc: $("#mDesc").value.trim(), posted: ymd(TODAY),
    };
    for (const k of Object.keys(item)) if (item[k] === "" || item[k] === undefined) delete item[k];
    writeJson(SRC_KEY, item.source);

    writeList(LOCAL_KEY, [...readList(LOCAL_KEY), item]); // 먼저 이 기기에 보여 준다
    reloadManual(); state.tab = cat; state.chip = "전체"; render(); window.scrollTo({ top: 0 });
    closeSheet();

    const gh = getGh();
    if (!gh) { toast("이 기기에만 저장했어요"); return; }
    try {
      await mutateRemote(gh, list => (list.some(m => m.id === item.id) ? list : [...list, item]), `소식 추가: ${title.slice(0, 40)}`);
      toast("저장했어요");
    } catch (e) { toast(`이 기기에만 저장했어요. ${e.message}`); }
  }

  window.deleteManual = async id => {
    if (!confirm("이 소식을 지울까요?")) return;
    writeList(LOCAL_KEY, readList(LOCAL_KEY).filter(m => m.id !== id));
    writeList(DEL_KEY, [...new Set([...readList(DEL_KEY), id])]);
    reloadManual(); render(); closeSheet();
    const gh = getGh();
    if (!gh) { toast("이 기기에서만 지웠어요"); return; }
    try { await mutateRemote(gh, list => list.filter(m => m.id !== id), "소식 삭제"); toast("지웠어요"); }
    catch (e) { toast(`이 기기에서만 지웠어요. ${e.message}`); }
  };

  /* ───────── 동기화 설정 ───────── */
  function openSettings() {
    const gh = getGh() || { repo: "", token: "", branch: "main" };
    showSheet(`
      <h3 id="sheetTitle">동기화 설정</h3>
      <p class="desc" style="margin-top:8px">저장소에 기록해 두면 폰과 PC에서 같은 소식을 봐요. 이 기기에서 한 번만 하면 돼요.</p>
      <label class="lbl" for="gRepo">저장소</label>
      <input id="gRepo" class="field" placeholder="내계정/저장소이름" value="${esc(gh.repo)}" autocomplete="off" autocapitalize="off">
      <label class="lbl" for="gToken">토큰</label>
      <input id="gToken" class="field" type="password" placeholder="github_pat_..." value="${esc(gh.token)}" autocomplete="off">
      <label class="lbl" for="gBranch">브랜치</label>
      <input id="gBranch" class="field" value="${esc(gh.branch)}" autocapitalize="off">
      <div class="help">
        <b>토큰 만드는 법</b><br>
        GitHub &gt; Settings &gt; Developer settings &gt; Personal access tokens &gt; Fine-grained tokens<br>
        Repository access는 이 저장소만 고르고, Permissions &gt; Contents를 <b>Read and write</b>로 둬요.<br>
        토큰은 이 기기의 브라우저에만 저장돼요.
      </div>
      ${getGh() ? `<button type="button" class="text-btn" data-mact="unlink" style="margin:12px 0 8px">연결 끊기</button>` : ""}`,
      `<button class="btn secondary" data-mact="add">뒤로</button><button class="btn primary" data-mact="link">연결하고 확인</button>`);
  }
  async function link() {
    const gh = { repo: val("gRepo").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, ""), token: val("gToken"), branch: val("gBranch") || "main" };
    if (!/^[\w.-]+\/[\w.-]+$/.test(gh.repo)) { toast("저장소는 '계정/이름' 형태로 적어 주세요"); return; }
    if (!gh.token) { toast("토큰을 입력해 주세요"); return; }
    try {
      const r = await fetch(api(gh, ""), { headers: hdr(gh), cache: "no-store" });
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      if (j.permissions && j.permissions.push === false) throw new Error("쓰기 권한이 없는 토큰이에요");
      writeJson(GH_KEY, gh);
      toast("연결했어요"); openAdd();
    } catch (e) { toast(e.message); }
  }

  /* ───────── 이벤트 ───────── */
  $("#addBtn").addEventListener("click", openAdd);
  $("#sheet").addEventListener("click", e => {
    const c = e.target.closest("[data-mcat]");
    if (c) { dirty.add("cat"); dirty.delete("sub"); setCat(c.dataset.mcat); if (!dirty.has("sub")) $("#mSub").value = guessSub(cat, val("mText")); return; }
    const a = e.target.closest("[data-mact]");
    if (!a) return;
    ({ close: closeSheet, save, settings: openSettings, add: openAdd, link,
       unlink: () => { try { localStorage.removeItem(GH_KEY); } catch (er) {} toast("연결을 끊었어요"); openAdd(); } })[a.dataset.mact]();
  });
  $("#sheet").addEventListener("input", e => {
    const id = e.target.id;
    if (id === "mText") { fillFrom(e.target.value); return; }
    if (/^m(Title|Deadline|Date|Place|Mileage|Desc|Sub)$/.test(id)) dirty.add(id === "mSub" ? "sub" : id);
  });
  $("#sheet").addEventListener("change", e => { if (e.target.id === "mSub") dirty.add("sub"); });
})();
