const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

app.post("/webhook", line.middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result));
});

function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;

  let replyMessage = "";

  if (userMessage.includes("予約")) {
    replyMessage = "かしこまりました。ご希望日時をお知らせください。";
  } else if (userMessage.includes("相談")) {
    replyMessage = "承りました。内容をお聞かせください。";
  } else {
    replyMessage = "かしこまりました。House of MUTAが承ります。";
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: replyMessage,
  });
}

app.listen(process.env.PORT || 3000, () => {
  console.log("MUTA Private Office is running.");
});
