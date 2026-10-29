# Recuperação das filas locais

O journal de comandos e a fila de mídia leem cada registro separadamente. Um item ilegível não invalida os demais: os válidos continuam associados ao usuário/organização/unidade e seguem o fluxo normal de sincronização. Registros ilegíveis nunca são enviados ao servidor.

A leitura não reescreve o arquivo original. Na próxima alteração, o conteúdo que não pôde ser interpretado é mantido no campo `recovery`, separado dos comandos/recibos/mídias válidos. Um JSON interrompido ou versão desconhecida é preservado integralmente como texto. As mutações e a limpeza por retenção mantêm `recovery`; reabrir o app não duplica os registros. Falhas de leitura/gravação do disco continuam sendo erros, sem substituição silenciosa por uma fila vazia.

As telas de sincronização indicam a necessidade de recuperação e orientam procurar suporte antes de remover os dados do aplicativo. Não exibem os conteúdos preservados, que podem pertencer a outro contexto do aparelho. O indicador é genérico; conteúdos e identificadores não atravessam sessões.

Na fila legada de anexos, um arquivo com registros inválidos é copiado integralmente para `upload_queue[.<namespace>].json.recovery.<sha256>` antes de qualquer nova escrita. O hash evita duplicação do mesmo arquivo. A gravação falha se essa preservação falhar. Os itens válidos ainda são carregados individualmente.

Esses mecanismos preservam a informação disponível; não inventam ou reenviam intenções com dados incompletos. Não há reparo automático de itens ilegíveis. Para recuperação assistida, mantenha os arquivos no armazenamento privado do app e use um procedimento autorizado, respeitando o contexto do titular; não registre os conteúdos em logs ou chamados públicos.
