"""Write a5's tests/config.fixture.ts from rules/config.json (tests cannot read files)."""
import json
import os
import sys

mod = sys.argv[1]
with open(os.path.join(mod, "a5", "config.json"), encoding="utf-8") as f:
    cfg = json.load(f)
body = json.dumps(cfg, indent=2, ensure_ascii=False)
with open(os.path.join(mod, "tests", "config.fixture.ts"), "w", encoding="utf-8", newline="\n") as f:
    f.write("// Generated from rules/config.json (tests have no file system). Regenerate after editing the config:\n")
    f.write("//   python make_fixture.py <mod folder>\n")
    f.write("import type { A5Config } from '../hooks/a5.ts'\n\n")
    f.write(f"export const CONFIG: A5Config = {body}\n")
print("ok", len(body))
