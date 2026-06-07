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

function truncate(str, n) {
  return str && str.length > n ? str.substring(0, n) + "..." : str;
}

function formatReply(r) {
  const msg1 = `🌾 *KVK நோய் அறிக்கை*
நோய்: ${r.disease} (${r.severity})
பாதிப்பு: ${r.affected_part} | ${r.likely_cause}
காரணம்: ${truncate(r.root_cause, 120)}`;

  const msg2 = `🧪 Chemical: ${truncate(r.chemical_treatment, 120)}
💰 ~${r.chemical_cost}/acre

🌿 Organic: ${truncate(r.organic_treatment, 120)}
💰 ~${r.organic_cost}/acre

🛡️ Prevention: ${truncate(r.prevention, 150)}`;

  const msg3 = `🗣️ Tamil Advisory
நோய்: ${r.tamil_disease}
தீர்வு: ${truncate(r.tamil_solution, 150)}
அடுத்த பருவம்: ${truncate(r.tamil_prevention, 100)}
⚠️ ${truncate(r.tamil_warning, 100)}
_KVK Salem · Mettur · Attur_`;

  return [msg1, msg2, msg3];
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
