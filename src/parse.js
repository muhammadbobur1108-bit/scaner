// OCR qatorlarini yorliq maydonlariga ajratadi. Brauzerga bog'liq emas (Node'da sinash mumkin).

const LOOK = { A: "а", B: "в", C: "с", E: "е", H: "н", K: "к", M: "м", O: "о", P: "р", T: "т", X: "х", a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у" };
const cyr = (s) => s.replace(/[ABCEHKMOPTXaceopxy]/g, (ch) => LOOK[ch]).toLowerCase();
const clean = (s) => String(s ?? "").replace(/\\\//g, "V").replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();
const orNull = (s) => (s && s.length ? s : null);

const KEYS = [
  ["obshchee", /общ/],
  ["tara", /тар[ыиа]/],
  ["zakaz", /заказ/],
  ["naim", /наимен/],
  ["artikul", /артик/],
  ["cvet", /^\W*цвет/],
  ["razmer", /размер|азмер/],
  ["kolvo", /кол\W?\s?во|кол-/],
  ["brutto", /вес\s*бр|брутт|рутто|брупо/],
  ["netto", /вес\s*не|нетто|несто|нето/],
  ["data", /дата|упаков/],
  ["strana", /страна|происх/],
  ["punkt", /пункт|назнач/],
  ["sert", /^\W*тр\s*тс|017\/2011/],
];

export function emptyLabel() {
  return {
    tara_no: null, zakaz: null, naimenovanie: null, artikul: null, model_kod: null, obshchee_kol_vo: null,
    colors: [], ves_brutto: null, ves_netto: null, data_upakovki: null, strana: null, punkt_naznacheniya: null,
    sertifikat: null, is_blank_template: false, uncertain_fields: [],
  };
}

// ---- O'lcham va sonlar ----
export function parseSizes(text) {
  return String(text ?? "")
    .split(/[+,;\s]+/)
    .map((t) => t.replace(/[^0-9A-Za-zА-Яа-я/.\-]/g, ""))
    .filter(Boolean);
}

export function parseQty(text) {
  const [left, right] = String(text ?? "").split("=");
  const nums = (left.match(/\d+/g) ?? []).map(Number);
  let total = right !== undefined ? (right.match(/\d+/) ? Number(right.match(/\d+/)[0]) : null) : null;
  // "=" o'qilmay qolgan bo'lsa: oxirgi son qolganlarning yig'indisiga teng bo'lsa, u jami
  if (right === undefined && nums.length > 2) {
    const sum = nums.slice(0, -1).reduce((a, b) => a + b, 0);
    if (nums[nums.length - 1] === sum) { total = nums.pop(); }
  }
  return { nums, total };
}

export function buildColor(cvet, sizesText, qtyText, pos = null) {
  const tokens = parseSizes(sizesText);
  const { nums, total } = parseQty(qtyText);
  const n = Math.max(tokens.length, nums.length);
  const sizes = Array.from({ length: n }, (_, i) => ({ razmer: tokens[i] ?? "", kol_vo: nums[i] ?? null }));
  const allKnown = sizes.length > 0 && sizes.every((s) => s.kol_vo !== null);
  const kol_vo_total = total ?? (allKnown ? sizes.reduce((a, s) => a + s.kol_vo, 0) : null);
  return { pos, cvet: orNull(clean(cvet)), sizes, kol_vo_total };
}

export const sizesToText = (c) => c.sizes.map((s) => s.razmer).join(" + ");
export const qtyToText = (c) => c.sizes.map((s) => s.kol_vo ?? "").join(" + ") + (c.kol_vo_total !== null ? ` = ${c.kol_vo_total}` : "");

// ---- Qatorlarni jadval satrlariga guruhlash ----
function groupRows(lines) {
  const items = lines
    .filter((l) => l.text && l.bbox)
    .map((l) => ({ text: l.text, bbox: l.bbox, x0: l.bbox.x0, cy: (l.bbox.y0 + l.bbox.y1) / 2, h: Math.max(1, l.bbox.y1 - l.bbox.y0) }))
    .sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.cy - row.cy) <= Math.max(row.h, it.h) * 0.6) {
      row.items.push(it);
      row.cy = row.items.reduce((a, b) => a + b.cy, 0) / row.items.length;
      row.h = Math.max(row.h, it.h);
    } else rows.push({ items: [it], cy: it.cy, h: it.h });
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x0 - b.x0));
  return rows;
}

export function findModelCode(text) {
  const m = String(text).match(/[A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}-\d{3,5}\/\d{2,4}-[A-Z.]{2,14}/);
  return m ? m[0] : null;
}

const toIsoDate = (s) => {
  const m = String(s).match(/(\d{2})[.,](\d{2})[.,](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const num = (s) => {
  const m = String(s).match(/\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
};

const union = (items) => ({
  x0: Math.min(...items.map((i) => i.bbox.x0)), y0: Math.min(...items.map((i) => i.bbox.y0)),
  x1: Math.max(...items.map((i) => i.bbox.x1)), y1: Math.max(...items.map((i) => i.bbox.y1)),
});

export const parseLines = (lines) => parseLinesDetailed(lines).label;

// label + trace: qaysi maydon rasmning qaysi qismidan o'qilgani (Lens kabi ko'rsatish uchun)
export function parseLinesDetailed(lines) {
  const trace = [];
  const label = emptyLabel();
  const rows = groupRows(lines);
  const allText = lines.map((l) => l.text).join("\n");
  let cur = null;
  const blocks = [];
  const block = () => cur ?? (cur = blocks[blocks.push({ cvet: "", sz: "", qty: "" }) - 1]);

  for (const row of rows) {
    let ki = -1, key = null;
    for (let i = 0; i < row.items.length && key === null; i++) {
      const t = cyr(row.items[i].text);
      for (const [k, re] of KEYS) if (re.test(t)) { key = k; ki = i; break; }
    }
    if (key === null) continue;
    const keyText = row.items[ki].text;
    const value = clean(row.items.slice(ki + 1).map((i) => i.text).join(" "));
    const valItems = row.items.slice(ki + (key === "sert" ? 0 : 1));
    trace.push({ field: key, bbox: union(valItems.length ? valItems : [row.items[ki]]) });

    switch (key) {
      case "tara": label.tara_no = orNull(value); break;
      case "zakaz": {
        const m = value.match(/([A-Z]{2,5})\s*-\s*(\d+(?:\s*\.\s*\d+)*)/);
        label.zakaz = m ? `${m[1]}-${m[2].replace(/\s+/g, "")}` : orNull(value);
        break;
      }
      case "naim": label.naimenovanie = orNull(value); break;
      case "artikul": label.artikul = value.match(/\d{4,}/)?.[0] ?? orNull(value.replace(/\s+/g, "")); break;
      case "obshchee": label.obshchee_kol_vo = value ? num(value) : null; break;
      case "cvet": cur = null; block().cvet = value; break;
      case "razmer": block().sz = value; break;
      case "kolvo": block().qty = value; break;
      case "brutto": label.ves_brutto = value ? num(value) : null; break;
      case "netto": label.ves_netto = value ? num(value) : null; break;
      case "data": label.data_upakovki = toIsoDate(value || keyText); break;
      case "strana": label.strana = orNull(value) ?? orNull(clean(keyText.match(/(ООО.*|["“]?Chust.*)/)?.[0] ?? "")); break;
      case "punkt": label.punkt_naznacheniya = orNull(value); break;
      case "sert": label.sertifikat = orNull(clean(row.items.slice(ki).map((i) => i.text).join(" "))); break;
    }
  }

  if (!label.zakaz) {
    const m = allText.match(/([A-Z]{2,5})-(\d+(?:\.\d+)+|\d{3,})/);
    if (m) label.zakaz = m[0];
  }
  label.model_kod = findModelCode(allText);

  label.colors = blocks
    .filter((b) => b.cvet || b.sz || b.qty)
    .map((b, i) => buildColor(b.cvet, b.sz, b.qty, i + 1));

  label.is_blank_template = !(label.tara_no || label.zakaz || label.artikul || label.naimenovanie || label.colors.length);
  return { label, trace };
}

// Natija qanchalik to'liq o'qilganini baholaydi (ikki urinishdan yaxshisini tanlash uchun)
export function scoreLabel(l) {
  let s = 0;
  for (const k of ["tara_no", "zakaz", "naimenovanie", "artikul", "data_upakovki"]) if (l[k]) s++;
  if (l.colors.some((c) => c.cvet)) s++;
  if (l.colors.some((c) => c.sizes.length && c.sizes.every((z) => z.kol_vo !== null))) s++;
  return s;
}
