#!/bin/sh
# Coolify preview deployments for one application, for coding agents.
# Reads preview.env next to this file (COOLIFY_APP_UUID, HEALTH_PATH, ROUTES)
# and COOLIFY_API_TOKEN from the environment; COOLIFY_API_URL defaults to
# Coolify on this host. Needs curl and jq. See SKILL.md for the procedure.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=preview.env
[ -f "$here/preview.env" ] && . "$here/preview.env"
: "${COOLIFY_API_URL:=http://localhost:8000}"
: "${COOLIFY_APP_UUID:=}"
: "${HEALTH_PATH:=/}"
: "${ROUTES:=/}"
WAIT_SECONDS=${PREVIEW_WAIT_SECONDS:-1200}

usage() {
	cat <<USAGE
usage: preview.sh <command> [args]
  open <pr>     create the preview for pull request <pr> or redeploy it,
                wait for the build, print the URL (log tail on failure)
  status <pr>   one line: preview status and URL
  url <pr>      print the preview URL only
  logs <pr> [n] last n lines (default 100) of the preview container's logs
  list          all previews of this application
  close <pr>    delete the preview and its container
  check <pr>    curl the health path and screenshot ROUTES into shots/
environment: COOLIFY_API_TOKEN (required), COOLIFY_API_URL (default $COOLIFY_API_URL)
config:      $here/preview.env (COOLIFY_APP_UUID, HEALTH_PATH, ROUTES)
USAGE
}

die() { printf 'preview.sh: %s\n' "$*" >&2; exit 1; }

need() {
	[ -n "${COOLIFY_API_TOKEN:-}" ] || die "COOLIFY_API_TOKEN is not set; it belongs in ~/.zshrc on this server (ask the user)"
	[ -n "$COOLIFY_APP_UUID" ] || die "COOLIFY_APP_UUID is empty in $here/preview.env"
	command -v curl >/dev/null || die "curl missing"
	command -v jq >/dev/null || die "jq missing"
}

# api METHOD PATH [JSON]: prints the body; fails with the API's message on 4xx/5xx
api() {
	method=$1; path=$2; body=${3:-}
	if [ -n "$body" ]; then
		resp=$(curl -sS -X "$method" "$COOLIFY_API_URL/api/v1$path" \
			-H "Authorization: Bearer $COOLIFY_API_TOKEN" -H 'Accept: application/json' \
			-H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}')
	else
		resp=$(curl -sS -X "$method" "$COOLIFY_API_URL/api/v1$path" \
			-H "Authorization: Bearer $COOLIFY_API_TOKEN" -H 'Accept: application/json' -w '\n%{http_code}')
	fi
	code=${resp##*
}
	resp=${resp%
*}
	case "$code" in
	2*) printf '%s' "$resp" ;;
	*) die "$method $path -> HTTP $code: $(printf '%s' "$resp" | jq -r '.message // .error // .' 2>/dev/null | head -3)" ;;
	esac
}

pr_url() { gh pr view "$1" --json url -q .url 2>/dev/null || echo "https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)/pull/$1"; }

preview_json() { api GET "/applications/$COOLIFY_APP_UUID/previews/$1"; }

# Coolify stores the preview domain as it was templated, http:// for a Cloudflare-fronted app;
# the public URL is https, Cloudflare terminates TLS. Lists report it as fqdn, single previews as
# domains; take the first if several.
preview_url() { preview_json "$1" | jq -r '(.domains // .fqdn // "") | split(",")[0] | sub("^http://"; "https://")'; }

deployment_tail() {
	# A deployment's logs are a JSON array (as a string) of {output, type, ...}
	api GET "/deployments/$1" | jq -r '(.logs // "[]") | fromjson | .[-40:] | .[] | .output' 2>/dev/null || true
}

wait_deployment() {
	dep=$1; waited=0
	while :; do
		st=$(api GET "/deployments/$dep" | jq -r .status)
		case "$st" in
		finished) return 0 ;;
		failed|cancelled*) printf 'deployment %s: %s. log tail:\n' "$dep" "$st" >&2; deployment_tail "$dep" >&2; return 1 ;;
		esac
		[ "$waited" -ge "$WAIT_SECONDS" ] && { printf 'deployment %s still %s after %ss\n' "$dep" "$st" "$WAIT_SECONDS" >&2; return 1; }
		sleep 10; waited=$((waited + 10))
	done
}

wait_http() {
	# the proxy picks the new container up a few seconds after the deployment finishes
	url=$1; n=0
	until code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$url") && [ "$code" != "503" ] && [ "$code" != "000" ]; do
		[ $n -ge 18 ] && { printf 'still HTTP %s at %s after 3 minutes\n' "$code" "$url" >&2; return 1; }
		sleep 10; n=$((n + 1))
	done
	printf '%s' "$code"
}

cmd=${1:-help}; [ $# -gt 0 ] && shift
case "$cmd" in
help|-h|--help) usage ;;
list)
	need
	api GET "/applications/$COOLIFY_APP_UUID/previews" | jq -r '.[] | "pr \(.pull_request_id)\t\(.status)\t\(.domains // "-")"'
	;;
status)
	need; pr=${1:?pr number}
	preview_json "$pr" | jq -r '"pr \(.pull_request_id): \(.status) \(.domains // "-")"'
	;;
url)
	need; pr=${1:?pr number}; preview_url "$pr"
	;;
open)
	need; pr=${1:?pr number}
	body=$(jq -nc --argjson pr "$pr" --arg url "$(pr_url "$pr")" '{pull_request_id: $pr, pull_request_html_url: $url, git_type: "github"}')
	out=$(api POST "/applications/$COOLIFY_APP_UUID/previews" "$body")
	dep=$(printf '%s' "$out" | jq -r '.deployment_uuid // empty')
	printf '%s\n' "$(printf '%s' "$out" | jq -r '.message // "queued"') (deployment ${dep:-unknown})" >&2
	[ -n "$dep" ] || die "no deployment_uuid in response: $out"
	wait_deployment "$dep" || die "preview build failed; fix the build before validating anything"
	url=$(preview_url "$pr")
	code=$(wait_http "$url$HEALTH_PATH") || die "preview deployed but $url$HEALTH_PATH is not answering"
	printf '%s\n' "$url"
	printf 'health %s -> HTTP %s\n' "$HEALTH_PATH" "$code" >&2
	;;
check)
	need; pr=${1:?pr number}
	url=$(preview_url "$pr"); [ -n "$url" ] || die "no preview for pr $pr"
	curl -fsS -o /dev/null -m 20 "$url$HEALTH_PATH" && echo "health ok: $url$HEALTH_PATH" || die "health failed: $url$HEALTH_PATH"
	command -v playwright >/dev/null || die "playwright missing; see ~/.claude/CLAUDE.md"
	mkdir -p shots
	for r in $ROUTES; do
		name=$(printf '%s' "$r" | sed 's|^/||; s|/|-|g; s|^$|index|')
		playwright screenshot --full-page "$url$r" "shots/pr$pr-$name.png" >/dev/null && echo "shots/pr$pr-$name.png <- $url$r"
	done
	;;
logs)
	need; pr=${1:?pr number}; n=${2:-100}
	api GET "/applications/$COOLIFY_APP_UUID/previews/$pr/logs?lines=$n" | jq -r 'if type=="object" then (.logs // .) else . end' 
	;;
close)
	need; pr=${1:?pr number}
	api DELETE "/applications/$COOLIFY_APP_UUID/previews/$pr" | jq -r '.message // "deleted"'
	;;
*) usage >&2; exit 2 ;;
esac
