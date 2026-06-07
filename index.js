const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

process.on("uncaughtException", function(err) { console.error("Uncaught:", err.message); });
process.on("unhandledRejection", function(err) { console.error("Unhandled:", err); });

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const SANDBOX_NUMBER = "whatsapp:+14155238886";

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur. Analyse the crop image. Reply ONLY in raw JSON (no markdown, no code fences): {\"disease\":\"\",\"severity\":\"Early|Moderate|Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal|Bacterial|Viral|Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

function t(str, max) {
  if (!str) return "-";
  str = String(str);
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

function delay(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function callGemini(b64, mime, geminiKey, retries) {
  console.log("Calling Gemini, retries left:", retries);
  return axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey,
    {
      contents: [{ parts: [
        { inline_data: { mime_type: mime, data: b64 } },
        { text: PROMPT }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
    },
    { timeout: 55000 }
  ).catch(function(err) {
    var status = err.response ? err.response.status : 0;
    console.error("Gemini error status:", status);
    if (status === 429 && retries > 0) {
      console.log("Rate limited. Waiting 35 seconds before retry...");
      return delay(35000).then(function() {
        return callGemini(b64, mime, geminiKey, retries - 1);
      });
    }
    throw err;
  });
}

app.get("/", function(req, res) {
  res.send("KVK Crop Bot running");
});

app.post("/webhook", function(req, res) {
  console.log("Webhook received");
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");

  var from = req.body.From;
  var mediaUrl = req.body.MediaUrl0;
  var mediaType = req.body.MediaContentType0 || "image/jpeg";
  var sid = process.env.TWILIO_ACCOUNT_SID;
  var token = process.env.TWILIO_AUTH_TOKEN;
  var geminiKey = process.env.GEMINI_API_KEY;

  var client = twilio(sid, token);

  function send(text) {
    var safe = text.substring(0, 1500);
    console.log("Sending msg, length:", safe.length);
    return client.messages.create({ from: SANDBOX_NUMBER, to: from, body: safe });
  }

  if (!mediaUrl) {
    send("Hello! Send a photo of your diseased crop.\nபயிர் நோய் படத்தை அனுப்பவும்.");
    return;
  }

  send("Analysing crop... please wait up to 60 seconds.")
    .then(function() {
      return axios.get(mediaUrl, {
        auth: { username: sid, password: token },
        responseType: "arraybuffer",
        timeout: 30000
      });
    })
    .then(function(imgResp) {
      console.log("Image downloaded:", imgResp.data.byteLength, "bytes");
      var b64 = Buffer.from(imgResp.data).toString("base64");
      var mime = imgResp.headers["content-type"] || mediaType;
      return callGemini(b64, mime, geminiKey, 3);
    })
    .then(function(resp) {
      console.log("Gemini success");
      var raw = resp.data.candidates[0].content.parts[0].text || "";
      console.log("Raw:", raw.substring(0, 100));
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(cleaned);

      var msg1 = "KVK Report\nDisease: " + t(result.disease, 40) + "\nSeverity: " + t(result.severity, 20) + "\nPart: " + t(result.affected_part, 30) + "\nCause: " + t(result.likely_cause, 20) + "\nReason: " + t(result.root_cause, 150);
      var msg2 = "Treatment\nChemical: " + t(result.chemical_treatment, 150) + "\nCost: " + t(result.chemical_cost, 30) + "\nOrganic: " + t(result.organic_treatment, 150) + "\nCost: " + t(result.organic_cost, 30) + "\nPrevention: " + t(result.prevention, 150);
      var msg3 = "Tamil Advisory\nNoi: " + t(result.tamil_disease, 50) + "\nTheervу: " + t(result.tamil_solution, 150) + "\nWarning: " + t(result.tamil_warning, 100);

      return send(msg1)
        .then(function() { return delay(1200); })
        .then(function() { return send(msg2); })
        .then(function() { return delay(1200); })
        .then(function() { return send(msg3); });
    })
    .catch(function(err) {
      console.error("Final error:", err.message);
      send("Analysis failed. Please try again in 1 minute.");
    });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() {
  console.log("Bot running on port", PORT);
  console.log("SID:", process.env.TWILIO_ACCOUNT_SID ? "SET" : "MISSING");
  console.log("TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "SET" : "MISSING");
  console.log("GEMINI:", process.env.GEMINI_API_KEY ? "SET" : "MISSING");
});
