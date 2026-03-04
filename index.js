require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const chrono = require("chrono-node");

const app = express();

// ===== LINE設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// ===== Google OAuth設定 =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({
  version: "v3",
  auth: oauth2Client
});

// ===== Webhook =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    for (const event of events) {
      await handleEvent(event);
    }
    res.status(200).end();
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  console.log("=== EVENT RECEIVED ===");
  console.log(JSON.stringify(event, null, 2));

  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userText = event.message.text;

  const parsedDate = chrono.parseDate(userText);

  if (!parsedDate) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "日付を認識できませんでした。"
    });
  }

  const endDate = new Date(parsedDate.getTime() + 60 * 60 * 1000);

  const calendarEvent = {
    summary: userText,
    description: "LINEから自動登録",
    start: {
      dateTime: parsedDate.toISOString(),
      timeZone: "Asia/Tokyo"
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: "Asia/Tokyo"
    }
  };

  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: calendarEvent
    });

    console.log("✅ CALENDAR SUCCESS:", response.data.htmlLink);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "カレンダーに登録しました ✅"
    });

  } catch (error) {
    console.log("❌ CALENDAR ERROR:", error.response?.data || error.message);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "カレンダー登録に失敗しました。"
    });
  }
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running.");
});
