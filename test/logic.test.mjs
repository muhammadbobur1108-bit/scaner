import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeLabel, validateLabel } from "../src/validate.js";
import { labelsToRows, mergeRows, HEADERS } from "../src/rows.js";
import { frameStats, SteadyTracker } from "../src/steady.js";
import { parseLines, buildColor, parseQty, parseSizes, findModelCode, qtyToText, sizesToText } from "../src/parse.js";

// 1) Haqiqiy OCR natijasi (sinov yorlig'i, 1-rasmga o'xshash) -> maydonlar
const lines = JSON.parse(fs.readFileSync(new URL("./fixture-label1.json", import.meta.url), "utf8"));
const label = normalizeLabel(parseLines(lines));
assert.equal(label.tara_no, "319 / V2");
assert.equal(label.zakaz, "MOS-517.8");
assert.equal(label.naimenovanie, "Свитшот детский");
assert.equal(label.artikul, "2350064");
assert.equal(label.data_upakovki, "2026-07-31");
assert.equal(label.colors.length, 1);
assert.equal(label.colors[0].cvet, "Фиолетовый");
assert.deepEqual(label.colors[0].sizes.map((s) => [s.razmer, s.kol_vo]), [["134", 1], ["152", 18], ["158", 2], ["164", 3]]);
assert.equal(label.colors[0].kol_vo_total, 24);
const v = validateLabel(label);
assert.equal(v.issues.some((m) => m.includes("≠")), false);

// 2) Ko'p rangli shablon (qo'lda tuzilgan qatorlar)
const mk = (rows) => rows.flatMap(([k, val], i) => [
  { text: k, bbox: { x0: 10, y0: i * 50, x1: 200, y1: i * 50 + 40 } },
  ...(val ? [{ text: val, bbox: { x0: 400, y0: i * 50 + 2, x1: 700, y1: i * 50 + 42 } }] : []),
]);
const multi = parseLines(mk([
  ["№ тары", "12"], ["Номер заказа", "MOS-2026.09.1"], ["Наименование", "Водолазки Детские"], ["Артикул", "0123456"],
  ["Общее кол-во", "60"],
  ["Цвет", "Красный"], ["Размер", "98 + 104"], ["Кол-во", "10 + 20 = 30"],
  ["Цвет", "Синий"], ["Размер", "98 + 104"], ["Кол-во", "10 + 20 = 30"],
  ["Цвет", ""], ["Размер", ""], ["Кол-во", ""],
  ["Вес брутто", "6,6"], ["Вес нетто", ""], ["Дата упаковки", "05.08.2026г."],
]));
assert.equal(multi.artikul, "0123456");
assert.equal(multi.obshchee_kol_vo, 60);
assert.equal(multi.colors.length, 2);
assert.equal(multi.ves_brutto, 6.6);
assert.equal(multi.ves_netto, null);
assert.equal(validateLabel(normalizeLabel(multi)).status, "ok");

// 3) Bo'sh shablon
const blank = parseLines(mk([["№ тары", ""], ["Номер заказа", ""], ["Цвет", ""], ["Размер", ""], ["Кол-во", ""]]));
assert.equal(blank.is_blank_template, true);

// 4) O'lcham/son parsing: "+" yo'qolgan, "=" yo'qolgan
assert.deepEqual(parseSizes("134 152 158 164"), ["134", "152", "158", "164"]);
assert.deepEqual(parseQty("1 + 18 + 2 + 3 24"), { nums: [1, 18, 2, 3], total: 24 });
const c = buildColor("Красный", "134 + 152", "1 + 18 + 5", 1);
assert.equal(c.sizes.length, 3);
assert.equal(validateLabel(normalizeLabel({ ...label, colors: [c] })).status, "review");
assert.equal(qtyToText(buildColor("x", "1 + 2", "3 + 4")), "3 + 4 = 7");
assert.equal(sizesToText(buildColor("x", "S + M", "1 + 2")), "S + M");

// 5) Model kodi
assert.equal(findModelCode("noise FT-OW-PC-4318/240-TM.SMEL x"), "FT-OW-PC-4318/240-TM.SMEL");

// 6) Jadval qatorlari va takrorni oldini olish
const ok = validateLabel(label);
const rows = labelsToRows([{ fileName: "a.jpg", label: ok.label, status: ok.status }], new Date("2026-08-01T10:00:00Z"));
assert.equal(rows.length, 4);
assert.equal(rows[0].length, HEADERS.length + 1);
const first = mergeRows([], rows);
assert.equal(first.added, 4);
assert.equal(mergeRows(first.rows, rows).added, 0);

// 7) Yig'indi xatosi aniqlanadi
const bad = structuredClone(label);
bad.colors[0].sizes[1].kol_vo = 8;
assert.ok(validateLabel(bad).issues.some((m) => m.includes("≠")));

// 8) Jonli kamera: qimirlamaslik va aniqlikni aniqlash
const W = 32, H = 24;
const textLike = Uint8Array.from({ length: W * H }, (_, i) => ((i % 4) < 2 ? 30 : 220));
const flat = new Uint8Array(W * H).fill(128);
const noisy = Uint8Array.from({ length: W * H }, (_, i) => (i * 37) % 255);
assert.equal(frameStats(textLike, textLike, W, H).motion, 0);
assert.ok(frameStats(textLike, noisy, W, H).motion > 14);
assert.ok(frameStats(null, textLike, W, H).sharp > frameStats(null, flat, W, H).sharp);

const tr = new SteadyTracker();
const still = { motion: 1, sharp: 20 };
let act = "wait";
for (let t = 0; t < 1200 && act === "wait"; t += 250) act = tr.update(still, 250).action;
assert.equal(act, "capture");                                   // 1.2 s qimirlamay turgach suratga oladi
assert.equal(tr.update(still, 250).action, "wait");             // bir yorliq ikki marta olinmaydi
tr.update({ motion: 30, sharp: 5 }, 250);                       // kamera siljidi -> qayta tayyor
let again = "wait";
for (let t = 0; t < 1500 && again === "wait"; t += 250) again = tr.update(still, 250).action;
assert.equal(again, "capture");
const t2 = new SteadyTracker();
for (let i = 0; i < 20; i++) assert.equal(t2.update({ motion: 10, sharp: 20 }, 250).action, "wait"); // qimirlasa olmaydi
for (let i = 0; i < 20; i++) assert.equal(t2.update({ motion: 1, sharp: 1 }, 250).action, "wait");   // xira/bo'sh bo'lsa olmaydi

console.log("Hammasi o'tdi ✓");
