-- As fotos citadas pelo pedido, pelo id local da captura.
--
-- A foto quase nunca existe no servidor no instante do pedido: a captura é
-- offline-first, e o upload acontece minutos ou horas depois. Guardar a intenção
-- declarada pelo aparelho é o que permite carimbar a evidência quando ela enfim
-- chega — sem isso, a citação só funcionaria com rede boa, que é justamente quando
-- ela menos importa.
--
-- `DEFAULT '{}'` e `NOT NULL`: lista vazia é "não citou nenhuma", e é diferente de
-- desconhecido. Nenhum pedido existente fica com nulo a interpretar.
ALTER TABLE "operation_cancellation_requests"
  ADD COLUMN "cited_local_media_ids" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "operation_cancellation_requests"."cited_local_media_ids" IS
  'Ids locais das capturas citadas; a evidência é carimbada quando o upload finaliza.';
