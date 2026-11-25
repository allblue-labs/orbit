# PR-03 — Baseline reproduzível e pipeline

A suíte herdada misturava relógios reais, providers antigos, claims de owner
usadas como se limitassem a autoridade do proprietário, fixtures sem pagamento
ou responsável técnico, imagens inválidas e testes de captura manual. Isso
produzia falsos negativos e escondia defeitos reais. A PR torna o comando padrão
reproduzível com banco vazio, RLS ativa e credenciais exclusivamente sintéticas.

## Alterações

- Relógios de assinatura/cobrança fixados; matcher de senha e providers atualizados.
  Tipagem agora cobre também os testes do backend. Lint não altera arquivos;
  correções automáticas ficam no comando explícito `lint:fix`.
- Fixtures restritas possuem usuários, papéis e vínculos reais. Uma claim não
  transforma owner em membro comum. Pagamentos de fixtures são confirmados
  explicitamente; PMOC recebe responsável técnico habilitado. Uploads usam
  imagens decodificáveis e verificam o WebP canônico gerado pelo servidor.
- O runner isolado cria PostgreSQL 17.11 por digest, aplica todas as migrations,
  provisiona `orbit_app`, semeia catálogos e remove apenas seus recursos ao sair.
  Não usa `.env` de staging/produção. Web executa o `server.js` standalone com
  assets estáticos, copiado para fora do checkout para não resolver dependências
  ausentes no `node_modules` local, e provisiona
  cenários pela API. Contrato de leitura, execução completa de PMOC e deep link
  de documento têm fixtures próprias; nenhum cenário funcional web é pulado por
  falta de dados. Mobile considera API ou fixtures ausentes como falha.
- Pipeline GitHub Actions com Actions fixadas por SHA, Node 22.23.5, Flutter
  3.47.2, permissões de leitura e sem credenciais de implantação. Inclui
  auditoria, lint/tipagem, contratos, testes, migrations/RLS e builds.
- Instrumento de captura mobile separado em `mobile/tool/`; as assertivas de
  conteúdo e matriz de layout permanecem na suíte funcional. Nenhum golden foi
  aceito automaticamente. Capturas manuais foram geradas e revisadas.
- Textos de implementação expostos pela interface foram substituídos por termos
  de produto. Testes web acompanham campos obrigatórios e o wizard atual,
  preservando a verificação das regras e dos estados salvos no servidor. O aviso
  de assinatura vencida distingue uma assinatura comum de um período de teste;
  o teste acompanha essa regra, sem alterar o comportamento de cobrança.

## Defeitos de produto reproduzidos durante o fechamento

1. Revalidação mobile consultava somente permissões de papéis, perdendo a
   autoridade do proprietário e as restrições customizadas do membro. O resolver
   agora consulta o vínculo ativo e o owner real no banco, como o guard de identidade.
   Escopo, autorização de demanda, atribuição, perfil e status continuam exigidos.
2. Retransmissões concorrentes de material podiam colidir no índice único e
   retornar P2002. O comando agora serializa pela chave de idempotência dentro da
   transação, relê o registro canônico e rejeita payload divergente. O E2E confirma
   quatro chamadas simultâneas, uma linha e um único efeito no estoque.
3. O botão Voltar do navegador podia deixar a aba Minha Conta fora de sincronia
   com a URL após recarga. O hook acompanha `popstate` e a mudança local de seção.
4. No provider LOCAL, logos devolviam uma referência `r2-object:` ao navegador.
   A API mantém a referência persistida e devolve uma URL temporária utilizável;
   URLs CDN do R2 permanecem diretas. O E2E verifica que a imagem foi decodificada.
5. O resumo de atendimento podia converter objetos em `[object Object]`.
   Valores inválidos agora têm apresentação neutra, coberta por teste.
6. A configuração Android desativava Kotlin integrado sem aplicar o plugin Kotlin
   da aplicação. A combinação usada para a CI é fixada com Flutter 3.47.2 e modo
   legado do AGP 9, compatível com os plugins atuais. Nenhuma chave de release é
   necessária ao build debug; assinatura de distribuição continua protegida.
7. O seletor de cobertura PMOC podia abrir enquanto a consulta ainda estava
   pendente, oferecendo por instantes equipamentos já cobertos. O botão aguarda
   a resposta; um teste retém a consulta e prova o estado desabilitado e a lista
   correta depois de liberar a resposta.
8. O detalhe do membro exibia a chave interna do papel junto do nome. A tela
   mantém o nome do papel e as permissões descritas em português.

## Auditoria do tooling

Nenhuma versão de dependência de runtime mudou em relação à base desta PR.
Nest CLI/Jest/TypeScript ESLint receberam atualizações compatíveis no backend.
Produção segue com zero advisories conhecidos nos dois projetos.

A cadeia completa ainda possui três advisories raiz no tooling: Deepmerge
(low), Glob e Minimatch (moderate). O npm conta também os pacotes consumidores:
28 registros no backend (23 moderate/5 low) e 7 moderate no frontend deste Mac;
a propagação Linux pode contar um consumidor adicional. O gate avalia advisory,
caminho exato e versão no lock, não um total fixo por plataforma.

A exceção vence em **26/11/2026**, não permite high/critical nem dependência de
produção e falha em novos caminhos, versões, advisories ou indisponibilidade da
auditoria. Não usamos `audit fix --force` nem overrides de majors incompatíveis.
O migrator contém tooling; não alegamos que esses pacotes estejam ausentes de
todas as imagens operacionais. Motivos, fontes e política:
[guia de verificação](../../scripts/README.md),
[exceções](../../scripts/audit-exceptions.json),
[testes da política](../../scripts/audit-policy.test.mjs).

## Validação

Resultados em [evidência sanitizada](evidence/pr-03-baseline-ci.json):

| Gate | Resultado local |
| --- | --- |
| Backend unitário | 250 suítes, 1.995 testes aprovados |
| Backend com banco real | 38 suítes, 459 testes aprovados; 111 migrations e RLS ativa |
| Web unitário | 68 arquivos, 671 testes aprovados |
| Web no navegador | 307 aprovados, sem skips; cinco smokes standalone adicionais aprovados |
| Mobile funcional | 1.265 aprovados; uma captura PNG manual desabilitada por padrão |
| Mobile com API real | 60 aprovados, sem skips |
| Captura visual manual | 308 cenários, 307 PNGs; amostras de documentos/atendimento revisadas |
| Builds | Backend, Next standalone e Android debug aprovados |
| Estática | Lint não mutante, tipagem, contratos, linguagem e Flutter analyzer aprovados |
| Auditoria | Produção zerada nos dois projetos; sete testes da política aprovados |

A captura manual desabilitada é a exportação PNG da ficha do equipamento;
os testes de QR, detalhes, histórico, margens e texto ampliado continuam ativos.
Os 60 testes de integração mobile são separados por tag para o comando offline,
mas obrigatórios na pipeline, que sobe a API e reprova indisponibilidade.
A matriz visual continua validando comportamento/layout na suíte funcional.
Amostras inspecionadas: documentos em 320px/1,0x e atendimento em 390px/1,0x e
320px/2,0x; não se trata de aprovação visual individual dos 307 arquivos.

O Android compilou em modo Kotlin legado, com avisos de migração futura dos
plugins `file_picker`, `mobile_scanner`, `package_info_plus` e `share_plus`.
O SDK está fixado; atualizar Flutter exige revisar essa compatibilidade.
Nenhum AAB de distribuição foi publicado nesta entrega.

Comandos reproduzíveis e requisitos:
[runner](../../scripts/README.md), [web](../../frontend/docs/e2e-ambiente.md) e
[revisão visual mobile](../../mobile/tool/README.md).

A execução local usa macOS/Node 25.1.0; a CI fixa Node 22.23.5/Linux. A validação
remota da workflow aguarda o push feito pelo owner. Compilação Android debug não
qualifica distribuição, push nativo nem entrega de e-mail. Firebase/APNs seguem
na PR-06 e SES/outbox/sandbox nas PR-07/08. Esta PR não aprova a aplicação para
produção nem executa deploy ou push.
