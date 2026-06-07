const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886";

const SYSTEM_PROMPT = `You are a Crop Disease Specialist for Tamil Nadu KVK – Salem, Mettur, and Attur regions.

CROP DISEASE KNOWLEDGE:
- Paddy: blast, sheath blight, brown spot, tungro virus, stem borer
- Turmeric: leaf blotch, rhizome rot, leaf spot, thrips infestation
- Tapioca: mosaic virus, bacterial blight, mealybug, whitefly

DISTRICT CONTEXT:
- Salem: humid red soil, high blast risk in kharif
- Mettur: irrigation zones, sheath blight common
- Attur: alluvial, mosaic virus from whitefly in dry spells

Analyse the crop image and respond ONLY in this JSON format (no markdown, no code fences, raw JSON only):
{
  "disease": "Disease name",
  "severity": "Early | Moderate | Severe",
  "affected_part": "Leaf / Stem / Root etc",
  "likely_cause": "Fungal | Bacterial | Viral | Pest",
  "root_cause": "Plain explanation of what causes this",
  "chemical_treatment": "Product name with safe dose per acre",
  "chemical_cost": "Approx INR per acre",
  "organic_treatment": "Organic method with application details",
  "organic_cost": "Approx INR per acre",
  "prevention": "3 short prevention tips for next season",
  "tamil_disease": "நோய் பெயர்",
  "tamil_solution": "தீர்வு in simple Tamil",
  "tamil_prevention": "அடுத்த பருவம் தடுக்கும் வழி",
  "tamil_warning": "எச்சரிக்கை"
}`;

function formatReply(r) {
  return `🌾 *KVK Crop Disease Report*
📍 நோய்: ${r.tamil_disease} (${r.disease})
⚠️ தீவிரம்: ${r.severity} | ${r.affected_part} | ${r.likely_cause}

🔍 *காரணம்:*
${r.root_cause}

🧪 *Chemical Treatment:*
${r.chemical_treatment}
💰 ~${r.chemical_cost}/acre

🌿 *Organic Alternative:*
${r.organic_treatment}
💰 ~${r.organic_cost}/acre

🛡️ *Prevention (Next Season):*
${r.prevention}

─────────────────
🗣️ *விவசாயி ஆலோசனை*
தீர்வு: ${r.tamil_solution}
அடுத்த பருவம்: ${r.tamil_prevention}
⚠️ எச்சரிக்கை: ${r.tamil_warning}
─────────────────
_KVK Salem · Mettur · Attur_`;
}

app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0 || "image/jpeg";

  const sid   = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const geminiKey = process.env.GEMINI_API_KEY || "";

  console.log("WEBHOOK - SID:", sid ? sid.substring(0,6) : "EMPTY");
  console.log("GEMINI_API_KEY:", geminiKey ? "SET" : "NOT SET");

  // Respond immediately to Twilio
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  if (!sid || !token) {
    console.error("Missing Twilio credentials");
    return;
  }

  const client = twilio(sid, token);

  const sendMsg = async (text) => {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: text
    });
  };

  if (!mediaUrl) {
    await sendMsg("🌾 வணக்கம்! பயிர் நோய் படத்தை அனுப்பவும்.\n\nHello! Please send a photo of your diseased crop for analysis.");
    return;
  }

  try {
    await sendMsg("🔍 உங்கள் படம் பகுப்பாய்வு செய்யப்படுகிறது... சிறிது நேரம் காத்திருங்கள்.\n\nAnalysing your crop image, please wait...");

    console.log("Downloading image from Twilio...");
    const imgResp = await axios.get(mediaUrl, {
      auth: { username: sid, password: token },
      responseType: "arraybuffer",
      timeout: 30000
    });

    const b64 = Buffer.from(imgResp.data).toString("base64");
    const detectedType = imgResp.headers["content-type"] || mediaType;
    console.log("Image downloaded, type:", detectedType, "size:", imgResp.data.byteLength);

    console.log("Calling Gemini API...");
    const geminiResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          parts: [
            { inline_data: { mime_type: detectedType, data: b64 } },
            { text: "Analyse this crop image for disease. Respond in JSON only." }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      },
      { timeout: 60000 }
    );

    console.log("Gemini responded");
    const raw = geminiResp.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Raw response:", raw.substring(0, 200));

    const cleaned = raw.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleaned);

    if (result.error) {
      await sendMsg("❌ " + result.error);
    } else {
      await sendMsg(formatReply(result));
    }

  } catch (err) {
    console.error("FULL ERROR:", JSON.stringify(err?.response?.data || err.message));
    const errMsg = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    await sendMsg(`❌ Analysis failed. Error: ${errMsg}`);
  }
});

// Startup env check
console.log("ENV CHECK:");
console.log("TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.substring(0,6) + "..." : "NOT SET");
console.log("TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "SET" : "NOT SET");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");

app.get("/", (req, res) => res.send("KVK Crop Bot is running 🌾"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
