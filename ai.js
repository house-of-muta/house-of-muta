const OpenAI = require("openai")
const calendar = require("./calendar")
const chrono = require("chrono-node")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

async function chat(client, event, text) {

  // ✅ 時間解析（自然言語）
  const parsedDate = chrono.parseDate(text, new Date())

  if (parsedDate) {
    try {
      await calendar.create(text, parsedDate)

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `予定登録：${text}`
      })
    } catch (e) {
      console.error(e)
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "予定登録エラー"
      })
    }
  }

  // ✅ 通常AI
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: text }]
    })

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: res.choices[0].message.content
    })

  } catch (e) {
    console.error(e)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "AI応答エラー"
    })
  }
}

module.exports = { chat }
