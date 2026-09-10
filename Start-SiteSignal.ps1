param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Instala Node.js 24 o superior y abre una terminal nueva.'
}
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'SiteSignal requiere Node.js 24 o superior.' }
if ($NoBrowser) { & node src/start.js; exit $LASTEXITCODE }
& node src/launcher.js
exit $LASTEXITCODE
