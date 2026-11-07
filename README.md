# Yorliq OCR (Android ilova)

Telefonda yorliq rasmini oladi, Claude o'qiydi, natija ilovaning ichidagi jadvalga yoziladi.
Jadvalni Excel (.xlsx) qilib yuborish/saqlash mumkin (Google Sheets'ga ham yuklanadi).

## APK olish (kompyuterga Android Studio kerak emas)

1. github.com'da yangi **private** repo oching.
2. Shu papkadagi hamma narsani (`.github` papkasi bilan) repoga `main` branch'ga yuklang.
   (`git init && git add . && git commit -m init && git branch -M main && git remote add origin <repo> && git push -u origin main`)
3. Repo'da **Actions** → **Build APK**. Push'dan keyin o'zi ishga tushadi (5–10 daqiqa). Kerak bo'lsa **Run workflow** ni bosing.
4. Tugagach, ish ichidagi **Artifacts → yorliq-apk** ni yuklab oling, ZIP ichidan `app-debug.apk` chiqadi.
5. APK'ni telefonga o'tkazing va o'rnating (Sozlamalar'da "noma'lum manbadan o'rnatish"ga ruxsat bering).

## Birinchi ishga tushirish

1. Ilova → **Sozlama** → Anthropic API kalitni kiriting → **Kalitni tekshirish** → **Saqlash**.
2. **Skaner** → Kamera yoki Galereya → **O'qish**.
3. Tekshirib, kerak bo'lsa maydonlarni tuzating → **Jadvalga qo'shish**.
4. **Jadval** → katakni bossangiz tahrirlanadi, ✕ — qatorni o'chiradi, **Excel (.xlsx)** — fayl yuboradi.

## Mahalliy tekshirish

    npm install
    npm test        # o'qish/tekshirish mantig'i testlari
    npm run build
