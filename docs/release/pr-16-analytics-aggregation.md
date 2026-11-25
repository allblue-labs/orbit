# PR-16 — Agregações do dashboard

O PostgreSQL calcula as contagens, as bases de cálculo das taxas e os pontos
observados nas séries. Cada leitura recebe até cinco resultados de dados
da aplicação sob uma única transação com RLS. Cada domínio devolve totais
e séries limitadas às datas solicitadas. Os motores mantêm arredondamento,
comparação, projeções, rótulos e estados sem dados.

- Operações usam recortes independentes para criação, conclusão e fila aberta.
  A conclusão de uma demanda antiga entra pela data do encerramento. O índice
  parcial de fila aberta também cobre demandas antigas e exclui os registros
  cancelados, concluídos e removidos.
- PMOC usa o vencimento civil no fuso da unidade. RVT usa o fim do dia da
  visita no fuso do contrato. A função SQL reproduz a resolução de horário civil
  do agendador, inclusive nas transições em que a hora local se repete ou some.
- As permissões determinam quais domínios chegam ao banco. Os filtros de
  organização e unidade continuam sujeitos às políticas de RLS.

## Leitura compartilhada

A tela usa `GET /analytics/panel` para indicadores, saúde e inteligência.
O backend aplica a capacidade comercial de inteligência antes de incluí-la.
O radar continua pedindo as duas janelas mensais. A rota de KPIs dessas
janelas calcula as contagens sem montar séries ou projeções. As demais rotas
públicas de analytics preservam seus contratos.

As leituras de analytics não reutilizam resultados entre requisições no servidor.
No navegador, as chaves do painel e do radar incluem conta, organização,
unidades, período, papéis e permissões. A resposta compartilhada usa
`Cache-Control: private, no-store`.

## Implantação e reprodução

A migration `20261117230000_dashboard_aggregations` cria a função de conversão
civil e o índice parcial. Planeje a janela de aplicação conforme o volume de
`operations`, pois a criação do índice pode bloquear escritas enquanto
o PostgreSQL o constrói. A API usa a função nova e o frontend usa a rota nova,
portanto a ordem é migration, API e frontend.

```bash
node --expose-gc scripts/verify-analytics-benchmark.mjs
```

O benchmark cria banco descartável e mede a consulta antiga de operações e
a leitura agregada de todos os domínios. Ele verifica volume do resultado,
número de consultas e o uso do índice com `EXPLAIN (ANALYZE, BUFFERS)`.
As medições de heap são observações locais no processo JavaScript.

## Resultados locais

O conjunto sintético contém 100 mil operações encerradas antes da janela,
8 mil em aberto antigas e 4 mil encerradas na janela. A seleção legada de
operações devolveu 12 mil linhas. O novo snapshot de todos os domínios
usou cinco consultas de dados e ocupou 958 bytes quando serializado,
comparado a 2.952.001 bytes das linhas de operações isoladamente.
A variação observada no heap foi de cerca de 49 MiB na leitura antiga e
1,7 MiB no snapshot. O plano usou os índices de criação, conclusão e fila
aberta.

A consulta SQL de operações executou em 327 ms no PostgreSQL local.
A seleção antiga, que mede apenas operações, levou 732 ms no processo Node.
O snapshot completo levou 1.018 ms. Os escopos dessas duas medições são
diferentes, por isso elas não quantificam ganho de latência ponta a ponta.
A economia observada é de volume materializado, heap e chamadas repetidas
da tela.

Passaram 19 testes unitários e nove integrados no backend, 44 unitários
no frontend e oito no Chromium com Next standalone de produção. O teste
do painel confirmou uma chamada compartilhada, duas para as janelas do
radar e a ausência de chamadas separadas de dashboard, saúde e inteligência.
A validação também cobriu indicadores vazios e a ocultação da inteligência
quando o plano não concede a capacidade.

[Registro do benchmark](evidence/pr-16-analytics-aggregation.json).
