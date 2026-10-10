# 安卓 APK 发布与下载

站点首页提供「下载安卓 App」入口，指向稳定地址：

`https://stockgame.xieyw.top/download/stockgame.apk`

APK **不进 git**。文件落在服务器 `/srv/stock-website/downloads/`，由 nginx `location ^~ /download/`（见 `deploy/nginx-stockgame.xieyw.top.conf`）别名提供；该目录在静态发版树之外，发网页不会冲掉 APK。

## 发新版 APK

1. 在 `android-app/app/build.gradle.kts` 里提高 `versionCode`，并更新 `versionName`（如 `1.0.2`）。
2. 推送改动或手动跑 GitHub Actions 工作流 **「Android APK」**（`.github/workflows/android-apk.yml`）。
3. 从 Actions 下载 artifact（名一般为 `stockgame-apk`）。
4. 上传到服务器，并让稳定文件名指向新版本：

```bash
# 示例：版本号与 versionName 对齐
sudo install -d -m 755 /srv/stock-website/downloads
sudo cp /path/to/app-release.apk /srv/stock-website/downloads/stockgame-1.0.2.apk
sudo ln -sfn stockgame-1.0.2.apk /srv/stock-website/downloads/stockgame.apk
```

浏览器访问 `/download/stockgame.apk` 应触发下载（`Content-Type: application/vnd.android.package-archive`，`Content-Disposition: attachment`）。

## 签名密钥务必保管

正式包用同一把 release keystore 签名。**密钥丢失后，新包无法覆盖安装旧包**（用户只能卸载重装，本地数据/更新链路也会断）。仓库不提交 keystore；CI 通过 Actions secrets（`ANDROID_KEYSTORE_BASE64` 等）注入。本地构建见 `android-app/README.md`。

## 前端入口可见性

- 安卓壳内（存在 `window.StockGameApp`）：隐藏下载入口。
- iPhone / iPad（含 iPadOS 桌面 UA）：不提供 APK，改为提示用 Safari「分享 → 添加到主屏幕」。
- 桌面与安卓浏览器：显示下载链接；首次安装旁注「允许安装未知来源应用」。
