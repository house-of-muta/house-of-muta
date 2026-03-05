<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>MUTA AI秘書</title>

<meta name="viewport" content="width=device-width, initial-scale=1">

<style>

body{
font-family:Arial;
background:#111;
color:white;
margin:0;
padding:0;
}

header{
background:#000;
padding:20px;
text-align:center;
font-size:24px;
}

.container{
padding:20px;
}

.card{
background:#1e1e1e;
padding:20px;
margin-bottom:20px;
border-radius:10px;
}

button{
padding:10px 15px;
border:none;
border-radius:5px;
background:#4CAF50;
color:white;
cursor:pointer;
}

input{
padding:10px;
width:100%;
margin-top:10px;
background:#333;
border:none;
color:white;
}

textarea{
width:100%;
height:100px;
background:#333;
color:white;
border:none;
padding:10px;
}

.todo-item{
display:flex;
justify-content:space-between;
padding:5px;
border-bottom:1px solid #333;
}

.dark-toggle{
position:absolute;
top:20px;
right:20px;
}

</style>
</head>

<body>

<header>
MUTA AI秘書
<button class="dark-toggle" onclick="toggleDark()">🌙</button>
</header>

<div class="container">

<div class="card">
<h2>AIチャット</h2>
<textarea id="chatInput"></textarea>
<button onclick="sendChat()">送信</button>
<div id="chatOutput"></div>
</div>

<div class="card">
<h2>音声入力</h2>
<button onclick="startVoice()">🎤話す</button>
<div id="voiceText"></div>
</div>

<div class="card">
<h2>ToDo</h2>
<input id="todoInput" placeholder="やること">
<button onclick="addTodo()">追加</button>
<div id="todoList"></div>
</div>

<div class="card">
<h2>メモ</h2>
<textarea id="memo"></textarea>
<button onclick="saveMemo()">保存</button>
</div>

<div class="card">
<h2>Googleカレンダー</h2>
<iframe src="https://calendar.google.com/calendar/embed?src=ja.japanese%23holiday%40group.v.calendar.google.com&ctz=Asia%2FTokyo"
style="border:0"
width="100%"
height="300"></iframe>
</div>

</div>

<script>
function toggleDark(){

if(document.body.style.background=="white"){

document.body.style.background="#111"
document.body.style.color="white"

}else{

document.body.style.background="white"
document.body.style.color="black"

}

}

function sendChat(){

let input=document.getElementById("chatInput").value

fetch("https://api.openai.com/v1/chat/completions",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer YOUR_API_KEY"
},

body:JSON.stringify({

model:"gpt-4o-mini",

messages:[
{role:"user",content:input}
]

})

})

.then(r=>r.json())
.then(data=>{

let text=data.choices[0].message.content

document.getElementById("chatOutput").innerHTML+=
"<p>"+text+"</p>"

speak(text)

})

}

function speak(text){

let uttr=new SpeechSynthesisUtterance(text)

uttr.lang="ja-JP"

speechSynthesis.speak(uttr)

}

function startVoice(){

let rec=new webkitSpeechRecognition()

rec.lang="ja-JP"

rec.onresult=function(e){

let text=e.results[0][0].transcript

document.getElementById("voiceText").innerText=text

document.getElementById("chatInput").value=text

}

rec.start()

}

function addTodo(){

let input=document.getElementById("todoInput")

let list=document.getElementById("todoList")

let div=document.createElement("div")

div.className="todo-item"

div.innerHTML=

"<span>"+input.value+"</span><button onclick='this.parentNode.remove()'>削除</button>"

list.appendChild(div)

saveTodo()

input.value=""

}

function saveTodo(){

localStorage.setItem(
"todo",
document.getElementById("todoList").innerHTML
)

}

function loadTodo(){

let data=localStorage.getItem("todo")

if(data){

document.getElementById("todoList").innerHTML=data

}

}

function saveMemo(){

localStorage.setItem(

"memo",
document.getElementById("memo").value

)

}

function loadMemo(){

let data=localStorage.getItem("memo")

if(data){

document.getElementById("memo").value=data

}

}

window.onload=function(){

loadTodo()

loadMemo()

}
// ===== AI自動サジェスト =====

function autoSuggest(){

let todos=document.querySelectorAll(".todo-item span")

let text=""

todos.forEach(t=>{

text+=t.innerText+","

})

if(text.length>0){

fetch("https://api.openai.com/v1/chat/completions",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer YOUR_API_KEY"
},

body:JSON.stringify({

model:"gpt-4o-mini",

messages:[
{
role:"user",
content:"この予定から効率的な行動計画を作って:"+text
}
]

})

})

.then(r=>r.json())
.then(data=>{

let res=data.choices[0].message.content

let div=document.createElement("div")

div.className="card"

div.innerHTML="<h2>AI提案</h2>"+res

document.querySelector(".container").appendChild(div)

})

}

}

setTimeout(autoSuggest,5000)

// ===== AIスケジュール整理 =====

function optimizeDay(){

fetch("https://api.openai.com/v1/chat/completions",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer YOUR_API_KEY"
},

body:JSON.stringify({

model:"gpt-4o-mini",

messages:[
{
role:"user",
content:"今日の最高効率スケジュールを作って"
}
]

})

})

.then(r=>r.json())
.then(data=>{

alert(data.choices[0].message.content)

})

}

// ===== PWA対応 =====

if('serviceWorker' in navigator){

navigator.serviceWorker.register('sw.js')

}

</script>

</body>
</html>
