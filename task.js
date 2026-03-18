let tasks=[]

function add(client,event,text){
const t=text.replace("追加","")
tasks.push({title:t,done:false})
return client.replyMessage(event.replyToken,{type:"text",text:`追加：${t}`})
}

function list(client,event){
let msg="タスク\n"
tasks.forEach((t,i)=>{
msg+=`${i+1}. ${t.done?"✔":"□"} ${t.title}\n`
})
return client.replyMessage(event.replyToken,{type:"text",text:msg})
}

function done(client,event,text){
const num=parseInt(text.replace("完了",""))
if(tasks[num-1])tasks[num-1].done=true
return client.replyMessage(event.replyToken,{type:"text",text:"完了"})
}

module.exports={add,list,done}
