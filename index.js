const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

console.log("Starting KVK Bot...");
console.log("TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "SET" : "NOT SET");
console.log("TWILIO_AUTH_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "SET" : "NOT SET");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");

const SANDBOX_NUMBER = "whatsapp:+14155238886";

const PROMPT = "You are a crop disease specialist for Tamil Nadu KVK. Analyse the crop image and respond ONLY in raw JSON with these fields: disease, severity (Early/Moderate/Severe), affected_part, likely_cause (Fungal/Bacterial/Viral/Pest), root_cause, chemical_treatment, chemical_cost, organic_treatment, organic_cost, prevention, tamil_disease, tamil_solution, tamil_prevention, tamil_warning. No markdown, no code fences, just raw JSON.";

function trim(str, n) {
  if (!str) return "";
  return str.length > n ? str.substring(0, n) + "..." : str;
}

app.get("/", function(req, res) {
  res.send("KVK Crop Bot is running");
});

app.post("/webhook", function(req, res) {
  console.log("Webhook hit");
  res.set("Content-Type", "text/xml");
  res.send("<Response></Response>");
  processMessage(req.body);
});

function processMessage(body) {
  var from = body.From;
  var mediaUrl = body.MediaUrl0;
  var mediaType = body.MediaContentType0 || "image/jpeg";
  var sid = process.env.TWILIO_ACCOUNT_SID;
  var token = process.env.TWILIO_AUTH_TOKEN;
  var geminiKey = process.env.GEMINI_API_KEY;

  console.log("From:", from);
  console.log("Media:", mediaUrl || "none");

  var client = twilio(sid, token);

  function send(text) {
    return client.messages.create({
      from: SANDBOX_NUMBER,
      to: from,
      body: text
    });
  }

  if (!mediaUrl) {
    send("Hello! Please send a photo of your diseased crop. பயிர் நோய் படத்தை அனுப்பவும்.");
    return;
  }

  send("Analysing your crop image... please wait 20-30 seconds.")
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

      console.log("Calling Gemini...");
      return axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiKey,
        {
          contents: [{
            parts: [
              { inline_data: { mime_type: mime, data: b64 } },
              { text: PROMPT }
            ]
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        },
        { timeout: 55000 }
      );
    })
    .then(function(geminiResp) {
      console.log("Gemini responded");
      var raw = "";
      try {
        raw = geminiResp.data.candidates[0].content.parts[0].text;
      } catch(e) {
        console.error("Parse error:", e.message);
      }
      console.log("Raw:", raw.substring(0, 100));
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(cleaned);

      var msg1 = "🌾 " + trim(result.disease,30) + " | " + result.severity + "\n" + result.affected_part + " | " + result.likely_cause + "\n" + trim(result.root_cause, 80);
      var msg2 = "🧪 " + trim(result.chemical_treatment, 80) + " (~" + trim(result.chemical_cost,20) + ")\n🌿 " + trim(result.organic_treatment, 80) + " (~" + trim(result.organic_cost,20) + ")\n🛡 " + trim(result.prevention, 80);
      var msg3 = "நோய்: " + trim(result.tamil_disease,40) + "\nதீர்வு: " + trim(result.tamil_solution,80) + "\nபருவம்: " + trim(result.tamil_prevention,80) + "\n⚠️ " + trim(result.tamil_warning,80);

      return send(msg1)
        .then(function() { return new Promise(function(r) { setTimeout(r, 800); }); })
        .then(function() { return send(msg2); })
        .then(function() { return new Promise(function(r) { setTimeout(r, 800); }); })
        .then(function() { return send(msg3); });
    })
    .catch(function(err) {
      console.error("Error:", err.message);
      if (err.response) console.error("Response:", JSON.stringify(err.response.data));
      send("Analysis failed. Please send a clearer photo and try again.");
    });
}

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() {
  console.log("Bot running on port " + PORT);
});
