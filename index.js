const axios = require("axios");

process.on("uncaughtException", function(err) { console.error("Uncaught:", err.message); });
process.on("unhandledRejection", function(err) { console.error("Unhandled:", err); });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const TELEGRAM = "https://api.telegram.org/bot" + TOKEN;

console.log("Starting KVK Bot...");
console.log("TOKEN:", TOKEN ? "SET" : "MISSING");
console.log("OPENROUTER:", OPENROUTER_KEY ? "SET" : "MISSING");

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur. Analyse this crop image. Reply ONLY as a raw JSON object with no markdown and no code fences: {\"disease\":\"\",\"severity\":\"Early or Moderate or Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal or Bacterial or Viral or Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

var queue = [];
var processing = false;

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

function callOpenRouter(b64, mime, tries) {
  console.log("Calling OpenRouter, tries left:", tries);
  return axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "google/gemini-2.0-flash-exp:free",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:" + mime + ";base64," + b64 } },
          { type: "text", text: PROMPT }
        ]
      }],
      max_tokens: 1024
    },
    {
      headers: {
        "Authorization": "Bearer " + OPENROUTER_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kvk-crop-bot.railway.app",
        "X-Title": "KVK Crop Bot"
      },
      timeout: 60000
    }
  ).catch(function(err) {
    var code = err.response ? err.response.status : 0;
    var msg = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error("OpenRouter error", code, ":", msg.substring(0, 200));
    if ((code === 429 || code === 503) && tries > 0) {
      console.log("Rate limit. Waiting 30s...");
      return sleep(30000).then(function() { return callOpenRouter(b64, mime, tries - 1); });
    }
    throw new Error("OpenRouter failed: " + code + " " + msg.substring(0, 100));
  });
}

function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;
  var job = queue.shift();
  console.log("Processing for:", job.chatId, "| Queue left:", queue.length);

  axios.get(TELEGRAM + "/getFile?file_id=" + job.fileId)
    .then(function(r) {
      var url = "https://api.telegram.org/file/bot" + TOKEN + "/" + r.data.result.file_path;
      console.log("Downloading:", url);
      return axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    })
    .then(function(imgResp) {
      var mime = imgResp.headers["content-type"] || "image/jpeg";
      if (mime === "application/octet-stream") mime = "image/jpeg";
      var b64 = Buffer.from(imgResp.data).toString("base64");
      console.log("Image ready:", imgResp.data.byteLength, "bytes");
      return callOpenRouter(b64, mime, 3);
    })
    .then(function(resp) {
      var raw = resp.data.choices[0].message.content || "";
      console.log("Response:", raw.substring(0, 200));
      var cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
      var r = JSON.parse(cleaned);

      var m1 =
        "KVK Crop Disease Report\n" +
        "Disease: " + trim(r.disease, 50) + "\n" +
        "Severity: " + trim(r.severity, 20) + "\n" +
        "Affected: " + trim(r.affected_part, 40) + "\n" +
        "Cause: " + trim(r.likely_cause, 20) + "\n\n" +
        "Reason:\n" + trim(r.root_cause, 400);

      var m2 =
        "Treatment\n\n" +
        "Chemical:\n" + trim(r.chemical_treatment, 250) + "\n" +
        "Cost: " + trim(r.chemical_cost, 50) + "\n\n" +
        "Organic:\n" + trim(r.organic_treatment, 250) + "\n" +
        "Cost: " + trim(r.organic_cost, 50) + "\n\n" +
        "Prevention:\n" + trim(r.prevention, 300);

      var m3 =
        "Tamil Advisory\n\n" +
        "Noi: " + trim(r.tamil_disease, 80) + "\n\n" +
        "Theervu:\n" + trim(r.tamil_solution, 350) + "\n\n" +
        "Adhutha Paruvam:\n" + trim(r.tamil_prevention, 250) + "\n\n" +
        "Echagarikkai:\n" + trim(r.tamil_warning, 250);

      return sendMsg(job.chatId, m1)
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(job.chatId, m2); })
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(job.chatId, m3); });
    })
    .catch(function(err) {
      console.error("Job failed:", err.message);
      sendMsg(job.chatId, "Analysis failed: " + err.message.substring(0, 150) + "\n\nPlease try again.");
    })
    .then(function() {
      processing = false;
      processNext();
    });
}

function poll(offset) {
  axios.get(TELEGRAM + "/getUpdates?timeout=30&offset=" + offset)
    .then(function(resp) {
      var updates = resp.data.result || [];
      var next = offset;
      updates.forEach(function(u) {
        next = u.update_id + 1;
        var msg = u.message;
        if (!msg) return;
        var chatId = msg.chat.id;
        if (msg.photo) {
          var fileId = msg.photo[msg.photo.length - 1].file_id;
          queue.push({ chatId: chatId, fileId: fileId });
          console.log("Photo queued from:", chatId);
          sendMsg(chatId, "Photo received! Analysing now...\nபடம் பெறப்பட்டது!");
          processNext();
        } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("image/")) {
          queue.push({ chatId: chatId, fileId: msg.document.file_id });
          sendMsg(chatId, "Photo received! Analysing now...\nபடம் பெறப்பட்டது!");
          processNext();
        } else {
          sendMsg(chatId, "Hello! Send a photo of your diseased crop.\nபயிர் நோய் படத்தை அனுப்பவும்.");
        }
      });
      poll(next);
    })
    .catch(function(e) {
      console.error("Poll error:", e.message);
      setTimeout(function() { poll(offset); }, e.response && e.response.status === 409 ? 15000 : 5000);
    });
}

axios.post(TELEGRAM + "/deleteWebhook?drop_pending_updates=true")
  .then(function() {
    console.log("Webhook deleted. Polling starts in 3s...");
    setTimeout(function() { poll(0); }, 3000);
  })
  .catch(function() {
    setTimeout(function() { poll(0); }, 3000);
  });
