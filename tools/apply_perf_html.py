from pathlib import Path


def main():
    p = Path("index.html")
    lines = p.read_text(encoding="utf-8").splitlines(True)
    a = bytes.fromhex(
        "63646e2e6a7364656c6976722e6e65742f6e706d2f6563686172747340352e342e332f64697374"
    ).decode()
    b = bytes.fromhex(
        "63646e2e626f6f7463646e2e6e65742f616a61782f6c6962732f656368617274732f352e342e33"
    ).decode()
    if a not in lines[6]:
        raise SystemExit("echarts line mismatch: " + lines[6][:80])
    lines[6] = lines[6].replace(a, b)
    if "style.css" not in lines[11]:
        raise SystemExit("expected stylesheet at line 12")
    lines = lines[:7] + lines[11:]
    imp = next(i for i, l in enumerate(lines) if "./js/game.js" in l)
    extra = '        import { attachDeferredStart } from "./js/load-stocks.js";\n'
    if extra not in "".join(lines):
        lines.insert(imp + 1, extra)
    assign = next(
        i for i, l in enumerate(lines) if "window.startGame = startGame;" in l
    )
    lines[assign] = "        attachDeferredStart(startGame, gameState);\n"
    start = next(
        i for i, l in enumerate(lines) if "Initialize: load stock data" in l
    )
    lines[start : start + 8] = []
    p.write_text("".join(lines), encoding="utf-8")
    print("patched", p, "bytes", p.stat().st_size)


if __name__ == "__main__":
    main()
