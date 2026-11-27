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

function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function publicRoom(r) {
  return {
    code: r.code, year: r.year, phase: r.phase, indicators: r.indicators,
    people: [...r.people.values()].map(p => ({id:p.id, name:p.name, role:p.role, isTeacher:p.isTeacher})),
    proposal: r.proposal, votes: r.votes, history: r.history.slice(-30)
  };
}
function emitRoom(r) { io.to(r.code).emit("room:update", publicRoom(r)); }
function log(r, msg) { r.history.push({time:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}), msg}); }

io.on("connection", socket => {
  socket.on("room:create", ({name}, cb) => {
    let c; do { c = code(); } while (rooms.has(c));
    const r = {code:c, teacherId:socket.id, year:1, phase:"Debate", people:new Map(),
      indicators:{inflation:4.5, unemployment:8.0, approval:55, budget:100},
      proposal:null, votes:{}, history:[]};
    r.people.set(socket.id,{id:socket.id,name:(name||"Professor").slice(0,30),role:"Professor",isTeacher:true});
    rooms.set(c,r); socket.join(c); log(r,"Sala criada pelo professor."); emitRoom(r);
    cb({ok:true, room:publicRoom(r)});
  });

  socket.on("room:join", ({code:c,name}, cb) => {
    const r=rooms.get((c||"").toUpperCase());
    if (!r) return cb({ok:false,error:"Sala não encontrada. Confira o código."});
    const clean=(name||"").trim().slice(0,30);
    if (!clean) return cb({ok:false,error:"Digite seu nome."});
    if ([...r.people.values()].some(p=>p.name.toLowerCase()===clean.toLowerCase() && !p.isTeacher))
      return cb({ok:false,error:"Esse nome já está na sala. Escolha outro."});
    r.people.set(socket.id,{id:socket.id,name:clean,role:"População",isTeacher:false});
    socket.join(r.code); log(r,clean+" entrou na sala."); emitRoom(r);
    cb({ok:true,room:publicRoom(r)});
  });

  socket.on("room:rejoin", ({code:c}, cb) => {
    const r=rooms.get((c||"").toUpperCase());
    if(!r || !r.people.has(socket.id)) return cb({ok:false});
    socket.join(r.code); cb({ok:true,room:publicRoom(r)});
  });

  socket.on("teacher:assign", ({targetId,role}, cb) => {
    const r=[...rooms.values()].find(x=>x.teacherId===socket.id);
    if(!r || !roles.includes(role)) return cb?.({ok:false});
    const p=r.people.get(targetId); if(!p || p.isTeacher) return cb?.({ok:false});
    p.role=role; log(r,p.name+" recebeu o cargo: "+role+"."); emitRoom(r); cb?.({ok:true});
  });

  socket.on("proposal:submit", ({text}, cb) => {
    const r=[...rooms.values()].find(x=>x.people.has(socket.id));
    if(!r) return cb?.({ok:false,error:"Entre em uma sala primeiro."});
    const p=r.people.get(socket.id);
    if(p.role!=="Presidente" && !p.isTeacher) return cb?.({ok:false,error:"Somente o presidente pode apresentar uma proposta nesta versão."});
    const body=(text||"").trim().slice(0,700);
    if(!body) return cb?.({ok:false,error:"Escreva a proposta."});
    r.proposal={text:body,author:p.name,status:"Em análise"};
    r.votes={}; r.phase="Debate"; log(r,"Nova proposta apresentada por "+p.name+"."); emitRoom(r); cb?.({ok:true});
  });

  socket.on("vote:open", cb => {
    const r=[...rooms.values()].find(x=>x.teacherId===socket.id);
    if(!r || !r.proposal) return cb?.({ok:false,error:"Apresente uma proposta primeiro."});
    r.votes={}; r.proposal.status="Votação aberta"; r.phase="Votação";
    log(r,"Votação aberta."); emitRoom(r); cb?.({ok:true});
  });

  socket.on("vote:cast", ({choice}, cb) => {
    const r=[...rooms.values()].find(x=>x.people.has(socket.id));
    if(!r || r.phase!=="Votação" || !["sim","nao","abstencao"].includes(choice))
      return cb?.({ok:false,error:"A votação não está aberta."});
    const p=r.people.get(socket.id);
    if(p.isTeacher) return cb?.({ok:false,error:"Professor acompanha, mas não vota."});
    r.votes[socket.id]=choice; log(r,p.name+" registrou seu voto."); emitRoom(r); cb?.({ok:true});
  });

  socket.on("vote:close", cb => {
    const r=[...rooms.values()].find(x=>x.teacherId===socket.id);
    if(!r || !r.proposal) return cb?.({ok:false});
    const tally={sim:0,nao:0,abstencao:0};
    Object.values(r.votes).forEach(v=>tally[v]++);
    const passed=tally.sim>tally.nao;
    r.proposal.status=passed?"Aprovada":"Rejeitada";
    if(passed) {
      r.indicators.budget=Math.max(0,r.indicators.budget-5);
      r.indicators.approval=Math.min(100,r.indicators.approval+2);
    } else r.indicators.approval=Math.max(0,r.indicators.approval-1);
    log(r,"Votação encerrada: "+tally.sim+" a favor, "+tally.nao+" contra, "+tally.abstencao+" abstenções. Projeto "+(passed?"aprovado":"rejeitado")+".");
    r.phase="Debate"; emitRoom(r); cb?.({ok:true,tally});
  });

  socket.on("year:next", cb => {
    const r=[...rooms.values()].find(x=>x.teacherId===socket.id);
    if(!r) return cb?.({ok:false});
    if(r.year>=4) { log(r,"Mandato de quatro anos concluído."); r.phase="Mandato encerrado"; }
    else {
      r.year++;
      const drift=(Math.random()-.5)*1.2;
      r.indicators.inflation=Math.max(0,+(r.indicators.inflation+drift).toFixed(1));
      r.indicators.unemployment=Math.max(2,+(r.indicators.unemployment+(Math.random()-.5)*.8).toFixed(1));
      r.indicators.budget=Math.max(0,+(r.indicators.budget-8).toFixed(1));
      log(r,"Início do ano "+r.year+" do mandato. Evento econômico simulado: variação de mercado.");
      r.phase="Debate";
    }
    emitRoom(r); cb?.({ok:true});
  });

  socket.on("teacher:remove", ({targetId}, cb) => {
    const r=[...rooms.values()].find(x=>x.teacherId===socket.id);
    if(!r || !r.people.has(targetId) || targetId===r.teacherId) return cb?.({ok:false});
    const target=io.sockets.sockets.get(targetId);
    if(target){ target.emit("room:removed"); target.leave(r.code); }
    const name=r.people.get(targetId).name; r.people.delete(targetId); delete r.votes[targetId];
    log(r,name+" foi removido da sala pelo professor."); emitRoom(r); cb?.({ok:true});
  });

  socket.on("disconnect", () => {
    for(const r of rooms.values()) {
      if(r.people.has(socket.id)) {
        const p=r.people.get(socket.id);
        if(p.isTeacher) { log(r,"Professor desconectado. A sala permanece ativa temporariamente."); }
        else { r.people.delete(socket.id); delete r.votes[socket.id]; log(r,p.name+" saiu da sala."); }
        emitRoom(r);
      }
    }
  });
});

const port=process.env.PORT || 3000;
server.listen(port,"0.0.0.0",()=>console.log("Brasil em Jogo rodando na porta "+port));
