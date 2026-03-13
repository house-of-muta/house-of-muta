const axios=require("axios")

async function stock(client,event){

const res=await axios.get("https://query1.finance.yahoo.com/v8/finance/chart/^N225")

const price=res.data.chart.result[0].meta.regularMarketPrice

return client.replyMessage(event.replyToken,{
type:"text",
text:`日経平均\n${price}円`
})

}

module.exports={stock}
