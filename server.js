const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const roles = ["Presidente", "Deputado(a)", "Senador(a)", "Governador(a)", "Banco Central", "População"];
// Consequências didáticas fictícias: servem para discussão em sala, não são previsões econômicas.
const challengeBank = [
  {id:"inflacao",title:"Inflação dos alimentos",area:"Economia",level:1,levelName:"Fácil",brief:"Os preços dos alimentos subiram rapidamente. Famílias estão tendo dificuldade para fazer compras. O governo precisa propor medidas para aliviar o custo de vida sem criar novos problemas.",goal:"Reduzir a pressão sobre o custo de vida e proteger famílias de baixa renda.",success:{inflation:-1.2,unemployment:0.1,approval:4,budget:-8},failure:{inflation:0.8,unemployment:0.2,approval:-4,budget:-3}},
  {id:"escolas",title:"Escolas precisando de melhorias",area:"Educação",level:1,levelName:"Fácil",brief:"Escolas públicas precisam de materiais, manutenção e melhorias. O orçamento é limitado e será necessário escolher prioridades.",goal:"Melhorar as condições das escolas usando os recursos disponíveis.",success:{inflation:0,unemployment:-0.2,approval:4,budget:-7},failure:{inflation:0,unemployment:0,approval:-3,budget:-5}},
  {id:"saneamento",title:"Falta de saneamento básico",area:"Infraestrutura",level:1,levelName:"Fácil",brief:"Bairros não têm coleta e tratamento de esgoto adequados. Isso prejudica a saúde e o meio ambiente. As obras custam caro e levam tempo.",goal:"Ampliar o acesso ao saneamento e priorizar áreas vulneráveis.",success:{inflation:0.1,unemployment:-0.4,approval:4,budget:-9},failure:{inflation:0.1,unemployment:0.1,approval:-3,budget:-6}},
  {id:"desemprego",title:"Desemprego em alta",area:"Trabalho",level:2,levelName:"Médio",brief:"Empresas estão contratando menos e muitas famílias perderam renda. O governo discute qual combinação de qualificação, incentivo e investimento pode gerar trabalho.",goal:"Criar oportunidades de trabalho sem comprometer excessivamente o orçamento.",success:{inflation:0.2,unemployment:-1.1,approval:4,budget:-10},failure:{inflation:0.3,unemployment:0.7,approval:-4,budget:-4}},
  {id:"hospital",title:"Hospitais lotados",area:"Saúde",level:2,levelName:"Médio",brief:"Hospitais enfrentam filas, falta de profissionais e demora em exames. O governo precisa decidir entre contratar, reorganizar serviços e investir em prevenção.",goal:"Reduzir filas e melhorar o atendimento, priorizando medidas viáveis.",success:{inflation:0,unemployment:-0.2,approval:5,budget:-10},failure:{inflation:0.1,unemployment:0,approval:-5,budget:-6}},
  {id:"seca",title:"Crise hídrica",area:"Meio ambiente",level:2,levelName:"Médio",brief:"Uma seca prolongada reduziu os reservatórios. Cidades, agricultores e indústrias disputam água. Medidas emergenciais precisam ser combinadas com planejamento.",goal:"Garantir água para a população e reduzir desperdícios.",success:{inflation:-0.2,unemployment:0.1,approval:4,budget:-8},failure:{inflation:0.6,unemployment:0.3,approval:-5,budget:-5}},
  {id:"seguranca",title:"Aumento da violência",area:"Segurança",level:3,levelName:"Difícil",brief:"A população cobra respostas para o aumento da violência. Há pressão por policiamento, investigação, prevenção social e melhoria urbana, mas os recursos são limitados.",goal:"Combinar segurança imediata com prevenção e respeito aos direitos.",success:{inflation:0,unemployment:-0.3,approval:5,budget:-11},failure:{inflation:0,unemployment:0.2,approval:-6,budget:-6}},
  {id:"contas",title:"Orçamento público no vermelho",area:"Finanças públicas",level:3,levelName:"Difícil",brief:"As despesas estão maiores que as receitas. Cortar gastos pode afetar serviços; aumentar tributos pode pesar sobre famílias e empresas. O governo precisa apresentar um plano equilibrado.",goal:"Reduzir o desequilíbrio sem abandonar serviços essenciais.",success:{inflation:-0.3,unemployment:0.2,approval:3,budget:5},failure:{inflation:0.5,unemployment:0.4,approval:-6,budget:-8}},
  {id:"amazonia",title:"Desmatamento e desenvolvimento",area:"Meio ambiente",level:3,levelName:"Difícil",brief:"O desmatamento aumenta em uma região que também precisa de emprego e renda. O governo deve conciliar fiscalização, atividades sustentáveis e apoio às comunidades locais.",goal:"Reduzir o desmatamento e criar alternativas econômicas sustentáveis.",success:{inflation:0.1,unemployment:-0.2,approval:5,budget:-9},failure:{inflation:0.2,unemployment:0.2,approval:-5,budget:-5}}
];
function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function publicRoom(r) {
  return {code:r.code,year:r.year,phase:r.phase,indicators:r.indicators,
    people:[...r.people.values()].map(p=>({id:p.id,name:p.name,role:p.role,isTeacher:p.isTeacher})),
    proposal:r.proposal,votes:r.votes,history:r.history.slice(-30),challenge:r.challenge,lastResult:r.lastResult};
}
function emitRoom(r) { io.to(r.code).emit("room:update",publicRoom(r)); }
function log(r,msg) { r.history.push({time:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}),msg}); }
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function applyEffects(r,e){
  r.indicators.inflation=+clamp(r.indicators.inflation+(e.inflation||0),0,30).toFixed(1);
  r.indicators.unemployment=+clamp(r.indicators.unemployment+(e.unemployment||0),0,30).toFixed(1);
  r.indicators.approval=+clamp(r.indicators.approval+(e.approval||0),0,100).toFixed(0);
  r.indicators.budget=+clamp(r.indicators.budget+(e.budget||0),0,150).toFixed(1);
}
function teacherRoom(socket){return [...rooms.values()].find(x=>x.teacherId===socket.id);}
function memberRoom(socket){return [...rooms.values()].find(x=>x.people.has(socket.id));}

io.on("connection", socket => {
  socket.on("room:create", ({name}, cb) => {
    let c; do { c=code(); } while(rooms.has(c));
    const r={code:c,teacherId:socket.id,year:1,phase:"Debate",people:new Map(),
      indicators:{inflation:4.5,unemployment:8.0,approval:55,budget:100},proposal:null,votes:{},history:[],challenge:null,lastResult:null};
    r.people.set(socket.id,{id:socket.id,name:(name||"Professor").trim().slice(0,30)||"Professor",role:"Professor",isTeacher:true});
    rooms.set(c,r);socket.join(c);log(r,"Sala criada pelo professor.");emitRoom(r);cb?.({ok:true,room:publicRoom(r)});
  });
  socket.on("room:join", ({code:c,name}, cb) => {
    const r=rooms.get((c||"").toUpperCase());if(!r)return cb?.({ok:false,error:"Sala não encontrada. Confira o código."});
    const clean=(name||"").trim().slice(0,30);if(!clean)return cb?.({ok:false,error:"Digite seu nome."});
    if([...r.people.values()].some(p=>p.name.toLowerCase()===clean.toLowerCase()&&!p.isTeacher))return cb?.({ok:false,error:"Esse nome já está na sala. Escolha outro."});
    r.people.set(socket.id,{id:socket.id,name:clean,role:"População",isTeacher:false});socket.join(r.code);log(r,clean+" entrou na sala.");emitRoom(r);cb?.({ok:true,room:publicRoom(r)});
  });
  socket.on("room:rejoin",({code:c},cb)=>{const r=rooms.get((c||"").toUpperCase());if(!r||!r.people.has(socket.id))return cb?.({ok:false});socket.join(r.code);cb?.({ok:true,room:publicRoom(r)});});
  socket.on("challenge:start",({id,title,area,brief,goal,level},cb)=>{
    const r=teacherRoom(socket);if(!r)return cb?.({ok:false,error:"Somente o professor pode iniciar desafios."});
    let ch=challengeBank.find(x=>x.id===id);
    if(!ch){const t=(title||"").trim().slice(0,90),b=(brief||"").trim().slice(0,700),g=(goal||"").trim().slice(0,250);if(!t||!b)return cb?.({ok:false,error:"Informe o título e a descrição do desafio."});ch={id:"custom",title:t,area:(area||"Geral").slice(0,40),brief:b,goal:g||"Debater e apresentar uma solução viável.",level:Number(level)||1,levelName:["","Fácil","Médio","Difícil"][Number(level)]||"Fácil",success:{inflation:-0.3,unemployment:-0.2,approval:3,budget:-5},failure:{inflation:0.3,unemployment:0.2,approval:-3,budget:-2}};}
    r.challenge={id:ch.id,title:ch.title,area:ch.area,brief:ch.brief,goal:ch.goal,level:ch.level,levelName:ch.levelName};
    r.proposal=null;r.votes={};r.lastResult=null;r.phase="Debate";log(r,"Novo desafio iniciado: "+ch.title+".");emitRoom(r);cb?.({ok:true});
  });
  socket.on("challenge:clear",cb=>{const r=teacherRoom(socket);if(!r)return cb?.({ok:false});r.challenge=null;r.lastResult=null;log(r,"Desafio encerrado pelo professor.");emitRoom(r);cb?.({ok:true});});
  socket.on("teacher:assign",({targetId,role},cb)=>{const r=teacherRoom(socket);if(!r||!roles.includes(role))return cb?.({ok:false});const p=r.people.get(targetId);if(!p||p.isTeacher)return cb?.({ok:false});p.role=role;log(r,p.name+" recebeu o cargo: "+role+".");emitRoom(r);cb?.({ok:true});});
  socket.on("proposal:submit",({text},cb)=>{const r=memberRoom(socket);if(!r)return cb?.({ok:false,error:"Entre em uma sala primeiro."});const p=r.people.get(socket.id);if(p.role!=="Presidente"&&!p.isTeacher)return cb?.({ok:false,error:"Somente o presidente pode apresentar uma proposta nesta versão."});const body=(text||"").trim().slice(0,700);if(!body)return cb?.({ok:false,error:"Escreva a proposta."});r.proposal={text:body,author:p.name,status:"Em análise"};r.votes={};r.phase="Debate";log(r,"Nova proposta apresentada por "+p.name+".");emitRoom(r);cb?.({ok:true});});
  socket.on("vote:open",cb=>{const r=teacherRoom(socket);if(!r||!r.proposal)return cb?.({ok:false,error:"Apresente uma proposta primeiro."});r.votes={};r.proposal.status="Votação aberta";r.phase="Votação";log(r,"Votação aberta.");emitRoom(r);cb?.({ok:true});});
  socket.on("vote:cast",({choice},cb)=>{const r=memberRoom(socket);if(!r||r.phase!=="Votação"||!["sim","nao","abstencao"].includes(choice))return cb?.({ok:false,error:"A votação não está aberta."});const p=r.people.get(socket.id);if(p.isTeacher)return cb?.({ok:false,error:"Professor acompanha, mas não vota."});r.votes[socket.id]=choice;log(r,p.name+" registrou seu voto.");emitRoom(r);cb?.({ok:true});});
  socket.on("vote:close",cb=>{const r=teacherRoom(socket);if(!r||!r.proposal)return cb?.({ok:false});const tally={sim:0,nao:0,abstencao:0};Object.values(r.votes).forEach(v=>tally[v]++);const passed=tally.sim>tally.nao;r.proposal.status=passed?"Aprovada":"Rejeitada";
    if(r.challenge){const ch=challengeBank.find(x=>x.id===r.challenge.id);const effects=ch? (passed?ch.success:ch.failure): (passed?{inflation:-0.3,unemployment:-0.2,approval:3,budget:-5}:{inflation:0.3,unemployment:0.2,approval:-3,budget:-2});applyEffects(r,effects);r.lastResult={passed,effects,challengeTitle:r.challenge.title};log(r,"Consequências didáticas aplicadas ao desafio: "+r.challenge.title+".");}
    else if(passed){applyEffects(r,{budget:-5,approval:2});}else{applyEffects(r,{approval:-1});}
    log(r,"Votação encerrada: "+tally.sim+" a favor, "+tally.nao+" contra, "+tally.abstencao+" abstenções. Projeto "+(passed?"aprovado":"rejeitado")+".");r.phase="Debate";emitRoom(r);cb?.({ok:true,tally});});
  socket.on("year:next",cb=>{const r=teacherRoom(socket);if(!r)return cb?.({ok:false});if(r.year>=4){log(r,"Mandato de quatro anos concluído.");r.phase="Mandato encerrado";}else{r.year++;const drift=(Math.random()-.5)*1.2;r.indicators.inflation=Math.max(0,+(r.indicators.inflation+drift).toFixed(1));r.indicators.unemployment=Math.max(2,+(r.indicators.unemployment+(Math.random()-.5)*.8).toFixed(1));r.indicators.budget=Math.max(0,+(r.indicators.budget-8).toFixed(1));log(r,"Início do ano "+r.year+" do mandato. Evento econômico simulado: variação de mercado.");r.phase="Debate";}emitRoom(r);cb?.({ok:true});});
  socket.on("teacher:remove",({targetId},cb)=>{const r=teacherRoom(socket);if(!r||!r.people.has(targetId)||targetId===r.teacherId)return cb?.({ok:false});const target=io.sockets.sockets.get(targetId);if(target){target.emit("room:removed");target.leave(r.code);}const name=r.people.get(targetId).name;r.people.delete(targetId);delete r.votes[targetId];log(r,name+" foi removido da sala pelo professor.");emitRoom(r);cb?.({ok:true});});
  socket.on("disconnect",()=>{for(const r of rooms.values())if(r.people.has(socket.id)){const p=r.people.get(socket.id);if(p.isTeacher)log(r,"Professor desconectado. A sala permanece ativa temporariamente.");else{r.people.delete(socket.id);delete r.votes[socket.id];log(r,p.name+" saiu da sala.");}emitRoom(r);}});
});
const port=process.env.PORT||3000;server.listen(port,"0.0.0.0",()=>console.log("Brasil em Jogo rodando na porta "+port));
