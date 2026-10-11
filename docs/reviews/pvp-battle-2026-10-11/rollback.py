#!/usr/bin/env python3
"""Restore only the reviewed document, refusing to overwrite later edits.

Default target: docs/pvp-battle-design.md. --target is for a disposable copy
when testing rollback. Restores the reviewed origin/main original, not HEAD.
"""
import argparse
import hashlib
import json
from pathlib import Path

here = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--target', type=Path, default=here.parents[1] / 'pvp-battle-design.md')
args = parser.parse_args()
manifest = json.loads((here / 'verification.json').read_text())
original = (here / 'original.md').read_bytes()
assert hashlib.sha256(original).hexdigest() == manifest['original_sha256'], 'original hash mismatch'
current = args.target.read_bytes()
assert hashlib.sha256(current).hexdigest() == manifest['modified_sha256'], 'target changed; preserve later edits'
args.target.write_bytes(original)
assert args.target.read_bytes() == original
print('ROLLBACK_OK original_sha256=' + hashlib.sha256(original).hexdigest())
