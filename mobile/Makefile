FLUTTER ?= flutter
LOCAL_CONFIG ?= config/local.json
STAGING_CONFIG ?= config/staging.json
PRODUCTION_CONFIG ?= config/production.json

.PHONY: run-local run-android run-ios run-staging build-android-prod build-ios-prod

run-local:
	@test -f "$(LOCAL_CONFIG)" || (echo "Copie config/local.example.json para $(LOCAL_CONFIG) e ajuste o IP da API." && exit 1)
	$(FLUTTER) run --dart-define-from-file="$(LOCAL_CONFIG)"

run-android:
	$(FLUTTER) run --dart-define-from-file=config/development.android.json

run-ios:
	$(FLUTTER) run --dart-define-from-file=config/development.ios.json

run-staging:
	@test -f "$(STAGING_CONFIG)" || (echo "Crie $(STAGING_CONFIG) a partir de config/staging.example.json." && exit 1)
	$(FLUTTER) run --dart-define-from-file="$(STAGING_CONFIG)"

build-android-prod:
	@test -f "$(PRODUCTION_CONFIG)" || (echo "Crie $(PRODUCTION_CONFIG) a partir de config/production.example.json." && exit 1)
	$(FLUTTER) build appbundle --release --dart-define-from-file="$(PRODUCTION_CONFIG)"

build-ios-prod:
	@test -f "$(PRODUCTION_CONFIG)" || (echo "Crie $(PRODUCTION_CONFIG) a partir de config/production.example.json." && exit 1)
	$(FLUTTER) build ipa --release --dart-define-from-file="$(PRODUCTION_CONFIG)"
