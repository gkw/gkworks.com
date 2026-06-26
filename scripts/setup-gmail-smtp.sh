#!/usr/bin/env bash
set -euo pipefail

config_path="/etc/gkworks-contact-mail.ini"
gmail_address="${1:-genkikuroda@gmail.com}"

if [[ "$(id -u)" != "0" ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

echo "Configuring Gmail SMTP for ${gmail_address}"
echo "Use a Google App Password, not the regular Google account password."
read -rsp "Google App Password: " app_password
echo
read -rsp "Confirm Google App Password: " app_password_confirm
echo

if [[ -z "${app_password}" ]]; then
  echo "App Password cannot be empty." >&2
  exit 1
fi

if [[ "${app_password}" != "${app_password_confirm}" ]]; then
  echo "Passwords did not match." >&2
  exit 1
fi

umask 077
tmp_path="$(mktemp)"
cat > "${tmp_path}" <<INI
smtp_host=smtp.gmail.com
smtp_port=587
smtp_username=${gmail_address}
smtp_password=${app_password}
smtp_from=${gmail_address}
INI

mv "${tmp_path}" "${config_path}"
chown root:root "${config_path}"
chmod 600 "${config_path}"

echo "Wrote ${config_path}"
php -r 'echo is_readable("/etc/gkworks-contact-mail.ini") ? "config-readable\n" : "config-not-readable\n";'
