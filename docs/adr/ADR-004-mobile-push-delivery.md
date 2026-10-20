# ADR-004 — Notification persistida e Push Delivery por instalação

## Status

Aceita.

## Decisão

Preservar `Notification` como fato/inbox e representar o canal Mobile por `MobileDeviceInstallation` e `MobilePushDelivery`. A identidade estável é o `deviceInstanceId` app-scoped do MB-04; push token é rotativo. Uma delivery é única por notificação e instalação.

Materialização e enqueue usam PostgreSQL/BackgroundJobQueue existentes. O provider roda apenas no worker e recebe um payload neutro. Produção pode conectar FCM/APNs por gateway configurado; desenvolvimento usa modo explicitamente desabilitado.

## Consequências

- falha de push não bloqueia fatos de domínio;
- troca de usuário não mantém o binding antigo;
- múltiplos devices e retries convergem por constraints;
- o app sempre relê a API e não trata push como autorização;
- aceite do provider não é modelado como leitura.
