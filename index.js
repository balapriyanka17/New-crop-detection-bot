const express = require("express");
const axios = require("axios");
const twilio = require("twilio");

process.on("uncaughtException", (err) => console.error("Uncaught:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err));

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const SANDBOX_NUMBER = "whatsapp:+14155238886";

// Trim string to max length
function t(str, max) {
  if (!str) return "-";
  str = String(str);
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

// Split long text into chunks under 1500 chars
function safeMessages(result) {
  var msgs = [];

  msgs.push(
    "KVK Crop Report\n" +
    "Disease: " + t(result.disease, 40) + "\n" +
    "Severity: " + t(result.severity, 20) + "\n" +
    "Affected: " + t(result.affected_part, 30) + "\n" +
    "Cause: " + t(result.likely_cause, 20) + "\n" +
    "Reason: " + t(result.root_cause, 200)
  );

  msgs.push(
    "Treatment\n" +
    "Chemical: " + t(result.chemical_treatment, 150) + "\n" +
    "Cost: " + t(result.chemical_cost, 30) + "\n\n" +
    "Organic: " + t(result.organic_treatment, 150) + "\n" +
    "Cost: " + t(result.organic_cost, 30)
  );

  msgs.push(
    "Prevention: " + t(result.prevention, 200)
  );

  msgs.push(
    "Tamil Advisory\n" +
    "Noi: " + t(result.tamil_disease, 50) + "\n" +
    "Theervу: " + t(result.tamil_solution, 150) + "\n" +
    "Warning: " + t(result.tamil_warning, 100)
  );

  return msgs;
}

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur. Analyse the crop image. Reply ONLY in raw JSON (no markdown, no code fences): {\"disease\":\"\",\"severity\":\"Early|Moderate|Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal|Bacterial|Viral|Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

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
    // Hard truncate to 1500 chars just in case
    var safe = text.substring(0, 1500);
    console.log("Sending msg, length:", safe.length);
    return client.messages.create({ from: SANDBOX_NUMBER, to: from, body: safe });
  }

  function delay(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  if (!mediaUrl) {
    send("Hello! Send a photo of your diseased crop for analysis.\nபயிர் நோய் படத்தை அனுப்பவும்.");
    return;
  }

  send("Analysing crop image... please wait 20-30 sec.")
    .then(function() {
      return axios.get(mediaUrl, {
        auth: { username: sid, password: token },
        responseType: "arraybuffer",
        timeout: 30000
      });
    })
    .then(function(imgResp) {
      console.log("Image:", imgResp.data.byteLength, "bytes");
      var b64 = Buffer.from(imgResp.data).toString("base64");
      var mime = imgResp.headers["content-type"] || mediaType;
      console.log("Calling Gemini...");
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
      );
    })
    .then(function(resp) {
      console.log("Gemini done");
      var raw = resp.data.candidates[0].content.parts[0].text || "";
      console.log("Raw:", raw.substring(0, 100));
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(cleaned);
      var msgs = safeMessages(result);

      // Send messages one by one with delay
      return msgs.reduce(function(chain, msg) {
        return chain.then(function() {
          return send(msg).then(function() { return delay(1200); });
        });
      }, Promise.resolve());
    })
    .catch(function(err) {
      console.error("Error:", err.message);
      send("Analysis failed. Please send a clearer crop photo.");
    });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() {
  console.log("Bot running on port", PORT);
  console.log("SID:", process.env.TWILIO_ACCOUNT_SID ? "SET" : "MISSING");
  console.log("TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "SET" : "MISSING");
  console.log("GEMINI:", process.env.GEMINI_API_KEY ? "SET" : "MISSING");
});
