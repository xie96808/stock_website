#!/usr/bin/env python3
"""Document-only acceptance checks; these do not test a PvP implementation."""
import argparse
import json
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--document', type=Path, required=True)
args = p.parse_args()
s = args.document.read_text(encoding='utf-8')
checks = {
    'versioned_baseline': 'fb13936984ae9166d58fa2bdc72423aee445933e' in s,
    'single_write_transport': 'REST 承担全部业务写入' in s,
    'correct_live_equity': 'visibleMtmPpm' in s and 'curve.at(-1)' in s,
    'persistent_player_lock': 'pvp_active_members' in s,
    'unique_settlement': 'pvp_settlements.match_id UNIQUE' in s,
    'rating_formula_fixed': 'floor((rating-700)/100)+1' in s,
    'reward_cap_before_charge': '当日已领 10 次者暂停新开 PvP' in s,
    'explicit_restart_policy': '首版一律将未完局系统作废' in s,
    'drain_before_rollback': 'acceptingNew = featureEnabled && !drain' in s,
    'resources_and_acceptance': '26～35人日' in s and 'R07' in s and 'E02' in s,
    'no_production_test_claim': '未实测房间容量' in s,
    'balanced_fences': len(re.findall(r'^```', s, re.M)) % 2 == 0,
}
try:
    blocks = re.findall(r'^```json\n(.*?)^```', s, re.M | re.S)
    for block in blocks:
        json.loads(block)
    checks['json_examples_parse'] = bool(blocks)
except json.JSONDecodeError:
    checks['json_examples_parse'] = False

# Cross references to sections, not a substitute for editorial review.
headings = {m.group(1) for m in re.finditer(r'^#{2,3} (\d+(?:\.\d+)?)(?:\.|\s)', s, re.M)}
references = set(re.findall(r'§(\d+(?:\.\d+)?)', s))
checks['section_references_exist'] = references <= headings
for name, ok in checks.items():
    print(('PASS ' if ok else 'FAIL ') + name)
print(f'DOCUMENT_CHECKS {sum(checks.values())}/{len(checks)}')
raise SystemExit(0 if all(checks.values()) else 1)
