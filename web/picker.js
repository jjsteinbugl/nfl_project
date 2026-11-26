"use strict";
// A small searchable dropdown that can show logos (a native <select>/<datalist> can't show images).
//   makePicker(input, { items: () => [{ value, text, search, html, icon }], onPick(item) })
// `icon` (optional HTML) is shown inside the box while that item is picked.
// Typing filters the list; ↑/↓ + Enter or a click picks; Esc closes.

const PICKER_MAX = 60;

function makePicker(input, { items, onPick }) {
  const icon = document.createElement("span");
  icon.className = "pk-icon";
  input.parentElement.append(icon);
  const list = document.createElement("ul");
  list.className = "picker-list";
  list.hidden = true;
  input.parentElement.append(list);
  let shown = [], active = -1;

  function open() {
    const q = input.value.trim().toLowerCase();
    const all = items();
    // If the box already shows a picked item, list everything so the user can switch.
    const exact = all.some((it) => it.text.toLowerCase() === q);
    const terms = exact ? [] : q.split(/\s+/).filter(Boolean);
    // Name matches first, then matches on other words (e.g. the team name)
    const hits = all.filter((it) => terms.every((t) => it.search.includes(t)));
    const byName = (it) => terms.every((t) => it.text.toLowerCase().includes(t)) ? 0 : 1;
    shown = hits.map((it, i) => [byName(it), i, it]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, , it]) => it).slice(0, PICKER_MAX);
    active = -1;
    list.innerHTML = shown.length
      ? shown.map((it, i) => `<li data-i="${i}">${it.html}</li>`).join("")
      : `<li class="empty">No matches</li>`;
    list.hidden = false;
  }
  function close() { list.hidden = true; active = -1; }
  function setActive(i) {
    active = Math.max(-1, Math.min(i, shown.length - 1));
    [...list.children].forEach((li, j) => li.classList.toggle("active", j === active));
    list.children[active]?.scrollIntoView({ block: "nearest" });
  }
  function pick(i) {
    const it = shown[i];
    if (!it) return;
    input.value = it.text;
    syncIcon();
    close();
    onPick(it);
  }

  // Show the picked item's icon (team logo) inside the box
  function syncIcon() {
    const it = items().find((x) => x.text === input.value);
    icon.innerHTML = it?.icon ?? "";
    input.parentElement.classList.toggle("has-icon", !!it?.icon);
  }
  input.addEventListener("focus", open);
  input.addEventListener("input", () => { syncIcon(); if (document.activeElement === input) open(); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) open(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active >= 0 ? active : 0); input.blur(); }
    else if (e.key === "Escape") { close(); }
  });
  // mousedown (not click) so it fires before the input loses focus
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pick(+li.dataset.i); input.blur(); }
  });
}
