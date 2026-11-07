const s = (v) => (v == null || v === "" ? null : String(v));
const n = (v) => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};

export function normalizeLabel(l = {}) {
  return {
    tara_no: s(l.tara_no),
    zakaz: s(l.zakaz),
    naimenovanie: s(l.naimenovanie),
    artikul: s(l.artikul),
    model_kod: s(l.model_kod),
    obshchee_kol_vo: n(l.obshchee_kol_vo),
    colors: (Array.isArray(l.colors) ? l.colors : []).map((c) => ({
      pos: n(c.pos),
      cvet: s(c.cvet),
      sizes: (Array.isArray(c.sizes) ? c.sizes : []).map((z) => ({ razmer: s(z.razmer) ?? "", kol_vo: n(z.kol_vo) })),
      kol_vo_total: n(c.kol_vo_total),
    })),
    ves_brutto: n(l.ves_brutto),
    ves_netto: n(l.ves_netto),
    data_upakovki: s(l.data_upakovki),
    strana: s(l.strana),
    punkt_naznacheniya: s(l.punkt_naznacheniya),
    sertifikat: s(l.sertifikat),
    is_blank_template: !!l.is_blank_template,
    uncertain_fields: Array.isArray(l.uncertain_fields) ? l.uncertain_fields.map(String) : [],
  };
}

// Buyurtma formatiga moslab o'zgartiring (MOS-517.8, MOS-2026.09.1 ...)
export const ZAKAZ_RE = /^[A-Z]{2,5}-\d{1,4}(\.\d+)*$/;

function isRealDate(x) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(x + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

export function validateLabel(label) {
  if (label.is_blank_template) return { label, issues: ["Bo'sh shablon, o'tkazib yuborildi"], status: "skipped" };
  const issues = [];

  if (!label.tara_no) issues.push("№ тары o'qilmadi");
  if (!label.zakaz) issues.push("Номер заказа o'qilmadi");
  else if (!ZAKAZ_RE.test(label.zakaz)) issues.push(`Buyurtma raqami formati g'alati: ${label.zakaz}`);
  if (!label.artikul) issues.push("Артикул o'qilmadi");
  else if (!/^\d+$/.test(label.artikul)) issues.push(`Артикул faqat raqam bo'lishi kerak: ${label.artikul}`);
  if (!label.data_upakovki) issues.push("Дата упаковки o'qilmadi");
  else if (!isRealDate(label.data_upakovki)) issues.push(`Sana noto'g'ri: ${label.data_upakovki}`);
  if (label.colors.length === 0) issues.push("Rang bloklari topilmadi");

  let grand = 0;
  let grandKnown = true;
  for (const c of label.colors) {
    const tag = `Rang${c.pos ? " #" + c.pos : ""}`;
    if (!c.cvet) issues.push(`${tag}: Цвет o'qilmadi`);
    if (c.sizes.length === 0) issues.push(`${tag}: o'lchamlar yo'q`);
    if (c.sizes.some((z) => z.kol_vo === null)) {
      issues.push(`${tag}: o'lcham va son soni mos kelmadi`);
      grandKnown = false;
      continue;
    }
    const sum = c.sizes.reduce((a, z) => a + z.kol_vo, 0);
    if (c.kol_vo_total === null) issues.push(`${tag}: jami son o'qilmadi`);
    else if (sum !== c.kol_vo_total) issues.push(`${tag}: yig'indi ${sum} ≠ jami ${c.kol_vo_total}`);
    grand += c.kol_vo_total ?? sum;
  }
  if (label.obshchee_kol_vo !== null && grandKnown && grand !== label.obshchee_kol_vo) {
    issues.push(`Umumiy son ${label.obshchee_kol_vo} ≠ ranglar yig'indisi ${grand}`);
  }
  if (label.ves_brutto !== null && label.ves_netto !== null && label.ves_netto > label.ves_brutto) {
    issues.push("Netto brutto'dan katta bo'lishi mumkin emas");
  }
  if (label.uncertain_fields.length) issues.push(`Model shubhalangan maydonlar: ${label.uncertain_fields.join(", ")}`);
  return { label, issues, status: issues.length ? "review" : "ok" };
}
