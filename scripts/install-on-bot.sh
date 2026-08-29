#!/bin/sh
# Idempotente: clona Fugu en la VM de Grok Bot, instala la skill y verifica RenderZ.
set -eu

REPO_SLUG="${FUGU_GIT_SLUG:-devrauto/fugu-renderz}"
REPO_URL="${FUGU_GIT_URL:-https://github.com/${REPO_SLUG}.git}"
DEST="${FUGU_HOME:-/workspace/fugu-renderz}"
HERE=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)

log() { printf '%s\n' "$*"; }

if [ -f "$HERE/scripts/fugu.js" ]; then
  ROOT="$HERE"
elif [ -f "$DEST/scripts/fugu.js" ]; then
  ROOT="$DEST"
else
  ROOT="$DEST"
  mkdir -p "$(dirname "$DEST")"
  if command -v gh >/dev/null 2>&1; then
    log "Clonando con gh: $REPO_URL → $DEST"
    gh repo clone "$REPO_SLUG" "$DEST"
  elif command -v git >/dev/null 2>&1; then
    log "Clonando con git: $REPO_URL → $DEST"
    git clone "$REPO_URL" "$DEST"
  else
    log "No hay git ni gh. Copia el repo a $DEST y vuelve a ejecutar este script."
    exit 1
  fi
fi

install_skill() {
  src="$ROOT/skills/fugu-fcmobile"
  [ -d "$src" ] || return 0
  for dir in \
    "/workspace/skills/fugu-fcmobile" \
    "${HOME}/.cursor/skills/fugu-fcmobile" \
    "${HOME}/.grok/skills/fugu-fcmobile"
  do
    parent=$(dirname "$dir")
    mkdir -p "$parent" 2>/dev/null || continue
    rm -rf "$dir"
    cp -R "$src" "$dir"
    log "Skill en $dir"
  done
}

install_skill

if [ -x "$ROOT/scripts/fugu" ]; then
  "$ROOT/scripts/fugu" doctor
else
  for bin in node bun /exec-daemon/node; do
    if command -v "$bin" >/dev/null 2>&1 || [ -x "$bin" ]; then
      "$bin" "$ROOT/scripts/fugu.js" doctor
      break
    fi
  done
fi

marker="$ROOT/.fugu-ready"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$marker" 2>/dev/null || true
log "Fugu listo en $ROOT"
log "Usa: $ROOT/scripts/fugu help"
