// OCR fayllarini (worker, wasm yadro, til ma'lumotlari) ilova ichiga nusxalaydi — internet kerak bo'lmasligi uchun.
// Til fayllari siqilmagan holda (.traineddata) qo'yiladi: telefonda qo'shimcha yechish kerak bo'lmaydi.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const out = path.resolve("public/ocr");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
];
for (const [from, to] of copy) {
  if (!fs.existsSync(from)) throw new Error("Topilmadi: " + from);
  fs.copyFileSync(from, path.join(out, to));
}
for (const lang of ["rus", "eng"]) {
  const gz = `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
  if (!fs.existsSync(gz)) throw new Error("Topilmadi: " + gz);
  fs.writeFileSync(path.join(out, `${lang}.traineddata`), zlib.gunzipSync(fs.readFileSync(gz)));
}
console.log("OCR fayllari nusxalandi:", fs.readdirSync(out).join(", "));
