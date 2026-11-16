# PR-09 — Upload limitado e integridade dos objetos

Achado **F08**, base limpa `0e12923`, implementação local em 16/11/2026.
Sem push, merge, deploy ou operação em buckets/bancos reais. A aprovação geral
de produção continua condicionada às demais PRs e aos aceites externos do plano.

## Alterações

- Reserva e tenant são verificados antes do parser. O corpo é limitado durante
  a leitura, mesmo sem Content-Length, com prazos total/inativo e encerramento
  de corpos recusados. Multipart é limitado em arquivos, partes, campos e headers.
  Os mesmos controles de transporte atendem imagens de marca, PMOC e anexos de OS.
- Admissão em transação curta, limite por processo e limite por tenant entre
  réplicas, exclusão da mesma reserva e recuperação por lease. Reservas pendentes
  também têm orçamento atômico de quantidade/bytes. Na admissão/gateway, I/O de rede fica fora das
  transações de banco. A tabela nova tem RLS e FK composta, com limpeza operacional.
- A base R2 já separava chave original e canônica. Agora os providers também
  recusam overwrite: publicação LOCAL atômica e create-only S3/R2. Não se emitem
  assinaturas PUT diretas. URL original permite replay idêntico, sem nova gravação;
  não autoriza modificar a chave final. Renovar uma intenção ainda não finalizada
  mantém chave/MIME de origem, inclusive após a conversão em WebP. Conteúdo de PDF
  é conferido antes de publicar. Compensação espera a transação de publicação e
  não exclui um objeto por perda do ACK do COMMIT; resultado ainda incerto é
  preservado para reconciliação, em vez de arriscar a exclusão de bytes confirmados.
- O BFF substitui `arrayBuffer()` irrestrito por leitura limitada, mantém bytes
  idênticos no refresh, preserva cookies já rotacionados em erro e propaga abort.
  O smoke da imagem real detectou que cancelar NextRequest cedo destruía o socket:
  agora o erro HTTP é entregue antes do fechamento do transporte. PUT de storage
  recebe o prazo ampliado mesmo quando não é multipart.
- No mobile, timeout 408 é recuperável na fila de evidências e não descarta a foto.
  O PUT binário instalado continua aceito; não houve mudança de contrato nativo.
- Nginx não materializa corpos em proxy temp, aplica o teto do transporte e usa
  somente logs de requisição sem query. Diagnóstico de erro do vhost passa por
  acesso/status e logs estruturados da API; protocolo malformado não pode copiar
  uma capability para o error log. Nenhuma configuração foi aplicada ao servidor.

Valores, operação, rollback e comandos: [guia de upload](../../backend/docs/upload-integrity.md).
Migration: `20261116180000_bounded_immutable_uploads`; aplicar antes da API nova.
A criação do índice requer lock de escrita; coordenar a janela de implantação.
Não há novas envs, dependências de runtime ou alterações nos locks NPM/Dart.

## Validação

- Backend completo: **266 suítes / 2.156 testes aprovados**. Uma fixture de rotas
  precisou receber os providers do interceptor novo, sem substituir seus controles.
  A regressão direcionada de seis suítes/32 testes também passou; o conjunto
  completo foi repetido no código final, incluindo recuperação de publicação.
- PostgreSQL/LOCAL/MinIO reais: **duas suítes / 28 testes aprovados**, sendo
  20 casos de integridade nos dois providers e oito de evidências mobile.
  Aplicadas **121 migrations**, **149 tabelas** provisionadas sob `orbit_app`
  sem superuser/BYPASSRLS; duas instâncias Nest. Cobre multipart e raw PUT,
  tamanho declarado/chunked, MIME/conteúdo inválido, reserva excluída, aborto,
  replay e sobrescrita, download/hash, CAS concorrente, compensação de erro,
  sigilo de logs, quotas atômicas e isolamento/FK entre tenants.
- Frontend completo: **72 arquivos / 693 testes aprovados**; a regressão dos
  nove casos BFF foi repetida após o ajuste de entrega do 413. TypeScript e lint
  de produto aprovados. Build padrão **Next/Turbopack em Node 22/Linux** pelo
  Dockerfile de produção; o build no macOS encontrou EPERM no socket interno
  do Turbopack e não foi contado como sucesso. A imagem final passou também oito
  verificações HTTP reais do BFF, com upstream/tokens sintéticos: 401, 413 declarado
  e chunked, bytes/hash do raw/multipart, 429/Retry-After e capacidade recuperada.
  Esse smoke não comprova autenticação contra um backend real.
- Mobile: **63 testes direcionados**, formatação e análise dos dois arquivos
  alterados aprovadas. Não se reivindica uma nova build nativa ou aceite em loja.
- Proxy TLS descartável: sintaxe, confiança de origem, spoofing, 429/Retry-After
  e redaction em falha de protocolo aprovados. TypeScript/build Nest, Prisma,
  fronteiras sincronizadas e contrato de 75 códigos de erro públicos aprovados.
  Lint backend abrange todos os arquivos TypeScript alterados/adicionados.
  O backend foi conferido localmente em Node 25.1.0; a validação nova Node 22/Linux
  desta PR se refere à imagem frontend, não a uma nova qualificação do backend.

Uma repetição da integração passou os 18 casos novos e depois encontrou
SQLSTATE **53100**, falta de espaço no Docker local, durante a montagem da fixture
mobile. A repetição completa com PostgreSQL descartável em tmpfs passou os 26;
a prova posterior de COMMIT ambíguo ampliou o conjunto para 28. Não houve alteração do produto para encobrir a falha ou exclusão de dados existentes.
As imagens oficiais MinIO consultadas estavam indisponíveis; o gate passou a usar
fonte oficial fixada com checksum, somente para teste. Não houve acesso R2 real.

Os gates novos de MinIO e da imagem BFF estão versionados na CI. O push/CI remota,
a aplicação da migration/configuração Nginx no ambiente e a qualificação consolidada
em carga/restore do SHA final continuam pendentes. Não foram iniciadas as correções
de realtime/SSRF das PRs seguintes. Quotas de transporte não são quota de plano;
arquivos genéricos privados não ganham promessa de antivírus ou WORM administrativo.

Evidência estruturada: [PR-09](evidence/pr-09-upload-integrity.json).
