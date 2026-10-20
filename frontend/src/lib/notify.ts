/**
 * O aviso que confirma que algo aconteceu.
 *
 * ## Por que existe uma camada aqui
 *
 * Para que o vocabulário e o tom fiquem num lugar só. Espalhado por cada tela,
 * o mesmo ato vira "Salvo!", "Cliente criado com sucesso" e "OK" conforme quem
 * escreveu — e a tela de erro de um fluxo não combina com a de outro.
 *
 * ## O que é aviso, e o que não é
 *
 * Aviso é para o que **acabou de acontecer** e some sozinho: cadastrou,
 * cancelou, enviou. Não serve para o que a pessoa precisa ler com calma nem
 * para o que exige decisão — recusa do servidor com motivo, impedimento de
 * domínio, confirmação destrutiva. Essas moram na tela, onde ficam.
 *
 * É por isso que o erro **não** é avisado por padrão: a maioria das telas do
 * produto já mostra a recusa junto do formulário, com o texto do servidor, e um
 * aviso flutuante repetindo a mesma frase duplica o ruído sem acrescentar nada.
 */
import { toast } from "sonner";

/** Quanto tempo um aviso fica. Curto: ele confirma, não informa. */
const DURACAO_MS = 4000;

export function notifySuccess(message: string, description?: string): void {
  toast.success(message, { description, duration: DURACAO_MS });
}

export function notifyInfo(message: string, description?: string): void {
  toast(message, { description, duration: DURACAO_MS });
}

/**
 * Um aviso de atenção — aconteceu, mas com ressalva.
 *
 * O caso que o justifica: a ação foi registrada no aparelho e ainda não chegou
 * ao servidor. Dizer "pronto" mentiria; dizer "falhou" também.
 */
export function notifyWarning(message: string, description?: string): void {
  toast.warning(message, { description, duration: DURACAO_MS });
}

/**
 * Um erro que **não** tem onde aparecer na tela.
 *
 * Reservado a ações sem formulário: um botão de lista, um item de menu. Onde
 * houver `MutationError` junto do campo, o erro mora lá — repetir aqui é
 * duplicar.
 */
export function notifyError(message: string, description?: string): void {
  toast.error(message, { description, duration: DURACAO_MS + 2000 });
}
