const express=require("express")
const line=require("@line/bot-sdk")

const ai=require("./ai")
const calendar=require("./calendar")
const finance=require("./finance")
const news=require("./news")
const trip=require("./trip")
const notify=require("./notify")
const meeting=require("./meeting")

const app=express()

const config={
channelAccessToken:process.env.LINE_ACCESS_TOKEN,
channelSecret:process.env.LINE_CHANNEL_SECRET
}

const client=new line.Client(config)

app.post("/webhook",line.middleware(config),(req,res)=>{
Promise.all(req.body.events.map(event=>handleEvent(event)))
.then(()=>res.end())
.catch(()=>res.status(500).end())
})

async function handleEvent(event){

if(event.type!=="message")return

if(event.message.type==="text"){

const text=event.message.text

if(text==="今日")return calendar.today(client,event)

if(text==="明日")return calendar.tomorrow(client,event)

if(text==="来週")return calendar.week(client,event)

if(text==="空き")return calendar.free(client,event)

if(text.startsWith("削除"))return calendar.remove(client,event,text)

if(text.includes("出張"))return trip.create(client,event,text)

if(text==="株価")return finance.stock(client,event)

if(text==="ニュース")return news.latest(client,event)

if(text==="通知")return notify.status(client,event)

return ai.schedule(client,event,text)

}

if(event.message.type==="audio"){
return meeting.minutes(client,event)
}

}

app.listen(process.env.PORT||3000)
