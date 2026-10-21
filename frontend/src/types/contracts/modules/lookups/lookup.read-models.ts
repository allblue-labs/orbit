/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * O que as consultas públicas devolvem, no vocabulário do produto.
 *
 * ## Por que existe no backend, se a web já consultava CEP
 *
 * A web consultava por uma rota do próprio Next (`/api/cep/:cep`), que o
 * aplicativo **não alcança**: o celular fala com a API, não com o servidor de
 * páginas. O resultado era que o cadastro de cliente em campo não tinha busca
 * de endereço nenhuma — e digitar rua, bairro e cidade de luva, na casa do
 * cliente, é o caminho mais curto para ninguém cadastrar.
 *
 * CNPJ não existia em lugar nenhum. É a consulta que mais poupa digitação:
 * razão social, nome fantasia, endereço e telefone de uma vez.
 *
 * ## Nada disto é cadastro
 *
 * Estas respostas são **sugestão para preencher um formulário**. Nenhuma delas
 * grava nada, e o cliente só existe quando alguém salva. Por isso campo
 * ausente vem ausente, e não inventado: o formulário mostra o que veio e deixa
 * o resto editável.
 */

/** O endereço de um CEP, nos campos que os formulários do produto usam. */
export interface PostalAddressReadModel {
  postalCode: string;
  street: string;
  district: string;
  city: string;
  state: string;
  stateCode: string;
  /**
   * Sempre "Brasil".
   *
   * Não vem do provedor: o serviço atende **só** CEP brasileiro, então o país é
   * consequência de a consulta ter dado certo. Deixá-lo de fora fazia o
   * formulário preencher rua, bairro, cidade e estado e abandonar o campo de
   * país logo abaixo — preenchido pela metade parece defeito, e é.
   */
  country: string;
}

/**
 * Uma empresa pelo CNPJ.
 *
 * `null` em qualquer campo é "o provedor não informou". O formulário mostra o
 * que veio e segue editável — inclusive o endereço, que muda de sede sem a
 * Receita saber na mesma hora.
 */
export interface CompanyLookupReadModel {
  documentNumber: string;
  legalName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  /** A situação cadastral, como o provedor a descreve. */
  status: string | null;
  address: PostalAddressReadModel & {
    number: string | null;
    complement: string | null;
  };
}
