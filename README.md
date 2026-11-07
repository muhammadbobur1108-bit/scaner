# Yorliq OCR (Android ilova) — kalitsiz, internetsiz

Telefonda yorliq rasmini oladi, matnni telefonning o'zida o'qiydi (Tesseract OCR, rus + ingliz),
maydonlarga ajratadi va ilova ichidagi jadvalga yozadi. API kalit va internet kerak emas.
Jadvalni Excel (.xlsx) qilib yuborish mumkin (Google Sheets'da ham ochiladi).

## Ishlatish
1. **Skaner** → **Jonli kamera**: yorliqni ramkaga tuting, qimirlamay tursa o'zi suratga oladi (yoki tugmani bosing). Bir nechta yorliqni ketma-ket oling → **Tayyor** → o'qish o'zi boshlanadi. Jonli kamera ochilmasa, oddiy kamera/Galereya ishlatiladi. (Birinchi o'qish 10–30 soniya ko'proq ketishi mumkin.)
2. Natijani rasm bilan solishtiring. Xato bo'lsa maydonni tuzating (Цвет / Размер / Кол-во qatorlarini yorliqdagidek yozing).
3. **Jadvalga qo'shish**. Yorliq o'qilmasa — **Qo'lda kiritish**.
4. **Jadval** → katakni bossangiz tahrirlanadi → **Excel (.xlsx)**.

## APK yig'ish
GitHub Actions (`.github/workflows/build-apk.yml`) `npm ci`, `npm test`, `npm run build`, `cap add android`, **`node scripts/patch-android.mjs`** (kamera ruxsati), Gradle bilan APK yig'adi.

## Mahalliy
    npm install
    npm test
    npm run build   # OCR fayllarini (public/ocr) avtomatik nusxalaydi
