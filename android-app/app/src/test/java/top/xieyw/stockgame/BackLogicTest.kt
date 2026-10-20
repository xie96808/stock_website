package top.xieyw.stockgame

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackLogicTest {
    @Test fun pageHandledOnlyOnLiteralTrue() {
        assertTrue(BackLogic.pageHandled("true"))
        assertTrue(BackLogic.pageHandled(" true\n"))
        assertFalse(BackLogic.pageHandled("false"))
        assertFalse(BackLogic.pageHandled("null"))
        assertFalse(BackLogic.pageHandled("\"true\""))
        assertFalse(BackLogic.pageHandled(""))
        assertFalse(BackLogic.pageHandled(null))
    }

    @Test fun decideKeepsOldBehaviourWithoutSgBack() {
        // Old page (no __sgBack) -> script returns false: same as 1.1.6.
        assertEquals(BackAction.WEBVIEW_BACK, BackLogic.decide("false", canGoBack = true))
        assertEquals(BackAction.EXIT, BackLogic.decide("false", canGoBack = false))
        assertEquals(BackAction.EXIT, BackLogic.decide(null, canGoBack = false))
        // New page handled it (dialog closed / 返回 pressed / stay in game).
        assertEquals(BackAction.HANDLED_BY_PAGE, BackLogic.decide("true", canGoBack = false))
        assertEquals(BackAction.HANDLED_BY_PAGE, BackLogic.decide("true", canGoBack = true))
    }

    @Test fun scriptGuardsMissingFunctionAndThrows() {
        assertTrue(BackLogic.SCRIPT.contains("typeof window.__sgBack==='function'"))
        assertTrue(BackLogic.SCRIPT.contains("catch(e){return false;}"))
    }
}
