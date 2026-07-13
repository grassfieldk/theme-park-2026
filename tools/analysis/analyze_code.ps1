param(
    [string]$Executable = (Join-Path $PSScriptRoot '..\..\recovery\disc\SLPS_008.10')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:JAVA_HOME = mise where java
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$headless = Get-ChildItem "$root\tools\vendor\ghidra" -Recurse -Filter analyzeHeadless.bat |
    Select-Object -First 1 -ExpandProperty FullName
$scripts = "$root\tools\ghidra_scripts"
$projectRoot = "$root\recovery\code\ghidra-psx"
$output = "$root\recovery\code\main-psyq"
[IO.Directory]::CreateDirectory($projectRoot) | Out-Null
[IO.Directory]::CreateDirectory($output) | Out-Null

& $headless $projectRoot ShinThemeParkRecovered `
    -import ([IO.Path]::GetFullPath($Executable)) `
    -overwrite `
    -analysisTimeoutPerFile 300 `
    -scriptPath $scripts `
    -postScript ExportRecovery.java $output `
    -log "$root\recovery\evidence\ghidra-psx-recovery.log"
if ($LASTEXITCODE -ne 0) {
    throw "Ghidra executable analysis failed with exit code $LASTEXITCODE"
}

& "$root\tools\analysis\analyze_overlays.ps1"
python "$root\tools\analysis\summarize_code.py" $output "$root\recovery\code\overlays" "$root\recovery\manifests\code-summary.json"
