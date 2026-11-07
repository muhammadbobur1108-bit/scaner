// Jadvalda ko'rinadigan ustunlar. Har qatorning oxirida yashirin "kalit" turadi (takrorni aniqlash uchun).
export const HEADERS = [
  "Vaqt", "Fayl", "№ тары", "Номер заказа", "Наименование", "Артикул", "Модель (kod)",
  "Цвет", "Размер", "Кол-во", "Jami (rang)", "Общее кол-во", "Вес брутто", "Вес нетто",
  "Дата упаковки", "Страна", "Пункт назначения", "Holat",
];
export const NUMERIC_COLS = new Set([9, 10, 11, 12, 13]);

// Har bir (rang, o'lcham) uchun alohida qator
export function labelsToRows(items, now = new Date()) {
  const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace("T", " ");
  const rows = [];
  for (const { fileName, label: l, status } of items) {
    const holat = status === "ok" ? "Tayyor" : "Tekshirish kerak";
    const mk = (cvet, razmer, kol, jami) => [
      stamp, fileName, l.tara_no, l.zakaz, l.naimenovanie, l.artikul, l.model_kod,
      cvet, razmer, kol, jami, l.obshchee_kol_vo, l.ves_brutto, l.ves_netto,
      l.data_upakovki, l.strana, l.punkt_naznacheniya, holat,
      [l.tara_no, l.zakaz, l.artikul, cvet, razmer].join("|"),
    ];
    if (l.colors.length === 0) rows.push(mk(null, null, null, null));
    for (const c of l.colors) {
      if (c.sizes.length === 0) rows.push(mk(c.cvet, null, null, c.kol_vo_total));
      for (const z of c.sizes) rows.push(mk(c.cvet, z.razmer, z.kol_vo, c.kol_vo_total));
    }
  }
  return rows;
}

export function mergeRows(existing, incoming) {
  const keys = new Set(existing.map((r) => r[HEADERS.length]));
  const added = [];
  for (const r of incoming) {
    const k = r[HEADERS.length];
    if (keys.has(k)) continue;
    keys.add(k);
    added.push(r);
  }
  return { rows: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}
