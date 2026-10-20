#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

mode="${1:-deploy}"
if [[ "$mode" != "deploy" && "$mode" != "check" ]]; then
  echo "Uso: bash deploy.sh [check|deploy]" >&2
  exit 2
fi

for required_file in qsession.env livekit.yaml egress.yaml caddy.yaml redis.conf compose.yml private/qsession-firebase-service-account.json; do
  if [[ ! -s "$required_file" ]]; then
    echo "Falta $required_file." >&2
    exit 1
  fi
done

for domain in qsession.org www.qsession.org media.qsession.org turn.qsession.org; do
  if ! getent ahostsv4 "$domain" >/dev/null 2>&1; then
    echo "DNS todavía no resuelve para $domain." >&2
    exit 1
  fi
done

docker compose -f compose.yml config --quiet
echo "Validación independiente de Q Session correcta."

if [[ "$mode" == "check" ]]; then
  exit 0
fi

docker compose -f compose.yml pull
docker compose -f compose.yml up -d --build
docker compose -f compose.yml ps

echo "Q Session inició con su aplicación, datos, Redis, LiveKit, mezclador HLS, TURN y proxy."
