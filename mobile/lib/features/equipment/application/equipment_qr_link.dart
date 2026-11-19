/// O caminho HTTPS impresso nas etiquetas é a associação oficial do Orbit.
/// O esquema alternativo só é usado pelo botão explícito do navegador.
String? equipmentLinkToken(Uri uri) {
  if (uri.hasAuthority || uri.hasScheme) {
    // Android declara HTTP e HTTPS para verificar o domínio. A URI recebida
    // só fornece o token. A leitura usa o cliente de API já configurado.
    final web =
        uri.host == 'orbit.allblue-labs.com' &&
        ((uri.scheme == 'https' && uri.port == 443) ||
            (uri.scheme == 'http' && uri.port == 80));
    final app =
        uri.scheme == 'orbit-operator' &&
        uri.host == 'equipamento' &&
        !uri.hasPort;
    if ((!web && !app) || uri.userInfo.isNotEmpty) return null;
  }
  return RegExp(r'^/q/([A-Za-z0-9_-]{43})$').firstMatch(uri.path)?.group(1);
}
