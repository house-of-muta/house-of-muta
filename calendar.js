const { google } = require("googleapis")

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/calendar"]
})

const cal = google.calendar({ version: "v3", auth })

const CALENDAR_ID = "primary"
const TZ = "Asia/Tokyo"

// ========================
// 予定作成（AI連携対応）
// ========================
async function create(title, date) {

  await cal.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary: title,
      start: {
        dateTime: date.toISOString(),
        timeZone: TZ
      },
      end: {
        dateTime: new Date(date.getTime() + 60 * 60 * 1000).toISOString(),
        timeZone: TZ
      }
    }
  })
}

// ========================
// 予定一覧
// ========================
async function list(client, event) {

  try {

    const now = new Date()

    const res = await cal.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime"
    })

    if (!res.data.items.length) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "予定はありません"
      })
    }

    let msg = "予定一覧\n"
    global.eventCache = res.data.items

    res.data.items.forEach((e, i) => {

      const time = e.start.dateTime
        ? new Date(e.start.dateTime).toLocaleString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit"
          })
        : "終日"

      msg += `${i + 1}. ${time} ${e.summary}\n`
    })

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: msg
    })

  } catch (e) {
    console.error(e)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "予定取得エラー"
    })
  }
}

// ========================
// 今日の予定
// ========================
async function today(client, event) {

  try {

    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const end = new Date()
    end.setHours(23, 59, 59, 999)

    const res = await cal.events.list({
      calendarId: CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime"
    })

    if (!res.data.items.length) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "今日は予定なし"
      })
    }

    let msg = "今日の予定\n"

    res.data.items.forEach((e, i) => {

      const time = e.start.dateTime
        ? new Date(e.start.dateTime).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit"
          })
        : "終日"

      msg += `${i + 1}. ${time} ${e.summary}\n`
    })

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: msg
    })

  } catch (e) {
    console.error(e)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "取得エラー"
    })
  }
}

// ========================
// 予定削除（複数対応）
// ========================
async function remove(client, event, text) {

  try {

    const nums = text.replace("削除", "").trim().split(" ").map(n => parseInt(n))

    if (!global.eventCache) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "先に「予定」と入力してください"
      })
    }

    let deleted = []

    for (let n of nums) {

      const target = global.eventCache[n - 1]

      if (target) {

        await cal.events.delete({
          calendarId: CALENDAR_ID,
          eventId: target.id
        })

        deleted.push(target.summary)
      }
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `削除完了\n${deleted.join("\n")}`
    })

  } catch (e) {
    console.error(e)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "削除エラー"
    })
  }
}

module.exports = {
  create,
  list,
  today,
  remove
}
