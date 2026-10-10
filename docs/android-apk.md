# 安卓 APK：发布、应用内更新与服务器配置

站点首页提供「下载安卓 App」入口，指向稳定地址：

`https://stockgame.xieyw.top/download/stockgame.apk`

APK **不进 git**。文件落在服务器 `/srv/stock-website/downloads/`，由 nginx `location ^~ /download/`（见 `deploy/nginx-stockgame.xieyw.top.conf`，`Cache-Control: no-cache`）别名提供；该目录在静态发版树之外，发网页不会冲掉 APK。

## 更新是怎么生效的

| 部分 | 怎么更新 |
| --- | --- |
| 网页内容（游戏逻辑、UI、API） | App 是 WebView 壳，直接加载线上站点；推 `main` 自动部署后，用户下次打开即是新版，**无需发 APK**。 |
| 安卓壳本身（原生代码、权限、图标、桥接方法） | 通过 **应用内更新器** 升级：发新 APK → 服务器更新 `app-version.json` → App 启动时检测并提示。 |

### 应用内更新器（壳 ≥ 1.0.3）

代码：`android-app/app/src/main/java/top/xieyw/stockgame/AppUpdater.kt`（流程）+ `UpdateLogic.kt`（纯逻辑，JVM 单测 `UpdateLogicTest.kt`）。

1. 启动时在后台线程请求 `https://stockgame.xieyw.top/download/app-version.json`（超时 10s，不跟随重定向，响应上限 64KB）。**每 12 小时最多一次**（上次检查时间存 SharedPreferences），手动检查不受限。
2. `versionCode > 本机 VERSION_CODE` 时弹窗「发现新版本 x.y.z」+ 更新说明，按钮「立即更新」/「稍后」。
   - 本机 `VERSION_CODE < minSupportedVersionCode`：**强制更新**，没有「稍后」，不可取消；退出安装器回到 App 会再次弹出。
   - 点「稍后」：同一版本 24 小时内不再自动提示（手动检查仍会提示）。
3. 下载到 `cacheDir/updates/`，带进度条；校验 `size` 与 `sha256`，不一致则删除并提示。旧的下载包每次检查/下载时清理。
4. 只接受 `https://stockgame.xieyw.top/download/*.apk` 形式的 `apkUrl`（不允许其他主机、http、端口、userinfo）。
5. 通过 FileProvider + `ACTION_VIEW`（`application/vnd.android.package-archive`）调起系统安装器。Android 8+ 若尚未允许「安装未知应用」，先说明原因并跳转 `ACTION_MANAGE_UNKNOWN_APP_SOURCES`，返回 App 时（`onResume`）自动继续安装。
6. JS 桥：`window.StockGameApp.checkUpdate()`（强制检查）、`window.StockGameApp.getVersion()`（返回 versionName）。首页在桥存在 `checkUpdate` 时显示「检查更新 / 当前版本 x.y.z」，网页/桌面/旧壳（1.0.2 及以下）不显示。

> 1.0.2 及更早的壳没有更新器，需要用户手动从下载页装一次 1.0.3，之后即可自动更新。

### 版本清单 `/download/app-version.json`

```json
{
  "versionCode": 4,
  "versionName": "1.0.3",
  "apkUrl": "https://stockgame.xieyw.top/download/stockgame-1.0.3.apk",
  "sha256": "64 位小写十六进制",
  "size": 5420744,
  "minSupportedVersionCode": 1,
  "notes": "更新说明…",
  "publishedAt": "2026-10-11T00:00:00Z"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `versionCode` | int > 0 | 与 gradle `versionCode` 一致；大于本机才提示 |
| `versionName` | `^\d+\.\d+\.\d+$` | 与 gradle `versionName`、tag `android-v<versionName>` 一致 |
| `apkUrl` | string | 必须是 `https://stockgame.xieyw.top/download/stockgame-<versionName>.apk` |
| `sha256` | string | APK 的 SHA-256（小写 hex），App 安装前校验 |
| `size` | int | APK 字节数，App 校验 |
| `minSupportedVersionCode` | int ≥ 0 | 本机 versionCode 低于它 → 强制更新。默认 1（不强制） |
| `notes` | string | 弹窗正文 |
| `publishedAt` | ISO 8601 UTC | 发布时间（仅展示/排查用） |

该文件由发布流水线生成，服务器脚本会再次校验并重写（只保留以上字段）。

## 发新版 APK（自动流水线）

工作流：`.github/workflows/android-release.yml`（使用 `production` environment，与网页部署相同的 `PROD_HOST` / `PROD_USER` / `PROD_SSH_KEY` / `PROD_KNOWN_HOSTS`，以及签名 secrets `ANDROID_KEYSTORE_BASE64` 等）。

1. 修改 `android-app/app/build.gradle.kts`：`versionCode` +1，`versionName` 改为新版本（如 `1.0.3`）。
2. 提交并合入 `main`（PR 上 **Android APK** 工作流会跑单测并构建）。
3. 在 main 上打 tag 并推送（附注 tag 的说明会作为更新说明）：

   ```bash
   git tag -a android-v1.0.3 -m "更新说明：支持应用内自动更新"
   git push origin android-v1.0.3
   ```

   或在 Actions 页手动运行 **Android release**（`workflow_dispatch`，可填 `notes` 与 `minSupportedVersionCode`，默认 1）。手动运行时以 gradle 中的版本为准，Release 会建在 `android-v<versionName>` 上。
4. 流水线：校验 tag 版本 = gradle `versionName` → 单测 + 构建并签名 → `apksigner verify` → 计算 sha256/size → 生成 `app-version-<ver>.json` → scp APK 与 json 到 `/home/stockdeploy/incoming/` → `sudo /usr/local/sbin/publish-stockgame-apk <apk> <ver> <sha256> <json>`（必须输出 `PUBLISH_OK`）→ 回读线上 `app-version.json` 核对 → 创建 GitHub Release 并附 APK（备用下载）。

> 强制更新：tag 触发时 `minSupportedVersionCode` 固定为 1；需要强制时请用手动运行并填写。同一 versionName 的 APK 一旦发布，服务器拒绝用不同内容覆盖，必须升版本。

## 服务器一次性配置

以 root 执行（在仓库检出目录里）：

```bash
# 1. 安装发布 / 回滚脚本
sudo install -o root -g root -m 0755 deploy/publish-stockgame-apk.sh  /usr/local/sbin/publish-stockgame-apk
sudo install -o root -g root -m 0755 deploy/rollback-stockgame-apk.sh /usr/local/sbin/rollback-stockgame-apk

# 2. 下载目录（已存在则仅修正权限）
sudo install -d -o root -g root -m 0755 /srv/stock-website/downloads

# 3. 依赖检查：python3、flock、sha256sum
command -v python3 flock sha256sum

# 4. sudoers（用 visudo 编辑，勿直接覆盖）
sudo visudo -f /etc/sudoers.d/stockdeploy-stockgame-apk
```

sudoers 内容（单独文件，与现有 `stockdeploy-stock-website` 并存）：

```
stockdeploy ALL=(root) NOPASSWD: /usr/local/sbin/publish-stockgame-apk, /usr/local/sbin/rollback-stockgame-apk
```

然后 `sudo chmod 0440 /etc/sudoers.d/stockdeploy-stockgame-apk && sudo visudo -c`。

`/home/stockdeploy/incoming/` 沿用网页部署的上传目录。若之前手动放过 APK，第一次流水线发布后会自动建立 `app-version.json` 并把 `stockgame.apk` 指向新版本；目录里只保留最新 5 个 `stockgame-x.y.z.apk`。

## 回滚

```bash
# 把下载链接与清单指回某个仍保留在服务器上的版本（需给出该版本的 versionCode）
sudo /usr/local/sbin/rollback-stockgame-apk 1.0.3 4
```

注意：**安卓不允许降级安装**。回滚只会让 `stockgame.apk` 和清单指回旧版本，阻止更多用户升级到有问题的版本；已经装上新版的设备不会被降级。真正修复请发一个更高 `versionCode` 的新版本。

## 签名密钥务必保管

正式包用同一把 release keystore 签名。**密钥丢失后，新包无法覆盖安装旧包**（用户只能卸载重装，应用内更新链路也会断）。仓库不提交 keystore；CI 通过 Actions secrets（`ANDROID_KEYSTORE_BASE64` 等）注入，发布流水线缺少签名 secrets 时直接失败，不会发布 debug 包。离线备份另存（勿入 git）。本地构建见 `android-app/README.md`。

## 前端入口可见性

- 安卓壳内（存在 `window.StockGameApp`）：隐藏下载入口；壳 ≥ 1.0.3 时显示「检查更新 / 当前版本」。
- iPhone / iPad（含 iPadOS 桌面 UA）：不提供 APK，改为提示用 Safari「分享 → 添加到主屏幕」。
- 桌面与安卓浏览器：显示下载链接；首次安装旁注「允许安装未知来源应用」。
