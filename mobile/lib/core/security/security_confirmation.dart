import '../network/orbit_api_client.dart';

const securityConfirmationHeader = 'x-orbit-security-confirmation';

typedef SecurityCredentials = ({String password, String? mfaCode});

Future<String> confirmSecurityChange(
  OrbitApiClient client,
  String path,
  String action,
  SecurityCredentials credentials,
) async {
  final response = await client.post<Map<String, dynamic>>(
    path,
    body: {
      'action': action,
      'currentPassword': credentials.password,
      if (credentials.mfaCode case final code?) 'mfaCode': code,
    },
  );
  return response['confirmation'] as String;
}
