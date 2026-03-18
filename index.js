const express=require("express")
const line=require("@line/bot-sdk")

const calendar=require("./calendar")
const ai=require("./ai")
const task=require("./task")

const app=express()

const config={
channelAccessToken:process.env.LINE_ACCESS_TOKEN,
channelSecret:process.env.LINE_CHANNEL_SECRET
}

const client=new line.Client(config)

app.post("/webhook",line.middleware(config),(req,res)=>{
Promise.all(req.body.events.map(handleEvent))
.then(()=>res.end())
.catch(err=>{
console.error(err)
res.status(500).end()
})
})

async function handleEvent(event){

if(event.type!=="message")return

const text=event.message.text

if(text==="今日")return calendar.today(client,event)
if(text==="予定")return calendar.list(client,event)
if(text.startsWith("削除"))return calendar.remove(client,event,text)

if(text==="タスク")return task.list(client,event)
if(text.startsWith("追加"))return task.add(client,event,text)
if(text.startsWith("完了"))return task.done(client,event,text)

return ai.chat(client,event,text)

}

app.get("/",(req,res)=>res.send("MUTA running"))

app.listen(process.env.PORT||3000)
