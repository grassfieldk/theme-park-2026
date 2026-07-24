# 原作仕様書

このディレクトリは、PlayStation 用ゲーム『新テーマパーク』に近いパーク経営ゲームを実装するための、確認済みのゲーム仕様とデータをまとめる。
文書本文には、プレイヤーが行える操作、画面に表示される情報、ゲーム内で起こる状態変化を記載する。


## 状態

- `confirmed`: 内容を確認できている
- `uninterpreted`: データは抽出済みだが、ゲーム内での意味を特定していない


## 文書一覧

- [ゲーム概要](00_game-overview.md): パーク画面と国
- [パーク経営](01_park-management.md): 経営中の操作、来園者、スタッフ、進行
- [パークマップ](02_park-map.md): タイル領域、正面ゲート、道路接続
- [モードと時間](03_game-modes-and-time.md): モード選択、開始時の時間、進行処理
- [シナリオ](04_scenarios.md): 国別の初期状態と達成条件
- [施設](10_facilities.md): 76 種類の施設名と分類、設備 20 種類
- [経済](11_economy.md): 設置費、維持費、料金
- [施設の配置と撤去](12_facility-runtime.md): 配置時と撤去時の挙動
- [施設仕様](13_facility-specifications.md): 面積、能力、定員、開発費
- [バスと倉庫](14_bus-and-warehouse.md): 来園者輸送と商品在庫
- [ミニゲーム](15_minigames.md): パークへ出かける操作で遊ぶゲーム
- [評価](20_evaluation.md): 5 つの評価項目と年度末評価
- [研究](21_research.md): 研究開発の対象と分岐
- [イベント](22_events.md): 計画イベントとランダムイベント
- [宣伝広告](23_advertising.md): 媒体広告と企業看板の契約
- [テキスト](30_text.md): 画面文言
- [メッセージカタログ](31_messages.md): 抽出済みの画面文言
- [文字コード](32_font-encoding.md): FONT16 と FONT12 の字形参照
- [確認範囲](90_coverage.md): 確認済みと未解釈のデータ


## 原則

この仕様書には、確認できたゲーム内容だけを記載する。解析用のファイル形式、メモリアドレス、抽出手順は `recovery/` と `tools/` に置き、本文には記載しない。`uninterpreted` のデータは、内容を特定するまで原作仕様として実装しない。


## 解析リファレンス

- 復元コード: `recovery/code/main/`、`recovery/code/overlays/`
- 抽出済みデータ: `recovery/manifests/`
- 解析スクリプト: `tools/analysis/`
