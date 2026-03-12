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

  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const text = event.message.text;

  if (text.includes("今日の予定")) {
    return getEvents(event, 0);
  }

  if (text.includes("明日の予定")) {
    return getEvents(event, 1);
  }

  if (text.includes("予定一覧")) {
    return listEvents(event);
  }

  if (text.startsWith("削除")) {
    return deleteEvent(event, text);
  }

  return createEvent(event, text);
}

async function createEvent(event, text) {

  const parsed = chrono.ja.parse(text);

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

  const hour = start.getHours().toString().padStart(2, "0");
  const min = start.getMinutes().toString().padStart(2, "0");

  return client.replyMessage(event.replyToken, {
    type: "text",
    text:
`予定かしこまりました。

${hour}時${min}分
「${title}」ですね。

予定時間の確認を
・前日17:00
・予定30分前

に通知します。`
  });
}

async function getEvents(event, addDay){

  const date = new Date();
  date.setDate(date.getDate() + addDay);

  const startTime = new Date(date.setHours(0,0,0));
  const endTime = new Date(date.setHours(23,59,59));

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: startTime.toISOString(),
    timeMax: endTime.toISOString(),
    singleEvents:true,
    orderBy:"startTime"
  });

  if(res.data.items.length === 0){
    return client.replyMessage(event.replyToken,{
      type:"text",
      text:"予定はありません"
    });
  }

  let msg = "予定はこちらです\n\n";

  res.data.items.forEach(e=>{
    const d = new Date(e.start.dateTime);
    msg += `${d.getHours()}時 ${e.summary}\n`;
  });

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:msg
  });
}

async function listEvents(event){

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    maxResults:10,
    singleEvents:true,
    orderBy:"startTime"
  });

  let msg="今後の予定\n\n";

  res.data.items.forEach((e,i)=>{
    const d=new Date(e.start.dateTime);
    msg+=`${i+1}. ${d.getMonth()+1}/${d.getDate()} ${d.getHours()}時 ${e.summary}\n`;
  });

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:msg
  });
}

async function deleteEvent(event,text){

  const num = Number(text.replace("削除","").trim())-1;

  const res = await calendar.events.list({
    calendarId:CALENDAR_ID,
    maxResults:10,
    singleEvents:true,
    orderBy:"startTime"
  });

  const target = res.data.items[num];

  if(!target){
    return client.replyMessage(event.replyToken,{
      type:"text",
      text:"番号が見つかりません"
    });
  }

  await calendar.events.delete({
    calendarId:CALENDAR_ID,
    eventId:target.id
  });

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:"予定を削除しました"
  });
}

app.get("/", (req, res) => {
  res.send("bot running");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("server running");
});
