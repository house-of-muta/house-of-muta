const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// ===== Google OAuth設定 =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://house-of-muta.onrender.com/oauth2callback"
);

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

// 認証開始URL
app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.redirect(url);
});

// 認証後のコールバック
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  console.log("Google OAuth Success:", tokens);
  res.send("Google連携成功しました ✅");
});

// ===== LINE Webhook =====
app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent)).then((result) =>
    res.json(result)
  );
});

function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;

  let replyMessage = "";

  if (userMessage.includes("予約")) {
    replyMessage = "かしこまりました。ご希望日時をお知らせください。";
  } else if (userMessage.includes("相談")) {
    replyMessage = "承りました。内容をお聞かせください。";
  } else {
    replyMessage = "かしこまりました。House of MUTAが承ります。";
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: replyMessage,
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("MUTA Private Office is running.");
});
