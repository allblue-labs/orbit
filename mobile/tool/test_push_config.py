"""Public synthetic configs only. No Firebase requests, signing keys or local env."""
import base64
import importlib.util
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('push_config', Path(__file__).with_name('check_push_config.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PushConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.android = self.root / 'android/app/google-services.json'
        self.ios = self.root / 'ios/Runner/Google-Service-Info.plist'
        self.android.parent.mkdir(parents=True)
        self.ios.parent.mkdir(parents=True)
        self.android.write_text(json.dumps({
            'project_info': {'project_id': 'orbit-staging-test', 'project_number': '123456'},
            'client': [{'client_info': {'mobilesdk_app_id': '1:123456:android:abc', 'android_client_info': {'package_name': 'com.allbluelabs.orbit'}}, 'api_key': [{'current_key': 'synthetic-public-api-key'}]}],
        }))
        self.ios.write_bytes(plistlib.dumps({
            'PROJECT_ID': 'orbit-staging-test', 'BUNDLE_ID': 'com.allbluelabs.orbitOperator',
            'GCM_SENDER_ID': '123456', 'GOOGLE_APP_ID': '1:123456:ios:abc', 'API_KEY': 'synthetic-public-api-key',
        }))
        (self.ios.parent / 'Runner.entitlements').write_bytes(plistlib.dumps({'aps-environment': 'development'}))
        flags = {'ORBIT_FLAVOR': 'staging', 'ORBIT_FIREBASE_PROJECT_ID': 'orbit-staging-test'}
        self.env = {'CONFIGURATION': 'Release', 'ORBIT_PUSH_ENABLED': 'YES', 'CODE_SIGN_ENTITLEMENTS': 'Runner/Runner.entitlements', 'DART_DEFINES': ','.join(base64.b64encode(f'{k}={v}'.encode()).decode() for k, v in flags.items())}

    def test_both_valid_clients(self):
        for platform in ('android', 'ios'):
            self.assertTrue(module.check(platform, self.root, self.env))

    def test_missing_release_configuration(self):
        for platform, config in (('android', self.android), ('ios', self.ios)):
            config.unlink()
            with self.assertRaisesRegex(ValueError, 'ausente'):
                module.check(platform, self.root, self.env)

    def test_wrong_project(self):
        for platform in ('android', 'ios'):
            config = self.android if platform == 'android' else self.ios
            with self.assertRaisesRegex(ValueError, 'incompatível'):
                module.validate(platform, config, 'orbit-production-test', 'com.allbluelabs.orbit' if platform == 'android' else 'com.allbluelabs.orbitOperator')

    def test_wrong_app_id(self):
        for platform, config in (('android', self.android), ('ios', self.ios)):
            with self.assertRaisesRegex(ValueError, 'incompatível'):
                module.validate(platform, config, 'orbit-staging-test', 'com.other.app')

    def test_service_account_never_embedded(self):
        self.android.write_text(json.dumps({'type': 'service_account', 'private_key': 'SECRET_CANARY'}))
        with self.assertRaises(ValueError) as error:
            module.check('android', self.root, self.env)
        self.assertNotIn('SECRET_CANARY', str(error.exception))

    def test_explicit_environment_required(self):
        for platform in ('android', 'ios'):
            with self.assertRaisesRegex(ValueError, 'ORBIT_FLAVOR'):
                module.check(platform, self.root, {**self.env, 'DART_DEFINES': ''})

    def test_archive_never_allows_personal_team_opt_out(self):
        with self.assertRaisesRegex(ValueError, 'Archive'):
            module.check('ios', self.root, {**self.env, 'ACTION': 'install', 'ORBIT_ALLOW_NO_PUSH': 'YES'})

    def test_local_personal_team_build_can_opt_out(self):
        self.ios.unlink()
        self.assertFalse(module.check('ios', self.root, {**self.env, 'ORBIT_PUSH_ENABLED': 'NO', 'ORBIT_ALLOW_NO_PUSH': 'YES'}))

    def test_release_ios_requires_enabled_push_and_entitlement(self):
        for extra in ({'ORBIT_PUSH_ENABLED': 'NO'}, {'CODE_SIGN_ENTITLEMENTS': ''}):
            with self.assertRaises(ValueError):
                module.check('ios', self.root, {**self.env, **extra})

    def test_debug_without_config_is_supported(self):
        self.android.unlink()
        self.ios.unlink()
        for platform in ('android', 'ios'):
            self.assertFalse(module.check(platform, self.root, {'CONFIGURATION': 'Debug'}))

    def test_android_release_cannot_opt_out(self):
        with self.assertRaises(ValueError):
            module.check('android', self.root, {**self.env, 'ORBIT_ALLOW_NO_PUSH': 'YES'})

    def test_invalid_defines_do_not_echo_input(self):
        with self.assertRaises(ValueError) as error:
            module.defines('NOT_BASE64_SECRET_CANARY')
        self.assertNotIn('SECRET_CANARY', str(error.exception))


if __name__ == '__main__':
    unittest.main()
