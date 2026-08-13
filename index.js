require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const line = require("@line/bot-sdk");

const app = express();

const lineConfig = {
  channelAccessToken:
    process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(lineConfig);

app.use(helmet());
app.use(morgan("combined"));

app.get("/", (_req, res) => {
  res.json({
    name: "MUTA Farm AI",
    status: "ok",
    message: "LINE receipt OCR farm bookkeeping system is running",
    webhook: "/webhook",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleEvent));
    res.status(200).end();
  } catch (error) {
    console.error(error);
    res.status(200).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message") return null;

  if (event.message.type === "image") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "画像を受信しました。\n次の段階でOCR・AI解析・Excel記帳へ接続します。\ncredentials.jsonは使用しない構成です。",
    });
  }

  if (event.message.type === "text") {
    const text = event.message.text.trim();

    if (text.includes("利益")) {
      return reply(event, "利益集計機能へ接続予定です。");
    }

    if (text.includes("売上")) {
      return reply(event, "売上集計機能へ接続予定です。");
    }

    if (text.includes("経費")) {
      return reply(event, "経費集計機能へ接続予定です。");
    }

    return reply(
      event,
      "MUTA Farm AIです。\nレシート・納品書・領収書・売上伝票の写真を送ってください。"
    );
  }

  return reply(event, "画像または文字メッセージを送ってください。");
}

function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text,
  });
}

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`MUTA Farm AI listening on port ${port}`);
});
  //console.log("server running")
})
