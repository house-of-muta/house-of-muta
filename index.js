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

// ===== LINE Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {

  console.log("=== EVENT RECEIVED ===");
  console.log(JSON.stringify(event, null, 2));

  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;

  if (userMessage.includes("予約")) {
    try {
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      const calendar = google.calendar({
        version: "v3",
        auth: oauth2Client,
      });

      const eventData = {
        summary: "LINE予約",
        description: "LINEから自動登録",
        start: {
          dateTime: new Date().toISOString(),
          timeZone: "Asia/Tokyo",
        },
        end: {
          dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          timeZone: "Asia/Tokyo",
        },
      };

      await calendar.events.insert({
        calendarId: "primary",
        resource: eventData,
      });

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "カレンダーに予約を登録しました ✅",
      });

    } catch (error) {
      console.error("Calendar Error:", error);
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "カレンダー登録に失敗しました。",
      });
    }
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "House of MUTAが承ります。",
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("MUTA Private Office is running.");
});
