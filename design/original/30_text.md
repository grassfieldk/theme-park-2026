# テキスト

施設名、国名を含む画面文言を抽出した。全件は [メッセージカタログ](31_messages.md) に記載する。


## 文字

文字コードの構造は [文字コード](32_font-encoding.md) に記載する。メッセージに出現する文字コードの字形参照は取得済みであり、文字の転記は検証を継続している。


## 解析リファレンス

- 抽出済みテキスト: `recovery/manifests/messages-raw.json`
- 転記結果: `recovery/manifests/messages-decoded.json`
- 抽出と復号のスクリプト: `tools/analysis/extract_messages.py`、`tools/analysis/decode_messages.py`
