const axios=require("axios")

async function stock(event){

const res=await axios.get(
"https://query1.finance.yahoo.com/v8/finance/chart/^N225"
)

const price=res.data.chart.result[0].meta.regularMarketPrice

return price

}

module.exports={stock}
