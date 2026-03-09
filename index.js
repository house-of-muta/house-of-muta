// ==================================================
// MUTA-E AI SECRETARY FINAL VERSION
// ==================================================

require("dotenv").config()

const express = require("express")
const bodyParser = require("body-parser")
const { google } = require("googleapis")
const { OpenAI } = require("openai")
const line = require("@line/bot-sdk")

const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 3000


// ==================================================
// LINE
// ==================================================

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
}

const client = new line.Client(lineConfig)


// ==================================================
// OPENAI
// ==================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})


// ==================================================
// GOOGLE SHEETS
// ==================================================

const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,"\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
)

const sheets = google.sheets({
  version:"v4",
  auth
})

const SHEET_ID = process.env.SHEET_ID


// ==================================================
// AI CHAT
// ==================================================

async function askAI(text){

  const completion = await openai.chat.completions.create({

    model:"gpt-4o-mini",

    messages:[
      {role:"system",content:"あなたは優秀なAI秘書です"},
      {role:"user",content:text}
    ]

  })

  return completion.choices[0].message.content

}



// ==================================================
// MONEY
// ==================================================

async function addMoney(text){

  const price = text.match(/[0-9]+/)

  if(!price) return

  await sheets.spreadsheets.values.append({

    spreadsheetId:SHEET_ID,

    range:"money!A:C",

    valueInputOption:"USER_ENTERED",

    resource:{
      values:[
        [
          new Date().toLocaleString(),
          text,
          price[0]
        ]
      ]
    }

  })

}



// ==================================================
// TASK
// ==================================================

async function addTask(text){

  await sheets.spreadsheets.values.append({

    spreadsheetId:SHEET_ID,

    range:"task!A:C",

    valueInputOption:"USER_ENTERED",

    resource:{
      values:[
        [
          new Date().toLocaleString(),
          text,
          "未完了"
        ]
      ]
    }

  })

}



// ==================================================
// SCHEDULE
// ==================================================

async function addSchedule(text){

  const prompt = `
次の文章から予定を解析してください。

JSONのみ出力

{
"title":"",
"date":"",
"time":""
}

文章:
${text}
`

  const res = await openai.chat.completions.create({

    model:"gpt-4o-mini",

    messages:[
      {role:"user",content:prompt}
    ]

  })

  const data = JSON.parse(res.choices[0].message.content)

  await sheets.spreadsheets.values.append({

    spreadsheetId:SHEET_ID,

    range:"task!A:C",

    valueInputOption:"USER_ENTERED",

    resource:{
      values:[
        [
          data.date+" "+data.time,
          data.title,
          "予定"
        ]
      ]
    }

  })

}



// ==================================================
// MESSAGE
// ==================================================

async function handleMessage(event){

  const text = event.message.text

  let reply = ""

  try{

    if(text.includes("円")){

      await addMoney(text)

      reply="家計簿に登録しました"

    }

    else if(text.startsWith("タスク")){

      await addTask(text.replace("タスク",""))

      reply="タスク登録しました"

    }

    else if(
      text.includes("明日") ||
      text.includes("今日") ||
      text.match(/[0-9]+時/)
    ){

      await addSchedule(text)

      reply="予定登録しました"

    }

    else{

      reply = await askAI(text)

    }

  }

  catch(e){

    console.log(e)

    reply="日時を認識できませんでした"

  }

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:reply
  })

}



// ==================================================
// WEBHOOK
// ==================================================

app.post("/webhook",line.middleware(lineConfig),(req,res)=>{

  Promise
  .all(req.body.events.map(handleMessage))
  .then(result=>res.json(result))
  .catch(err=>{

    console.error(err)

    res.status(500).end()

  })

})



// ==================================================
// ROOT
// ==================================================

app.get("/",(req,res)=>{

  res.send("MUTA-E AI SECRETARY RUNNING")

})



// ==================================================
// SERVER
// ==================================================

app.listen(PORT,()=>{

  console.log("================================")
  console.log("MUTA-E AI SECRETARY STARTED")
  console.log("PORT:",PORT)
  console.log("================================")

})
