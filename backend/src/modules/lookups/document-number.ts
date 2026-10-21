/**
 * CPF e CNPJ: normalização e verificação dos dígitos.
 *
 * ## Por que verificar antes de consultar
 *
 * Porque um número malformado é erro de digitação, e dizer isso na hora é
 * melhor que gastar uma consulta a um terceiro para receber "não encontrado" —
 * que a pessoa leria como "esta empresa não existe".
 *
 * A verificação é dos **dígitos**, e não da existência: um CNPJ bem formado
 * pode não ter sido emitido. Quem sabe disso é a Receita, e é ela que responde.
 */

/** Só os dígitos. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Um CNPJ bem formado: 14 dígitos e os dois verificadores conferem. */
export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return false;
  /* Todos iguais passam no cálculo e não existem na prática. */
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const verificador = (tamanho: number): number => {
    let soma = 0;
    let peso = tamanho - 7;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(digits[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return (
    verificador(12) === Number(digits[12]) &&
    verificador(13) === Number(digits[13])
  );
}

/** Um CPF bem formado: 11 dígitos e os dois verificadores conferem. */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const verificador = (tamanho: number): number => {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(digits[i]) * (tamanho + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return (
    verificador(9) === Number(digits[9]) &&
    verificador(10) === Number(digits[10])
  );
}

/** Oito dígitos. Se o CEP existe, quem responde é o provedor. */
export function isCompletePostalCode(value: string): boolean {
  return onlyDigits(value).length === 8;
}
