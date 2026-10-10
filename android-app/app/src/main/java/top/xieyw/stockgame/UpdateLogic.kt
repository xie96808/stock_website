package top.xieyw.stockgame

import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest

/** Parsed /download/app-version.json. */
data class UpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val size: Long,
    val minSupportedVersionCode: Int,
    val notes: String,
)

enum class UpdateDecision { NONE, OPTIONAL, FORCED }

/**
 * Pure, Android-free update rules so they can be covered by JVM unit tests.
 */
object UpdateLogic {
    const val ALLOWED_HOST = "stockgame.xieyw.top"
    const val CHECK_INTERVAL_MS = 12L * 60 * 60 * 1000
    const val SKIP_WINDOW_MS = 24L * 60 * 60 * 1000
    private val SHA256_RE = Regex("^[0-9a-f]{64}$")
    private val VERSION_NAME_RE = Regex("^[0-9]+\\.[0-9]+\\.[0-9]+$")

    /** Only https on the exact game host, default port, no userinfo, path ending .apk. */
    fun isAllowedApkUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val uri = try { URI(url) } catch (_: Exception) { return false }
        if (!"https".equals(uri.scheme, ignoreCase = true)) return false
        if (!ALLOWED_HOST.equals(uri.host, ignoreCase = true)) return false
        if (uri.rawUserInfo != null) return false
        if (uri.port != -1 && uri.port != 443) return false
        val path = uri.path ?: return false
        return path.startsWith("/download/") && path.endsWith(".apk") && !path.contains("..")
    }

    fun isValidManifest(m: UpdateManifest): Boolean =
        m.versionCode > 0 &&
            VERSION_NAME_RE.matches(m.versionName) &&
            SHA256_RE.matches(m.sha256.lowercase()) &&
            m.size in 1..(200L * 1024 * 1024) &&
            m.minSupportedVersionCode >= 0 &&
            isAllowedApkUrl(m.apkUrl)

    /** Whether to hit the network: forced, never checked, interval elapsed, or clock moved backwards. */
    fun shouldCheck(nowMs: Long, lastCheckMs: Long, force: Boolean): Boolean {
        if (force || lastCheckMs <= 0L) return true
        if (nowMs < lastCheckMs) return true
        return nowMs - lastCheckMs >= CHECK_INTERVAL_MS
    }

    fun decide(currentVersionCode: Int, m: UpdateManifest): UpdateDecision = when {
        m.versionCode <= currentVersionCode -> UpdateDecision.NONE
        currentVersionCode < m.minSupportedVersionCode -> UpdateDecision.FORCED
        else -> UpdateDecision.OPTIONAL
    }

    /** True if the user said 「稍后」 for exactly this versionCode less than 24h ago. */
    fun isSkipActive(skippedVersionCode: Int, skippedAtMs: Long, candidateVersionCode: Int, nowMs: Long): Boolean {
        if (skippedVersionCode != candidateVersionCode || skippedAtMs <= 0L) return false
        if (nowMs < skippedAtMs) return false
        return nowMs - skippedAtMs < SKIP_WINDOW_MS
    }

    /** Should a prompt be shown (manual checks ignore the skip). */
    fun shouldPrompt(decision: UpdateDecision, skipActive: Boolean, manual: Boolean): Boolean = when (decision) {
        UpdateDecision.NONE -> false
        UpdateDecision.FORCED -> true
        UpdateDecision.OPTIONAL -> manual || !skipActive
    }

    fun sha256Hex(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun verifySha256(file: File, expected: String): Boolean {
        if (!file.isFile) return false
        val actual = file.inputStream().use { sha256Hex(it) }
        return actual.equals(expected.trim(), ignoreCase = true)
    }

    fun apkFileName(versionName: String) = "stockgame-$versionName.apk"
}
