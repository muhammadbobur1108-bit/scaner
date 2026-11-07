import assert from "node:assert/strict";
import { normalizeLabel, validateLabel } from "../src/validate.js";
import { labelsToRows, mergeRows, HEADERS } from "../src/rows.js";
import { parseJson } from "../src/api.js";

// 1-rasmdagi yorliq
const raw = {
  tara_no: "319 / V2", zakaz: "MOS-517.8", naimenovanie: "Свитшот детский", artikul: "2350064",
  model_kod: "FT-OW-PC-4318/240-TM.SMEL", obshchee_kol_vo: null,
  colors: [{ pos: 1, cvet: "Фиолетовый", sizes: [{ razmer: "134", kol_vo: 1 }, { razmer: "152", kol_vo: 18 }, { razmer: "158", kol_vo: 2 }, { razmer: "164", kol_vo: 3 }], kol_vo_total: 24 }],
  ves_brutto: null, ves_netto: null, data_upakovki: "2026-07-31", strana: 'ООО "Chust Textile", Узбекистан',
  punkt_naznacheniya: "Российская Федерация", sertifikat: "ТР ТС 017/2011 EAC",
};
const ok = validateLabel(normalizeLabel(raw));
assert.equal(ok.status, "ok", ok.issues.join("; "));

const rows = labelsToRows([{ fileName: "a.jpg", label: ok.label, status: ok.status }], new Date("2026-08-01T10:00:00Z"));
assert.equal(rows.length, 4);
assert.equal(rows[1][8], "152");
assert.equal(rows[1][9], 18);
assert.equal(rows[0].length, HEADERS.length + 1);

// takrorlash himoyasi
const first = mergeRows([], rows);
assert.equal(first.added, 4);
const second = mergeRows(first.rows, rows);
assert.equal(second.added, 0);
assert.equal(second.skipped, 4);

// yig'indi xatosi aniqlanadi
const bad = structuredClone(raw);
bad.colors[0].sizes[1].kol_vo = 8;
const v = validateLabel(normalizeLabel(bad));
assert.equal(v.status, "review");
assert.ok(v.issues.some((m) => m.includes("≠")));

// vergulli o'nlik, noto'g'ri sana
const d = validateLabel(normalizeLabel({ ...raw, ves_brutto: "6,6", data_upakovki: "2026-02-31" }));
assert.equal(d.label.ves_brutto, 6.6);
assert.ok(d.issues.some((m) => m.includes("Sana")));

// bo'sh shablon
assert.equal(validateLabel(normalizeLabel({ is_blank_template: true })).status, "skipped");

// ```json bilan o'ralgan javob
assert.deepEqual(parseJson('```json\n{"labels": []}\n```'), { labels: [] });

console.log("Hammasi o'tdi ✓");
