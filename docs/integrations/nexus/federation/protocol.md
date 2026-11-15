# Protocolo federado Allblue — proposta 1.0.0

**PENDING_NEXUS_DECISION.** Schema válido não representa solicitação autorizada ou feature habilitada. Todos os endpoints de `1.0.0/openapi.json` são futuros. Não há endpoints corporativos, migrations, outbox/inbox, trust registry ou consumidor Nexus implementados nesta PR.

## Autoridade e IDs

Nexus detém CRM/party e contrato corporativo; cada produto detém operação, acesso e cobrança própria. Nexus solicita e observa; o produto autoriza, executa e confirma. Modelos comerciais parecidos não implicam fonte compartilhada. Nenhum comando genérico muda assinatura, direitos, trial, preços, secret Stripe, senha, grants globais ou exclui dados. Orbit não altera contrato corporativo como autoridade de CRM.

| Identificador | Namespace e semântica |
| --- | --- |
| `nexusPartyId` | Parte corporativa opaca Nexus; não CPF/CNPJ nem tenant |
| `productId` | Slug registrado, por exemplo `orbit-v2`; aceitação depende de registry, não apenas regex |
| `environment` | `staging`/`production`; sem alias `prod`/`live` implícito |
| `target.instanceId` | Instalação registrada do produto; equivale a `orbitInstanceId` no adaptador Orbit |
| `target.tenantId` | ID local qualificado pelo deployment; equivale a `orbitTenantId`/`Organization.id`, nunca uma unidade |
| `nexusCommercialContractId` | Contrato Nexus; lista histórica/verificada no vínculo, distinta da assinatura efetiva |
| `orbitSubscriptionId` | Contratação local; retorno pode criar novo ID; eventos antigos não afetam a nova |
| `billingAccountRef`, `mode` | Namespace financeiro opaco e TEST/LIVE; staging só TEST, produção só LIVE neste perfil inicial |
| IDs Stripe | Customer/subscription/invoice/payment são correlações restritas do adaptador; só referências mínimas de evidência saem quando autorizadas. Nenhuma é identidade corporativa ou credencial |
| `issuer` + `corporateSubject` | Identidade humana federada verificável; não nome/e-mail nem `User.id` local |
| `connectorClientId` | Máquina OAuth, distinta do humano e do aprovador |
| `grantId` | Concessão local verificável por produto/deployment/tenant/ação/finalidade/validade |
| `linkId`, `commandId`, `receiptId`, `event.id` | Vínculo, intenção, registro de processamento e fato; identidades separadas |

O núcleo usa IDs locais opacos de até 128 caracteres; um produto pode restringi-los no adaptador (Orbit usa UUID). IDs não contêm PII. Não reutilizar UUID local como sujeito global nem inferir acesso por coincidência. Cardinalidade e estados de `PartyProductTenantLink`: [ADR-009](../../../adr/ADR-009-federated-identity-and-links.md). Primeiro vínculo/transferência exige prova e aprovação; igualdade de documento, e-mail, nome ou Stripe Customer nunca autoriza associação.

## Eventos e origem do fato

CloudEvents em modo estruturado: `application/cloudevents+json`, `specversion=1.0`. Perfil fechado: source URN por produto/ambiente/instância, ID UUID, tipo `com.allbluelabs.{productId}.{nome}.v1`, subject `tenants/{tenantId}`, dataschema exato, correlationid e observado. Extensões `observedat` e `occurrencebasis` usam nomes CloudEvents em minúsculas. `time` existe quando a ocorrência é conhecida; se `occurrencebasis=UNKNOWN`, deve ser omitido. `observedat` nunca substitui ocorrência histórica desconhecida.

`data` contém schemaVersion, target, aggregate (tipo/ID/versão), sequence durável, provenance e payload específico. A ocorrência deve ser anterior/igual à observação. Agregado e payload devem concordar nos IDs. Fonte, produto e tenant devem concordar com a identidade autenticada; passar no schema não comprova essa origem. Nenhum evento nasce de campo legado ou de redirect/efeito pendente.

| Tipo (major v1) | Fonte/condição de publicação futura |
| --- | --- |
| `tenant.created`, `tenant.updated` | Commit real NX-02/alteração permitida; criação não implica acesso pago. Updated traz nomes dos campos alterados, não PII/objeto Prisma |
| `tenant.suspended`, `tenant.reactivated` | Decisão operacional aplicada NX-03, versão/motivo; admissões posteriores ao commit reavaliam o estado. Trabalho já admitido pode terminar |
| `subscription.created`, `subscription.changed` | Contrato canônico commitado, com versão de catálogo/direitos identificável; UNKNOWN não é fato confirmado |
| `subscription.change_scheduled` | Target/fim do período confirmados; plano atual preservado |
| `subscription.cancellation_scheduled` | Recorrência futura cancelada; informa até quando o acesso contratado é preservado |
| `subscription.canceled` | Encerramento efetivo confirmado; não significa purge de dados |
| `billing.invoice_settled` | Fatura liquidada; `settlementBasis` distingue pagamento, crédito, zero, fora do provedor ou desconhecido |
| `billing.payment_succeeded` | Evidência NX-04 de InvoicePayment paga + PaymentIntent succeeded, vinculada a invoice/customer/subscription/conta/modo/moeda/valor. confirmedAt original, provenance PROVIDER_RECONCILIATION; valor positivo |
| `billing.payment_failed` | Tentativa identificada com categoria segura; falha histórica não regride fatura paga nem prova bloqueio atual |
| `billing.adjustment_updated` | Estado normalizado observado de refund/dispute; OPEN/WON/LOST não são refund concluído |
| `billing.refund_completed` | Ajuste REFUND/SUCCEEDED persistido. `completionOccurredAt=null` se a fonte não comprovar essa data; não inventá-la com createdAt/observedAt |
| `usage.metrics_recorded` | Schema reservado, **DEFERRED**: definição/janela/unidade e SLO ainda dependem de NX-12/Nexus |

`support.*` não tem schema nem tipo habilitado; tickets de atendimento HVAC não são tickets SaaS. A NX-04 possui evidência financeira local, mas não exporter, sequência corporativa ou ledger contábil universal. ID do fato de pagamento é estável por identidade financeira correlacionada, não um evento por cada webhook que menciona a mesma invoice. Dedupe financeiro deve considerar conta/modo e InvoicePayment/PaymentIntent; não somar invoice_settled e payment_succeeded como duas entradas de caixa. Valores são inteiros seguros em unidade menor; não somar moedas ou chamar liquidação de receita reconhecida.

`priceVersionRef` e `targetPriceVersionRef` reservam referências opacas ao registry histórico futuro, com `null` enquanto não resolvidas. Esse registry deverá qualificar produto/ambiente/conta/modo/catálogo e preservar versões antigas; não é um Price ID escolhido pelo Nexus, nem há registry criado nesta PR. Vocabulário normalizado de ajustes é proposto: estados sem tradução comprovada permanecem UNKNOWN, sem converter uma disputa desconhecida em refund SUCCEEDED.

## Comandos, autorização e efeitos

Consultas são GETs minimizados, sem criar recibo de escrita. Os sete comandos tipados estão na [matriz](permissions.md). Todos permanecem desabilitados até suas PRs/gates. Target do provisionamento identifica deployment e vínculo reservado; seu tenant só existe após efeito real. Os demais exigem tenant.

O comando carrega `protocolVersion`, commandId, issuer/connector declarados para correlação, target, linkId, grantId, delegationRef, correlationId, issuedAt/expiresAt, reasonCode, precondition e parâmetros fechados. Issuer/connector declarados precisam coincidir com prova autenticada. Aprovação referenciada pode estar ausente na recepção: nesse caso, nenhuma execução antes de AWAITING_APPROVAL e comprovação válida.

Provisionamento referencia `registrationIntentRef`: futura intenção de cadastro verificada no produto, com dados obrigatórios e owner/setup/representação validados por canal apropriado. Não é um cadastro sem dados por string arbitrária. Sua criação/resolução é dependência NX-06/NX-09; esta PR não cria nem publica o endpoint. O recibo PROVISIONED confirma tenant + assinatura canônica + setup enfileirado; access PENDING_PAYMENT/TRIALING não prova pagamento/entrega/aceitação jurídica. A senha não passa pelo Nexus.

Precondição é `(aggregate,version)`: LINK para provisionamento, TENANT para metadados/estado operacional, SUBSCRIPTION para contratação. Adaptador Orbit traduz TENANT para o `updatedAt`/versão operacional apropriado da consulta; SUBSCRIPTION usa a versão canônica positiva como string decimal. Reconsulta no commit/CAS; leitura anterior não autoriza overwrite. Nenhum consumidor escolhe versão do período/limite arbitrariamente.

Em plano pago vigente, mudança confirmada para o vencimento retorna SUCCEEDED/SCHEDULED, sem alterar direitos antecipadamente. Trial elegível continua sob TrialEligibilityService; término antecipado de dias grátis precisa de consentimento/ação do cliente. Cancelamento preserva período pago e política de retenção aplicável. Keep só desfaz cancelamento futuro de contratação ainda válida, sem ressuscitar assinatura encerrada. Suspensão operacional NX-03 é manual/imediata e não afeta cobrança, Stripe, cancelamento ou purge. Não há auto-reativação por prazo na versão atual do Orbit.

## Recibos e erros

`state-machine.json` é a definição explícita. ACCEPTED → AWAITING_APPROVAL/EXECUTING/REJECTED/EXPIRED; AWAITING_APPROVAL → EXECUTING/REJECTED/EXPIRED; EXECUTING → AWAITING_CUSTOMER_ACTION/SUCCEEDED/FAILED/REJECTED; AWAITING_CUSTOMER_ACTION → EXECUTING/REJECTED/EXPIRED. Terminais não têm saída. Reexecução interna sob lease não é nova transição de negócio.

EXPIRED só é seguro quando não existe efeito externo desconhecido nem ação do cliente passível de confirmação tardia: a implementação deve resolver/revogar/expirar a ação externa e reconciliar. Se resultado for desconhecido, EXECUTING/RECONCILIATION_REQUIRED. Não usar o relógio de expiresAt para cancelar um pagamento já confirmado. FAILED significa falha terminal com não aplicação comprovada; falha transitória fica no processamento/retry. Nenhuma compensação financeira silenciosa.

Recibo tem receiptVersion, acceptedAt/updatedAt, target, confirmador produto, correlationId, processingStatus e effect separado. NONE em estados sem efeito final; CUSTOMER_ACTION_REQUIRED apenas aguardando cliente; SUCCEEDED admite somente efeito compatível com a intenção (PROVISIONED, APPLIED, UNCHANGED, SCHEDULED ou CANCELLATION_SCHEDULED). `actionRef` é referência opaca: acesso ao checkout exige sessão/grant próprio, não URL financeira no evento ou recibo geral. `error` usa código estável e mensagem segura, sem stack/payload do fornecedor.

| HTTP proposto | Semântica |
| --- | --- |
| 200 | Consulta ou replay autorizado de recibo; em eventos, ACK durável |
| 202 | Recibo/inbox persistido; não aplicação de negócio |
| 400/422 | Forma ou semântica inválida; corrigir antes de novo envio |
| 401/403 | Falha de identidade/autoridade; não inferir tenant existente |
| 404 | Alvo/recibo não disponível ao principal; mesmo comportamento para inexistente/inacessível quando necessário |
| 409 | STALE_VERSION, IDEMPOTENCY_MISMATCH, MESSAGE_ID_COLLISION ou precondição incompatível |
| 410 | Cursor/snapshot expirado ou lacuna irrecuperável pelo cursor atual |
| 429/503 | Backoff/indisponibilidade; consultar a identidade original antes de repetir qualquer intenção |

Idempotência e aprovação: [ADR-011](../../../adr/ADR-011-federated-delivery-and-receipts.md). Timeout não é FAILED. Consulta de recibo exige autenticação/grant por cliente/target; conhecer commandId/receiptId não autoriza leitura. Recuperação após timeout mantém a mesma intenção/ID/chave. Proposta de validade máxima do comando: cinco minutos para iniciar efeitos; aprovação deve ser comprovada dentro desse prazo, além de grants/provas ainda válidos. Expiração não é estendida por replay, renovação de token ou aprovação tardia, nem alterada no corpo original. Se nenhum efeito começou e a expiração foi confirmada, uma nova intenção exige nova autorização explícita.

Uma ação externa iniciada legitimamente antes do prazo pode confirmar depois: reconciliação/fulfillment desse efeito pendente continua pelo domínio do produto, sem emitir outro comando externo e sem negar pagamento já confirmado por revogação posterior do conector. AWAITING_CUSTOMER_ACTION não se torna EXPIRED até comprovar que a ação não pode mais aplicar efeito. Esse tratamento impede usar timeout/expiração corporativa como compensação financeira.

## Segurança, auditoria e minimização

OAuth M2M e integridade seguem [ADR-009](../../../adr/ADR-009-federated-identity-and-links.md)/[011](../../../adr/ADR-011-federated-delivery-and-receipts.md). OIDC/SSO e step-up são dependências futuras; o login Nexus atual não os implementa. Revogação de máquina, grant, vínculo, delegação, aprovação ou chave é reavaliada no limite de execução. Trust desconhecido falha fechado somente no bridge, sem indisponibilizar o produto. Aprovação crítica é separada do solicitante; consentimento do cliente não pode ser fabricado por operador corporativo.

Auditar separadamente máquina (issuer/client/kid), humano (issuer/sub), aprovador, grant/policy/link versions, alvo, finalidade/motivo, hash da intenção, versão esperada/observada, correlação, recibo, resultado e timestamp do commit. Leituras sensíveis/catch-up/replay também auditadas. Não registrar bearer, client assertion, token de sessão, assinatura coletada, segredo, raw Stripe ou documento HVAC. Ref de prova não contém o conteúdo criptográfico sensível no log.

Projeções não exportam owner/e-mail/CPF/CNPJ/endereço, clientes, equipamentos, checklist, foto, evidência, assinatura, PDF/URL assinada ou segredo cifrado. `tenant.update` tem allowlist específica de displayName/primarySegment; esse write autorizado não justifica devolver toda a organização em reads/eventos. O esquema fechado impede campos extras; o produtor também deve impedir PII disfarçada em valores de IDs/reasons. Autorização/finalidade continua necessária mesmo sem PII direta.

## Leituras, entrega e recuperação

Read envelope informa versão, target, asOf, versão do agregado, watermark, freshness e dados selecionados. Diretório de até 200 itens omite owner/contatos/unidades HVAC; assinatura vem da projeção canônica (UNKNOWN_LEGACY não concede plano); billing mostra fatura e valor confirmado pelo provedor sem URL/cartão; uso é futuro e agregado. `operationalStatus=ACTIVE` não declara acesso financeiro. UNKNOWN não é saudável/zero por padrão.

Entrega, snapshot consistente, cursores, retries/DLQ, retenção proposta e backlog: [ADR-012](../../../adr/ADR-012-federated-reconciliation.md). Nenhum corte MVCC, ACK ou hash de dedupe foi implementado no runtime nesta PR. ACK inclui source, eventId e hash para correlação da entrega; projeção pode continuar pendente. Nexus indisponível não participa de login, atendimento, emissão, webhook ou checkout Orbit.

## Referências normativas consultadas

- [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md): envelope estruturado e identidade do evento.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core): schemas independentes e resolução por identificador.
- [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html): descrição das interfaces propostas, não implementação.
- [OAuth Security BCP, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html): referência para o desenho de confiança.
- [HTTP Message Signatures, RFC 9421](https://www.rfc-editor.org/rfc/rfc9421.html) e [JCS, RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html): propostas distintas para integridade de transporte e identidade lógica; perfil final pendente.
