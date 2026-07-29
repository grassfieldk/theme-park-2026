param(
    [string]$Disc = (Join-Path $PSScriptRoot '..\original\Shin Theme Park (Japan) (Rev 1) (Track 01).bin'),
    [string]$Cue = (Join-Path $PSScriptRoot '..\original\Shin Theme Park (Japan) (Rev 1).cue')
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$recovery = Join-Path $root 'recovery'
$tables = Join-Path $root 'tables'

python (Join-Path $PSScriptRoot 'disc\extract_iso9660.py') $Disc "$recovery\disc" "$recovery\manifests\disc-files.json"
python (Join-Path $PSScriptRoot 'disc\map_audio_tracks.py') $Cue "$recovery\manifests\disc-files.json" "$recovery\manifests\audio-tracks.json"
python (Join-Path $PSScriptRoot 'disc\convert_audio_tracks.py') "$recovery\manifests\audio-tracks.json" "$recovery\assets\audio" "$recovery\manifests\converted-audio.json"
python (Join-Path $PSScriptRoot 'convert-textures.py') "$recovery\disc" "$recovery\assets\images" --recursive
python (Join-Path $PSScriptRoot 'analysis\image_manifest.py') "$recovery\assets\images" "$recovery\manifests\images.json"
python (Join-Path $PSScriptRoot 'analysis\parse_tmd.py') "$recovery\disc" "$recovery\assets\models" "$recovery\manifests\tmd-models.json"
python (Join-Path $PSScriptRoot 'analysis\export_tmd_obj.py') "$recovery\assets\models" "$recovery\assets\models-obj"
python (Join-Path $PSScriptRoot 'analysis\split_sound_stm.py') "$recovery\disc\TEX\SOUND.STM" "$recovery\assets\sound-bank" "$recovery\manifests\sound-stm.json"
python (Join-Path $PSScriptRoot 'analysis\decode_vab_samples.py') "$recovery\assets\sound-bank" "$recovery\assets\sound-effects" "$recovery\manifests\vab-samples.json"
python (Join-Path $PSScriptRoot 'analysis\extract_strings.py') "$recovery\disc" "$recovery\manifests\strings.json"
python (Join-Path $PSScriptRoot 'analysis\decode_movies.py') $Disc "$recovery\assets\movies" "$recovery\manifests\jpsxdec.idx"
python (Join-Path $PSScriptRoot 'analysis\media_manifest.py') "$recovery\assets\movies" "$recovery\manifests\movies.json"

# 解釈表を参照する復元
$payload = "$recovery\code\input\SLPS_008.10.payload.bin"
python (Join-Path $PSScriptRoot 'analysis\extract_psx_payload.py') "$recovery\disc\SLPS_008.10" $payload "$recovery\manifests\psx-payload.json"
python (Join-Path $PSScriptRoot 'analysis\extract_messages.py') $payload "$tables\message-tables.json" "$recovery\manifests\messages-raw.json"
python (Join-Path $PSScriptRoot 'analysis\decode_messages.py') "$recovery\manifests\messages-raw.json" "$recovery\disc\PRO\SAVELOAD.BIN" "$tables\font-map.json" "$tables\message-tables.json" "$recovery\manifests\messages-decoded.json"
python (Join-Path $PSScriptRoot 'analysis\extract_facility_catalog.py') "$recovery\manifests\messages-decoded.json" "$tables\data-tables.json" "$recovery\manifests\facility-catalog.json"
python (Join-Path $PSScriptRoot 'analysis\extract_facility_economy.py') "$recovery\disc\PRO\D2MAIN.BIN" "$recovery\manifests\messages-decoded.json" "$tables\data-tables.json" "$recovery\manifests\facility-economy.json"
python (Join-Path $PSScriptRoot 'analysis\extract_attraction_economy.py') "$recovery\disc\PRO\D2MAIN.BIN" "$recovery\manifests\messages-decoded.json" "$tables\data-tables.json" "$recovery\manifests\attraction-economy.json"
python (Join-Path $PSScriptRoot 'analysis\extract_unpack_pak.py') --payload $payload --pak "$recovery\disc\TEX\UNPACK.PAK" --tables "$tables\unpack-resources.json" --output "$recovery\manifests\unpack-pak.json"

& (Join-Path $PSScriptRoot 'analysis\analyze_code.ps1')
python (Join-Path $PSScriptRoot 'audit_recovery.py')
