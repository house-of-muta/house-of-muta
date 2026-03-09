const express = require("express");
const line = require("@line/bot-sdk");
const chrono = require("chrono-node");
const { google } = require("googleapis");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/calendar"]
});

const calendar = google.calendar({ version: "v3", auth });

const CALENDAR_ID = process.env.CALENDAR_ID;

app.post("/webhook", line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {

  if (event.type !== "message") return;

  if (event.message.type !== "text") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "テキストのみ対応"
    });
  }

  const text = event.message.text;

  if (text.startsWith("完了")) {
    return completeTask(event, text);
  }

  if (text.startsWith("修正")) {
    return modifyEvent(event, text);
  }

  return createEvent(event, text);
}

async function createEvent(event, text) {

  const parsed = chrono.parse(text);

  if (parsed.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "日時を認識できません"
    });
  }

  const start = parsed[0].start.date();

  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const title = text.replace(parsed[0].text, "").trim() || "予定";

  const calendarEvent = {
    summary: title,
    start: {
      dateTime: start.toISOString(),
      timeZone: "Asia/Tokyo"
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: "Asia/Tokyo"
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 30 }
      ]
    }
  };

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: calendarEvent
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `予定登録\n${title}\n${start}`
  });
}

async function completeTask(event, text) {

  const keyword = text.replace("完了", "").trim();

  const list = await calendar.events.list({
    calendarId: CALENDAR_ID,
    maxResults: 20,
    singleEvents: true,
    orderBy: "startTime"
  });

  const target = list.data.items.find(e =>
    e.summary.includes(keyword)
  );

  if (!target) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "該当予定なし"
    });
  }

  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId: target.id
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "タスク完了"
  });
}

async function modifyEvent(event, text) {

  const body = text.replace("修正", "").trim();

  const parsed = chrono.parse(body);

  if (parsed.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "修正日時を認識できません"
    });
  }

  const newDate = parsed[0].start.date();

  const keyword = body.replace(parsed[0].text, "").trim();

  const list = await calendar.events.list({
    calendarId: CALENDAR_ID,
    maxResults: 20,
    singleEvents: true,
    orderBy: "startTime"
  });

  const target = list.data.items.find(e =>
    e.summary.includes(keyword)
  );

  if (!target) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "修正対象が見つかりません"
    });
  }

  await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: target.id,
    resource: {
      start: {
        dateTime: newDate.toISOString(),
        timeZone: "Asia/Tokyo"
      },
      end: {
        dateTime: new Date(newDate.getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: "Asia/Tokyo"
      }
    }
  });

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "予定修正しました"
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("server running");
});
