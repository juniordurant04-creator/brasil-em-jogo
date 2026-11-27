# Brasil em Jogo — versão com desafios

Simulador escolar de política e economia com salas em tempo real.

## Recursos
- Professor cria sala; alunos entram com nome e código.
- Professor distribui cargos políticos.
- Banco de desafios prontos em três níveis progressivos (fácil, médio e difícil).
- Professor também pode criar desafios personalizados para a turma.
- Presidente apresenta propostas; professor abre e encerra a votação.
- Após a votação, os indicadores recebem consequências didáticas simplificadas conforme o desafio e o resultado.
- Indicadores: inflação, desemprego, aprovação e orçamento.

## Executar localmente
1. Instale Node.js 20 ou superior.
2. No terminal, dentro da pasta do projeto, execute `npm install`.
3. Execute `npm start`.
4. Abra `http://localhost:3000`.

## Publicar no Render
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: vazio (raiz do repositório)

## Importante para uso escolar
Os efeitos nos indicadores são fictícios e simplificados para fins pedagógicos. Não são previsões econômicas nem recomendações de política pública. As salas e seus dados ficam na memória do servidor e podem ser perdidos quando o serviço reiniciar.
