param(
    [string]$DiscPath = (Join-Path $PSScriptRoot '..\original\Shin Theme Park (Japan) (Rev 1) (Track 01).bin'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\extracted\raw')
)

$ErrorActionPreference = 'Stop'
$sectorSize = 2352
$userDataOffset = 24
$userDataSize = 2048
$disc = [IO.File]::OpenRead((Resolve-Path $DiscPath))

function Read-UserSector([uint32]$Lba) {
    $buffer = [byte[]]::new($userDataSize)
    [void]$disc.Seek(($Lba * $sectorSize) + $userDataOffset, [IO.SeekOrigin]::Begin)
    [void]$disc.Read($buffer, 0, $buffer.Length)
    return ,$buffer
}

function Read-DiscFile([uint32]$Extent, [uint32]$Size, [string]$Destination) {
    $parent = Split-Path $Destination -Parent
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $output = [IO.File]::Create($Destination)
    try {
        $remaining = $Size
        $lba = $Extent
        while ($remaining -gt 0) {
            $sector = Read-UserSector $lba
            $count = [Math]::Min($remaining, $userDataSize)
            $output.Write($sector, 0, $count)
            $remaining -= $count
            $lba++
        }
    }
    finally {
        $output.Dispose()
    }
}

function Export-Directory([uint32]$Extent, [uint32]$Size, [string]$RelativePath) {
    $remaining = $Size
    $lba = $Extent
    while ($remaining -gt 0) {
        $sector = Read-UserSector $lba
        $position = 0
        while ($position -lt $userDataSize -and $sector[$position] -ne 0) {
            $recordLength = $sector[$position]
            $entryExtent = [BitConverter]::ToUInt32($sector, $position + 2)
            $entrySize = [BitConverter]::ToUInt32($sector, $position + 10)
            $flags = $sector[$position + 25]
            $nameLength = $sector[$position + 32]
            $special = $nameLength -eq 1 -and $sector[$position + 33] -le 1
            if (-not $special) {
                $name = [Text.Encoding]::ASCII.GetString($sector, $position + 33, $nameLength) -replace ';1$', ''
                $entryPath = Join-Path $RelativePath $name
                if ($flags -band 2) {
                    Export-Directory $entryExtent $entrySize $entryPath
                }
                else {
                    Read-DiscFile $entryExtent $entrySize (Join-Path $OutputPath $entryPath)
                }
            }
            $position += $recordLength
        }
        $remaining -= $userDataSize
        $lba++
    }
}

try {
    [IO.Directory]::CreateDirectory($OutputPath) | Out-Null
    Export-Directory 1644 2048 'TEX'
}
finally {
    $disc.Dispose()
}
