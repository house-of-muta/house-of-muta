const {google}=require("googleapis")

const auth=new google.auth.GoogleAuth({
keyFile:"credentials.json",
scopes:["https://www.googleapis.com/auth/calendar"]
})

const calendar=google.calendar({version:"v3",auth})

const CALENDAR_ID=process.env.CALENDAR_ID

async function create(client,event,title,datetime){

const start=new Date(datetime)

await calendar.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:title,
start:{dateTime:start.toISOString(),timeZone:"Asia/Tokyo"},
end:{dateTime:new Date(start.getTime()+3600000).toISOString(),timeZone:"Asia/Tokyo"}
}
})

return client.replyMessage(event.replyToken,{
type:"text",
text:`予定登録\n${title}`
})

}

async function today(client,event){

const now=new Date()

const res=await calendar.events.list({
calendarId:CALENDAR_ID,
timeMin:new Date(now.setHours(0,0,0)).toISOString(),
timeMax:new Date(now.setHours(23,59,59)).toISOString(),
singleEvents:true
})

let msg="今日の予定\n"

res.data.items.forEach(e=>{
const d=new Date(e.start.dateTime)
msg+=`${d.getHours()}時 ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

async function week(client,event){

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

module.exports={create,today,week}
