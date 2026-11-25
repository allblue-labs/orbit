# Área do proprietário no app Orbit

O atalho fica no **Perfil → Área do proprietário**. As listas usam a unidade ativa quando o cadastro é por unidade. Clientes pertencem à organização. As ações frequentes abrem em folhas inferiores e os cadastros de OS, PMOC e RVT avançam em etapas curtas.

| Na web | Na Área do proprietário |
| --- | --- |
| Operações → Ordens de Serviço | Criar OS, editar dados e horários, atribuir ou substituir o técnico, acompanhar a linha do tempo e cancelar atendimento. O atalho **Operações de hoje** abre o dia no fuso da conta. |
| Financeiro → Orçamentos | Selecionar o cliente e continuar no wizard de orçamento, com PDF e aceite já integrados. |
| Financeiro → Recibos | Criar recibo, confirmar o recebimento e gerar o PDF com a assinatura ativa quando exigida pelo modelo, depois compartilhar ou salvar pelo menu do aparelho. |
| Financeiro → Lançamentos | Registrar entradas e saídas, editar lançamentos manuais, confirmar pagamentos e cancelar com motivo. |
| Clientes → Cadastro, endereços e equipamentos | Pesquisar, consultar, cadastrar, editar e remover. O equipamento é criado vinculado ao cliente e à unidade ativa. |
| Operações → PMOC | Criar e editar o plano, definir Responsável Técnico, gerir cobertura e roteiros, ativar, suspender, cancelar, agendar e reatribuir execuções por equipamento e abrir o atendimento quando estiver elegível. |
| Operações → RVT | Criar e editar visitas únicas ou recorrentes, gerenciar equipamentos e visitas, reagendar, reatribuir e cancelar. O cancelamento do RVT também cancela os compromissos previstos e conserva o histórico. |
| Equipe e Operações → Pendências | Cadastrar, editar, suspender, reativar e desligar técnicos. Autorizar ou bloquear OS, RVTs e ciclos de PMOC quando a organização exige autorização. |

O servidor resolve o acesso da sessão móvel a cada requisição. O proprietário efetivo da organização recebe acesso às ações disponíveis no plano. O papel **Administrador** usa as permissões de gestão que já recebeu na organização. O **Técnico Operacional** começa com todas as permissões da área desativadas. O proprietário pode conceder e revogar por função em **Equipe de campo → Técnico → Permissões da Área do proprietário**. A gestão de membros e delegações fica fora do catálogo de permissões delegáveis.

A API mantém a verificação de plano, unidade e estado dos registros. Mudar a delegação se aplica nas próximas requisições de sessões que já estão abertas. A migration adiciona a lista de delegações com padrão vazio aos vínculos existentes. Os [bloqueios para publicação](release/production-blockers.md) continuam na lista de retomada do PR-19.
