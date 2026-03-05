const express = require("express")
const line = require("@line/bot-sdk")

const calendar = require("./calendar")
const sheets = require("./sheets")
const ai = require("./ai")
const parser = require("./parser")

const app = express()

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(config)

app.post("/webhook", line.middleware(config), async (req, res) => {

  const events = req.body.events

  for (const event of events) {
    await handleEvent(event)
  }

  res.status(200).end()
})

async function handleEvent(event) {

  if (event.type !== "message") return

  if (event.message.type !== "text") return

  const text = event.message.text

  console.log("MESSAGE:", text)

  // 解析
  const type = parser.detect(text)

  let reply = ""

  try {

    if (type === "calendar_add") {

      reply = await calendar.add(text)

    } else if (type === "calendar_delete") {

      reply = await calendar.delete(text)

    } else if (type === "task_add") {

      reply = await sheets.addTask(text)

    } else if (type === "task_list") {

      reply = await sheets.listTask()

    } else if (type === "money") {

      reply = await sheets.addMoney(text)

    } else {

      reply = await ai.chat(text)

    }

  } catch (e) {

    console.log(e)

    reply = "処理中にエラーが発生しました"

  }

  return client.replyMessage(event.replyToken,{
    type:"text",
    text:reply
  })

}

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {

  console.log("================================")
  console.log("MUTA AI Secretary Started")
  console.log("PORT:", PORT)
  console.log("================================")

})
// ===============================================
