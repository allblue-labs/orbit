-- "Técnico Operacional", em vez de "Técnico operador".
--
-- O produto tinha três expressões para dois papéis: "Técnico em Campo", "Técnico
-- responsável" e "Responsável Técnico" — as duas últimas com as mesmas palavras em
-- ordens diferentes, dizendo coisas opostas. Num PMOC a diferença é concreta: um vai
-- ao local e executa o serviço; o outro responde tecnicamente pelo contrato e assina
-- o documento com a credencial que a norma exige.
--
-- O catálogo de papéis passou a nascer com o nome novo, mas `roles.name` é gravado na
-- criação da organização: sem isto, quem já existe continua lendo "Técnico operador"
-- na tela de cadastro de membro enquanto o resto do produto diz outra coisa.
--
-- `key` não muda — é ele que o código, as permissões e os seletores usam. O que muda
-- é só o que a pessoa lê.
--
-- Condicionado ao nome antigo: uma organização que renomeou o papel dela tem uma
-- decisão registrada, e renomear por cima a desfaria.
UPDATE "roles"
   SET "name" = 'Técnico Operacional',
       "description" = 'Executa o serviço no cliente: atendimento, roteiro, evidências e materiais.',
       "updated_at" = CURRENT_TIMESTAMP
 WHERE "key" = 'FIELD_TECHNICIAN'
   AND "name" = 'Técnico operador';
