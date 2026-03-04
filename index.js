const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");
const chrono = require("chrono-node");
const OpenAI = require("openai");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://house-of-muta.onrender.com/oauth2callback"
);

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const results = await Promise.all(req.body.events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;

  // ===== 予約処理 =====
  if (userMessage.includes("予約")) {
    try {
      const parsedDate = chrono.ja.parseDate(userMessage);

      if (!parsedDate) {
        return reply(event.replyToken, "日時を認識できませんでした。例：予約 明日15時 田中様 初回相談");
      }

      const endDate = new Date(parsedDate.getTime() + 60 * 60 * 1000);

      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      const calendar = google.calendar({
        version: "v3",
        auth: oauth2Client,
      });

      const summary = "LINE予約";
      const description = `
予約者: ${event.source.userId}
内容: ${userMessage}
`;

      await calendar.events.insert({
        calendarId: "primary",
        resource: {
          summary,
          description,
          start: {
            dateTime: parsedDate.toISOString(),
            timeZone: "Asia/Tokyo",
          },
          end: {
            dateTime: endDate.toISOString(),
            timeZone: "Asia/Tokyo",
          },
        },
      });

      // ===== 管理者通知 =====
      await client.pushMessage(process.env.ADMIN_LINE_USER_ID, {
        type: "text",
        text: `📢 新規予約\n日時: ${parsedDate}\n内容: ${userMessage}`,
      });

      return reply(event.replyToken, "予約を登録しました ✅");

    } catch (error) {
      console.error("Calendar Error:", error);
      return reply(event.replyToken, "予約登録に失敗しました。");
    }
  }

  // ===== ChatGPT応答 =====
  try {
    const gpt = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "あなたは高級コンシェルジュ秘書です。" },
        { role: "user", content: userMessage },
      ],
    });

    return reply(event.replyToken, gpt.choices[0].message.content);

  } catch (err) {
    console.error("GPT Error:", err);
    return reply(event.replyToken, "現在AI応答に問題が発生しています。");
  }
}

function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text,
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("MUTA Ultimate Assistant is running.");
});
