# Brasil em Jogo — Simulação Política e Econômica

Protótipo educativo multiplayer em Node.js, Express e Socket.IO.

## Publicar no Render
1. Envie esta pasta para um repositório GitHub.
2. No Render, crie um **New > Web Service** e conecte o repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Escolha o plano disponível e aguarde o deploy.

O Render fornece um endereço público `onrender.com`.

## Limitações desta versão
- Salas e votos ficam na memória do servidor e são apagados quando o processo reinicia.
- É um protótipo educativo: indicadores e efeitos econômicos são simplificados e fictícios.
- O código da sala não é uma senha forte; não use dados pessoais dos alunos.
- A versão ainda não tem banco de dados persistente, autenticação segura de professor ou análise por IA.
- No plano gratuito do Render, o serviço pode entrar em suspensão após inatividade; a primeira abertura pode demorar.
