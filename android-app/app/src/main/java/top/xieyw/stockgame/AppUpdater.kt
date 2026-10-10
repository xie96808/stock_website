package top.xieyw.stockgame

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Minimal self-updater for the sideloaded shell.
 *
 * Flow: fetch [MANIFEST_URL] (throttled, off main thread) → prompt → download
 * into cacheDir/updates → verify sha256 → install via FileProvider + ACTION_VIEW.
 * Owned by [MainActivity]; forward onResume/onDestroy.
 */
class AppUpdater(private val activity: AppCompatActivity) {

    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private val updatesDir = File(activity.cacheDir, "updates")

    @Volatile private var cancelDownload = false
    private var busy = false               // checking or downloading
    private var dialog: AlertDialog? = null
    private var forcedManifest: UpdateManifest? = null
    private var pendingInstall: File? = null
    private var pendingInstallForced = false
    private var awaitingInstallPermission = false
    private var destroyed = false

    fun checkOnLaunch() = check(force = false, manual = false)

    fun checkManual() = check(force = true, manual = true)

    fun onResume() {
        if (destroyed) return
        val apk = pendingInstall
        if (apk != null && awaitingInstallPermission) {
            awaitingInstallPermission = false
            if (canInstall()) {
                installApk(apk, pendingInstallForced)
            } else {
                pendingInstall = null
                toast(activity.getString(R.string.update_install_permission_denied))
                forcedManifest?.let { showPrompt(it, UpdateDecision.FORCED) }
            }
            return
        }
        // A forced update must not be dismissable by backing out of the installer.
        val forced = forcedManifest
        if (forced != null && !busy && dialog?.isShowing != true) {
            showPrompt(forced, UpdateDecision.FORCED)
        }
    }

    fun onDestroy() {
        destroyed = true
        cancelDownload = true
        dialog?.dismiss()
        dialog = null
        io.shutdownNow()
    }

    private fun check(force: Boolean, manual: Boolean) {
        if (destroyed || busy) return
        val now = System.currentTimeMillis()
        if (!UpdateLogic.shouldCheck(now, prefs.getLong(KEY_LAST_CHECK, 0L), force)) return
        prefs.edit().putLong(KEY_LAST_CHECK, now).apply()
        busy = true
        if (manual) toast(activity.getString(R.string.update_checking))
        io.execute {
            val result = runCatching { fetchManifest() }
            main.post {
                busy = false
                if (destroyed) return@post
                result.onSuccess { onManifest(it, manual) }
                    .onFailure {
                        Log.w(TAG, "update check failed", it)
                        if (manual) toast(activity.getString(R.string.update_check_failed))
                    }
            }
        }
    }

    private fun onManifest(m: UpdateManifest, manual: Boolean) {
        val decision = UpdateLogic.decide(BuildConfig.VERSION_CODE, m)
        if (decision == UpdateDecision.NONE) {
            forcedManifest = null
            io.execute { cleanup(keep = null) }
            if (manual) toast(activity.getString(R.string.update_latest, BuildConfig.VERSION_NAME))
            return
        }
        val skipActive = UpdateLogic.isSkipActive(
            prefs.getInt(KEY_SKIP_CODE, 0), prefs.getLong(KEY_SKIP_AT, 0L),
            m.versionCode, System.currentTimeMillis()
        )
        if (!UpdateLogic.shouldPrompt(decision, skipActive, manual)) return
        if (decision == UpdateDecision.FORCED) forcedManifest = m
        showPrompt(m, decision)
    }

    private fun showPrompt(m: UpdateManifest, decision: UpdateDecision) {
        if (destroyed || activity.isFinishing) return
        dialog?.dismiss()
        val forced = decision == UpdateDecision.FORCED
        val b = MaterialAlertDialogBuilder(activity)
            .setTitle(activity.getString(R.string.update_title, m.versionName))
            .setMessage(m.notes.ifBlank { activity.getString(R.string.update_default_notes) })
            .setCancelable(!forced)
            .setPositiveButton(R.string.update_now) { _, _ -> startDownload(m, forced) }
        if (!forced) {
            b.setNegativeButton(R.string.update_later) { _, _ ->
                prefs.edit()
                    .putInt(KEY_SKIP_CODE, m.versionCode)
                    .putLong(KEY_SKIP_AT, System.currentTimeMillis())
                    .apply()
            }
        }
        dialog = b.show().also { it.setCanceledOnTouchOutside(!forced) }
    }

    private fun startDownload(m: UpdateManifest, forced: Boolean) {
        if (destroyed || busy) return
        busy = true
        cancelDownload = false
        val pad = (20 * activity.resources.displayMetrics.density).toInt()
        val label = TextView(activity).apply { text = activity.getString(R.string.update_downloading) }
        val bar = LinearProgressIndicator(activity).apply { isIndeterminate = true; max = 100 }
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad / 2, pad, 0)
            addView(label)
            addView(bar)
        }
        val b = MaterialAlertDialogBuilder(activity)
            .setTitle(activity.getString(R.string.update_title, m.versionName))
            .setView(box)
            .setCancelable(false)
        if (!forced) b.setNegativeButton(R.string.update_cancel) { _, _ -> cancelDownload = true }
        dialog?.dismiss()
        dialog = b.show().also { it.setCanceledOnTouchOutside(false) }

        io.execute {
            val result = runCatching {
                downloadAndVerify(m) { pct ->
                    main.post {
                        if (pct >= 0) {
                            if (bar.isIndeterminate) bar.isIndeterminate = false
                            bar.setProgressCompat(pct, true)
                            label.text = activity.getString(R.string.update_downloading_pct, pct)
                        }
                    }
                }
            }
            main.post {
                busy = false
                if (destroyed) return@post
                dialog?.dismiss()
                dialog = null
                result.onSuccess { installApk(it, forced) }
                    .onFailure { e ->
                        Log.w(TAG, "update download failed", e)
                        if (e !is CancelledException) {
                            val msg = if (e is ChecksumException) R.string.update_checksum_failed
                            else R.string.update_download_failed
                            toast(activity.getString(msg))
                        }
                        if (forced) showPrompt(m, UpdateDecision.FORCED)
                    }
            }
        }
    }

    // ---- Install ------------------------------------------------------------

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

    private fun installApk(apk: File, forced: Boolean) {
        if (destroyed) return
        if (!canInstall()) {
            pendingInstall = apk
            pendingInstallForced = forced
            dialog?.dismiss()
            dialog = MaterialAlertDialogBuilder(activity)
                .setTitle(R.string.update_permission_title)
                .setMessage(R.string.update_permission_message)
                .setCancelable(false)
                .setPositiveButton(R.string.update_permission_go) { _, _ ->
                    awaitingInstallPermission = true
                    try {
                        activity.startActivity(
                            Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:${activity.packageName}")
                            )
                        )
                    } catch (_: ActivityNotFoundException) {
                        awaitingInstallPermission = false
                        pendingInstall = null
                        toast(activity.getString(R.string.update_install_permission_denied))
                    }
                }
                .apply {
                    if (!forced) setNegativeButton(R.string.update_later) { _, _ -> pendingInstall = null }
                }
                .show()
            return
        }
        pendingInstall = null
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}$AUTHORITY_SUFFIX", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "no installer", e)
            toast(activity.getString(R.string.update_download_failed))
        }
    }

    // ---- Network (background thread) ---------------------------------------

    private fun open(url: String, timeoutMs: Int): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.instanceFollowRedirects = false // redirects would bypass the host allowlist
        conn.setRequestProperty("Cache-Control", "no-cache")
        conn.setRequestProperty("User-Agent", "StockGameApp/${BuildConfig.VERSION_NAME}")
        return conn
    }

    private fun fetchManifest(): UpdateManifest {
        val conn = open(MANIFEST_URL, 10_000)
        try {
            if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
            val text = conn.inputStream.use { s ->
                val bytes = s.readNBytesCompat(MAX_MANIFEST_BYTES + 1)
                if (bytes.size > MAX_MANIFEST_BYTES) throw IOException("manifest too large")
                String(bytes, Charsets.UTF_8)
            }
            val j = JSONObject(text)
            val m = UpdateManifest(
                versionCode = j.getInt("versionCode"),
                versionName = j.getString("versionName"),
                apkUrl = j.getString("apkUrl"),
                sha256 = j.getString("sha256").lowercase(),
                size = j.getLong("size"),
                minSupportedVersionCode = j.optInt("minSupportedVersionCode", 0),
                notes = j.optString("notes", ""),
            )
            if (!UpdateLogic.isValidManifest(m)) throw IOException("invalid manifest")
            return m
        } finally {
            conn.disconnect()
        }
    }

    private fun downloadAndVerify(m: UpdateManifest, onProgress: (Int) -> Unit): File {
        if (!UpdateLogic.isAllowedApkUrl(m.apkUrl)) throw IOException("apkUrl not allowed")
        updatesDir.mkdirs()
        val name = UpdateLogic.apkFileName(m.versionName)
        cleanup(keep = name)
        val target = File(updatesDir, name)
        if (target.length() == m.size && UpdateLogic.verifySha256(target, m.sha256)) return target
        target.delete()
        val part = File(updatesDir, "$name.part")
        val conn = open(m.apkUrl, 20_000)
        try {
            if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: m.size
            if (total != m.size) throw IOException("size mismatch")
            var done = 0L
            var lastPct = -1
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelDownload || Thread.currentThread().isInterrupted) throw CancelledException()
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > m.size) throw IOException("too many bytes")
                        out.write(buf, 0, n)
                        val pct = ((done * 100) / total).toInt()
                        if (pct != lastPct) { lastPct = pct; onProgress(pct) }
                    }
                }
            }
            if (done != m.size) throw IOException("truncated download")
            if (!UpdateLogic.verifySha256(part, m.sha256)) throw ChecksumException()
            if (!part.renameTo(target)) throw IOException("rename failed")
            return target
        } catch (e: Exception) {
            part.delete()
            throw e
        } finally {
            conn.disconnect()
        }
    }

    /** Delete every downloaded APK / partial except [keep]. */
    private fun cleanup(keep: String?) {
        updatesDir.listFiles()?.forEach { if (it.name != keep) it.delete() }
    }

    private fun toast(msg: String) {
        if (!destroyed) Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()
    }

    private class CancelledException : IOException("cancelled")
    private class ChecksumException : IOException("sha256 mismatch")

    companion object {
        private const val TAG = "AppUpdater"
        const val MANIFEST_URL = "https://${UpdateLogic.ALLOWED_HOST}/download/app-version.json"
        const val AUTHORITY_SUFFIX = ".updates"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val MAX_MANIFEST_BYTES = 64 * 1024
        private const val PREFS = "app_updater"
        private const val KEY_LAST_CHECK = "last_check_ms"
        private const val KEY_SKIP_CODE = "skipped_version_code"
        private const val KEY_SKIP_AT = "skipped_at_ms"
    }
}

/** InputStream.readNBytes is API 33+; bounded read for older devices. */
private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (out.size() < limit) {
        val n = read(buf, 0, minOf(buf.size, limit - out.size()))
        if (n < 0) break
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
