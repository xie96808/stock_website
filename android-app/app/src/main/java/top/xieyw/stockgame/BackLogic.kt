package top.xieyw.stockgame

/** What the system back key should do after asking the page (A-01). */
enum class BackAction { HANDLED_BY_PAGE, WEBVIEW_BACK, EXIT }

/**
 * Pure, Android-free back-key rules so they can be covered by JVM unit tests.
 *
 * The page (web #211) exposes window.__sgBack(): it closes the topmost dialog,
 * presses the screen's own 「返回」 button or stays put mid-game, and returns
 * true when it handled the press. Older pages have no __sgBack, the call
 * yields false/undefined, and the shell keeps its old behaviour
 * (WebView history, else leave the Activity).
 */
object BackLogic {
    /** Script for WebView.evaluateJavascript; never throws inside the page. */
    const val SCRIPT =
        "(function(){try{return typeof window.__sgBack==='function'&&window.__sgBack()===true;}catch(e){return false;}})()"

    /** evaluateJavascript hands back JSON: "true", "false", "null", or a quoted string. */
    fun pageHandled(jsResult: String?): Boolean = jsResult?.trim() == "true"

    fun decide(jsResult: String?, canGoBack: Boolean): BackAction = when {
        pageHandled(jsResult) -> BackAction.HANDLED_BY_PAGE
        canGoBack -> BackAction.WEBVIEW_BACK
        else -> BackAction.EXIT
    }
}
