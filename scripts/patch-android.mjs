// Android manifestiga kamera (jonli kamera) va galereyaga saqlash ruxsatlarini qo'shadi (cap add android'dan keyin ishga tushiriladi).
import fs from "node:fs";

const p = "android/app/src/main/AndroidManifest.xml";
let s = fs.readFileSync(p, "utf8");
const add = [];
if (!s.includes("android.permission.CAMERA")) add.push('    <uses-permission android:name="android.permission.CAMERA" />');
if (!s.includes("android.hardware.camera")) add.push('    <uses-feature android:name="android.hardware.camera" android:required="false" />');
for (const perm of ["READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO"]) {
  if (!s.includes(`android.permission.${perm}`)) add.push(`    <uses-permission android:name="android.permission.${perm}" />`);
}
if (add.length) {
  s = s.replace(/(\s*)<application/, `\n${add.join("\n")}\n$1<application`);
  fs.writeFileSync(p, s);
}
console.log("Manifest yangilandi:", add.length ? "ruxsatlar qo'shildi" : "o'zgarish kerak emas");
