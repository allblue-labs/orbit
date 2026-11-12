#!/usr/bin/env bash
# Após deploy saudável: primeiro backup, agendamento e aplicação do kernel novo.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
curl -fsS http://127.0.0.1:6001/health/ready >/dev/null
nginx -t
systemctl enable --now orbit-docker-firewall.service
systemctl reload-or-restart orbit-docker-firewall.service
/usr/local/sbin/orbit-backup
systemctl enable --now orbit-backup.timer
curl -fsS --retry 10 --retry-all-errors --retry-delay 2 --max-time 3 http://127.0.0.1:6001/health/ready >/dev/null
ufw status numbered
iptables -w -S ORBIT-INGRESS
systemctl list-timers orbit-backup.timer --no-pager
find /var/backups/orbit -mindepth 2 -maxdepth 2 -name COMPLETE -printf '%h\n'
echo "Kernel em execução: $(uname -r)"
if [[ ${1:-} == --reboot ]]; then
    echo 'Backup concluído. Reiniciando para aplicar kernel e microcódigo atualizados.'
    systemctl reboot
else
    echo 'Se houver reboot pendente, execute sudo reboot e valide os serviços novamente.'
fi
