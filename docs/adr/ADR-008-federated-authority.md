# ADR-008 — Autoridade federada por domínio

- Status: proposed — `PENDING_NEXUS_DECISION`
- Data: 2026-11-15
- Escopo: ORB-NX-05, contrato proposto 1.0.0; sem habilitação runtime.

## Contexto

As ORB-NX-01–04 estabeleceram proveniência global, provisionamento canônico, suspensão operacional e recuperação financeira no Orbit. Nenhuma delas implementa autorização corporativa. O Nexus inspecionado possui CRM, contratos e pagamentos próprios, mas esses modelos não são a assinatura SaaS do Orbit.

## Proposta

Nexus governa partes corporativas, diretório de produtos, contratos comerciais corporativos e solicitações de governança. Orbit governa identidade local, tenants/unidades, dados HVAC, direitos, elegibilidade, assinatura canônica, preços utilizados e sua infraestrutura/conta Stripe. A conta de pagamentos do Nexus não administra a conta Stripe Orbit por implicação.

Compartilham-se somente referências verificadas, intenções autorizadas e fatos/projeções versionados. O chamador solicita; o produto verifica máquina, operador delegado, grant, vínculo, finalidade, versão, consentimento e aprovação; seu serviço canônico executa e confirma o efeito. A decisão local pode recusar uma solicitação legítima no Nexus.

Não há CRUD genérico de `OrganizationSubscription`, impersonação do owner, escrita remota no banco, `PLATFORM_ADMIN` corporativo, concessão direta de trial/limites, refund arbitrário, criação de preço ou exclusão de tenant. Estado de cobrança, estado operacional e estado de processamento são dimensões independentes. `SUCCEEDED/SCHEDULED` confirma um agendamento, não o plano vigente.

## Alternativas e consequências

Banco compartilhado, administração Stripe central e réplica da máquina de direitos no Nexus foram rejeitados nesta proposta: ampliam autoridade e acoplam disponibilidade. O custo aceito é consistência eventual com correlação, recibos e reconciliação. A operação Orbit continua sem o Nexus; projeção corporativa desatualizada deve mostrar desconhecimento/frescor, nunca conceder direitos.

## Aprovação pendente

Nexus e Orbit devem aprovar a matriz de comandos, responsáveis, consentimentos e limites. A implementação existente da autoridade Orbit é evidência; o futuro protocolo bilateral continua proposta. Detalhes: [protocolo](../integrations/nexus/federation/protocol.md), [matriz](../integrations/nexus/federation/permissions.md).
