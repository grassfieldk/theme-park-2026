"""PS-X EXE の仮想アドレス→ペイロードオフセット変換。

loadAddress と headerSize は EXE ヘッダ(PS-X EXE 形式)から定まる機械的な値で、
ゲーム固有の解釈ではない。
"""

from __future__ import annotations

# PS-X EXE ヘッダの t_addr(ロード先仮想アドレス)。
LOAD_ADDRESS = 0x800A7000
# PS-X EXE の固定ヘッダサイズ。
HEADER_SIZE = 0x800


def vaddr_to_payload_offset(vaddr: int) -> int:
    """仮想アドレスをペイロード(ヘッダ除去済み)先頭からのオフセットへ変換する。"""
    return vaddr - LOAD_ADDRESS


def vaddr_to_exe_offset(vaddr: int) -> int:
    """仮想アドレスを EXE ファイル先頭(ヘッダ含む)からのオフセットへ変換する。"""
    return HEADER_SIZE + vaddr - LOAD_ADDRESS
