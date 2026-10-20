/// O nome de um arquivo de documento, como o cliente vê chegar.
///
/// ## Por que é público e mora aqui
///
/// Duas telas entregam PDF hoje — a lista de Documentos e o atendimento de PMOC —
/// e o nome do arquivo é a primeira coisa que o cliente lê, antes de abrir.
/// Duplicar as regras significaria que a correção de um nome quebrado alcançaria
/// uma das duas, e a outra continuaria mandando `ordem-de-servi-o.pdf`.
library;

/// Acentos viram a letra sem acento, e não hífen.
///
/// A primeira versão só apagava o que não fosse ASCII, e "Ordem de serviço —
/// Clínica Vida" virava `ordem-de-servi-o-cl-nica-vida.pdf`. Um nome assim
/// chega no WhatsApp do cliente com a palavra quebrada no meio — o Orbit
/// parece um sistema que não sabe escrever em português.
///
/// A tabela é a do português mais o que aparece em razão social; um pacote de
/// transliteração inteiro resolveria o alfabeto grego, que não é o problema.
const _semAcento = <String, String>{
  'á': 'a',
  'à': 'a',
  'ã': 'a',
  'â': 'a',
  'ä': 'a',
  'å': 'a',
  'é': 'e',
  'è': 'e',
  'ê': 'e',
  'ë': 'e',
  'í': 'i',
  'ì': 'i',
  'î': 'i',
  'ï': 'i',
  'ó': 'o',
  'ò': 'o',
  'õ': 'o',
  'ô': 'o',
  'ö': 'o',
  'ú': 'u',
  'ù': 'u',
  'û': 'u',
  'ü': 'u',
  'ç': 'c',
  'ñ': 'n',
  'ý': 'y',
};


/// Junta as partes num nome de arquivo legível, com extensão.
///
/// Minúsculas, sem acento, sem espaço e sem pontuação solta — o que sobrevive a
/// qualquer sistema de arquivos e a qualquer aplicativo de mensagem. Partes
/// vazias somem; vazio inteiro vira `documento.pdf`, que ainda é melhor que um
/// arquivo sem nome.
String documentFileNameOf(Iterable<String> parts) {
  final juntas = parts
      .map((parte) => parte.trim())
      .where((parte) => parte.isNotEmpty)
      .join('-')
      .toLowerCase();

  final ascii = juntas.split('').map((c) => _semAcento[c] ?? c).join();

  final limpo = ascii
      .replaceAll(RegExp(r'[^a-z0-9._-]+'), '-')
      .replaceAll(RegExp(r'-+'), '-')
      .replaceAll(RegExp(r'^[-.]+|[-.]+$'), '');
  return '${limpo.isEmpty ? 'documento' : limpo}.pdf';
}
