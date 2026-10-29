# Correções P2 da revisão para publicação

## Backup Android

O aplicativo opta por não enviar dados locais para backup do Android. O manifesto define `allowBackup=false` e referencia regras explícitas para Android 6–11 (`backup_rules.xml`) e Android 12+ (`data_extraction_rules.xml`). Nuvem e transferência entre aparelhos excluem todos os domínios privados, incluindo SharedPreferences, armazenamento de arquivos, bancos, armazenamento externo privado e armazenamento protegido do dispositivo.

Isso abrange tokens cifrados, identificador do aparelho, preferências, caches, filas de comandos, fotos/evidências e registros preservados para recuperação. Nenhum desses dados é apagado do aparelho por essa configuração. Pendências devem ser sincronizadas antes de desinstalar ou trocar de aparelho. As regras se aplicam a futuros backups/transferências; não removem arquivos que já tenham sido copiados por uma versão anterior.

A exclusão explícita de transferência é necessária porque alguns fabricantes não desativam D2D somente com `allowBackup=false`. Referências: [Android Auto Backup](https://developer.android.com/identity/data/autobackup) e [flutter_secure_storage 9.2.4](https://pub.dev/packages/flutter_secure_storage/versions/9.2.4). Esta alteração de manifesto trata o Android.

## Português nos controles do sistema

O `MaterialApp` configura `pt_BR`, `flutter_localizations` e os delegates de Material, Cupertino e Widgets. Isso traduz calendários, seletores, diálogos e ações de edição mesmo quando o aparelho usa inglês. O `intl` foi alinhado à versão exigida pelo SDK do Flutter. Referência: [internacionalização do Flutter](https://docs.flutter.dev/ui/internationalization).

## Checklist acessível

O nó único de cada checkbox publica estado, habilitação, rótulo e ação de toque. A ação semântica altera o mesmo rascunho usado pelo toque visual e pelo salvamento ao avançar. Itens desabilitados continuam sem ação acessível.

## Preferência de fuso

A resolução usa o fuso IANA válido do perfil; depois o da unidade ativa/principal; finalmente `America/Recife`, padrão da aplicação. A mesma resolução orienta `x-timezone`, cadastro do dispositivo de push, horários, datas de instantes, agrupamento de documentos e saudação da Home. Dados de horário de verão vêm da biblioteca `timezone`.

O formatador é contextual, sem `setLocalLocation` ou preferência global de usuário. Trocar conta/unidade ou atualizar o perfil atualiza a apresentação; novas requisições consultam a preferência atual. Retornar do segundo plano recarrega o perfil, incluindo alterações feitas na web. Datas civis e prazos definidos pelo servidor continuam sem conversão para instantes.

## Fluxo de operações

A Home abre os concluídos na execução atual, com resumo e relatórios. A antiga listagem `/operacoes` redireciona para a fila atual de atendimentos. Links antigos `/operacoes/:id` montam o mesmo componente de execução em modo de consulta: atendimento aberto leva à ficha atual, sem registrar START automaticamente. Somente entrar pelo fluxo explícito de atendimento pode iniciar uma operação. A tela antiga não está mais ligada ao roteador.

## Avatar

Seleção, leitura, enquadramento e envio ficam protegidos contra exceções. Permissão negada/restrita tem orientação em português; outras falhas não exibem detalhes nativos nem caminhos de arquivos. O seletor não pode ser aberto duas vezes em paralelo e uma resposta tardia não atualiza uma tela encerrada.

## PDFs temporários

Cada download tem um diretório exclusivo, preservando o nome legível do PDF. Arquivos e temporários de downloads simultâneos não se sobrescrevem. Descartar um download não remove outro de mesmo nome; encerrar o contexto remove o arquivo daquela escrita, e a limpeza da sessão continua disponível.

## Teste de troca obrigatória de senha

O fixture de SharedPreferences e a espera pela navegação foram corrigidos durante o P1. O teste continua na suíte de regressão. Não foi necessário alterar novamente o comportamento de produção.

## Verificação

Os testes cobrem toque semântico e persistência do checklist; permissões e falhas de leitura do avatar; downloads simultâneos; idiomas dos controles no app real; atualização de fuso em tela, requisições e retomada; isolamento de sessão; compatibilidade do link antigo; e liberação após troca de senha. A validação nativa compila os recursos Android de release e verifica as referências e exclusões no manifesto mesclado.

Resultado desta implementação: `flutter analyze` sem problemas; 928 testes aprovados e 1 ignorado na suíte de configuração, contratos, core, features, segurança e widgets; recursos Android de release compilados e regras de backup verificadas no manifesto final. Não foram executados testes contra a API de produção nem em aparelhos físicos.

Antes de publicar, valide em aparelhos reais: TalkBack/VoiceOver, permissões de câmera/galeria e restauração/transferência no Android. Testes locais não substituem esses comportamentos do sistema operacional.
