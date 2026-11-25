# PR-17 — Contratos e responsabilidade em RVT

Criação, edição, atribuição e execução de visitas usam os DTOs validados do
RVT. Os modelos de leitura descrevem as mesmas respostas HTTP para o backend
e o frontend. Os campos historicamente livres, como roteiro e observações,
continuam aceitando os formatos JSON já persistidos.

- A consulta de configurações carrega contratos, equipamentos e visitas em
  lote dentro de uma transação com RLS. O detalhe usa a mesma projeção da lista.
- A projeção de agenda usa a transação da visita para gravar evento e
  alocação. Os bloqueios de criação e execução concorrentes continuam no
  repositório.
- A montagem do relatório usa os dados congelados da execução, incluindo
  roteiro, respostas, evidências e assinaturas. A criação do artefato continua
  no repositório, sob o bloqueio da execução.
- Datas inválidas no aceite ou na conclusão recebem HTTP 400 na validação
  da entrada. Omitir essas datas continua usando a data do servidor.

A alteração pode ser implantada com o esquema atual. O refactor se limita
ao RVT. A qualificação integrada da release está prevista na PR-19.

## Validação local

Passaram 35 testes unitários do RVT, 10 testes do registro de RVT no frontend
e 15 testes HTTP em PostgreSQL descartável, com as 127 migrations aplicadas.
A API usou o papel `orbit_app`, sem superusuário ou bypass de RLS.

Os testes HTTP cobriram a equivalência da listagem com os detalhes, as
ocorrências recorrentes com fuso, a aprovação de atribuições, a separação
entre organizações, o replay de pedidos simultâneos, o rollback diante de
falhas de escrita, as evidências mobile, a assinatura e o download do PDF.
O driver `pg` emitiu um aviso de depreciação sobre consultas simultâneas
durante a suíte integrada. A origem desse aviso não foi localizada.
