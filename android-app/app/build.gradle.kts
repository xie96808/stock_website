plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "top.xieyw.stockgame"
    compileSdk = 35

    defaultConfig {
        applicationId = "top.xieyw.stockgame"
        minSdk = 24
        targetSdk = 35
        versionCode = 4
        versionName = "1.0.3"
    }

    signingConfigs {
        create("release") {
            val storeFilePath = System.getenv("ANDROID_KEYSTORE_PATH")
            val storePasswordEnv = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            val keyAliasEnv = System.getenv("ANDROID_KEY_ALIAS")
            val keyPasswordEnv = System.getenv("ANDROID_KEY_PASSWORD")
            if (!storeFilePath.isNullOrBlank()
                && !storePasswordEnv.isNullOrBlank()
                && !keyAliasEnv.isNullOrBlank()
                && !keyPasswordEnv.isNullOrBlank()
            ) {
                storeFile = file(storeFilePath)
                storePassword = storePasswordEnv
                keyAlias = keyAliasEnv
                keyPassword = keyPasswordEnv
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.activity:activity-ktx:1.9.3")

    testImplementation("junit:junit:4.13.2")
}
