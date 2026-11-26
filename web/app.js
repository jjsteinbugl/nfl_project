"use strict";

// ---------- constants ----------
const FIELD_LEN = 120;
const FIELD_WID = 160 / 3;
const PAD = 3;                 // yards of out-of-bounds shown around the field
const FPS = 10;                // tracking data rate
const MAX_LIST = 400;          // play-list rows rendered at once
const MPS_TO_MPH = 2.04545;    // yards/second -> miles/hour
const SIDE_COLORS = { off: ["#2f80ed", "#ffffff"], def: ["#eb5757", "#ffffff"] };
const PASS_RESULTS = { C: "Complete", I: "Incomplete", S: "Sack", IN: "Interception", R: "Scramble" };

// ---------- state ----------
const S = {
  index: [],
  filtered: [],
  meta: null,      // index entry of the current play
  play: null,      // loaded play data
  t: 0,            // current (fractional) frame
  playing: false,
  speed: 1,
  lastTs: null,
  mouse: null,     // {x, y} in CSS px over the canvas
  highlight: null, // entity index
  loadToken: 0,
  fieldCache: null,
};

const $ = (id) => document.getElementById(id);
const canvas = $("field");
const ctx = canvas.getContext("2d");

// ---------- data loading ----------
async function loadGz(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) { // still gzipped (server didn't decode it)
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function init() {
  try {
    const idx = await loadGz("data/index.json.gz");
    S.index = Array.isArray(idx) ? idx : idx.plays;
    if (idx.source) $("subtitle").textContent = idx.source;
  } catch (err) {
    const fileUrl = location.protocol === "file:";
    $("count").textContent = fileUrl
      ? "Open this page through `python serve.py`, not as a file."
      : "No play data found. Run `python build_web_data.py`, then reload.";
    $("overlay").textContent = $("count").textContent;
    console.error(err);
    return;
  }
  buildFilterOptions();
  applyFilters();
  // Deep link: #play=<gameId>-<playId>[&f=<frame>] (frame link opens paused there)
  const m = location.hash.match(/play=(\d+)-(\d+)(?:&f=(\d+))?/);
  if (m) {
    const e = S.index.find((p) => p.g === +m[1] && p.p === +m[2]);
    if (e) await selectPlay(e, m[3] != null ? +m[3] : null);
  }
}

// ---------- filters & play list ----------
function gameLabel(e) {
  const date = e.date ? ` · ${e.date.slice(0, 5)}` : "";
  return `W${e.w} · ${e.away ?? "?"} @ ${e.home ?? "?"}${date}`;
}

function buildFilterOptions() {
  const weeks = [...new Set(S.index.map((e) => e.w))].sort((a, b) => a - b);
  $("f-week").append(...weeks.map((w) => new Option(`Week ${w}`, w)));
  const teams = [...new Set(S.index.flatMap((e) => [e.home, e.away]).filter(Boolean))].sort();
  $("f-team").append(...teams.map((t) => new Option(t, t)));
  refreshGameOptions();
}

function refreshGameOptions() {
  const week = $("f-week").value, team = $("f-team").value, sel = $("f-game");
  const prev = sel.value;
  const games = new Map();
  for (const e of S.index) {
    if (week && e.w !== +week) continue;
    if (team && e.home !== team && e.away !== team) continue;
    if (!games.has(e.g)) games.set(e.g, gameLabel(e));
  }
  sel.length = 1;
  sel.append(...[...games].map(([g, label]) => new Option(label, g)));
  sel.value = games.has(+prev) ? prev : "";
}

function applyFilters() {
  const q = $("f-search").value.trim().toLowerCase();
  const week = $("f-week").value, team = $("f-team").value, game = $("f-game").value;
  const quarter = $("f-quarter").value, down = $("f-down").value, type = $("f-type").value;
  const terms = q.split(/\s+/).filter(Boolean);
  S.filtered = S.index.filter((e) =>
    (!week || e.w === +week) &&
    (!team || e.home === team || e.away === team) &&
    (!game || e.g === +game) &&
    (!quarter || e.q === +quarter) &&
    (!down || e.dn === +down) &&
    (!type || e.type === type) &&
    (!terms.length || terms.every((t) => (e.desc || "").toLowerCase().includes(t))));
  renderList();
}

function downText(dn, ytg) {
  if (!dn) return "";
  return `${["", "1st", "2nd", "3rd", "4th"][dn] ?? dn + "th"} & ${ytg ?? "?"}`;
}

function renderList() {
  const list = $("play-list");
  const n = S.filtered.length;
  $("count").textContent = n === S.index.length
    ? `${n.toLocaleString()} plays`
    : `${n.toLocaleString()} of ${S.index.length.toLocaleString()} plays`;
  const frag = document.createDocumentFragment();
  for (const e of S.filtered.slice(0, MAX_LIST)) {
    const li = document.createElement("li");
    li.dataset.key = `${e.g}-${e.p}`;
    if (S.meta && S.meta === e) li.classList.add("active");
    const q = e.q ? (e.q > 4 ? "OT" : `Q${e.q}`) : "";
    li.innerHTML = `<div class="meta"><span><b>${esc(e.off ?? "")}</b> ${esc(downText(e.dn, e.ytg))}</span>` +
      `<span>${esc(gameLabel(e))} · ${q} ${esc(e.clk ?? "")}</span></div>` +
      `<div class="d">${esc(e.desc ?? `Play ${e.p}`)}</div>`;
    li.addEventListener("click", () => selectPlay(e));
    frag.append(li);
  }
  if (n > MAX_LIST) {
    const li = document.createElement("li");
    li.className = "more";
    li.textContent = `Showing the first ${MAX_LIST}. Narrow the filters to see the rest.`;
    frag.append(li);
  }
  list.replaceChildren(frag);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- play selection ----------
async function selectPlay(e, startFrame = null) {
  const token = ++S.loadToken;
  S.meta = e;
  S.playing = false;
  history.replaceState(null, "", `#play=${e.g}-${e.p}`);
  for (const li of $("play-list").children) li.classList.toggle("active", li.dataset.key === `${e.g}-${e.p}`);
  renderInfo(e);
  $("overlay").hidden = false;
  $("overlay").textContent = "Loading play…";
  let play;
  try {
    play = await loadGz(`data/plays/${e.g}/${e.p}.json.gz`);
  } catch (err) {
    if (token !== S.loadToken) return;
    $("overlay").textContent = "Couldn't load this play's tracking data.";
    console.error(err);
    return;
  }
  if (token !== S.loadToken) return;
  S.play = play;
  S.highlight = null;
  S.t = 0;
  S.fieldCache = null;
  $("overlay").hidden = true;
  for (const id of ["btn-play", "btn-back", "btn-fwd", "btn-snap", "scrubber"]) $(id).disabled = false;
  $("scrubber").max = play.nFrames - 1;
  S.anchor = play.anchor ?? (play.snap != null ? { f: play.snap, label: "snap" } : null);
  $("btn-snap").textContent = `Jump to ${S.anchor?.label ?? "snap"}`;
  $("btn-snap").disabled = !S.anchor;
  const estimated = play.players.some((p) => p.estimated);
  $("data-note").hidden = !estimated;
  $("data-note").textContent = estimated
    ? "This dataset has no ball tracking: the ball is shown with the passer, then on a straight line to its " +
      "recorded landing spot (✕). Faded players weren't tracked after the throw and are shown where they were last seen."
    : "";
  renderTicks();
  if (startFrame != null) { setFrame(startFrame); setPlaying(false); }
  else setPlaying(true);
}

function renderInfo(e) {
  const score = (e.hs != null && e.vs != null) ? [` ${e.vs}`, ` ${e.hs}`] : ["", ""];
  $("matchup").textContent = `${e.away ?? "?"}${score[0]} @ ${e.home ?? "?"}${score[1]}  ·  Week ${e.w}`;
  const parts = [];
  if (e.q) parts.push(e.q > 4 ? "OT" : `Q${e.q}`);
  if (e.clk) parts.push(e.clk);
  if (e.dn) parts.push(`${downText(e.dn, e.ytg)}${e.yls ? ` at ${e.yls} ${e.yln}` : ""}`);
  if (e.off) parts.push(`${e.off} ball`);
  $("situation").textContent = parts.join("  ·  ");
  $("desc").textContent = e.desc ?? "";
  const tags = [];
  const tag = (k, v) => v != null && v !== "" && tags.push(`<span class="tag">${k} <b>${esc(v)}</b></span>`);
  tag("Type", e.type);
  tag("Formation", e.form);
  tag("Coverage", e.cov);
  tag("Man/Zone", e.mz);
  tag("Result", PASS_RESULTS[e.res] ?? e.res);
  tag("Yards", e.yds);
  tag("EPA", e.epa != null ? e.epa.toFixed(2) : null);
  $("tags").innerHTML = tags.join("");
}

function renderTicks() {
  const play = S.play, { events, nFrames, snap } = play;
  const ticks = $("ticks");
  ticks.replaceChildren();
  const denom = Math.max(1, nFrames - 1);
  // Account for the range thumb (~16px) so ticks line up with the thumb center.
  for (const ev of events) {
    const span = document.createElement("span");
    span.style.left = `calc(8px + (100% - 16px) * ${ev.f / denom})`;
    span.title = prettyEvent(ev.e);
    if (ev.f === (play.anchor?.f ?? snap)) span.className = "snap";
    ticks.append(span);
  }
}

function prettyEvent(e) {
  const s = e.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- coordinates ----------
function flipped() {
  return $("opt-flip").checked && S.play && S.play.direction === "left";
}
function effDirection() {
  if (!S.play) return "right";
  return flipped() ? "right" : S.play.direction;
}

let K = 1; // CSS pixels per yard
function toPx(x, y) {
  return [(x + PAD) * K, (FIELD_WID + PAD - y) * K];
}

// Value of grid[ent] at fractional frame t, with interpolation; null if missing.
function sample(grid, ent, t, scale) {
  const row = grid[ent];
  const i0 = Math.floor(t), i1 = Math.min(i0 + 1, row.length - 1), a = t - i0;
  const v0 = row[i0], v1 = row[i1];
  if (v0 == null && v1 == null) return null;
  if (v0 == null) return v1 / scale;
  if (v1 == null) return v0 / scale;
  return (v0 + (v1 - v0) * a) / scale;
}

function sampleAngle(ent, t) {
  const row = S.play.o[ent];
  const i0 = Math.floor(t), i1 = Math.min(i0 + 1, row.length - 1), a = t - i0;
  const v0 = row[i0] ?? row[i1], v1 = row[i1] ?? row[i0];
  if (v0 == null) return null;
  let d = ((v1 - v0 + 540) % 360) - 180; // shortest way round
  return v0 + d * a;
}

function position(ent, t) {
  let x = sample(S.play.x, ent, t, 100), y = sample(S.play.y, ent, t, 100);
  if (x == null || y == null) return null;
  if (flipped()) { x = FIELD_LEN - x; y = FIELD_WID - y; }
  return [x, y];
}

// Last tracked position at or before frame t (for players whose tracking stops at the throw).
function lastSeen(ent, t) {
  for (let f = Math.min(Math.floor(t), S.play.nFrames - 1); f >= 0; f--) {
    if (S.play.x[ent][f] != null) return position(ent, f);
  }
  return null;
}

function ballEnt() {
  return S.play.players.findIndex((p) => p.club === "football");
}

// ---------- colors ----------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function colorDist(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// Returns {club: {fill, stroke, text}} for the current play.
function teamStyles() {
  const clubs = [...new Set(S.play.players.map((p) => p.club).filter((c) => c && c !== "football"))];
  const off = S.meta?.off;
  const styles = {};
  if ($("opt-sides").checked) {
    for (const c of clubs) {
      const [fill, stroke] = c === off || (!off && c === clubs[0]) ? SIDE_COLORS.off : SIDE_COLORS.def;
      styles[c] = { fill, stroke, text: "#fff" };
    }
    return styles;
  }
  const home = S.meta?.home;
  clubs.sort((a, b) => (a === home ? -1 : b === home ? 1 : 0)); // home team keeps its colors
  clubs.forEach((c, i) => {
    const [p, s] = TEAM_COLORS[c] ?? (i === 0 ? ["#2f80ed", "#fff"] : ["#eb5757", "#fff"]);
    let style = { fill: p, stroke: s, text: luminance(p) > 0.55 ? "#111" : "#fff" };
    if (i > 0 && colorDist(p, styles[clubs[0]].fill) < 140) {
      style = { fill: "#ffffff", stroke: p, text: p }; // too similar: wear white
    }
    styles[c] = style;
  });
  return styles;
}

// ---------- drawing ----------
function resize() {
  const w = canvas.parentElement.clientWidth;
  K = w / (FIELD_LEN + 2 * PAD);
  const h = (FIELD_WID + 2 * PAD) * K;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  S.fieldCache = null;
}

function drawFieldTo(c) {
  const [x0, yTop] = toPx(0, FIELD_WID);
  const [x1, yBot] = toPx(FIELD_LEN, 0);
  c.fillStyle = "#2c5e2e";
  c.fillRect(0, 0, canvas.width, canvas.height);
  // Mowing stripes every 5 yards
  for (let x = 10; x < 110; x += 5) {
    c.fillStyle = ((x - 10) / 5) % 2 ? "#3a7a3c" : "#367238";
    const [a] = toPx(x, 0), [b] = toPx(x + 5, 0);
    c.fillRect(a, yTop, b - a, yBot - yTop);
  }
  // End zones, colored for the team defending each one
  const dir = effDirection();
  const off = S.meta?.off, def = S.meta?.deff;
  const leftTeam = dir === "right" ? off : def, rightTeam = dir === "right" ? def : off;
  [[0, leftTeam], [110, rightTeam]].forEach(([ex, team]) => {
    const [a] = toPx(ex, 0), [b] = toPx(ex + 10, 0);
    c.fillStyle = TEAM_COLORS[team]?.[0] ?? "#25502a";
    c.fillRect(a, yTop, b - a, yBot - yTop);
    if (team) {
      c.save();
      c.translate((a + b) / 2, (yTop + yBot) / 2);
      c.rotate(ex === 0 ? -Math.PI / 2 : Math.PI / 2);
      c.fillStyle = "rgba(255,255,255,.85)";
      c.font = `700 ${4.5 * K}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(team, 0, 0);
      c.restore();
    }
  });
  // Lines
  c.strokeStyle = "rgba(255,255,255,.9)";
  c.lineWidth = Math.max(1, 0.15 * K);
  c.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
  c.lineWidth = Math.max(1, 0.12 * K);
  for (let x = 10; x <= 110; x += 5) {
    const [px] = toPx(x, 0);
    c.beginPath(); c.moveTo(px, yTop); c.lineTo(px, yBot); c.stroke();
  }
  // Hash marks every yard
  c.lineWidth = Math.max(1, 0.1 * K);
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue;
    for (const hy of [0.4, 23.58, 29.75, FIELD_WID - 0.4]) {
      const [px, py] = toPx(x, hy);
      c.beginPath(); c.moveTo(px, py - 0.35 * K); c.lineTo(px, py + 0.35 * K); c.stroke();
    }
  }
  // Yard numbers
  c.fillStyle = "rgba(255,255,255,.85)";
  c.font = `600 ${2 * K}px system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (let x = 20; x <= 100; x += 10) {
    const yl = x - 10, num = String(yl <= 50 ? yl : 100 - yl);
    const [px, pyB] = toPx(x, 12);
    c.fillText(num, px, pyB);
    const [, pyT] = toPx(x, FIELD_WID - 12);
    c.save(); c.translate(px, pyT); c.rotate(Math.PI); c.fillText(num, 0, 0); c.restore();
  }
}

function drawScrimmage(c) {
  let los;
  if (S.play.los != null) {
    los = flipped() ? FIELD_LEN - S.play.los : S.play.los;
  } else {
    const b = ballEnt();
    const pos = b >= 0 ? position(b, S.play.snap ?? 0) : null;
    if (!pos) return;
    los = pos[0];
  }
  const [, yTop] = toPx(0, FIELD_WID), [, yBot] = toPx(0, 0);
  const line = (x, color) => {
    const [px] = toPx(x, 0);
    c.strokeStyle = color;
    c.lineWidth = Math.max(2, 0.25 * K);
    c.beginPath(); c.moveTo(px, yTop); c.lineTo(px, yBot); c.stroke();
  };
  line(los, "rgba(80,150,255,.9)");
  const ytg = S.meta?.ytg;
  if (ytg) {
    const first = los + (effDirection() === "right" ? ytg : -ytg);
    if (first > 10 && first < 110) line(first, "rgba(255,221,0,.9)");
  }
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  if (!S.fieldCache) {
    const off = document.createElement("canvas");
    off.width = canvas.width; off.height = canvas.height;
    const oc = off.getContext("2d");
    oc.scale(dpr, dpr);
    drawFieldTo(oc);
    if (S.play) drawScrimmage(oc);
    S.fieldCache = off;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(S.fieldCache, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!S.play) return;

  const play = S.play, t = S.t, styles = teamStyles();
  const nEnt = play.players.length, ball = ballEnt();
  const R = Math.max(6, 1.1 * K);

  // Trails
  if ($("opt-trails").checked) {
    const end = Math.floor(t);
    for (let i = 0; i < nEnt; i++) {
      const p = play.players[i];
      const dim = S.highlight != null && S.highlight !== i;
      ctx.strokeStyle = p.club === "football" ? "rgba(139,69,19,.8)" : styles[p.club]?.fill ?? "#fff";
      ctx.globalAlpha = dim ? 0.12 : (S.highlight === i ? 0.95 : 0.45);
      ctx.lineWidth = S.highlight === i ? 3 : 1.5;
      ctx.beginPath();
      let started = false;
      for (let f = 0; f <= end; f++) {
        const pos = position(i, f);
        if (!pos) continue;
        const [px, py] = toPx(pos[0], pos[1]);
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      }
      const cur = position(i, t);
      if (cur && started) { const [px, py] = toPx(cur[0], cur[1]); ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Ball landing spot (2026 data)
  if (play.ballLand) {
    let [lx, ly] = play.ballLand;
    if (flipped()) { lx = FIELD_LEN - lx; ly = FIELD_WID - ly; }
    const [px, py] = toPx(lx, ly), d = R * 0.6;
    ctx.strokeStyle = "#ffdd00";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px - d, py - d); ctx.lineTo(px + d, py + d);
    ctx.moveTo(px + d, py - d); ctx.lineTo(px - d, py + d);
    ctx.stroke();
  }

  // Players
  const facing = $("opt-facing").checked;
  S.drawn = [];
  for (let i = 0; i < nEnt; i++) {
    if (i === ball) continue;
    const p = play.players[i];
    let pos = position(i, t), ghost = false;
    if (!pos) { pos = lastSeen(i, t); ghost = true; } // no longer tracked: hold at last spot
    if (!pos) continue;
    const [px, py] = toPx(pos[0], pos[1]);
    const st = styles[p.club] ?? { fill: "#999", stroke: "#fff", text: "#000" };
    S.drawn.push({ i, px, py, ghost });
    ctx.globalAlpha = ghost ? 0.3 : S.highlight != null && S.highlight !== i ? 0.55 : 1;
    if (facing && !ghost) {
      let o = sampleAngle(i, t);
      if (o != null) {
        if (flipped()) o += 180;
        const rad = (o * Math.PI) / 180;
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.sin(rad) * R * 1.7, py - Math.cos(rad) * R * 1.7);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(px, py, R, 0, Math.PI * 2);
    ctx.fillStyle = st.fill;
    ctx.fill();
    ctx.lineWidth = S.highlight === i ? 3 : 1.5;
    ctx.strokeStyle = S.highlight === i ? "#ffdd00" : st.stroke;
    ctx.stroke();
    const label = p.jersey ?? p.pos; // 2026 data has no jersey numbers: show position
    if (label != null) {
      ctx.fillStyle = st.text;
      ctx.font = `700 ${String(label).length > 2 ? R * 0.75 : R * 1.0}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, px, py + R * 0.06);
    }
  }
  ctx.globalAlpha = 1;

  // Ball on top
  if (ball >= 0) {
    const pos = position(ball, t);
    if (pos) {
      const [px, py] = toPx(pos[0], pos[1]);
      S.drawn.push({ i: ball, px, py });
      ctx.beginPath();
      ctx.ellipse(px, py, R * 0.7, R * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#8b4513";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  }
  updateTooltip();
}

// ---------- tooltip & picking ----------
function pick() {
  if (!S.mouse || !S.drawn) return null;
  const R = Math.max(6, 1.1 * K) * 1.3;
  let best = null, bestD = R;
  for (const d of S.drawn) {
    const dist = Math.hypot(d.px - S.mouse.x, d.py - S.mouse.y);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

function updateTooltip() {
  const tip = $("tooltip");
  const hit = pick();
  if (!hit) { tip.hidden = true; canvas.style.cursor = "default"; return; }
  canvas.style.cursor = "pointer";
  const p = S.play.players[hit.i];
  const s = hit.ghost ? null : sample(S.play.s, hit.i, S.t, 100);
  const speed = s != null ? `${s.toFixed(1)} yd/s · ${(s * MPS_TO_MPH).toFixed(1)} mph` : "";
  const detail = [p.jersey != null ? `#${p.jersey}` : null, p.pos, p.club, p.role].filter(Boolean).map(esc).join(" · ");
  tip.innerHTML = p.club === "football"
    ? `<div class="n">${esc(p.name ?? "Football")}</div>${speed}`
    : `<div class="n">${esc(p.name ?? "Unknown")}</div>${detail}<br>` +
      (hit.ghost ? "Not tracked after the throw (last seen here)" : speed);
  tip.style.left = `${hit.px}px`;
  tip.style.top = `${hit.py}px`;
  tip.hidden = false;
}

// ---------- playback ----------
function setPlaying(on) {
  if (!S.play) return;
  if (on && S.t >= S.play.nFrames - 1) S.t = 0;
  S.playing = on;
  S.lastTs = null;
  $("btn-play").textContent = on ? "⏸" : "▶";
}

function setFrame(t) {
  S.t = Math.max(0, Math.min(t, S.play.nFrames - 1));
}

function updateHud() {
  if (!S.play) { $("clock").textContent = "–"; return; }
  $("scrubber").value = S.t;
  const f = Math.floor(S.t);
  if (S.anchor) {
    const dt = (S.t - S.anchor.f) / FPS, label = S.anchor.label;
    $("clock").textContent = dt < 0 ? `${label} −${(-dt).toFixed(1)}s` : `${label} +${dt.toFixed(1)}s`;
  } else {
    $("clock").textContent = `${(S.t / FPS).toFixed(1)}s`;
  }
  // Show the most recent event for 1.5 seconds
  let label = "";
  for (const ev of S.play.events) {
    if (ev.f <= f && f - ev.f <= 15) label = prettyEvent(ev.e);
  }
  $("event-label").textContent = label;
}

function frame(ts) {
  if (S.playing && S.play) {
    if (S.lastTs != null) {
      S.t += ((ts - S.lastTs) / 1000) * FPS * S.speed;
      if (S.t >= S.play.nFrames - 1) { S.t = S.play.nFrames - 1; setPlaying(false); }
    }
    S.lastTs = ts;
  }
  draw();
  updateHud();
  requestAnimationFrame(frame);
}

// ---------- events ----------
for (const id of ["f-search", "f-quarter", "f-down", "f-type", "f-game"]) {
  $(id).addEventListener("input", applyFilters);
}
for (const id of ["f-week", "f-team"]) {
  $(id).addEventListener("input", () => { refreshGameOptions(); applyFilters(); });
}
$("btn-play").addEventListener("click", () => setPlaying(!S.playing));
$("btn-back").addEventListener("click", () => { setPlaying(false); setFrame(Math.ceil(S.t) - 1); });
$("btn-fwd").addEventListener("click", () => { setPlaying(false); setFrame(Math.floor(S.t) + 1); });
$("btn-snap").addEventListener("click", () => { if (S.anchor) setFrame(S.anchor.f); });
$("scrubber").addEventListener("input", (e) => { setPlaying(false); setFrame(+e.target.value); });
$("speed").addEventListener("input", (e) => { S.speed = +e.target.value; });
for (const id of ["opt-flip"]) $(id).addEventListener("input", () => { S.fieldCache = null; });

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  S.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
});
canvas.addEventListener("mouseleave", () => { S.mouse = null; });
canvas.addEventListener("click", () => {
  const hit = pick();
  S.highlight = hit && hit.i !== S.highlight ? hit.i : null;
});

document.addEventListener("keydown", (e) => {
  if (!S.play || e.target.matches("input[type=search], select")) return;
  if (e.code === "Space") { e.preventDefault(); setPlaying(!S.playing); }
  else if (e.code === "ArrowRight") { e.preventDefault(); setPlaying(false); setFrame(Math.floor(S.t) + 1); }
  else if (e.code === "ArrowLeft") { e.preventDefault(); setPlaying(false); setFrame(Math.ceil(S.t) - 1); }
});

// Don't leave buttons focused, so Space always means play/pause (not "click again").
for (const b of document.querySelectorAll("button")) b.addEventListener("mouseup", () => b.blur());

new ResizeObserver(resize).observe(canvas.parentElement);
resize();
requestAnimationFrame(frame);
init();
