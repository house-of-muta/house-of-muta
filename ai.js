const OpenAI=require("openai")
const calendar=require("./calendar")

const openai=new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

async function schedule(client,event,text){

const res=await openai.chat.completions.create({
model:"gpt-4o-mini",
messages:[
{
role:"system",
content:"予定タイトルと日時をJSONで出力 {title:'',datetime:''}"
},
{
role:"user",
content:text
}
]
})

let data

try{
data=JSON.parse(res.choices[0].message.content)
}catch{
return client.replyMessage(event.replyToken,{type:"text",text:"予定理解できません"})
}

return calendar.create(client,event,data.title,data.datetime)

}

module.exports={schedule}
