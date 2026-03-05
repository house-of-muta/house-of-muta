exports.detect = (text) => {

  if(text.includes("削除")) return "calendar_delete"

  if(text.includes("タスク一覧")) return "task_list"

  if(text.startsWith("タスク")) return "task_add"

  if(/[0-9]+円/.test(text) || /[0-9]+$/.test(text)) return "money"

  if(text.match(/[0-9]月|明日|今日|時/)) return "calendar_add"

  return "ai"

}
