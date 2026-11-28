# PR-18 — Textos, datas e jornadas de produção

O resumo apresentado para assinatura traduz respostas compostas de checklist.
Medições mostram valor e unidade, listas preservam as respostas e observações
acompanham os itens. Referências internas e chaves de checklist ficam fora da
apresentação. O hash continua vinculado ao resumo que o cliente conferiu.
Aceites já registrados permanecem válidos. Se uma confirmação pendente tiver
um hash antigo para um texto que mudou, o aplicativo pede nova revisão.

O painel Saúde financeira envia os dois extremos do período como datas civis
no fuso efetivo. Quando o painel não seleciona um fim, o resumo vai até o dia
local atual. A evolução dos últimos 12 meses termina nesse mesmo dia.

As mensagens de PMOC orientam a conferir a escala, cadastrar o Responsável
Técnico ou revisar o plano. Estados novos no mobile têm texto de recuperação
em português. As regras de autorização permanecem as mesmas. O cadastro
move o foco para o primeiro campo inválido e associa o erro ao campo. O título
da etapa recebe foco durante a transição e na confirmação de e-mail. A página
pública identifica o Orbit como plataforma de gestão de serviços e manutenção.

## Validação local

Passaram 41 testes unitários e sete testes HTTP de assinaturas no backend,
42 unitários web, 71 cenários no Chromium e 66 testes Flutter. Os quatro
cenários do dashboard foram repetidos após explicitar a data final. Builds,
TypeScript, lint dos arquivos alterados, análise Dart e verificação de
linguagem web passaram. O aviso de depreciação do driver `pg` registrado
na PR-17 também apareceu nesta execução.

- Chromium com build standalone do Next e API sob RLS. Os testes validam
  cadastro, confirmação explícita do e-mail, login e pagamento pendente.
  A falha de checkout permite tentar novamente na mesma conta. As chamadas ao
  Stripe e os links de e-mail foram simulados nos cenários de navegador.
- O navegador verificou a janela enviada ao Financeiro nos fusos
  `Asia/Tokyo` e `America/Los_Angeles`. Com o mesmo dia civil de referência,
  o resumo recebe 12/10/2026 a 10/11/2026 e a série termina em 10/11/2026.
- A jornada completa de PMOC gerou o relatório pela API e pelo worker, com
  ações de baixar e compartilhar disponíveis após fechar o wizard. Também
  passaram resolução e rotação de QR, navegação até documentos e assinatura
  de proposta e contrato em largura de celular.
- A suíte mobile renderizou as telas de campo com câmera, API e arquivos
  controlados por fixtures. Validou leitura e nova leitura do QR, assinatura,
  resultado e ações de documento com texto de até 2×. Os botões principais
  testados têm pelo menos 48 pontos lógicos de altura.

A comparação de imagens de referência do scanner depende de arquivos locais.
A validação do scanner neste PR foi funcional. A validação física e as
integrações externas fazem parte da PR-19.

[Evidências de execução](evidence/pr-18-production-journeys.json).
