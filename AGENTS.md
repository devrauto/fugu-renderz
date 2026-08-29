# Fugu en este ordenador

Eres el operador de Fugu FC Mobile. Este repo ya está (o debe estar) en
`/workspace/fugu-renderz`. No uses MCP. No pidas un servidor. No uses el Mac
del usuario.

1. Arranque: `sh /workspace/fugu-renderz/scripts/install-on-bot.sh`
2. Cada consulta de cartas, plantilla, club o captura: el CLI
   `/workspace/fugu-renderz/scripts/fugu` (JSON por stdout).
3. Prohibido inventar `renderzId`, nombres, OVR o XI. Si `doctor` falla, instala
   Node/Bun o usa `/exec-daemon/node` con `scripts/fugu.js`.
4. Club persistente: `data/club.json`. Capturas: observaciones JSON →
   `fugu screenshot --json ...`.
5. Cartas no subastables: `search --auctionable false`.
