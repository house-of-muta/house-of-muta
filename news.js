const axios=require("axios")

async function latest(){

const res=await axios.get(
`https://newsapi.org/v2/top-headlines?country=jp&apiKey=${process.env.NEWS_API_KEY}`
)

return res.data.articles.slice(0,5)

}

module.exports={latest}
