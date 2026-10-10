package top.xieyw.stockgame

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UpdateLogicTest {
    private val sha = "a".repeat(64)
    private fun m(code: Int, min: Int = 1, url: String = "https://stockgame.xieyw.top/download/stockgame-1.0.3.apk") =
        UpdateManifest(code, "1.0.3", url, sha, 5_420_744, min, "notes")

    @Test fun hostAllowlist() {
        assertTrue(UpdateLogic.isAllowedApkUrl("https://stockgame.xieyw.top/download/stockgame-1.0.3.apk"))
        assertTrue(UpdateLogic.isAllowedApkUrl("https://STOCKGAME.xieyw.top/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("http://stockgame.xieyw.top/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://evil.com/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://stockgame.xieyw.top.evil.com/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://evil.com@stockgame.xieyw.top/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://x@stockgame.xieyw.top/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://stockgame.xieyw.top:8443/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://www.stockgame.xieyw.top/download/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://stockgame.xieyw.top/other/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl("https://stockgame.xieyw.top/download/a.txt"))
        assertFalse(UpdateLogic.isAllowedApkUrl("file:///sdcard/a.apk"))
        assertFalse(UpdateLogic.isAllowedApkUrl(""))
        assertFalse(UpdateLogic.isAllowedApkUrl(null))
        assertFalse(UpdateLogic.isAllowedApkUrl("not a url"))
    }

    @Test fun manifestValidation() {
        assertTrue(UpdateLogic.isValidManifest(m(4)))
        assertFalse(UpdateLogic.isValidManifest(m(4, url = "https://evil.com/download/a.apk")))
        assertFalse(UpdateLogic.isValidManifest(m(4).copy(sha256 = "xyz")))
        assertFalse(UpdateLogic.isValidManifest(m(4).copy(versionName = "1.0")))
        assertFalse(UpdateLogic.isValidManifest(m(4).copy(size = 0)))
    }

    @Test fun versionDecision() {
        assertEquals(UpdateDecision.NONE, UpdateLogic.decide(4, m(4)))
        assertEquals(UpdateDecision.NONE, UpdateLogic.decide(5, m(4)))
        assertEquals(UpdateDecision.OPTIONAL, UpdateLogic.decide(3, m(4, min = 1)))
        assertEquals(UpdateDecision.OPTIONAL, UpdateLogic.decide(3, m(4, min = 3)))
        assertEquals(UpdateDecision.FORCED, UpdateLogic.decide(3, m(4, min = 4)))
    }

    @Test fun throttle() {
        val h = 60L * 60 * 1000
        assertTrue(UpdateLogic.shouldCheck(1000, 0, false))
        assertFalse(UpdateLogic.shouldCheck(100 * h + 11 * h, 100 * h, false))
        assertTrue(UpdateLogic.shouldCheck(100 * h + 12 * h, 100 * h, false))
        assertTrue(UpdateLogic.shouldCheck(100 * h + 1, 100 * h, true))
        assertTrue(UpdateLogic.shouldCheck(50 * h, 100 * h, false)) // clock went back
    }

    @Test fun skipWindow() {
        val h = 60L * 60 * 1000
        assertTrue(UpdateLogic.isSkipActive(4, 10 * h, 4, 20 * h))
        assertFalse(UpdateLogic.isSkipActive(4, 10 * h, 4, 34 * h))
        assertFalse(UpdateLogic.isSkipActive(4, 10 * h, 5, 11 * h))
        assertFalse(UpdateLogic.isSkipActive(0, 0, 4, 11 * h))
        assertFalse(UpdateLogic.shouldPrompt(UpdateDecision.OPTIONAL, skipActive = true, manual = false))
        assertTrue(UpdateLogic.shouldPrompt(UpdateDecision.OPTIONAL, skipActive = true, manual = true))
        assertTrue(UpdateLogic.shouldPrompt(UpdateDecision.FORCED, skipActive = true, manual = false))
        assertFalse(UpdateLogic.shouldPrompt(UpdateDecision.NONE, skipActive = false, manual = true))
    }

    @Test fun sha256Verify() {
        val f = File.createTempFile("upd", ".apk")
        try {
            f.writeText("abc")
            val abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            assertTrue(UpdateLogic.verifySha256(f, abc))
            assertTrue(UpdateLogic.verifySha256(f, abc.uppercase()))
            assertFalse(UpdateLogic.verifySha256(f, "0".repeat(64)))
            assertFalse(UpdateLogic.verifySha256(File(f.path + ".missing"), abc))
        } finally { f.delete() }
    }
}
