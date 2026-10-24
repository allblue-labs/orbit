# Isolamento de sessão no aparelho

A autenticação pertence ao container raiz. As telas e seus repositórios vivem em
um `SessionRuntime` independente, sem herdar providers do container anterior.
Entrar, sair, expirar a sessão ou trocar a unidade substitui esse estado, incluindo
avatar, documentos, filtros, formulários e navegação. Atualizar o próprio perfil
mantém a sessão atual.

O cache de leitura, os documentos temporários e a fila legada de anexos usam uma
chave derivada de API, usuário, tenant e unidade. O encerramento invalida o cliente
HTTP desse contexto, limpa imagens e cópias temporárias e descarta o cache de
leitura e a projeção offline correspondente. Cache legado sem proprietário não é
migrado. A fila legada sem proprietário também não é restaurada nem atribuída à
próxima pessoa que entrar.

O journal de comandos e a fila atual de mídia já registram o proprietário em cada
entrada. Suas instâncias de armazenamento serializado são compartilhadas para
evitar escritas concorrentes no mesmo arquivo, mas seus controladores e consultas
são exclusivos da sessão. Consultar resultado, descartar e enviar exigem o mesmo
usuário, tenant e unidade. Pendências identificadas permanecem disponíveis somente
para a conta correspondente.

As requisições carregam a geração da autenticação e uma licença do contexto que as
iniciou. Respostas antigas, inclusive de URLs assinadas, são rejeitadas. Um 401
antigo não é repetido com o token da conta nova. Login, refresh e logout serializam
as alterações de tokens; uma renovação atrasada não pode restaurar credenciais
antigas ou apagar a sessão seguinte. A revogação do aparelho no logout usa a
credencial anterior explicitamente, depois de encerrado o acesso local.

Na API, documentos exigem permissão de leitura e filtros de tenant/unidade. Para
técnicos, listagem e acesso por ID também exigem vínculo com o trabalho; auxiliares
removidos não mantêm acesso por uma atribuição antiga. Proprietários e perfis de
gestão autorizados mantêm a visão de suas unidades. Alterar apenas o app não
substitui essa validação no servidor: a publicação precisa incluir API e mobile.

Os testes locais cobrem contas diferentes na mesma organização, tenants e unidades
diferentes, cache legado, respostas e refresh atrasados, logins concorrentes,
revogação do aparelho, comandos de outra conta e a navegação real do aplicativo.
