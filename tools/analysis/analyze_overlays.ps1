param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..\recovery\code\ghidra'),
    [string]$InputRoot = (Join-Path $PSScriptRoot '..\..\recovery\disc\PRO'),
    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\recovery\code\overlays')
)

$ErrorActionPreference = 'Stop'
$workspace = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$InputRoot = [IO.Path]::GetFullPath($InputRoot)
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$env:JAVA_HOME = mise where java
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$headless = Get-ChildItem (Join-Path $workspace 'tools\vendor\ghidra') -Recurse -Filter analyzeHeadless.bat |
    Select-Object -First 1 -ExpandProperty FullName
$scripts = Join-Path $workspace 'tools\ghidra_scripts'
$log = Join-Path $workspace 'recovery\code\ghidra-overlays.log'
# オーバーレイ読込み先は実行ファイルのポインタ 0x800a7b24 が指す 0x801d06f8

[IO.Directory]::CreateDirectory($ProjectRoot) | Out-Null
[IO.Directory]::CreateDirectory($OutputRoot) | Out-Null

& $headless $ProjectRoot ShinThemeParkOverlays801d06f8 `
    -import $InputRoot `
    -recursive `
    -processor MIPS:LE:32:default `
    -cspec default `
    -loader BinaryLoader `
    -loader-baseAddr 0x801d06f8 `
    -overwrite `
    -analysisTimeoutPerFile 300 `
    -scriptPath $scripts `
    -postScript ExportRecovery.java $OutputRoot per-program `
    -log $log

if ($LASTEXITCODE -ne 0) {
    throw "Ghidra overlay analysis failed with exit code $LASTEXITCODE"
}
