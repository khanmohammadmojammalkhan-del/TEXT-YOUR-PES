// Vercel serverless function: /api/read-result
// Env vars (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY  = তোমার Gemini API key
//   AI_ADMIN_TOKEN  = নিজের বানানো একটা গোপন token (admin panel-এ একবার বসাবে)
//   GEMINI_MODEL    = (ঐচ্ছিক) default: gemini-2.5-flash
const crypto = require("crypto");

function safeEq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const num = v => (Number.isInteger(v) && v >= 0 && v <= 99 ? v : null);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { token, text, images = [], bouts } = req.body || {};
    if (!process.env.AI_ADMIN_TOKEN || !safeEq(token, process.env.AI_ADMIN_TOKEN))
      return res.status(401).json({ error: "Unauthorized" });
    if (!Array.isArray(images) || images.length > 4)
      return res.status(400).json({ error: "ছবি সর্বোচ্চ ৪টা" });
    const listText = String(text || "").slice(0, 8000);
    if (!listText.trim() && !images.length)
      return res.status(400).json({ error: "list text দাও" });
    if (!Array.isArray(bouts) || !bouts.length || bouts.length > 12)
      return res.status(400).json({ error: "bouts ঠিক নেই" });
    if (images.reduce((s, d) => s + String(d).length, 0) > 4_000_000)
      return res.status(413).json({ error: "ছবি অনেক বড়" });

    const list = bouts.map(b => `${b.n}. ${b.p1} (home) vs ${b.p2} (away)`).join("\n");
    const prompt =
`You help a football-game tournament admin fill match scores.
Expected bouts of the CURRENTLY OPEN matchup (home player vs away player):
${list}

The admin pasted a RESULT LIST for a whole matchday (it may contain many other matchups too). Text:
"""
${listText}
"""

Rules:
- Use ONLY lines that belong to the expected bouts above; ignore every other matchup/line. Match by PLAYER NAME (spelling may differ slightly, e.g. nickname, extra emoji, Bangla/English mix).
- A score may appear as "Name (3) vs Name (1)", "Name 3 - 1 Name", "3-1", with emoji digits (1️⃣) or Bangla digits (৩). Convert to integers.
- "home" = goals of the home player, "away" = goals of the away player. If the list shows the two names in swapped order, still assign by name.
- Empty brackets "( )" or a missing score means NOT PLAYED: set home and away to null. Never guess.
- "p1"/"p2" = names as written in the list for home/away player. "sure" = false if the name match is doubtful or the line is ambiguous.
Return JSON only.`;

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...images.map(d => ({ inline_data: { mime_type: "image/jpeg", data: d } }))] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                bouts: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      n: { type: "INTEGER" },
                      home: { type: "INTEGER", nullable: true },
                      away: { type: "INTEGER", nullable: true },
                      p1: { type: "STRING" },
                      p2: { type: "STRING" },
                      sure: { type: "BOOLEAN" }
                    },
                    required: ["n", "home", "away", "p1", "p2", "sure"]
                  }
                }
              },
              required: ["bouts"]
            }
          }
        })
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || "Gemini error" });

    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(txt);
    const valid = new Set(bouts.map(b => b.n));
    const out = (parsed.bouts || [])
      .filter(x => valid.has(x.n))
      .map(x => ({ n: x.n, home: num(x.home), away: num(x.away), p1: String(x.p1 || ""), p2: String(x.p2 || ""), sure: x.sure !== false }));
    return res.status(200).json({ bouts: out });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports.config = { api: { bodyParser: { sizeLimit: "5mb" } } };
