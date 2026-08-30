#!/usr/bin/env bash
# openskills installer
# One-liner: curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/openskills/main/install.sh | bash
#
# Usage:
#   ./install.sh                  Install to all detected agents
#   ./install.sh --agent=claude   Install only to Claude Code
#   ./install.sh --agent=registry  Install to generic ~/.ai-skills registry
#   ./install.sh --agent=cursor   Install only to Cursor
#   ./install.sh --dry-run        Show what would be installed
#   ./install.sh --uninstall      Remove all installed symlinks

set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── Config ───────────────────────────────────────────────────────────────────
VERSION="1.0.0"
REPO_NAME="openskills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR"

# ─── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=false
UNINSTALL=false
TARGET_AGENT="all"

for arg in "$@"; do
  case $arg in
    --dry-run)    DRY_RUN=true ;;
    --uninstall)  UNINSTALL=true ;;
    --agent=*)    TARGET_AGENT="${arg#*=}" ;;
    -h|--help)
      echo "Usage: ./install.sh [--agent=claude|registry|cursor|windsurf|all] [--dry-run] [--uninstall]"
      exit 0
      ;;
  esac
done

# ─── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         openskills  v${VERSION}                        ║${NC}"
echo -e "${BOLD}║  45 production-grade skills. Every AI agent.         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

[[ "$DRY_RUN" == "true" ]]   && echo -e "${YELLOW}⚠  DRY RUN — no files will be modified${NC}\n"
[[ "$UNINSTALL" == "true" ]] && echo -e "${YELLOW}⚠  UNINSTALL mode — removing openskills links${NC}\n"

# ─── Helpers ──────────────────────────────────────────────────────────────────
log_ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
log_skip() { echo -e "  ${DIM}–  $1${NC}"; }
log_warn() { echo -e "  ${YELLOW}⚠  $1${NC}"; }
log_err()  { echo -e "  ${RED}✗  $1${NC}"; }
log_head() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  ${DIM}[dry-run] $*${NC}"
  else
    "$@"
  fi
}

skill_dirs() {
  find "$SKILLS_DIR" -maxdepth 2 -name "SKILL.md" \
    ! -path "*/.git/*" \
    -exec dirname {} \; | sort
}

skill_name() {
  basename "$1"
}

# ─── Claude Code ──────────────────────────────────────────────────────────────
install_claude() {
  local claude_dir="$HOME/.claude/commands"
  log_head "Claude Code  (~/.claude/commands/)"

  if [[ ! -d "$HOME/.claude" ]]; then
    log_skip "~/.claude not found — Claude Code not installed, skipping"
    return
  fi

  run mkdir -p "$claude_dir"

  local count=0
  while IFS= read -r skill_dir; do
    local name
    name=$(skill_name "$skill_dir")
    local target="$claude_dir/$name"

    if [[ "$UNINSTALL" == "true" ]]; then
      if [[ -L "$target" ]]; then
        run rm "$target"
        log_ok "Removed $name"
      fi
      continue
    fi

    if [[ -L "$target" ]]; then
      log_skip "$name (already linked)"
    else
      run mkdir -p "$target"
      run ln -sf "$skill_dir/SKILL.md" "$target/SKILL.md"
      log_ok "$name  →  $target/SKILL.md"
      ((count++)) || true
    fi
  done < <(skill_dirs)

  [[ $count -gt 0 ]] && echo -e "\n  ${GREEN}Installed $count skills as Claude Code slash commands${NC}"
  echo -e "  ${DIM}Use as: /office-hours, /code-reviewer, /spec-author, etc.${NC}"
}

# ─── Generic AI agent (SKILL.md registry pattern) ────────────────────────────
install_agent_registry() {
  local registry_dir="$HOME/.ai-skills/openskills"
  log_head "AI Agent Registry  (~/.ai-skills/openskills/)"

  run mkdir -p "$registry_dir"

  local count=0
  while IFS= read -r skill_dir; do
    local name
    name=$(skill_name "$skill_dir")
    local target="$registry_dir/$name"

    if [[ "$UNINSTALL" == "true" ]]; then
      if [[ -L "$target" ]]; then
        run rm "$target"
        log_ok "Removed $name"
      fi
      continue
    fi

    if [[ -L "$target" ]]; then
      log_skip "$name (already linked)"
    else
      run ln -sf "$skill_dir" "$target"
      log_ok "$name  →  $target"
      ((count++)) || true
    fi
  done < <(skill_dirs)

  [[ $count -gt 0 ]] && echo -e "\n  ${GREEN}Installed $count skills into ~/.ai-skills/openskills${NC}"
  echo -e "  ${DIM}Point any SKILL.md-compatible agent at ~/.ai-skills/openskills/${NC}"
}

# ─── Cursor ───────────────────────────────────────────────────────────────────
install_cursor() {
  local cursor_dir=".cursor/rules"
  log_head "Cursor  (.cursor/rules/)"

  if [[ ! -d ".cursor" ]] && [[ ! -f ".cursorrules" ]]; then
    log_skip "No .cursor directory or .cursorrules found in current directory"
    log_skip "Run this from your project root, or create .cursor/ first"
    return
  fi

  run mkdir -p "$cursor_dir"

  local count=0
  while IFS= read -r skill_dir; do
    local name
    name=$(skill_name "$skill_dir")
    local target="$cursor_dir/${name}.mdc"

    if [[ "$UNINSTALL" == "true" ]]; then
      if [[ -f "$target" ]]; then
        run rm "$target"
        log_ok "Removed $name"
      fi
      continue
    fi

    if [[ -f "$target" ]]; then
      log_skip "$name (already exists)"
    else
      # Generate .mdc file from SKILL.md — Cursor reads description as the rule trigger
      local desc
      desc=$(grep "^description:" "$skill_dir/SKILL.md" 2>/dev/null | head -1 | sed 's/^description: //')
      if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "  ${DIM}[dry-run] Would write $target${NC}"
      else
        {
          echo "---"
          echo "description: $desc"
          echo "---"
          echo ""
          # Strip frontmatter from SKILL.md and include body
          sed '1,/^---$/{ /^---$/d }' "$skill_dir/SKILL.md" | sed '1,/^---$/d'
        } > "$target"
      fi
      log_ok "$name  →  $target"
      ((count++)) || true
    fi
  done < <(skill_dirs)

  [[ $count -gt 0 ]] && echo -e "\n  ${GREEN}Installed $count skills as Cursor rules${NC}"
}

# ─── Windsurf ─────────────────────────────────────────────────────────────────
install_windsurf() {
  log_head "Windsurf  (.windsurfrules)"

  if [[ ! -f ".windsurfrules" ]] && [[ ! -d "$HOME/.codeium" ]]; then
    log_skip "No .windsurfrules or Windsurf installation detected, skipping"
    return
  fi

  local target=".windsurfrules"

  if [[ "$UNINSTALL" == "true" ]]; then
    if grep -q "openskills" "$target" 2>/dev/null; then
      log_warn "Cannot auto-remove from .windsurfrules — remove openskills section manually"
    fi
    return
  fi

  if grep -q "openskills" "$target" 2>/dev/null; then
    log_skip "openskills already in .windsurfrules"
    return
  fi

  if [[ "$DRY_RUN" == "false" ]]; then
    {
      echo ""
      echo "# openskills — start (do not edit this block manually)"
      echo "# Full skill documentation: https://github.com/YOUR_USERNAME/openskills"
      echo ""
      while IFS= read -r skill_dir; do
        local name desc
        name=$(skill_name "$skill_dir")
        desc=$(grep "^description:" "$skill_dir/SKILL.md" 2>/dev/null | head -1 | sed 's/^description: //')
        echo "## $name"
        echo "$desc"
        echo ""
      done < <(skill_dirs)
      echo "# openskills — end"
    } >> "$target"
  fi
  log_ok "Appended skill descriptions to .windsurfrules"
}

# ─── Generic fallback ─────────────────────────────────────────────────────────
install_generic() {
  local generic_dir="$HOME/.ai-skills/openskills"
  log_head "Generic  (~/.ai-skills/openskills/)"

  run mkdir -p "$generic_dir"

  if [[ "$UNINSTALL" == "true" ]]; then
    run rm -rf "$generic_dir"
    log_ok "Removed $generic_dir"
    return
  fi

  local count=0
  while IFS= read -r skill_dir; do
    local name
    name=$(skill_name "$skill_dir")
    local target="$generic_dir/$name"

    if [[ -d "$target" ]]; then
      log_skip "$name (already copied)"
    else
      run cp -r "$skill_dir" "$target"
      log_ok "$name  →  $target"
      ((count++)) || true
    fi
  done < <(skill_dirs)

  [[ $count -gt 0 ]] && echo -e "\n  ${GREEN}Installed $count skills to $generic_dir${NC}"
  echo -e "  ${DIM}Reference any SKILL.md as a system prompt for your AI agent${NC}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo -e "${DIM}Skills source: $SKILLS_DIR${NC}"
  echo -e "${DIM}Skills found:  $(skill_dirs | wc -l | tr -d ' ')${NC}"

  case "$TARGET_AGENT" in
    claude)    install_claude ;;
    registry)  install_agent_registry ;;
    cursor)    install_cursor ;;
    windsurf)  install_windsurf ;;
    generic)   install_generic ;;
    all)
      install_claude
      install_agent_registry
      install_cursor
      install_windsurf
      ;;
  esac

  echo ""
  if [[ "$UNINSTALL" == "true" ]]; then
    echo -e "${GREEN}${BOLD}✓ openskills uninstalled${NC}"
  elif [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}${BOLD}Dry run complete — no changes made${NC}"
  else
    echo -e "${GREEN}${BOLD}✓ openskills installed successfully${NC}"
    echo -e "${DIM}  Restart your AI agent to pick up new skills${NC}"
  fi
  echo ""
}

main
