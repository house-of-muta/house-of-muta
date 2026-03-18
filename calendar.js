const {google}=require("googleapis")

const auth=new google.auth.GoogleAuth({
keyFile:"credentials.json",
scopes:["https://www.googleapis.com/auth/calendar"]
})

const cal=google.calendar({version:"v3",auth})
const CALENDAR_ID=process.env.CALENDAR_ID

async function create(title,date){

await cal.events.insert({
calendarId:CALENDAR_ID,
resource:{
summary:title,
start:{dateTime:new Date().toISOString()},
end:{dateTime:new Date(Date.now()+3600000).toISOString()}
}
})
}

async function today(client,event){

const now=new Date()

const res=await cal.events.list({
calendarId:CALENDAR_ID,
timeMin:new Date(now.setHours(0,0,0)).toISOString(),
timeMax:new Date(now.setHours(23,59,59)).toISOString(),
singleEvents:true,
orderBy:"startTime"
})

let msg="今日の予定\n"
res.data.items.forEach((e,i)=>{
msg+=`${i+1}. ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})
}

async function list(client,event){

const now=new Date()

const res=await cal.events.list({
calendarId:CALENDAR_ID,
timeMin:now.toISOString(),
maxResults:10,
singleEvents:true,
orderBy:"startTime"
})

let msg="予定一覧\n"
res.data.items.forEach((e,i)=>{
msg+=`${i+1}. ${e.summary}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})
}

async function remove(client,event,text){

const num=parseInt(text.replace("削除",""))

const res=await cal.events.list({
calendarId:CALENDAR_ID,
maxResults:10,
singleEvents:true,
orderBy:"startTime"
})

const target=res.data.items[num-1]

if(!target)return client.replyMessage(event.replyToken,{type:"text",text:"該当なし"})

await cal.events.delete({
calendarId:CALENDAR_ID,
eventId:target.id
})

return client.replyMessage(event.replyToken,{
type:"text",
text:`削除完了：${target.summary}`
})

}

module.exports={today,list,remove,create}
