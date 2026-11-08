import { frameStats, SteadyTracker } from "./steady.js";

// Ilova ichidagi jonli kamera (Lens'ga o'xshash): yorliqni ramkaga tutsangiz, qimirlamay tursa o'zi suratga oladi.
// getUserMedia ishlamasa (ruxsat yo'q va h.k.) xato tashlaydi — chaqiruvchi oddiy kameraga o'tadi.
export async function openLiveCamera(onShot) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });

  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "live";
    el.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="guide"></div>
      <div class="liveflash"></div>
      <div class="livetop">
        <button class="livebtn" data-x="close">✕ Yopish</button>
        <label class="livebtn"><input type="checkbox" data-x="auto" checked> Avto</label>
      </div>
      <div class="livestatus"></div>
      <div class="livebar"><div></div></div>
      <div class="livebottom">
        <span></span>
        <button class="shutter" data-x="shot" aria-label="Suratga olish"></button>
        <button class="livebtn done" data-x="done">Tayyor (0)</button>
      </div>`;
    document.body.appendChild(el);

    const video = el.querySelector("video");
    const status = el.querySelector(".livestatus");
    const bar = el.querySelector(".livebar div");
    const flash = el.querySelector(".liveflash");
    const doneBtn = el.querySelector('[data-x="done"]');
    const autoBox = el.querySelector('[data-x="auto"]');
    video.srcObject = stream;
    video.play().catch(() => {});

    const W = 128, H = 96;
    const small = document.createElement("canvas");
    small.width = W; small.height = H;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    const tracker = new SteadyTracker();
    let prev = null, count = 0, last = performance.now(), msgUntil = 0;

    const setStatus = (t) => { status.textContent = t; };

    const track = stream.getVideoTracks()[0];
    const ic = typeof ImageCapture !== "undefined" ? new ImageCapture(track) : null;
    let capturing = false;
    const blobToB64 = (blob) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => rej(new Error("Rasmni o'qib bo'lmadi"));
      r.readAsDataURL(blob);
    });

    // Asl rasm: iloji bo'lsa kameraning to'liq o'lchamli fotosi, bo'lmasa videokadr (hech qanday kichraytirish/qirqishsiz)
    async function capture() {
      if (capturing) return;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      capturing = true;
      tracker.disarm();
      setStatus("Suratga olinmoqda...");
      flash.classList.add("on");
      setTimeout(() => flash.classList.remove("on"), 150);
      navigator.vibrate?.(60);
      try {
        let blob = null;
        if (ic) { try { blob = await ic.takePhoto(); } catch { blob = null; } }
        if (!blob) {
          const c = document.createElement("canvas");
          c.width = vw; c.height = vh;
          c.getContext("2d").drawImage(video, 0, 0);
          blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
        }
        const b64 = await blobToB64(blob);
        count++;
        onShot({ b64, mime: blob.type || "image/jpeg", count });
        doneBtn.textContent = `Tayyor (${count})`;
        msgUntil = performance.now() + 2500;
        setStatus(`✓ Suratga olindi (${count}), fonda o'qilmoqda. Keyingi yorliqni tuting`);
      } catch (e) {
        setStatus("Suratga olib bo'lmadi: " + (e.message || e));
      } finally {
        capturing = false;
      }
    }

    const timer = setInterval(() => {
      if (capturing) return;
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (!video.videoWidth) return;
      sctx.drawImage(video, 0, 0, W, H);
      const rgba = sctx.getImageData(0, 0, W, H).data;
      const gray = new Uint8Array(W * H);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) gray[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      const stats = frameStats(prev, gray, W, H);
      prev = gray;
      if (!autoBox.checked) { bar.style.width = "0"; if (now > msgUntil) setStatus("Yorliqni ramkaga tuting va tugmani bosing"); return; }
      const r = tracker.update(stats, dt);
      bar.style.width = `${Math.round(r.progress * 100)}%`;
      if (r.action === "capture") capture();
      else if (now > msgUntil) setStatus(r.progress > 0 ? "Ushlab turing..." : r.armed ? "Yorliqni ramkaga tuting" : "Keyingi yorliqqa o'ting");
    }, 250);

    function finish() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      el.remove();
      resolve(count);
    }

    el.addEventListener("click", (e) => {
      const x = e.target.closest("[data-x]")?.dataset.x;
      if (x === "shot") capture();
      else if (x === "done" || x === "close") finish();
    });
  });
}
