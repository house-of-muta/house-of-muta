const express=require("express")
const line=require("@line/bot-sdk")
const chrono=require("chrono-node")
const {google}=require("googleapis")
const cron=require("node-cron")

const app=express()

const config={
channelAccessToken:process.env.LINE_ACCESS_TOKEN,
channelSecret:process.env.LINE_CHANNEL_SECRET
}

const client=new line.Client(config)

const auth=new google.auth.GoogleAuth({
keyFile:"credentials.json",
scopes:["https://www.googleapis.com/auth/calendar"]
})

const calendar=google.calendar({version:"v3",auth})

const CALENDAR_ID=process.env.CALENDAR_ID
const USER_ID=process.env.USER_ID

app.post("/webhook",line.middleware(config),async(req,res)=>{
Promise.all(req.body.events.map(handleEvent))
.then(()=>res.end())
.catch(()=>res.status(500).end())
})

async function handleEvent(event){

if(event.type!=="message")return

if(event.message.type==="text"){
const text=event.message.text

if(/今日|本日/.test(text))return sendToday(event)

if(/明日/.test(text))return sendTomorrow(event)

if(/来週/.test(text))return nextWeek(event)

if(/空いて|空き時間/.test(text))return freeTime(event)

if(text.startsWith("削除"))return deleteEvent(event,text)

if(text.includes("後ろに"))return delayEvent(event,text)

if(text.includes("場所"))return sendLocation(event,text)

return createEvent(event,text)
}

if(event.message.type==="audio"){
return voiceSchedule(event)
}

}

async function createEvent(event,text){

const parsed=chrono.ja.parse(text)

if(parsed.length===0){
return client.replyMessage(event.replyToken,{type:"text",text:"日時認識できません"})
}

const start=parsed[0].start.date()
const end=new Date(start.getTime()+3600000)

const title=text.replace(parsed[0].text,"").trim()||"予定"

await calendar.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:title,
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:end.toISOString(),timeZone:"Asia/Tokyo"}
}
})

return client.replyMessage(event.replyToken,{
type:"text",
text:`予定登録しました\n${title}`
})
}

async function sendToday(event){

const now=new Date()
const start=new Date(now.setHours(0,0,0))
const end=new Date(now.setHours(23,59,59))

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:start.toISOString(),
timeMax:end.toISOString(),
singleEvents:true
})

let msg="今日の予定\n\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getHours()}時 ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})
}

async function sendTomorrow(event){

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

let msg="明日の予定\n\n"

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

let msg="来週予定\n\n"

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
free.push(prev.getHours()+"時〜"+start.getHours()+"時")
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

const keyword=text.replace(/\d+分後ろに/,"").trim()

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
singleEvents:true
})

const target=res.data.items.find(e=>e.summary.includes(keyword))

if(!target)return client.replyMessage(event.replyToken,{type:"text",text:"予定見つかりません"})

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

async function sendLocation(event,text){

const keyword=text.replace("場所送って","").trim()

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
singleEvents:true
})

const target=res.data.items.find(e=>e.summary.includes(keyword))

if(!target)return client.replyMessage(event.replyToken,{type:"text",text:"予定なし"})

const map=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.summary)}`

return client.replyMessage(event.replyToken,{
type:"text",
text:`場所はこちら\n${map}`
})
}

async function voiceSchedule(event){

return client.replyMessage(event.replyToken,{
type:"text",
text:"音声予定登録（STT連携準備済み）"
})
}

cron.schedule("0 8 * * *",async()=>{
const msg=await sendTodayMessage()
client.pushMessage(USER_ID,{type:"text",text:msg})
})

async function sendTodayMessage(){

const now=new Date()
const start=new Date(now.setHours(0,0,0))
const end=new Date(now.setHours(23,59,59))

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:start.toISOString(),
timeMax:end.toISOString(),
singleEvents:true
})

let msg="本日の予定\n\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getHours()}時 ${e.summary}\n`
})

return msg
}

app.listen(process.env.PORT||3000)
