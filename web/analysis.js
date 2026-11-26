"use strict";
// QB decision analysis: the per-play panel and the league-wide comparisons.
// Uses globals from app.js (S, $, esc, pretty, lastName, applyFilters).

const DEC_STYLE = {
  most_open:   { icon: "✓", tone: "good",    short: "Most open" },
  open_target: { icon: "✓", tone: "good",    short: "Open target" },
  all_covered: { icon: "–", tone: "neutral", short: "Nobody open" },
  chose_depth: { icon: "↗", tone: "neutral", short: "Chose depth" },
  missed:      { icon: "✗", tone: "bad",     short: "Missed open receiver" },
};
const DEC_ORDER = ["most_open", "open_target", "chose_depth", "all_covered", "missed"];
const LG = { tab: "qb", sort: { key: "good", dir: -1 } };

const pct = (x) => (x == null || isNaN(x) ? "–" : `${Math.round(x * 100)}%`);
const num = (x, d = 1) => (x == null || isNaN(x) ? "–" : x.toFixed(d));
const depthText = (d) => (d >= 0 ? `${num(d)} yd downfield` : `${num(-d)} yd behind the line`);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

function cfg() {
  return S.analysisCfg ?? { decisions: {}, open: 3, margin: 1, shallower: 2 };
}

// ---------- setup (called once the index has loaded) ----------
function initAnalysis() {
  const c = cfg();
  const hasAnalysis = S.index.some((e) => e.dec);
  $("league").hidden = !hasAnalysis;
  $("f-dec").hidden = !hasAnalysis;
  $("f-sort").querySelector("[value=lost]").hidden = !hasAnalysis;
  if (!hasAnalysis) return;
  for (const k of DEC_ORDER) {
    $("f-dec").append(new Option(`${DEC_STYLE[k].icon} ${c.decisions[k] ?? DEC_STYLE[k].short}`, k));
  }
  for (const el of document.querySelectorAll("[data-cfg]")) el.textContent = c[el.dataset.cfg];
  for (const b of document.querySelectorAll(".tabs button")) {
    b.addEventListener("click", () => {
      LG.tab = b.dataset.tab;
      LG.sort = { key: LG.tab === "qb" ? "good" : "", dir: -1 };
      for (const o of document.querySelectorAll(".tabs button")) o.classList.toggle("active", o === b);
      renderLeague();
    });
  }
}

// ---------- aggregate stats ----------
function agg(rows) {
  const r = rows.filter((e) => e.dec);
  const share = (pred) => (r.length ? r.filter(pred).length / r.length : NaN);
  return {
    n: r.length,
    most: share((e) => e.dec === "most_open"),
    good: share((e) => e.dec === "most_open" || e.dec === "open_target"),
    missed: share((e) => e.dec === "missed"),
    tsep: mean(r.map((e) => e.tsep)),
    msep: mean(r.map((e) => e.msep)),
    tdep: mean(r.map((e) => e.tdep)),
    comp: share((e) => e.res === "C"),
    epa: mean(r.filter((e) => e.epa != null).map((e) => e.epa)),
  };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const e of rows) {
    const k = keyFn(e);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return m;
}

// ---------- league section ----------
function renderLeague() {
  if ($("league").hidden) return;
  const rows = S.filtered.filter((e) => e.dec);
  const all = agg(rows);
  $("lg-scope").textContent = S.filtered.length === S.index.length
    ? `All ${rows.length.toLocaleString()} pass plays. Use the filters on the left to narrow this to a team, week, down, QB or coverage.`
    : `${rows.length.toLocaleString()} pass plays matching your filters.`;
  if (!rows.length) {
    for (const id of ["lg-tiles", "lg-findings", "lg-sepchart", "lg-decisions", "lg-table"]) $(id).replaceChildren();
    $("lg-table-note").textContent = "";
    return;
  }

  // Stat tiles
  const tile = (label, value, sub) =>
    `<div class="tile"><div class="tl">${label}</div><div class="tv">${value}</div><div class="ts">${sub}</div></div>`;
  $("lg-tiles").innerHTML =
    tile("Threw to the most open receiver", pct(all.most), `${pct(all.good)} to an open or most-open target`) +
    tile("Missed a more open receiver", pct(all.missed), "open option at similar or greater depth") +
    tile("Target's separation", `${num(all.tsep)} yd`, `vs ${num(all.msep)} yd for the most open option`) +
    tile("Completion rate", pct(all.comp), `${num(all.epa, 2)} EPA per pass`);

  renderFindings(rows);
  renderSepChart(rows);
  renderDecisionBars(rows);
  renderTable(rows);
}

function renderFindings(rows) {
  const out = [];
  const dec = groupBy(rows, (e) => e.dec);
  const most = agg(dec.get("most_open") ?? []), missed = agg(dec.get("missed") ?? []);
  if (most.n >= 20 && missed.n >= 20) {
    out.push(`Throws to the most open receiver were completed <b>${pct(most.comp)}</b> of the time ` +
      `(${num(most.epa, 2)} EPA), compared with <b>${pct(missed.comp)}</b> (${num(missed.epa, 2)} EPA) when a more open receiver was missed.`);
  }
  if (most.n >= 20) {
    const deeper = agg(rows.filter((e) => e.dec !== "most_open"));
    out.push(`The most open receiver is often a short option: when targeted, they averaged <b>${num(most.tdep)} yd</b> ` +
      `past the line at the throw, vs ${num(deeper.tdep)} yd for other targets. So "most open" isn't automatically "best".`);
  }
  const man = agg(rows.filter((e) => e.mz === "MAN_COVERAGE")), zone = agg(rows.filter((e) => e.mz === "ZONE_COVERAGE"));
  if (man.n >= 20 && zone.n >= 20) {
    out.push(`Against <b>man</b> coverage QBs found the most open receiver ${pct(man.most)} of the time vs ${pct(zone.most)} against <b>zone</b>, ` +
      `but zone left more room: the most open option averaged ${num(zone.msep)} yd vs ${num(man.msep)} yd against man.`);
  }
  const quick = agg(rows.filter((e) => e.ttt < 2.5)), slow = agg(rows.filter((e) => e.ttt >= 3.5));
  if (quick.n >= 20 && slow.n >= 20) {
    out.push(`Holding the ball: throws under 2.5 s went to the most open receiver ${pct(quick.most)} of the time; ` +
      `throws taking 3.5 s or longer ${pct(slow.most)}. Targets were ${num(quick.tsep)} vs ${num(slow.tsep)} yd open.`);
  }
  $("lg-findings").innerHTML = out.map((s) => `<li>${s}</li>`).join("");
}

function renderSepChart(rows) {
  const bins = [[0, 1, "0–1"], [1, 2, "1–2"], [2, 3, "2–3"], [3, 4, "3–4"], [4, 6, "4–6"], [6, Infinity, "6+"]];
  const html = bins.map(([lo, hi, label]) => {
    const r = agg(rows.filter((e) => e.tsep >= lo && e.tsep < hi));
    const h = r.n ? Math.max(2, r.comp * 100) : 0;
    const tip = `${label} yd open: ${pct(r.comp)} completed · ${r.n.toLocaleString()} passes · ${num(r.epa, 2)} EPA/pass`;
    return `<div class="vb" title="${tip}"><div class="vb-track"><div class="vb-val">${r.n ? pct(r.comp) : ""}</div>` +
      `<div class="vb-bar" style="height:${h}%"></div></div><div class="vb-lab">${label}</div></div>`;
  }).join("");
  $("lg-sepchart").innerHTML = html;
}

function renderDecisionBars(rows) {
  const c = cfg(), n = rows.length;
  const counts = groupBy(rows, (e) => e.dec);
  $("lg-decisions").innerHTML = DEC_ORDER.map((k) => {
    const r = agg(counts.get(k) ?? []), share = n ? r.n / n : 0, st = DEC_STYLE[k];
    const tip = `${r.n.toLocaleString()} passes · ${pct(r.comp)} completed · ${num(r.epa, 2)} EPA/pass`;
    return `<div class="hb" data-dec="${k}" title="${tip} (click to list these plays)">` +
      `<div class="hb-lab"><span class="badge ${st.tone}">${st.icon}</span> ${esc(c.decisions[k] ?? st.short)}</div>` +
      `<div class="hb-row"><div class="hb-track"><div class="hb-bar ${st.tone}" style="width:${share * 100}%"></div></div>` +
      `<div class="hb-val">${pct(share)}</div></div>` +
      `<div class="hb-sub">${pct(r.comp)} completed · ${num(r.epa, 2)} EPA</div></div>`;
  }).join("");
  for (const el of $("lg-decisions").querySelectorAll(".hb")) {
    el.addEventListener("click", () => { $("f-dec").value = el.dataset.dec; applyFilters(); });
  }
}

const TTT_BINS = [[0, 2, "Under 2.0 s"], [2, 2.5, "2.0–2.5 s"], [2.5, 3, "2.5–3.0 s"], [3, 3.5, "3.0–3.5 s"], [3.5, 4, "3.5–4.0 s"], [4, Infinity, "4.0 s +"]];

function renderTable(rows) {
  let groups, label, onPick, note = "", minN = 1;
  if (LG.tab === "qb") {
    minN = rows.length > 3000 ? 100 : rows.length > 500 ? 30 : 5;
    groups = groupBy(rows, (e) => e.qb);
    label = "Quarterback";
    onPick = (k) => { $("f-qb").value = k; applyFilters(); };
    note = `Quarterbacks with at least ${minN} passes. Click a column to sort, or a row to filter to that QB.`;
  } else if (LG.tab === "cov") {
    groups = groupBy(rows, (e) => e.cov);
    label = "Coverage";
    onPick = (k) => { $("f-cov").value = k; applyFilters(); };
    minN = 5;
    note = "Coverages with at least 5 passes. Click a row to filter to that coverage.";
  } else if (LG.tab === "down") {
    groups = groupBy(rows, (e) => e.dn);
    label = "Down";
    onPick = (k) => { $("f-down").value = k; applyFilters(); };
    minN = 5;
    note = "Click a row to filter to that down.";
  } else {
    groups = groupBy(rows, (e) => TTT_BINS.findIndex(([lo, hi]) => e.ttt >= lo && e.ttt < hi));
    label = "Time to throw";
    note = "Time from the first tracked frame (about the snap) to the throw.";
  }
  $("lg-table-note").textContent = note;

  let data = [...groups].map(([k, r]) => ({ key: k, ...agg(r) })).filter((d) => d.n >= minN);
  const name = (k) => LG.tab === "cov" ? pretty(k)
    : LG.tab === "down" ? ["", "1st", "2nd", "3rd", "4th"][k] ?? k
    : LG.tab === "ttt" ? TTT_BINS[k][2] : k;
  const { key, dir } = LG.sort;
  if (key) data.sort((a, b) => ((a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * dir);
  else data.sort((a, b) => (LG.tab === "qb" ? lastName(a.key).localeCompare(lastName(b.key))
    : String(a.key).localeCompare(String(b.key), undefined, { numeric: true })));

  const cols = [
    ["n", "Passes", (d) => d.n.toLocaleString()],
    ["most", "To most open", (d) => bar(d.most)],
    ["good", "Good decision", (d) => bar(d.good)],
    ["missed", "Missed open", (d) => pct(d.missed)],
    ["tsep", "Target sep.", (d) => `${num(d.tsep)} yd`],
    ["msep", "Best option sep.", (d) => `${num(d.msep)} yd`],
    ["tdep", "Target depth", (d) => `${num(d.tdep)} yd`],
    ["comp", "Comp. %", (d) => pct(d.comp)],
    ["epa", "EPA/pass", (d) => num(d.epa, 2)],
  ];
  const arrow = (k) => (LG.sort.key === k ? (LG.sort.dir < 0 ? " ▾" : " ▴") : "");
  const head = `<tr><th data-k="">${label}${arrow("")}</th>` +
    cols.map(([k, h]) => `<th data-k="${k}" class="num">${h}${arrow(k)}</th>`).join("") + "</tr>";
  const body = data.map((d) =>
    `<tr data-key="${esc(d.key)}" class="${onPick ? "pickable" : ""}"><td>${esc(name(d.key))}</td>` +
    cols.map(([, , f]) => `<td class="num">${f(d)}</td>`).join("") + "</tr>").join("");
  $("lg-table").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;

  for (const th of $("lg-table").querySelectorAll("th")) {
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      LG.sort = { key: k, dir: LG.sort.key === k ? -LG.sort.dir : (k ? -1 : 1) };
      renderTable(rows);
    });
  }
  if (onPick) {
    for (const tr of $("lg-table").querySelectorAll("tbody tr")) {
      tr.addEventListener("click", () => onPick(tr.dataset.key));
    }
  }
}

function bar(x) {
  return `<span class="cell-bar"><span style="width:${(x || 0) * 100}%"></span></span>${pct(x)}`;
}

// ---------- this play ----------
function renderPlayAnalysis() {
  const a = S.play?.analysis;
  $("play-analysis").hidden = !a;
  if (!a) return;
  const c = cfg(), st = DEC_STYLE[a.decision];
  const recs = a.receivers, tgt = recs.find((r) => r.target), best = recs[0];
  const qb = S.meta?.qb ?? "The QB";
  let text = `${esc(qb)} threw to <b>${esc(tgt.name)}</b>: ${num(tgt.sep)} yd of projected separation, ${depthText(tgt.depth)} at the throw.`;
  if (best !== tgt) {
    text += ` Most open was <b>${esc(best.name)}</b> (${best.pos}) with ${num(best.sep)} yd, ${depthText(best.depth)}.`;
  } else {
    text += " He was the most open receiver.";
  }
  $("pa-verdict").innerHTML =
    `<div class="verdict-head"><span class="badge ${st.tone}">${st.icon}</span> ${esc(c.decisions[a.decision] ?? st.short)}</div>` +
    `<p>${text} Thrown ${num(a.timeToThrow)} s into the play.</p>`;

  const maxSep = Math.max(10, ...recs.map((r) => r.sep));
  $("pa-table").innerHTML =
    `<thead><tr><th>Receiver</th><th>Pos</th><th class="num">Depth</th><th class="num">Separation at throw</th>` +
    `<th>Projected at arrival</th><th></th></tr></thead><tbody>` +
    recs.map((r) => {
      const tags = [r.target ? `<span class="pill target">Target</span>` : "", r.mostOpen ? `<span class="pill">Most open</span>` : ""].join(" ");
      return `<tr data-id="${r.id}" class="${r.target ? "is-target" : ""}"><td>${esc(r.name)}</td><td>${esc(r.pos ?? "")}</td>` +
        `<td class="num">${num(r.depth)} yd</td><td class="num">${num(r.sepThrow)} yd</td>` +
        `<td><span class="cell-bar wide ${r.sep >= c.open ? "open" : ""}"><span style="width:${(r.sep / maxSep) * 100}%"></span></span>${num(r.sep)} yd</td>` +
        `<td>${tags}</td></tr>`;
    }).join("") + "</tbody>";
  for (const tr of $("pa-table").querySelectorAll("tbody tr")) {
    const ent = S.play.players.findIndex((p) => p.id === +tr.dataset.id);
    tr.addEventListener("mouseenter", () => { S.highlight = ent; });
    tr.addEventListener("mouseleave", () => { S.highlight = null; });
  }
}
