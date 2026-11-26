#!/bin/sh
# /etc/update-motd.d/99-one-click: shown at every SSH login (runs as root).
R=/opt/receptionist; O=$R/oneclick
ip=$(hostname -I | awk '{print $1}')
echo "********************************************************************************"
if [ -f "$O/code" ]; then
  echo "Finish setting up your AI receptionist platform in a browser:"
  echo "    http://$ip/        setup code: $(cat "$O/code")"
elif [ -f "$O/pending.env" ]; then
  echo "Installing from the settings in user data:  journalctl -u receptionist-oneclick -f"
elif [ -f "$O/done" ]; then
  echo "AI receptionist platform: $(cat "$O/done")"
fi
echo "Files and docs: $R (README.md). Day to day: sudo $R/dc.sh ps | logs -f app"
echo "Settings: $R/.env, then: sudo bash $R/install.sh. Keep a copy of $R/secrets.env."
echo "Firewall (ufw): only 22, 80 and 443 are open."
echo "********************************************************************************"
