const OpenAI=require("openai")

const openai=new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

async function smartSchedule(event,text){

const res=await openai.chat.completions.create({
model:"gpt-4o-mini",
messages:[
{
role:"system",
content:"予定タイトルと日時をJSONで出力"
},
{
role:"user",
content:text
}
]
})

return res.choices[0].message.content
}

module.exports={
smartSchedule
}
