#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — Faz commit + push de todas as alterações para o GitHub.
#
#  Frontend (Vercel):  deploy automático ao detectar push no branch master.
#  Backend  (Render):  deploy automático ao detectar push no branch master.
#
#  USO:
#    bash deploy.sh                        → usa mensagem padrão
#    bash deploy.sh "minha mensagem"       → mensagem personalizada
# =============================================================================

set -e  # para em caso de erro

MSG="${1:-"chore: deploy $(date +'%Y-%m-%d %H:%M')"}"

echo ""
echo "=========================================="
echo "  VOXEL ROYALE — Deploy"
echo "=========================================="
echo ""

# ── 1. Verifica se há algo para commitar ────────────────────────────────────
if git diff --quiet && git diff --cached --quiet; then
  echo "✓ Nenhuma alteração pendente — fazendo push direto."
else
  echo "→ Adicionando arquivos alterados..."
  git add -A

  echo "→ Criando commit: \"$MSG\""
  git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
fi

# ── 2. Push ─────────────────────────────────────────────────────────────────
echo "→ Enviando para o GitHub (branch master)..."
git push origin master

echo ""
echo "=========================================="
echo "  Deploy enviado com sucesso!"
echo ""
echo "  Frontend → Vercel detecta o push e faz"
echo "             deploy automático (~1-2 min)."
echo ""
echo "  Backend  → Render detecta o push e faz"
echo "             deploy automático (~2-4 min)."
echo "=========================================="
echo ""
