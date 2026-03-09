// =====================================================
// MUTA-E AI SECRETARY SYSTEM
// COMPLETE VERSION
// =====================================================

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const { OpenAI } = require("openai");
const line = require("@line/bot-sdk");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;


// =====================================================
// LINE CONFIG
// =====================================================

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(lineConfig);


// =====================================================
// OPENAI
// =====================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// =====================================================
// GOOGLE AUTH
// =====================================================

const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  [
    "https://www.googleapis.com/auth/spreadsheets"
  ]
);

const sheets = google.sheets({
  version: "v4",
  auth
});

const SHEET_ID = process.env.SHEET_ID;


// =====================================================
// AI CHAT
// =====================================================

async function askAI(message) {

  const completion = await openai.chat.completions.create({

    model: "gpt-4o-mini",

    messages: [
      {
        role: "system",
        content: "あなたは優秀なAI秘書です。"
      },
      {
        role: "user",
        content: message
      }
    ]
  });

  return completion.choices[0].message.content;
}



// =====================================================
// MONEY RECORD
// =====================================================

async function addMoney(text) {

  const priceMatch = text.match(/[0-9]+/);

  if (!priceMatch) return;

  const price = priceMatch[0];

  await sheets.spreadsheets.values.append({

    spreadsheetId: SHEET_ID,
    range: "money!A:C",
    valueInputOption: "USER_ENTERED",

    resource: {

      values: [
        [
          new Date().toLocaleString(),
          text,
          price
        ]
      ]
    }
  });

}



// =====================================================
// TASK RECORD
// =====================================================

async function addTask(text) {

  await sheets.spreadsheets.values.append({

    spreadsheetId: SHEET_ID,
    range: "task!A:B",
    valueInputOption: "USER_ENTERED",

    resource: {

      values: [
        [
          new Date().toLocaleString(),
          text
        ]
      ]
    }

  });

}



// =====================================================
// MESSAGE HANDLER
// =====================================================

async function handleMessage(event) {

  const text = event.message.text;

  let replyText = "";

  try {

    if (text.includes("円")) {

      await addMoney(text);

      replyText = "家計簿に登録しました。";

    }

    else if (text.startsWith("タスク")) {

      await addTask(text.replace("タスク", ""));

      replyText = "タスクを登録しました。";

    }

    else {

      replyText = await askAI(text);

    }

  } catch (error) {

    console.log(error);

    replyText = "エラーが発生しました。";

  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: replyText
  });

}



// =====================================================
// LINE WEBHOOK
// =====================================================

app.post("/webhook", line.middleware(lineConfig), (req, res) => {

  Promise
    .all(req.body.events.map(handleMessage))
    .then(result => res.json(result))
    .catch(err => {

      console.error(err);

      res.status(500).end();

    });

});



// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

  res.send("MUTA-E AI SECRETARY RUNNING");

});



// =====================================================
// SERVER START
// =====================================================

app.listen(PORT, () => {

  console.log("================================");
  console.log("MUTA-E AI SECRETARY STARTED");
  console.log("PORT:", PORT);
  console.log("================================");

});
