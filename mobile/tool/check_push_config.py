#!/usr/bin/env python3
"""Native build gate. Public Firebase client files only, never service accounts.

Release requires explicit environment/project selection. iOS archives always
require push, even when local device builds opt out for a Personal Team.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import re
import shutil


def defines(encoded):
    result = {}
    for entry in encoded.split(',') if encoded else []:
        try:
            key, value = base64.b64decode(entry, validate=True).decode().split('=', 1)
        except (ValueError, UnicodeError):
            raise ValueError('DART_DEFINES inválido; gere os valores com o Flutter.') from None
        result[key] = value
    return result


def validate(platform, config, project, app_id):
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project):
        raise ValueError('Defina ORBIT_FIREBASE_PROJECT_ID com o projeto do ambiente selecionado.')
    if not config.is_file():
        raise ValueError(f'Configuração pública Firebase ausente: {config.name}. Consulte docs/firebase-push-release.md.')
    try:
        if platform == 'android':
            data = json.loads(config.read_text())
            if 'private_key' in data or data.get('type') == 'service_account':
                raise ValueError()
            if data['project_info']['project_id'] != project:
                raise ValueError()
            matches = [c for c in data['client'] if c['client_info']['android_client_info']['package_name'] == app_id]
            if len(matches) != 1:
                raise ValueError()
            client = matches[0]
            sender = str(data['project_info']['project_number'])
            if not sender.isdigit() or not client['api_key'][0]['current_key']:
                raise ValueError()
            if not client['client_info']['mobilesdk_app_id'].startswith('1:' + sender + ':android:'):
                raise ValueError()
        else:
            data = plistlib.loads(config.read_bytes())
            sender = str(data['GCM_SENDER_ID'])
            if data['PROJECT_ID'] != project or data['BUNDLE_ID'] != app_id:
                raise ValueError()
            if not sender.isdigit() or not data['API_KEY'] or not data['GOOGLE_APP_ID'].startswith('1:' + sender + ':ios:'):
                raise ValueError()
    except (ValueError, KeyError, TypeError, IndexError, plistlib.InvalidFileException):
        raise ValueError('Configuração Firebase inválida ou incompatível com projeto/application ID; baixe o arquivo do app correto. Não use JSON de conta de serviço.') from None


def check(platform, mobile_root, environment):
    options = defines(environment.get('DART_DEFINES', ''))
    release = environment.get('CONFIGURATION', '').lower() in ('release', 'profile')
    archive = environment.get('ACTION') == 'install'
    opt_out = environment.get('ORBIT_ALLOW_NO_PUSH') == 'YES'
    if platform == 'android' and opt_out:
        raise ValueError('A distribuição Android não permite ORBIT_ALLOW_NO_PUSH.')
    if archive and opt_out:
        raise ValueError('Archive de distribuição não permite ORBIT_ALLOW_NO_PUSH.')
    required = archive or (release and not opt_out)
    enabled = platform == 'android' or environment.get('ORBIT_PUSH_ENABLED') == 'YES'
    config = mobile_root / ('android/app/google-services.json' if platform == 'android' else 'ios/Runner/GoogleService-Info.plist')
    if not required and (not enabled or (platform == 'android' and not config.is_file())):
        return False
    if not enabled:
        raise ValueError('Ative ORBIT_PUSH_ENABLED e o entitlement APNs para distribuir o app.')
    if options.get('ORBIT_FLAVOR') not in ('staging', 'production'):
        raise ValueError('Defina ORBIT_FLAVOR=staging ou production; não misture projetos Firebase entre ambientes.')
    project = options.get('ORBIT_FIREBASE_PROJECT_ID', '')
    app_id = environment.get('PRODUCT_BUNDLE_IDENTIFIER', 'com.allbluelabs.orbit') if platform == 'ios' else 'com.allbluelabs.orbit'
    validate(platform, config, project, app_id)
    if platform == 'ios':
        entitlement = environment.get('CODE_SIGN_ENTITLEMENTS', '')
        entitlement_path = mobile_root / 'ios' / entitlement
        try:
            apns = plistlib.loads(entitlement_path.read_bytes()).get('aps-environment') if entitlement else None
            if apns == '$(ORBIT_APNS_ENVIRONMENT)':
                apns = environment.get('ORBIT_APNS_ENVIRONMENT')
            if apns not in ('development', 'production') or (archive and apns != 'production'):
                raise ValueError()
        except (OSError, ValueError, plistlib.InvalidFileException):
            raise ValueError('O build iOS precisa de CODE_SIGN_ENTITLEMENTS com aps-environment válido e de um perfil Apple compatível.') from None
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=('ios', 'android'), required=True)
    parser.add_argument('--mobile-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--copy-ios-resource', action='store_true')
    args = parser.parse_args()
    try:
        validated = check(args.platform, args.mobile_root, os.environ)
        if args.copy_ios_resource:
            target = Path(os.environ['TARGET_BUILD_DIR']) / os.environ['UNLOCALIZED_RESOURCES_FOLDER_PATH'] / 'GoogleService-Info.plist'
            source = args.mobile_root / 'ios/Runner/GoogleService-Info.plist'
            if validated:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            else:
                target.unlink(missing_ok=True)
        print('Firebase: configuração validada.' if validated else 'Firebase: build local sem push; não qualificado para distribuição.')
    except (OSError, ValueError, KeyError) as error:
        # Validation messages never include file contents, API keys or tokens.
        raise SystemExit('error: ' + (str(error) if isinstance(error, ValueError) else 'Não foi possível validar/copiar a configuração pública Firebase.')) from None


if __name__ == '__main__':
    main()
