#!/usr/bin/env bash
# scripts/scan-for-pii.sh
#
# Scans the given files for PII patterns. Exits non-zero on any unallowlisted hit.
# Usage: scripts/scan-for-pii.sh [file ...]
#
# Patterns:
#   - Emails
#   - Salesforce IDs (15 or 18 chars, valid 3-char prefix)
#   - Salesforce tenant URLs (my.salesforce.com, lightning.force.com, sandbox, scratch)
#   - Local paths (file://…, /Users/<name>, /home/<name>, /private/<dir>, ~/Library/<dir>; the bare token alone is not a hit)
#   - Provider keys (sk-ant-, sk-or-, sk-proj- followed by a key body of 24+ characters)
#   - Provider env var names (ANTHROPIC-API-KEY, OPENAI-API-KEY, GOOGLE-API-KEY, GEMINI-API-KEY) — real hyphens
#   - Forbidden file paths (.dev.vars, references/sample-flow.json, references/*, .DS_Store, ~/.claude/plans/)
#   - Optional deny list at scripts/pii-deny-list.txt (gitignored)
#
# Self-exclusions (load-bearing — .md "Scanner self-exclusion"):
#   - scripts/scan-for-pii.sh (contains the literal patterns it blocks)
#   - scripts/pii-allowlist.txt (contains synthetic example values)
#   - scripts/pre-commit-hook.sh and scripts/install-git-hooks.sh (reference the patterns)
#   - extension/test/fixtures/synthetic-* (intentionally synthetic, any extension, may match broad patterns)
#   - package-lock.json / pnpm-lock.yaml / yarn.lock (auto-generated; SHA hashes collide with SF_ID regex)

set -u

# Preflight: require bash. Defense in depth — if a future change brings back
# bash-4-only constructs, this fails loudly instead of exiting 0 silently
# (which is what happens on macOS stock bash 3.2 if 'declare -A' is used).
if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "scan-for-pii: this script requires bash (BASH_VERSION not set)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALLOWLIST="${SCRIPT_DIR}/pii-allowlist.txt"
DENY_LIST="${SCRIPT_DIR}/pii-deny-list.txt"

# Patterns
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
SF_ID_RE='\b(00[0-9A-Z]|0[1-9A-Z][0-9A-Z]|[1-9A-Z][0-9A-Z]{2})[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?\b'
SF_TENANT_RE='[a-zA-Z0-9-]+\.(my\.salesforce\.com|lightning\.force\.com|sandbox\.my\.salesforce\.com|scratch\.my\.salesforce\.com)\b'
# A path is a hit only with a following segment (a username or directory), so
# documentation that names the bare token ("no /Users/ paths") does not trip it.
LOCAL_PATH_RE='(file://[A-Za-z0-9][A-Za-z0-9._/~-]*|(/Users|/home|/private|~/Library)/[A-Za-z0-9][A-Za-z0-9._-]*)'
# A provider key is the prefix plus a body; the bare prefix (in a validator, a
# hint string, or a test) is not a hit.
PROVIDER_KEY_RE='sk-(ant|or|proj)-[A-Za-z0-9_-]{24,}'
PROVIDER_ENV_RE='(ANTHROPIC|OPENAI|GOOGLE|GEMINI)-API-KEY'

# Forbidden file paths
is_forbidden_path() {
  case "$1" in
    .dev.vars|*/.dev.vars) return 0 ;;
    references/sample-flow.json|*/references/sample-flow.json) return 0 ;;
    references/Salesforce-Inspector-reloaded/*|*/references/Salesforce-Inspector-reloaded/*) return 0 ;;
    *.DS_Store) return 0 ;;
    *.claude/plans/*) return 0 ;;
  esac
  return 1
}

# Self-exclusions
is_self_excluded() {
  case "$1" in
    scripts/scan-for-pii.sh|*/scripts/scan-for-pii.sh) return 0 ;;
    scripts/pii-allowlist.txt|*/scripts/pii-allowlist.txt) return 0 ;;
    scripts/pii-deny-list.txt|*/scripts/pii-deny-list.txt) return 0 ;;
    scripts/pre-commit-hook.sh|*/scripts/pre-commit-hook.sh) return 0 ;;
    scripts/install-git-hooks.sh|*/scripts/install-git-hooks.sh) return 0 ;;
    # No per-file exclusions beyond the scanner's own files: the provider-key
    # pattern needs a key body, so files that only name the prefixes pass.
  esac
  return 1
}

# Synthetic fixtures are exempt — any file under extension/test/fixtures/
# whose name starts with "synthetic-". Originally .json-only; broadened to
# any extension so notes can reference test-fixture content in .txt
# form without inlining scanner-trigger literals (per the Option C
# resolution recorded at the time). Privacy promise preserved
# because PR review of any new synthetic-* file is the gate.
is_synthetic_fixture() {
  case "$1" in
    extension/test/fixtures/synthetic-*|*/extension/test/fixtures/synthetic-*) return 0 ;;
  esac
  return 1
}

# Lockfiles are auto-generated and their base64 SHA hashes collide with the
# SF_ID regex (and probably others). Exempt them entirely — embedded secrets
# in lockfiles are an unusual attack vector. Scanned files of interest live
# elsewhere.
is_lockfile() {
  case "$1" in
    package-lock.json|*/package-lock.json) return 0 ;;
    pnpm-lock.yaml|*/pnpm-lock.yaml) return 0 ;;
    yarn.lock|*/yarn.lock) return 0 ;;
  esac
  return 1
}

# Load allowlist (literal substrings, one per line, # comments).
# Indexed array + linear scan (bash 3.2 compatible — macOS stock bash predates
# associative arrays). Allowlist is tiny (~15 entries); O(n) lookup is fine.
declare -a ALLOWLIST_ENTRIES=()
if [[ -f "$ALLOWLIST" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    ALLOWLIST_ENTRIES+=("$line")
  done < "$ALLOWLIST"
fi

is_allowlisted() {
  local needle="$1"
  local entry
  if [[ ${#ALLOWLIST_ENTRIES[@]} -eq 0 ]]; then return 1; fi
  for entry in "${ALLOWLIST_ENTRIES[@]}"; do
    if [[ "$needle" == "$entry" ]]; then return 0; fi
  done
  return 1
}

# Load deny list (literal substrings, case-insensitive)
declare -a DENY_TERMS=()
if [[ -f "$DENY_LIST" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    DENY_TERMS+=("$line")
  done < "$DENY_LIST"
fi

exit_code=0

report() {
  local file="$1" lineno="$2" pattern="$3" match="$4"
  if is_allowlisted "$match"; then
    return 0
  fi
  printf '%s:%s: [%s] %s\n' "$file" "$lineno" "$pattern" "$match" >&2
  exit_code=1
}

scan_pattern() {
  local file="$1" pattern_name="$2" regex="$3"
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    local lineno match
    lineno="${hit%%:*}"
    match="${hit#*:}"
    report "$file" "$lineno" "$pattern_name" "$match"
  done < <(grep -noE "$regex" "$file" 2>/dev/null || true)
}

scan_deny_list() {
  local file="$1"
  if [[ ${#DENY_TERMS[@]} -eq 0 ]]; then return; fi
  for term in "${DENY_TERMS[@]}"; do
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      local lineno
      lineno="${hit%%:*}"
      report "$file" "$lineno" "DENY_LIST" "$term"
    done < <(grep -niF -- "$term" "$file" 2>/dev/null | awk -F: '{print $1}' | awk '{print $0 ":" "'"$term"'"}' || true)
  done
}

for file in "$@"; do
  [[ ! -f "$file" ]] && continue

  if is_forbidden_path "$file"; then
    printf '%s: [FORBIDDEN_FILE] this file must never be committed\n' "$file" >&2
    exit_code=1
    continue
  fi

  if is_self_excluded "$file"; then continue; fi
  if is_synthetic_fixture "$file"; then continue; fi
  if is_lockfile "$file"; then continue; fi

  # Skip binary files (rough heuristic: grep with -I returns nothing for binaries)
  if ! grep -qI . "$file" 2>/dev/null; then continue; fi

  scan_pattern "$file" "EMAIL" "$EMAIL_RE"
  scan_pattern "$file" "SF_ID" "$SF_ID_RE"
  scan_pattern "$file" "SF_TENANT" "$SF_TENANT_RE"
  scan_pattern "$file" "LOCAL_PATH" "$LOCAL_PATH_RE"
  scan_pattern "$file" "PROVIDER_KEY" "$PROVIDER_KEY_RE"
  scan_pattern "$file" "PROVIDER_ENV" "$PROVIDER_ENV_RE"
  scan_deny_list "$file"
done

exit $exit_code
