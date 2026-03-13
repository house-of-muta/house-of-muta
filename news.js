const axios=require("axios")

async function latest(client,event){

const res=await axios.get(
`https://newsapi.org/v2/top-headlines?country=jp&apiKey=${process.env.NEWS_API_KEY}`
)

let msg="最新ニュース\n"

res.data.articles.slice(0,5).forEach(n=>{
msg+=`・${n.title}\n`
})

return client.replyMessage(event.replyToken,{type:"text",text:msg})

}

module.exports={latest}
