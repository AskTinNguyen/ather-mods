// Generated from a5/config.json (tests have no file system). Regenerate after editing the config:
//   python make_fixture.py <mod folder>
import type { A5Config } from '../hooks/a5.ts'

export const CONFIG: A5Config = {
  "ask_action": "approve",
  "claude_ask_action": "deny",
  "deny_abs_paths": [
    "{KIT}/*"
  ],
  "ask_abs_paths": [
    "{HERMES_HOME}/config.yaml",
    "{HOME}/.claude/settings.json"
  ],
  "ask_root_files": [
    ".gitignore",
    ".gitattributes",
    "AGENTS.md",
    "CLAUDE.md"
  ],
  "ask_paths": [
    "*.uproject",
    "*.Build.cs",
    "*.Target.cs",
    "Config/*.ini",
    "Plugins/*/Config/*.ini",
    ".claude/settings.json"
  ],
  "project_roots": [],
  "shell_deny": [
    {
      "id": "no-verify",
      "re": "\\bgit\\b.*\\s--no-verify\\b",
      "why": "Never skip git hooks (--no-verify)."
    },
    {
      "id": "lfs-skip-smudge",
      "re": "GIT_LFS_SKIP_SMUDGE['\"]?\\s*=\\s*['\"]?1",
      "why": "GIT_LFS_SKIP_SMUDGE leaves LFS pointer text inside .uasset files."
    },
    {
      "id": "sparse-checkout",
      "re": "\\bgit\\b(\\s+-[cC]\\s+\\S+)*\\s+sparse-checkout\\s+(set|add|init|reapply)\\b",
      "why": "A sparse layout in the shared checkout removes tracked files for every session; use a separate worktree.",
      "where": "shared"
    }
  ],
  "shell_ask": [
    {
      "id": "force-push",
      "re": "\\bgit\\b.*\\spush\\b.*(\\s(-f|--force)\\b|\\s\\+[\\w/])",
      "why": "Force push rewrites shared history."
    },
    {
      "id": "push-main",
      "re": "\\bgit\\b.*\\spush\\b.*\\s(\\S+:)?(refs/heads/)?(main|master|develop)(\\s|$)",
      "why": "Push to a protected branch."
    },
    {
      "id": "git-discard",
      "re": "\\bgit\\b(\\s+-[cC]\\s+\\S+)*\\s+(reset\\s+--hard\\b|clean\\s+-\\w*f|checkout\\s+(\\S+\\s+)?--(\\s|$)|checkout\\s+\\.(\\s|$)|restore\\b(?!\\s+--staged\\b)|stash\\b(?!\\s+(list|show)\\b))",
      "why": "This git command discards uncommitted work, which in a shared checkout may belong to another session.",
      "where": "shared"
    },
    {
      "id": "git-switch",
      "re": "\\bgit\\b(\\s+-[cC]\\s+\\S+)*\\s+(switch\\b|checkout\\s+(-[bB]\\s+)?[^\\s-]\\S*\\s*$)",
      "why": "Switching branches or checking out files moves the shared working tree; use a separate worktree.",
      "where": "shared"
    },
    {
      "id": "add-all",
      "re": "\\bgit\\b(\\s+-[cC]\\s+\\S+)*\\s+add\\s+(\\.|-A|--all)(\\s|$)",
      "why": "Stage exact paths; 'git add .' picks up other sessions' files."
    },
    {
      "id": "git-config-global",
      "re": "\\bgit\\b.*\\sconfig\\s+--global\\b",
      "why": "Global git config affects every repository on this machine."
    },
    {
      "id": "p4-destructive",
      "re": "\\bp4\\s+(obliterate|revert|delete)\\b",
      "why": "Destructive Perforce command."
    }
  ],
  "delete_safe_roots": [
    "{TEMP}",
    "{LOCALAPPDATA}/Temp"
  ],
  "secret_regex": [
    "AKIA[0-9A-Z]{16}",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "ghp_[A-Za-z0-9]{36}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "xox[abprs]-[A-Za-z0-9-]{10,}",
    "sk-ant-[A-Za-z0-9_-]{20,}"
  ],
  "test_paths": [
    "*Test*.cpp",
    "*Tests*.cpp",
    "*Spec.cpp",
    "*/Tests/*",
    "test_*.py",
    "*_test.py",
    "*.test.ts",
    "*.spec.ts"
  ],
  "assert_regex": "\\b(assert\\w*|EXPECT_\\w+|ASSERT_\\w+|Test(True|False|Equal|NotEqual|Null|NotNull|Valid|Invalid)|expect)\\s*\\(",
  "verify_regex": "(?i)(\\bpytest\\b|-m\\s+(pytest|unittest)\\b|\\bnpm\\s+(run\\s+)?test\\b|\\bctest\\b|\\bdotnet\\s+test\\b|Build\\.(bat|sh|cmd)\\b|\\bRunUAT\\b|\\bUnrealBuildTool\\b|UnrealEditor-Cmd[^\\n]*Automation|Automation\\s+RunTests|\\bmsbuild\\b|validate_repository\\.py|\\bnode\\s+--test\\b|\\bgo\\s+test\\b|\\bcargo\\s+test\\b)",
  "forbidden_added": [
    "A5TMP",
    "debugger;",
    "breakpoint\\(\\)",
    "pdb\\.set_trace",
    "console\\.log\\("
  ],
  "todo_regex": "\\b(TODO|FIXME|HACK|XXX)\\b",
  "report_sections": [
    "Changed",
    "Verified",
    "Risk",
    "Open"
  ],
  "gate_ignore": [
    "docs/intent/*"
  ],
  "no_verify_needed": [
    "*.md",
    "*.txt",
    "*.rst",
    "docs/*"
  ],
  "max_gate_blocks": 3
}
