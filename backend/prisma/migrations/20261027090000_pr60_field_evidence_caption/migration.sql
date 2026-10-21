-- A legenda de uma evidência de campo.
--
-- O documento premium já desenhava legenda sob cada foto do registro
-- fotográfico: `photoGrid` recebe `caption` e imprime. O que chegava ali era o
-- rótulo da **categoria** — "Antes", "Depois", "Geral" —, porque não existia
-- coluna com o que o técnico quis dizer sobre aquela imagem. Três fotos da
-- mesma categoria saíam com a mesma legenda, e a prova perdia o que ela
-- provava.
--
-- Opcional de propósito. Legenda obrigatória transformaria registrar uma foto
-- em redigir, de luva, no telhado — e a foto sem legenda continua sendo prova.
--
-- Nas duas tabelas porque o pipeline tem dois tempos: a intenção de upload
-- nasce no aparelho, offline, e a evidência só existe depois de o servidor
-- reler o objeto. A legenda viaja com a intenção e é materializada junto com a
-- evidência; guardá-la só no fim exigiria uma segunda chamada que o aparelho
-- sem rede não tem como fazer.
ALTER TABLE "field_evidence_uploads"
  ADD COLUMN "caption" VARCHAR(500);

ALTER TABLE "field_evidence"
  ADD COLUMN "caption" VARCHAR(500);

COMMENT ON COLUMN "field_evidence_uploads"."caption" IS
  'Legenda declarada na captura; materializada na evidência ao finalizar.';

COMMENT ON COLUMN "field_evidence"."caption" IS
  'Legenda da evidência, impressa sob a foto no registro fotográfico.';
