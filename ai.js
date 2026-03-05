const OpenAI = require("openai")

const openai = new OpenAI({
apiKey:process.env.OPENAI_API_KEY
})

exports.chat = async(text)=>{

const completion = await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[
{
role:"system",
content:"あなたは優秀なAI秘書です。"
},
{
role:"user",
content:text
}
]

})

return completion.choices[0].message.content

}
