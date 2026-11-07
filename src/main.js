import "./style.css";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import * as XLSX from "xlsx";
import { extractLabels, testKey } from "./api.js";
import { validateLabel } from "./validate.js";
import { HEADERS, NUMERIC_COLS, labelsToRows, mergeRows } from "./rows.js";
import { loadRows, saveRows, loadSettings, saveSettings } from "./store.js";

const root = document.getElementById("app");
const state = { tab: "scan", images: [], results: [], rows: [], settings: { apiKey: "", model: "" }, busy: "", progress: "", toast: null, search: "" };
const FIELDS = [
  ["tara_no", "№ тары"], ["zakaz", "Номер заказа"], ["naimenovanie", "Наименование"],
  ["artikul", "Артикул"], ["model_kod", "Модель (kod)"], ["data_upakovki", "Дата (YYYY-MM-DD)"],
];
let uid = 0;
let toastTimer;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BADGE = { ok: "Tayyor", review: "Tekshirish kerak", skipped: "O'tkazildi" };

function toast(text, bad = false) {
  state.toast = { text, bad };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, 4000);
  render();
}

// ---------- Rasm olish ----------
async function addFromCamera() {
  try {
    const p = await Camera.getPhoto({ quality: 85, width: 2200, correctOrientation: true, resultType: CameraResultType.Base64, source: CameraSource.Camera });
    state.images.push({ id: ++uid, b64: p.base64String, mime: "image/" + (p.format === "png" ? "png" : "jpeg"), name: `kamera-${Date.now()}.jpg` });
    render();
  } catch (e) {
    if (!/cancel/i.test(e.message || "")) toast("Kamera xatosi: " + (e.message || e), true);
  }
}

const blobToB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error("Rasmni o'qib bo'lmadi"));
  r.readAsDataURL(blob);
});

async function addFromGallery() {
  try {
    const { photos } = await Camera.pickImages({ quality: 85, width: 2200, limit: 10 });
    for (const ph of photos) {
      const blob = await (await fetch(ph.webPath)).blob();
      state.images.push({ id: ++uid, b64: await blobToB64(blob), mime: blob.type === "image/png" ? "image/png" : "image/jpeg", name: `galereya-${Date.now()}-${uid}.jpg` });
    }
    render();
  } catch (e) {
    if (!/cancel/i.test(e.message || "")) toast("Galereya xatosi: " + (e.message || e), true);
  }
}

// ---------- O'qish ----------
async function readAll() {
  if (!state.settings.apiKey) { state.tab = "settings"; return toast("Avval API kalitni kiriting", true); }
  state.busy = "ocr";
  const queue = [...state.images];
  let i = 0;
  for (const img of queue) {
    state.progress = `${++i} / ${queue.length}`;
    render();
    const r = await extractLabels(img.b64, img.mime, state.settings);
    state.results.push({ id: img.id, name: img.name, labels: r.labels, error: r.error });
    state.images = state.images.filter((x) => x.id !== img.id);
  }
  state.busy = "";
  state.progress = "";
  render();
}

function pendingItems() {
  return state.results.flatMap((r) => r.labels.filter((l) => l.status !== "skipped").map((l) => ({ fileName: r.name, label: l.label, status: l.status })));
}

async function addToTable() {
  const items = pendingItems();
  if (!items.length) return;
  const { rows, added, skipped } = mergeRows(state.rows, labelsToRows(items));
  state.rows = rows;
  await saveRows(rows);
  state.results = [];
  state.tab = "table";
  toast(`${added} qator jadvalga qo'shildi` + (skipped ? `, ${skipped} ta takror o'tkazildi` : ""));
}

// ---------- Excel ----------
async function exportXlsx() {
  if (!state.rows.length) return;
  const aoa = [HEADERS, ...state.rows.map((r) => r.slice(0, HEADERS.length))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = HEADERS.map((h, c) => ({ wch: Math.min(40, Math.max(h.length, ...state.rows.slice(0, 200).map((r) => String(r[c] ?? "").length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Yorliqlar");
  const name = `yorliqlar-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    if (Capacitor.isNativePlatform()) {
      const data = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
      const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
      await Share.share({ title: name, url: uri, dialogTitle: "Excel faylni yuborish / saqlash" });
    } else {
      XLSX.writeFile(wb, name);
    }
  } catch (e) {
    if (!/cancel/i.test(e.message || "")) toast("Eksport xatosi: " + (e.message || e), true);
  }
}

// ---------- Ko'rinish ----------
function scanView() {
  const busy = state.busy === "ocr";
  const items = pendingItems();
  const review = items.filter((i) => i.status === "review").length;
  return `
  <div class="stack">
    <div class="grid2">
      <button class="btn primary" data-a="camera" ${busy ? "disabled" : ""}>📷 Kamera</button>
      <button class="btn" data-a="gallery" ${busy ? "disabled" : ""}>🖼 Galereya</button>
    </div>
    ${state.images.length ? `<div class="thumbs">${state.images.map((im, i) => `<div class="thumb"><img src="data:${im.mime};base64,${im.b64}"><button data-a="rm-img" data-i="${i}">×</button></div>`).join("")}</div>` : ""}
    <button class="btn primary" data-a="read" ${!state.images.length || busy ? "disabled" : ""}>${busy ? `O'qilmoqda ${state.progress}...` : `O'qish (${state.images.length})`}</button>
    ${state.results.map((r, ri) => `
      <div class="stack">
        <div class="muted">${esc(r.name)}</div>
        ${r.error ? `<div class="err">Xato: ${esc(r.error)}</div>` : ""}
        ${r.labels.map((v, li) => `
          <div class="card">
            <span class="badge ${v.status}">${BADGE[v.status]}</span>
            <div class="fields">${FIELDS.map(([k, t]) => `<label>${t}<input data-r="${ri}" data-l="${li}" data-f="${k}" value="${esc(v.label[k])}"></label>`).join("")}</div>
            ${v.label.colors.map((c) => `<div class="color"><b>${esc(c.cvet)}</b> — ${c.sizes.map((z) => `${esc(z.razmer)}: ${z.kol_vo ?? "?"}`).join(" | ")} (jami ${c.kol_vo_total ?? "?"})</div>`).join("")}
            ${v.issues.length ? `<ul class="issues">${v.issues.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
          </div>`).join("")}
      </div>`).join("")}
    ${items.length ? `<div class="sticky stack">
        ${review ? `<div class="muted">${review} ta yorliq "Tekshirish kerak" — jadvalga shu belgi bilan qo'shiladi.</div>` : ""}
        <button class="btn green" data-a="add">Jadvalga qo'shish (${items.length})</button>
        <button class="btn danger" data-a="discard">Bekor qilish</button></div>` : ""}
  </div>`;
}

function tableView() {
  const q = state.search.trim().toLowerCase();
  const list = state.rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || r.slice(0, HEADERS.length).join(" ").toLowerCase().includes(q));
  return `
  <div class="stack">
    <input class="search" data-a="search" placeholder="Qidirish (buyurtma, rang, artikul...)" value="${esc(state.search)}">
    <div class="muted">${state.rows.length} qator${q ? `, topildi: ${list.length}` : ""}. Katakni bossangiz — tahrirlanadi.</div>
    <div class="tablewrap"><table>
      <thead><tr><th></th>${HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${list.slice(0, 500).map(({ r, i }) => `<tr><td class="del" data-a="del-row" data-i="${i}">✕</td>${HEADERS.map((_, c) => `<td data-a="edit" data-i="${i}" data-c="${c}">${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${list.length > 500 ? `<div class="muted">Ko'rsatilgan: 500 / ${list.length}. Hammasi Excel'ga eksport qilinadi.</div>` : ""}
    <div class="grid2">
      <button class="btn primary" data-a="xlsx" ${state.rows.length ? "" : "disabled"}>📤 Excel (.xlsx)</button>
      <button class="btn danger" data-a="clear" ${state.rows.length ? "" : "disabled"}>Hammasini tozalash</button>
    </div>
    <div class="muted">Excel faylni Google Sheets'ga ham yuklash mumkin (Drive → Yuklash → Sheets bilan ochish).</div>
  </div>`;
}

function settingsView() {
  return `
  <div class="stack set">
    <div><label>Anthropic API kalit</label><input id="key" type="password" autocomplete="off" placeholder="sk-ant-..." value="${esc(state.settings.apiKey)}"></div>
    <div><label>Model</label><input id="model" value="${esc(state.settings.model)}"></div>
    <div class="grid2">
      <button class="btn primary" data-a="save-set">Saqlash</button>
      <button class="btn" data-a="test-key" ${state.busy === "test" ? "disabled" : ""}>${state.busy === "test" ? "Tekshirilmoqda..." : "Kalitni tekshirish"}</button>
    </div>
    <div class="muted">Kalit faqat shu telefonda saqlanadi va faqat api.anthropic.com ga yuboriladi. Telefonni boshqalarga bermang va kalitni hech kimga ko'rsatmang.</div>
  </div>`;
}

function render() {
  const keepScroll = root.querySelector("main")?.scrollTop ?? 0;
  const view = state.tab === "scan" ? scanView() : state.tab === "table" ? tableView() : settingsView();
  const title = { scan: "Yorliq skaneri", table: `Jadval (${state.rows.length})`, settings: "Sozlamalar" }[state.tab];
  root.innerHTML = `<header>${title}</header><main>${view}</main>
    <nav>${[["scan", "📷 Skaner"], ["table", "📋 Jadval"], ["settings", "⚙️ Sozlama"]].map(([t, l]) => `<button data-a="tab" data-t="${t}" class="${state.tab === t ? "active" : ""}">${l}</button>`).join("")}</nav>
    ${state.toast ? `<div class="toast ${state.toast.bad ? "bad" : ""}">${esc(state.toast.text)}</div>` : ""}`;
  root.querySelector("main").scrollTop = keepScroll;
  const s = root.querySelector('input[data-a="search"]');
  if (s && document.activeElement !== s && state._focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

// ---------- Hodisalar ----------
root.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.tagName === "INPUT") return;
  const a = el.dataset.a;
  const i = Number(el.dataset.i);
  state._focusSearch = false;
  if (a === "tab") { state.tab = el.dataset.t; render(); }
  else if (a === "camera") addFromCamera();
  else if (a === "gallery") addFromGallery();
  else if (a === "rm-img") { state.images.splice(i, 1); render(); }
  else if (a === "read") readAll();
  else if (a === "add") addToTable();
  else if (a === "discard") { if (confirm("Natijalar o'chirilsinmi?")) { state.results = []; render(); } }
  else if (a === "del-row") {
    if (confirm("Bu qator o'chirilsinmi?")) { state.rows.splice(i, 1); await saveRows(state.rows); render(); }
  } else if (a === "edit") {
    const c = Number(el.dataset.c);
    const cur = state.rows[i][c];
    const v = prompt(HEADERS[c], cur ?? "");
    if (v === null) return;
    const val = v.trim() === "" ? null : NUMERIC_COLS.has(c) && !Number.isNaN(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : v;
    state.rows[i][c] = val;
    await saveRows(state.rows);
    render();
  } else if (a === "xlsx") exportXlsx();
  else if (a === "clear") {
    if (confirm("Jadvaldagi HAMMA qatorlar o'chiriladi. Avval Excel'ga eksport qildingizmi?")) { state.rows = []; await saveRows([]); render(); }
  } else if (a === "save-set") {
    state.settings = { apiKey: root.querySelector("#key").value.trim(), model: root.querySelector("#model").value.trim() || "claude-sonnet-5-5" };
    await saveSettings(state.settings);
    toast("Saqlandi");
  } else if (a === "test-key") {
    state.settings = { apiKey: root.querySelector("#key").value.trim(), model: root.querySelector("#model").value.trim() || "claude-sonnet-5-5" };
    state.busy = "test";
    render();
    try { await testKey(state.settings); await saveSettings(state.settings); state.busy = ""; toast("Kalit ishlayapti ✓"); }
    catch (err) { state.busy = ""; toast("Xato: " + (err.message || err), true); }
  }
});

root.addEventListener("input", (e) => {
  if (e.target.dataset.a === "search") { state.search = e.target.value; state._focusSearch = true; render(); }
});

root.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.f === undefined) return;
  const item = state.results[Number(t.dataset.r)].labels[Number(t.dataset.l)];
  item.label[t.dataset.f] = t.value.trim() === "" ? null : t.value.trim();
  const re = validateLabel(item.label);
  item.issues = re.issues;
  item.status = re.status;
  render();
});

(async () => {
  state.rows = await loadRows();
  state.settings = await loadSettings();
  if (!state.settings.apiKey) state.tab = "settings";
  render();
})();
