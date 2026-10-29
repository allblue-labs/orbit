# Carregamento e navegação

`SectionLoading` usa o skeleton animado compartilhado `OrbitSkeleton`, com
contraste sobre as superfícies claras do app. A animação pausa fora da tela e
respeita as preferências de movimento reduzido e acessibilidade.

Todas as rotas do aplicativo usam `OrbitPageRoute`: entrada curta com fade e
deslocamento, mantendo a navegação nativa e o gesto de voltar no iOS. Com
movimento reduzido, a troca acontece sem animação. As etapas dos wizards usam
uma entrada curta e preservam o estado dos formulários já visitados.

Ao abrir um atendimento para cliente novo ou existente, `OrbitBusyOverlay`
mantém o formulário montado, apresenta progresso e bloqueia novos toques.
A preparação da execução também informa que o início está sendo confirmado
no servidor. Nenhuma espera artificial foi adicionada.

## Primeiro envio durante sincronização automática

Um comando podia entrar no journal quando uma rodada já havia terminado seu
push e aguardava o pull. Compartilhar apenas o future dessa rodada deixava o
início sem tentativa de envio até o próximo toque do usuário.

`SyncController.enqueue` agora verifica se o comando novo ainda não foi
tentado após a rodada compartilhada e completa seu envio no mesmo toque.
O escopo do usuário/organização, as chaves de idempotência, as recusas e o
backoff dos comandos que já foram tentados permanecem respeitados.

Os ajustes requerem uma nova build do app. Não há novas dependências,
variáveis de ambiente ou migrações de banco.
