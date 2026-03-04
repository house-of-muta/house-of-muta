require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const chrono = require("chrono-node");

const app = express();

// ===== LINE設定 =====
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(lineConfig);

// ===== Google設定 =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ["https://www.googleapis.com/auth/calendar"]
});

const calendar = google.calendar({ version: "v3", auth });

// ===== Webhook =====
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    for (const event of events) {
      await handleEvent(event);
    }
    res.status(200).end();
  } catch (err) {
    console.error("❌ WEBHOOK ERROR:", err);
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

  // ===== 日付解析 =====
  const parsedDate = chrono.parseDate(userText);

  if (!parsedDate) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "日付を認識できませんでした。"
    });
  }

  // ===== イベント作成 =====
  const endDate = new Date(parsedDate.getTime() + 60 * 60 * 1000);

  const calendarEvent = {
    summary: userText,
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
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      resource: calendarEvent
    });

    console.log("✅ CALENDAR SUCCESS:", response.data.htmlLink);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "カレンダーに登録しました。"
    });

  } catch (error) {
    console.log("❌ CALENDAR ERROR:", error.response?.data || error.message);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "カレンダー登録に失敗しました。ログを確認してください。"
    });
  }
}

// ===== サーバー起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
app.listen(process.env.PORT || 3000, () => {
  console.log("MUTA Ultimate Assistant is running.");
});
