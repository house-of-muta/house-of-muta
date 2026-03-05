
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const chrono = require("chrono-node");
const OpenAI = require("openai");

const app = express();

// =========================
// LINE設定
// =========================

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

// =========================
// OpenAI
// =========================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =========================
// Google OAuth
// =========================

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

// =========================
// ユーザー別カレンダー
// =========================

const userCalendars = {
  "U663b151ce58a81f6bc023b85df5f75b3": "primary"
};

// =========================
// webhook
// =========================

app.post("/webhook", line.middleware(config), async (req, res) => {

  try {

    const events = req.body.events;

    for (const event of events) {
      await handleEvent(event);
    }

    res.status(200).end();

  } catch (err) {

    console.error(err);
    res.status(500).end();

  }

});

// =========================
// メイン処理
// =========================

async function handleEvent(event) {

  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text;
  const userId = event.source.userId;
  const calendarId = userCalendars[userId] || "primary";

  // =====================
  // 今日の予定
  // =====================

  if (text === "今日の予定") {

    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const res = await calendar.events.list({
      calendarId,
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    });

    let msg = "📅今日の予定\n\n";

    if (res.data.items.length === 0) {
      msg += "予定なし";
    }

    res.data.items.forEach(e => {

      const start = new Date(e.start.dateTime || e.start.date);

      msg +=
        start.toLocaleTimeString("ja-JP", {hour:"2-digit",minute:"2-digit"})
        + " "
        + e.summary
        + "\n";

    });

    return reply(event,msg);

  }

  // =====================
  // 明日の予定
  // =====================

  if (text === "明日の予定") {

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const next = new Date();
    next.setDate(tomorrow.getDate() + 1);

    const res = await calendar.events.list({
      calendarId,
      timeMin: tomorrow.toISOString(),
      timeMax: next.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    });

    let msg = "📅明日の予定\n\n";

    if (res.data.items.length === 0) {
      msg += "予定なし";
    }

    res.data.items.forEach(e => {

      const start = new Date(e.start.dateTime || e.start.date);

      msg +=
        start.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})
        + " "
        + e.summary
        + "\n";

    });

    return reply(event,msg);

  }

  // =====================
  // 空き時間
  // =====================

  if (text === "空き時間") {

    const now = new Date();

    const res = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime"
    });

    if (res.data.items.length === 0) {
      return reply(event,"今日空いています");
    }

    const nextEvent = new Date(res.data.items[0].start.dateTime);

    return reply(event,"次の予定まで空き\n\n"+nextEvent.toLocaleString("ja-JP"));

  }

  // =====================
  // 予定削除
  // =====================

  if (text.startsWith("削除")) {

    const keyword = text.replace("削除","").trim();

    const res = await calendar.events.list({
      calendarId,
      q: keyword
    });

    if (res.data.items.length === 0) {
      return reply(event,"該当予定なし");
    }

    const id = res.data.items[0].id;

    await calendar.events.delete({
      calendarId,
      eventId:id
    });

    return reply(event,"削除しました");

  }

  // =====================
  // 予定登録
  // =====================

  const results = chrono.parse(text);

  if (results.length > 0) {

    let startDate = results[0].start.date();
    let endDate;

    const range = text.match(/(\d{1,2})\s*[-〜]\s*(\d{1,2})/);

    if (range) {

      startDate.setHours(range[1]);
      startDate.setMinutes(0);

      endDate = new Date(startDate);
      endDate.setHours(range[2]);

    } else {

      endDate = new Date(startDate.getTime()+60*60*1000);

    }

    const eventData = {

      summary:text,

      start:{
        dateTime:startDate,
        timeZone:"Asia/Tokyo"
      },

      end:{
        dateTime:endDate,
        timeZone:"Asia/Tokyo"
      }

    };

    await calendar.events.insert({
      calendarId,
      resource:eventData
    });

    // 管理者通知

    if(process.env.ADMIN_LINE_ID){

      await client.pushMessage(process.env.ADMIN_LINE_ID,{
        type:"text",
        text:"📌新規予定\n"+text
      });

    }

    return reply(
      event,
      "登録完了\n"+startDate.toLocaleString("ja-JP")
    );

  }

  // =====================
  // ChatGPT秘書
  // =====================

  const gpt = await openai.chat.completions.create({

    model:"gpt-4o-mini",

    messages:[
      {
        role:"system",
        content:"あなたは有能な秘書です。簡潔に答えてください。"
      },
      {
        role:"user",
        content:text
      }
    ]

  });

  const answer = gpt.choices[0].message.content;

  return reply(event,answer);

}

// =========================

function reply(event,text){

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:text
  });

}

// =========================

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
