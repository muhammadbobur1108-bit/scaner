import { createWorker, PSM } from "tesseract.js";
import { get, set } from "idb-keyval";
import { parseLinesDetailed, scoreLabel, findModelCode } from "./parse.js";
import { normalizeLabel } from "./validate.js";

let workerPromise = null;
let statusCb = null;
const base = () => new URL("ocr/", document.baseURI).href;

const STATUS_TEXT = {
  "loading tesseract core": "OCR dvigateli yuklanmoqda...",
  "initializing tesseract": "OCR ishga tushmoqda...",
  "loading language traineddata": "Til fayllari tayyorlanmoqda...",
  "initializing api": "OCR tayyorlanmoqda...",
};

const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// Til fayllarini asosiy oqimdan o'zimiz yuklab, Tesseract keshiga (IndexedDB) joylaymiz.
// Android WebView'da worker ichidan fayl yuklash ba'zan qotib qoladi — shuning uchun worker faqat keshdan o'qiydi.
async function preloadLang(code) {
  const key = `./${code}.traineddata`;
  const have = await get(key).catch(() => undefined);
  if (have && have.byteLength > 1_000_000) return;
  const url = base() + `${code}.traineddata`;
  const resp = await withTimeout(fetch(url), 60000, `${code} til fayli yuklanmadi (vaqt tugadi)`);
  if (!resp.ok) throw new Error(`${code} til fayli topilmadi (HTTP ${resp.status}): ${url}`);
  const data = new Uint8Array(await resp.arrayBuffer());
  if (data.length < 1_000_000) throw new Error(`${code} til fayli buzuq (${data.length} bayt)`);
  await set(key, data);
}

function getWorker() {
  if (!workerPromise) {
    let lastStatus = "boshlanmoqda";
    let rejectEarly;
    const early = new Promise((_, rej) => { rejectEarly = rej; });
    const create = (async () => {
      statusCb?.(STATUS_TEXT["loading language traineddata"]);
      await preloadLang("rus");
      await preloadLang("eng");
      const w = await createWorker("rus+eng", 1, {
        workerPath: base() + "worker.min.js",
        corePath: base(),
        langPath: base(),
        gzip: false,
        workerBlobURL: false,
        errorHandler: (e) => rejectEarly(new Error("OCR xatosi: " + (e?.message || e))),
        logger: (m) => {
          lastStatus = m.status || lastStatus;
          if (!statusCb) return;
          if (STATUS_TEXT[m.status]) statusCb(STATUS_TEXT[m.status]);
          else if (m.status === "recognizing text") statusCb(`Matn o'qilmoqda ${Math.round((m.progress ?? 0) * 100)}%`);
        },
      });
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      return w;
    })();
    workerPromise = Promise.race([
      create,
      early,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`OCR yuklanmadi (3 daqiqa o'tdi). Oxirgi qadam: ${lastStatus}`)), 180000)),
    ]);
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Ilova ochilishi bilan OCR'ni fonda tayyorlab qo'yamiz — birinchi suratda kutish bo'lmasin
export function warmUp() {
  getWorker().catch(() => {});
}

// Tesseract worker'iga bir vaqtda ikkita so'rov yubormaslik uchun navbat
let chain = Promise.resolve();
function recognizeSerial(w, canvas) {
  const p = chain.then(() => w.recognize(canvas));
  chain = p.catch(() => {});
  return p;
}

async function loadImage(b64, mime) {
  const img = new Image();
  img.src = `data:${mime};base64,${b64}`;
  await img.decode();
  return img;
}

// Kulrang tusga o'tkazish, kontrastni cho'zish (ixtiyoriy: Otsu bilan oq-qora qilish), ixtiyoriy 90° burish
function makeCanvas(img, { binarize = false, rotate = false } = {}) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(2, Math.max(0.3, 1600 / Math.max(w0, h0)));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement("canvas");
  c.width = rotate ? h : w;
  c.height = rotate ? w : h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  if (rotate) { ctx.translate(c.width, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(img, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const gray = new Uint8Array(px.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = g;
    hist[g | 0]++;
  }
  const total = gray.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let j = 0; j < gray.length; j++) gray[j] = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / span));

  let thr = -1;
  if (binarize) {
    const h2 = new Uint32Array(256);
    gray.forEach((v) => h2[v | 0]++);
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * h2[v];
    let wB = 0, sumB = 0, best = 0;
    for (let v = 0; v < 256; v++) {
      wB += h2[v];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += v * h2[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; thr = v; }
    }
  }
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = thr >= 0 ? (gray[j] > thr ? 255 : 0) : gray[j];
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Qatorlar koordinatalarini 0..1000 oralig'iga keltiramiz (rasm o'lchamiga bog'liq bo'lmasin)
const toLines = (r, cw, ch) =>
  (r.data.lines ?? [])
    .map((l) => ({
      text: l.text.replace(/\s+/g, " ").trim(),
      bbox: { x0: (l.bbox.x0 * 1000) / cw, y0: (l.bbox.y0 * 1000) / ch, x1: (l.bbox.x1 * 1000) / cw, y1: (l.bbox.y1 * 1000) / ch },
    }))
    .filter((l) => l.text);

function previewOf(img) {
  const s = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

function fieldFor(line, trace) {
  const cx = (line.bbox.x0 + line.bbox.x1) / 2, cy = (line.bbox.y0 + line.bbox.y1) / 2;
  return trace.find((t) => cx >= t.bbox.x0 && cx <= t.bbox.x1 && cy >= t.bbox.y0 && cy <= t.bbox.y1)?.field ?? null;
}

// Rasmdan yorliqni o'qiydi (internet va API kalit kerak emas).
// Qaytaradi: label, boxes (har bir topilgan matn qutisi), preview, ms, extra (fonda model kodi izlash)
export async function ocrImage(b64, mime, onStatus) {
  const t0 = Date.now();
  let msg = "OCR tayyorlanmoqda...";
  const show = () => onStatus?.(`${msg} (${Math.round((Date.now() - t0) / 1000)} s)`);
  statusCb = (m) => { msg = m; show(); };
  const ticker = setInterval(show, 1000);
  try {
    return await ocrInner(b64, mime);
  } finally {
    clearInterval(ticker);
    statusCb = null;
  }
}

async function ocrInner(b64, mime) {
  statusCb("OCR tayyorlanmoqda...");
  const w = await getWorker();
  const img = await loadImage(b64, mime);
  const t0 = Date.now();

  let best = null;
  for (const binarize of [false, true]) {
    statusCb(binarize ? "Qayta o'qilmoqda (oq-qora)..." : "Matn o'qilmoqda...");
    const canvas = makeCanvas(img, { binarize });
    const r = await recognizeSerial(w, canvas);
    const lines = toLines(r, canvas.width, canvas.height);
    const { label, trace } = parseLinesDetailed(lines);
    const score = scoreLabel(label);
    if (!best || score > best.score) best = { label, trace, lines, score };
    if (best.score >= 4) break;
  }
  const ms = Date.now() - t0;

  const boxes = best.lines.map((l) => ({ ...l.bbox, text: l.text, field: fieldFor(l, best.trace) }));

  // Chap chetdagi vertikal model kodi: rasmni 90° burib, natija ko'rsatilgandan keyin fonda o'qiymiz
  const extra = !best.label.model_kod && best.score >= 3
    ? recognizeSerial(w, makeCanvas(img, { rotate: true })).then((r) => findModelCode(r.data.text)).catch(() => null)
    : Promise.resolve(null);

  return { label: normalizeLabel(best.label), boxes, preview: previewOf(img), ms, extra };
}
