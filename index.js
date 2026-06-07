const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

const TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886";

const PROMPT = `You are a Crop Disease Specialist for Tamil Nadu KVK – Salem, Mettur, and Attur regions.
Crops: Paddy (blast, sheath blight, brown spot, tungro virus, stem borer), Turmeric (leaf blotch, rhizome rot, leaf spot, thrips), Tapioca (mosaic virus, bacterial blight, mealybug, whitefly).
Respond ONLY in raw JSON, no markdown, no code fences:
{"disease":"...","severity":"Early|Moderate|Severe","affected_part":"...","likely_cause":"Fungal|Bacterial|Viral|Pest","root_cause":"...","chemical_treatment":"...","chemical_cost":"INR per acre","organic_treatment":"...","organic_cost":"INR per acre","prevention":"3 tips","tamil_disease":"...","tamil_solution":"...","tamil_prevention":"...","tamil_warning":"..."}`;

function formatReply(r) {
  return `🌾 *KVK Crop Disease Report*
📍 நோய்: ${r.tamil_disease} (${r.disease})
⚠️ தீவிரம்: ${r.severity} | ${r.affected_part} | ${r.likely_cause}

🔍 *காரணம்:* ${r.root_cause}

🧪 *Chemical:* ${r.chemical_treatment}
💰 ~${r.chemical_cost}/acre

🌿 *Organic:* ${r.organic_treatment}
💰 ~${r.organic_cost}/acre

🛡️ *Prevention:* ${r.prevention}

🗣️ *Tamil Advisory*
தீர்வு: ${r.tamil_solution}
அடுத்த பருவம்: ${r.tamil_prevention}
⚠️ எச்சரிக்கை: ${r.tamil_warning}
_KVK Salem · Mettur · Attur_`;
}

app.get("/", (req, res) => {
  console.log("Health check hit");
  res.send("KVK Crop Bot is running 🌾");
});

app.post("/webhook", (req, res) => {
  console.log("Webhook received");
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");
  handleMessage(req.body).catch(e => console.error("Handler error:", e.message));
});

async function handleMessage(body) {
  const from = body.From;
  const mediaUrl = body.MediaUrl0;
  const mediaType = body.MediaContentType0 || "image/jpeg";

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

  console.log("From:", from);
  console.log("MediaUrl:", mediaUrl || "NONE");

  const client = twilio(sid, token);
  const send = (text) => client.messages.create({ from: TWILIO_WHATSAPP_NUMBER, to: from, body: text });

  if (!mediaUrl) {
    await send("🌾 வணக்கம்! பயிர் நோய் படத்தை அனுப்பவும்.\nPlease send a crop disease photo.");
    return;
  }

  await send("🔍 பகுப்பாய்வு செய்கிறோம்... 20 seconds ஆகலாம்.\nAnalysing, please wait...");

  console.log("Downloading image...");
  const imgResp = await axios.get(mediaUrl, {
    auth: { username: sid, password: token },
    responseType: "arraybuffer",
    timeout: 30000
  });
  console.log("Image size:", imgResp.data.byteLength);

  const b64 = Buffer.from(imgResp.data).toString("base64");
  const mimeType = imgResp.headers["content-type"] || mediaType;

  console.log("Calling Gemini...");
  const geminiResp = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      system_instruction: { parts: [{ text: PROMPT }] },
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: b64 } },
        { text: "Analyse this crop disease image. JSON only." }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    },
    { timeout: 55000 }
  );

  console.log("Gemini done");
  const raw = geminiResp.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log("Raw:", raw.substring(0, 150));

  const cleaned = raw.replace(/```json|```/g, "").trim();
  const result = JSON.parse(cleaned);

  if (result.error) {
    await send("❌ " + result.error);
  } else {
    await send(formatReply(result));
  }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
