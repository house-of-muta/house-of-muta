const express = require("express")
const line = require("@line/bot-sdk")
const calendar = require("./calendar")
const ai = require("./ai")

const app = express()

const config = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config)

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent))
    res.status(200).end()
  } catch (err) {
    console.error(err)
    res.status(500).end()
  }
})

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return null

  const text = event.message.text.trim()

  // 予定一覧
  if (text === "予定") {
    return calendar.list(client, event)
  }

  // 今日
  if (text === "今日") {
    return calendar.today(client, event)
  }
// 空き時間
if (text.includes("空いてる") || text.includes("空き時間")) {
  return calendar.freeTime(client, event, text)
}
  // 予定登録
  if (text.startsWith("予定追加")) {
    return calendar.add(client, event, text)
  }

  // 削除（複数OK）
  if (text.startsWith("削除")) {
    return calendar.remove(client, event, text)
  }

  // AI会話
  return ai.chat(client, event, text)
}

app.listen(process.env.PORT || 3000, () => {
console.log("SECRET:", process.env.LINE_CHANNEL_SECRET)
  //console.log("server running")
})
