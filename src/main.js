import "./style.css";
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Media } from "@capacitor-community/media";
import * as XLSX from "xlsx";
import { ocrImage, warmUp } from "./ocr.js";
import { openLiveCamera } from "./live.js";
import { validateLabel } from "./validate.js";
import { buildColor, emptyLabel, sizesToText, qtyToText } from "./parse.js";
import { HEADERS, NUMERIC_COLS, labelsToRows, mergeRows } from "./rows.js";
import { loadRows, saveRows } from "./store.js";

const root = document.getElementById("app");
const state = { tab: "scan", results: [], rows: [], queue: { total: 0, done: 0, running: false }, step: "", toast: null, search: "", saveErr: 0, lastSaveErr: "" };
const jobs = [];
const FIELDS = [
  ["tara_no", "№ тары"], ["zakaz", "Номер заказа"], ["naimenovanie", "Наименование"],
  ["artikul", "Артикул"], ["model_kod", "Модель (kod)"], ["data_upakovki", "Дата (YYYY-MM-DD)"],
  ["obshchee_kol_vo", "Общее кол-во"], ["ves_brutto", "Вес брутто"], ["ves_netto", "Вес нетто"],
];
const NUM_FIELDS = new Set(["obshchee_kol_vo", "ves_brutto", "ves_netto"]);
const FIELD_CHIP = { tara: "№ тары", zakaz: "Заказ", naim: "Наименование", artikul: "Артикул", cvet: "Цвет", razmer: "Размер", kolvo: "Кол-во", obshchee: "Общее", brutto: "Брутто", netto: "Нетто", data: "Дата", strana: "Страна", punkt: "Пункт", sert: "ТР ТС" };
const CHIP_TO_INPUT = { tara: "tara_no", zakaz: "zakaz", naim: "naimenovanie", artikul: "artikul", obshchee: "obshchee_kol_vo", brutto: "ves_brutto", netto: "ves_netto", data: "data_upakovki" };
let uid = 0;
let toastTimer;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BADGE = { ok: "Tayyor", review: "Tekshirish kerak", skipped: "O'tkazildi" };
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

function toast(text, bad = false) {
  state.toast = { text, bad };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, 4000);
  render();
}

// Fonda tugagan ishlar yozayotgan maydonni buzmasligi uchun
function renderSafe() {
  const a = document.activeElement;
  if (a && a.tagName === "INPUT" && root.contains(a)) return;
  render();
}

// ---------- Asl rasmni galereyaga saqlash ----------
let albumPath = null;
async function saveOriginal(b64, mime, name) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (!albumPath) {
      const { path } = await Media.getAlbumsPath();
      albumPath = `${path}/Yorliq OCR`;
      try { await Media.createAlbum({ name: "Yorliq OCR" }); } catch { /* album allaqachon bor */ }
    }
    await Media.savePhoto({ path: `data:${mime};base64,${b64}`, albumIdentifier: albumPath, fileName: name.replace(/\.\w+$/, "") });
  } catch (e) {
    state.saveErr++;
    state.lastSaveErr = e?.message || String(e);
  }
}
function reportSaveErrors() {
  if (state.saveErr > 0) {
    toast(`Galereyaga saqlanmadi (${state.saveErr} ta): ${state.lastSaveErr}`, true);
    state.saveErr = 0;
  }
}

// ---------- Navbat: surat olingan zahoti o'qish boshlanadi ----------
function setStep(text) {
  state.step = text;
  const el = document.getElementById("step");
  if (el) el.textContent = text;
}

function revalidateItem(l) {
  const re = validateLabel(l.label);
  l.issues = re.issues;
  l.status = re.status;
}

function enqueue(img) {
  jobs.push(img);
  state.queue.total++;
  pump();
}

async function pump() {
  if (state.queue.running) return;
  state.queue.running = true;
  render();
  while (jobs.length) {
    const img = jobs.shift();
    state.step = "OCR tayyorlanmoqda...";
    renderSafe();
    try {
      const r = await ocrImage(img.b64, img.mime, setStep);
      const item = { id: img.id, name: img.name, preview: r.preview, boxes: r.boxes, ms: r.ms, labels: [validateLabel(r.label)] };
      state.results.push(item);
      r.extra.then((code) => {
        const l = item.labels[0];
        if (code && l && !l.label.model_kod) { l.label.model_kod = code; revalidateItem(l); renderSafe(); }
      }).catch(() => {});
    } catch (e) {
      state.results.push({ id: img.id, name: img.name, labels: [], error: e.message || String(e) });
    }
    state.queue.done++;
    renderSafe();
  }
  state.queue = { total: 0, done: 0, running: false };
  state.step = "";
  render();
  reportSaveErrors();
}

// ---------- Rasm olish ----------
async function liveScan() {
  try {
    await openLiveCamera(({ b64, mime, count }) => {
      const img = { id: ++uid, name: `yorliq-${stamp()}-${count}.jpg`, b64, mime };
      saveOriginal(b64, mime, img.name);
      enqueue(img);
    });
    render();
    if (!state.queue.running) reportSaveErrors();
  } catch (e) {
    toast("Jonli kamera ochilmadi, oddiy kamera ishlatiladi");
    addFromCamera();
  }
}

async function addFromCamera() {
  try {
    // Asl rasm tizim kamerasi orqali olinadi va galereyaga o'zi saqlanadi
    const p = await Camera.getPhoto({ quality: 92, correctOrientation: true, saveToGallery: true, resultType: CameraResultType.Base64, source: CameraSource.Camera });
    enqueue({ id: ++uid, name: `kamera-${stamp()}.jpg`, b64: p.base64String, mime: "image/" + (p.format === "png" ? "png" : "jpeg") });
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
    const { photos } = await Camera.pickImages({ quality: 85, limit: 10, width: 2200 });
    for (const ph of photos) {
      const blob = await (await fetch(ph.webPath)).blob();
      enqueue({ id: ++uid, name: `galereya-${stamp()}-${uid}.jpg`, b64: await blobToB64(blob), mime: blob.type === "image/png" ? "image/png" : "image/jpeg" });
    }
  } catch (e) {
    if (!/cancel/i.test(e.message || "")) toast("Galereya xatosi: " + (e.message || e), true);
  }
}

function addManual() {
  const l = emptyLabel();
  l.colors = [buildColor("", "", "", 1)];
  state.results.push({ id: ++uid, name: "qo'lda", labels: [validateLabel(l)] });
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
function shotView(r, ri) {
  if (!r.preview) return "";
  const boxes = r.boxes.map((b, bi) => `<div class="box ${b.field ? "hit" : ""}" data-a="box" data-r="${ri}" data-b="${bi}" style="left:${b.x0 / 10}%;top:${b.y0 / 10}%;width:${(b.x1 - b.x0) / 10}%;height:${(b.y1 - b.y0) / 10}%">${b.field ? `<span>${esc(FIELD_CHIP[b.field] ?? b.field)}</span>` : ""}</div>`).join("");
  return `<div class="shot"><img src="${r.preview}">${boxes}</div>
    <div class="muted">${r.ms ? `O'qish vaqti: ${(r.ms / 1000).toFixed(1)} s · ` : ""}${r.boxes.length} ta matn topildi. Qutini bossangiz, matn nusxalanadi.</div>`;
}

function colorEditor(v, ri, li) {
  return v.label.colors.map((c, ci) => `
    <div class="color">
      <div class="colorhead"><b>Rang ${ci + 1}</b><button class="x" data-a="rm-color" data-r="${ri}" data-l="${li}" data-c="${ci}">✕</button></div>
      <label>Цвет<input data-ce="1" data-r="${ri}" data-l="${li}" data-c="${ci}" data-k="cvet" value="${esc(c.cvet)}"></label>
      <label>Размер (134 + 152 + 158)<input data-ce="1" data-r="${ri}" data-l="${li}" data-c="${ci}" data-k="sz" value="${esc(sizesToText(c))}"></label>
      <label>Кол-во (1 + 18 + 2 = 21)<input data-ce="1" data-r="${ri}" data-l="${li}" data-c="${ci}" data-k="qty" value="${esc(qtyToText(c))}"></label>
    </div>`).join("");
}

function scanView() {
  const items = pendingItems();
  const review = items.filter((i) => i.status === "review").length;
  const q = state.queue;
  return `
  <div class="stack">
    <button class="btn primary" data-a="live">🔍 Jonli kamera (avto suratga oladi)</button>
    <div class="grid2">
      <button class="btn" data-a="camera">📷 Oddiy kamera</button>
      <button class="btn" data-a="gallery">🖼 Galereya</button>
    </div>
    ${q.running ? `<div class="card progress"><b>O'qilmoqda ${Math.min(q.done + 1, q.total)} / ${q.total}</b><span class="muted" id="step">${esc(state.step)}</span></div>` : ""}
    <button class="btn" data-a="manual">✍️ Qo'lda kiritish</button>
    ${state.results.map((r, ri) => `
      <div class="stack">
        <div class="muted">${esc(r.name)}</div>
        ${r.error ? `<div class="err">Xato: ${esc(r.error)}</div>` : ""}
        ${r.labels.map((v, li) => `
          <div class="card">
            ${shotView(r, ri)}
            <div class="cardhead"><span class="badge ${v.status}">${BADGE[v.status]}</span><button class="x" data-a="rm-label" data-r="${ri}" data-l="${li}">O'chirish</button></div>
            <div class="fields">${FIELDS.map(([k, t]) => `<label>${t}<input data-r="${ri}" data-l="${li}" data-f="${k}" value="${esc(v.label[k])}"></label>`).join("")}</div>
            ${colorEditor(v, ri, li)}
            <button class="btn small" data-a="add-color" data-r="${ri}" data-l="${li}">+ Rang qo'shish</button>
            ${v.issues.length ? `<ul class="issues">${v.issues.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
          </div>`).join("")}
      </div>`).join("")}
    ${items.length ? `<div class="sticky stack">
        ${review ? `<div class="muted">${review} ta yorliq "Tekshirish kerak" — rasm bilan solishtirib, to'g'rilang. Baribir qo'shsangiz, jadvalda shu belgi bilan turadi.</div>` : ""}
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

function render() {
  const keepScroll = root.querySelector("main")?.scrollTop ?? 0;
  const view = state.tab === "scan" ? scanView() : tableView();
  const title = state.tab === "scan" ? "Yorliq skaneri" : `Jadval (${state.rows.length})`;
  root.innerHTML = `<header>${title}</header><main>${view}</main>
    <nav>${[["scan", "📷 Skaner"], ["table", "📋 Jadval"]].map(([t, l]) => `<button data-a="tab" data-t="${t}" class="${state.tab === t ? "active" : ""}">${l}</button>`).join("")}</nav>
    ${state.toast ? `<div class="toast ${state.toast.bad ? "bad" : ""}">${esc(state.toast.text)}</div>` : ""}`;
  root.querySelector("main").scrollTop = keepScroll;
  const s = root.querySelector('input[data-a="search"]');
  if (s && state._focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

// ---------- Hodisalar ----------
function revalidate(ri, li) { revalidateItem(state.results[ri].labels[li]); }

root.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.tagName === "INPUT") return;
  const a = el.dataset.a;
  const i = Number(el.dataset.i);
  const ri = Number(el.dataset.r), li = Number(el.dataset.l), ci = Number(el.dataset.c);
  state._focusSearch = false;
  if (a === "tab") { state.tab = el.dataset.t; render(); }
  else if (a === "live") liveScan();
  else if (a === "camera") addFromCamera();
  else if (a === "gallery") addFromGallery();
  else if (a === "manual") addManual();
  else if (a === "box") {
    const b = state.results[ri].boxes[Number(el.dataset.b)];
    try { await navigator.clipboard.writeText(b.text); toast(`Nusxalandi: ${b.text}`); } catch { toast(b.text); }
    const inp = b.field && CHIP_TO_INPUT[b.field] ? root.querySelector(`input[data-r="${ri}"][data-f="${CHIP_TO_INPUT[b.field]}"]`) : null;
    inp?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  else if (a === "add") addToTable();
  else if (a === "discard") { if (confirm("Natijalar o'chirilsinmi?")) { state.results = []; render(); } }
  else if (a === "rm-label") { state.results[ri].labels.splice(li, 1); if (!state.results[ri].labels.length && !state.results[ri].error) state.results.splice(ri, 1); render(); }
  else if (a === "add-color") { const it = state.results[ri].labels[li]; it.label.colors.push(buildColor("", "", "", it.label.colors.length + 1)); revalidate(ri, li); render(); }
  else if (a === "rm-color") { const it = state.results[ri].labels[li]; it.label.colors.splice(ci, 1); revalidate(ri, li); render(); }
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
  }
});

root.addEventListener("input", (e) => {
  if (e.target.dataset.a === "search") { state.search = e.target.value; state._focusSearch = true; render(); }
});

root.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.f !== undefined) {
    const item = state.results[Number(t.dataset.r)].labels[Number(t.dataset.l)];
    const raw = t.value.trim();
    item.label[t.dataset.f] = raw === "" ? null : NUM_FIELDS.has(t.dataset.f) ? (Number.isFinite(Number(raw.replace(",", "."))) ? Number(raw.replace(",", ".")) : null) : raw;
    revalidate(Number(t.dataset.r), Number(t.dataset.l));
    render();
  } else if (t.dataset.ce !== undefined) {
    const { r, l, c } = t.dataset;
    const get = (k) => root.querySelector(`input[data-ce][data-r="${r}"][data-l="${l}"][data-c="${c}"][data-k="${k}"]`).value;
    const it = state.results[Number(r)].labels[Number(l)];
    it.label.colors[Number(c)] = buildColor(get("cvet"), get("sz"), get("qty"), Number(c) + 1);
    revalidate(Number(r), Number(l));
    render();
  }
});

(async () => {
  state.rows = await loadRows();
  render();
  setTimeout(warmUp, 800);
})();
