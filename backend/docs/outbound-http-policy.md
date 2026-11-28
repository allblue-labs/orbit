# Política de saída HTTP — IA e Web Push

O PR-11 contém os destinos controlados por tenant em integração OpenAI-compatible
e inscrições Web Push. O cadastro do endpoint push, a validação da integração de
IA e **cada envio** consultam a política atual. Integrações antigas já ACTIVE e
inscrições antigas não escapam da checagem no transporte.

## Configuração exclusiva do deployment

```dotenv
OUTBOUND_AI_ORIGINS=https://api.openai.com
OUTBOUND_WEB_PUSH_ORIGINS=https://fcm.googleapis.com,https://updates.push.services.mozilla.com,https://web.push.apple.com
OUTBOUND_AI_PRIVATE_ROUTES=[]
```

As listas são separadas por vírgula e aceitam somente origens HTTPS canônicas,
sem caminho, query, credenciais, wildcard ou porta diferente de 443. Informe a
origem de cada provedor adicional aprovado, por exemplo `https://ia.empresa.com`;
o caminho `/v1` continua na integração do tenant. Uma lista pública vazia desliga
os destinos dessa categoria. A ausência da variável usa os defaults acima.
Endpoints Windows/WNS ou outros serviços não incluídos exigem origem exata no
deployment; não se confia em sufixo informado pelo cliente nem em `*.com`.

Para **IA interna**, excepcionalmente, a administração do servidor pode configurar:

```dotenv
OUTBOUND_AI_PRIVATE_ROUTES='[{"origin":"https://model.internal.example:8443","addresses":["10.42.0.10"]}]'
```

É necessário aprovar a origem/porta **e cada IP exato** RFC1918 ou ULA. Todos os
registros A/AAAA retornados devem constar na lista; não há aprovação por subnet,
flag no tenant, hostname livre ou variável `NODE_ENV`. Web Push não herda essa
exceção. Loopback, link-local, metadata, CGNAT, IPv4 mapeado/endereços de transição
continuam proibidos. Os prefixos ULA reservados de metadata AWS/Google e o IP
virtual de infraestrutura Azure também são recusados. A origem interna precisa
de TLS válido para seu hostname e cadeia de CA pública aceita pelo Node; não há
atalho de certificado self-signed ou `rejectUnauthorized=false`.

O startup rejeita configuração malformada. Quando há rotas privadas, registra
somente quantidade e digest SHA-256 da configuração para correlação com mudanças
do deployment; não grava origens, IPs ou credenciais no log. Preservar a revisão
da configuração no processo de administração do servidor, sem versionar segredos.

## Transporte

- `OutboundDns` resolve A e AAAA com resolver próprio e cancelável, limite total
  de 5 s ou o prazo restante menor; falhas em uma família são fechadas, exceto
  ausência de registro. Até 32 resoluções simultâneas por processo, sem fila.
- Todos os IPs devem passar a política. IPv4 especial/privado e IPv6 fora de
  unicast global 2000::/3, incluindo intervalos especiais/transition, são negados
  no perfil público. Exceção interna continua limitada aos IPs explícitos.
- O HTTPS conecta diretamente ao IP aprovado, sem segunda resolução DNS ou
  reutilização de conexão entre operações. Host e SNI mantêm o hostname original;
  CA, identidade TLS e IP remoto são verificados antes de enviar headers/corpo.
- Não segue nenhum 3xx, não usa proxy global/env, cookies ou retries implícitos.
  Mudança DNS é reavaliada em cada tentativa de envio; não reaproveita aprovação
  do cadastro nem de uma validação anterior. Um resultado misto público/privado
  é recusado antes de abrir o socket.
- Máximo de 16 operações de rede por processo; excesso falha sem fila e libera
  capacidade ao concluir. DNS/handshake também contam no prazo. A conexão/TLS
  recebe até 5 s, inatividade até 30 s e prazo total até 120 s para IA (o agente
  mantém default de 60 s), ou 15 s para Web Push.
- Corpo de saída até 2 MiB, headers de resposta até 16 KiB e resposta até 1 MiB
  para IA/64 KiB para Web Push. Conta bytes de streaming, com ou sem
  Content-Length. Não aceita codificação comprimida; pede `identity` para impedir
  descompressão sem orçamento. Timeout, aborto, limite ou erro fecha a conexão.
- Erros/logs são estáticos e não incluem URL, endpoint-token, Authorization,
  chave, corpo de resposta ou mensagens arbitrárias do provedor. A IA deixa de
  concatenar mensagens do servidor remoto em seus erros persistidos.

Web Push mantém criptografia e VAPID do SDK oficial `web-push` usando
`generateRequestDetails`; somente a execução HTTP é substituída pelo transporte
limitado. Um 2xx significa aceitação pelo serviço, não leitura/exibição pelo usuário.
O Location retornado pelo provedor deixa de ser persistido como message ID,
pois pode conter capabilities. O Firebase Admin/FCM nativo e SES/SNS mantêm
seus próprios contratos; este módulo não substitui os SDKs nem o fetcher SNS
endurecido na PR-08. Não altera RLS, planos ou a autorização da caixa HTTP.

## Implantação futura

Não há migration nem dependências novas. Antes de atualizar a API, inventariar
as origens das integrações e subscriptions existentes e configurar somente os
provedores aprovados. Dados existentes não são apagados: destinos fora da política
falham com erro genérico; corrigir origem/DNS/configuração e validar novamente.
Aplicar a mesma configuração em todas as réplicas/workers que enviam notificações.
O compose já encaminha as variáveis e preserva listas públicas explicitamente vazias.

Após atualização, conferir startup, integração válida, endpoint push permitido e
recusa de destino local. A regressão TLS é local e não comprova entrega real de
FCM/VAPID ou resposta comercial de um provedor IA. Não reabrir acesso arbitrário
como rollback; recuperar a última versão corrigida e ajustar a configuração.
Contenção de saída na rede é defesa adicional a qualificar na infraestrutura,
não uma regra aplicada ao servidor por esta PR.

Referências: [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
[Node HTTPS](https://nodejs.org/api/https.html),
[web-push](https://github.com/web-push-libs/web-push),
[AWS IMDS IPv6](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html),
[Google metadata](https://docs.cloud.google.com/compute/docs/metadata/overview),
[Azure virtual IP](https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16).
