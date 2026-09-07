/* Parse stocks pack off the main thread so auth/UI clicks stay responsive. */
self.onmessage = function (ev) {
  var payload = ev.data || {};
  try {
    var text = payload.text;
    if (typeof text !== "string" || !text.length) {
      throw new Error("empty pack text");
    }
    var pack = new Function(text + "\nreturn STOCKS_DATA;")();
    if (!Array.isArray(pack) || pack.length === 0) {
      throw new Error("empty pack");
    }
    self.postMessage({ ok: true, pack: pack });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: String((err && err.message) || err || "pack parse failed"),
    });
  }
};
