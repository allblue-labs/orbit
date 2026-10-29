import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val uploadSigningFile = rootProject.file("key.properties")
val uploadSigning = Properties().apply {
    if (uploadSigningFile.isFile) uploadSigningFile.inputStream().use { load(it) }
}
fun signingValue(property: String, environment: String): String? =
    System.getenv(environment)?.takeIf { it.isNotBlank() }
        ?: uploadSigning.getProperty(property)?.takeIf { it.isNotBlank() }

val uploadStorePath = signingValue("storeFile", "ORBIT_ANDROID_KEYSTORE_PATH")
val uploadStorePassword = signingValue("storePassword", "ORBIT_ANDROID_STORE_PASSWORD")
val uploadKeyAlias = signingValue("keyAlias", "ORBIT_ANDROID_KEY_ALIAS")
val uploadKeyPassword = signingValue("keyPassword", "ORBIT_ANDROID_KEY_PASSWORD")
val uploadSigningReady = listOf(uploadStorePath, uploadStorePassword, uploadKeyAlias, uploadKeyPassword)
    .all { it != null }

// Debug continues to work without credentials. Every release entry point,
// including flutter run --release, must use the configured upload key.
val validateUploadSigning = tasks.register("validateOrbitUploadSigning") {
    doLast {
        if (!uploadSigningReady) throw GradleException(
            "Configure a chave de upload em android/key.properties ou nas variáveis ORBIT_ANDROID_*. Consulte docs/android-store-release.md."
        )
        if (!rootProject.file(uploadStorePath!!).isFile) throw GradleException(
            "O arquivo da chave de upload não foi encontrado. Verifique storeFile sem publicar credenciais."
        )
    }
}
tasks.configureEach {
    if (name == "preReleaseBuild" || name.startsWith("validateSigningRelease")) {
        dependsOn(validateUploadSigning)
    }
}

android {
    namespace = "com.allbluelabs.orbit_operator"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.allbluelabs.orbit_operator"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (uploadSigningReady) {
                storeFile = rootProject.file(uploadStorePath!!)
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// The Firebase client configuration is supplied by each deployment.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-messaging")
}
