#!/usr/bin/env bash
set -euo pipefail

base_url="${GKWORKS_API_BASE_URL:-https://gkworks.com}"
token="${GKWORKS_API_TOKEN:-}"
command="${1:-list}"
curl_opts=(-sS)

if [[ "${GKWORKS_API_INSECURE:-0}" == "1" ]]; then
  curl_opts=(-sk)
fi

if [[ -z "${token}" && -r /etc/gkworks-contact-mail.ini ]]; then
  token="$(php -r '$c=parse_ini_file("/etc/gkworks-contact-mail.ini"); echo $c["notify_api_token"] ?? "";')"
fi

if [[ -z "${token}" ]]; then
  echo "Set GKWORKS_API_TOKEN or run this on the production server." >&2
  exit 1
fi

case "${command}" in
  list)
    curl "${curl_opts[@]}" \
      -H "Authorization: Bearer ${token}" \
      "${base_url}/api/management.php"
    echo
    ;;
  logs)
    curl "${curl_opts[@]}" \
      -H "Authorization: Bearer ${token}" \
      "${base_url}/api/management.php?include_logs=1"
    echo
    ;;
  test-notification)
    curl "${curl_opts[@]}" \
      -X POST \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      "${base_url}/api/contact-notification.php" \
      -d '{"name":"API Management Test","company":"GK Works","email":"api-management-test@example.com","subject":"API management test","message":"Test notification from the API management helper.","source":"api-management-helper"}'
    echo
    ;;
  *)
    echo "Usage: $0 [list|logs|test-notification]" >&2
    exit 1
    ;;
esac
