const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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

Analyse the crop image and respond ONLY in this JSON format (no markdown, no code fences):
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

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const client = twilio(sid, token);

  const sendMsg = async (text) => {
    await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: text
    });
  };

  // Respond immediately to Twilio
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  if (!mediaUrl) {
    await sendMsg("🌾 வணக்கம்! பயிர் நோய் படத்தை அனுப்பவும்.\n\nHello! Please send a photo of your diseased crop for analysis.");
    return;
  }

  try {
    await sendMsg("🔍 உங்கள் படம் பகுப்பாய்வு செய்யப்படுகிறது... சிறிது நேரம் காத்திருங்கள்.\n\nAnalysing your crop image, please wait...");

    // Download image from Twilio (needs auth)
    const imgResp = await axios.get(mediaUrl, {
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
      responseType: "arraybuffer"
    });
    const b64 = Buffer.from(imgResp.data).toString("base64");

    // Call Anthropic API
    const aiResp = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: "Analyse this crop image for disease." }
        ]
      }]
    }, {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      }
    });

    const raw = aiResp.data.content?.find(b => b.type === "text")?.text || "";
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
    await sendMsg(`❌ Analysis failed. Error: ${errMsg}\n\nPlease try again.`);
  }
});

app.get("/", (req, res) => res.send("KVK Crop Bot is running 🌾"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
