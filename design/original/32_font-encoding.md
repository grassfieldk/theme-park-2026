# 文字コード

メッセージの文字コードは、2 つのフォント字形表を使う。


## FONT16

コード 0 から 511 は、`FONT16` の同じ番号の字形を参照する。
コード 0 から 511 は字形画像と照合して文字を確認した。


## FONT12

コード 512 から 767 は、`FONT12` の `コード - 512` 番の字形を参照する。
たとえば、コード 667 は `FONT12` の 155 番「始」、
コード 565 は 53 番「横」である。

メッセージデータに出現する `FONT12` のコードは、すべて字形を参照して転記した。
メッセージデータに未出現の `FONT12` コードは、仕様復元には使用しない。


## 制御コード

`-1` は文字列終端、`-2` は改行を表す。


## 解析リファレンス

- 文字対応表: `recovery/manifests/font16-map.json`、`recovery/manifests/font12-map.json`
- 字形画像: `recovery/assets/font16-glyphs/`、`recovery/assets/font12-glyphs/`
- 字形一覧: `recovery/assets/font16-contact.png`、`recovery/assets/font12-contact.png`
- 抽出スクリプト: `tools/analysis/extract_font_glyphs.py`
