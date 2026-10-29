# Avisos de ações e evidências pendentes

As duas faixas acima da navegação têm um botão para fechar o aviso atual.
Dispensar a faixa mantém os itens disponíveis em Perfil → Ações pendentes.

Na página de sincronização, ações bloqueadas e evidências com falha oferecem
**Ocultar aviso**. A página passa a oferecer **Mostrar avisos ocultos**, e cada
item oculto pode ser reexibido. O aviso de confirmação também permite desfazer
a ocultação. Os envios da fila de anexos anterior usam as mesmas preferências
e agora podem ser consultados nessa página.

Ocultar não modifica o journal, os recibos, as filas, os arquivos locais ou os
dados do servidor. Envios pendentes continuam seguindo a política de tentativas
existente. O descarte de ações recusadas continua sendo uma ação separada e
com confirmação.

As preferências são locais e persistem ao reabrir o app. O namespace inclui
API, usuário, organização e unidade. A identidade de cada aviso inclui o item
e o motivo do bloqueio: novos itens ou novos problemas voltam a avisar, mesmo
quando a quantidade de pendências não muda. Progresso e tentativas automáticas
não reexibem o mesmo aviso dispensado.

É necessária uma nova build do mobile. Não há migrações nem novas variáveis
de ambiente.
