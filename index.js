const express = require("express");
const line = require("@line/bot-sdk");
const chrono = require("chrono-node");
const { google } = require("googleapis");
const cron = require("node-cron");

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
const USER_ID = process.env.USER_ID;

app.post("/webhook", line.middleware(config), async (req, res) => {
 Promise.all(req.body.events.map(handleEvent))
  .then(() => res.end())
  .catch(err => {
   console.error(err);
   res.status(500).end();
  });
});

async function handleEvent(event){

 if(event.type!=="message" || event.message.type!=="text") return;

 const text=event.message.text;

 // 自然言語解析
 if(isToday(text)) return sendToday(event);
 if(isTomorrow(text)) return sendTomorrow(event);
 if(isList(text)) return listEvents(event);

 if(text.startsWith("削除")) return deleteEvent(event,text);
 if(text.startsWith("修正")) return modifyEvent(event,text);

 return createEvent(event,text);
}

function isToday(text){
 return /(今日|本日)/.test(text);
}

function isTomorrow(text){
 return /(明日)/.test(text);
}

function isList(text){
 return /(予定一覧|スケジュール|予定見せ|予定教え)/.test(text);
}

async function createEvent(event,text){

 const parsed=chrono.ja.parse(text);

 if(parsed.length===0){
  return client.replyMessage(event.replyToken,{
   type:"text",
   text:"MUTA-Eです。\n日時を認識できませんでした。"
  });
 }

 const start=parsed[0].start.date();
 const end=new Date(start.getTime()+3600000);

 const title=text.replace(parsed[0].text,"").trim()||"予定";

 await calendar.events.insert({
  calendarId:CALENDAR_ID,
  resource:{
   summary:title,
   start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
   end:{dateTime:end.toISOString(),timeZone:"Asia/Tokyo"},
   reminders:{
    useDefault:false,
    overrides:[{method:"popup",minutes:30}]
   }
  }
 });

 return client.replyMessage(event.replyToken,{
  type:"text",
  text:`MUTA-Eです。

予定を登録しました

${start.getMonth()+1}/${start.getDate()}
${start.getHours()}時${start.getMinutes()}分

「${title}」`
 });
}

async function listEvents(event){

 const res=await calendar.events.list({
  calendarId:CALENDAR_ID,
  maxResults:10,
  singleEvents:true,
  orderBy:"startTime"
 });

 if(res.data.items.length===0){
  return client.replyMessage(event.replyToken,{
   type:"text",
   text:"予定はありません"
  });
 }

 let msg="予定一覧\n\n";

 res.data.items.forEach((e,i)=>{
  const d=new Date(e.start.dateTime);
  msg+=`${i+1}. ${d.getMonth()+1}/${d.getDate()} ${d.getHours()}時 ${e.summary}\n`;
 });

 return client.replyMessage(event.replyToken,{type:"text",text:msg});
}

async function deleteEvent(event,text){

 const num=Number(text.replace("削除","").trim())-1;

 const res=await calendar.events.list({
  calendarId:CALENDAR_ID,
  maxResults:10,
  singleEvents:true,
  orderBy:"startTime"
 });

 const target=res.data.items[num];

 if(!target){
  return client.replyMessage(event.replyToken,{type:"text",text:"番号が見つかりません"});
 }

 await calendar.events.delete({
  calendarId:CALENDAR_ID,
  eventId:target.id
 });

 return client.replyMessage(event.replyToken,{
  type:"text",
  text:"予定削除しました"
 });
}

async function modifyEvent(event,text){

 const body=text.replace("修正","").trim();
 const parsed=chrono.ja.parse(body);

 if(parsed.length===0){
  return client.replyMessage(event.replyToken,{
   type:"text",
   text:"修正日時を認識できません"
  });
 }

 const newDate=parsed[0].start.date();
 const keyword=body.replace(parsed[0].text,"").trim();

 const list=await calendar.events.list({
  calendarId:CALENDAR_ID,
  maxResults:20,
  singleEvents:true
 });

 const target=list.data.items.find(e=>e.summary.includes(keyword));

 if(!target){
  return client.replyMessage(event.replyToken,{type:"text",text:"対象予定なし"});
 }

 await calendar.events.patch({
  calendarId:CALENDAR_ID,
  eventId:target.id,
  resource:{
   start:{dateTime:newDate.toISOString(),timeZone:"Asia/Tokyo"},
   end:{dateTime:new Date(newDate.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
  }
 });

 return client.replyMessage(event.replyToken,{
  type:"text",
  text:"予定を修正しました"
 });
}

async function getTodayEvents(){

 const now=new Date();

 const start=new Date(now.setHours(0,0,0));
 const end=new Date(now.setHours(23,59,59));

 const res=await calendar.events.list({
  calendarId:CALENDAR_ID,
  timeMin:start.toISOString(),
  timeMax:end.toISOString(),
  singleEvents:true
 });

 if(res.data.items.length===0) return "今日の予定はありません";

 let msg="今日の予定\n\n";

 res.data.items.forEach(e=>{
  const d=new Date(e.start.dateTime);
  msg+=`${d.getHours()}時 ${e.summary}\n`;
 });

 return msg;
}

async function sendToday(event){
 const msg=await getTodayEvents();
 return client.replyMessage(event.replyToken,{type:"text",text:msg});
}

async function sendTomorrow(event){

 const now=new Date();
 now.setDate(now.getDate()+1);

 const start=new Date(now.setHours(0,0,0));
 const end=new Date(now.setHours(23,59,59));

 const res=await calendar.events.list({
  calendarId:CALENDAR_ID,
  timeMin:start.toISOString(),
  timeMax:end.toISOString(),
  singleEvents:true
 });

 if(res.data.items.length===0){
  return client.replyMessage(event.replyToken,{
   type:"text",
   text:"明日の予定はありません"
  });
 }

 let msg="明日の予定\n\n";

 res.data.items.forEach(e=>{
  const d=new Date(e.start.dateTime);
  msg+=`${d.getHours()}時 ${e.summary}\n`;
 });

 return client.replyMessage(event.replyToken,{type:"text",text:msg});
}

cron.schedule("0 8 * * *",async()=>{
 const msg=await getTodayEvents();
 client.pushMessage(USER_ID,{type:"text",text:msg});
});

app.listen(process.env.PORT||3000,()=>{
 console.log("MUTA-E running");
});
