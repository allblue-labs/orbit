# Uploads limitados e arquivos confirmados — PR-09

O transporte de mídia continua passando pelo gateway assinado da API. Web usa
multipart e mobile pode continuar usando PUT binário. A reserva é validada antes
de ler o arquivo; uma assinatura válida sozinha não autoriza uma chave sem reserva.
Não há novas variáveis de ambiente ou credenciais nesta PR.

## Limites de transporte

| Controle | Limite |
| --- | --- |
| Imagens reservadas | 10.000.000 bytes; formatos JPEG, PNG, WebP e HEIC |
| PDF reservado | 20.000.000 bytes |
| Anexo genérico de operação (contrato anterior preservado) | 20 MiB: 20.971.520 bytes |
| Envoltório multipart | Até 65.536 bytes adicionais; um arquivo, sem campos extras |
| Leitura do corpo | Até 60 segundos, com até 15 segundos de inatividade |
| Uploads ativos na API | Oito por processo; dois por organização entre réplicas |
| Mesma reserva | Uma admissão ativa, protegida por unicidade no banco |
| Recuperação de admissão abandonada | Lease de três minutos, com relógio PostgreSQL |
| Reservas PENDING recentes | Até 20 e até 100.000.000 bytes, criadas na última hora |
| BFF: corpos de mídia retidos | Quatro por processo; até 21.037.056 bytes cada |
| BFF: JSON/form-urlencoded | 1 MiB por corpo; até 32 retidos por processo |
| Envio S3/R2 pelo SDK | Deadline total de 45 segundos, incluindo retries |

As quotas de reserva são de trabalho pendente; não limitam o total de documentos
já disponíveis nem substituem a franquia comercial do plano. A organização não
perde dados ao atingir esses limites. Respostas 429 permitem retry; liberar a
admissão normal precede a conclusão HTTP, evitando uma nova tentativa recusada
apenas porque a liberação anterior ainda estava em trânsito.

Os limites são constantes de transporte em `upload-budget.service.ts` e
`request-body.ts`. Não devem ser elevados sem medir memória, CPU e concorrência.
O contador por processo é local; o limite por organização e a exclusão da mesma
reserva são compartilhados no PostgreSQL. Na admissão e no gateway não se mantém conexão transacional
enquanto o cliente envia, enquanto Sharp processa ou durante a chamada ao storage.

Os demais anexos privados de operação preservam seus formatos existentes; não
ganham uma nova lista comercial de tipos. Os fluxos de imagem e de mídia reservada
têm a lista explícita de MIME, verificação do conteúdo de imagem e assinatura
inicial `%PDF-` para PDF. Isso não é antivírus, sanitização completa de PDF ou
garantia de que todo conteúdo de um anexo genérico é seguro para execução.

## Imutabilidade e retries

O fluxo R2 anterior já gerava chave canônica separada da chave da reserva. A PR-09
preserva essa base e acrescenta defesa no provider: toda gravação é create-only.
LOCAL publica por hard-link atômico de um arquivo temporário privado; S3/R2 usa
`PutObject` com `IfNoneMatch: '*'`. Nenhum provider emite PUT assinado direto;
`FileObjectService` emite somente a capability do gateway reservado.

Depois de validar/otimizar, o banco publica a referência final por CAS em PENDING.
Só essa referência, tamanho, MIME e hash canônicos são usados na confirmação e
na leitura. A disputa entre duas conclusões tem um vencedor; a chave perdedora
é removida. Repetir a URL original com os mesmos bytes retorna o arquivo existente,
sem novo PUT; outro conteúdo é recusado. Uma intenção mobile retomada após o PUT
renova a capability da chave/MIME originais, mesmo quando ainda falta finalizar
a evidência; não passa a apontar para a chave WebP final. Uma capability para a chave final é
recusada, mesmo que sua assinatura seja válida. Chaves excluídas não são WORM:
as garantias abrangem os fluxos da aplicação, não um administrador que possui as
credenciais do bucket e modifica objetos fora dela.

O BFF lê um buffer limitado e conserva os mesmos bytes durante a renovação do
token. Propaga o sinal de cancelamento ao backend. Em erro de leitura, interrompe
o consumo e responde com `Connection: close`: cancelar o corpo Node antes da
resposta destruiria também o socket necessário para entregar o erro 413/429.
Um abort real do cliente pode cancelar imediatamente. Uma chamada já aceita e
concluída no servidor pode sobreviver à perda da conexão; o retry idêntico resolve
esse resultado ambíguo sem alterar o arquivo confirmado.
+
+Se a resposta do COMMIT se perder, a compensação espera um lock de publicação
+adquirido pela transação original e relê a referência. Recupera a publicação já
+confirmada ou remove somente um objeto comprovadamente sem referência. Se não
+conseguir consultar o banco, preserva o objeto e emite `storage-publication-uncertain`
+com fingerprint opaco; não arrisca excluir um arquivo confirmado. Esse caso pode
+deixar um órfão se o commit realmente falhou; exige reconciliação operacional
+posterior (PR-15), sem exclusão cega baseada apenas na mensagem de erro.
+`storeWith` participa da transação do chamador, que deve propagar o erro e fazer
+rollback; a compensação não tenta confirmar uma transação externa ainda aberta.
+

No mobile, 408 volta à fila como 429 e falhas temporárias, preservando a foto.
Não se muda o protocolo nem se exige atualizar o aplicativo instalado para usar
o gateway. A melhoria de retry automático exige a versão mobile atualizada.

## Publicação

1. Aplicar `20261116180000_bounded_immutable_uploads` e o provisionamento habitual
   de grants antes da API nova. A migration é aditiva: cria a tabela de admissões
   com FORCE RLS e FK composta arquivo/organização, e o índice único correspondente.
   RLS respeita o tenant e a manutenção de plataforma confiável já existente.
2. Publicar API e web. Preservar as configurações R2/SES existentes, incluindo a
   chave de supressão introduzida na PR-08. Não há novos segredos nesta entrega.
3. Ao atualizar o Nginx, instalar as duas configurações versionadas em
   `deploy/staging/nginx`, executar `nginx -t` e recarregar pelo fluxo autorizado.
   Request/response buffering ficam desligados, com HTTP/1.1 para upstream, teto
   de 21.037.056 bytes e inatividade de corpo de 15s. Mídia não deve passar por
   arquivos temporários do proxy.
4. O vhost Orbit usa acesso com `$uri` sem query, status e upstream status. O log
   de erro por requisição é desativado porque Nginx inclui URI bruta até em falhas
   de protocolo anteriores à seleção de location. Diagnosticar por status/requestId,
   logs estruturados da API e logs do processo master para configuração/startup;
   não habilitar debug de requisição no gateway assinado.
5. Em rollback, preservar a tabela/índice aditivos e tratar uploads em trânsito.
   Voltar ao código antigo remove os limites e a proteção do provider; não
   considerar esse rollback uma implantação igualmente protegida para uploads.

Nenhuma dessas ações foi executada em servidor ou bucket real nesta PR. A limpeza
operacional inclui a nova tabela temporária; a PR não executa retenção em dados
existentes, não migra novamente as mídias e não altera as regras de cobrança.

## Reproduzir os gates

```sh
# PostgreSQL e MinIO locais descartáveis. Requer Docker e Go; não usa .env do app.
node scripts/verify-storage-integrity.mjs

# Build padrão pelo Dockerfile de produção e teste HTTP da imagem real.
docker build --file frontend/Dockerfile --tag orbit-upload-bff:review frontend
node scripts/verify-upload-bff-image.mjs orbit-upload-bff:review

# Proxy TLS descartável, inclusive sigilo da capability em erro de protocolo.
node scripts/verify-proxy-ingress.mjs
```

O gate MinIO compila exclusivamente para teste a release comunitária oficial
`RELEASE.2025-10-15T17-29-55Z`, com Go 1.26.3, e confere versão/checksum do módulo.
Não a instala no servidor da aplicação nem a recomenda como storage de produção.
`ORBIT_MINIO_BIN` pode reaproveitar esse binário local, sujeito à mesma conferência.
O teste falha se não conseguir iniciá-lo, sem promover um caso omitido a sucesso.
API/console MinIO ficam em loopback; o PostgreSQL de ensaio usa tmpfs de 512 MiB.
As credenciais são sintéticas e os processos/containers/dados são removidos no fim.
As novas etapas estão na CI; execução remota aguarda o push pelo owner.

Referências dos condicionais: [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html),
[R2: operações condicionais](https://developers.cloudflare.com/r2/api/s3/conditional-operations/).
