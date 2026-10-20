# Erros públicos no aplicativo de campo

> O que a pessoa lê quando algo falha — e o que o desenvolvedor lê, que é outra
> coisa e vive noutro lugar.

## 1. O incidente

Um técnico abriu o aplicativo. O backend não estava no ar. A tela mostrou:

```text
O servidor demorou a responder.
(tentei 10.0.2.2:6001)
```

O endereço do servidor não é assunto de quem usa o aplicativo. E `10.0.2.2` é a
ponte do emulador Android — para quem lia, não significava nada; para quem
soubesse ler, descrevia a topologia da infraestrutura.

## 2. Duas causas, não uma

### Causa A — diagnóstico dentro da mensagem pública

O vazamento **era testado**. Existia uma função `_comDestino` que concatenava
`(tentei $destino)` na mensagem, e um teste chamado *"nomeia o destino fora de
produção"* que cobrava esse comportamento. A intenção era boa: uma tela que só
diz "sem conexão" esconde o fato que resolve o problema, porque em bancada a URL
errada é a causa quase sempre.

A proteção era `diagnosticHost => isProduction ? null : apiHost` — o ambiente
decidindo o que é seguro. Duas coisas quebram isso: a mesma tela roda nos dois
ambientes, e o sabor é uma string que um script de build preenche errado sem que
nada reclame.

### Causa B — padrão de release inseguro

```text
ORBIT_API_URL   padrão → http://10.0.2.2:6001/api/v1
ORBIT_FLAVOR    padrão → development
```

`flutter build apk --release` sem `--dart-define` produzia um APK apontando para
a máquina de quem compilou — **e** com o guarda de mensagem desligado, porque
ele dependia do sabor. Verificado: o build passava e gerava 74,7 MB de artefato
inútil na melhor hipótese, e perigoso na pior.

Esta é a causa mais grave das duas.

## 3. A arquitetura

### Antes

```text
Dio → ErrorMappingInterceptor → OrbitException.message  → UI
                                 (público + diagnóstico)
```

### Depois

```text
Dio → ErrorMappingInterceptor → OrbitException
                                 ├── publicMessage  → UI
                                 └── diagnostics    → log
```

O campo se chama `publicMessage`, e não `message`. Um campo chamado `message`
convida a escrever qualquer coisa nele.

`OrbitDiagnostics` é uma classe própria — não campos soltos — justamente para
que ninguém a interpole por descuido: um objeto que a interface não recebe é um
objeto que a interface não imprime.

O dado **não se perdeu**. `host`, `transport`, `path` e `statusCode` vão para o
log, que é onde quem investiga os procura.

## 4. Taxonomia de transporte

Pequena e estável — a do Orbit, não um espelho dos enums do Dio.

| Falha técnica | Categoria | Mensagem pública | Retentável | Ação |
|---|---|---|---|---|
| `connectionTimeout` | `timeout` | O serviço está demorando mais que o esperado. Tente novamente em alguns instantes. | sim | Tentar novamente |
| `sendTimeout` / `receiveTimeout` | `timeout` | idem — mas **`resultUnknown` em comando** | sim | Atualizar antes de repetir |
| `SocketException` recusada | `network` | Sem conexão. Verifique sua conexão com a internet e tente novamente. | sim | Tentar novamente |
| Falha de DNS | `network` | idem | sim | Tentar novamente |
| `HandshakeException` / certificado | `insecure` | Não foi possível estabelecer uma conexão segura. Tente novamente mais tarde. | **não** | — |
| `cancel` | `cancelled` | A ação foi interrompida. | não | — |
| 401 | `http` | Sua sessão expirou. Entre novamente para continuar. | não | Entrar |
| 403 | `http` | Você não tem permissão para realizar esta ação. | não | — |
| 404 | `http` | Este registro não está disponível. | não | — |
| 409 | `http` | contrato do backend (`error.code` + `error.message`) | não | Atualizar |
| 422 | `http` | contrato, com `details[]` preservados | não | Corrigir |
| 429 | `http` | Muitas tentativas. Tente novamente em alguns instantes. | sim | Aguardar |
| 5xx **com** contrato | `http` | a mensagem do backend, que já é pública | sim | Tentar novamente |
| 502 com HTML de proxy | `http` | Não foi possível acessar o Orbit agora. | sim | Tentar novamente |
| JSON fora do contrato | `http` | idem | sim | Tentar novamente |
| desconhecido | `network` | Sem conexão… | sim | Tentar novamente |

TLS é olhado **antes** do tipo do Dio: um handshake falho chega como
`connectionError`, e tratá-lo como "sem internet" mandaria a pessoa procurar o
problema no roteador do prédio.

## 5. O contrato do backend continua intacto

`error.code` é a autoridade de máquina; `error.message` já é pública e
sanitizada (PR-35), e é preservada como veio. **Nenhum** `contains` ou regex lê
mensagem de servidor para decidir coisa alguma.

A mensagem só é aceita de dentro de `error` — o lugar que o contrato define. Um
`message` na raiz pode ser de um proxy que também fala JSON.

## 6. Resultado ambíguo de comando

O caso mais delicado do produto. Um técnico toca em "Concluir", a requisição
sai, o elevador engole o sinal.

```text
connectionTimeout    a conexão nem abriu    → nada foi enviado
sendTimeout          enviando quando parou  → pode ter chegado
receiveTimeout       enviado, sem resposta  → provavelmente processou
5xx                  o servidor recebeu     → pode ter processado
sem rede / recusada  nada saiu do aparelho  → nada foi enviado
```

Quando `mayHaveBeenApplied`, a frase muda:

> Não foi possível confirmar o resultado desta ação. Atualize os dados antes de
> tentar novamente.

Dizer "falhou" faria alguém concluir de novo um atendimento já concluído.

O caminho pelo journal offline já resolvia isso por desenho: o comando fica
pendente e a tela mostra "aguardando sincronização", nunca "concluído". A
classificação acima serve às mutations diretas.

**Nada mudou** em OCC, idempotência ou no envelope de comando: o mesmo
`commandId`, a mesma `expectedVersion`, o mesmo payload.

## 7. Refresh não apaga o dia de trabalho

`when` trocava a tela inteira por um erro quando a rede caía no meio de um gesto
de puxar-para-atualizar. Quem estava em campo perdia a fila, os horários e o
próximo atendimento — que continuavam válidos, só não tinham sido atualizados.

Agora a ordem das perguntas é: **primeiro se há dado**. Havendo, a falha vira um
aviso de uma linha no topo. Não havendo, aí sim a tela é o erro.

## 8. Segurança do artefato distribuível

Duas barreiras, e a primeira impede o artefato de existir.

### Em tempo de compilação

O `assert` de um construtor `const` é avaliado durante a compilação. Um `const`
que o viola não compila — e sem compilação não há APK para assinar e publicar.

Um aplicativo que compila e morre ao abrir já foi enviado para a loja; o erro
aparece na mão de quem instalou, não na esteira de quem publicou.

**Limitação declarada:** a avaliação constante do Dart não chama métodos — sem
`contains`, sem `Uri.parse`, sem `toLowerCase`. A barreira de compilação compara
strings literais: a ausência de `ORBIT_API_URL` e uma lista dos endereços de
bancada mais comuns. A regra completa, por host e com sufixos, vive na barreira
de execução. Um teste confronta as duas contra a mesma tabela, para que não
divirjam em silêncio.

### Em tempo de execução

`OrbitEnvironment.isDevelopmentEndpoint` olha o **host efetivo**:
`10.0.2.2`, `10.0.3.2`, `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, e os
sufixos `.lab`, `.local`, `.localhost`, `.test`, `.invalid`.

**Faixas privadas não são bloqueadas.** Implantação enterprise em rede interna é
caso legítimo, e proibir `192.168.0.0/16` quebraria um cliente real para impedir
um engano de configuração.

### O sabor não compra permissão

`ORBIT_FLAVOR=production` apontando para `10.0.2.2` continua bloqueado. O sabor
é uma string; o endereço é o fato.

### Verificado

| Comando | Resultado |
|---|---|
| `flutter build apk --release` | **BUILD FAILED** |
| `--dart-define=ORBIT_API_URL=http://10.0.2.2:6001/api/v1 --dart-define=ORBIT_FLAVOR=production` | **BUILD FAILED** |
| `--dart-define=ORBIT_API_URL=https://api.orbit.app/api/v1 --dart-define=ORBIT_FLAVOR=production` | ✓ 74,7 MB |

### Desenvolvimento continua como era

O padrão `http://10.0.2.2:6001/api/v1` **não foi removido**: é o que serve na
bancada, e tirá-lo para o teste passar seria maquiar o defeito. Ele só não
sobrevive a um build de release.

## 9. Os dois guards

São coisas diferentes e por isso são dois arquivos.

| Guard | Protege |
|---|---|
| `public_copy_guard_test.dart` | O que a pessoa lê |
| `release_endpoint_guard_test.dart` | O que é distribuído |

O guard de copy varre **apresentação**, não o projeto inteiro: URLs são
legítimas em configuração e no cliente HTTP, e um guard que reclamasse delas
seria desligado na primeira semana. Comentários são ignorados de propósito —
eles citam `10.0.2.2` para explicar o incidente, e um guard que reclamasse disso
ensinaria a apagar a explicação.

`expectSafePublicError` recusa: literais conhecidos (endereços, portas, nomes de
exceção, `nginx`, `Bad Gateway`, `#0`, `package:`), IPv4 em qualquer forma,
`http://` e `https://`, e o padrão `host:porta`.

## 10. Log

Já era sóbrio e continua: método, caminho **sem query**, status, duração e
`requestId`. Sem corpo, sem cabeçalhos, sem token.

O que mudou: o `host` passou a ser registrado nas falhas — é o dado que resolve
o chamado, e a tela deixou de ser o lugar de contá-lo.

`OrbitException.toString()` não devolve o endereço pela janela: ele acaba em log
automático e em relatório de erro, e carregar o host ali teria anulado a
separação.

## 11. Runbook

| Sintoma | Categoria interna | Copy pública | Retenta? |
|---|---|---|---|
| App abre e não carrega nada | `network` / `timeout` | Sem conexão… / demorando mais… | sim |
| Só o refresh falha | idem | Não foi possível atualizar os dados. | sim, no gesto |
| Certificado expirado no servidor | `insecure` | conexão segura | não |
| Proxy devolvendo 502 | `http` 502 | Não foi possível acessar o Orbit agora. | sim |
| Comando sem resposta | `timeout` ambíguo | confirmar o resultado / atualizar | não automático |
| Sessão caiu | `unauthorized` | Sua sessão expirou. | não |

## 12. Regressão do incidente

`test/security/cold_start_leak_test.dart` sobe a tela inicial de verdade contra
um transporte que falha das quatro formas — timeout, recusada, DNS e TLS — com
`http://10.0.2.2:6001/api/v1` **intacto**, e verifica cada texto visível.

A primeira asserção é literal:

```dart
expect(
  textos.any((t) => t.contains('10.0.2.2')),
  isFalse,
  reason: 'O endereço do incidente voltou à tela: $textos',
);
```


## 13. Varredura de segurança

Contagem nas camadas de apresentação (`lib/features`, `lib/core/widgets`,
`lib/core/design`, `lib/core/presentation`, `lib/core/errors`), ignorando
comentários — eles citam `10.0.2.2` para explicar o incidente.

| Categoria | Ocorrências |
|---|---|
| IP literal | 0 |
| hostname local | 0 |
| porta | 0 |
| URL | 0 |
| Dio | 0 |
| `SocketException` | 0 |
| `HandshakeException` / certificado | 0 |
| rastro de pilha | 0 |
| HTML de proxy | 0 |
| token | 0 |
| signed URL | 0 |

Dois padrões apareceram numa varredura mais larga e **não** são vazamentos:
`import 'dart:io'` em três arquivos de **dados** (armazenamento local de mídia,
de documento e do journal), e a manipulação de token no repositório de
autenticação. Nenhum dos dois chega a um `Text` — verificado.

### O que a primeira varredura não pegou

A tabela acima conta **literais**. O vazamento que sobrou não era um literal:

```dart
} on Object catch (error) {
  messenger.showSnackBar(
    SnackBar(content: Text('Não foi possível registrar: $error')),
  );
}
```

Em `operations/presentation/widgets/evidence_section.dart`. O texto literal é
inofensivo; o `$error` é que publica o `toString()` do que quer que tenha
falhado. Se a captura de evidência falhasse por rede, `SocketException` levaria
`10.0.2.2:6001` para a tela — o incidente inteiro de volta, escrito por uma
tela em vez do interceptor.

A correção tem duas partes. `OrbitException.publicCopyForAny(error, prefixo:)`
dá um lugar nomeado para "peguei qualquer coisa e preciso dizer algo seguro" —
copy do Orbit quando o erro é do Orbit, genérica quando não é. E o guard passou
a procurar a **interpolação**, não só o literal: qualquer `$error`, `$erro`,
`$e`, `$err` ou `$exception` dentro de texto nas camadas de apresentação
reprova. Verificado do jeito de sempre: reintroduzi a linha, o teste falhou
nomeando o arquivo; restaurei, passou.

A lição repete a da §14 por outro caminho. Um guard prova o que ele procura, e
só isso. Este procurava a forma do vazamento anterior.


## 14. O que o smoke de runtime encontrou

O aplicativo **não abria**.

```text
'route.parentNavigatorKey == null || route.parentNavigatorKey == navigatorKey':
sub-route's parent navigator key must either be null or has the same navigator
key as parent's key
```

A rota de leitura de etiqueta fora declarada como filha **direta** do
`ShellRoute` com a chave do navegador raiz. O `go_router` recusa: uma sub-rota
direta de shell só aceita a chave do próprio shell, ou nenhuma. A recusa é um
`assert`, e o processo morria na primeira tela.

### Por que ninguém viu

| Gate | Estado | Por que não pegou |
|---|---|---|
| `flutter analyze` | limpo | Não valida a árvore de rotas |
| `flutter build ios` / `apk` | ✓ | **Compilar não é executar** |
| 533 testes | verdes | Todos montam telas; nenhum construía o roteador |

A lição está no meio da tabela. Build passando foi tratado como evidência de
que o aplicativo funcionava, e não era — era evidência de que ele compilava.

### O que ficou

A rota saiu do shell e virou irmã da splash e do login, que é o que "fora do
shell" significa. E existe `test/security/router_boots_test.dart`, que constrói
o `GoRouter` de verdade. O teste foi verificado do jeito que interessa:
reintroduzi o defeito, ele falhou com a assertion exata, e voltou a passar com
a correção.

### Verificação no simulador

App instalado no iPhone 15, com o backend **parado** — o cenário do incidente.
A tela que aparece é a de entrada do Orbit, limpa. Sem tela vermelha, sem
endereço, sem exceção.

## 15. O comando de build mudou

Depois desta mudança, **`flutter build ios` e `flutter build apk` sem
`--dart-define` não compilam mais**. Não é um defeito: é a primeira barreira da
§8 fazendo exatamente o que existe para fazer. `flutter build` é release por
padrão, e um release sem endereço informado cairia no padrão do repositório,
que é a ponte do emulador — o artefato do incidente.

A esteira e quem compila à mão precisam passar o endereço de destino:

```sh
flutter build ios --no-codesign \
  --dart-define=ORBIT_API_URL=https://api.orbit.app/api/v1 \
  --dart-define=ORBIT_FLAVOR=production

flutter build apk --release \
  --dart-define=ORBIT_API_URL=https://api.orbit.app/api/v1 \
  --dart-define=ORBIT_FLAVOR=production
```

O desenvolvimento não muda: `flutter run` continua em debug, continua caindo no
padrão `http://10.0.2.2:6001/api/v1`, e o guard não dispara — `dart.vm.product`
é falso.

Quando o guard dispara, a mensagem de compilação diz o que falta:

```
This assertion failed with message: Build de release com endereço de
desenvolvimento. O ORBIT_API_URL informado é um endereço de bancada, ou não foi
informado e o padrão do repositório aponta para a máquina de desenvolvimento.
Informe --dart-define=ORBIT_API_URL com o endereço do ambiente de destino.
```
