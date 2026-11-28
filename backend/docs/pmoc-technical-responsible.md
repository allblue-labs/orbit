# Responsável Técnico do PMOC

Novos planos exigem `technicalResponsibleUserId`, validado pela lista de
profissionais habilitados na organização e na unidade do contrato. O owner
aparece quando seu perfil profissional o habilita para essa função; não recebe
a responsabilidade apenas por ser proprietário.

O wizard exige a escolha na etapa Responsáveis. O formulário de edição também
oferece o campo, preenchido com o responsável atual. Na aba Execuções, um item
com `TECHNICAL_RESPONSIBLE_MISSING` oferece **Definir Responsável Técnico** para
quem possui `pmoc.manage`, abrindo a mesma edição. Após salvar, plano, lista,
elegibilidade, preparação e histórico são invalidados no cache para atualizar
os itens sem recarregar a página.

Se não houver profissional habilitado, o formulário explica como configurar
o perfil em Equipe e impede salvar uma escolha vazia. Erros ao carregar a lista
têm opção de tentar novamente. A consulta utiliza a unidade do próprio plano.

O backend também exige um responsável ao salvar e ativar planos existentes.
Um PATCH que não altera o campo preserva e revalida o responsável atual; `null`
ou uma escolha de outra organização/unidade não remove nem substitui o vínculo.
Somente a definição do profissional é obrigatória para configurar o contrato:
a assinatura pode ser cadastrada depois, mas continua necessária antes de
iniciar a execução, conforme a regra existente.

Planos legados sem responsável continuam disponíveis para correção pela edição.
Não há atribuição automática em massa nem migração de dados. Os snapshots e as
assinaturas de atendimentos já registrados permanecem vinculados à execução.

Publique API e frontend juntos: `POST /pmoc/plans` agora exige o campo também
para integrações. O schema do banco continua aceitando os registros legados
enquanto são corrigidos pelo usuário.
