# A5R sync merge (A142, rev 46). A5R writes this file, with the param block above it, to Saved/A5R/<sync id>-merge.ps1
# before the sync worker starts; the worker starts it detached with one command and waits for it. It merges $Target into
# the shared checkout's branch the way sync-main proved by hand three times, never through `git merge`:
#   1. git merge-tree --write-tree for the content merges; each path decided by itself with rename detection off (A145:
#      git read-tree -m --aggressive in a temporary index); conflicts of any kind resolved by the holder's rules (and
#      rule 11) there; write-tree.
#   2. git commit-tree <tree> -p HEAD -p <target>.
#   3. The working tree written only for the paths the merge changes (git read-tree -m -u HEAD <new> on a copy of the
#      index: git's own checkout, with LFS smudge, that refuses a dirty or untracked-in-the-way path before writing).
#   4. git update-ref <branch> <new> <old>.
#   5. The new index installed by renaming .git/index.lock over .git/index, retried while Windows refuses the rename.
# MEASURED 2026-11-04, 11-06, 11-08: `git merge` wrote ~2k files and then died with "unable to write .git/index" (the
# rename refused while other processes had .git/index open), leaving HEAD and the index old and the tree half-merged.
# Here nothing is written before every check passed, and a failure after the first write puts the ref and the tree back.
# Never: reset --hard, checkout ., clean, GIT_LFS_SKIP_SMUDGE. Every step is logged to $Log; the last line is the result.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$enc = New-Object System.Text.UTF8Encoding($false)
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
foreach ($name in 'GIT_INDEX_FILE', 'GIT_LFS_SKIP_SMUDGE', 'GIT_DIR', 'GIT_WORK_TREE') { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }

function Write-Log([string]$Text) {
  [IO.File]::AppendAllText($Log, (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff') + ' rule=sync-merge ' + $Text + "`r`n", $enc)
}

# One argument as the Windows C runtime reads it back (quotes and the backslashes before them escaped).
function ConvertTo-Arg([string]$Arg) {
  if ($Arg -ne '' -and $Arg -notmatch '[\s"]') { return $Arg }
  return '"' + (($Arg -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

$gitExe = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
# git in the checkout: UTF-8 in and out, stdin as bytes, GIT_INDEX_FILE only when $Index is given.
function Invoke-Git([string[]]$GitArgs, [string]$Index = '', [byte[]]$InputBytes = $null) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $gitExe
  $psi.Arguments = (@('-C', $Checkout) + $GitArgs | ForEach-Object { ConvertTo-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $enc
  $psi.StandardErrorEncoding = $enc
  if ($Index) { $psi.EnvironmentVariables['GIT_INDEX_FILE'] = $Index }
  $p = [Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if ($InputBytes) { $p.StandardInput.BaseStream.Write($InputBytes, 0, $InputBytes.Length) }
  $p.StandardInput.Close()
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Out = $out.Result; Err = $err.Result.Trim() }
}
function Invoke-GitOk([string[]]$GitArgs, [string]$Index = '', [byte[]]$InputBytes = $null) {
  $r = Invoke-Git $GitArgs $Index $InputBytes
  if ($r.Code -ne 0) { throw ('git ' + ($GitArgs -join ' ') + ' exited ' + $r.Code + ': ' + $r.Err) }
  return $r
}
function Split-Nul([string]$Text) { return @($Text.Split([char]0) | Where-Object { $_ -ne '' }) }
# `<mode> <oid> <stage>TAB<path>` entries (merge-tree's conflicted file info, ls-files -u) as path -> stage -> @{ Mode; Oid }.
function Read-Stages([string[]]$Entries) {
  $by = @{}
  foreach ($e in $Entries) {
    $tab = $e.IndexOf("`t")
    $f = $e.Substring(0, $tab).Split(' ')
    $p = $e.Substring($tab + 1)
    if (-not $by.ContainsKey($p)) { $by[$p] = @{} }
    $by[$p][$f[2]] = @{ Mode = $f[0]; Oid = $f[1] }
  }
  return $by
}
# diff-tree -r -z --no-renames --raw between two commits or trees: one object per changed path.
function Get-RawDiff([string]$From, [string]$To) {
  $raw = (Invoke-GitOk @('diff-tree', '-r', '-z', '--no-renames', '--raw', $From, $To)).Out.Split([char]0)
  $list = New-Object System.Collections.ArrayList
  for ($k = 0; $k + 1 -lt $raw.Length; $k += 2) {
    if (-not $raw[$k].StartsWith(':')) { break }
    $f = $raw[$k].Substring(1).Split(' ')
    [void]$list.Add([pscustomobject]@{ OldMode = $f[0]; NewMode = $f[1]; OldOid = $f[2]; NewOid = $f[3]; Status = $f[4].Substring(0, 1); Path = $raw[$k + 1] })
  }
  return @($list)
}
# A repo path (forward slashes) as a full Windows path under the checkout.
function Get-Full([string]$Path) { return Join-Path $Checkout $Path.Replace('/', [IO.Path]::DirectorySeparatorChar) }

# Tries $Try until it returns true or $Seconds pass, waiting 50 ms doubling to $CapMs (2 s unless given) between tries,
# with up to half again of jitter (Fable 7: the rename's 500 ms cap keeps many panel readers from meeting every try).
function Wait-Until([scriptblock]$Try, [int]$Seconds, [int]$CapMs = 2000) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $delay = 50
  while ($true) {
    if (& $Try) { return $true }
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Milliseconds ($delay + (Get-Random -Maximum ([Math]::Max(1, [int]($delay / 2)))))
    $delay = [Math]::Min($delay * 2, $CapMs)
  }
}

# The git processes on the machine, with their command lines (a refused rename means one of them had .git/index open).
# The holder's A5R copies the refusal and these process names into orchestrate.log when the worker ends.
function Write-GitProcesses {
  try {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='git.exe' OR Name='git-lfs.exe' OR Name='git-remote-https.exe'")
    Write-Log ("git processes: " + $procs.Count)
    foreach ($p in $procs) { Write-Log ('process pid=' + $p.ProcessId + ' parent=' + $p.ParentProcessId + ' name=' + $p.Name + ' cmd=' + $p.CommandLine) }
  } catch {
    Write-Log ('git processes unread: ' + $_)
  }
}

$state = @{ Lock = $false; Copied = $false; Tree = $false; Ref = $false }
$markerHash = ''
$refusal = $null
$tmp = $null
$changes = @()
$newDirs = @()

function Stop-Merge([string]$Kind, [string]$Why, [string[]]$Paths = @()) {
  $script:refusal = @{ Kind = $Kind; Why = $Why; Paths = $Paths }
  throw "A5R merge refused: $Kind"
}

# Puts back the paths the merge changed that hold the new content (or are missing), from the pre-merge index copy; removes
# an added path only when it holds the new content; a path holding neither side's content is someone else's, kept.
function Restore-Tree {
  $files = @($changes | Where-Object { $_.NewMode -ne '160000' -and $_.OldMode -ne '160000' })
  $here = @($files | Where-Object { Test-Path -LiteralPath (Get-Full $_.Path) -PathType Leaf })
  $now = @{}
  if ($here.Count -gt 0) {
    $hashed = Invoke-GitOk @('hash-object', '--stdin-paths') '' ($enc.GetBytes((($here | ForEach-Object { $_.Path }) -join "`n") + "`n"))
    $oids = @($hashed.Out.Split("`n") | Where-Object { $_ -ne '' })
    for ($k = 0; $k -lt $here.Count; $k++) { $now[$here[$k].Path] = $oids[$k].Trim() }
  }
  $restore = New-Object System.Collections.Generic.List[string]
  $remove = New-Object System.Collections.Generic.List[string]
  foreach ($c in $files) {
    $cur = $now[$c.Path]
    if ($null -eq $cur) { if ($c.Status -ne 'A') { $restore.Add($c.Path) } }
    elseif ($cur -eq $c.NewOid -and $c.Status -ne 'D') { if ($c.Status -eq 'A') { $remove.Add($c.Path) } else { $restore.Add($c.Path) } }
    elseif ($cur -ne $c.OldOid) { Write-Log ('rollback kept ' + $c.Path + ': it holds neither side''s content (someone else''s edit)') }
  }
  if ($restore.Count -gt 0) { Invoke-GitOk @('checkout-index', '-f', '-q', '-z', '--stdin') $T0 ($enc.GetBytes(($restore -join [char]0) + [char]0)) | Out-Null }
  foreach ($p in $remove) { [IO.File]::Delete((Get-Full $p)) }
  foreach ($d in ($newDirs | Sort-Object Length -Descending)) {
    if ((Test-Path -LiteralPath $d -PathType Container) -and @(Get-ChildItem -LiteralPath $d -Force).Count -eq 0) { [IO.Directory]::Delete($d) }
  }
  Write-Log ('rollback: tree restored (' + $restore.Count + ' put back from the pre-merge index, ' + $remove.Count + ' added files removed)')
}

# Undoes what was written, newest first; returns what could not be undone ('' when all was).
function Undo-Merge {
  $left = @()
  if ($state.Ref) {
    $back = Wait-Until { (Invoke-Git @('update-ref', '-m', "A5R sync merge $SyncId rolled back", $branch, $old, $new)).Code -eq 0 } 30
    if ($back) { $state.Ref = $false; Write-Log "rollback: $branch back to $old" } else { $left += "$branch still at $new (git update-ref $branch $old $new)" }
  }
  if ($state.Tree) {
    try { Restore-Tree; $state.Tree = $false } catch { $left += ('the working tree (' + $_ + ')') }
  }
  if ($state.Lock) {
    try {
      $now = $(if (Test-Path -LiteralPath $lock) { (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash } else { '' })
      if ($now -eq '') { Write-Log 'rollback: .git/index.lock is gone already' }
      elseif ($now -eq $markerHash -or ($state.Copied -and $now -eq (Get-FileHash -LiteralPath $T -Algorithm SHA256).Hash)) { [IO.File]::Delete($lock); Write-Log 'rollback: .git/index.lock (ours) removed' }
      else { $left += '.git/index.lock is no longer the one this script took: left as it is' }
      $state.Lock = $false
    } catch { $left += ('.git/index.lock, ours (' + $_ + ')') }
  }
  return ($left -join '; ')
}

function Exit-Merge([string]$Line, [int]$Code) {
  Write-Log $Line
  if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  exit $Code
}

try {
  [IO.File]::WriteAllText($Log, '', $enc)
  Add-Type -Namespace A5RSyncMerge -Name Native -MemberDefinition '[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool MoveFileEx(string from, string to, int flags);'
  Write-Log ("start: checkout $Checkout, target $Target, sync $SyncId, pid $PID, " + (Invoke-Git @('version')).Out.Trim())
  $gitDir = (Invoke-GitOk @('rev-parse', '--absolute-git-dir')).Out.Trim()
  foreach ($h in 'MERGE_HEAD', 'REVERT_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply') {
    if (Test-Path -LiteralPath (Join-Path $gitDir $h)) { Stop-Merge 'busy' ".git/$h exists: another git operation is in progress" }
  }
  # The script copies .git/index alone: with a split index that copy would point at a shared index it does not carry.
  if ((Invoke-Git @('config', '--bool', 'core.splitIndex')).Out.Trim() -eq 'true' -or @(Get-ChildItem -LiteralPath $gitDir -Filter 'sharedindex.*' -File -ErrorAction SilentlyContinue).Count -gt 0) {
    Stop-Merge 'split-index' 'the checkout uses a split index (core.splitIndex is on or .git/sharedindex.* exists); this script copies .git/index alone and could install a wrong index, so it writes nothing: merge by hand, or turn the split index off first (git update-index --no-split-index, with git config core.splitIndex false)'
  }
  $branch = (Invoke-Git @('symbolic-ref', '-q', 'HEAD')).Out.Trim()
  if (-not $branch.StartsWith('refs/heads/')) { Stop-Merge 'busy' 'HEAD is not on a branch' }
  $old = (Invoke-GitOk @('rev-parse', '--verify', 'HEAD^{commit}')).Out.Trim()
  $theirs = (Invoke-GitOk @('rev-parse', '--verify', ($Target + '^{commit}'))).Out.Trim()
  if ((Invoke-Git @('merge-base', '--is-ancestor', $theirs, $old)).Code -eq 0) { Exit-Merge "A5R merge up-to-date $old ($Target $theirs is already in HEAD; nothing written)" 0 }
  Write-Log "HEAD $old on $branch; $Target $theirs"

  # 1. The merge as a tree, with rename detection off and its conflicts resolved in a temporary index. A145 (rev 47):
  # MEASURED 2026-11-09 on git 2.45.1, merge-tree (and git merge) accept `-X no-renames` and `-c merge.renames=false` and
  # still pair a path deleted on both sides with an unrelated new file of main ("CONFLICT (rename/delete)"), and still
  # carry an edit across a rename. So each path is decided by itself: git read-tree -m --aggressive (merge base, HEAD,
  # target) never pairs two paths; merge-tree only merges the content of a path both sides changed. `-X no-renames` is
  # passed too, for a git that honours it.
  $mt = Invoke-Git @('merge-tree', '--write-tree', '-z', '-X', 'no-renames', $old, $theirs)
  if ($mt.Code -gt 1) { Stop-Merge 'error' ('git merge-tree exited ' + $mt.Code + ': ' + $mt.Err) }
  $tok = $mt.Out.Split([char]0)
  $tree = $tok[0]
  $zero = '0' * $tree.Length
  $i = 1
  while ($i -lt $tok.Length -and $tok[$i] -ne '') { $i++ }
  $stages = Read-Stages $(if ($i -gt 1) { $tok[1..($i - 1)] } else { @() })
  $i++
  $types = @{}
  while ($i -lt $tok.Length -and $tok[$i] -match '^\d+$') {
    $n = [int]$tok[$i]
    $kind = $tok[$i + $n + 1]
    for ($j = 1; $j -le $n; $j++) { $types[$tok[$i + $j]] = @($types[$tok[$i + $j]]) + $kind }
    $i += $n + 3
  }
  $resolved = @()
  $tmp = Join-Path $gitDir "a5r-merge-$SyncId"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $M = Join-Path $tmp 'merge.index'
  # A conflict: path -> @{ Kind (merge-tree's words, or the path's own); Stages (1 base, 2 HEAD, 3 target; a side without
  # the path has no stage) }. Every kind is resolved the same way: by a rule, else by rule 11, else refused.
  $conflicts = @{}
  $lines = @()
  $bases = @(Split-Nul ((Invoke-Git @('merge-base', '--all', $old, $theirs)).Out -replace '\s+', [char]0))
  $kindOf = { param($p) @($types[$p] | Where-Object { $_ -and $_ -ne 'Auto-merging' }) -join ', ' }
  if ($bases.Count -eq 1) {
    Invoke-GitOk @('read-tree', '-m', '--aggressive', '-i', $bases[0], $old, $theirs) $M | Out-Null
    $ortNew = @{}
    foreach ($c in (Get-RawDiff $old $tree)) { $ortNew[$c.Path] = @{ Mode = $c.NewMode; Oid = $c.NewOid; Status = $c.Status } }
    $unmerged = Read-Stages (Split-Nul (Invoke-GitOk @('ls-files', '-u', '-z') $M).Out)
    foreach ($p in $unmerged.Keys) {
      $s = $unmerged[$p]
      $kind = & $kindOf $p
      $isBoth = $s.ContainsKey('2') -and $s.ContainsKey('3')
      # Both sides changed the path: merge-tree's content merge stands when it merged it cleanly and paired it with nothing.
      $e = $(if ($ortNew.ContainsKey($p)) { $ortNew[$p] } else { $s['2'] })
      if ($isBoth -and -not $stages.ContainsKey($p) -and -not $kind -and $e.Status -ne 'D') { $lines += "0 $zero`t$p", "$($e.Mode) $($e.Oid) 0`t$p"; continue }
      $conflicts[$p] = @{ Kind = $(if ($kind) { $kind } elseif ($isBoth) { 'CONFLICT (contents)' } else { 'CONFLICT (modify/delete)' }); Stages = $s }
    }
    foreach ($p in ($stages.Keys | Where-Object { -not $unmerged.ContainsKey($_) } | Sort-Object)) { Write-Log "renames off: $p is no conflict path by path (merge-tree said: $(& $kindOf $p))" }
  } else {
    # Several merge bases (or none): read-tree takes one, so merge-tree's own tree stands, its pairings too.
    Write-Log "renames on: $($bases.Count) merge bases, so merge-tree's own tree stands"
    Invoke-GitOk @('read-tree', $tree) $M | Out-Null
    foreach ($p in $stages.Keys) { $conflicts[$p] = @{ Kind = $(& $kindOf $p); Stages = $stages[$p] } }
  }
  $unresolved = @()
  foreach ($p in ($conflicts.Keys | Sort-Object)) {
    $c = $conflicts[$p]
    $side = $null
    $why = ''
    foreach ($r in $Rules) { if ([regex]::IsMatch($p, $r.Re, 'IgnoreCase')) { $side = $r.Side; $why = "rule: $($r.Side) $($r.Pattern)"; break } }
    # Rule 11: main holds a blob of this branch's own history for the path (a self-conflict): ours. Text files only.
    if (-not $side -and $p -notmatch '\.(uasset|umap)$' -and $c.Stages.ContainsKey('3')) {
      $hist = (Invoke-Git @('log', '--format=', '--raw', '--no-abbrev', $old, '--', $p)).Out
      if ($hist.Contains(' ' + $c.Stages['3'].Oid + ' ')) { $side = 'ours'; $why = 'rule 11: main holds our own blob' }
    }
    $kind = $c.Kind -replace 'CONFLICT \(([^)]*)\)', '$1'
    if (-not $side) { $unresolved += "$p (no rule matches: $kind)"; continue }
    # theirs: main's side (a path main deleted stays deleted); ours: HEAD's.
    $e = $c.Stages[$(if ($side -eq 'ours') { '2' } else { '3' })]
    $lines += "0 $zero`t$p"
    if ($e) { $lines += "$($e.Mode) $($e.Oid) 0`t$p" }
    $resolved += "$p ($side, $why)"
  }
  if ($unresolved.Count -gt 0) { Stop-Merge 'conflict' "$($unresolved.Count) conflicted path(s) that no rule resolves (nothing written)" $unresolved }
  if ($lines.Count -gt 0) { Invoke-GitOk @('update-index', '--index-info') $M ($enc.GetBytes(($lines -join "`n") + "`n")) | Out-Null }
  $merged = (Invoke-GitOk @('write-tree') $M).Out.Trim()
  foreach ($x in $resolved) { Write-Log "resolved $x" }
  if ($merged -ne $tree) { Write-Log "renames off: the tree differs from merge-tree's $tree on $(@(Get-RawDiff $tree $merged).Count) path(s)" }
  $changes = @(Get-RawDiff $old $merged)
  Write-Log "merge tree ${merged}: $($changes.Count) path(s) change, $($conflicts.Count) conflicted, $($resolved.Count) resolved"

  # The index lock, held from here to the install: no other git writes the index meanwhile.
  $index = Join-Path $gitDir 'index'
  $lock = "$index.lock"
  $marker = "A5R sync merge $SyncId pid $PID"
  $taken = Wait-Until {
    try {
      $fs = [IO.File]::Open($lock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $bytes = $enc.GetBytes($marker)
      $fs.Write($bytes, 0, $bytes.Length)
      $fs.Close()
      return $true
    } catch [IO.IOException] { return $false }
  } $LockWaitSec
  if (-not $taken) { Stop-Merge 'busy' ".git/index.lock stood for $LockWaitSec s: another git works in the checkout (nothing written)" }
  $state.Lock = $true
  $markerHash = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
  $T0 = Join-Path $tmp 'before.index'
  $T = Join-Path $tmp 'after.index'
  [IO.File]::Copy($index, $T0, $true)
  [IO.File]::Copy($index, $T, $true)
  # Stat-only changes are no dirt: the copy is refreshed (the shared index is not written).
  Invoke-Git @('update-index', '-q', '--refresh') $T | Out-Null
  $modified = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($p in (Split-Nul (Invoke-GitOk @('diff-index', '-z', '--name-only', '--ignore-submodules', $old) $T).Out)) { [void]$modified.Add($p) }
  $blocked = @()
  foreach ($c in $changes) {
    if ($modified.Contains($c.Path)) { $blocked += "$($c.Path) (changed in the shared checkout)" }
    elseif ($c.Status -eq 'A' -and (Test-Path -LiteralPath (Get-Full $c.Path))) { $blocked += "$($c.Path) (untracked, in the way of the file the merge adds)" }
  }
  if ($blocked.Count -gt 0) { Stop-Merge 'dirty' "$($blocked.Count) path(s) the merge changes are dirty or in the way (nothing written)" $blocked }

  # 2. The merge commit (an object only).
  $name = $branch.Substring('refs/heads/'.Length)
  $new = (Invoke-GitOk @('commit-tree', $merged, '-p', $old, '-p', $theirs, '-m', "Merge remote-tracking branch '$Target' into $name", '-m', "A5R sync $SyncId")).Out.Trim()
  Write-Log "merge commit $new"

  # 3. The working tree, only the paths the merge changes (folders it creates are noted for a rollback).
  foreach ($c in ($changes | Where-Object { $_.Status -eq 'A' })) {
    $d = Split-Path -Parent (Get-Full $c.Path)
    while ($d -and $d.Length -gt $Checkout.Length -and -not (Test-Path -LiteralPath $d)) { $newDirs += $d; $d = Split-Path -Parent $d }
  }
  $newDirs = @($newDirs | Select-Object -Unique)
  $state.Tree = $true
  $rt = Invoke-Git @('read-tree', '-m', '-u', $old, $new) $T
  if ($rt.Code -ne 0) { Stop-Merge 'tree' ('git read-tree -m -u refused or failed: ' + $rt.Err) }
  Write-Log "working tree written: $($changes.Count) path(s)"

  # 4. The branch, only from the old value.
  $moved = Wait-Until { (Invoke-Git @('update-ref', '-m', "A5R sync merge $SyncId", $branch, $new, $old)).Code -eq 0 -or (Invoke-Git @('rev-parse', '--verify', $branch)).Out.Trim() -ne $old } 30
  $at = (Invoke-Git @('rev-parse', '--verify', $branch)).Out.Trim()
  if (-not $moved -or $at -ne $new) { Stop-Merge 'ref' "$branch did not move from $old to $new (it reads $at)" }
  $state.Ref = $true
  Write-Log "$branch moved $old -> $new"

  # 5. The new index: written into our lock, then the lock renamed over .git/index, retried while Windows refuses it.
  if ([IO.File]::ReadAllText($lock, $enc) -ne $marker) { Stop-Merge 'index' '.git/index.lock is no longer the one this script took' }
  [IO.File]::Copy($T, $lock, $true)
  $state.Copied = $true
  $tries = 0
  $lastError = 0
  $installed = Wait-Until {
    $script:tries++
    if ([A5RSyncMerge.Native]::MoveFileEx($lock, $index, 0x1 -bor 0x8)) { return $true }
    $script:lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($script:tries -eq 1 -or $script:tries % 10 -eq 0) { Write-Log "index rename refused (try $script:tries, Windows error $script:lastError); retrying" }
    return $false
  } $RenameWaitSec 500
  if (-not $installed) { Stop-Merge 'index' "the rename of .git/index.lock over .git/index was refused for $RenameWaitSec s ($tries tries, last Windows error $lastError)" }
  $state.Lock = $false
  $state.Tree = $false
  $state.Ref = $false
  Write-Log "index installed after $tries try(s)"
  Exit-Merge ("A5R merge merged $new ($($changes.Count) path(s) written" + $(if ($resolved.Count) { '; resolved: ' + ($resolved -join '; ') } else { '' }) + ')') 0
} catch {
  $r = $refusal
  if ($null -eq $r) { $r = @{ Kind = 'error'; Why = ([string]$_ + ' (script line ' + $_.InvocationInfo.ScriptLineNumber + ')'); Paths = @() } }
  foreach ($p in $r.Paths) { Write-Log ($r.Kind + ': ' + $p) }
  Write-GitProcesses
  $left = Undo-Merge
  $tail = $(if ($left) { "; ROLLBACK INCOMPLETE: $left" } else { '; HEAD, index and working tree are as before' })
  $code = 1 # the result is the log's last line, never the exit code
  $shown = $(if ($r.Paths.Count) { ' [' + (($r.Paths | Select-Object -First 20) -join '; ') + $(if ($r.Paths.Count -gt 20) { "; +$($r.Paths.Count - 20) more in the log" } else { '' }) + ']' } else { '' })
  Exit-Merge ("A5R merge refused $($r.Kind): $($r.Why)$shown$tail") $code
}
