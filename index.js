const express = require("express");
const axios = require("axios");

process.on("uncaughtException", function(err) { console.error("Uncaught:", err.message); });
process.on("unhandledRejection", function(err) { console.error("Unhandled:", err); });

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const TELEGRAM_API = "https://api.telegram.org/bot" + TOKEN;

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur. Analyse the crop image. Reply ONLY in raw JSON (no markdown, no code fences): {\"disease\":\"\",\"severity\":\"Early|Moderate|Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal|Bacterial|Viral|Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

function t(str, max) {
  if (!str) return "-";
  str = String(str);
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

function delay(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function sendMessage(chatId, text) {
  var safe = text.substring(0, 4000);
  console.log("Sending msg length:", safe.length);
  return axios.post(TELEGRAM_API + "/sendMessage", {
    chat_id: chatId,
    text: safe
  }).catch(function(e) { console.error("Send error:", e.message); });
}

function callGemini(b64, mime, retries) {
  console.log("Calling Gemini, retries left:", retries);
  return axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_KEY,
    {
      contents: [{ parts: [
        { inline_data: { mime_type: mime, data: b64 } },
        { text: PROMPT }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    },
    { timeout: 60000 }
  ).catch(function(err) {
    var status = err.response ? err.response.status : 0;
    console.error("Gemini error:", status, err.message);
    if (status === 429 && retries > 0) {
      console.log("Rate limited. Waiting 60 seconds...");
      return delay(60000).then(function() {
        return callGemini(b64, mime, retries - 1);
      });
    }
    throw err;
  });
}

app.get("/", function(req, res) {
  res.send("KVK Crop Bot running");
});

app.post("/webhook", function(req, res) {
  res.sendStatus(200);
  var msg = req.body.message;
  if (!msg) return;

  var chatId = msg.chat.id;
  var photo = msg.photo;
  var document = msg.document;

  console.log("Message from:", chatId);

  if (!photo && !document) {
    sendMessage(chatId, "Hello! Send a photo of your diseased crop.\nபயிர் நோய் படத்தை அனுப்பவும்.");
    return;
  }

  var fileId, mime;
  if (photo) {
    fileId = photo[photo.length - 1].file_id;
    mime = "image/jpeg";
  } else {
    fileId = document.file_id;
    mime = document.mime_type || "image/jpeg";
  }

  sendMessage(chatId, "Analysing your crop image... please wait up to 60 seconds.\nபகுப்பாய்வு செய்கிறோம்...")
    .then(function() {
      return axios.get(TELEGRAM_API + "/getFile?file_id=" + fileId);
    })
    .then(function(resp) {
      var filePath = resp.data.result.file_path;
      var fileUrl = "https://api.telegram.org/file/bot" + TOKEN + "/" + filePath;
      console.log("Downloading:", fileUrl);
      return axios.get(fileUrl, { responseType: "arraybuffer", timeout: 30000 });
    })
    .then(function(imgResp) {
      console.log("Image downloaded:", imgResp.data.byteLength, "bytes");
      var b64 = Buffer.from(imgResp.data).toString("base64");
      var detectedMime = imgResp.headers["content-type"] || mime;
      return callGemini(b64, detectedMime, 3);
    })
    .then(function(resp) {
      console.log("Gemini success");
      var raw = resp.data.candidates[0].content.parts[0].text || "";
      console.log("Raw:", raw.substring(0, 150));
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(cleaned);

      var msg1 =
        "KVK Crop Disease Report\n" +
        "Disease: " + t(result.disease, 50) + "\n" +
        "Severity: " + t(result.severity, 20) + "\n" +
        "Affected: " + t(result.affected_part, 40) + "\n" +
        "Cause: " + t(result.likely_cause, 20) + "\n\n" +
        "Reason: " + t(result.root_cause, 300);

      var msg2 =
        "Treatment Options\n\n" +
        "Chemical: " + t(result.chemical_treatment, 200) + "\n" +
        "Cost: " + t(result.chemical_cost, 40) + "\n\n" +
        "Organic: " + t(result.organic_treatment, 200) + "\n" +
        "Cost: " + t(result.organic_cost, 40) + "\n\n" +
        "Prevention: " + t(result.prevention, 300);

      var msg3 =
        "Tamil Advisory\n\n" +
        "Noi: " + t(result.tamil_disease, 60) + "\n\n" +
        "Theervу: " + t(result.tamil_solution, 300) + "\n\n" +
        "Adhutha Paruvam: " + t(result.tamil_prevention, 200) + "\n\n" +
        "Echagarikkai: " + t(result.tamil_warning, 200);

      return sendMessage(chatId, msg1)
        .then(function() { return delay(1000); })
        .then(function() { return sendMessage(chatId, msg2); })
        .then(function() { return delay(1000); })
        .then(function() { return sendMessage(chatId, msg3); });
    })
    .catch(function(err) {
      console.error("Final error:", err.message);
      sendMessage(chatId, "Analysis failed. Please send a clearer crop photo and try again.");
    });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() {
  console.log("Bot running on port", PORT);
  console.log("TOKEN:", TOKEN ? "SET" : "MISSING");
  console.log("GEMINI:", GEMINI_KEY ? "SET" : "MISSING");
});
