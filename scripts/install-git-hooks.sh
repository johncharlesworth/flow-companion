#!/usr/bin/env bash
# scripts/install-git-hooks.sh
# Installs the project's git hooks into .git/hooks/.
# Run once per fresh clone: `bash scripts/install-git-hooks.sh`
set -eu
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"
mkdir -p "$HOOKS_DIR"
cp "${REPO_ROOT}/scripts/pre-commit-hook.sh" "${HOOKS_DIR}/pre-commit"
chmod +x "${HOOKS_DIR}/pre-commit"
echo "Installed pre-commit hook -> ${HOOKS_DIR}/pre-commit"
