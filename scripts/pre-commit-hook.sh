#!/usr/bin/env bash
# scripts/pre-commit-hook.sh
# Runs the PII scanner against staged files. Blocks commit on any unallowlisted hit.
# Installed into .git/hooks/pre-commit by scripts/install-git-hooks.sh.

set -u

# Preflight: require bash (defense in depth — see scan-for-pii.sh).
if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "pre-commit: this hook requires bash (BASH_VERSION not set)" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
SCANNER="${REPO_ROOT}/scripts/scan-for-pii.sh"

if [[ ! -x "$SCANNER" ]]; then
  echo "pre-commit: scanner not found or not executable at $SCANNER" >&2
  exit 1
fi

# Collect staged files (Added/Copied/Modified/Renamed; exclude Deleted).
# Manual read loop instead of mapfile (mapfile is bash 4+; macOS ships bash 3.2).
STAGED=()
while IFS= read -r f; do
  STAGED+=("$f")
done < <(git diff --cached --name-only --diff-filter=ACMR)
if [[ ${#STAGED[@]} -eq 0 ]]; then exit 0; fi

# Resolve to repo-rooted paths (matches the scanner's path matching)
"$SCANNER" "${STAGED[@]}"
status=$?
if [[ $status -ne 0 ]]; then
  echo "pre-commit: PII scanner found issues. Fix and re-stage, or add a reviewed entry to scripts/pii-allowlist.txt." >&2
  echo "pre-commit: --no-verify is NOT a sanctioned workaround; fix or allowlist the finding instead." >&2
fi
exit $status
