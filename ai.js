const chrono = require("chrono-node")
const calendar = require("./calendar")

// 日本語パーサ使用
const parser = chrono.ja

function cleanText(text) {
  return text
    .replace("予定", "")
    .replace("入れて", "")
    .replace("登録", "")
    .trim()
}

async function chat(client, event, text) {

  try {

    // 前処理
    const input = cleanText(text)

    // 日時解析
    const parsed = parser.parse(input, new Date())

    if (parsed.length > 0) {

      const date = parsed[0].start.date()

      // タイトル抽出（日時部分を除く）
      const title = input.replace(parsed[0].text, "").trim() || "予定"

      await calendar.create(title, date)

      const hour = date.getHours().toString().padStart(2, "0")
      const min = date.getMinutes().toString().padStart(2, "0")

      return client.replyMessage(event.replyToken, {
        type: "text",
        text:
`予定かしこまりました。

${hour}時${min}分
「${title}」ですね。`
      })
    }

    // 認識できない場合
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "日時が認識できませんでした"
    })

  } catch (e) {
    console.error(e)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "処理エラー"
    })
  }
}

module.exports = { chat }
