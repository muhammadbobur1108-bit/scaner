import { createWorker, PSM } from "tesseract.js";
import { parseLines, scoreLabel, findModelCode } from "./parse.js";
import { normalizeLabel } from "./validate.js";

let workerPromise = null;
let statusCb = null;
const base = () => new URL("ocr/", document.baseURI).href;

const STATUS_TEXT = {
  "loading tesseract core": "OCR dvigateli yuklanmoqda...",
  "initializing tesseract": "OCR ishga tushmoqda...",
  "loading language traineddata": "Til fayllari yuklanmoqda...",
  "initializing api": "OCR tayyorlanmoqda...",
};

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("rus+eng", 1, {
      workerPath: base() + "worker.min.js",
      corePath: base(),
      langPath: base(),
      gzip: true,
      cacheMethod: "none",
      workerBlobURL: false,
      logger: (m) => {
        if (!statusCb) return;
        if (STATUS_TEXT[m.status]) statusCb(STATUS_TEXT[m.status]);
        else if (m.status === "recognizing text") statusCb(`Matn o'qilmoqda ${Math.round((m.progress ?? 0) * 100)}%`);
      },
    }).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
      return w;
    });
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
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
  const scale = Math.min(2.5, Math.max(0.4, 2000 / Math.max(w0, h0)));
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

const toLines = (r) =>
  (r.data.lines ?? []).map((l) => ({ text: l.text.replace(/\s+/g, " ").trim(), bbox: l.bbox })).filter((l) => l.text);

// Rasmdan yorliqni o'qiydi (internet va API kalit kerak emas)
export async function ocrImage(b64, mime, onStatus) {
  statusCb = onStatus;
  onStatus?.("OCR tayyorlanmoqda...");
  const w = await getWorker();
  const img = await loadImage(b64, mime);

  let best = null;
  for (const binarize of [false, true]) {
    onStatus?.(binarize ? "Qayta o'qilmoqda (oq-qora)..." : "Matn o'qilmoqda...");
    const r = await w.recognize(makeCanvas(img, { binarize }));
    const label = parseLines(toLines(r));
    const score = scoreLabel(label);
    if (!best || score > best.score) best = { label, score };
    if (best.score >= 6) break;
  }

  // Chap chetdagi vertikal model kodi: rasmni 90° burib alohida o'qiymiz
  if (!best.label.model_kod && best.score >= 3) {
    onStatus?.("Model kodi izlanmoqda...");
    const r = await w.recognize(makeCanvas(img, { rotate: true }));
    best.label.model_kod = findModelCode(toLines(r).map((l) => l.text).join("\n"));
  }
  statusCb = null;
  return normalizeLabel(best.label);
}
