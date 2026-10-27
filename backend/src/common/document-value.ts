/** Human-readable answers shared by every document renderer. */
const LABELS: Readonly<Record<string, string>> = {
  name: 'Nome',
  nome: 'Nome',
  displayname: 'Nome',
  legalname: 'Razão social',
  tradename: 'Nome fantasia',
  code: 'Código',
  manufacturer: 'Fabricante',
  fabricante: 'Fabricante',
  model: 'Modelo',
  modelo: 'Modelo',
  serialnumber: 'Número de série',
  serie: 'Número de série',
  identifier: 'Identificação',
  identificador: 'Identificação',
  location: 'Localização',
  local: 'Local',
  sector: 'Setor',
  capacity: 'Capacidade',
  specifications: 'Especificações',
  description: 'Descrição',
  descricao: 'Descrição',
  quantity: 'Quantidade',
  quantidade: 'Quantidade',
  unit: 'Unidade',
  unidade: 'Unidade',
  notes: 'Observações',
  observacao: 'Observação',
  label: 'Descrição',
  value: 'Valor',
  street: 'Logradouro',
  number: 'Número',
  complement: 'Complemento',
  district: 'Bairro',
  city: 'Cidade',
  state: 'UF',
  statecode: 'UF',
  postalcode: 'CEP',
  referencepoint: 'Ponto de referência',
  address: 'Endereço',
  phone: 'Telefone',
  email: 'E-mail',
  documentnumber: 'Documento',
  sequence: 'Número',
  sequencenumber: 'Número',
  total: 'Total',
  dueon: 'Vencimento',
  equipment: 'Equipamento',
  customer: 'Cliente',
  plan: 'Plano',
  cycle: 'Ciclo',
  maintenance: 'Manutenção',
  performedat: 'Realizada em',
  executionnotes: 'Observações da execução',
  servicelocation: 'Local do atendimento',
  scope: 'Escopo',
  servicetypes: 'Tipos de serviço',
  fieldtechnician: 'Técnico em campo',
  auxiliaries: 'Auxiliares',
  technicalresponsible: 'Responsável técnico',
  credential: 'Registro profissional',
  credentialtype: 'Conselho profissional',
  credentialregion: 'UF do registro',
  credentialnumber: 'Número do registro',
  status: 'Situação',
  version: 'Versão',
};

const INTERNAL = new Set([
  'id',
  'sourceid',
  'sourceentityid',
  'sourcetype',
  'organizationid',
  'businessunitid',
  'userid',
  'assetid',
  'equipmentid',
  'operationid',
  'executionid',
  'planid',
  'cycleid',
  'customerid',
  'storageobjectid',
  'storagefileid',
  'fileid',
  'signature',
  'signaturehash',
  'signatureassetid',
  'signatureimage',
  'signatureimagemimetype',
  'objectkey',
  'bucket',
  'sha256',
  'contenthash',
  'snapshothash',
  'templateid',
  'snapshotid',
]);
const keyOf = (key: string) => key.toLowerCase().replace(/[ _-]/g, '');
export const isInternalDocumentKey = (key: string): boolean =>
  INTERNAL.has(keyOf(key));

export function documentLabel(key: string): string {
  const known = LABELS[keyOf(key)];
  if (known) return known;
  const words = key
    .replace(/([a-zà-ÿ])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Keep business values, without printing JSON syntax or storage/signature IDs. */
export function documentValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  )
    return value.toString();
  if (typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    const complex = value.some(
      (item) => item !== null && typeof item === 'object',
    );
    return value
      .map(
        (item, index) =>
          `${complex ? `${index + 1}. ` : ''}${documentValue(item)}`,
      )
      .join(complex ? '\n\n' : ', ');
  }
  const rows = Object.entries(value)
    .filter(([key]) => !isInternalDocumentKey(key))
    .filter(([, item]) => item != null && item !== '')
    .map(([key, item]) => `${documentLabel(key)}: ${documentValue(item)}`);
  return rows.join('\n') || '—';
}
