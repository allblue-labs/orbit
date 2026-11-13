# PR-04 — MFA e renovação de sessão concorrentes

Achados tratados: **F03 e F04** da revisão de produção. A mesma recuperação MFA
podia ser aceita por duas requisições; a rotação publicava tokens concorrentes
e guardava apenas o último hash. O bloqueio de login também incrementava um
contador lido antes da verificação da senha, perdendo tentativas simultâneas.

## Comportamento e implementação

- Recovery codes são consumidos com `array_remove` e predicado de presença no
  mesmo `UPDATE`, exigindo fator verificado e não excluído. Só a operação que
  removeu o hash aceita o código; remoções de códigos distintos se acumulam.
  TOTP também reconfere que o fator continua ativo ao registrar o uso.
- A rotação compara o hash anterior, não revogação, validade e fim da janela
  no mesmo `UPDATE`. Só um candidato vence. As demais réplicas releem o par
  canônico; nunca devolvem o candidato cuja gravação perdeu a comparação.
- Por **15 segundos fixos**, calculados pelo PostgreSQL, o token anterior e
  seu sucessor devolvem o mesmo par. Usar o sucessor nesse intervalo não cria
  outra geração. A janela não se estende a cada consulta.
- Fora da janela, o token atual pode rotacionar novamente. Reutilizar o
  anterior ainda reconhecido pela sessão revoga a sessão. Tokens desconhecidos,
  revogados e vencidos são recusados. O histórico retido é somente a geração
  anterior: tokens ainda mais antigos são recusados, mas não são atribuídos a
  uma família para revogação. Não alegamos implementação completa de OAuth/OIDC.
- O par temporário é cifrado em AES-256-GCM com `ENCRYPTION_KEY`, já utilizado
  pelo projeto. Há no máximo um par cifrado por sessão, sobrescrito na próxima
  rotação; a leitura exige janela válida. Um trigger limpa o estado de rotação
  quando **qualquer fluxo** revoga a sessão, inclusive permissões e reset de
  senha. O término da janela é uma restrição lógica; não há job de expurgo
  físico do ciphertext por TTL nesta PR.
- Web e mobile conservam apenas a deduplicação em andamento. Uma renovação
  posterior consulta a API novamente, sem cache local de respostas concluídas
  que possa mascarar revogação. O isolamento por geração da sessão no app foi
  preservado.
- Falhas de senha e de MFA inválido incrementam o estado atual da credencial.
  O desafio MFA ausente não conta como código incorreto. Cinco falhas bloqueiam
  por 15 minutos, preservando a política existente. Tentativas contra um hash
  de senha antigo não alteram a credencial nova.
- Finalizar login e criar sessão agora é uma transação: ela compara o hash
  verificado, reconfere bloqueio/status, atualiza os contadores e cria a sessão.
  O reset de senha usa o mesmo bloqueio da credencial antes de revogar sessões:
  a verificação antiga perde a comparação ou sua sessão é revogada pelo reset.

Durante a implementação, foi encontrado outro defeito do MFA: o cadastro gera
códigos de recuperação hexadecimais de **16 caracteres**, mas o DTO de login e
o formulário web aceitavam no máximo dez; o mobile usava teclado numérico.
Os limites e o teclado foram corrigidos. O código emitido pelo próprio cadastro
agora é exercitado pelo teste HTTP, inclusive com duas tentativas simultâneas.

## Banco e implantação

Migration aditiva: `20261113190000_identity_atomic_rotation`. Acrescenta três
colunas, índice único para o hash anterior, constraint de coerência e trigger
de limpeza em revogação. Sessões existentes começam sem estado de rotação e
continuam válidas até a primeira renovação. Não modifica o portal externo de
clientes, que possui repositório/fluxo de sessão próprios.

1. Aplicar a migration pelo migrator antes de iniciar a API nova.
2. Todas as réplicas devem compartilhar o mesmo banco, `ENCRYPTION_KEY` e
   configuração JWT. Não gerar uma chave diferente por réplica.
3. Drenar tráfego de identidade e substituir todas as réplicas da API; não
   misturar o rotacionador antigo, incondicional, com o novo na mesma janela.
4. Publicar a web e o app atualizados. O formato dos tokens e respostas HTTP
   permanece compatível; não há nova variável obrigatória.

Esta entrega não executa deploy, push nem publicação de app. Rate limit,
identidade de proxies e contenção distribuída de abuso permanecem na **PR-05**.

## Evidências

- `backend/test/identity-concurrency.e2e-spec.ts`: duas aplicações NestJS com
  clientes/pools próprios e banco compartilhado sob o papel restrito. Hashes
  reais; cenários de consumo MFA, refresh paralelo, uso do sucessor, expiração
  da janela, logout/revogação/reset/superfície, bloqueio concorrente de login e
  comparação de credencial antiga. Expiração usa somente registros sintéticos,
  sem sleeps longos nem alteração do relógio do processo.
- `authentication-concurrency.spec.ts` e `mfa-verification.spec.ts`: perda do
  compare-and-swap, resposta corrompida, revogação durante rotação, conta
  desativada, desafio ausente e segundo fator incorreto.
- `frontend/e2e/identity-rotation.spec.ts`: cookies canônicos em chamadas
  paralelas, recusa após logout e login real com recuperação de 16 caracteres.
- `frontend/src/server/auth/refresh.test.ts`: deduplicação em andamento e
  revalidação posterior ao resultado concluído.
- Testes mobile de sessão, transição de conta, runtime, login e segurança:
  respostas atrasadas não substituem outra conta; revogação não fica oculta por
  cache; o campo permite enviar o código alfanumérico completo.

As instâncias do E2E são duas aplicações no mesmo processo de teste, com
conexões distintas. A coordenação não usa memória compartilhada entre elas;
a prova cobre concorrência no banco, não um ensaio de carga entre hosts.
Os runners criam PostgreSQL descartável e credenciais sintéticas, sem ler
credenciais de nuvem nem conectar ao banco de produção.

| Gate local | Resultado |
| --- | --- |
| Backend unitário | 252 suítes, 2.009 testes aprovados |
| API com banco real | 3 suítes, 39 testes aprovados; 112 migrations aplicadas |
| Web unitário | 69 arquivos, 673 testes aprovados |
| Web em produção | Dois cenários de identidade e cinco smokes standalone aprovados |
| Mobile | 125 testes de sessão/login/segurança aprovados |
| Estática e build | Lint e TypeScript backend/web, contratos, Flutter analyzer, compilação backend e Next standalone aprovados |

A suíte completa mobile e os demais módulos de integração não foram repetidos
nesta PR; a matriz consolidada permanece como gate da PR-19. Os testes acima
cobrem os contratos e as regressões de identidade alterados aqui.

Referências de desenho: [locks de linha do PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html)
e [proteção de refresh tokens, RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
