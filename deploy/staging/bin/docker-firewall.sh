#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
iface=$(ip -4 route show default | awk 'NR == 1 {print $5}')
[[ -n "$iface" ]] || { echo 'Interface de saída não encontrada.' >&2; exit 1; }
# Backend iptables do Docker. Não desative iptables no daemon.json.
iptables -w -S DOCKER-USER >/dev/null
iptables -w -N ORBIT-INGRESS 2>/dev/null || true
iptables -w -F ORBIT-INGRESS
iptables -w -A ORBIT-INGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# Nginx executa no host; nenhum container aceita entrada direta pela rede física.
iptables -w -A ORBIT-INGRESS -i "$iface" -j DROP
iptables -w -A ORBIT-INGRESS -j RETURN
iptables -w -C DOCKER-USER -j ORBIT-INGRESS 2>/dev/null || iptables -w -I DOCKER-USER 1 -j ORBIT-INGRESS
if ip6tables -w -S DOCKER-USER >/dev/null 2>&1; then
    ip6tables -w -N ORBIT-INGRESS 2>/dev/null || true
    ip6tables -w -F ORBIT-INGRESS
    ip6tables -w -A ORBIT-INGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    ip6tables -w -A ORBIT-INGRESS -i "$iface" -j DROP
    ip6tables -w -A ORBIT-INGRESS -j RETURN
    ip6tables -w -C DOCKER-USER -j ORBIT-INGRESS 2>/dev/null || ip6tables -w -I DOCKER-USER 1 -j ORBIT-INGRESS
fi
