const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const { OpenAI } = require("openai");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

console.log("================================");
console.log("MUTA AI Secretary Started");
console.log("PORT:", PORT);
console.log("================================");

// ============================
// OpenAI
// ============================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================
// Google Auth
// ============================

const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/calendar",
  ]
);

const sheets = google.sheets({ version: "v4", auth });

const SHEET_ID = process.env.SHEET_ID;

// ============================
// AI Chat
// ============================

async function askAI(message) {

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "あなたはMUTA専属の超優秀なAI秘書です。",
      },
      {
        role: "user",
        content: message,
      },
    ],
  });

  return response.choices[0].message.content;
}

// ============================
// 家計簿登録
// ============================

async function addMoney(text) {

  const price = text.match(/[0-9]+/);

  if (!price) return;

  const value = price[0];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "money!A:C",
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [
        [
          new Date().toLocaleString(),
          text,
          value,
        ],
      ],
    },
  });
}
// ============================
// タスク登録
// ============================

async function addTask(text) {

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "task!A:B",
    valueInputOption: "USER_ENTERED",
    resource: {
      values: [
        [
          new Date().toLocaleString(),
          text,
        ],
      ],
    },
  });
}

// ============================
// Google Calendar
// ============================

const calendar = google.calendar({
  version: "v3",
  auth,
});

const CALENDAR_ID = "primary";

// ============================
// 予定追加
// ============================

async function addSchedule(title, date) {

  const event = {
    summary: title,
    start: {
      dateTime: date,
      timeZone: "Asia/Tokyo",
    },
    end: {
      dateTime: date,
      timeZone: "Asia/Tokyo",
    },
  };

  await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
  });

}

// ============================
// 予定削除
// ============================

async function deleteSchedule(keyword) {

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = res.data.items;

  for (let e of events) {

    if (e.summary.includes(keyword)) {

      await calendar.events.delete({
        calendarId: CALENDAR_ID,
        eventId: e.id,
      });

      return;
    }
  }
}
