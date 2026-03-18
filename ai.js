const OpenAI=require("openai")
const calendar=require("./calendar")

const openai=new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

async function chat(client,event,text){

if(text.includes("時")){
await calendar.create(text,new Date())

return client.replyMessage(event.replyToken,{
type:"text",
text:`予定登録：${text}`
})
}

try{
const res=await openai.chat.completions.create({
model:"gpt-4o-mini",
messages:[{role:"user",content:text}]
})

return client.replyMessage(event.replyToken,{
type:"text",
text:res.choices[0].message.content
})
}catch{
return client.replyMessage(event.replyToken,{
type:"text",
text:"AI応答エラー"
})
}

}

module.exports={chat}
