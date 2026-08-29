---
name: fugu-fcmobile
description: Analiza plantillas de FC Mobile con el CLI Fugu en la VM (Grok Bot) o con las tools MCP si existen. Úsalo ante XI, OVR, fichajes, VSA, H2H, Manager, club o una captura.
---

# Fugu FC Mobile

En Grok Bot no uses MCP. El motor corre en el ordenador del Bot:

```bash
FUGU=/workspace/fugu-renderz
"$FUGU/scripts/fugu" doctor
```

Si `doctor` falla por Node, reintenta con `node`, `bun` o `/exec-daemon/node` apuntando a `$FUGU/scripts/fugu.js`.

No inventes cartas, UIDs ni ratings. Toda carta sale de un comando Fugu o de una observación visible.

## Comandos

```bash
"$FUGU/scripts/fugu" search --text Mbappé --limit 5 --auctionable false
"$FUGU/scripts/fugu" player 24049024
"$FUGU/scripts/fugu" simulate 24049024 --rank 5 --training 30
"$FUGU/scripts/fugu" analyze --json /tmp/squad.json
"$FUGU/scripts/fugu" analyze-squad <squadId> --mode h2h
"$FUGU/scripts/fugu" auto-recommend --json /tmp/payload.json
"$FUGU/scripts/fugu" screenshot --json /tmp/obs.json
"$FUGU/scripts/fugu" club
"$FUGU/scripts/fugu" club-import --json /tmp/club.json
"$FUGU/scripts/fugu" club-analyze --mode h2h
"$FUGU/scripts/fugu" uid 123456789012345
```

`analyze`, `screenshot`, `recommend` y `club-import` esperan JSON (archivo `--json` o stdin). El club persistente es `$FUGU/data/club.json`.

## Captura

Mira la imagen tú (chat o archivo en `/workspace`). Transcribe solo lo visible a JSON y pasa eso a `screenshot`. No completes nombres u OVR ilegibles. Si el CLI responde `needs_clarification`, pregunta.

## Si Fugu no está en la VM

Clona con `sh /workspace/fugu-renderz/scripts/install-on-bot.sh` (si el repo aún no está: `gh repo clone devrauto/fugu-renderz /workspace/fugu-renderz`). No hace falta servidor, túnel ni BLTR.

## Cursor / Grok Build

Si hay tools MCP `fugu-fcmobile`, úsalas con los mismos nombres (`search_players`, `analyze_squad`, …). El CLI es el camino de Grok Bot.
