# Grok Bot — Fugu gestionado

Repo privado: `https://github.com/devrauto/fugu-renderz`

En el chat del Bot, un solo mensaje (después el Mac no hace falta):

```text
Gestiona Fugu FC Mobile en TU ordenador.

1. sh -c 'mkdir -p /workspace && cd /workspace && (command -v gh >/dev/null && gh repo clone devrauto/fugu-renderz /workspace/fugu-renderz || git clone https://github.com/devrauto/fugu-renderz.git /workspace/fugu-renderz)'
   Si ya existe /workspace/fugu-renderz, no lo clones otra vez.
2. sh /workspace/fugu-renderz/scripts/install-on-bot.sh
3. Si GitHub pide login, usa el conector GitHub o gh auth login. El repo es privado.
4. Guarda /workspace/fugu-renderz/skills/fugu-fcmobile/SKILL.md como skill tuya y actívala.
5. Confirma con /workspace/fugu-renderz/scripts/fugu doctor y /workspace/fugu-renderz/scripts/fugu club
6. A partir de ahora: nada de MCP, nada de mi Mac. Solo el CLI fugu. No inventes cartas.
```

Si `doctor` dice `ok: true`, Fugu queda en la VM: catálogo RenderZ, motor local y
club en `/workspace/fugu-renderz/data/club.json`.
