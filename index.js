// ===============================================
// MUTA AI Secretary System
// LINE × Google Calendar × Render
// Version 2.0
// ===============================================

require('dotenv').config()

const express = require('express')
const line = require('@line/bot-sdk')
const { google } = require('googleapis')

const app = express()

// ===============================================
// LINE設定
// ===============================================

const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
}

const client = new line.Client(lineConfig)

// ===============================================
// Google OAuth
// ===============================================

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
)

auth.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
})

const calendar = google.calendar({
  version: 'v3',
  auth
})

// ===============================================
// 日本時間処理
// ===============================================
function getMinus9Hours(date) {
  // 元のDateオブジェクトを壊さないようにコピーを作成
  const d = new Date(date.getTime());
  
  // 現在の時間から 9 を引く（日付を跨いでもJSが自動調整してくれます）
  d.setHours(d.getHours() - 9);
  
  return d;
}

// 実行例
const now = new Date(); // 20:00 だとしたら
const result = getMinus9Hours(now);
console.log(result); // 11:00 が返る
// ===============================================
// ログ出力
// ===============================================

function log(text) {

  console.log("=================================")
  console.log(new Date())
  console.log(text)
  console.log("=================================")

}

// ===============================================
// LINE Webhook
// ===============================================

app.post('/webhook', line.middleware(lineConfig), (req, res) => {

  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
})

// ===============================================
// メイン処理
// ===============================================

async function handleEvent(event) {

  if (event.type !== 'message') {
    return null
  }

  if (event.message.type !== 'text') {
    return null
  }

  const text = event.message.text

  log("受信: " + text)

  // ============================
  // ヘルプ
  // ============================

  if (text === "ヘルプ") {

    return reply(event.replyToken,

`
AI秘書コマンド

予定登録
例
3月10日 15時 会議

一覧
予定一覧

削除
予定削除
`
)

  }

  // ============================
  // 予定一覧
  // ============================

  if (text === "予定一覧") {

    const list = await getEvents()

    return reply(event.replyToken, list)

  }

  // ============================
  // 予定登録
  // ============================

  const eventData = parseEvent(text)

  if (eventData) {

    const result = await createEvent(eventData)

    return reply(event.replyToken, result)

  }

  return reply(event.replyToken, "理解できませんでした\nヘルプ と入力してください")

}

// ===============================================
// 予定解析
// ===============================================

function parseEvent(text) {

  const match = text.match(/(\d+)月(\d+)日\s*(\d+)時/)

  if (!match) return null

  const month = parseInt(match[1])
  const day = parseInt(match[2])
  const hour = parseInt(match[3])

  const title = text.replace(match[0], '').trim() || "予定"

  return {
    month,
    day,
    hour,
    title
  }

}

// ===============================================
// Googleカレンダー登録
// ===============================================

async function createEvent(data) {

  try {

    const now = new Date()

    const start = new Date(
      now.getFullYear(),
      data.month - 1,
      data.day,
      data.hour,
      0,
      0
    )

    const end = new Date(start)

    end.setHours(start.getHours() + 1)

    log("予定登録")

    const response = await calendar.events.insert({

      calendarId: 'primary',

      resource: {

        summary: data.title,

        start: {

          dateTime: start.toISOString(),
          timeZone: "Asia/Tokyo"

        },

        end: {

          dateTime: end.toISOString(),
          timeZone: "Asia/Tokyo"

        }

      }

    })

    log("登録成功")

    return `予定登録しました

${data.month}月${data.day}日
${data.hour}時
${data.title}`

  } catch (error) {

    console.error(error)

    return "カレンダー登録失敗"

  }

}

// ===============================================
// 予定一覧取得
// ===============================================

async function getEvents() {

  try {

    const now = new Date().toISOString()

    const res = await calendar.events.list({

      calendarId: 'primary',

      timeMin: now,

      maxResults: 10,

      singleEvents: true,

      orderBy: 'startTime'

    })

    const events = res.data.items

    if (events.length === 0) {

      return "予定はありません"

    }

    let text = "今後の予定\n\n"

    events.forEach(e => {

      const start = e.start.dateTime

      text += `${start}\n${e.summary}\n\n`

    })

    return text

  } catch (error) {

    console.error(error)

    return "取得エラー"

  }

}

// ===============================================
// LINE返信
// ===============================================

function reply(token, text) {

  return client.replyMessage(token, {

    type: 'text',

    text: text

  })

}

// ===============================================
// サーバー
// ===============================================

app.get('/', (req, res) => {

  res.send("MUTA AI SECRETARY RUNNING")

})

// ===============================================
// 起動
// ===============================================

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {

  console.log("================================")
  console.log("MUTA AI Secretary Started")
  console.log("PORT:", PORT)
  console.log("================================")

})


// ===============================================
// 未来拡張（未実装）
// ===============================================

// リマインド
// ChatGPT連携
// 予定削除
// 天気連動
// メモ
// 音声入力
// スプレッドシート連携
// 家計簿
// タスク管理
// AI秘書会話

// ===============================================
// END
// ===============================================
