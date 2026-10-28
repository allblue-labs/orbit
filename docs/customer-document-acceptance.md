# Aceite do cliente por link

## Uso

- No orçamento, abra as ações e use **Gerar link de aprovação**. Um rascunho precisa ter itens e valor para ser enviado. Copie o endereço ou abra a opção de compartilhamento por WhatsApp.
- O cliente abre `/proposta/<token>` sem login, confere o resumo, baixa o PDF e escolhe aprovar, recusar ou pedir alterações. Aprovação exige nome, assinatura e confirmação de aceite. Recusa e alterações exigem nome e motivo.
- A aprovação muda o orçamento para **Aprovado** e mantém os eventos financeiros e de automação existentes. A recusa muda para **Recusado**. Um pedido de alterações devolve o orçamento para **Rascunho**; revise e gere outro link.
- No PMOC, use **Gerar link de assinatura (opcional)**. O cliente abre `/contrato/<token>`, lê o resumo, baixa o contrato completo e assina. O aceite não ativa nem executa o PMOC; continua opcional. A assinatura coletada aparece na emissão do contrato pela plataforma.

## Validade e integridade

Os links pendentes duram 72 horas; no orçamento também respeitam o fim da validade da proposta. Gerar outro link revoga o pendente anterior. Respostas concluídas preservam a cópia enviada e a decisão para consulta.

Cada envio guarda o resumo e o PDF daquele momento. O orçamento só aceita resposta enquanto estiver enviado e na mesma versão. Alterar o contrato PMOC, sua cobertura ou suas unidades invalida os links e impede reutilizar a assinatura anterior na nova versão. O documento original assinado permanece preservado.

O banco guarda somente o SHA-256 do token. O acesso público se limita ao documento autorizado pelo link, sem autenticar como o owner. Assinatura, referência ao documento, data, nome, consentimento do orçamento e evidências de IP/navegador são registrados. A assinatura e a transição do orçamento ocorrem na mesma transação; tentativas simultâneas não duplicam aprovação ou eventos. Os tokens são ocultados nos logs da aplicação.

## Publicação

Aprovação com assinatura, recusa, solicitação de alterações e assinatura do contrato PMOC geram um aviso ao owner da organização nas tabelas `notifications` e `notification_deliveries`, na mesma transação do aceite. Repetir a confirmação não gera outro aviso. As notificações identificam o cliente e o documento, incluem o motivo quando informado e abrem os detalhes pela navegação da central. O sino e a página de notificações usam a consulta periódica já existente (`NEXT_PUBLIC_NOTIFICATIONS_POLL_MS`, padrão de 60 segundos), além da atualização ao voltar à página. A integração requer também a migração `20261028190000_customer_acceptance_owner_notifications`.

Aplicar a migração `20261028180000_customer_document_acceptance` pelo migrator antes de publicar a API e o frontend atualizados. Não são necessárias novas variáveis de ambiente; os arquivos utilizam o armazenamento já configurado. Os links usam o domínio público do navegador de quem os gera.

Links antigos do PMOC continuam aceitos, mas apenas os links gerados após esta migração incluem a cópia congelada para download na página pública.

## Verificação

- `backend/test/customer-document-acceptance.e2e-spec.ts`: PostgreSQL com runtime restrito, RLS, concorrência, respostas, rollback, PDF e contrato PMOC.
- `frontend/e2e/customer-document-acceptance.spec.ts`: páginas públicas sem sessão em viewport de celular, download, desenho da assinatura e decisões do cliente.
- Testes do BFF verificam que a dispensa de sessão se restringe aos métodos e caminhos públicos declarados.
