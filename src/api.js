import { CapacitorHttp } from "@capacitor/core";
import { PROMPT } from "./prompt.js";
import { normalizeLabel, validateLabel } from "./validate.js";

async function callClaude(settings, { system, content, maxTokens = 2000 }) {
  if (!settings.apiKey) throw new Error("Sozlamalarda API kalitni kiriting");
  const res = await CapacitorHttp.request({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    data: {
      model: settings.model,
      max_tokens: maxTokens,
      temperature: 0,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content }],
    },
    connectTimeout: 30000,
    readTimeout: 120000,
  });
  const body = typeof res.data === "string" ? safeParse(res.data) : res.data;
  if (res.status >= 400) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (body?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

function safeParse(t) {
  try { return JSON.parse(t); } catch { return null; }
}

export function parseJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("JSON topilmadi");
  return JSON.parse(cleaned.slice(a, b + 1));
}

export async function testKey(settings) {
  await callClaude(settings, { content: "ok", maxTokens: 5 });
}

// Bitta rasmdan yorliqlarni o'qiydi. Yig'indi mos kelmasa qayta o'qitadi.
export async function extractLabels(b64, mime, settings) {
  let hint = "";
  let lastErr = "";
  let best = null;
  const MAX = 3;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      const raw = await callClaude(settings, {
        system: PROMPT,
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          {
            type: "text",
            text:
              "Extract the label(s) from this image. Return ONLY the JSON." +
              (hint ? `\n\nYour previous answer had problems: ${hint}. Re-read the image carefully and fix them.` : ""),
          },
        ],
      });
      const data = parseJson(raw);
      if (data.error) return { labels: [], error: data.error };
      if (!Array.isArray(data.labels)) throw new Error("'labels' massivi yo'q");
      const labels = data.labels.map((l) => validateLabel(normalizeLabel(l)));
      best = labels;
      const math = labels.flatMap((l) => l.issues.filter((i) => i.includes("≠")));
      if (math.length && attempt < MAX) {
        hint = math.join("; ");
        continue;
      }
      return { labels };
    } catch (e) {
      lastErr = e.message || String(e);
      hint = lastErr;
      if (e.status === 401 || e.status === 400 || e.status === 403) break;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  if (best) return { labels: best };
  return { labels: [], error: lastErr || "Noma'lum xato" };
}
