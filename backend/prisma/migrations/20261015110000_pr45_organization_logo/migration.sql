-- A marca da empresa.
--
-- O logo existia só por unidade (`business_units.logo_url`), e quem tem uma
-- unidade só — o caso comum — precisava abrir o cadastro da unidade para
-- timbrar um documento. Agora a empresa tem a sua, e ela serve de padrão para
-- toda unidade que não tenha marca própria.
--
-- `TEXT` e não `VARCHAR(n)`: é data URI, e o limite de tamanho é regra de
-- aplicação (`common/embedded-image.ts`, 512 KB), não de coluna — um teto no
-- schema recusaria com erro de banco em vez da mensagem que a pessoa entende.
ALTER TABLE "organizations" ADD COLUMN "logo_url" TEXT;

-- Traz o que já estava improvisado em `settings`.
--
-- Não havia campo, então o gerador de QR combinou de ler `settings.logoUrl` —
-- JSON livre, que o servidor não valida. Quem seguiu a convenção não perde a
-- marca: o valor vem para a coluna, e o caminho de leitura deixa de olhar o
-- JSON. A condição só aceita o que o `readEmbeddedImage` aceitaria; qualquer
-- outra coisa fica onde está, sem virar logo inválido no banco.
UPDATE "organizations"
   SET "logo_url" = "settings"->>'logoUrl'
 WHERE "settings"->>'logoUrl' ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$';
