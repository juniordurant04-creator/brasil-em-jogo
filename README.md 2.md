# Brasil em Jogo — Simulação Política e Econômica

Protótipo educativo multiplayer em Node.js, Express e Socket.IO.

## Estrutura
```
server.js        # servidor e regras do jogo
package.json
public/
  index.html     # tela do jogo (servida pelo Express)
```

## Como jogar
1. O professor cria a sala e passa o código para a turma.
2. Define os cargos (Presidente, Banco Central etc.).
3. O Presidente escolhe a área e escreve a proposta; o professor abre a votação.
4. Os votos são secretos; o placar aparece só ao apurar. Se aprovada, a proposta altera inflação, desemprego, aprovação e orçamento conforme a área.
5. O Banco Central ajusta a Selic: juros altos reduzem a inflação, mas aumentam o desemprego na virada do ano.
6. O professor avança os anos até o fim do mandato (4 anos).

## Rodar localmente
`npm install` e `npm start`, depois abra http://localhost:3000

## Publicar no Render
1. Envie esta pasta para um repositório GitHub.
2. No Render, crie um **New > Web Service** e conecte o repositório.
3. Build Command: `npm install` — Start Command: `npm start`
4. (Opcional) Health Check Path: `/health`

## Limitações desta versão
- Salas ficam na memória e somem se o servidor reiniciar; salas paradas por 6 horas são apagadas.
- Quem recarrega a página ou perde a conexão volta sozinho para a sala (a sessão fica na aba do navegador).
- Indicadores e efeitos econômicos são simplificados e fictícios.
- O código da sala não é senha forte; não use dados pessoais dos alunos.
- Ainda não há banco de dados, login seguro de professor nem análise por IA.
- No plano gratuito do Render o serviço pode dormir; a primeira abertura pode demorar.
