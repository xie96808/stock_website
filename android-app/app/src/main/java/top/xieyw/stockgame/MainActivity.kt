package top.xieyw.stockgame

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
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
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton

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
    private val gameOrigin = "https://stockgame.xieyw.top"
    private val gameUrl = "$gameOrigin/"

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

        configureCookies()
        configureWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(gameUrl)
        }
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
        webView.webChromeClient = WebChromeClient()
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
    }

    companion object {
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
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        webView.destroy()
        super.onDestroy()
    }
}
