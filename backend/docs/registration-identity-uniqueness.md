# Identidade do cliente no cadastro público

Uma conta de cliente (`Organization` no banco) possui a assinatura. As
organizações cadastradas dentro dela são `BusinessUnit`; a criação existente
em Configurações > Organização consulta as permissões, o plano ativo e a cota
`BUSINESS_UNITS`. Elas podem compartilhar CPF/CNPJ ou usar documentos diferentes.
Não recebem outra avaliação nem outra assinatura apenas por serem cadastradas.

## Cadastro e concorrência

`RegistrationService` marca o cadastro público por uma opção interna do
repositório. O corpo HTTP não aceita essa opção. Antes de criar o proprietário,
a transação reserva o CPF/CNPJ normalizado em `account_document_registrations`.
A chave primária global serializa envios concorrentes: somente um pode criar
a conta e prosseguir para o provisionamento da assinatura. Uma falha posterior,
como e-mail ou nome de conta duplicado, desfaz também a reserva.

A função SQL executa apenas essa reserva. O papel de runtime não pode inserir,
alterar ou excluir a tabela diretamente; leituras exigem contexto da plataforma.
O vínculo com a conta é verificado por um FK adiado até o commit. Não se expõe
consulta pública de disponibilidade de documento ou dados da conta existente.

Um trigger lembra documentos novos utilizados por organizações internas sem
impedir que sejam repetidos. Assim, um documento já usado nesse fluxo também
não abre outra conta independente pelo cadastro público. A reserva é preservada
durante o prazo de retorno e a exclusão operacional após cancelamento, junto dos
registros mínimos da conta. Trocar o documento de uma unidade não libera o
documento anterior para um novo cadastro público.

O antigo `POST /organizations` autenticado responde
`REGISTRATION_USE_EXISTING_ACCOUNT`: ele criava outro tenant com uma avaliação
legada, sem conferir a assinatura atual. Novas organizações usam o fluxo
existente `/organizations/current/business-units`. O provisionamento da
administração da plataforma permanece separado.

## Conflitos apresentados ao cliente

| Código | Orientação |
| --- | --- |
| `REGISTRATION_DOCUMENT_ALREADY_EXISTS` | Entrar na conta existente, retomar a assinatura ou criar organizações pelo sistema. |
| `REGISTRATION_EMAIL_ALREADY_EXISTS` | Entrar, recuperar a senha ou usar outro e-mail para outra conta com outro documento. |
| `REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE` | Informar outro nome de conta; a razão social pode ser mantida. |
| `REGISTRATION_CONFLICT` | Recuperar a conta ou contatar o suporte quando a restrição não é reconhecida. |
| `BUSINESS_UNIT_NAME_ALREADY_EXISTS` | Escolher outro nome fantasia para distinguir a organização interna. |

Mensagens vêm do catálogo público, sem texto cru do banco. O wizard conserva
os campos e o plano, volta à etapa correspondente e mostra o erro junto ao
campo e em um aviso persistente, com link de login quando aplicável.
Avançar ou pressionar Enter nas etapas intermediárias apenas valida e troca
a etapa. Somente a confirmação da última etapa envia o cadastro. Botões de
avanço e confirmação possuem identidades distintas, evitando que a transição
depois de uma correção dispare outro envio automaticamente.

## Migração e duplicidades anteriores

Aplicar `20261024120000_account_document_registration` antes de publicar a API.
Publicar também o frontend novo. Não há novas envs.
Atualizar todas as réplicas da API: versões antigas não utilizam a reserva.

```sh
docker compose build api migrate frontend
docker compose run --rm migrate
docker compose up -d --no-deps api frontend
```

A migração reserva todos os documentos existentes, normalizando os formatos.
Se várias contas já usam um documento, cria uma única reserva baseada na linha
mais antiga; **não mescla, exclui nem cancela contas ou cobranças existentes**.
Esses casos precisam de revisão administrativa, preservando os vínculos dos
clientes e o histórico financeiro. A nova proteção já impede outra repetição.

A restrição antiga de documento único dentro da conta é substituída por índice
comum. A unicidade do nome da organização dentro da conta e os limites da
assinatura continuam válidos.
