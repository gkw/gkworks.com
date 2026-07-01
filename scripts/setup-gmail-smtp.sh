#!/usr/bin/env bash
set -euo pipefail

config_path="/etc/gkworks-contact-mail.ini"
gmail_address="${1:-genkikuroda@gmail.com}"
notify_to="${CONTACT_NOTIFY_EMAIL:-gen@gkworks.com}"

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

app_password="${app_password//[[:space:]]/}"
app_password_confirm="${app_password_confirm//[[:space:]]/}"

if [[ -z "${app_password}" ]]; then
  echo "App Password cannot be empty." >&2
  exit 1
fi

if [[ "${app_password}" != "${app_password_confirm}" ]]; then
  echo "Passwords did not match." >&2
  exit 1
fi

if [[ "${#app_password}" != "16" ]]; then
  echo "Warning: Google App Passwords are usually 16 characters after removing spaces." >&2
  echo "Current length: ${#app_password}" >&2
  read -rp "Continue anyway? [y/N] " continue_anyway
  if [[ "${continue_anyway}" != "y" && "${continue_anyway}" != "Y" ]]; then
    exit 1
  fi
fi

umask 077
tmp_path="$(mktemp)"
existing_token=""
if [[ -r "${config_path}" ]]; then
  existing_token="$(python3 -c 'import configparser, sys; c=configparser.ConfigParser(); c.read_string("[mail]\\n" + open(sys.argv[1], encoding="utf-8").read()); print(c["mail"].get("notify_api_token", ""))' "${config_path}")"
fi

if [[ -n "${existing_token}" ]]; then
  notify_api_token="${existing_token}"
else
  notify_api_token="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
fi

cat > "${tmp_path}" <<INI
smtp_host=smtp.gmail.com
smtp_port=587
smtp_username=${gmail_address}
smtp_password=${app_password}
smtp_from=${gmail_address}
notify_to=${notify_to}
notify_api_token=${notify_api_token}
INI

mv "${tmp_path}" "${config_path}"
chown root:www-data "${config_path}"
chmod 640 "${config_path}"

echo "Wrote ${config_path}"
python3 -c 'import os; print("config-readable" if os.access("/etc/gkworks-contact-mail.ini", os.R_OK) else "config-not-readable")'
sudo -u www-data python3 -c 'import os; print("www-data-readable" if os.access("/etc/gkworks-contact-mail.ini", os.R_OK) else "www-data-not-readable")'
