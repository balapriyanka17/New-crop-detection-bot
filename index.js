const axios = require("axios");

process.on("uncaughtException", function(err) { console.error("Uncaught:", err.message); });
process.on("unhandledRejection", function(err) { console.error("Unhandled:", err); });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const TELEGRAM = "https://api.telegram.org/bot" + TOKEN;

console.log("Starting KVK Bot...");
console.log("TOKEN:", TOKEN ? "SET" : "MISSING");
console.log("GEMINI:", GEMINI_KEY ? "SET" : "MISSING");

const PROMPT = "You are a crop disease expert for Tamil Nadu KVK Salem/Mettur/Attur regions. Analyse this crop image carefully. Reply ONLY in raw JSON with no markdown, no code fences, just the JSON object: {\"disease\":\"\",\"severity\":\"Early or Moderate or Severe\",\"affected_part\":\"\",\"likely_cause\":\"Fungal or Bacterial or Viral or Pest\",\"root_cause\":\"\",\"chemical_treatment\":\"\",\"chemical_cost\":\"\",\"organic_treatment\":\"\",\"organic_cost\":\"\",\"prevention\":\"\",\"tamil_disease\":\"\",\"tamil_solution\":\"\",\"tamil_prevention\":\"\",\"tamil_warning\":\"\"}";

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
  }).then(function() {
    console.log("Sent to", chatId);
  }).catch(function(e) {
    console.error("sendMsg error:", e.message);
  });
}

function getFile(fileId) {
  return axios.get(TELEGRAM + "/getFile?file_id=" + fileId)
    .then(function(r) {
      return "https://api.telegram.org/file/bot" + TOKEN + "/" + r.data.result.file_path;
    });
}

function downloadImage(url) {
  return axios.get(url, { responseType: "arraybuffer", timeout: 30000 })
    .then(function(r) {
      return {
        b64: Buffer.from(r.data).toString("base64"),
        mime: r.headers["content-type"] || "image/jpeg",
        size: r.data.byteLength
      };
    });
}

function callGemini(b64, mime, tries) {
  console.log("Gemini call, tries left:", tries);
  return axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_KEY,
    {
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: b64 } },
          { text: PROMPT }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    },
    { timeout: 60000 }
  ).catch(function(err) {
    var code = err.response ? err.response.status : 0;
    console.error("Gemini error code:", code, err.message);
    if (code === 429 && tries > 0) {
      console.log("Rate limit hit. Waiting 60s...");
      return sleep(60000).then(function() { return callGemini(b64, mime, tries - 1); });
    }
    if (tries > 0) {
      console.log("Retrying in 10s...");
      return sleep(10000).then(function() { return callGemini(b64, mime, tries - 1); });
    }
    throw err;
  });
}

function handlePhoto(chatId, fileId) {
  sendMsg(chatId, "Analysing your crop image... please wait up to 60 seconds.\nபகுப்பாய்வு செய்கிறோம்...")
    .then(function() { return getFile(fileId); })
    .then(function(url) {
      console.log("Downloading:", url);
      return downloadImage(url);
    })
    .then(function(img) {
      console.log("Downloaded:", img.size, "bytes, mime:", img.mime);
      return callGemini(img.b64, img.mime, 3);
    })
    .then(function(resp) {
      console.log("Gemini done");
      var raw = resp.data.candidates[0].content.parts[0].text || "";
      console.log("Raw response:", raw.substring(0, 200));
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
        "Next Season Prevention:\n" + trim(r.prevention, 300);

      var m3 = "Tamil Advisory\n\n" +
        "Noi: " + trim(r.tamil_disease, 80) + "\n\n" +
        "Theervу:\n" + trim(r.tamil_solution, 350) + "\n\n" +
        "Adhutha Paruvam:\n" + trim(r.tamil_prevention, 250) + "\n\n" +
        "Echagarikkai:\n" + trim(r.tamil_warning, 250);

      return sendMsg(chatId, m1)
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(chatId, m2); })
        .then(function() { return sleep(1000); })
        .then(function() { return sendMsg(chatId, m3); });
    })
    .catch(function(err) {
      console.error("handlePhoto error:", err.message);
      sendMsg(chatId, "Analysis failed. Error: " + err.message + "\nPlease try again.");
    });
}

// Delete any existing webhook before polling
axios.post(TELEGRAM + "/deleteWebhook")
  .then(function() {
    console.log("Webhook deleted. Starting polling...");
    poll(0);
  })
  .catch(function(e) {
    console.error("deleteWebhook error:", e.message);
    poll(0);
  });

function poll(offset) {
  console.log("Polling with offset:", offset);
  axios.get(TELEGRAM + "/getUpdates?timeout=30&offset=" + offset)
    .then(function(resp) {
      var updates = resp.data.result || [];
      console.log("Updates received:", updates.length);
      var nextOffset = offset;

      updates.forEach(function(update) {
        nextOffset = update.update_id + 1;
        var msg = update.message;
        if (!msg) return;

        var chatId = msg.chat.id;
        console.log("Update from:", chatId);

        if (msg.photo) {
          var fileId = msg.photo[msg.photo.length - 1].file_id;
          handlePhoto(chatId, fileId);
        } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith("image/")) {
          handlePhoto(chatId, msg.document.file_id);
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
