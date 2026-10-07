"""Write a5r's tests/config.fixture.ts from rules/config.json (tests cannot read files)."""
import json
import os
import sys

mod = sys.argv[1]
with open(os.path.join(mod, "rules", "config.json"), encoding="utf-8") as f:
    cfg = json.load(f)
body = json.dumps(cfg, indent=2, ensure_ascii=False)
with open(os.path.join(mod, "tests", "config.fixture.ts"), "w", encoding="utf-8", newline="\n") as f:
    f.write("// Generated from rules/config.json (tests have no file system). Regenerate after editing the config:\n")
    f.write("//   python make_fixture.py <mod folder>\n")
    f.write("import type { A5RConfig } from '../hooks/a5r.ts'\n\n")
    f.write(f"export const CONFIG: A5RConfig = {body}\n")
print("ok", len(body))
