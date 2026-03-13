const express=require("express")
const line=require("@line/bot-sdk")

const calendar=require("./calendar")
const ai=require("./ai")
const finance=require("./finance")
const news=require("./news")
const trip=require("./trip")
const notify=require("./notify")

const app=express()

const config={
channelAccessToken:process.env.LINE_ACCESS_TOKEN,
channelSecret:process.env.LINE_CHANNEL_SECRET
}

const client=new line.Client(config)

app.post("/webhook",line.middleware(config),(req,res)=>{
Promise.all(req.body.events.map(handleEvent))
.then(()=>res.end())
.catch(()=>res.status(500).end())
})

async function handleEvent(event){

if(event.type!=="message")return

if(event.message.type==="text"){

const text=event.message.text

if(text==="今日")return calendar.today(event)

if(text==="明日")return calendar.tomorrow(event)

if(text==="来週")return calendar.nextWeek(event)

if(text==="空き")return calendar.free(event)

if(text.startsWith("削除"))return calendar.delete(event,text)

if(text.includes("出張"))return trip.create(event,text)

if(text==="株価")return finance.stock(event)

if(text==="ニュース")return news.latest(event)

if(text==="通知")return notify.status(event)

return ai.smartSchedule(event,text)

}

}

app.listen(process.env.PORT||3000)
