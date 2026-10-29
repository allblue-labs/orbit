# Criação e agenda de atendimentos

## Orçamento aprovado

O modal de conversão permite escolher técnico operacional, auxiliares elegíveis da unidade, início e término previstos, endereço cadastrado do cliente e setor. O endereço da proposta vem preenchido. O valor e os equipamentos aprovados são preservados.

Os equipamentos vinculados e o total aprovado aparecem no modal para conferência. O valor continua vindo do orçamento; não é copiado como valor manual. A opção **Permitir que o técnico em campo veja o valor** começa desmarcada e é gravada na operação.

A conversão usa a criação canônica de operações: valida referências/equipe, reserva o número da OS, registra participações, cota e eventos. A criação e o vínculo com a proposta confirmam na mesma transação; repetir a conversão devolve a mesma operação.

Notificações destinadas a outra pessoa são enfileiradas em `mobile.notification.materialize` e processadas pelo worker existente no escopo do destinatário. Isso respeita a RLS das caixas privadas e dos dispositivos sem invalidar a transação da conversão. O worker de jobs deve permanecer ativo (`JOBS_WORKER_ENABLED`, padrão `true`). Não há novas migrações ou variáveis obrigatórias para este ajuste.

## Confirmação da agenda

Antes de criar, editar ou atribuir um técnico na web, a consulta `POST /operations/schedule-check` procura operações e eventos de calendário da equipe. Inclui recorrências, exceções, sobreposição de duração e intervalo de até 10 minutos, comparando instantes completos. A consulta respeita organização e unidades permitidas e exclui o próprio atendimento na edição.

O aviso lista técnico, compromisso e horário. O owner pode voltar para ajustar ou confirmar e continuar. A consulta é consultiva; a confirmação permite criar a operação mesmo com o conflito. Na Agenda, o contrato existente `allowConflicts` permite prosseguir após o aviso; alterar os campos exige nova confirmação.

## Atendimentos iniciados no mobile

Ao iniciar para cliente cadastrado ou novo cliente, o próprio técnico já recebe a ordem liberada. Demandas distribuídas pelo escritório continuam usando o fluxo de autorização configurado.

Aplicar a migração `20261028200000_self_started_walk_in_authorization` para corrigir pendências antigas comprovadamente abertas pelo próprio atendente. A migração preserva reatribuições e revogações explícitas do escritório.

## Detalhes

A linha do tempo permanece como o registro da evolução do atendimento. O painel Histórico foi retirado da página. Informações adicionais apresentam campos legíveis e um link ao orçamento de origem, filtrando IDs, hashes e metadados técnicos.
