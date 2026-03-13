const express=require("express")
const line=require("@line/bot-sdk")
const chrono=require("chrono-node")
const {google}=require("googleapis")
const cron=require("node-cron")
const axios=require("axios")
const OpenAI=require("openai")

const app=express()

const config={
channelAccessToken:process.env.LINE_ACCESS_TOKEN,
channelSecret:process.env.LINE_CHANNEL_SECRET
}

const client=new line.Client(config)

const openai=new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

const auth=new google.auth.GoogleAuth({
keyFile:"credentials.json",
scopes:["https://www.googleapis.com/auth/calendar"]
})

const calendar=google.calendar({version:"v3",auth})

const CALENDAR_ID=process.env.CALENDAR_ID
const USER_ID=process.env.USER_ID

app.post("/webhook",line.middleware(config),(req,res)=>{
Promise.all(req.body.events.map(handleEvent))
.then(()=>res.end())
.catch(()=>res.status(500).end())
})

async function handleEvent(event){

if(event.type!=="message")return

if(event.message.type==="text"){

const text=event.message.text

if(/今日/.test(text))return today(event)

if(/明日/.test(text))return tomorrow(event)

if(/来週/.test(text))return nextWeek(event)

if(/空いて/.test(text))return freeTime(event)

if(text.startsWith("削除"))return deleteEvent(event,text)

if(text.includes("後ろに"))return delayEvent(event,text)

if(text.includes("場所"))return sendMap(event,text)

if(text==="株価")return stock(event)

if(text==="ニュース")return news(event)

if(text.includes("出張"))return trip(event,text)

return createEvent(event,text)

}

if(event.message.type==="audio"){
return meetingMinutes(event)
}

}

async function createEvent(event,text){

const parsed=chrono.ja.parse(text)

if(parsed.length===0){

const gpt=await openai.chat.completions.create({
model:"gpt-4o-mini",
messages:[{
role:"user",
content:`次の文章から予定タイトルと日時JSON\n${text}`
}]
})

const data=JSON.parse(gpt.choices[0].message.content)

const start=new Date(data.datetime)

await calendar.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:data.title,
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:new Date(start.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
}
})

return client.replyMessage(event.replyToken,{
type:"text",
text:`予定登録\n${data.title}`
})

}

const start=parsed[0].start.date()

await calendar.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:text,
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:new Date(start.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
}
})

return client.replyMessage(event.replyToken,{
type:"text",
text:"予定登録しました"
})

}

async function today(event){

const now=new Date()

const start=new Date(now.setHours(0,0,0))
const end=new Date(now.setHours(23,59,59))

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:start.toISOString(),
timeMax:end.toISOString(),
singleEvents:true
})

let msg="今日の予定\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getHours()}時 ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

async function tomorrow(event){

const now=new Date()
now.setDate(now.getDate()+1)

const start=new Date(now.setHours(0,0,0))
const end=new Date(now.setHours(23,59,59))

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:start.toISOString(),
timeMax:end.toISOString(),
singleEvents:true
})

let msg="明日の予定\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getHours()}時 ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

async function nextWeek(event){

const now=new Date()
const end=new Date()
end.setDate(now.getDate()+7)

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:now.toISOString(),
timeMax:end.toISOString(),
singleEvents:true
})

let msg="来週予定\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}時 ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

async function freeTime(event){

const now=new Date()

const end=new Date()
end.setDate(now.getDate()+1)

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:now.toISOString(),
timeMax:end.toISOString(),
singleEvents:true,
orderBy:"startTime"
})

let prev=now
let free=[]

res.data.items.forEach(e=>{
const start=new Date(e.start.dateTime)

if(start-prev>3600000){
free.push(prev.getHours()+"〜"+start.getHours()+"時")
}

prev=new Date(e.end.dateTime)

})

return client.replyMessage(event.replyToken,{
type:"text",
text:"空き時間\n"+free.join("\n")
})

}

async function delayEvent(event,text){

const num=parseInt(text.match(/\d+/))

const keyword=text.replace(/\d+分後ろに/,"")

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
singleEvents:true
})

const target=res.data.items.find(e=>e.summary.includes(keyword))

if(!target)return client.replyMessage(event.replyToken,{type:"text",text:"予定なし"})

const start=new Date(target.start.dateTime)
start.setMinutes(start.getMinutes()+num)

await calendar.events.patch({
calendarId:CALENDAR_ID,
eventId:target.id,
resource:{
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:new Date(start.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
}
})

return client.replyMessage(event.replyToken,{type:"text",text:"時間変更しました"})

}

async function sendMap(event,text){

const keyword=text.replace("場所送って","")

const map=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(keyword)}`

return client.replyMessage(event.replyToken,{
type:"text",
text:`場所はこちら\n${map}`
})

}

async function trip(event,text){

const parsed=chrono.ja.parse(text)

if(parsed.length===0)return

const start=parsed[0].start.date()

const city=text.replace("出張","")

const tasks=["出発","移動","宿泊","帰社"]

for(const t of tasks){

await calendar.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:`${city}出張 ${t}`,
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:new Date(start.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
}
})

}

return client.replyMessage(event.replyToken,{type:"text",text:"出張予定作成しました"})

}

async function stock(event){

const res=await axios.get("https://query1.finance.yahoo.com/v8/finance/chart/^N225")

const price=res.data.chart.result[0].meta.regularMarketPrice

return client.replyMessage(event.replyToken,{
type:"text",
text:`日経平均\n${price}円`
})

}

async function news(event){

const res=await axios.get(`https://newsapi.org/v2/top-headlines?country=jp&apiKey=${process.env.NEWS_API_KEY}`)

let msg="ニュース\n"

res.data.articles.slice(0,5).forEach(n=>{
msg+=`・${n.title}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

async function meetingMinutes(event){

return client.replyMessage(event.replyToken,{
type:"text",
text:"音声議事録機能（OpenAI音声解析接続可能）"
})

}

app.listen(process.env.PORT||3000)
