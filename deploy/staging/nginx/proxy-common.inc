proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
# Substitui cabeçalhos fornecidos pelo cliente, em vez de concatená-los.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header Forwarded "";
proxy_set_header CF-Connecting-IP "";
# Private credential installed from the staging .env, never committed.
include /etc/nginx/orbit-proxy-secret.inc;
proxy_set_header X-Orbit-Client-IP $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port 443;
proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 90s;
proxy_redirect off;
