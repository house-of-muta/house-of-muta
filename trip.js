function create(event,text){

const city=text.replace("出張","")

return `${city}出張予定を作成しました`

}

module.exports={create}
