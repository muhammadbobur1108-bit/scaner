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

    function capture() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const s = Math.min(1, 2200 / Math.max(vw, vh));
      const c = document.createElement("canvas");
      c.width = Math.round(vw * s);
      c.height = Math.round(vh * s);
      c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
      const b64 = c.toDataURL("image/jpeg", 0.9).split(",")[1];
      count++;
      onShot(b64, "image/jpeg", count);
      tracker.disarm();
      doneBtn.textContent = `Tayyor (${count})`;
      flash.classList.add("on");
      setTimeout(() => flash.classList.remove("on"), 150);
      navigator.vibrate?.(60);
      msgUntil = performance.now() + 2000;
      setStatus(`✓ Suratga olindi (${count}). Keyingi yorliqni tuting`);
    }

    const timer = setInterval(() => {
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
