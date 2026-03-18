const { google } = require("googleapis")

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/calendar"]
})

const cal = google.calendar({ version: "v3", auth })
const CALENDAR_ID = "primary"

// 予定一覧
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

// 今日
async function today(client, event) {
  try {
    const start = new Date()
    start.setHours(0,0,0,0)

    const end = new Date()
    end.setHours(23,59,59,999)

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
  }
}

// 追加
async function add(client, event, text) {
  try {
    // 例: 予定追加 2026-03-20 12:00 会議
    const parts = text.split(" ")
    const date = parts[1]
    const time = parts[2]
    const title = parts.slice(3).join(" ")

    const start = new Date(`${date}T${time}:00+09:00`)
    const end = new Date(start.getTime() + 60 * 60 * 1000)

    await cal.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: title,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() }
      }
    })

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "予定登録しました"
    })
  } catch (e) {
    console.error(e)
  }
}

// 削除（複数OK）
async function remove(client, event, text) {
  try {
    const nums = text.replace("削除", "").trim().split(" ").map(n => parseInt(n))

    if (!global.eventCache) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "先に予定一覧を表示してください"
      })
    }

    for (let n of nums) {
      const target = global.eventCache[n - 1]
      if (target) {
        await cal.events.delete({
          calendarId: CALENDAR_ID,
          eventId: target.id
        })
      }
    }

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "削除しました"
    })
  } catch (e) {
    console.error(e)
  }
}

module.exports = { list, today, add, remove }
