const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.send("ok"));

const ROLES = ["Presidente", "Deputado(a)", "Senador(a)", "Governador(a)", "Banco Central", "População"];
const MAX_PEOPLE = 60;
const ROOM_TTL = 6 * 60 * 60 * 1000;
const LIMITS = { inflation: [0, 30], unemployment: [2, 30], approval: [0, 100], budget: [0, 200], selic: [2, 20] };
const FX_NAMES = { budget: "orçamento", approval: "aprovação", inflation: "inflação", unemployment: "desemprego" };
const CATEGORIES = {
  educacao:   { label: "Educação",            fx: { budget: -6, approval: 3, unemployment: -0.2 } },
  saude:      { label: "Saúde",               fx: { budget: -6, approval: 4 } },
  emprego:    { label: "Emprego e indústria", fx: { budget: -5, approval: 2, unemployment: -0.6, inflation: 0.3 } },
  seguranca:  { label: "Segurança",           fx: { budget: -4, approval: 2 } },
  impostos:   { label: "Aumento de arrecadação", fx: { budget: 8, approval: -3, inflation: 0.2 } },
  austeridade:{ label: "Corte de gastos",     fx: { budget: 5, approval: -2, unemployment: 0.3, inflation: -0.3 } },
  outro:      { label: "Outro",               fx: { budget: -3, approval: 1 } },
};

const rooms = new Map();
const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));
const round1 = v => Math.round(v * 10) / 10;
const newId = () => crypto.randomBytes(6).toString("hex");
const newToken = () => crypto.randomBytes(16).toString("hex");
function newCode() { let c; do { c = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(c)); return c; }

function log(r, msg) {
  r.history.push({ time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }), msg });
  if (r.history.length > 200) r.history.shift();
}
function publicRoom(r) {
  return {
    code: r.code, year: r.year, phase: r.phase, indicators: r.indicators,
    categories: Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label })),
    people: [...r.people.values()].map(p => ({ id: p.id, name: p.name, role: p.role, isTeacher: p.isTeacher, online: p.online, voted: p.id in r.votes })),
    proposal: r.proposal,
    votesCount: Object.keys(r.votes).length,            // votos individuais nunca saem do servidor
    tally: r.phase === "Votação" ? null : r.lastTally,  // placar só aparece após apurar
    history: r.history.slice(-30),
  };
}
const emitRoom = r => io.to(r.code).emit("room:update", publicRoom(r));

function applyFx(r, fx) {
  for (const [k, v] of Object.entries(fx)) r.indicators[k] = round1(clamp(r.indicators[k] + v, LIMITS[k]));
}
function economyStep(r) {
  const i = r.indicators, gap = i.selic - 10; // juros altos: menos inflação, mais desemprego
  i.inflation = round1(clamp(i.inflation - gap * 0.15 + (Math.random() - 0.5) * 1.2, LIMITS.inflation));
  i.unemployment = round1(clamp(i.unemployment + gap * 0.1 + (Math.random() - 0.5) * 0.8, LIMITS.unemployment));
  i.budget = round1(clamp(i.budget - 8, LIMITS.budget));
  let a = 0;
  if (i.inflation > 6) a -= 2; else if (i.unemployment < 8) a += 1;
  if (i.unemployment > 10) a -= 2;
  if (i.budget <= 0) a -= 3;
  i.approval = round1(clamp(i.approval + a, LIMITS.approval));
}

io.on("connection", socket => {
  // aceita (dados, cb) ou só (cb); nunca quebra o servidor por payload inválido
  const on = (event, fn) => socket.on(event, (a, b) => {
    const cb = typeof a === "function" ? a : typeof b === "function" ? b : () => {};
    const data = a && typeof a === "object" ? a : {};
    try { fn(data, cb); } catch (err) { console.error(event, err); cb({ ok: false, error: "Erro interno." }); }
  });
  const me = () => {
    const r = rooms.get(socket.data.room), p = r && r.people.get(socket.data.pid);
    if (r) r.last = Date.now();
    return p ? { r, p } : {};
  };
  const teacher = () => { const x = me(); return x.p && x.p.isTeacher ? x : {}; };
  const attach = (r, p) => { p.socketId = socket.id; p.online = true; socket.data = { room: r.code, pid: p.id }; socket.join(r.code); };

  on("room:create", ({ name }, cb) => {
    const r = { code: newCode(), year: 1, phase: "Debate", people: new Map(), votes: {}, proposal: null, lastTally: null, history: [], last: Date.now(),
      indicators: { inflation: 4.5, unemployment: 8, approval: 55, budget: 100, selic: 10.5 } };
    const p = { id: newId(), token: newToken(), name: String(name || "").trim().slice(0, 30) || "Professor", role: "Professor", isTeacher: true };
    r.people.set(p.id, p); rooms.set(r.code, r); attach(r, p);
    log(r, "Sala criada pelo professor."); emitRoom(r);
    cb({ ok: true, room: publicRoom(r), me: { id: p.id, token: p.token } });
  });

  on("room:join", ({ code, name }, cb) => {
    const r = rooms.get(String(code || "").trim().toUpperCase());
    if (!r) return cb({ ok: false, error: "Sala não encontrada. Confira o código." });
    const clean = String(name || "").trim().slice(0, 30);
    if (!clean) return cb({ ok: false, error: "Digite seu nome." });
    if (r.people.size >= MAX_PEOPLE) return cb({ ok: false, error: "A sala está cheia." });
    if ([...r.people.values()].some(p => !p.isTeacher && p.name.toLowerCase() === clean.toLowerCase()))
      return cb({ ok: false, error: "Esse nome já está na sala. Escolha outro." });
    const p = { id: newId(), token: newToken(), name: clean, role: "População", isTeacher: false };
    r.people.set(p.id, p); attach(r, p); r.last = Date.now();
    log(r, clean + " entrou na sala."); emitRoom(r);
    cb({ ok: true, room: publicRoom(r), me: { id: p.id, token: p.token } });
  });

  // volta à sala após recarregar a página ou perder a conexão (ex.: celular bloqueou a tela)
  on("room:rejoin", ({ code, id, token }, cb) => {
    const r = rooms.get(String(code || "").toUpperCase());
    const p = r && r.people.get(String(id || ""));
    if (!p || p.token !== token) return cb({ ok: false });
    attach(r, p); r.last = Date.now(); emitRoom(r);
    cb({ ok: true, room: publicRoom(r), me: { id: p.id }, isTeacher: p.isTeacher });
  });

  on("teacher:assign", ({ targetId, role }, cb) => {
    const { r } = teacher(); const p = r && r.people.get(targetId);
    if (!p || p.isTeacher || !ROLES.includes(role)) return cb({ ok: false });
    p.role = role; log(r, p.name + " recebeu o cargo: " + role + "."); emitRoom(r); cb({ ok: true });
  });

  on("teacher:remove", ({ targetId }, cb) => {
    const { r } = teacher(); const t = r && r.people.get(targetId);
    if (!t || t.isTeacher) return cb({ ok: false });
    const s = io.sockets.sockets.get(t.socketId);
    if (s) { s.emit("room:removed"); s.leave(r.code); s.data = {}; }
    r.people.delete(targetId); delete r.votes[targetId];
    log(r, t.name + " foi removido da sala pelo professor."); emitRoom(r); cb({ ok: true });
  });

  on("proposal:submit", ({ text, category }, cb) => {
    const { r, p } = me();
    if (!p) return cb({ ok: false, error: "Entre em uma sala primeiro." });
    if (p.role !== "Presidente" && !p.isTeacher) return cb({ ok: false, error: "Somente o presidente pode apresentar uma proposta nesta versão." });
    if (r.phase !== "Debate") return cb({ ok: false, error: r.phase === "Votação" ? "Espere a votação terminar." : "O mandato já acabou." });
    const body = String(text || "").trim().slice(0, 700);
    if (!body) return cb({ ok: false, error: "Escreva a proposta." });
    const key = CATEGORIES[category] ? category : "outro";
    r.proposal = { text: body, author: p.name, category: key, categoryLabel: CATEGORIES[key].label, status: "Em análise" };
    r.votes = {}; r.lastTally = null;
    log(r, "Nova proposta (" + CATEGORIES[key].label + ") apresentada por " + p.name + "."); emitRoom(r); cb({ ok: true });
  });

  on("vote:open", (_d, cb) => {
    const { r } = teacher();
    if (!r || !r.proposal || r.proposal.status !== "Em análise" || r.phase !== "Debate") return cb({ ok: false, error: "Apresente uma proposta primeiro." });
    r.votes = {}; r.proposal.status = "Votação aberta"; r.phase = "Votação";
    log(r, "Votação aberta."); emitRoom(r); cb({ ok: true });
  });

  on("vote:cast", ({ choice }, cb) => {
    const { r, p } = me();
    if (!p || r.phase !== "Votação" || !["sim", "nao", "abstencao"].includes(choice)) return cb({ ok: false, error: "A votação não está aberta." });
    if (p.isTeacher) return cb({ ok: false, error: "Professor acompanha, mas não vota." });
    r.votes[p.id] = choice; emitRoom(r); cb({ ok: true }); // voto é secreto: o histórico não mostra o nome
  });

  on("vote:close", (_d, cb) => {
    const { r } = teacher();
    if (!r || r.phase !== "Votação") return cb({ ok: false, error: "Não há votação aberta." });
    const tally = { sim: 0, nao: 0, abstencao: 0 };
    Object.values(r.votes).forEach(v => tally[v]++);
    const passed = tally.sim > tally.nao;
    const fx = passed ? CATEGORIES[r.proposal.category].fx : { approval: -1 };
    applyFx(r, fx);
    r.proposal.status = passed ? "Aprovada" : "Rejeitada"; r.lastTally = tally; r.votes = {}; r.phase = "Debate";
    const fxText = Object.entries(fx).map(([k, v]) => FX_NAMES[k] + " " + (v > 0 ? "+" : "") + v).join(", ");
    log(r, `Votação encerrada: ${tally.sim} a favor, ${tally.nao} contra, ${tally.abstencao} abstenções. Projeto ${passed ? "aprovado" : "rejeitado"}. Efeitos: ${fxText}.`);
    emitRoom(r); cb({ ok: true, tally });
  });

  on("bc:selic", ({ delta }, cb) => {
    const { r, p } = me();
    if (!p || (p.role !== "Banco Central" && !p.isTeacher)) return cb({ ok: false, error: "Só o Banco Central ajusta a Selic." });
    if (r.phase === "Mandato encerrado") return cb({ ok: false, error: "O mandato já acabou." });
    if (![-0.5, 0.5].includes(delta)) return cb({ ok: false, error: "Ajuste inválido." });
    r.indicators.selic = round1(clamp(r.indicators.selic + delta, LIMITS.selic));
    log(r, `${p.name} ajustou a Selic para ${r.indicators.selic}%.`); emitRoom(r); cb({ ok: true });
  });

  on("year:next", (_d, cb) => {
    const { r } = teacher();
    if (!r) return cb({ ok: false });
    if (r.phase === "Votação") return cb({ ok: false, error: "Encerre a votação antes de avançar." });
    if (r.year >= 4) {
      if (r.phase !== "Mandato encerrado") log(r, `Mandato de quatro anos concluído. Aprovação final: ${r.indicators.approval}%, inflação ${r.indicators.inflation}%, desemprego ${r.indicators.unemployment}%.`);
      r.phase = "Mandato encerrado";
    } else {
      r.year++; economyStep(r); r.proposal = null; r.votes = {}; r.lastTally = null; r.phase = "Debate";
      log(r, `Início do ano ${r.year} do mandato. Evento econômico simulado: inflação ${r.indicators.inflation}%, desemprego ${r.indicators.unemployment}%.`);
    }
    emitRoom(r); cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const r = rooms.get(socket.data.room), p = r && r.people.get(socket.data.pid);
    if (p && p.socketId === socket.id) { p.online = false; emitRoom(r); } // continua na sala e pode voltar
  });
});

setInterval(() => { const now = Date.now(); for (const [c, r] of rooms) if (now - r.last > ROOM_TTL) rooms.delete(c); }, 10 * 60 * 1000).unref();

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log("Brasil em Jogo rodando na porta " + port));
