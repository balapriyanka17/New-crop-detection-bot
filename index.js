const axios = require("axios");

process.on("uncaughtException", function(err) { console.error("Uncaught:", err.message); });
process.on("unhandledRejection", function(err) { console.error("Unhandled:", err); });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const TELEGRAM = "https://api.telegram.org/bot" + TOKEN;

console.log("Starting KVK Bot...");
console.log("TOKEN:", TOKEN ? "SET" : "MISSING");
console.log("GEMINI:", GEMINI_KEY ? "SET" : "MISSING");

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur regions. Analyse this crop image. Reply ONLY in raw JSON, no markdown, no code fences: {\"disease\":\"\",\"severity\":\"Early or Moderate or Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal or Bacterial or Viral or Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

var queue = [];
var processing = false;
var lastGeminiCall = 0;

function trim(str, max) {
  if (!str) return "-";
  str = String(str);
  return str.length > max ? str.substring(0, max - 3) + "..." : str;
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function sendMsg(chatId, text) {
  return axios.post(TELEGRAM + "/sendMessage", {
    chat_id: chatId,
    text: text.substring(0, 4000)
  }).catch(function(e) { console.error("sendMsg error:", e.message); });
}

function getFileUrl(fileId) {
  return axios.get(TELEGRAM + "/getFile?file_id=" + fileId)
    .then(function(r) {
      return "https://api.telegram.org/file/bot" + TOKEN + "/" + r.data.result.file_path;
    });
}

function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  var job = queue.shift();
  console.log("Processing job for:", job.chatId, "Queue remaining:", queue.length);

  // Enforce 65 second gap between Gemini calls
  var now = Date.now();
  var wait = Math.max(0, 90000 - (now - lastGeminiCall));
  if (wait > 0) {
    console.log("Waiting", wait, "ms before Gemini call...");
  }

  sendMsg(job.chatId, "Analysing your crop image... please wait.\nபகுப்பாய்வு செய்கிறோம்...")
    .then(function() { return sleep(wait); })
    .then(function() { return getFileUrl(job.fileId); })
    .then(function(url) {
      console.log("Downloading:", url);
      return axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    })
    .then(function(imgResp) {
      var b64 = Buffer.from(imgResp.data).toString("base64");
      var mime = imgResp.headers["content-type"] || "image/jpeg";
      if (mime === "application/octet-stream") mime = "image/jpeg";
      console.log("Downloaded:", imgResp.data.byteLength, "bytes");
      lastGeminiCall = Date.now();
      return axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=" + GEMINI_KEY,
        {
          contents: [{ parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: PROMPT }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        },
        { timeout: 60000 }
      );
    })
    .then(function(resp) {
      console.log("Gemini success");
      var raw = resp.data.candidates[0].content.parts[0].text || "";
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var r = JSON.parse(cleaned);

      var m1 = "KVK Crop Disease Report\n" +
        "Disease: " + trim(r.disease, 50) + "\n" +
        "Severity: " + trim(r.severity, 20) + "\n" +
        "Affected: " + trim(r.affected_part, 40) + "\n" +
        "Cause: " + trim(r.likely_cause, 20) + "\n\n" +
        "Reason:\n" + trim(r.root_cause, 400);

      var m2 = "Treatment\n\n" +
        "Chemical:\n" + trim(r.chemical_treatment, 250) + "\n" +
        "Cost: " + trim(r.chemical_cost, 50) + "\n\n" +
        "Organic:\n" + trim(r.organic_treatment, 250) + "\n" +
        "Cost: " + trim(r.organic_cost, 50) + "\n\n" +
        "Prevention:\n" + trim(r.prevention, 300);

      var m3 = "Tamil Advisory\n\n" +
        "Noi: " + trim(r.tamil_disease, 80) + "\n\n" +
        "Theervу:\n" + trim(r.tamil_solution, 350) + "\n\n" +
        "Adhutha Paruvam:\n" + trim(r.tamil_prevention, 250) + "\n\n" +
        "Echagarikkai:\n" + trim(r.tamil_warning, 250);

      return sendMsg(job.chatId, m1)
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(job.chatId, m2); })
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(job.chatId, m3); });
    })
    .catch(function(err) {
      console.error("Job error:", err.message);
      sendMsg(job.chatId, "Analysis failed. Please try again in 1 minute.");
    })
    .then(function() {
      processing = false;
      processQueue();
    });
}

axios.post(TELEGRAM + "/deleteWebhook?drop_pending_updates=true")
  .then(function() {
    console.log("Webhook deleted. Starting polling...");
    poll(0);
  })
  .catch(function() { poll(0); });

function poll(offset) {
  axios.get(TELEGRAM + "/getUpdates?timeout=30&offset=" + offset)
    .then(function(resp) {
      var updates = resp.data.result || [];
      var nextOffset = offset;

      updates.forEach(function(update) {
        nextOffset = update.update_id + 1;
        var msg = update.message;
        if (!msg) return;
        var chatId = msg.chat.id;

        if (msg.photo) {
          var fileId = msg.photo[msg.photo.length - 1].file_id;
          queue.push({ chatId: chatId, fileId: fileId });
          console.log("Queued photo from:", chatId, "Queue size:", queue.length);
          sendMsg(chatId, "Photo received! Position in queue: " + queue.length + "\nபடம் பெறப்பட்டது!");
          processQueue();
        } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("image/")) {
          queue.push({ chatId: chatId, fileId: msg.document.file_id });
          processQueue();
        } else {
          sendMsg(chatId, "Hello! Send a photo of your diseased crop.\nபயிர் நோய் படத்தை அனுப்பவும்.");
        }
      });

      poll(nextOffset);
    })
    .catch(function(e) {
      console.error("Poll error:", e.message);
      setTimeout(function() { poll(offset); }, 5000);
    });
}
