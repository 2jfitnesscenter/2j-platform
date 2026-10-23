param(
  [Parameter(Mandatory = $true)][switch]$PrepareOnly,
  [string]$OutputRoot = (Join-Path $env:USERPROFILE 'Dev\2J\temp\2j-admin-pilot-releases')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repoRoot

$approvedTempRoot = (Resolve-Path (Join-Path $env:USERPROFILE 'Dev\2J\temp') -ErrorAction SilentlyContinue)
if (-not $approvedTempRoot) { $approvedTempRoot = (New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE 'Dev\2J\temp')).FullName }
$resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$approvedPrefix = $approvedTempRoot.Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutputRoot.StartsWith($approvedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputRoot must stay under $($approvedTempRoot.Path); project artifacts may not be written to Desktop."
}

if (-not $PrepareOnly) { throw 'Only PrepareOnly is available. Remote deployment is disabled.' }
$branch = (& git branch --show-current).Trim()
$commit = (& git rev-parse HEAD).Trim()
$tree = (& git rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') { throw 'Could not identify the release commit and tree.' }
$dirty = @(& git status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw 'PrepareOnly requires a clean committed working tree.' }
$trackedPaths = @(& git ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect tracked release paths.' }
$unsafeTracked = @($trackedPaths | Where-Object { $_ -match '(^|/)(\.env(?:\..*)?|data|backups|.*\.(?:pem|key|p12|pfx))($|/)' })
if ($unsafeTracked.Count -gt 0) { throw "Tracked secret or local-data path prevents release preparation: $($unsafeTracked -join ', ')" }

Write-Host "PREPARE_ONLY=yes"
Write-Host "BRANCH=$branch"
Write-Host "COMMIT=$commit"
Write-Host "TREE=$tree"
Write-Host 'NETWORK=disabled'
Write-Host 'DATABASE=migrations-not-run'
Write-Host 'PUBLIC_EXPOSURE=disabled'

try {
  # The Windows checkout may materialize generated CSS as CRLF. Normalize only during build;
  # restore the clean committed bytes in finally so this script never leaves source edits behind.
  $tokenCssPath = 'packages/design-tokens/src/tokens.css'
  & node packages/design-tokens/tooling/generate-css.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Could not normalize generated design tokens for this build.' }
  & pnpm exec turbo run typecheck --force
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
  & pnpm build --force
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  & node --test tooling/deploy/admin-release-manifest.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Release manifest tests failed.' }

  $releaseRoot = Join-Path $resolvedOutputRoot $commit
  if (Test-Path -LiteralPath $releaseRoot) { throw "Release output already exists: $releaseRoot" }
  New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
  try {
    $sourcePath = Join-Path $releaseRoot 'source.tar'
    & git archive --format=tar --output=$sourcePath $commit
    if ($LASTEXITCODE -ne 0) { throw 'Could not archive the committed source.' }
    foreach ($package in @('apps\admin-web', 'apps\api', 'packages\auth', 'packages\domain', 'packages\permissions')) {
      $dist = Join-Path $repoRoot "$package\dist"
      if (-not (Test-Path -LiteralPath $dist -PathType Container)) { throw "Build output missing: $dist" }
      $destination = Join-Path $releaseRoot $package
      New-Item -ItemType Directory -Force -Path $destination | Out-Null
      Copy-Item -LiteralPath $dist -Destination $destination -Recurse
    }
    & node (Join-Path $PSScriptRoot 'write-admin-release-manifest.mjs') $releaseRoot $commit $tree
    if ($LASTEXITCODE -ne 0) { throw 'Release manifest generation failed.' }
    $archive = "$releaseRoot.zip"
    Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath $archive -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "ARTIFACT=$archive"
    Write-Host "SHA256=$hash"
    Write-Host 'DEPLOYED=no'
  } catch {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
} finally {
  & git restore --source=$commit --worktree -- $tokenCssPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not restore generated token CSS after PrepareOnly.' }
}
