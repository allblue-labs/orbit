# Equipamentos no orçamento e documentos comerciais no aplicativo

## Equipamentos durante a proposta

No wizard de orçamento, a etapa de equipamentos oferece **Adicionar equipamento**,
inclusive quando a lista do cliente está vazia. O formulário reutiliza o cadastro
de equipamento do app; categoria e nome são obrigatórios, e os dados técnicos
continuam opcionais.

Ao confirmar, a API cadastra o equipamento na unidade em uso, vincula-o ao
cliente selecionado e o app já o marca para o orçamento. O mesmo fluxo atende
clientes existentes e clientes recém-cadastrados. Se o servidor recusar o
cadastro, o formulário conserva os campos para correção ou nova tentativa.
Cancelar o orçamento posteriormente não exclui o equipamento já cadastrado.

`POST /api/v1/mobile/field/quotes/customers/:customerId/equipment` reutiliza
`AssetService`, incluindo validação de cliente/unidade, limites do plano e
auditoria. O cliente da URL prevalece; um `customerId` divergente no corpo é
recusado. O acesso permanece restrito à organização e às unidades do operador.

## Quem pode consultar orçamentos em Documentos

- O proprietário real da organização tem acesso automaticamente.
- Todos os papéis padrão de membros continuam sem esse acesso, inclusive
  gestores e técnicos. Permissões genéricas de operação não o habilitam.
- O proprietário pode liberar individualmente em **Equipe → Cadastrar usuário →
  Acessos**, ou no detalhe do membro, em **Editar usuário**. A opção chama-se
  **Visualizar orçamentos em Documentos no app**.
- A permissão usa o controle de acesso existente:
  `mobile.quotes.documents.read`. Somente o proprietário pode concedê-la;
  um operador autorizado não pode repassá-la a outros membros.
- Alterar o acesso de um membro revoga suas sessões, conforme a regra de
  segurança existente. O técnico deve entrar novamente no app após a alteração.

A lista combina documentos de atendimento com orçamentos não excluídos,
incluindo os criados pela web. O filtro **Orçamentos** aparece somente para
quem possui esse acesso. Busca, cliente, período, organização e unidades são
aplicados no servidor; a paginação mantém posições independentes nas duas
fontes para não perder registros ao intercalá-las.

O download usa `GET /api/v1/mobile/field/quotes/:id/document`, autenticado e com
`Cache-Control: no-store`. A autorização é verificada novamente a cada pedido.
O app valida o conteúdo PDF antes de gravá-lo no armazenamento temporário
isolado da sessão e reutiliza o compartilhamento do sistema operacional.
Quando há aprovação assinada, o serviço documental existente fornece o PDF
correspondente. A nova permissão não concede gestão financeira nem autorização
para aprovar propostas de outros usuários.

Criar e compartilhar o próprio orçamento pelo wizard continua disponível ao
operador habilitado para essa atividade, mesmo sem acesso à lista de orçamentos
da organização.

## Publicação e validação

Atualizar a API, a web e o aplicativo em conjunto. Não há migration de banco,
novas variáveis de ambiente ou mudanças de configuração R2/Firebase/SES.

Testes específicos:

- `backend/src/modules/mobile-field/mobile-quote-documents.spec.ts`: padrões de
  permissão, filtros, paginação intercalada e cursores inválidos.
- `backend/test/mobile-quote-documents.e2e-spec.ts`: proprietário, concessão e
  revogação, PDF real, isolamento entre organizações e cadastro do equipamento.
- `frontend/e2e/mobile-quote-documents.spec.ts`: habilitar no cadastro e revogar
  na edição, verificando a persistência pela API.
- `mobile/test/widgets/customer_commercial_flow_test.dart`: cadastro e seleção
  automática do equipamento e recuperação de falha sem perder o formulário.
- `mobile/test/widgets/documents_screen_test.dart`: filtro conforme o acesso.
- `mobile/test/features/quote_document_download_test.dart`: envio autenticado,
  PDF válido e recusa de HTML sem gravar arquivo.

Os runners de integração em `scripts/verify-integrations.mjs` criam banco e
credenciais descartáveis; não usam as credenciais nem os dados de produção.

Validação local desta entrega:

| Camada | Resultado |
| --- | --- |
| Backend unitário | 251 suítes, 2.000 testes aprovados; quatro testes de documentos repetidos após endurecer a validação do cursor |
| API com PostgreSQL e RLS | 3 suítes, 36 testes aprovados; 111 migrations aplicadas em banco vazio |
| Web unitário | 68 arquivos, 671 testes aprovados |
| Web no navegador | Dois cenários aprovados: cadastro/liberação/revogação de documentos e regressão do cadastro de técnico; cinco smokes standalone adicionais aprovados |
| Mobile funcional | 1.271 testes aprovados; uma captura PNG manual desabilitada por padrão |
| Estática e compilação | Tipagem e lint backend/web, contratos, Flutter analyzer e build Next standalone aprovados |

Não houve publicação nas lojas, deploy ou push nesta entrega.
