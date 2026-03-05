const { google } = require("googleapis")
const chrono = require("chrono-node")

const auth = new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET
)

auth.setCredentials({
refresh_token:process.env.GOOGLE_REFRESH_TOKEN
})

const calendar = google.calendar({
version:"v3",
auth
})

exports.add = async (text) => {

const result = chrono.parse(text)

if(result.length === 0) return "日時を認識できません"

const start = result[0].start.date()

const end = new Date(start.getTime()+3600000)

const event = {

summary:text,

start:{
dateTime:start.toISOString(),
timeZone:"Asia/Tokyo"
},

end:{
dateTime:end.toISOString(),
timeZone:"Asia/Tokyo"
}

}

await calendar.events.insert({

calendarId:"primary",
resource:event

})

return "予定を登録しました"

}

exports.delete = async () => {

return "削除機能は開発中"

}
