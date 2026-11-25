# Compatibilidade e evolução

Status: `PENDING_NEXUS_DECISION`. Pacote proposto `1.0.0`; nenhum consumidor federado bilateral aprovado.

| Camada/consumidor | Compatibilidade demonstrada | Limite/migração |
| --- | --- | --- |
| Orbit atual (`/api/v1`, web, Flutter) | Nenhum DTO/rota/modelo de aplicação alterado nesta PR | Não usar DTO interno como schema corporativo; build nativo/Next não repetido |
| NX-01 | Proveniência global permanece separada | Conector não recebe VerifiedPlatformAuthority/PLATFORM_ADMIN |
| NX-02 | Referência futura ao provisionamento canônico/retomável e setup sem senha | Não expor `/platform-admin` ao Nexus como atalho; registrationIntent e adapter futuros |
| NX-03 | Suspensão operacional manual, independente da cobrança | Usar serviço local/correlação/versionamento; sem prazo automático proposto como implementado |
| NX-04 | Evidência de invoice/payment/adjustment e replay existentes | Sem exporter/stream corporativo; não afirmar histórico financeiro integral |
| Nexus local `4472c9356c7d89d6af61effe5ea05851d919c0e2` | Inspeção de README, schema e autenticação local | Não há contrato de consumidor federado verificável nos arquivos inspecionados; não é certificação do Nexus |
| Orbit V1, Nuance, Síntese | Identificadores/envelopes genéricos podem representar esses produtos em fixtures | Sem leitura de seus repositórios, adapters ou certificação de domínio |
| Produtor/consumidor 1.0.0 | Fixtures congeladas passam no mesmo pacote | Compatibilidade sintética local, sem transporte/IdP |
| Campo novo/enum novo | Consumidor fechado antigo rejeita | Nova versão negociada; não dizer que campo opcional é automaticamente compatível |
| Tipo/schema/major desconhecido | Rejeição explícita/quarentena | Não reinterpretar como versão antiga; erro UNSUPPORTED_VERSION |
| Correção semântica/quebra | Novo major e coexistência | Manter fixtures/testes antigos; retirada aprovada, com métricas de uso |

`1.0.0/compatibility-lock.json` congela hashes dos schemas, OpenAPI, catálogo, estados e exemplos. O teste recusa drift e remoção silenciosa. Ele não determina sozinho se uma nova versão é semanticamente compatível e não substitui review do diff; alterar golden exige decisão explícita. O pacote `1.0.0` é uma proposta candidata congelada para revisão, não uma publicação bilateral.

Integração futura deverá incluir testes reais de consumidor Nexus, autenticação/delegação/revogação, grants cross-tenant, crash/ACK/replay/ordenamento, quotas de backlog e negociação entre versões. Esses testes não existem por validação de JSON. Dependências de IdP e política bloqueiam habilitação NX-06; inbox/arquivo/snapshot bloqueiam NX-07.
