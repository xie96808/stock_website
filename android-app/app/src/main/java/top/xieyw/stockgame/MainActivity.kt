package top.xieyw.stockgame

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.pm.PackageManager
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Base64
import android.view.View
import android.graphics.Color
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import android.webkit.ValueCallback
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Thin WebView shell that loads the live game at https://stockgame.xieyw.top.
 *
 * Same-origin reasoning (Origin / CSRF / __Host- cookie):
 * - The document URL is https://stockgame.xieyw.top, so fetch/XHR to /api/v1
 *   are same-origin: Origin header is https://stockgame.xieyw.top and cookies
 *   (including __Host-stockgame_session) are sent automatically.
 * - CookieManager persists first-party cookies across process restarts when
 *   acceptCookie is true and flush() is called; third-party cookies stay off.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var offlinePanel: LinearLayout
    private lateinit var rootView: View
    private lateinit var updater: AppUpdater
    private val gameOrigin = "https://stockgame.xieyw.top"
    private val gameUrl = "$gameOrigin/"

    /** Bridges <input type="file"> (avatar / feedback) to the system picker. */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback
            filePathCallback = null
            if (callback == null) return@registerForActivityResult
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            callback.onReceiveValue(uris)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // targetSdk 35 forces edge-to-edge on Android 15+, so pad the root by the
        // system bar / display-cutout insets ourselves; the page never sits
        // under the status bar or gesture bar.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        rootView = findViewById(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        applyBarTheme(dark = false)

        webView = findViewById(R.id.webview)
        offlinePanel = findViewById(R.id.offline_panel)
        findViewById<MaterialButton>(R.id.retry_button).setOnClickListener {
            offlinePanel.visibility = View.GONE
            webView.loadUrl(gameUrl)
        }

        updater = AppUpdater(this)
        configureCookies()
        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            /** One back press at a time while the page is answering (A-01). */
            private var asking = 0

            override fun handleOnBackPressed() {
                if (asking != 0) return
                val ticket = SystemClock.uptimeMillis().toInt() or 1
                asking = ticket
                // Ask the page first (window.__sgBack, web #211). Old pages without it
                // answer false and the shell falls back to the 1.1.6 behaviour.
                webView.evaluateJavascript(BackLogic.SCRIPT) { result -> settle(ticket, result) }
                // A busy or dead renderer may never answer: then act like 1.1.6.
                webView.postDelayed({ settle(ticket, null) }, BACK_ANSWER_TIMEOUT_MS)
            }

            private fun settle(ticket: Int, result: String?) {
                if (asking != ticket) return
                asking = 0
                if (isFinishing) return
                when (BackLogic.decide(result, webView.canGoBack())) {
                    BackAction.HANDLED_BY_PAGE -> Unit
                    BackAction.WEBVIEW_BACK -> webView.goBack()
                    BackAction.EXIT -> {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(gameUrl)
        }

        updater.checkOnLaunch()
    }

    private fun configureCookies() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, false)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            // Allow the game's own service worker / PWA bits if present.
            // Offscreen prerender not needed.
        }

        webView.addJavascriptInterface(ThemeBridge(), "StockGameApp")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = try {
                    fileChooserParams?.createIntent()
                } catch (_: Exception) {
                    null
                } ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }
                // Prefer gallery / documents over camera for avatar picks.
                if (intent.type.isNullOrBlank()) intent.type = "image/*"
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: ActivityNotFoundException) {
                    this@MainActivity.filePathCallback = null
                    filePathCallback?.onReceiveValue(null)
                    false
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url ?: return false
                return handleNavigation(uri)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                return handleNavigation(Uri.parse(url))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                offlinePanel.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                // Follow the site's 纸/墨 theme so the bar strips match the page.
                view.evaluateJavascript(THEME_WATCH_JS, null)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    offlinePanel.visibility = View.VISIBLE
                }
            }
        }
    }

    /**
     * Keep same-origin navigations inside the WebView; open everything else
     * in the system browser (mailto, tel, https other hosts, etc.).
     */
    private fun handleNavigation(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return true
        val host = uri.host?.lowercase()

        val isGameOrigin = (scheme == "https" || scheme == "http") &&
            (host == "stockgame.xieyw.top" || host == "www.stockgame.xieyw.top")

        if (isGameOrigin) {
            // Force https for the game host.
            if (scheme == "http") {
                webView.loadUrl(uri.buildUpon().scheme("https").build().toString())
                return true
            }
            return false // let WebView load it
        }

        // External: open in system browser / handler.
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: ActivityNotFoundException) {
            true
        }
    }

    private fun applyBarTheme(dark: Boolean) {
        val color = if (dark) PAPER_DARK else PAPER_LIGHT
        rootView.setBackgroundColor(color)
        @Suppress("DEPRECATION")
        window.statusBarColor = color
        @Suppress("DEPRECATION")
        window.navigationBarColor = color
        WindowCompat.getInsetsController(window, rootView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    private inner class ThemeBridge {
        @JavascriptInterface
        fun setTheme(mode: String?) {
            runOnUiThread { applyBarTheme(dark = mode == "dark") }
        }

        /** Forced (unthrottled) update check, triggered from the web UI. */
        @JavascriptInterface
        fun checkUpdate() {
            runOnUiThread { if (!isFinishing) updater.checkManual() }
        }

        @JavascriptInterface
        fun getVersion(): String = BuildConfig.VERSION_NAME

        /**
         * System share sheet (ACTION_SEND). Lets the player pick WeChat / other
         * apps. This is not WeChat JS-SDK deep-open; it only hands off a URL.
         */
        @JavascriptInterface
        fun share(title: String?, text: String?, url: String?) {
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                val body = listOfNotNull(text?.takeIf { it.isNotBlank() }, url?.takeIf { it.isNotBlank() })
                    .joinToString("\n")
                if (body.isBlank()) return@runOnUiThread
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, title ?: "")
                    putExtra(Intent.EXTRA_TEXT, body)
                }
                try {
                    startActivity(Intent.createChooser(send, title ?: "分享"))
                } catch (_: ActivityNotFoundException) {
                    // No handler; web fallback already copies to clipboard.
                }
            }
        }

        /**
         * 保存分享图: base64 PNG → MediaStore Pictures/早知道当初不炒了/ (API 29+, no
         * storage permission). Below API 29 it falls back to the system share sheet.
         * Returns "saved" | "shared" | "error" synchronously so the web side can
         * fall through to navigator.share / download on "error".
         */
        @JavascriptInterface
        fun saveImage(base64: String?, fileName: String?): String {
            val bytes = decodePng(base64) ?: return "error"
            val name = safePngName(fileName)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                return if (shareBytes(bytes, name, null)) "shared" else "error"
            }
            return try {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$ALBUM_DIR")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return "error"
                try {
                    resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("no stream")
                    values.clear()
                    values.put(MediaStore.Images.Media.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    "saved"
                } catch (e: Exception) {
                    resolver.delete(uri, null, null)
                    "error"
                }
            } catch (_: Exception) {
                "error"
            }
        }

        /** Share a base64 PNG through the system chooser (cacheDir/share via FileProvider). */
        @JavascriptInterface
        fun shareImage(base64: String?, fileName: String?, title: String?): String {
            val bytes = decodePng(base64) ?: return "error"
            return if (shareBytes(bytes, safePngName(fileName), title)) "shared" else "error"
        }

        /**
         * 发给微信好友: send a base64 PNG straight to WeChat's friend picker
         * (com.tencent.mm/.ui.tools.ShareImgUI, image only; WeChat drops EXTRA_TEXT
         * when an image is attached, so the link travels in the card's QR code).
         * Falls back to the system chooser when WeChat is missing or refuses.
         * Returns "wechat" | "chooser" | "error".
         */
        @JavascriptInterface
        fun shareImageToWeChat(base64: String?, fileName: String?): String {
            val bytes = decodePng(base64) ?: return "error"
            val uri = writeShareFile(bytes, safePngName(fileName)) ?: return "error"
            val direct = weChatImageIntent(uri)
            if (direct == null) {
                return if (startChooser(uri, "发给微信好友")) "chooser" else "error"
            }
            // Report what actually opened (A-03): wait for the UI thread's startActivity
            // so a refused ShareImgUI that falls back to the chooser returns "chooser",
            // and the page's toast matches what the user sees.
            val outcome = AtomicReference("chooser")
            val done = CountDownLatch(1)
            runOnUiThread {
                try {
                    if (isFinishing) {
                        outcome.set("error")
                        return@runOnUiThread
                    }
                    try {
                        grantUriPermission(WECHAT_PACKAGE, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        startActivity(direct)
                        outcome.set("wechat")
                    } catch (_: Exception) {
                        // ActivityNotFound / SecurityException (component renamed or not exported).
                        outcome.set(if (launchChooser(uri, "发给微信好友")) "chooser" else "error")
                    }
                } finally {
                    done.countDown()
                }
            }
            // @JavascriptInterface runs on a binder thread, never the UI thread, so this cannot deadlock.
            // If the UI thread is slow, assume the fallback path: never claim WeChat opened when unsure.
            if (!done.await(SHARE_WAIT_MS, TimeUnit.MILLISECONDS)) return "chooser"
            return outcome.get()
        }

        /** Lets the web UI show 「发给微信好友」 only when the shell can do it. */
        @JavascriptInterface
        fun canShareToWeChat(): Boolean = isWeChatInstalled()
    }

    private fun decodePng(base64: String?): ByteArray? {
        if (base64.isNullOrBlank() || base64.length > MAX_IMAGE_B64) return null
        return try {
            val raw = base64.substringAfter("base64,", base64)
            Base64.decode(raw, Base64.DEFAULT).takeIf { it.size > 8 }
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun safePngName(fileName: String?): String {
        val base = (fileName ?: "").replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
        val stem = base.removeSuffix(".png").ifBlank { "zaozhidao-${System.currentTimeMillis()}" }
        return "$stem.png"
    }

    private fun isWeChatInstalled(): Boolean = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.getPackageInfo(WECHAT_PACKAGE, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(WECHAT_PACKAGE, 0)
        }
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** Explicit ShareImgUI intent, or null when WeChat (or that activity) is not resolvable. */
    private fun weChatImageIntent(uri: Uri): Intent? {
        if (!isWeChatInstalled()) return null
        val intent = Intent(Intent.ACTION_SEND).apply {
            component = ComponentName(WECHAT_PACKAGE, WECHAT_SHARE_IMG_UI)
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return if (intent.resolveActivity(packageManager) != null) intent else null
    }

    private fun writeShareFile(bytes: ByteArray, name: String): Uri? = try {
        val dir = File(cacheDir, "share").apply { mkdirs() }
        dir.listFiles()?.forEach { if (it.name != name) it.delete() }
        val file = File(dir, name)
        file.writeBytes(bytes)
        FileProvider.getUriForFile(this, "$packageName${AppUpdater.AUTHORITY_SUFFIX}", file)
    } catch (_: Exception) {
        null
    }

    private fun startChooser(uri: Uri, title: String?): Boolean {
        runOnUiThread { if (!isFinishing) launchChooser(uri, title) }
        return true
    }

    private fun launchChooser(uri: Uri, title: String?): Boolean {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return try {
            startActivity(Intent.createChooser(send, title ?: "分享图片"))
            true
        } catch (_: ActivityNotFoundException) {
            // No share target.
            false
        }
    }

    private fun shareBytes(bytes: ByteArray, name: String, title: String?): Boolean {
        return try {
            val dir = File(cacheDir, "share").apply { mkdirs() }
            dir.listFiles()?.forEach { if (it.name != name) it.delete() }
            val file = File(dir, name)
            file.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(this, "$packageName${AppUpdater.AUTHORITY_SUFFIX}", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                try {
                    startActivity(Intent.createChooser(send, title ?: "分享图片"))
                } catch (_: ActivityNotFoundException) {
                    // No share target.
                }
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val ALBUM_DIR = "早知道当初不炒了"
        private const val WECHAT_PACKAGE = "com.tencent.mm"
        private const val WECHAT_SHARE_IMG_UI = "com.tencent.mm.ui.tools.ShareImgUI"
        private const val MAX_IMAGE_B64 = 24 * 1024 * 1024
        /** Max wait for the UI thread to report which share screen opened (A-03). */
        private const val SHARE_WAIT_MS = 1500L
        /** Max wait for window.__sgBack to answer before using the old back path (A-01). */
        private const val BACK_ANSWER_TIMEOUT_MS = 800L
        private val PAPER_LIGHT = Color.parseColor("#F3EAD8")
        private val PAPER_DARK = Color.parseColor("#1C1A16")
        private const val THEME_WATCH_JS = """
            (function () {
              if (!window.StockGameApp) return;
              var el = document.documentElement;
              var send = function () { StockGameApp.setTheme(el.getAttribute('data-theme') || 'light'); };
              send();
              if (window.__sgThemeObs) return;
              window.__sgThemeObs = new MutationObserver(send);
              window.__sgThemeObs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
            })();
        """
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        updater.onResume()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        CookieManager.getInstance().flush()
        updater.onDestroy()
        webView.destroy()
        super.onDestroy()
    }
}
