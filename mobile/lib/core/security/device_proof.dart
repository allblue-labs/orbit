import '../network/orbit_api_client.dart';
import '../network/session_authenticator.dart';
import '../storage/token_storage.dart';
import 'security_confirmation.dart';

typedef SignDeviceChallenge = Future<String?> Function(String challenge);

Future<Map<String, dynamic>?> _signedChallenge(
  OrbitApiClient client,
  String path,
  SignDeviceChallenge sign, {
  String? credentialId,
}) async {
  final options = await client.post<Map<String, dynamic>>(
    '$path/options',
    isPublic: credentialId != null,
    body: {if (credentialId != null) 'credentialId': credentialId},
  );
  final challenge = options['challenge'] as String;
  final signature = await sign(challenge);
  if (signature == null) return null;
  return {
    if (credentialId != null) 'credentialId': credentialId,
    'challengeId': options['challengeId'] as String,
    'challenge': challenge,
    'signature': signature,
  };
}

Future<Map<String, dynamic>?> authenticateDeviceKey(
  OrbitApiClient client,
  String path,
  String credentialId,
  SignDeviceChallenge sign,
) async {
  final auth = client.authenticator;
  final previous = auth.generation;
  final proof = await _signedChallenge(
    client,
    path,
    sign,
    credentialId: credentialId,
  );
  if (proof == null) return null;
  if (previous != auth.generation) throw SessionAuthenticator.changed;
  final clearing = auth.clearSession();
  final generation = auth.generation;
  await clearing;
  if (generation != auth.generation) throw SessionAuthenticator.changed;
  final data = await client.post<Map<String, dynamic>>(
    path,
    isPublic: true,
    body: proof,
  );
  await auth.storeTokens(TokenPair.fromJson(data), generation: generation);
  return data;
}

Future<String?> registerDeviceKey(
  OrbitApiClient client,
  String path,
  String confirmationPath, {
  required String deviceId,
  required String label,
  required String publicKey,
  required SignDeviceChallenge sign,
  required SecurityCredentials credentials,
}) async {
  final auth = client.authenticator;
  final generation = auth.generation;
  final proof = await _signedChallenge(client, path, sign);
  if (proof == null) return null;
  if (generation != auth.generation) throw SessionAuthenticator.changed;
  final confirmation = await confirmSecurityChange(
    client,
    confirmationPath,
    'DEVICE_REGISTER',
    credentials,
  );
  if (generation != auth.generation) throw SessionAuthenticator.changed;
  final data = await client.post<Map<String, dynamic>>(
    path,
    body: {
      ...proof,
      'deviceId': deviceId,
      'label': label,
      'publicKey': publicKey,
    },
    headers: {securityConfirmationHeader: confirmation},
  );
  return data['credentialId'] as String;
}
