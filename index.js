const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const chrono = require("chrono-node");

const app = express();


// =============================
// LINE設定
// =============================

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);


// =============================
// Google OAuth
// =============================

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


// =============================
// 時差対策
// =============================

function toJapanISO(date){

  const japanOffset = 9 * 60;
  const localOffset = date.getTimezoneOffset();

  const diff = (japanOffset + localOffset) * 60000;

  const japanTime = new Date(date.getTime() + diff);

  return japanTime.toISOString();
}



// =============================
// 予定作成
// =============================

async function createEvent(text){

  const results = chrono.parse(text);

  if(results.length === 0){
    return null;
  }

  const start = results[0].start.date();

  let end;

  if(results[0].end){

    end = results[0].end.date();

  }else{

    end = new Date(start.getTime() + 60 * 60 * 1000);

  }

  return {
    start,
    end
  };

}



// =============================
// 重複チェック
// =============================

async function checkConflict(start,end){

  const events = await calendar.events.list({

    calendarId:"primary",

    timeMin:start.toISOString(),

    timeMax:end.toISOString(),

    singleEvents:true,

    orderBy:"startTime"

  });

  return events.data.items;

}



// =============================
// カレンダー登録
// =============================

async function insertCalendar(text,start,end){

  const event = {

    summary:text,

    description:"LINE AI秘書",

    start:{
      dateTime:toJapanISO(start),
      timeZone:"Asia/Tokyo"
    },

    end:{
      dateTime:toJapanISO(end),
      timeZone:"Asia/Tokyo"
    }

  };

  return await calendar.events.insert({

    calendarId:"primary",

    resource:event

 
