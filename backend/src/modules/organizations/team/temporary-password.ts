import { randomInt } from 'node:crypto';

/**
 * A senha temporária que o owner repassa.
 *
 * ## Por que não é aleatória pura
 *
 * Ela vai ser **ditada** — por telefone, por WhatsApp, num bilhete. Uma senha
 * que mistura `l`, `I` e `1` gera uma segunda ligação para descobrir qual era, e
 * a saída fácil disso é o owner escolher `123456` para todo mundo.
 *
 * Então: alfabeto sem ambiguidade, em blocos separados por hífen, com o
 * comprimento compensando o alfabeto menor. São 3 blocos de 4 caracteres sobre
 * 29 símbolos — cerca de 58 bits, e ela só vale até o primeiro acesso.
 *
 * `randomInt` do módulo de cripto, e não `Math.random`: a senha protege uma
 * conta, ainda que por pouco tempo.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BLOCOS = 3;
const TAMANHO_DO_BLOCO = 4;

export function generateTemporaryPassword(): string {
  const blocos: string[] = [];
  for (let bloco = 0; bloco < BLOCOS; bloco += 1) {
    let atual = '';
    for (let posicao = 0; posicao < TAMANHO_DO_BLOCO; posicao += 1) {
      atual += ALFABETO[randomInt(ALFABETO.length)];
    }
    blocos.push(atual);
  }
  return blocos.join('-');
}
