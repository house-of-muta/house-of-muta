const { google } = require("googleapis")

const auth = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET
)

auth.setCredentials({
refresh_token:process.env.GOOGLE_REFRESH_TOKEN
})

const sheets = google.sheets({
version:"v4",
auth
})

const SHEET_ID = process.env.SHEET_ID

exports.addMoney = async(text)=>{

const num = text.match(/[0-9]+/)

if(!num) return "金額が見つかりません"

await sheets.spreadsheets.values.append({

spreadsheetId:SHEET_ID,

range:"money!A:C",

valueInputOption:"RAW",

requestBody:{
values:[[new Date().toLocaleDateString(),text,num[0]]]
}

})

return "家計簿に記録しました"

}

exports.addTask = async(text)=>{

const task = text.replace("タスク","")

await sheets.spreadsheets.values.append({

spreadsheetId:SHEET_ID,

range:"task!A:C",

valueInputOption:"RAW",

requestBody:{
values:[[new Date().toLocaleDateString(),task,"未完了"]]
}

})

return "タスク追加しました"

}

exports.listTask = async()=>{

const res = await sheets.spreadsheets.values.get({

spreadsheetId:SHEET_ID,

range:"task!A:C"

})

const rows = res.data.values

if(!rows) return "タスクなし"

let msg="タスク一覧\n"

rows.forEach(r=>{

msg+=`${r[1]} (${r[2]})\n`

})

return msg

}
