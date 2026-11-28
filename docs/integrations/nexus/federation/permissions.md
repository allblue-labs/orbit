# Matriz proposta de permissões e comandos

**PENDING_NEXUS_DECISION. Todas as linhas são propostas/desabilitadas.** Scope OAuth é necessário, mas não suficiente: interseção com grant local, produto/ambiente/instância, vínculo verificado, tenant, ação, finalidade, delegação, aprovação e versão. Não existe wildcard cross-tenant implícito nem promoção a PLATFORM_ADMIN.

| Intenção/consulta | Scope proposto | Precondição e aprovação | Resultado/fase futura |
| --- | --- | --- | --- |
| Diretório/tenant operacional | `allblue.tenants.read` | Grant por conjunto explícito de tenants e finalidade; leitura auditada | Leitura minimizada NX-08 |
| Assinatura | `allblue.subscriptions.read` | Tenant grant; somente fonte canônica/estado desconhecido explícito | NX-08 |
| Billing | `allblue.billing.read` | Tenant + conta/modo + finalidade financeira; sem URLs/card/PII | NX-08 |
| Uso agregado | `allblue.usage.read` | Definição/janela aprovadas e custo limitado | **DEFERRED**, NX-12 |
| Recibo | `allblue.receipts.read` | Cliente/issuer e alvo da intenção ou grant explícito de supervisão | NX-09; ID isolado não autoriza |
| `tenant.provision.v1` | `allblue.tenants.provision` | LINK version, vínculo reservado comprovado, registrationIntent verificada, humano delegado + aprovação comercial independente | NX-09; PROVISIONED com setup QUEUED e acesso PENDING_PAYMENT/TRIALING |
| `tenant.update.v1` | `allblue.tenants.update` | TENANT version; somente displayName/primarySegment; delegação e propósito. Política local decide necessidade de aprovação adicional | NX-09; APPLIED/UNCHANGED |
| `subscription.request_plan_change.v1` | `allblue.subscriptions.request` | SUBSCRIPTION version, humano delegado, aprovação aplicável e consentimento/ação do cliente; plano comercial, nunca Price ID | NX-10; SCHEDULED/APPLIED/UNCHANGED ou AWAITING_CUSTOMER_ACTION |
| `subscription.request_cancel.v1` | `allblue.subscriptions.request` | SUBSCRIPTION version; step-up recente + aprovador distinto + consentimento e política de retenção referenciados/verificados | NX-10; CANCELLATION_SCHEDULED/UNCHANGED, preserva período pago |
| `subscription.request_keep.v1` | `allblue.subscriptions.request` | SUBSCRIPTION version; autorização/consentimento, contratação ainda válida e cancelamento futuro | NX-10; APPLIED/UNCHANGED, não reabre encerrada |
| `tenant.request_suspend.v1` | `allblue.tenants.access.request` | TENANT version, motivo SECURITY/ABUSE/ADMINISTRATIVE, step-up + aprovador distinto. Sem suspensão temporária automática nesta versão Orbit | NX-09 após política/aceite; APPLIED/UNCHANGED sem alterar cobrança |
| `tenant.request_reactivate.v1` | `allblue.tenants.access.request` | TENANT version, RESOLVED, step-up + aprovador distinto, critérios NX-03 (sem purge, contrato canônico existente) | APPLIED/UNCHANGED; gate financeiro permanece |
| Publicação de fatos | `allblue.events.publish` | Conector do produto/origem registrada, allowlist de tipos/versões e grant de destino | NX-07; inbox durável Nexus |
| Catch-up/snapshot | `allblue.events.catch_up` | Grant por origem/tenant, cursor vinculado a filtros/versão/principal e auditoria | NX-07/08; sem autorizar reexecução de comando |

Reprocessar DLQ é operação de suporte governada, não comando comercial genérico. Replay preserva ID/hash e exige autorização operacional/auditoria; não há endpoint remoto de replay de billing na NX-05. Novos aprovadores e a emissão de grants não são feitos por esses comandos.

Sem scope habilitável neste perfil: alteração de preço/Stripe account/key, refund arbitrário, grant global, senha/impersonação, trial manual, set ACTIVE/limite/período, exclusão destrutiva, suspensão financeira genérica, suporte com dados HVAC. Registry histórico de preços é preparação de contrato, não feature implementada. Nenhuma permissão Nexus sobre seu CRM ou Stripe se propaga para a Stripe Orbit.
