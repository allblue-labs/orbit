# Configuração e gestão de visitas RVT

O wizard web usa quatro etapas: cliente, equipamentos/endereço, programação/equipe e revisão. O checklist continua sendo o do tipo de manutenção cadastrado na Central de Catálogos; o RVT não exige a estrutura de unidades e roteiros de um PMOC.

Cada ocorrência guarda seus equipamentos e o técnico previsto. A criação copia a seleção da configuração. A gestão de uma visita permite trocar a data/hora, substituir ou retirar o técnico, escolher os equipamentos da configuração, cancelar, reabrir e excluir uma visita ainda não iniciada. Mudanças e exclusões atualizam o evento correspondente na Agenda na mesma transação. Exclusão de visita é lógica e auditada; execuções e relatórios são preservados.

Editar a configuração reconcilia apenas visitas futuras, agendadas e ainda não ajustadas individualmente. A data original fica registrada para que uma visita remarcada não seja recriada na data anterior. Visitas iniciadas ou concluídas são imutáveis pela gestão da agenda.

Os técnicos operacionais e auxiliares com `rvt.read` visualizam as demandas da organização dentro das suas unidades. Executar exige `rvt.execute` e perfil de técnico de campo ativo, ou a propriedade estrutural da organização. Um técnico pode iniciar a visita atribuída a ele ou uma visita sem técnico; não pode assumir a escala de outro técnico. O proprietário pode executar como atendente efetivo. Auxiliar não recebe ações de execução e a API também recusa a mutação, mesmo que `rvt.execute` tenha sido concedida manualmente sem habilitar o perfil profissional.

O histórico lista somente execuções concluídas do mesmo cliente e unidade, uma por item, incluindo RVTs diferentes desse cliente. O modal usa a leitura existente da execução para mostrar equipe, equipamentos, evidências, aceite e relatório. Os eventos internos continuam no registro de auditoria.

## Atualização

A migration `20261028090000_rvt_visit_management` deve ser aplicada pelo migrator antes de iniciar a nova API. Ela acrescenta os campos sem apagar dados e preenche as visitas existentes. Visitas já executadas recebem o técnico e os equipamentos efetivamente registrados na execução. Atualize também o frontend. As mudanças na fila e nas permissões chegam ao aplicativo pelo backend existente.
