#!/usr/bin/env python3
"""Generate favicon / apple-touch / OG assets from daytime mascot sketch."""
import struct
from pathlib import Path
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parents[1]
src = Image.open(ROOT / "images" / "mascot-day-sketch.jpg").convert("RGBA")

# Tight face crop — readable at 16/32
face = src.crop((205, 51, 615, 461))
# Wider head+hoodie for apple-touch / OG
wide = src.crop((180, 40, 639, 499))

out = ROOT / "images"


def write_ico(path: Path, images):
    """Write a multi-size ICO (PNG-compressed entries, Vista+)."""
    entries = []
    for im in images:
        buf = BytesIO()
        im.save(buf, format="PNG")
        data = buf.getvalue()
        w, h = im.size
        entries.append((w if w < 256 else 0, h if h < 256 else 0, data))

    count = len(entries)
    # ICONDIR + ICONDIRENTRYs
    offset = 6 + 16 * count
    header = struct.pack("<HHH", 0, 1, count)
    dir_entries = b""
    payloads = b""
    for w, h, data in entries:
        dir_entries += struct.pack(
            "<BBBBHHII",
            w,
            h,
            0,  # color palette
            0,  # reserved
            1,  # color planes
            32,  # bits per pixel
            len(data),
            offset,
        )
        payloads += data
        offset += len(data)
    path.write_bytes(header + dir_entries + payloads)


for name, sz in (("favicon-16.png", 16), ("favicon-32.png", 32), ("favicon-48.png", 48)):
    face.resize((sz, sz), Image.Resampling.LANCZOS).save(out / name, optimize=True)
    print("wrote", name)

ico_imgs = [
    face.resize((s, s), Image.Resampling.LANCZOS).convert("RGBA")
    for s in (16, 32, 48)
]
write_ico(out / "favicon.ico", ico_imgs)
write_ico(ROOT / "favicon.ico", ico_imgs)
print("wrote favicon.ico (images/ + site root)")

# Classic PNG favicons help Safari/Chrome when ICO is cached or flaky
face.resize((32, 32), Image.Resampling.LANCZOS).save(ROOT / "favicon.png", optimize=True)
face.resize((48, 48), Image.Resampling.LANCZOS).save(out / "favicon.png", optimize=True)
print("wrote favicon.png (site root 32 + images/ 48)")

wide.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(
    out / "apple-touch-icon.png", format="PNG", optimize=True
)
print("wrote apple-touch-icon.png")

og = wide.resize((512, 512), Image.Resampling.LANCZOS).convert("RGB")
og.save(out / "og-mascot-day.jpg", format="JPEG", quality=88, optimize=True)
print("wrote og-mascot-day.jpg")

raw = (out / "favicon.ico").read_bytes()
count = struct.unpack_from("<H", raw, 4)[0]
print(f"ICO entry count: {count}, bytes: {len(raw)}")
for i in range(count):
    w, h, _, _, _, _, size, off = struct.unpack_from("<BBBBHHII", raw, 6 + i * 16)
    print(f"  entry {i}: {w or 256}x{h or 256} size={size} off={off}")

for p in sorted(
    list(out.glob("favicon*")) + [ROOT / "favicon.png"]
    + list(out.glob("apple-touch*"))
    + list(out.glob("og-mascot*"))
    + [ROOT / "favicon.ico"]
):
    print(f"  {p.relative_to(ROOT)}  {p.stat().st_size} bytes")
