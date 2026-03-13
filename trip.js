function create(client,event,text){

const city=text.replace("出張","")

const msg=`${city}出張予定を作成しました

・出発
・移動
・宿泊
・帰社`

return client.replyMessage(event.replyToken,{
type:"text",
text:msg
})

}

module.exports={create}
