# Android WebView 壳（早知道当初不炒了）

轻量原生 Android 壳，用 WebView 加载线上站点 [https://stockgame.xieyw.top](https://stockgame.xieyw.top)。游戏逻辑与静态资源仍由线上站点提供，发新版网页无需重装 APK。

## 特性

- 包名 `top.xieyw.stockgame`，应用名「早知道当初不炒了」
- JavaScript / DOM Storage / 持久 Cookie（`__Host-stockgame_session` 同源）
- 全屏无地址栏；状态栏颜色 `#0B1220`
- 返回键：WebView 历史回退，到根页再退出
- 外链（非 `stockgame.xieyw.top`）走系统浏览器
- 仅 `INTERNET` 权限；HTTPS only

## 同源 / CSRF / Cookie 说明

页面本身从 `https://stockgame.xieyw.top` 加载，因此对 `/api/v1` 的 `fetch`/`XHR` 是同源请求：`Origin` 为该域名，CSRF 头与 `__Host-` Cookie 行为与手机浏览器一致。CookieManager 在暂停/销毁时 `flush()`，便于跨进程重启保留会话。

## 本地构建（可选）

```bash
cd android-app
export ANDROID_KEYSTORE_PATH=/path/to/stockgame-release.keystore
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=stockgame
export ANDROID_KEY_PASSWORD=...
./gradlew assembleRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`

无签名环境变量时，CI 回退为 debug APK。

## CI

工作流：`.github/workflows/android-apk.yml`

- 触发：`workflow_dispatch`，以及触及 `android-app/**` 的 push/PR
- 产物 artifact 名：`stockgame-apk`
- 签名密钥通过 Actions secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`（仓库内不提交 keystore）

## 限制

- 必须联网：壳不打包游戏资源
- 依赖系统 WebView（荣耀等机型为厂商 WebView，版本可能偏旧）
- 不在应用商店分发；侧载安装需允许「未知来源」
