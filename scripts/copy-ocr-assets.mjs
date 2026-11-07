// OCR fayllarini (worker, wasm yadro, til ma'lumotlari) ilova ichiga nusxalaydi — internet kerak bo'lmasligi uchun.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("public/ocr");
fs.mkdirSync(out, { recursive: true });

const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz", "rus.traineddata.gz"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];
for (const [from, to] of files) {
  if (!fs.existsSync(from)) throw new Error("Topilmadi: " + from);
  fs.copyFileSync(from, path.join(out, to));
}
console.log("OCR fayllari nusxalandi:", files.length);
