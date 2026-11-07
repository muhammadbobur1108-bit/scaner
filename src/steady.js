// Jonli kamera: kadr qimirlamay turganini va aniqligini aniqlaydi. Brauzerga bog'liq emas (Node'da sinaladi).

// prev/cur — kulrang piksellar (Uint8Array), w x h. motion: o'rtacha farq; sharp: o'rtacha chekka kuchi.
export function frameStats(prev, cur, w, h) {
  let diff = 0;
  if (prev) for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - prev[i]);
  const motion = prev ? diff / cur.length : 100;
  let edge = 0, n = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      edge += Math.abs(cur[i + 1] - cur[i]) + Math.abs(cur[i + w] - cur[i]);
      n++;
    }
  }
  return { motion, sharp: n ? edge / n : 0 };
}

export class SteadyTracker {
  constructor({ motionT = 5, minSharp = 4, holdMs = 1200, moveT = 14 } = {}) {
    Object.assign(this, { motionT, minSharp, holdMs, moveT });
    this.armed = true;
    this.steady = 0;
    this.maxSharp = 0;
  }
  disarm() { this.armed = false; this.steady = 0; this.maxSharp = 0; }
  update({ motion, sharp }, dtMs) {
    if (!this.armed) {
      // Keyingi yorliqqa o'tilganini (kamera siljiganini) kutamiz — bir yorliq ikki marta olinmasin
      if (motion > this.moveT) { this.armed = true; this.steady = 0; this.maxSharp = 0; }
      return { action: "wait", progress: 0, armed: this.armed };
    }
    if (motion <= this.motionT && sharp >= this.minSharp) {
      this.steady += dtMs;
      this.maxSharp = Math.max(this.maxSharp, sharp);
      if (this.steady >= this.holdMs && sharp >= 0.9 * this.maxSharp) {
        this.disarm();
        return { action: "capture", progress: 1, armed: false };
      }
    } else {
      this.steady = 0;
      this.maxSharp = 0;
    }
    return { action: "wait", progress: Math.min(1, this.steady / this.holdMs), armed: true };
  }
}
