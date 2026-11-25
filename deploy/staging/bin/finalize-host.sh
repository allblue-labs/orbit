#!/usr/bin/env bash
# Após deploy saudável: verificação do serviço e aplicação do kernel novo.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
curl -fsS http://127.0.0.1:6001/health/ready >/dev/null
nginx -t
systemctl enable --now orbit-docker-firewall.service
systemctl reload-or-restart orbit-docker-firewall.service
curl -fsS --retry 10 --retry-all-errors --retry-delay 2 --max-time 3 http://127.0.0.1:6001/health/ready >/dev/null
ufw status numbered
iptables -w -S ORBIT-INGRESS
echo "Kernel em execução: $(uname -r)"
if [[ ${1:-} == --reboot ]]; then
    echo 'Validação concluída. Reiniciando para aplicar kernel e microcódigo atualizados.'
    systemctl reboot
else
    echo 'Se houver reboot pendente, execute sudo reboot e valide os serviços novamente.'
fi
