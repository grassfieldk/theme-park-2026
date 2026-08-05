import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import Phaser from 'phaser'
import attractions from '../config/attractions.json'
import shops from '../config/shops.json'
import facilities from '../config/facilities.json'
import game from '../config/game.json'
import type { MenuAction } from './GamepadController'
import busSprites from '../config/busSprites.json'
import bikeSprites from '../config/bikeSprites.json'
import guestSprites from '../config/guestSprites.json'
import staffConfig from '../config/staff.json'
import riderSprites from '../config/riderSprites.json'
import pointers from '../config/pointers.json'
import reactions from '../config/reactions.json'
import seasons from '../config/seasons.json'
import terrain from '../config/terrain.json'
import terrainObjects from '../config/terrainObjects.json'
import { gameDaysPerMs } from '../game/clock'
import type { ParkSnapshot } from '../game/save'

type Country = {
  id: string
  name: string
  map: { x: number, y: number, width: number, height: number }
  // 歩道にゴミを捨てるまでに持ち歩けるゴミの数(独自仕様)
  litterThreshold: number
}

type Props = {
  country: Country
  roadBuildMode: RoadBuildMode
  attractionBuild: Attraction | null
  attractionBuildStep: AttractionBuildStep
  shopBuild: Shop | null
  facilityBuild: Facility | null
  /** 雇用するスタッフの職種。選んでいる間は配置モードになる */
  staffBuild: StaffType | null
  availableCash: number
  onAttractionPlaced: (cost: number) => void
  onAttractionPlacementCancelled: (cost: number) => void
  onAttractionAccessPlaced: (step: 'entrance' | 'exit') => void
  onShopPlaced: (cost: number) => void
  onShopBuildStep: (step: 'body' | 'direction') => void
  onShopComplete: () => void
  onFacilityPlaced: (cost: number) => void
  onFacilityBuildStep: (step: 'body' | 'direction') => void
  /** スタッフを配置して雇用費を払ったとき */
  onStaffHired: (cost: number) => void
  /** 設定メニューの「位置」で選んだ移動先へスタッフを動かし終えたとき */
  onStaffMoved: () => void
  onStairsBuildStep: (step: 'body' | 'direction') => void
  secondsPerDay: number
  onAdmissionPaid: (fee: number) => void
  onShopSale: (amount: number) => void
  onGuestCountChange: (count: number) => void
  onBuildMessage: (message: string) => void
  /** 絵の読み込みと園の組み立てが終わり、遊べる状態になったとき */
  onReady: () => void
  /** アトラクション・ショップの撤去前に確認を出す。返事は resolveRemoval で返す */
  onRemoveConfirm: (name: string) => void
  /** 設置済みの施設の設定メニューを開く・閉じる・中身を差し替える */
  onFacilitySettings: (settings: FacilitySettings | null) => void
  /** 性能ＵＰなど、設定メニューでの支払い */
  onSpend: (cost: number) => void
  /** メニューや確認が開いている間は、マップへのクリックを受け付けない */
  mapBlocked: boolean
  /** タッチ操作の配置。マップを触ってもカーソルは動かさず、画面上の十字ボタンで動かす */
  touchLayout: boolean
  /** セーブデータから再開するときの園の中身。新規開始なら null */
  initialPark: ParkSnapshot | null
  /** 開始時点の経過日数。季節や滞在日数の基準になる */
  initialElapsedDays: number
}

/**
 * 設置済みの施設に対して開く設定メニューの 1 項目。
 * toggle は決定でその場で切り替わり、step と digits は決定してから調整する。
 * confirm は決定すると確認を出す。
 */
export type FacilitySettingKind = 'toggle' | 'step' | 'digits' | 'confirm'
export type FacilitySettingItem = {
  id: string
  label: string
  description: string
  /** メニューアイコンの番号(原作の表による) */
  icon: number
  kind: FacilitySettingKind
  enabled: boolean
  /** toggle と confirm の表示文字 */
  text?: string
  /** toggle が入っている状態か。文字の色を変えるのに使う */
  on?: boolean
  /** 数値の項目の現在値と範囲。digits は桁数ぶん 0 を詰めて見せる */
  value?: number
  min?: number
  max?: number
  digits?: number
}
/** 設定項目に出てこない、見るだけの数値 */
export type FacilityStatusItem = { icon: number, label: string, value: string }
export type FacilitySettings = {
  title: string
  /** 性能で上がるバージョン。見出しに出す */
  version: number
  items: FacilitySettingItem[]
  status: FacilityStatusItem[]
}

export type ParkMapHandle = {
  handleAction: (action: MenuAction) => void
  /** 数値の設定を書き換える */
  setFacilitySetting: (itemId: string, value: number) => void
  /** 切り替えの設定を反転する、または性能を上げる */
  activateFacilitySetting: (itemId: string) => void
  /** 施設の設定メニューを閉じる */
  closeFacilitySettings: () => void
  /** カメラを画面ピクセル単位で動かす(右スティック) */
  panCamera: (deltaX: number, deltaY: number) => void
  /** 現在の園の中身を書き出す。まだ読み込みが終わっていなければ null */
  snapshot: () => ParkSnapshot | null
  /** 撤去の確認に対する返事 */
  resolveRemoval: (confirmed: boolean) => void
  /** 日付を飛ばす(開発サーバのデバッグ用)。飛ばした間の計算は行わない */
  setElapsedDays: (days: number) => void
  /** 経営の「スタッフ経費」。一覧画面はまだ無いが、集計はここから取れる */
  staffExpense: () => StaffExpense
}

/** 月給の集計。今月・先月の合計と、スタッフ 1 人ずつの内訳 */
export type StaffExpense = {
  thisMonth: number
  lastMonth: number
  total: number
  byStaff: Array<{ id: string, wage: number, paid: number }>
}

type Attraction = (typeof attractions)[number]
type Shop = (typeof shops)[number]
type Facility = (typeof facilities)[number]
export type StaffType = (typeof staffConfig)[number]
type GuestBank = {
  bank: number
  frameWidth: number
  frameHeight: number
  anchorX: number
  anchorY: number
  /** 歩行 4 方向のあとに続く動作のグループ(スタッフだけが持つ) */
  groups?: Array<{ group: number, frame: number, count: number }>
}
type Footprint = { width: number, height: number, constructionCost: number }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
type RoadBuildMode = 'path' | 'queue' | 'stairs' | null
type AccessPoint = { x: number, y: number, frame: number, image: Phaser.GameObjects.Image }
// 入口・出口はアトラクション敷地の縁のマスに置く。どの辺にいるかで向きが決まる
type AccessSide = 'top' | 'bottom' | 'left' | 'right'
type PlacedAttraction = {
  id: string
  x: number
  y: number
  width: number
  height: number
  cost: number
  attraction: Attraction
  // 定員(人数)と運転時間の設定値。どちらも運転設定メニューで変えられる。
  // 乗車中の客は Guest 型がシーン内で定義されるため rideStates 側で持つ
  capacity: number
  rideTimeSetting: number
  // 運転設定の速度と乗車額、乗った客が付ける評価(-1023〜1023)
  speedSetting: number
  price: number
  rating: number
  // 性能ＵＰで上がるバージョン(0〜9)。上がるほど定員の上限が増える
  version: number
  // 耐久度。運転するたびに減り、0 になると爆発してガレキになる。
  // メカニックが修理すると満杯に戻る
  durability: number
  // メカニックを呼んでいる状態(煙が出ている)。修理が終わるまで下がらない
  needsRepair: boolean
  // 揺れの基準にする、絵の本来の位置
  imageX: number
  imageY: number
  // 設定メニューの「点検」でメカニックを呼んだ状態。点検が終わると下りる
  inspectRequested: boolean
  // メカニックが到着して点検している間。運転を止め、撤去も受け付けない
  underInspection: boolean
  // 休止中は受け入れを止める
  suspended: boolean
  // ステータスに出す利用者数。月が替わるときに今月ぶんを先月へ送る
  usedThisMonth: number
  usedLastMonth: number
  // 表示中のコマと、そのコマの残り表示フレーム数
  animFrame: number
  animRemaining: number
  // 乗車客の姿勢を決める位相カウンタと、席ごとに描いている絵
  riderPhase: number
  riderImages: Phaser.GameObjects.Image[]
  image: Phaser.GameObjects.Image
  baseImages: Phaser.GameObjects.Image[]
  entrance?: AccessPoint
  entranceQueueKey?: string
  entranceFrame?: number
  exit?: AccessPoint
}

const ParkMap = forwardRef<ParkMapHandle, Props>(function ParkMap({
  country,
  roadBuildMode,
  attractionBuild,
  attractionBuildStep,
  shopBuild,
  facilityBuild,
  staffBuild,
  onStaffMoved,
  availableCash,
  onAttractionPlaced,
  onAttractionPlacementCancelled,
  onAttractionAccessPlaced,
  onShopPlaced,
  onShopBuildStep,
  onShopComplete,
  onFacilityPlaced,
  onStaffHired,
  onFacilityBuildStep,
  onStairsBuildStep,
  secondsPerDay,
  onAdmissionPaid,
  onShopSale,
  onGuestCountChange,
  onBuildMessage,
  onReady,
  onRemoveConfirm,
  onFacilitySettings,
  onSpend,
  mapBlocked,
  touchLayout,
  initialPark,
  initialElapsedDays,
}: Props, ref) {
  const host = useRef<HTMLDivElement>(null)
  // 再開データはマップを組み立てるときに 1 回だけ使う
  const initialParkData = useRef(initialPark)
  const initialDays = useRef(initialElapsedDays)
  const takeSnapshot = useRef<(() => ParkSnapshot) | null>(null)
  const readStaffExpense = useRef<(() => StaffExpense) | null>(null)
  const initialSecondsPerDay = useRef(secondsPerDay)
  const phaserGame = useRef<Phaser.Game | null>(null)
  const attractionPlacedHandler = useRef(onAttractionPlaced)
  const attractionCancelledHandler = useRef(onAttractionPlacementCancelled)
  const attractionAccessPlacedHandler = useRef(onAttractionAccessPlaced)
  const shopPlacedHandler = useRef(onShopPlaced)
  const shopStepHandler = useRef(onShopBuildStep)
  const shopCompleteHandler = useRef(onShopComplete)
  const facilityPlacedHandler = useRef(onFacilityPlaced)
  const staffHiredHandler = useRef(onStaffHired)
  const staffMovedHandler = useRef(onStaffMoved)
  const facilityStepHandler = useRef(onFacilityBuildStep)
  const stairsStepHandler = useRef(onStairsBuildStep)
  const admissionHandler = useRef(onAdmissionPaid)
  const shopSaleHandler = useRef(onShopSale)
  const guestCountHandler = useRef(onGuestCountChange)
  const buildMessageHandler = useRef(onBuildMessage)
  const readyHandler = useRef(onReady)
  const removeConfirmHandler = useRef(onRemoveConfirm)
  const facilitySettingsHandler = useRef(onFacilitySettings)
  const spendHandler = useRef(onSpend)
  const initialMapBlocked = useRef(mapBlocked)
  const initialTouchLayout = useRef(touchLayout)
  attractionPlacedHandler.current = onAttractionPlaced
  attractionCancelledHandler.current = onAttractionPlacementCancelled
  attractionAccessPlacedHandler.current = onAttractionAccessPlaced
  shopPlacedHandler.current = onShopPlaced
  shopStepHandler.current = onShopBuildStep
  shopCompleteHandler.current = onShopComplete
  facilityPlacedHandler.current = onFacilityPlaced
  staffHiredHandler.current = onStaffHired
  staffMovedHandler.current = onStaffMoved
  facilityStepHandler.current = onFacilityBuildStep
  stairsStepHandler.current = onStairsBuildStep
  admissionHandler.current = onAdmissionPaid
  shopSaleHandler.current = onShopSale
  guestCountHandler.current = onGuestCountChange
  buildMessageHandler.current = onBuildMessage
  readyHandler.current = onReady
  removeConfirmHandler.current = onRemoveConfirm
  facilitySettingsHandler.current = onFacilitySettings
  spendHandler.current = onSpend

  useImperativeHandle(ref, () => ({
    handleAction(action) {
      phaserGame.current?.scene.getScene('park')?.events.emit('pan', action)
    },
    setFacilitySetting(itemId, value) {
      phaserGame.current?.scene.getScene('park')?.events.emit('set-facility-setting', itemId, value)
    },
    activateFacilitySetting(itemId) {
      phaserGame.current?.scene.getScene('park')?.events.emit('activate-facility-setting', itemId)
    },
    closeFacilitySettings() {
      phaserGame.current?.scene.getScene('park')?.events.emit('close-facility-settings')
    },
    panCamera(deltaX, deltaY) {
      phaserGame.current?.scene.getScene('park')?.events.emit('camera-pan', deltaX, deltaY)
    },
    snapshot() {
      return takeSnapshot.current?.() ?? null
    },
    staffExpense() {
      return readStaffExpense.current?.() ?? { thisMonth: 0, lastMonth: 0, total: 0, byStaff: [] }
    },
    resolveRemoval(confirmed) {
      phaserGame.current?.scene.getScene('park')?.events.emit('resolve-removal', confirmed)
    },
    setElapsedDays(days) {
      phaserGame.current?.scene.getScene('park')?.events.emit('set-elapsed-days', days)
    },
  }), [])

  useEffect(() => {
    if (!host.current) return

    const { width: gridWidth, height: gridHeight, stepX, stepY, rowOffsetX, tileWidth } = game.park.mapGrid
    const padding = 80
    const worldWidth = (gridWidth - 1) * stepX + (gridHeight - 1) * rowOffsetX + tileWidth + padding * 2
    const worldHeight = gridHeight * stepY + padding * 2
    // 国ごとの初期地形。高さ 1 段ぶんタイルを持ち上げて描く
    const heightRows = (terrain.heights as Record<string, string[] | undefined>)[country.id]
    const heightAt = (x: number, y: number) => {
      if (!heightRows || x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return 0
      return heightRows[y].charCodeAt(x) - 48
    }
    const flatPoint = (x: number, y: number) => ({ x: padding + x * stepX + y * rowOffsetX, y: padding + y * stepY })
    const point = (x: number, y: number) => ({
      x: padding + x * stepX + y * rowOffsetX,
      y: padding + y * stepY - heightAt(Math.floor(x), Math.floor(y)) * terrain.heightStepPx,
    })

    const peopleSetByCountry = guestSprites.peopleSetByCountry as Record<string, string>
    const peopleSet = (peopleSetByCountry[country.id] ?? 'A').toLowerCase()
    const guestBanks = (guestSprites.sets as Record<string, GuestBank[]>)[peopleSet] ?? []
    const guestBankById = new Map(guestBanks.map((bank) => [bank.bank, bank]))
    // 乗車中の客の見た目。歩行バンクごとに、人数ぶんの乗車用バンクが決まっている
    type RiderBank = { frameWidth: number, frameHeight: number, anchorX: number, anchorY: number }
    const riderBanks = (riderSprites.sets as Record<string, Record<string, RiderBank>>)[peopleSet] ?? {}
    const riderCodesByBank = riderSprites.codesByBank
    // 木・設備・階段・バスの絵柄は国ごとのシーナリー種で決まる
    const sceneryKind = (seasons.countryScenery as Record<string, number>)[country.id] ?? 0

    // 演算は画面の更新間隔と切り離し、この刻み幅で必要な回数だけ進める。
    // どの環境でも 1 回あたりの進む量が同じになり、毎秒の回数も一定になる
    const stepMs = 1000 / game.time.framesPerSecond
    // 原作の内部フレームは 30fps で、ゲーム速度を変えても刻みは変わらない
    // (変わるのは 1 日あたりのフレーム数)。フレーム数で決まっている長さは実時間で送る
    const originalFramesPerStep = game.time.originalFramesPerSecond * stepMs / 1000
    // 画面を離れていた後などに一気に取り戻そうとして固まらないよう、1 回の更新で進める上限を設ける
    const maxStepsPerFrame = 15

    class ParkScene extends Phaser.Scene {
      // create() 内のクロージャに来園者の更新処理を持たせ、update() から呼ぶ
      simulate: (deltaMs: number) => void = () => {}
      private pendingMs = 0

      constructor() {
        super('park')
      }

      update(_time: number, delta: number) {
        this.pendingMs = Math.min(this.pendingMs + delta, stepMs * maxStepsPerFrame)
        while (this.pendingMs >= stepMs) {
          this.pendingMs -= stepMs
          this.simulate(stepMs)
        }
      }

      preload() {
        attractions.forEach((attraction) => {
          for (let frame = 0; frame < attraction.animation.frames; frame += 1) {
            this.load.image(`${attraction.id}-${frame}`, `${attraction.assetBase}-${frame}.png?v=5`)
          }
        })
        shops.forEach((shop) => {
          for (let direction = 0; direction < shop.directions; direction += 1) {
            this.load.image(`shop-${shop.id}-${direction}`, `${shop.assetBase}-${direction}.png`)
          }
        })
        // 設備はシーナリー種(国別)の 4 季節ぶんを読み込む。建物は種・季節で変わらない
        facilities.forEach((facility) => {
          for (let frame = 0; frame < facility.frames; frame += 1) {
            if (facility.placement === 'building') {
              this.load.image(`facility-${facility.id}-${frame}`, `${facility.assetBase}-${frame}.png`)
              continue
            }
            for (let season = 0; season < 4; season += 1) {
              this.load.image(
                `facility-${facility.id}-${frame}-s${season}`,
                `${facility.assetBase}/${sceneryKind}/${facility.id}-${frame}-s${season}.png`,
              )
            }
          }
        })
        // 来園者は国ごとの PEOPLE セットを使う。1 枚に 4 方向 × 4 コマ
        guestBanks.forEach((bank) => {
          this.load.spritesheet(`guest-${bank.bank}`, `/assets/park/guests/${peopleSet}-${bank.bank}.png`, {
            frameWidth: bank.frameWidth,
            frameHeight: bank.frameHeight,
          })
        })
        // 乗車中の客は姿勢の数だけ横に並んだシート
        Object.entries(riderBanks).forEach(([bank, size]) => {
          this.load.spritesheet(`rider-${bank}`, `/assets/park/riders/${peopleSet}-${bank}.png`, {
            frameWidth: size.frameWidth,
            frameHeight: size.frameHeight,
          })
        })
        // 来園者の頭の上に出る反応のアイコン
        reactions.list.forEach(({ id }) => {
          this.load.image(`reaction-${id}`, `${reactions.assetBase}-${id}.png`)
        })
        // 季節で色が変わる地形パーツは [通常|秋|冬] の 3 コマのシート
        Object.entries(seasons.seasonalAssets).forEach(([name, size]) => {
          this.load.spritesheet(name, `/assets/park/${name}.png?v=8`, {
            frameWidth: size.width,
            frameHeight: size.height,
          })
        })
        for (let index = 0; index < 4; index += 1) {
          this.load.image(`facility-entrance-frame-${index}`, `/assets/park/facility-entrance-frame-${index}.png`)
        }
        this.load.image('pointer-arrow', pointers.arrow.src)
        this.load.image('pointer-shovel', pointers.shovel.src)
        // 階段とバスも設備と同じシーナリー種・季節の絵を使う
        for (let season = 0; season < 4; season += 1) {
          terrainObjects.stairs[sceneryKind].forEach((_offset, index) => {
            this.load.image(
              `terrain-stairs-${index}-s${season}`,
              `/assets/park/facilities/${sceneryKind}/terrain-stairs-${index}-s${season}.png`,
            )
          })
          busSprites.variants[0].offsetsByKind[sceneryKind].forEach((_offset, part) => {
            this.load.image(
              `bus-0-${part}-s${season}`,
              `/assets/park/facilities/${sceneryKind}/bus-0-${part}-s${season}.png`,
            )
          })
          // アウトローのバイク。0 = 運転手とアウトローの 2 人乗り、1 = 降ろした後
          bikeSprites.variants.forEach((variant, index) => {
            variant.offsetsByKind[sceneryKind].forEach((_offset, frame) => {
              this.load.image(
                `bike-${index}-${frame}-s${season}`,
                `/assets/park/facilities/${sceneryKind}/bike-${index}-${frame}-s${season}.png`,
              )
            })
          })
        }
        this.load.image('mechanic-post', '/assets/park/mechanic-post.png')
        this.load.image('rubble', '/assets/park/rubble.png')
        this.load.image('repair-fence-bottom', '/assets/park/repair-fence-bottom.png')
        this.load.image('repair-fence-top', '/assets/park/repair-fence-top.png')
        this.load.image('repair-fence-left', '/assets/park/repair-fence-left.png')
        this.load.image('repair-fence-right', '/assets/park/repair-fence-right.png')
        this.load.image('path-litter-drink', '/assets/park/path-litter-drink.png')
        this.load.image('path-litter-food', '/assets/park/path-litter-food.png')
        this.load.image('path-vomit', '/assets/park/path-vomit.png')
        this.load.image('outside-cover-0', '/assets/park/outside-cover-0.png')
        this.load.image('outside-cover-1', '/assets/park/outside-cover-1.png')
        this.load.image('border-top', '/assets/park/border-top.png')
        this.load.image('border-side', '/assets/park/border-side.png')
        this.load.image('border-top-left', '/assets/park/border-top-left.png')
        this.load.image('border-top-right', '/assets/park/border-top-right.png')
        this.load.image('border-bottom-right', '/assets/park/border-bottom-right.png')
        this.load.image('border-bottom-left', '/assets/park/border-bottom-left.png')
        this.load.image('gate-sign', '/assets/park/gate-sign.png')
        this.load.image('gate-sign-base', '/assets/park/gate-sign-base.png')
        this.load.image('gate-window', '/assets/park/gate-window.png?v=2')
        this.load.image('gate-left-tower', '/assets/park/gate-left-tower.png')
        this.load.image('gate-left-base', '/assets/park/gate-left-base.png')
        this.load.image('gate-left-roof', '/assets/park/gate-left-roof.png')
        this.load.image('gate-right-tower', '/assets/park/gate-right-tower.png?v=2')
        this.load.image('gate-right-base', '/assets/park/gate-right-base.png')
        this.load.image('gate-right-roof', '/assets/park/gate-right-roof.png')
      }

      create() {
        let activeRoadBuildMode = roadBuildMode
        let activeAttraction = attractionBuild
        let activeAttractionBuildStep = attractionBuildStep
        let activeShop = shopBuild
        let shopDirection = 0
        let shopStep: 'body' | 'direction' = 'body'
        type PendingShop = { x: number, y: number, cost: number, image: Phaser.GameObjects.Image }
        let pendingShop: PendingShop | null = null
        // 設置済みのショップ。向きが決まった時点で記録する
        // price と tasteLevel は運営設定。rating は利用した客が付ける評価(-1023〜1023)
        type PlacedShop = {
          shop: Shop, x: number, y: number, direction: number,
          price: number, tasteLevel: number, rating: number,
          // ゲームショップの賞品価格と勝率(%)、性能ＵＰで上がるバージョン(0〜9)
          prizePrice: number, winRate: number, version: number,
          // ステータスに出す利用者数。月が替わるときに今月ぶんを先月へ送る
          usedThisMonth: number, usedLastMonth: number,
          image: Phaser.GameObjects.Image,
        }
        const placedShops: PlacedShop[] = []
        // ゲームショップのうち賞品があるものだけ、賞品価格と勝率の初期値を持つ
        const shopPrize = (shop: Shop) => ('prize' in shop ? shop.prize : null)
        // 飲食ショップの味付けの呼び名(店ごとに違う)。味付けのない店は null
        const shopTasteName = (shop: Shop) => ('tasteName' in shop ? shop.tasteName : null)
        // 今どのモードかを持つ変数はここにまとめる。drawCursor がこれらを読み、
        // その drawCursor はシーンの組み立て中に一度呼ばれるので、
        // 後ろで宣言すると読み込み時に落ちる
        let activeFacility = facilityBuild
        let activeStaffType = staffBuild
        // 設定メニューを開いているスタッフ。settingsAttraction/settingsShop と同じ仕組みで扱う
        let settingsStaff: Staff | null = null
        // ピンセットでつまんでいるスタッフと、つまむ前にいたマス(取り消しで戻す)
        let movingStaff: Staff | null = null
        let carriedFrom: { x: number, y: number } | null = null
        // 設定メニューの「清掃ルート」で編集中のスタッフと、そのマス列(最大 72)
        let routeStaff: Staff | null = null
        let routeTiles: Array<{ x: number, y: number }> = []
        const routeTileLimit = 72
        let facilityDirection = 0
        let facilityStep: 'body' | 'direction' = 'body'
        let pendingFacility: { x: number, y: number } | null = null
        let stairsStep: 'body' | 'direction' = 'body'
        let pendingStairs: { x: number, y: number, direction: { dx: number, dy: number, frame: number }, image: Phaser.GameObjects.Image } | null = null
        let currentCash = availableCash
        let daysPerMs = gameDaysPerMs(initialSecondsPerDay.current)
        // 絵のコマ送りの基準にする、いちばん速い速度の 1 日の長さ
        const fastestSecondsPerDay = Math.min(...game.speeds.map((speed) => speed.secondsPerDay))
        let confirmHeld = false
        let removeHeld = false
        // メニューや確認が開いている間はマップへのクリックを無視する
        let mapInteractive = !initialMapBlocked.current
        // 画面上の十字ボタンでカーソルを動かす配置(狭い画面)
        let touchLayout = initialTouchLayout.current

        // ---- 季節 ----
        // 地形の色は国ごとの季節表で決まる。対象アセットは [通常|秋|冬] の 3 コマで、
        // フレーム番号 = 現在の変種
        const seasonalKeys = new Set(Object.keys(seasons.seasonalAssets))
        const startDateMs = Date.parse(game.park.startDate)
        const seasonAt = (days: number) => {
          const month = new Date(startDateMs + Math.floor(days) * 86_400_000).getUTCMonth()
          const quarter = month >= 2 && month <= 4 ? 0 : month >= 5 && month <= 7 ? 1 : month >= 8 && month <= 10 ? 2 : 3
          return (seasons.countrySeasons as Record<string, number[]>)[country.id]?.[quarter] ?? 0
        }
        let seasonIndex = seasonAt(initialDays.current)
        let seasonVariant = seasons.variantBySeason[seasonIndex]
        // 日付を飛ばしたときに立てる。次にゲームが進むときに季節を見直す
        let seasonDirty = false
        const seasonFrame = <T extends Phaser.GameObjects.Image>(image: T): T => {
          if (seasonalKeys.has(image.texture.key)) image.setFrame(seasonVariant)
          return image
        }
        // 設備のテクスチャとずらしは、シーナリー種(国)と季節で決まる
        const facilityTexture = (facility: Facility, frame: number) => (
          facility.placement === 'building'
            ? `facility-${facility.id}-${frame}`
            : `facility-${facility.id}-${frame}-s${seasonIndex}`
        )
        const facilityOffsets = (facility: Facility) => facility.imageOffsetsByKind[sceneryKind]
        // 季節で姿が変わるアトラクション(プール・スケートリンク)。
        // 記録とセーブは常に元の ID で持ち、絵だけ秋冬の姿に切り替える
        const seasonalFormByBase = new Map<string, Attraction>()
        attractions.forEach((entry) => {
          if ('seasonalFormOf' in entry && entry.seasonalFormOf) seasonalFormByBase.set(entry.seasonalFormOf, entry)
        })
        const attractionForm = (attraction: Attraction) => (
          seasonIndex >= 2 ? seasonalFormByBase.get(attraction.id) ?? attraction : attraction
        )
        // アトラクションの絵はコマ送りのアニメ。グループが 2 つ以上ある種類は
        // 先頭が停止中、末尾が稼働中の絵で、1 つしかない種類は稼働中だけ送る
        const attractionFrameKey = (id: string, frame: number) => `${id}-${frame}`
        const idleGroupOf = (attraction: Attraction) => attraction.animation.groups[0]
        const runGroupOf = (attraction: Attraction) => (
          attraction.animation.groups[attraction.animation.groups.length - 1]
        )

        const ground = this.add.renderTexture(0, 0, worldWidth, worldHeight).setOrigin(0)
        const { x: left, y: top, width, height } = country.map
        const right = left + width - 1
        const bottom = top + height - 1
        const gateLeft = left + Math.floor((width - 5) / 2)
        const gateRow = top + height
        const gateCenter = left + Math.floor(width / 2)
        type DrawCommand = {
          key: string
          x: number
          y: number
          depth: number
          offsetX?: number
          offsetY?: number
          order: number
        }
        const commands: DrawCommand[] = []
        let order = 0
        // 重ね順は原作と同じマス単位の interleave。マスの前後関係が最優先で、
        // 同じマスの中では 地形の面・壁 → 道路 → 設置物・人 の順に重なる。
        // カーソルなどの overlay だけは全体の最前面
        const layerRank = {
          terrain: 1,
          road: 2,
          // 道路の上に重ねる汚れ。設備や来園者より奥
          roadOverlay: 3,
          facility: 4,
          overlay: 6,
        } as const
        type RenderLayer = keyof typeof layerRank
        const overlayDepth = 400_000
        // 下(y が大きい)ほど手前で、同じ行なら左(x が小さい)ほど手前
        const positionDepthAt = (x: number, y: number) => 10 + gridWidth * 7 + y * 200 - x * 7
        const renderDepthAt = (layer: RenderLayer, x: number, y: number) => positionDepthAt(x, y) * 8 + layerRank[layer]
        const depthAt = (x: number, y: number) => -positionDepthAt(x, y)
        const queue = (key: string, x: number, y: number, depth = depthAt(x, y), offsetX = 0, offsetY = 0) => {
          commands.push({ key, x, y, depth, offsetX, offsetY, order })
          order += 1
        }
        const draw = (target: Phaser.GameObjects.RenderTexture, { key, x, y, offsetX = 0, offsetY = 0 }: DrawCommand) => {
          // 園外の木はキー末尾の -s{季節} を描画時の季節に読み替える
          const resolved = key.replace(/-s[0-3]$/, `-s${seasonIndex}`)
          const position = point(x, y)
          if (seasonalKeys.has(resolved)) target.drawFrame(resolved, seasonVariant, position.x - offsetX, position.y - offsetY)
          else target.draw(resolved, position.x - offsetX, position.y - offsetY)
        }

        const entranceTileKey = (x: number, y: number) => {
          if (y === bottom && (x === gateLeft + 1 || x === gateLeft + 3)) return 'gate-base-6'
          if ((y === gateRow || y === gateRow + 1) && (x === gateLeft + 1 || x === gateLeft + 3)) return 'gate-base-2'
          if (y === gateRow + 2 && x === gateLeft + 1) return 'gate-base-17'
          if (y === gateRow + 2 && x === gateLeft + 2) return 'gate-base-3'
          if (y === gateRow + 2 && x === gateLeft + 3) return 'gate-base-19'
          if (y === gateRow + 3) return 'entrance-background-1'
          if (y === gateRow + 4) return 'entrance-background-2'
          if (y === gateRow + 5) return x === gateCenter ? 'entrance-special-49' : 'entrance-background-3'
          if (y === gateRow + 6) return 'entrance-background-4'
          return null
        }

        // 高い側のマスから見て低い方角。北・東の縁は専用タイル、南・西の縁は壁面で描く
        const lowerNeighbors = (x: number, y: number) => {
          const height = heightAt(x, y)
          if (height === 0) return null
          const north = heightAt(x, y - 1) < height
          const east = heightAt(x + 1, y) < height
          const west = heightAt(x - 1, y) < height
          const south = heightAt(x, y + 1) < height
          if (!north && !east && !west && !south) return null
          return { north, east, west, south }
        }
        const rimGroupAt = (x: number, y: number) => {
          const lower = lowerNeighbors(x, y)
          return lower ? (lower.north ? 1 : 0) + (lower.east ? 2 : 0) : 0
        }
        const terrainPieceDepth = (x: number, y: number) => renderDepthAt('terrain', x, y)
        const roadPieceDepth = (x: number, y: number) => renderDepthAt('road', x, y)

        // 園外の飾り(国選択データで決まる)。上の園外は全列、左右の園外は敷地の下端の行まで。
        // まばらな国は市松状(上と右は偶数マス、左は奇数マス)に置く
        const outsideDecor = (terrain.outside as Record<string, { facility?: string, cover?: number, dense: boolean } | undefined>)[country.id]
        const outsideDecorTiles = new Set<string>()
        if (outsideDecor) {
          for (let y = 0; y < top; y += 1) {
            for (let x = 0; x < gridWidth; x += 1) {
              if (outsideDecor.dense || (x % 2 === 0 && y % 2 === 0)) outsideDecorTiles.add(`${x},${y}`)
            }
          }
          for (let y = 0; y <= bottom; y += 1) {
            for (let x = 0; x < gridWidth; x += 1) {
              if (x >= left && x < left + width) continue
              const place = outsideDecor.dense
                || (x < left ? x % 2 === 1 && y % 2 === 1 : x % 2 === 0 && y % 2 === 0)
              if (place) outsideDecorTiles.add(`${x},${y}`)
            }
          }
        }

        for (let y = 0; y < gridHeight; y += 1) {
          for (let x = 0; x < gridWidth; x += 1) {
            const entranceTile = entranceTileKey(x, y)
            const isGateBarrierTile = y === gateRow + 5 && x === gateCenter
            const lower = lowerNeighbors(x, y)
            const cover = outsideDecor?.cover !== undefined && outsideDecorTiles.has(`${x},${y}`)
            const groundKey = cover
              ? `outside-cover-${outsideDecor?.cover}`
              : lower && (lower.north || lower.east)
                ? `ground-slope-${(lower.north ? 1 : 0) + (lower.east ? 2 : 0)}`
                : 'ground-tile'
            if (!isGateBarrierTile) queue(groundKey, x, y)
            if (lower) {
              const height = heightAt(x, y)
              const corner = lower.north && lower.west ? '-corner' : ''
              if (lower.west) {
                for (let level = heightAt(x - 1, y); level < height; level += 1) {
                  queue(`cliff-west${corner}-${level === height - 1 ? 0 : 1}`, x, y, depthAt(x, y), 1, (level + 1 - height) * terrain.heightStepPx)
                }
              }
              if (lower.south) {
                for (let level = heightAt(x, y + 1); level < height; level += 1) {
                  queue(`cliff-south${corner}-${level === height - 1 ? 0 : 1}`, x, y, depthAt(x, y), -5, (level - height) * terrain.heightStepPx)
                }
              }
            }
            if (entranceTile) queue(entranceTile, x, y)
            if (x < left || x > right || y < top || y > bottom) continue
            if (y === top && x === left) queue('border-top-left', x, y)
            else if (y === top && x === right) queue('border-top-right', x, y)
            else if (y === top) queue('border-top', x, y)
            else if (y === bottom && x === left) queue('border-bottom-left', x, y)
            else if (y === bottom && x === right) queue('border-bottom-right', x, y)
            else if (y === bottom && x === gateLeft) queue('border-top-right', x, y)
            else if (y === bottom && x === gateLeft + 4) queue('border-top-left', x, y)
            else if (y === bottom && (x < gateLeft || x > gateLeft + 4)) queue('border-top', x, y)
            else if (x === left || x === right) queue('border-side', x, y)
          }
        }

        queue('border-side', gateLeft, gateRow)
        queue('border-side', gateLeft + 4, gateRow)

        const leftDepth = depthAt(gateLeft, gateRow + 1) - 8
        const centerDepth = depthAt(gateLeft + 2, gateRow + 1) - 15
        const rightDepth = depthAt(gateLeft + 4, gateRow + 1) - 1

        queue('gate-right-tower', gateLeft + 4, gateRow + 1, rightDepth, 4, 56)
        queue('gate-right-roof', gateLeft + 4, gateRow + 1, rightDepth, 4, 64)
        queue('gate-right-base', gateLeft + 4, gateRow + 1, rightDepth, 4, 0)
        queue('gate-sign', gateLeft + 2, gateRow + 1, centerDepth, 22, 48)
        queue('gate-window', gateLeft + 2, gateRow + 1, centerDepth, 8, 54)
        queue('gate-left-tower', gateLeft, gateRow + 1, leftDepth, 13, 56)
        queue('gate-left-base', gateLeft, gateRow + 1, leftDepth, 13, 0)
        queue('gate-left-roof', gateLeft, gateRow + 1, leftDepth, 13, 64)

        queue('gate-sign-base', gateLeft + 2, gateRow + 1, depthAt(gateLeft + 2, gateRow + 1) - 1, -4, 20)
        queue('entrance-special-50', gateCenter, gateRow + 3, depthAt(gateCenter, gateRow + 3), -10, 8)
        queue('entrance-background-3', gateCenter, gateRow + 5, depthAt(gateCenter, gateRow + 5) + 7)

        // 園外の木。設置物と同じ絵をシーナリー種・季節に合わせて描く
        if (outsideDecor?.facility) {
          const treeFacility = facilities.find((entry) => entry.id === outsideDecor.facility)
          if (treeFacility) {
            const offset = treeFacility.imageOffsetsByKind[sceneryKind][0]
            outsideDecorTiles.forEach((key) => {
              const comma = key.indexOf(',')
              const x = Number(key.slice(0, comma))
              const y = Number(key.slice(comma + 1))
              queue(`facility-${treeFacility.id}-0-s0`, x, y, depthAt(x, y), offset.x, offset.y)
            })
          }
        }

        commands.sort((a, b) => b.depth - a.depth || a.order - b.order)
        const fixedRoadKeys = new Set(['gate-base-2', 'gate-base-3', 'gate-base-6', 'gate-base-17', 'gate-base-19'])
        const groundFamilyKeys = /^(ground-tile$|ground-slope-|outside-cover-|cliff-)/
        const isFacility = ({ key }: DrawCommand) => key.startsWith('border-') || key === 'entrance-special-50' || (key.startsWith('gate-') && !fixedRoadKeys.has(key))
        const isTerrainForeground = (command: DrawCommand) => (
          !groundFamilyKeys.test(command.key)
          && !fixedRoadKeys.has(command.key)
          && !isFacility(command)
        )
        const backgroundCommands = commands.filter((command) => !isFacility(command) && !isTerrainForeground(command))
        const terrainForegroundCommands = commands.filter(isTerrainForeground)
        const facilityCommands = commands.filter(isFacility)
        const terrainForeground = this.add.renderTexture(0, 0, worldWidth, worldHeight).setOrigin(0).setDepth(0.5)
        const addStaticImage = (layer: RenderLayer, command: DrawCommand) => {
          const position = point(command.x, command.y)
          seasonFrame(
            this.add.image(position.x - (command.offsetX ?? 0), position.y - (command.offsetY ?? 0), command.key)
              .setOrigin(0)
              .setDepth(-command.depth * 8 + layerRank[layer]),
          )
        }
        const drawTerrainLayers = () => {
          ground.clear()
          terrainForeground.clear()
          backgroundCommands.forEach((command) => draw(ground, command))
          terrainForegroundCommands.forEach((command) => draw(terrainForeground, command))
        }
        drawTerrainLayers()
        facilityCommands.forEach((command) => addStaticImage('facility', command))
        // 崖の面と壁面は、裏(北・東)側の低いマスに置かれた道路などを隠す。
        // RenderTexture はスプライトより奥にあるため、丘とその周囲 1 マスの面・壁を
        // 画像としても重ね、マス単位の重ね順に参加させる(同じマス内は面 → 壁の順)
        const nearHill = (x: number, y: number) => {
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              if (heightAt(x + offsetX, y + offsetY) > 0) return true
            }
          }
          return false
        }
        for (let y = 0; y < gridHeight; y += 1) {
          for (let x = 0; x < gridWidth; x += 1) {
            if (!nearHill(x, y)) continue
            const lower = lowerNeighbors(x, y)
            const key = lower && (lower.north || lower.east)
              ? `ground-slope-${(lower.north ? 1 : 0) + (lower.east ? 2 : 0)}`
              : 'ground-tile'
            const position = point(x, y)
            const depth = renderDepthAt('terrain', x, y)
            seasonFrame(this.add.image(position.x, position.y, key).setOrigin(0).setDepth(depth))
            if (!lower) continue
            const height = heightAt(x, y)
            const corner = lower.north && lower.west ? '-corner' : ''
            if (lower.west) {
              for (let level = heightAt(x - 1, y); level < height; level += 1) {
                seasonFrame(this.add.image(
                  position.x - 1,
                  position.y + (height - level - 1) * terrain.heightStepPx,
                  `cliff-west${corner}-${level === height - 1 ? 0 : 1}`,
                ).setOrigin(0).setDepth(depth))
              }
            }
            if (lower.south) {
              for (let level = heightAt(x, y + 1); level < height; level += 1) {
                seasonFrame(this.add.image(
                  position.x + 5,
                  position.y + (height - level) * terrain.heightStepPx,
                  `cliff-south${corner}-${level === height - 1 ? 0 : 1}`,
                ).setOrigin(0).setDepth(depth))
              }
            }
          }
        }
        // 季節が変わったら地形を描き直し、置かれている季節対応の画像も切り替える。
        // 設備・階段・バスはキー末尾の -s{季節} を現在の季節へ付け替える
        const applySeason = () => {
          drawTerrainLayers()
          this.children.list.forEach((child) => {
            if (!(child instanceof Phaser.GameObjects.Image)) return
            if (seasonalKeys.has(child.texture.key)) {
              child.setFrame(seasonVariant)
              return
            }
            if (/-s[0-3]$/.test(child.texture.key)) {
              child.setTexture(child.texture.key.replace(/-s[0-3]$/, `-s${seasonIndex}`))
            }
          })
          // 季節で姿が変わるアトラクションを掛け替える
          placedAttractions.forEach((placed) => {
            if (!seasonalFormByBase.has(placed.id)) return
            const base = attractions.find((entry) => entry.id === placed.id)
            if (!base) return
            const form = attractionForm(base)
            const idle = idleGroupOf(form)
            if (placed.image.texture.key === attractionFrameKey(form.id, idle.from)) return
            const position = attractionImagePosition(base, form.imageOffset, placed.x, placed.y + base.height - 1)
            placed.animFrame = idle.from
            placed.animRemaining = idle.durations[0]
            placed.image.setTexture(attractionFrameKey(form.id, idle.from)).setPosition(position.x, position.y)
          })
        }
        // 今の日付から季節を見直し、変わっていれば絵を差し替える
        const refreshSeason = () => {
          const season = seasonAt(elapsedDays)
          if (season === seasonIndex) return
          seasonIndex = season
          seasonVariant = seasons.variantBySeason[season]
          applySeason()
        }
        // 利用者数の集計。月が替わったら今月ぶんを先月へ送り、今月を数え直す
        const monthAt = (days: number) => {
          const date = new Date(startDateMs + Math.floor(days) * 86_400_000)
          return date.getUTCFullYear() * 12 + date.getUTCMonth()
        }
        let monthIndex = monthAt(initialDays.current)
        // 迷子を出してよい状態。原作は迷子が出た時点で下ろし(`FUN_801efb78`)、
        // 日ごとの処理(`FUN_801f1894`)が
        // 「乱数(0〜99) + 1 < パークの資産価値 ÷ 年間来場者数 ÷ 100」で立て直す
        let lostChildArmed = true
        let lastLostChildDay = Math.floor(initialDays.current)
        // パークの資産価値。初期資金から始まり、設置費・雇用費を積み上げる(原作の項目 5)
        let parkValue = game.park.initialCash
        // 年間来場者数。入園するたびに 1 増え、年が替わると 0 に戻る
        let visitorsThisYear = 0
        let visitorYear = new Date(startDateMs + Math.floor(initialDays.current) * 86_400_000).getUTCFullYear()
        // 月をまたいだときに追加で走らせたい処理を差し込む口。スタッフの月給・能率など
        let monthlyExtraTask: (() => void) | null = null
        const refreshMonth = () => {
          const month = monthAt(elapsedDays)
          if (month === monthIndex) return
          monthIndex = month
          const roll = (placed: { usedThisMonth: number, usedLastMonth: number }) => {
            placed.usedLastMonth = placed.usedThisMonth
            placed.usedThisMonth = 0
          }
          placedAttractions.forEach(roll)
          placedShops.forEach(roll)
          monthlyExtraTask?.()
        }

        // ---- 歩道の汚れ ----
        // 原作はタイルの属性のビットで持ち、道路の絵の上に重ねて描く(`FUN_800c6594`)。
        // 3 種類は別々のビットなので、同じマスに重なって出る
        const litterConfig = game.litter
        // 歩道に捨てるまでに我慢して持ち歩けるゴミの数。治安・モラルのよい国ほど多い(独自仕様)
        const litterThreshold = country.litterThreshold
        // 3 種類は同じマスに重なるので、それぞれマス内の決まった位置に置く
        const litterKinds = [
          { bit: 1, texture: 'path-litter-drink' },
          { bit: 2, texture: 'path-litter-food' },
          { bit: 4, texture: 'path-vomit' },
        ].map((kind, index) => ({ ...kind, offset: terrain.litterOffsets[index] }))
        // 来園者が持ち歩くのは飲み物と食べ物のゴミだけ。ゲロは持ち歩かない
        const trashKindCount = 2
        const litterTiles = new Map<string, number>()
        const litterImages = new Map<string, Phaser.GameObjects.Image[]>()
        const drawLitter = (x: number, y: number) => {
          const key = tileKey(x, y)
          const mask = litterTiles.get(key) ?? 0
          const existing = litterImages.get(key) ?? []
          existing.forEach((image) => image.destroy())
          if (mask === 0) {
            litterImages.delete(key)
            return
          }
          const position = point(x, y)
          const images = litterKinds
            .filter(({ bit }) => (mask & bit) !== 0)
            .map(({ texture, offset }) => this.add
              .image(position.x + offset.x, position.y + offset.y, texture)
              .setOrigin(0)
              .setDepth(renderDepthAt('roadOverlay', x, y)))
          litterImages.set(key, images)
        }
        const addLitter = (x: number, y: number, bit: number) => {
          const key = tileKey(x, y)
          if (!roads.has(key)) return
          const mask = litterTiles.get(key) ?? 0
          if ((mask & bit) !== 0) return
          litterTiles.set(key, mask | bit)
          drawLitter(x, y)
        }
        const clearLitter = (x: number, y: number) => {
          const key = tileKey(x, y)
          if (!litterTiles.has(key)) return
          litterTiles.delete(key)
          drawLitter(x, y)
        }
        const isLittered = (x: number, y: number) => (litterTiles.get(tileKey(x, y)) ?? 0) !== 0
        const trashTotal = (trash: number[]) => trash.reduce((total, count) => total + count, 0)

        const roadFrameByMask = [16, 2, 4, 0, 3, 10, 11, 7, 5, 13, 12, 9, 1, 6, 8, 15]
        // 傾斜上の整列歩道のコマ読み替え表(UNK_80117826)。行 = 縁のグループ 1〜3、列 = 基本コマ 0〜5
        const queueSlopeFrames = [
          [6, 14, 7, 8, 7, 8],
          [0, 9, 11, 10, 11, 10],
          [17, 15, 0, 12, 0, 12],
        ]
        const queueStateByMask = [0, 9, 10, 1, 7, 3, 4, 1, 8, 6, 5, 1, 2, 2, 2, 2]
        const queueMaskByState = [0, 3, 12, 5, 6, 10, 9, 4, 8, 1, 2, 0, 0]
        const queueFrameByState = [13, 0, 1, 2, 3, 4, 5, 1, 1, 0, 0, 0, 6]
        // 整列歩道の状態に接続方向を足す・外す
        const queueStateAdding = (state: number, mask: number) => queueStateByMask[queueMaskByState[state] | mask]
        const queueStateRemoving = (state: number, mask: number) => queueStateByMask[queueMaskByState[state] & ~mask]
        const roads = new Set<string>()
        // ショップ設置時に自動で敷かれる道。見た目と接続は通常の歩道と同じだが、
        // 通るのはそのショップを利用する客だけなので、ふだんの歩行では通り道にしない
        const shopRoads = new Set<string>()
        // 店の入口マス(店前の道の 1 マス外)→ 店。通りすがりの客が偶然そこに来たときの
        // 入店判定に使う(shopEntranceSpots)
        const shopEntranceSpots = new Map<string, PlacedShop>()
        const roadImages = new Map<string, Phaser.GameObjects.Image>()
        const queueRoads = new Set<string>()
        const queueStates = new Map<string, number>()
        const queueRoadImages = new Map<string, Phaser.GameObjects.Image>()
        // アトラクションごとの「整列歩道の各マス → 入口前までの歩数」。列が変わったら作り直す
        const queueDistanceCache = new Map<PlacedAttraction, Map<string, number>>()
        const occupiedByAttraction = new Set<string>()
        const placedAttractions: PlacedAttraction[] = []
        let pendingAttraction: PlacedAttraction | null = null
        // メカニックの拠点。原作は置いたマスのタイル種別コードを 0xbe にして
        // 属性 0x400000(地面を占める建造物)を立て、地形描画がその絵を出す。
        // 本作もマスを 1 つ占め、そこに拠点の絵を置く
        const mechanicPosts = new Map<string, Phaser.GameObjects.Image>()
        // アトラクションが爆発したあとに敷地へ残るガレキ。原作は跡地のマスのタイル種別コードを
        // 0xbf にして、地形描画がその絵を出す。本作も同じくマスを 1 つ占める
        const rubbleTiles = new Map<string, Phaser.GameObjects.Image>()
        // 出入口変更で置き直しているアトラクションと、取り消したときに戻す変更前の出入口
        let relocatingAccess: PlacedAttraction | null = null
        let relocatedFrom: { entrance: AccessPoint | undefined, exit: AccessPoint | undefined } | null = null
        const tileKey = (x: number, y: number) => `${x},${y}`
        const parseKey = (key: string) => {
          const comma = key.indexOf(',')
          return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
        }
        // 敷地の占有マスをまとめて登録・解除する。x, y は敷地の奥(上)左のマス
        const markFootprint = (
          area: { x: number, y: number, width: number, height: number },
          occupied: boolean,
        ) => {
          for (let offsetY = 0; offsetY < area.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < area.width; offsetX += 1) {
              const key = tileKey(area.x + offsetX, area.y + offsetY)
              if (occupied) occupiedByAttraction.add(key)
              else occupiedByAttraction.delete(key)
            }
          }
        }
        const isLockedEntranceTile = (x: number, y: number) => (
          (y === bottom && (x === gateLeft + 1 || x === gateLeft + 3))
          || ((y === gateRow || y === gateRow + 1) && (x === gateLeft + 1 || x === gateLeft + 3))
          || (y === gateRow + 2 && x >= gateLeft + 1 && x <= gateLeft + 3)
        )
        // 園の敷地は、上下左右のふち 1 マスを外周ブロックにしてある。ゲート下の中央マスだけは
        // 通路として通り抜けられる
        const isOuterEdge = (x: number, y: number) => (
          ((y === top || y === bottom) && x >= left && x <= right && !(y === bottom && x === gateCenter))
          || ((x === left || x === right) && y >= top && y <= bottom)
        )
        // 敷地の中。外周ブロックの内側と、そこへ通り抜けるゲート下の中央マス
        const isInsidePark = (x: number, y: number) => x > left && x < right && y > top && y <= bottom
        // 入口ゲートが建っているマス。固定歩道の間と、その両脇(外へ 1 マスずつ広い)
        const isGateStructureTile = (x: number, y: number) => (
          (y === gateRow || y === gateRow + 1) && x >= gateLeft - 1 && x <= gateLeft + 5
        )
        // 設置できるのは敷地の x 範囲(外周ブロック除く)と、その下の園外 3 行
        // (外周のすぐ下からバス待ち列の手前まで)。園外は敷地より横に 1 マスずつ広い
        const buildBottomRow = gateRow + 2
        const isBuildableTile = (x: number, y: number) => {
          const outside = y > bottom
          return x >= (outside ? left : left + 1)
            && x <= (outside ? right : right - 1)
            && y > top && y <= buildBottomRow
            && !isOuterEdge(x, y)
            && !isLockedEntranceTile(x, y)
            && !isGateStructureTile(x, y)
            && !occupiedByAttraction.has(tileKey(x, y))
            && !mechanicPosts.has(tileKey(x, y))
            && !rubbleTiles.has(tileKey(x, y))
        }
        const hasRoadConnection = (x: number, y: number) => (
          roads.has(tileKey(x, y)) || stairsTiles.has(tileKey(x, y)) || isLockedEntranceTile(x, y)
        )
        // 道路・柵などのつながりは同じ高さのマス同士に限る(原作 FUN_800c1d80)。
        // 例外は階段で、階段のマスと向いた先の 1 段高いマスはつながる
        const sameHeight = (x: number, y: number, otherX: number, otherY: number) => (
          heightAt(x, y) === heightAt(otherX, otherY)
        )
        const roadConnects = (x: number, y: number, otherX: number, otherY: number) => (
          ((hasRoadConnection(otherX, otherY) && sameHeight(x, y, otherX, otherY))
            || stairsLink(x, y, otherX, otherY))
          && stairsTraversable(x, y, otherX, otherY)
        )
        const roadMaskAt = (x: number, y: number) => (
          (roadConnects(x, y, x + 1, y) ? 1 : 0)
          | (roadConnects(x, y, x - 1, y) ? 2 : 0)
          | (roadConnects(x, y, x, y + 1) ? 4 : 0)
          | (roadConnects(x, y, x, y - 1) ? 8 : 0)
        )
        // 階段(階段設置メニュー、オブジェクトコード 0x59〜0x5C)。
        // 1 段高いマスに面した低い側のマスへ置き、その 2 マスをつなぐ。
        // 絵はシーナリー種・季節で替わる terrain-stairs のコマ 0〜3(北・南・西・東へ上る)
        type StairsDirection = { dx: number, dy: number, frame: number }
        type PlacedStairs = { x: number, y: number, dx: number, dy: number, images: Phaser.GameObjects.Image[] }
        const stairsTiles = new Map<string, PlacedStairs>()
        const stairsDirections: StairsDirection[] = [
          { dx: 0, dy: -1, frame: 0 },
          { dx: 0, dy: 1, frame: 1 },
          { dx: 1, dy: 0, frame: 2 },
          { dx: -1, dy: 0, frame: 3 },
        ]
        // そのマスから上れる方向の一覧(2 方向以上あるときは設置時に選ぶ)
        const stairsOptionsAt = (x: number, y: number) => (
          stairsDirections.filter((dir) => heightAt(x + dir.dx, y + dir.dy) === heightAt(x, y) + 1)
        )
        const stairsDirectionAt = (x: number, y: number) => stairsOptionsAt(x, y)[0] ?? null
        // 2 マスが階段でつながっているか(どちら向きの一歩でも真)
        const stairsLink = (fromX: number, fromY: number, toX: number, toY: number) => {
          const from = stairsTiles.get(tileKey(fromX, fromY))
          if (from && fromX + from.dx === toX && fromY + from.dy === toY) return true
          const to = stairsTiles.get(tileKey(toX, toY))
          return Boolean(to && to.x + to.dx === fromX && to.y + to.dy === fromY)
        }
        // 階段のマスは上る方向の軸(上り先とその反対側)でしか出入りできない
        const stairsAxisAllows = (x: number, y: number, otherX: number, otherY: number) => {
          const stairs = stairsTiles.get(tileKey(x, y))
          if (!stairs) return true
          return (otherX === x + stairs.dx && otherY === y + stairs.dy)
            || (otherX === x - stairs.dx && otherY === y - stairs.dy)
        }
        const stairsTraversable = (fromX: number, fromY: number, toX: number, toY: number) => (
          stairsAxisAllows(fromX, fromY, toX, toY) && stairsAxisAllows(toX, toY, fromX, fromY)
        )
        const entranceFrameForSide = { top: 1, bottom: 0, left: 2, right: 3 } as const
        // entranceFrameToward: 入口がこのオフセット方向を向くときのフレーム
        // entranceFrameFacingBack: このオフセット先にある入口が手前を向くときのフレーム
        const queueNeighbors = [
          { x: 0, y: -1, mask: 8, reverseMask: 4, entranceFrameToward: entranceFrameForSide.top, entranceFrameFacingBack: entranceFrameForSide.bottom },
          { x: 0, y: 1, mask: 4, reverseMask: 8, entranceFrameToward: entranceFrameForSide.bottom, entranceFrameFacingBack: entranceFrameForSide.top },
          { x: -1, y: 0, mask: 2, reverseMask: 1, entranceFrameToward: entranceFrameForSide.left, entranceFrameFacingBack: entranceFrameForSide.right },
          { x: 1, y: 0, mask: 1, reverseMask: 2, entranceFrameToward: entranceFrameForSide.right, entranceFrameFacingBack: entranceFrameForSide.left },
        ]
        const isQueueConnectionTarget = (state: number) => state === 0 || (state >= 7 && state <= 10)
        const entranceFrameAt = (facility: PlacedAttraction) => {
          const entrance = facility.entrance
          if (!entrance) return 0
          if (facility.entranceQueueKey && queueRoads.has(facility.entranceQueueKey)) {
            return facility.entranceFrame ?? entrance.frame
          }
          // 整列歩道がつながっていないときは、置いたときの向きのまま。
          // つなぎ先の記録はここでは消さない(整列歩道を撤去したときに removeRoad が付け替える)
          return entrance.frame
        }
        const updateAttractionEntranceFrames = () => {
          placedAttractions.forEach((facility) => {
            if (!facility.entrance) return
            const key = `facility-entrance-frame-${entranceFrameAt(facility)}`
            if (facility.entrance.image.texture.key !== key) facility.entrance.image.setTexture(key)
          })
        }
        const redrawRoadTiles = (x: number, y: number) => {
          const affectedTiles = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          affectedTiles.forEach(([tileX, tileY]) => {
            const key = tileKey(tileX, tileY)
            // ショップ前の道は敷地扱い(建設不可)だが、歩道としての絵は描く
            if (!isBuildableTile(tileX, tileY) && !isLockedEntranceTile(tileX, tileY) && !shopRoads.has(key)) return
            const connected = roads.has(key) || isLockedEntranceTile(tileX, tileY)
            const currentImage = roadImages.get(key)
            if (!connected) {
              currentImage?.destroy()
              roadImages.delete(key)
              return
            }
            const position = point(tileX, tileY)
            const image = currentImage ?? this.add.image(position.x, position.y, 'road-frame-0').setOrigin(0)
            if (!currentImage) roadImages.set(key, image)
            // 縁のマスでは縁取り付きの道路絵(シートのグループ 1〜3)を使う
            const group = rimGroupAt(tileX, tileY)
            const frame = roadFrameByMask[roadMaskAt(tileX, tileY)]
            seasonFrame(image.setTexture(group > 0 ? `road-slope${group}-frame-${frame}` : `road-frame-${frame}`)
              .setDepth(roadPieceDepth(tileX, tileY)))
          })
        }
        const redrawQueueTiles = (x: number, y: number) => {
          // 列の形が変わった可能性があるので、入口までの歩数の対応表は作り直す
          queueDistanceCache.clear()
          const affectedTiles = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          affectedTiles.forEach(([tileX, tileY]) => {
            const key = tileKey(tileX, tileY)
            const currentImage = queueRoadImages.get(key)
            if (!queueRoads.has(key)) {
              currentImage?.destroy()
              queueRoadImages.delete(key)
              return
            }
            const baseFrame = queueFrameByState[queueStates.get(key) ?? 0]
            // 縁のマスでは傾斜用のコマに読み替える(UNK_80117826。基本コマ 0〜5 が対象)
            const group = rimGroupAt(tileX, tileY)
            const frame = group > 0 && baseFrame <= 5 ? queueSlopeFrames[group - 1][baseFrame] : baseFrame
            const position = point(tileX, tileY)
            const image = currentImage ?? this.add.image(position.x, position.y, `queue-frame-${frame}`).setOrigin(0)
            if (!currentImage) queueRoadImages.set(key, image)
            seasonFrame(image.setTexture(`queue-frame-${frame}`).setPosition(position.x, position.y)
              .setDepth(roadPieceDepth(tileX, tileY)))
          })
          updateAttractionEntranceFrames()
        }

        const cursorPosition = { x: gateLeft + 1, y: bottom - 1 }
        // 入口・出口を置いている間、カーソルが敷地のどの辺にいるか(向きもこれで決まる)
        let accessSide: AccessSide = 'bottom'
        const cursor = this.add.graphics().setDepth(overlayDepth)
        const shopArrow = this.add.graphics().setDepth(overlayDepth).setVisible(false)
        const routeGraphics = this.add.graphics().setDepth(overlayDepth)
        // 原作のポインタ。通常は矢印、設置操作中はシャベルに変わる
        const pointer = this.add.image(0, 0, 'pointer-arrow').setOrigin(0).setDepth(overlayDepth)
        let attractionPreview: Phaser.GameObjects.Image | null = null
        let accessPreview: Phaser.GameObjects.Image | null = null
        let stairsPreview: Phaser.GameObjects.Image | null = null
        const buildBasePreview: Phaser.GameObjects.Image[] = []
        const cursorShape = [
          new Phaser.Geom.Point(0, 0),
          new Phaser.Geom.Point(stepX, 0),
          new Phaser.Geom.Point(stepX + rowOffsetX, stepY),
          new Phaser.Geom.Point(rowOffsetX, stepY),
        ]
        const canPlaceAttraction = (footprint: Footprint, x: number, y: number) => {
          if (currentCash < footprint.constructionCost) return false
          for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
              const tileX = x + offsetX
              const tileY = y - offsetY
              if (!isBuildableTile(tileX, tileY)) return false
              // 足場は全マス同じ高さ(原作 FUN_800b1ec8。崖の縁でも高さが同じなら置ける)
              if (heightAt(tileX, tileY) !== heightAt(x, y)) return false
              if (roads.has(tileKey(tileX, tileY)) || queueRoads.has(tileKey(tileX, tileY))) return false
              if (stairsTiles.has(tileKey(tileX, tileY))) return false
            }
          }
          return true
        }
        const attractionOriginAtCursor = (_footprint: Footprint) => ({
          x: cursorPosition.x,
          y: cursorPosition.y,
        })
        const attractionImagePosition = (footprint: Footprint, imageOffset: { x: number, y: number }, x: number, y: number) => {
          const center = point(
            x + Math.floor(footprint.width / 2),
            y - Math.floor(footprint.height / 2),
          )
          return {
            x: center.x - imageOffset.x,
            y: center.y - imageOffset.y,
          }
        }
        // 入口は敷地の外側に接する 1 周(角は使わない)、出口は敷地の内側の縁に置く。
        // corners は角のマスを使うかどうか
        type AccessRing = { left: number, right: number, top: number, bottom: number, corners: boolean }
        const accessRingOf = (facility: PlacedAttraction, step: Exclude<AttractionBuildStep, 'body'>): AccessRing => (
          step === 'exit'
            ? {
              left: facility.x,
              right: facility.x + facility.width - 1,
              top: facility.y,
              bottom: facility.y + facility.height - 1,
              corners: true,
            }
            : {
              left: facility.x - 1,
              right: facility.x + facility.width,
              top: facility.y - 1,
              bottom: facility.y + facility.height,
              corners: false,
            }
        )
        // 辺に沿って動ける範囲。角を使わない周では両端を 1 マスずつ詰める
        const accessSpanOf = (ring: AccessRing, side: AccessSide) => (
          side === 'top' || side === 'bottom'
            ? { min: ring.corners ? ring.left : ring.left + 1, max: ring.corners ? ring.right : ring.right - 1 }
            : { min: ring.corners ? ring.top : ring.top + 1, max: ring.corners ? ring.bottom : ring.bottom - 1 }
        )
        const accessTileOf = (ring: AccessRing, side: AccessSide, along: number) => (
          side === 'top' ? { x: along, y: ring.top }
            : side === 'bottom' ? { x: along, y: ring.bottom }
              : side === 'left' ? { x: ring.left, y: along }
                : { x: ring.right, y: along }
        )
        const accessSides: AccessSide[] = ['top', 'bottom', 'left', 'right']
        const isAccessTile = (ring: AccessRing, x: number, y: number) => accessSides.some((side) => {
          const span = accessSpanOf(ring, side)
          const along = side === 'top' || side === 'bottom' ? x : y
          if (along < span.min || along > span.max) return false
          const tile = accessTileOf(ring, side, along)
          return tile.x === x && tile.y === y
        })
        const outwardStepBySide = {
          top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
        } as const
        const sideByFrame: AccessSide[] = ['bottom', 'top', 'left', 'right']
        // 出口は敷地の内側の縁から選ぶが、絵は選んだ辺の 1 マス外側に描く。
        // 入口は選んだマスにそのまま描く
        const accessDrawTile = (step: Exclude<AttractionBuildStep, 'body'>, x: number, y: number, frame: number) => {
          if (step === 'entrance') return { x, y }
          const outward = outwardStepBySide[sideByFrame[frame] ?? 'bottom']
          return { x: x + outward.x, y: y + outward.y }
        }
        const accessOffsetAt = (step: Exclude<AttractionBuildStep, 'body'>, frame: number) => {
          const offsets = step === 'entrance'
            ? [[-2, 0], [-2, 0], [-1, 0], [-1, 0]]
            : [[0, -8], [12, 16], [24, -1], [-3, 4]]
          return offsets[frame] ?? [0, 0]
        }
        const canPlaceAccess = (x: number, y: number) => {
          const facility = pendingAttraction
          if (!facility) return false
          const step = activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit'
          if (!isAccessTile(accessRingOf(facility, step), x, y)) return false
          if (step === 'exit') {
            // 出口は場所を占めないが、入口と同じ場所には出せない。
            // 同じ角のマスでも向きが違えば絵の出る場所が違うので、絵の位置で見る
            const drawn = accessDrawTile('exit', x, y, entranceFrameForSide[accessSide])
            if (heightAt(drawn.x, drawn.y) !== heightAt(facility.x, facility.y)) return false
            return !(facility.entrance?.x === drawn.x && facility.entrance.y === drawn.y)
          }
          if (x <= left || x >= right || y <= top || y >= bottom) return false
          // 入口・出口は本体と同じ高さのマスに限る
          if (heightAt(x, y) !== heightAt(facility.x, facility.y)) return false
          if (roads.has(tileKey(x, y)) || queueRoads.has(tileKey(x, y)) || stairsTiles.has(tileKey(x, y))) return false
          return !occupiedByAttraction.has(tileKey(x, y))
        }
        const buildBaseFrameAt = (offsetX: number, offsetY: number, width: number, height: number) => {
          if (offsetY === 0 && offsetX === 0) return 4
          if (offsetY === 0 && offsetX === width - 1) return 5
          if (offsetY === height - 1 && offsetX === 0) return 7
          if (offsetY === height - 1 && offsetX === width - 1) return 6
          if (offsetY === 0) return 0
          if (offsetY === height - 1) return 2
          if (offsetX === 0) return 3
          if (offsetX === width - 1) return 1
          return 12
        }
        // 敷地の地面。多くは盛り上げ台座だけだが、水系は台座の内側が水面になり、
        // アルバトロスは中央に階段が立つ(原作 FUN_801f4a48)
        const attractionGround = (attraction: Attraction) => ('ground' in attraction ? attraction.ground : 'raised')
        const attractionUseConfig = game.attractionUse
        const pondFacility = facilities.find((facility) => facility.id === 'pond')!
        // 水面の 9 分割はイケのフレームをそのまま使う(原作テーブル DAT_801f92a2)
        const waterFrameAt = (offsetX: number, offsetY: number, width: number, height: number) => {
          const top = offsetY === 1
          const bottom = offsetY === height - 2
          const left = offsetX === 1
          const right = offsetX === width - 2
          if (top && left) return 4
          if (top && right) return 5
          if (bottom && left) return 6
          if (bottom && right) return 7
          if (top) return 0
          if (bottom) return 1
          if (left) return 2
          if (right) return 3
          return 8
        }
        // 水面は敷地の縁を 1 マス残した内側だけ
        const isWaterTile = (offsetX: number, offsetY: number, width: number, height: number) => (
          offsetX > 0 && offsetY > 0 && offsetX < width - 1 && offsetY < height - 1
        )
        const canPlaceRoad = (x: number, y: number) => (
          isBuildableTile(x, y)
          && !roads.has(tileKey(x, y))
          && !queueRoads.has(tileKey(x, y))
          && !stairsTiles.has(tileKey(x, y))
        )
        const canPlacePath = canPlaceRoad
        const canPlaceQueue = canPlaceRoad
        // 階段は 1 段高いマスに面したマスにだけ置ける
        const canPlaceStairs = (x: number, y: number) => (
          canPlaceRoad(x, y) && stairsDirectionAt(x, y) !== null
        )
        // 設備の設置方法は place / directional / fence / pond / building の 5 種類。
        // 柵の連結表とイケの隅マスク表は原作テーブルそのまま(recovery/specs/facility-scenery.md)
        const fenceFrameByMask = [15, 11, 12, 0, 14, 2, 3, 9, 13, 5, 4, 7, 1, 8, 10, 6]
        const pondFrameByCorner = [-1, 6, 5, 14, 4, 2, 0, 11, 7, 1, 3, 10, 13, 9, 12, 8]
        const pondCornerByFrame = [6, 9, 5, 10, 4, 2, 1, 8, 15, 13, 11, 7, 14, 12, 3]
        const pondNeighbours: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
        const pondNeighbourCorner = [4, 6, 2, 5, 10, 1, 9, 8]
        const pondCornerNeed = [11, 208, 104, 22]
        const pondCornerBit = [8, 4, 2, 1]
        // 隅ビットごとに、その隅を共有する 3 マスと相手側の隅ビット(左上・右下・左下・右上の順)
        const pondCornerShare: Array<Array<[number, number, number]>> = [
          [[-1, -1, 4], [0, -1, 2], [-1, 0, 1]],
          [[1, 1, 8], [1, 0, 2], [0, 1, 1]],
          [[-1, 1, 1], [-1, 0, 4], [0, 1, 8]],
          [[1, -1, 2], [0, -1, 4], [1, 0, 8]],
        ]
        // used = その設備自身の内容量(トイレの利用)、trash = 捨てられたゴミの数。
        // ゴミバコは自身の内容量を持たず、ゴミの数だけを数える
        type PlacedFacility = { facility: Facility, frame: number, image: Phaser.GameObjects.Image, used: number, trash: number }
        const placedFacilities = new Map<string, PlacedFacility>()
        const placedBuildings = new Set<string>()
        const facilityFootprint = (facility: Facility): Footprint => (
          { width: facility.width, height: facility.height, constructionCost: facility.constructionCost }
        )
        // フンスイ(3×3 の place)だけカーソルが敷地の中心になる。他はカーソルが前(下)左タイル
        const facilityOrigin = (facility: Facility, x: number, y: number) => (
          facility.placement === 'place' && facility.width === 3
            ? { x: x - 1, y: y + 1 }
            : { x, y }
        )
        const facilityAt = (x: number, y: number) => placedFacilities.get(tileKey(x, y))
        const isFenceAt = (x: number, y: number) => facilityAt(x, y)?.facility.placement === 'fence'
        const isPondAt = (x: number, y: number) => facilityAt(x, y)?.facility.placement === 'pond'
        // 柵 3 種は互いにつながるので、種類ではなく設置方法で隣接を判定する
        const fenceMaskAt = (x: number, y: number) => (
          (isFenceAt(x + 1, y) && sameHeight(x, y, x + 1, y) ? 1 : 0)
          | (isFenceAt(x - 1, y) && sameHeight(x, y, x - 1, y) ? 2 : 0)
          | (isFenceAt(x, y + 1) && sameHeight(x, y, x, y + 1) ? 4 : 0)
          | (isFenceAt(x, y - 1) && sameHeight(x, y, x, y - 1) ? 8 : 0)
        )
        const pondCornerAt = (x: number, y: number) => (
          isPondAt(x, y) ? (pondCornerByFrame[facilityAt(x, y)!.frame] ?? 0) : 0
        )
        const facilityFrameAt = (facility: Facility, x: number, y: number) => {
          if (facility.placement === 'fence') return fenceFrameByMask[fenceMaskAt(x, y)]
          if (facility.placement === 'pond') return pondFrameByCorner[15]
          if (facility.placement === 'directional') return facilityDirection % facility.frames
          return 0
        }
        // 設備スプライトは原作のオブジェクトセルを基準にし、imageOffsets はそのセルからの
        // 相対で抽出している。オブジェクトセルは通常はカーソルのタイル(フンスイは中心 = カーソル)、
        // 建物 2 種はショップと同じスプライトで footprint の中心タイルになる
        const facilityImagePosition = (facility: Facility, frame: number, x: number, y: number) => {
          const offsets = facilityOffsets(facility)
          const offset = offsets[frame] ?? offsets[0]
          const base = facility.placement === 'building'
            ? point(x + Math.floor(facility.width / 2), y - Math.floor(facility.height / 2))
            : point(x, y)
          return { x: base.x - offset.x, y: base.y - offset.y }
        }
        const setFacilityFrame = (x: number, y: number, frame: number) => {
          const placed = facilityAt(x, y)
          if (!placed || frame < 0 || frame === placed.frame) return
          placed.frame = frame
          const position = facilityImagePosition(placed.facility, frame, x, y)
          placed.image.setTexture(facilityTexture(placed.facility, frame)).setPosition(position.x, position.y)
          if (facilityUseOf(placed.facility)) rebuildFacilitySpots()
        }
        const removeFacility = (x: number, y: number) => {
          const placed = facilityAt(x, y)
          if (!placed) return
          // 利用中・利用に向かっている客はその場に戻して徘徊を再開させる
          guests.forEach((guest) => {
            if (guest.facility?.spot.key !== tileKey(x, y)) return
            occupiedSpotTiles.delete(tileKey(guest.facility.spot.tile.x, guest.facility.spot.tile.y))
            guest.image.setVisible(true)
            guest.phase = 'walking'
            const front = guest.facility.front
            guest.fromX = front.x
            guest.fromY = front.y
            guest.toX = front.x
            guest.toY = front.y
            guest.previousX = front.x
            guest.previousY = front.y
            guest.progress = 0
            guest.facility = null
          })
          placed.image.destroy()
          placedFacilities.delete(tileKey(x, y))
          rebuildFacilitySpots()
          const origin = facilityOrigin(placed.facility, x, y)
          // origin は前(下)左タイルなので、奥(上)左に直してから解除する
          markFootprint({
            x: origin.x,
            y: origin.y - placed.facility.height + 1,
            width: placed.facility.width,
            height: placed.facility.height,
          }, false)
        }
        const refreshFenceTile = (x: number, y: number) => {
          if (!isFenceAt(x, y)) return
          setFacilityFrame(x, y, fenceFrameByMask[fenceMaskAt(x, y)])
        }
        // イケは 8 近傍から 4 隅のマスクを組み立て、隅を共有する 3 マスにも同じ隅を伝える
        const refreshPondTile = (x: number, y: number) => {
          if (!isPondAt(x, y)) return
          let bits = 0
          pondNeighbours.forEach(([offsetX, offsetY], index) => {
            if ((pondNeighbourCorner[index] & pondCornerAt(x + offsetX, y + offsetY)) !== 0) bits |= 1 << index
          })
          let mask = 0
          pondCornerNeed.forEach((need, index) => {
            if ((need & bits) === need) mask |= pondCornerBit[index]
          })
          if (mask === 0) {
            removeFacility(x, y)
            return
          }
          setFacilityFrame(x, y, pondFrameByCorner[mask])
          pondCornerBit.forEach((bit, index) => {
            if ((mask & bit) === 0) return
            pondCornerShare[index].forEach(([offsetX, offsetY, shared]) => {
              const corner = pondCornerAt(x + offsetX, y + offsetY)
              if (corner === 0) return
              setFacilityFrame(x + offsetX, y + offsetY, pondFrameByCorner[corner | shared])
            })
          })
        }
        const canPlaceFacilityTile = (facility: Facility, x: number, y: number) => (
          isPondAt(x, y) ? facility.placement === 'pond' : canPlaceAttraction(facilityFootprint(facility), x, y)
        )
        const canPlaceFacility = (facility: Facility, x: number, y: number) => {
          if (facility.placement === 'building' && placedBuildings.has(facility.id)) return false
          // イケは 1 回の設置で中心とその 8 近傍が水面になるため、3 × 3 が空いている必要がある
          if (facility.placement === 'pond') {
            for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
              for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                if (!canPlaceFacilityTile(facility, x + offsetX, y + offsetY)) return false
                if (heightAt(x + offsetX, y + offsetY) !== heightAt(x, y)) return false
              }
            }
            return true
          }
          const origin = facilityOrigin(facility, x, y)
          return canPlaceAttraction(facilityFootprint(facility), origin.x, origin.y)
        }
        const addFacility = (facility: Facility, frame: number, x: number, y: number) => {
          const origin = facilityOrigin(facility, x, y)
          // origin は前(下)左タイルなので、奥(上)左に直してから登録する
          markFootprint({
            x: origin.x,
            y: origin.y - facility.height + 1,
            width: facility.width,
            height: facility.height,
          }, true)
          const position = facilityImagePosition(facility, frame, x, y)
          const image = this.add.image(position.x, position.y, facilityTexture(facility, frame)).setOrigin(0)
            .setDepth(renderDepthAt('facility', origin.x, origin.y))
          placedFacilities.set(tileKey(x, y), { facility, frame, image, used: 0, trash: 0 })
          rebuildFacilitySpots()
        }
        const placePond = (facility: Facility, x: number, y: number) => {
          const full = pondFrameByCorner[15]
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              if (isPondAt(x + offsetX, y + offsetY)) setFacilityFrame(x + offsetX, y + offsetY, full)
              else addFacility(facility, full, x + offsetX, y + offsetY)
            }
          }
          refreshPondTile(x, y)
          pondNeighbours.forEach(([offsetX, offsetY]) => refreshPondTile(x + offsetX, y + offsetY))
        }
        const placeFacility = () => {
          const facility = activeFacility
          if (!facility || facilityStep !== 'body') return
          const { x, y } = cursorPosition
          if (!canPlaceFacility(facility, x, y)) {
            buildMessageHandler.current(
              facility.placement === 'building' && placedBuildings.has(facility.id) ? 'すでに設置されています。'
                : currentCash < facility.constructionCost ? '資金が足りないので設置できません。'
                  : 'その場所には設置できません。')
            return
          }
          buildMessageHandler.current('')
          // 設置費を課金。柵はドラッグ 1 マスごと、イケは 1 回の設置ごとに 1 回課金される
          currentCash -= facility.constructionCost
          facilityPlacedHandler.current(facility.constructionCost)
          parkValue += facility.constructionCost
          if (facility.placement === 'pond') {
            placePond(facility, x, y)
            drawCursor()
            return
          }
          addFacility(facility, facilityFrameAt(facility, x, y), x, y)
          if (facility.placement === 'fence') {
            refreshFenceTile(x, y)
            refreshFenceTile(x + 1, y)
            refreshFenceTile(x - 1, y)
            refreshFenceTile(x, y + 1)
            refreshFenceTile(x, y - 1)
          }
          if (facility.placement === 'building') placedBuildings.add(facility.id)
          if (facility.placement === 'directional') {
            pendingFacility = { x, y }
            facilityStep = 'direction'
            facilityStepHandler.current('direction')
            drawFacilityArrow()
          }
          drawCursor()
        }
        // 向き番号(0=手前 1=奥 2=左 3=右)をタイルの進み方向に直す。ショップ・設備で共通
        const directionStep = (direction: number) => (
          { 0: { x: 0, y: 1 }, 1: { x: 0, y: -1 }, 2: { x: -1, y: 0 }, 3: { x: 1, y: 0 } }[direction] ?? { x: 0, y: 1 }
        )
        // 客が利用できる設備(ゴミバコ・トイレ・スーパートイレ・ベンチ)の
        // 「立ち位置 → 利用マス」対応表。立ち位置は設備の向きの正面 1 マスで、
        // ベンチは向いている側の 1 列(2 席)がそれぞれ席になる
        type FacilityUseKind = 'trash' | 'toilet' | 'bench'
        type FacilitySpot = { key: string, kind: FacilityUseKind, tile: { x: number, y: number } }
        const facilitySpots = new Map<string, FacilitySpot>()
        const occupiedSpotTiles = new Set<string>()
        const facilityUseOf = (facility: Facility) => ('use' in facility ? facility.use : null)
        const facilityCapacityOf = (facility: Facility) => {
          const use = facilityUseOf(facility)
          return use && 'capacity' in use ? use.capacity ?? Infinity : Infinity
        }
        const facilityTrashCapacityOf = (facility: Facility) => {
          const use = facilityUseOf(facility)
          return use && 'trashCapacity' in use ? use.trashCapacity ?? 0 : 0
        }
        const rebuildFacilitySpots = () => {
          facilitySpots.clear()
          for (const [key, placed] of placedFacilities) {
            const use = facilityUseOf(placed.facility)
            if (!use) continue
            const { x, y } = parseKey(key)
            const step = directionStep(placed.frame)
            const tiles = use.kind === 'bench'
              ? (placed.frame === 0 ? [{ x, y }, { x: x + 1, y }]
                : placed.frame === 1 ? [{ x, y: y - 1 }, { x: x + 1, y: y - 1 }]
                  : placed.frame === 2 ? [{ x, y: y - 1 }, { x, y }]
                    : [{ x: x + 1, y: y - 1 }, { x: x + 1, y }])
              : [{ x, y }]
            tiles.forEach((tile) => {
              facilitySpots.set(tileKey(tile.x + step.x, tile.y + step.y), { key, kind: use.kind as FacilityUseKind, tile })
            })
          }
        }
        const drawFacilityArrow = () => {
          const facility = activeFacility
          shopArrow.clear()
          if (facilityStep !== 'direction' || !pendingFacility || !facility) {
            shopArrow.setVisible(false)
            return
          }
          const step = directionStep(facilityDirection)
          const centerX = pendingFacility.x + facility.width / 2 + step.x
          const centerY = pendingFacility.y - facility.height / 2 + 1 + step.y
          const sideX = -step.y
          const sideY = step.x
          const arrow = () => {
            const q = (along: number, side: number) => {
              const projected = point(centerX + step.x * along + sideX * side, centerY + step.y * along + sideY * side)
              return new Phaser.Geom.Point(projected.x, projected.y)
            }
            return [q(0.4, 0), q(-0.32, 0.34), q(-0.32, -0.34)]
          }
          shopArrow.setVisible(true)
          shopArrow.fillStyle(0xffe36e, 0.75)
          shopArrow.fillPoints(arrow(), true)
          shopArrow.lineStyle(1, 0xffe36e, 0.85)
          shopArrow.strokePoints(arrow(), true, true)
        }
        const setFacilityDirection = (direction: number) => {
          const facility = activeFacility
          if (!facility || facilityStep !== 'direction' || !pendingFacility) return
          if (direction >= facility.frames) return
          facilityDirection = direction
          setFacilityFrame(pendingFacility.x, pendingFacility.y, direction)
          drawFacilityArrow()
        }
        const facilityDirectionAtPointer = (px: number, py: number) => {
          const facility = activeFacility
          if (!facility || !pendingFacility) return facilityDirection
          const centerTileX = pendingFacility.x + facility.width / 2
          const centerTileY = pendingFacility.y - facility.height / 2 + 1
          const center = point(centerTileX, centerTileY)
          const pointerAngle = Math.atan2(py - center.y, px - center.x)
          let best = facilityDirection
          let bestDelta = Infinity
          for (let direction = 0; direction < facility.frames; direction += 1) {
            const step = directionStep(direction)
            // 方向はタイル座標で 1 マス進めてから投影する(画面座標を再投影しない)
            const target = point(centerTileX + step.x, centerTileY + step.y)
            const angle = Math.atan2(target.y - center.y, target.x - center.x)
            const delta = Math.abs(Phaser.Math.Angle.Wrap(angle - pointerAngle))
            if (delta < bestDelta) { bestDelta = delta; best = direction }
          }
          return best
        }
        const finishFacilityDirection = () => {
          if (facilityStep !== 'direction') return
          pendingFacility = null
          facilityStep = 'body'
          facilityStepHandler.current('body')
          drawFacilityArrow()
          drawCursor()
        }
        const cancelFacilityDirection = () => {
          if (facilityStep !== 'direction' || !pendingFacility || !activeFacility) return
          removeFacility(pendingFacility.x, pendingFacility.y)
          // 向き選択を取り消したら設置費を払い戻す(ショップと同じ)
          currentCash += activeFacility.constructionCost
          attractionCancelledHandler.current(activeFacility.constructionCost)
          finishFacilityDirection()
        }
        // ショップの前の道になるマス。中心から向いている方向へ footprint 前端まで
        const shopWalkwayTiles = (shop: Shop, shopX: number, shopY: number, direction: number) => {
          const step = directionStep(direction)
          const centerX = shopX + Math.floor(shop.width / 2)
          const centerY = shopY + Math.floor(shop.height / 2)
          const reach = Math.floor((direction < 2 ? shop.height : shop.width) / 2)
          const tiles: Array<{ x: number, y: number }> = []
          for (let i = 0; i <= reach; i += 1) tiles.push({ x: centerX + step.x * i, y: centerY + step.y * i })
          return tiles
        }
        const shopRoadPreview: Phaser.GameObjects.Image[] = []
        // 設置プレビューと向き選びの間、ショップ前に敷かれる道も見せる
        const drawShopWalkwayPreview = () => {
          shopRoadPreview.forEach((image) => image.setVisible(false))
          const shop = activeShop
          if (!shop) return
          let tiles: Array<{ x: number, y: number }>
          let valid = true
          if (shopStep === 'direction' && pendingShop) {
            tiles = shopWalkwayTiles(shop, pendingShop.x, pendingShop.y, shopDirection)
          }
          else {
            const origin = attractionOriginAtCursor(shop)
            tiles = shopWalkwayTiles(shop, origin.x, origin.y - shop.height + 1, shopDirection)
            valid = canPlaceAttraction(shop, origin.x, origin.y)
          }
          const strip = new Set(tiles.map(({ x, y }) => tileKey(x, y)))
          const connected = (x: number, y: number) => strip.has(tileKey(x, y)) || hasRoadConnection(x, y)
          tiles.forEach((tile, index) => {
            const mask = (connected(tile.x + 1, tile.y) ? 1 : 0)
              | (connected(tile.x - 1, tile.y) ? 2 : 0)
              | (connected(tile.x, tile.y + 1) ? 4 : 0)
              | (connected(tile.x, tile.y - 1) ? 8 : 0)
            const image = shopRoadPreview[index] ?? this.add.image(0, 0, 'road-frame-0').setOrigin(0)
            if (!shopRoadPreview[index]) shopRoadPreview.push(image)
            const position = point(tile.x, tile.y)
            seasonFrame(image.setTexture(`road-frame-${roadFrameByMask[mask]}`).setPosition(position.x, position.y)
              .setDepth(renderDepthAt('road', tile.x, tile.y)).setVisible(true)
              .setAlpha(valid ? 1 : 0.55).setTint(valid ? 0xffffff : 0xff6048))
          })
        }
        const drawCursor = () => {
          cursor.clear()
          const attraction = activeAttraction
          const shop = activeShop
          const placingShopBody = shop && shopStep === 'body'
          const placingBody = attraction && activeAttractionBuildStep === 'body'
          // 出入口変更のときは選んでいるアトラクションが無いので、置きかけの実体で判断する
          const placingAccess = Boolean(pendingAttraction) && activeAttractionBuildStep !== 'body'
          // 設備もアトラクション/ショップと同じプレビュー経路に載せる(設置予定地に実物を表示)
          const placingFacility = activeFacility && facilityStep === 'body' ? activeFacility : null
          const facilityFrame = placingFacility ? facilityFrameAt(placingFacility, cursorPosition.x, cursorPosition.y) : 0
          const footprint: Footprint | null = placingBody
            ? attraction
            : placingShopBody
              ? shop
              : placingFacility
                ? facilityFootprint(placingFacility)
                : null
          const previewImage = placingBody
            ? {
              key: attractionFrameKey(attractionForm(attraction).id, idleGroupOf(attractionForm(attraction)).from),
              offset: attractionForm(attraction).imageOffset,
            }
            : placingShopBody
              ? { key: `shop-${shop.id}-${shopDirection}`, offset: shop.imageOffsets[shopDirection] }
              : placingFacility
                ? {
                  key: facilityTexture(placingFacility, facilityFrame),
                  offset: facilityOffsets(placingFacility)[facilityFrame] ?? facilityOffsets(placingFacility)[0],
                }
                : null
          const attractionOrigin = footprint ? attractionOriginAtCursor(footprint) : null
          const valid = routeStaff
            ? routeTiles.some((tile) => tile.x === cursorPosition.x && tile.y === cursorPosition.y)
              || canToggleRouteTile(cursorPosition.x, cursorPosition.y)
            : movingStaff
            ? canPlaceStaffType(movingStaff.type, cursorPosition.x, cursorPosition.y)
            : activeStaffType
            ? canPlaceStaffType(activeStaffType, cursorPosition.x, cursorPosition.y)
            : placingFacility
            ? canPlaceFacility(placingFacility, cursorPosition.x, cursorPosition.y)
            : footprint && attractionOrigin
              ? canPlaceAttraction(footprint, attractionOrigin.x, attractionOrigin.y)
              : placingAccess
                ? canPlaceAccess(cursorPosition.x, cursorPosition.y)
                : activeRoadBuildMode === 'path'
                  ? canPlacePath(cursorPosition.x, cursorPosition.y)
                  : activeRoadBuildMode === 'queue'
                    ? canPlaceQueue(cursorPosition.x, cursorPosition.y)
                    : activeRoadBuildMode === 'stairs'
                      ? canPlaceStairs(cursorPosition.x, cursorPosition.y)
                      : true
          const color = valid ? 0xffef70 : 0xff6048
          cursor.fillStyle(color, 0.2)
          cursor.lineStyle(1, color, 1)
          const width = footprint ? footprint.width : 1
          const height = footprint ? footprint.height : 1
          const cursorAreaOrigin = placingFacility
            ? facilityOrigin(placingFacility, cursorPosition.x, cursorPosition.y)
            : attractionOrigin ?? cursorPosition
          for (let offsetY = 0; offsetY < height; offsetY += 1) {
            for (let offsetX = 0; offsetX < width; offsetX += 1) {
              const tile = point(cursorAreaOrigin.x + offsetX, cursorAreaOrigin.y - offsetY)
              const origin = point(cursorPosition.x, cursorPosition.y)
              const translated = cursorShape.map(({ x, y }) => new Phaser.Geom.Point(tile.x - origin.x + x, tile.y - origin.y + y))
              cursor.fillPoints(translated, true)
              cursor.strokePoints(translated, true)
            }
          }
          drawShopWalkwayPreview()
          buildBasePreview.forEach((image) => image.setVisible(false))
          // 盛り上げベースのプレビューはアトラクションのみ(ショップ・施設は不要)
          if (placingBody && footprint && attractionOrigin) {
            const previewGround = attractionGround(attraction)
            let previewIndex = 0
            for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
              for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
                const rowFromTop = footprint.height - offsetY - 1
                const water = previewGround === 'water'
                  && isWaterTile(offsetX, rowFromTop, footprint.width, footprint.height)
                const frame = water
                  ? waterFrameAt(offsetX, rowFromTop, footprint.width, footprint.height)
                  : buildBaseFrameAt(offsetX, rowFromTop, footprint.width, footprint.height)
                const key = water ? facilityTexture(pondFacility, frame) : `build-base-frame-${frame}`
                const offset = water ? facilityOffsets(pondFacility)[frame] ?? facilityOffsets(pondFacility)[0] : { x: 0, y: 0 }
                const image = buildBasePreview[previewIndex] ?? this.add.image(0, 0, key).setOrigin(0)
                if (!buildBasePreview[previewIndex]) buildBasePreview.push(image)
                const tile = point(attractionOrigin.x + offsetX, attractionOrigin.y - offsetY)
                seasonFrame(image.setTexture(key).setPosition(tile.x - offset.x, tile.y - offset.y).setVisible(true)
                  .setDepth(terrainPieceDepth(attractionOrigin.x + offsetX, attractionOrigin.y - offsetY))
                  .setAlpha(valid ? 1 : 0.55).setTint(valid ? 0xffffff : 0xff6048))
                previewIndex += 1
              }
            }
          }
          if (!previewImage) {
            attractionPreview?.setVisible(false)
          }
          else if (!attractionPreview || attractionPreview.texture.key !== previewImage.key) {
            attractionPreview?.destroy()
            attractionPreview = this.add.image(0, 0, previewImage.key).setOrigin(0)
          }
          if (footprint && previewImage && attractionPreview && attractionOrigin) {
            // 設備は placeFacility と同じオブジェクトセル基準、アトラクション/ショップは中心基準
            const position = placingFacility
              ? facilityImagePosition(placingFacility, facilityFrame, attractionOrigin.x, attractionOrigin.y)
              : attractionImagePosition(footprint, previewImage.offset, attractionOrigin.x, attractionOrigin.y)
            attractionPreview.setPosition(position.x, position.y).setVisible(true)
              .setDepth(renderDepthAt('facility', attractionOrigin.x, attractionOrigin.y))
              .setAlpha(valid ? 0.7 : 0.4).setTint(valid ? 0xffffff : 0xff6048)
          }
          // 階段は設置予定地に半透明のプレビューを出し、確定時に実体化する。
          // 置けないマスでも赤みがかった半透明で表示する
          stairsPreview?.setVisible(false)
          if (activeRoadBuildMode === 'stairs' && stairsStep === 'body') {
            const stairsValid = canPlaceStairs(cursorPosition.x, cursorPosition.y)
            const option = stairsDirectionAt(cursorPosition.x, cursorPosition.y) ?? stairsDirections[0]
            const tile = point(cursorPosition.x, cursorPosition.y)
            const offset = terrainObjects.stairs[sceneryKind][option.frame]
            const key = `terrain-stairs-${option.frame}-s${seasonIndex}`
            if (!stairsPreview) stairsPreview = this.add.image(0, 0, key).setOrigin(0)
            stairsPreview.setTexture(key).setPosition(tile.x - offset.x, tile.y - offset.y)
              .setDepth(roadPieceDepth(cursorPosition.x, cursorPosition.y))
              .setVisible(true).setAlpha(stairsValid ? 0.7 : 0.4).setTint(stairsValid ? 0xffffff : 0xff6048)
          }
          // ポインタはメニューやダイアログが開いている間は隠す(原作のフラグ 0x8000 相当)
          const pointerConfig = activeRoadBuildMode || attraction || shop || activeFacility
            || activeStaffType || movingStaff || routeStaff || relocatingAccess
            ? { key: 'pointer-shovel', offset: pointers.shovel.offset }
            : { key: 'pointer-arrow', offset: pointers.arrow.offset }
          const pointerBase = point(cursorPosition.x, cursorPosition.y)
          pointer.setTexture(pointerConfig.key)
            .setPosition(pointerBase.x - pointerConfig.offset.x, pointerBase.y - pointerConfig.offset.y)
            .setVisible(mapInteractive)
          accessPreview?.setVisible(false)
          if (placingAccess && pendingAttraction) {
            const accessStep = activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit'
            const frame = entranceFrameForSide[accessSide]
            const key = `facility-${accessStep}-frame-${frame}`
            if (!accessPreview) accessPreview = this.add.image(0, 0, key).setOrigin(0)
            const drawn = accessDrawTile(accessStep, cursorPosition.x, cursorPosition.y, frame)
            const tile = point(drawn.x, drawn.y)
            const [offsetX, offsetY] = accessStep === 'entrance'
              ? [tileWidth / 2, stepY]
              : accessOffsetAt(accessStep, frame)
            seasonFrame(accessPreview.setTexture(key).setOrigin(accessStep === 'entrance' ? 0.5 : 0, accessStep === 'entrance' ? 1 : 0)
              .setPosition(tile.x + offsetX, tile.y + offsetY)
              .setDepth(renderDepthAt('facility', drawn.x, drawn.y))
              .setVisible(true).setAlpha(valid ? 1 : 0.55).setTint(valid ? 0xffffff : 0xff6048))
          }
          // つまんでいるスタッフはカーソルに付いてくる
          if (movingStaff) holdStaffAtCursor(movingStaff, cursorPosition.x, cursorPosition.y)
          // 清掃ルートを編集している間、選んだマスに丸印を出す
          routeGraphics.clear()
          if (routeStaff) {
            routeGraphics.fillStyle(0x4ade80, 0.85)
            routeTiles.forEach((tile) => {
              const position = point(tile.x + 0.5, tile.y + 0.5)
              routeGraphics.fillCircle(position.x, position.y, 4)
            })
          }
        }
        // カメラ追従に使う、マスに丸める前のカーソル位置(画面座標)
        const cursorTrack = { x: 0, y: 0 }
        const setCursorTile = (x: number, y: number) => {
          // カーソルが動けるのは設置できる範囲まで。上は敷地の上端、下は園外の 3 行目
          cursorPosition.x = Phaser.Math.Clamp(x, left, right)
          cursorPosition.y = Phaser.Math.Clamp(y, top, buildBottomRow)
          const position = point(cursorPosition.x, cursorPosition.y)
          cursor.setPosition(position.x, position.y)
          drawCursor()
          return position
        }
        const placeCursor = (x: number, y: number) => {
          const position = setCursorTile(x, y)
          cursorTrack.x = position.x
          cursorTrack.y = position.y
        }
        placeCursor(cursorPosition.x, cursorPosition.y)

        const camera = this.cameras.main
        // カメラの追従範囲。下は園外の設置範囲までカバーする
        const cameraTopRow = top - game.park.cameraMarginTiles.top
        const cameraBottomRow = gridHeight - 2
        const focus = point(gateCenter, gateRow + 1)
        const cameraTopLeft = point(left, cameraTopRow)
        const cameraBottomRight = point(right, cameraBottomRow)
        // 狭い画面では等倍で始める。拡大したままだと数マスしか見えない
        const initialZoom = camera.width < game.park.narrowViewportWidth
          ? game.park.minDisplayScale
          : game.park.displayScale
        camera
          .setZoom(initialZoom)
          .setBounds(
            cameraTopLeft.x,
            cameraTopLeft.y,
            cameraBottomRight.x - cameraTopLeft.x + tileWidth,
            cameraBottomRight.y - cameraTopLeft.y + stepY,
          )
          .centerOn(focus.x, focus.y)

        // 境界外に出た時だけ scrollX/Y を書き換える。境界内で毎回書き換えると、
        // viewInsetY が非整数のときに Phaser 内部の丸めで値が少しずつずれてしまう
        const clampCameraToMap = () => {
          const viewWidth = camera.width / camera.zoom
          const viewHeight = camera.height / camera.zoom
          const viewInsetX = (camera.width - viewWidth) / 2
          const viewInsetY = (camera.height - viewHeight) / 2
          const maxViewTop = cameraBottomRight.y + stepY - viewHeight
          const currentViewTop = camera.scrollY + viewInsetY
          if (currentViewTop < cameraTopLeft.y) camera.scrollY = Math.round(cameraTopLeft.y - viewInsetY)
          else if (currentViewTop > maxViewTop) camera.scrollY = Math.round(maxViewTop - viewInsetY)

          const rowAt = (screenY: number) => (screenY - padding) / stepY
          const sideMargin = game.park.cameraMarginTiles.side * stepX
          const viewTop = camera.scrollY + viewInsetY
          const minViewLeft = padding + left * stepX + rowAt(viewTop) * rowOffsetX - sideMargin
          const maxViewLeft = padding + right * stepX + rowAt(viewTop + viewHeight) * rowOffsetX + tileWidth - viewWidth + sideMargin
          if (minViewLeft <= maxViewLeft) {
            const currentViewLeft = camera.scrollX + viewInsetX
            if (currentViewLeft < minViewLeft) camera.scrollX = Math.round(minViewLeft - viewInsetX)
            else if (currentViewLeft > maxViewLeft) camera.scrollX = Math.round(maxViewLeft - viewInsetX)
          }
          else camera.scrollX = Math.round((minViewLeft + maxViewLeft) / 2 - viewInsetX)
        }
        // 動かした軸だけカメラを追従させる。左右で動いても地図座標の縦は変わらないが、
        // 画面サイズによって scrollY が非整数になり、両軸を毎回触ると丸め誤差で少しずつずれる
        const keepCursorVisible = (axis?: 'x' | 'y') => {
          const viewWidth = camera.width / camera.zoom
          const viewHeight = camera.height / camera.zoom
          const viewInsetX = (camera.width - viewWidth) / 2
          const viewInsetY = (camera.height - viewHeight) / 2
          const margin = game.park.cursorCameraMarginTiles * tileWidth
          const position = point(cursorPosition.x, cursorPosition.y)
          if (axis !== 'y') {
            const viewLeft = camera.scrollX + viewInsetX
            if (position.x < viewLeft + margin) camera.scrollX = Math.round(camera.scrollX - (viewLeft + margin - position.x))
            else if (position.x + stepX > viewLeft + viewWidth - margin) camera.scrollX = Math.round(camera.scrollX + position.x + stepX - (viewLeft + viewWidth - margin))
          }
          if (axis !== 'x') {
            const viewTop = camera.scrollY + viewInsetY
            if (position.y < viewTop + margin) camera.scrollY = Math.round(camera.scrollY - (viewTop + margin - position.y))
            else if (position.y + stepY > viewTop + viewHeight - margin) camera.scrollY = Math.round(camera.scrollY + position.y + stepY - (viewTop + viewHeight - margin))
          }
          clampCameraToMap()
        }
        // 入口・出口を置いている間は、カーソルを敷地の縁だけに沿って動かす。
        // 辺に沿った端まで来たら向きだけ変わり、辺をまたぐ入力では対辺へ渡る(角は隣の辺へ 1 マス)
        const accessRingAtStep = () => {
          const facility = pendingAttraction
          if (!facility) return null
          return accessRingOf(facility, activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit')
        }
        const moveAccessCursor = (direction: 'left' | 'right' | 'up' | 'down') => {
          const ring = accessRingAtStep()
          if (!ring) return
          const horizontalEdge = accessSide === 'top' || accessSide === 'bottom'
          const horizontalInput = direction === 'left' || direction === 'right'
          const delta = direction === 'left' || direction === 'up' ? -1 : 1
          // 辺に沿った位置。上下の辺なら x、左右の辺なら y
          let along = horizontalEdge ? cursorPosition.x : cursorPosition.y
          const across = horizontalEdge ? cursorPosition.y : cursorPosition.x
          const span = accessSpanOf(ring, accessSide)
          const opposite: AccessSide = horizontalEdge
            ? (accessSide === 'top' ? 'bottom' : 'top')
            : (accessSide === 'left' ? 'right' : 'left')
          if (horizontalInput === horizontalEdge) {
            const next = along + delta
            if (next >= span.min && next <= span.max) along = next
            else {
              // 端まで来ていたら、その端にある辺へ向きだけ変える
              const turned: AccessSide = horizontalEdge
                ? (delta < 0 ? 'left' : 'right')
                : (delta < 0 ? 'top' : 'bottom')
              const turnedSpan = accessSpanOf(ring, turned)
              accessSide = turned
              along = Phaser.Math.Clamp(across, turnedSpan.min, turnedSpan.max)
            }
          }
          else {
            // 角にいるなら隣の辺へ 1 マス、そうでなければ対辺へ渡る
            const corner: AccessSide | null = !ring.corners ? null
              : horizontalEdge
                ? (along === ring.left ? 'left' : along === ring.right ? 'right' : null)
                : (along === ring.top ? 'top' : along === ring.bottom ? 'bottom' : null)
            const cornerSpan = corner ? accessSpanOf(ring, corner) : null
            const stepped = across + delta
            if (corner && cornerSpan && stepped >= cornerSpan.min && stepped <= cornerSpan.max) {
              accessSide = corner
              along = stepped
            }
            else {
              accessSide = opposite
            }
          }
          const tile = accessTileOf(ring, accessSide, along)
          placeCursor(tile.x, tile.y)
          keepCursorVisible(direction === 'left' || direction === 'right' ? 'x' : 'y')
        }
        // マウスは指した向きの辺へ寄せる。角のマスはどの辺としても選べるので、
        // マスの近さではなく「どちら側にはみ出しているか」で辺を決める
        const snapAccessCursor = (x: number, y: number) => {
          const ring = accessRingAtStep()
          if (!ring) return
          const outwardness: Record<AccessSide, number> = {
            top: ring.top - y,
            bottom: y - ring.bottom,
            left: ring.left - x,
            right: x - ring.right,
          }
          const side = accessSides
            .filter((candidate) => {
              const range = accessSpanOf(ring, candidate)
              return range.min <= range.max
            })
            .reduce((chosen, candidate) => outwardness[candidate] > outwardness[chosen] ? candidate : chosen)
          const span = accessSpanOf(ring, side)
          const along = Phaser.Math.Clamp(side === 'top' || side === 'bottom' ? x : y, span.min, span.max)
          const tile = accessTileOf(ring, side, along)
          accessSide = side
          placeCursor(tile.x, tile.y)
        }
        const moveCursor = (direction: MenuAction) => {
          const nextX = Phaser.Math.Clamp(
            cursorPosition.x + (direction === 'left' ? -1 : direction === 'right' ? 1 : 0),
            left,
            right,
          )
          const nextY = Phaser.Math.Clamp(
            cursorPosition.y + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0),
            top,
            buildBottomRow,
          )
          placeCursor(nextX, nextY)
          keepCursorVisible(direction === 'left' || direction === 'right' ? 'x' : 'y')
        }
        // 階段の絵。重ね順は自分のマスの道路と同じ扱い
        const stairsImage = (x: number, y: number, direction: StairsDirection) => {
          const tile = point(x, y)
          const offset = terrainObjects.stairs[sceneryKind][direction.frame]
          return this.add.image(tile.x - offset.x, tile.y - offset.y, `terrain-stairs-${direction.frame}-s${seasonIndex}`)
            .setOrigin(0).setDepth(roadPieceDepth(x, y))
        }
        // 階段を置く。設置操作とセーブデータからの復元で共通に使う
        const addStairs = (x: number, y: number, direction = stairsDirectionAt(x, y), image?: Phaser.GameObjects.Image) => {
          if (!direction) return null
          const placed: PlacedStairs = {
            x, y, dx: direction.dx, dy: direction.dy,
            images: [image ?? stairsImage(x, y, direction)],
          }
          stairsTiles.set(tileKey(x, y), placed)
          redrawRoadTiles(x, y)
          redrawRoadTiles(x + direction.dx, y + direction.dy)
          return placed
        }
        // 向き番号(0=手前 1=奥 2=左 3=右)は「降りる方向」の指定として受け取り、
        // その反対側を上り方向にする。上れない向きは無視する。
        // どちら向きに使うかは人によるので、方向を示す矢印は出さずプレビューの絵だけで見せる
        const setStairsDirection = (direction: number) => {
          if (stairsStep !== 'direction' || !pendingStairs) return
          const step = directionStep(direction)
          const option = stairsOptionsAt(pendingStairs.x, pendingStairs.y)
            .find((candidate) => candidate.dx === -step.x && candidate.dy === -step.y)
          if (!option || option === pendingStairs.direction) return
          pendingStairs.image.destroy()
          pendingStairs.direction = option
          pendingStairs.image = stairsImage(pendingStairs.x, pendingStairs.y, option).setAlpha(0.7)
        }
        const stairsDirectionAtPointer = (px: number, py: number) => {
          if (!pendingStairs) return 0
          const center = point(pendingStairs.x + 0.5, pendingStairs.y + 0.5)
          const pointerAngle = Math.atan2(py - center.y, px - center.x)
          let best = 0
          let bestDelta = Infinity
          for (let direction = 0; direction < 4; direction += 1) {
            const step = directionStep(direction)
            const target = point(pendingStairs.x + 0.5 + step.x, pendingStairs.y + 0.5 + step.y)
            const angle = Math.atan2(target.y - center.y, target.x - center.x)
            const delta = Math.abs(Phaser.Math.Angle.Wrap(angle - pointerAngle))
            if (delta < bestDelta) {
              bestDelta = delta
              best = direction
            }
          }
          return best
        }
        const finishStairsDirection = () => {
          if (stairsStep !== 'direction' || !pendingStairs) return
          pendingStairs.image.setAlpha(1)
          addStairs(pendingStairs.x, pendingStairs.y, pendingStairs.direction, pendingStairs.image)
          pendingStairs = null
          stairsStep = 'body'
          stairsStepHandler.current('body')
          drawCursor()
        }
        const cancelStairsDirection = () => {
          if (stairsStep !== 'direction' || !pendingStairs) return
          pendingStairs.image.destroy()
          pendingStairs = null
          stairsStep = 'body'
          stairsStepHandler.current('body')
          drawCursor()
        }
        const placeStairs = () => {
          const { x, y } = cursorPosition
          if (!canPlaceStairs(x, y)) {
            buildMessageHandler.current('その場所には設置できません。')
            return
          }
          buildMessageHandler.current('')
          const options = stairsOptionsAt(x, y)
          if (options.length === 1) {
            addStairs(x, y, options[0])
          }
          else {
            // 上れる方向が複数あるときは向きを選ばせる(確定までは半透明のまま)
            pendingStairs = { x, y, direction: options[0], image: stairsImage(x, y, options[0]).setAlpha(0.7) }
            stairsStep = 'direction'
            stairsStepHandler.current('direction')
          }
          drawCursor()
        }
        const placeRoad = () => {
          const { x, y } = cursorPosition
          const key = tileKey(x, y)
          if (activeRoadBuildMode === 'stairs') {
            placeStairs()
            return
          }
          if (activeRoadBuildMode === 'path') {
            if (!canPlacePath(x, y)) {
              buildMessageHandler.current('その場所には設置できません。')
              return
            }
            buildMessageHandler.current('')
            roads.add(key)
            redrawRoadTiles(x, y)
            redrawQueueTiles(x, y)
          }
          if (activeRoadBuildMode === 'queue') {
            if (!canPlaceQueue(x, y)) {
              buildMessageHandler.current('その場所には設置できません。')
              return
            }
            buildMessageHandler.current('')
            queueRoads.add(key)
            let mask = 0
            queueNeighbors.forEach((neighbor) => {
              if (!sameHeight(x, y, x + neighbor.x, y + neighbor.y)) return
              const neighborKey = tileKey(x + neighbor.x, y + neighbor.y)
              const neighborState = queueStates.get(neighborKey)
              if (neighborState !== undefined && isQueueConnectionTarget(neighborState)) mask |= neighbor.mask
            })
            if (queueStateByMask[mask] === 1) mask = 3
            else if (queueStateByMask[mask] === 2) mask = 12
            const entranceConnection = queueNeighbors
              .map((neighbor) => ({
                neighbor,
                facility: placedAttractions.find((attraction) => (
                  attraction.entrance?.x === x + neighbor.x
                  && attraction.entrance.y === y + neighbor.y
                  && sameHeight(x, y, x + neighbor.x, y + neighbor.y)
                  && !attraction.entranceQueueKey
                )),
              }))
              .find(({ facility }) => facility)
            if (entranceConnection) {
              const state = queueStateByMask[mask]
              if (state === 0 || (state >= 7 && state <= 10)) mask |= entranceConnection.neighbor.mask
              else if (mask & 1) mask = (mask & ~1) | entranceConnection.neighbor.mask
              else mask = entranceConnection.neighbor.mask
              entranceConnection.facility!.entranceQueueKey = key
              entranceConnection.facility!.entranceFrame = entranceConnection.neighbor.entranceFrameFacingBack
            }
            queueStates.set(key, queueStateByMask[mask])
            const connectBackMask = entranceConnection ? mask & ~entranceConnection.neighbor.mask : mask
            queueNeighbors.forEach((neighbor) => {
              if ((connectBackMask & neighbor.mask) === 0) return
              const neighborKey = tileKey(x + neighbor.x, y + neighbor.y)
              const neighborState = queueStates.get(neighborKey)
              if (neighborState === undefined) return
              queueStates.set(neighborKey, queueStateAdding(neighborState, neighbor.reverseMask))
            })
            redrawQueueTiles(x, y)
          }
          drawCursor()
        }
        // ---- 耐久度 ----
        // 設定には施設仕様のバージョン 0 とバージョン 9 の段階(0〜9)を持たせてあるので、
        // 今のバージョンぶんを内挿してから 1 段階あたりの点数を掛けて満杯の値にする
        const breakdownConfig = game.breakdown
        // 原作の 1 日ぶんの更新フレーム数(標準速度)。フレーム単位の値を日数に直すのに使う
        const originalFramesPerDay = game.time.originalFramesPerDay
        const durabilityLimitOf = (attraction: Attraction, version: number) => {
          const level = attraction.durability
            + Math.round((attraction.durabilityMax - attraction.durability) * version / game.facilityMenu.maxVersion)
          return (level + 1) * breakdownConfig.unit
        }
        // アトラクション本体を置く。設置操作とセーブデータからの復元で共通に使う
        const addAttraction = (attraction: Attraction, x: number, y: number) => {
          const bottomX = x
          const bottomY = y + attraction.height - 1
          markFootprint({ x, y, width: attraction.width, height: attraction.height }, true)
          const ground = attractionGround(attraction)
          const baseImages: Phaser.GameObjects.Image[] = []
          for (let offsetY = 0; offsetY < attraction.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < attraction.width; offsetX += 1) {
              const tile = point(x + offsetX, y + offsetY)
              const depth = terrainPieceDepth(x + offsetX, y + offsetY)
              if (ground === 'water' && isWaterTile(offsetX, offsetY, attraction.width, attraction.height)) {
                const frame = waterFrameAt(offsetX, offsetY, attraction.width, attraction.height)
                const offset = facilityOffsets(pondFacility)[frame] ?? facilityOffsets(pondFacility)[0]
                baseImages.push(
                  this.add.image(tile.x - offset.x, tile.y - offset.y, facilityTexture(pondFacility, frame))
                    .setOrigin(0).setDepth(depth),
                )
                continue
              }
              const frame = buildBaseFrameAt(offsetX, offsetY, attraction.width, attraction.height)
              baseImages.push(
                seasonFrame(this.add.image(tile.x, tile.y, `build-base-frame-${frame}`).setOrigin(0).setDepth(depth)),
              )
            }
          }
          // 階段は敷地の中央、踊り場はその 1 マス奥
          if (ground === 'stairs') {
            const centerX = x + (attraction.width >> 1)
            const centerY = y + attraction.height - 1 - (attraction.height >> 1)
            // 使うのは北へ上る階段(コマ 0)と踊り場に流用する南向きのコマ 1 だけ
            terrainObjects.stairs[sceneryKind].slice(0, 2).forEach((offset, index) => {
              const tileY = centerY - index
              const tile = point(centerX, tileY)
              baseImages.push(
                this.add.image(tile.x - offset.x, tile.y - offset.y, `terrain-stairs-${index}-s${seasonIndex}`)
                  .setOrigin(0).setDepth(renderDepthAt('facility', centerX, tileY)),
              )
            })
          }
          const form = attractionForm(attraction)
          const idle = idleGroupOf(form)
          const imagePosition = attractionImagePosition(attraction, form.imageOffset, bottomX, bottomY)
          const image = this.add.image(imagePosition.x, imagePosition.y, attractionFrameKey(form.id, idle.from))
            .setOrigin(0).setDepth(renderDepthAt('facility', bottomX, bottomY))
          const placed: PlacedAttraction = {
            id: attraction.id,
            attraction,
            x,
            y,
            width: attraction.width,
            height: attraction.height,
            cost: attraction.constructionCost,
            capacity: attraction.capacity,
            animFrame: idle.from,
            animRemaining: 0,
            riderPhase: 0,
            riderImages: [],
            rideTimeSetting: attractionUseConfig.rideTimeSetting,
            speedSetting: attraction.speedSetting,
            price: attractionUseConfig.initialPrice,
            rating: 0,
            version: 0,
            durability: durabilityLimitOf(attraction, 0),
            needsRepair: false,
            inspectRequested: false,
            underInspection: false,
            suspended: false,
            usedThisMonth: 0,
            usedLastMonth: 0,
            image,
            imageX: image.x,
            imageY: image.y,
            baseImages,
          }
          placedAttractions.push(placed)
          return placed
        }
        const placeAttraction = () => {
          const attraction = activeAttraction
          if (!attraction) return
          const { x: bottomX, y: bottomY } = attractionOriginAtCursor(attraction)
          if (!canPlaceAttraction(attraction, bottomX, bottomY)) {
            buildMessageHandler.current(currentCash < attraction.constructionCost
              ? '資金が足りないので設置できません。'
              : 'その場所には設置できません。')
            return
          }
          buildMessageHandler.current('')
          const x = bottomX
          const y = bottomY - attraction.height + 1
          pendingAttraction = addAttraction(attraction, x, y)
          currentCash -= attraction.constructionCost
          attractionPlacedHandler.current(attraction.constructionCost)
          parkValue += attraction.constructionCost
          activeAttractionBuildStep = 'entrance'
          // 最初は手前(下)の辺の中央から選ばせる
          accessSide = 'bottom'
          snapAccessCursor(x + Math.floor(attraction.width / 2), bottomY + 1)
          drawCursor()
        }
        // 原作の入口タイル規約: フレーム 0=手前(下), 1=奥(上), 2=左, 3=右
        const directionByPad: Record<'up' | 'right' | 'down' | 'left', number> = { down: 0, up: 1, left: 2, right: 3 }
        // 入口は向きに応じた前面中央の隣接タイル(footprint 外側 1 マス)
        const shopEntranceTile = (shop: Shop, x: number, y: number, direction: number) => {
          const midX = x + Math.floor(shop.width / 2)
          const midY = y + Math.floor(shop.height / 2)
          if (direction === 0) return { x: midX, y: y + shop.height }
          if (direction === 1) return { x: midX, y: y - 1 }
          if (direction === 2) return { x: x - 1, y: midY }
          return { x: x + shop.width, y: midY }
        }
        const updatePendingShopImage = () => {
          const shop = activeShop
          if (!shop || !pendingShop) return
          const { x: bottomX } = pendingShop
          const bottomY = pendingShop.y + shop.height - 1
          const position = attractionImagePosition(shop, shop.imageOffsets[shopDirection], bottomX, bottomY)
          pendingShop.image.setTexture(`shop-${shop.id}-${shopDirection}`).setPosition(position.x, position.y)
        }
        // 設置中の向きを示す矢印。入口(向きに応じた前面隣接タイル)へ向けて描く
        const drawShopArrow = () => {
          const shop = activeShop
          shopArrow.clear()
          if (shopStep !== 'direction' || !pendingShop || !shop) {
            shopArrow.setVisible(false)
            return
          }
          const entrance = shopEntranceTile(shop, pendingShop.x, pendingShop.y, shopDirection)
          // 入口へ「1 タイル外へ出る」向き(タイル座標)。矢印はタイル座標で組んで point() で
          // 投影し、地面(等角平面)に寝かせて描く
          const step = directionStep(shopDirection)
          const cx = entrance.x + 0.5
          const cy = entrance.y + 0.5
          const sx = -step.y // 進行方向に垂直(タイル座標)
          const sy = step.x
          // タイル単位の三角形ポリゴンを地面に投影
          const arrow = () => {
            const tip = 0.4
            const back = -0.32
            const half = 0.34
            const q = (along: number, side: number) => {
              const projected = point(cx + step.x * along + sx * side, cy + step.y * along + sy * side)
              return new Phaser.Geom.Point(projected.x, projected.y)
            }
            return [q(tip, 0), q(back, half), q(back, -half)]
          }
          shopArrow.setVisible(true)
          // 地面に寝た金色三角形 + 薄い縁取り
          shopArrow.fillStyle(0xffe36e, 0.75)
          shopArrow.fillPoints(arrow(), true)
          shopArrow.lineStyle(1, 0xffe36e, 0.85)
          shopArrow.strokePoints(arrow(), true, true)
        }
        // 設置完了時、ショップ中心から向いている方向へ footprint 前端まで歩道を敷く
        // (5×5 なら中心を含め 3 マス)。この道はショップの敷地の一部なので占有マークは残したまま、
        // 見た目と道のつながりだけ歩道として扱う
        const layShopWalkway = (shop: Shop, shopX: number, shopY: number, direction: number) => {
          const laid = shopWalkwayTiles(shop, shopX, shopY, direction)
          laid.forEach(({ x, y }) => {
            roads.add(tileKey(x, y))
            shopRoads.add(tileKey(x, y))
          })
          laid.forEach(({ x, y }) => {
            redrawRoadTiles(x, y)
            redrawQueueTiles(x, y)
          })
        }
        // ショップ本体を置く。設置操作とセーブデータからの復元で共通に使う
        const addShopBody = (shop: Shop, x: number, y: number, direction: number) => {
          const bottomX = x
          const bottomY = y + shop.height - 1
          // ショップは地面の盛り上げベースを敷かない(占有マークのみ)
          markFootprint({ x, y, width: shop.width, height: shop.height }, true)
          const imagePosition = attractionImagePosition(shop, shop.imageOffsets[direction], bottomX, bottomY)
          return this.add.image(imagePosition.x, imagePosition.y, `shop-${shop.id}-${direction}`)
            .setOrigin(0).setDepth(renderDepthAt('facility', bottomX, bottomY))
        }
        // 入口マス→店の対応を引き直す。設置・撤去のたびに全件作り直すことで、
        // 同じ入口マスを共有する店があっても残った店の分が登録され直る
        const rebuildShopEntranceSpots = () => {
          shopEntranceSpots.clear()
          for (const placed of placedShops) {
            const entrance = shopEntranceTile(placed.shop, placed.x, placed.y, placed.direction)
            shopEntranceSpots.set(tileKey(entrance.x, entrance.y), placed)
          }
        }
        // 向きが確定したショップを記録し、前の道を敷く
        const completeShop = (shop: Shop, x: number, y: number, direction: number, image: Phaser.GameObjects.Image) => {
          const prize = shopPrize(shop)
          placedShops.push({
            shop, x, y, direction, image,
            price: game.shopUse.initialPrice, tasteLevel: game.shopUse.tasteLevel, rating: 0,
            prizePrice: prize?.prizePrice ?? 0, winRate: prize?.winRate ?? 0, version: 0,
            usedThisMonth: 0, usedLastMonth: 0,
          })
          layShopWalkway(shop, x, y, direction)
          rebuildShopEntranceSpots()
        }
        const placeShop = () => {
          const shop = activeShop
          if (!shop || shopStep !== 'body') return
          const { x: bottomX, y: bottomY } = attractionOriginAtCursor(shop)
          if (!canPlaceAttraction(shop, bottomX, bottomY)) {
            buildMessageHandler.current(currentCash < shop.constructionCost
              ? '資金が足りないので設置できません。'
              : 'その場所には設置できません。')
            return
          }
          buildMessageHandler.current('')
          const x = bottomX
          const y = bottomY - shop.height + 1
          const image = addShopBody(shop, x, y, shopDirection)
          pendingShop = { x, y, cost: shop.constructionCost, image }
          currentCash -= shop.constructionCost
          shopPlacedHandler.current(shop.constructionCost)
          parkValue += shop.constructionCost
          if (shop.directions > 1) {
            shopStep = 'direction'
            shopStepHandler.current('direction')
            drawShopArrow()
          }
          else {
            completeShop(shop, x, y, shopDirection, image)
            pendingShop = null
            shopCompleteHandler.current()
          }
          drawCursor()
        }
        const setShopDirection = (direction: number) => {
          const shop = activeShop
          if (!shop || shopStep !== 'direction' || direction >= shop.directions) return
          shopDirection = direction
          updatePendingShopImage()
          drawShopArrow()
          drawShopWalkwayPreview()
        }
        const confirmShopDirection = () => {
          const shop = activeShop
          if (shopStep !== 'direction' || !pendingShop || !shop) return
          completeShop(shop, pendingShop.x, pendingShop.y, shopDirection, pendingShop.image)
          pendingShop = null
          shopStep = 'body'
          shopStepHandler.current('body')
          drawShopArrow()
          shopCompleteHandler.current()
          drawCursor()
        }
        const cancelShopDirection = () => {
          const shop = activeShop
          if (shopStep !== 'direction' || !pendingShop || !shop) return
          markFootprint({ x: pendingShop.x, y: pendingShop.y, width: shop.width, height: shop.height }, false)
          pendingShop.image.destroy()
          currentCash += pendingShop.cost
          attractionCancelledHandler.current(pendingShop.cost)
          pendingShop = null
          shopStep = 'body'
          shopStepHandler.current('body')
          drawShopArrow()
          drawCursor()
        }
        // 各向きの入口タイルの画面角度と比較し、ポインタに最も近い向きを選ぶ(等角投影に依らない)
        const shopDirectionAtPointer = (px: number, py: number) => {
          const shop = activeShop
          if (!shop || !pendingShop) return shopDirection
          const center = point(pendingShop.x + shop.width / 2, pendingShop.y + shop.height / 2)
          const pointerAngle = Math.atan2(py - center.y, px - center.x)
          let best = shopDirection
          let bestDelta = Infinity
          for (let direction = 0; direction < shop.directions; direction += 1) {
            const entrance = shopEntranceTile(shop, pendingShop.x, pendingShop.y, direction)
            const target = point(entrance.x + 0.5, entrance.y + 0.5)
            const delta = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(target.y - center.y, target.x - center.x) - pointerAngle))
            if (delta < bestDelta) { bestDelta = delta; best = direction }
          }
          return best
        }
        // 入口・出口の絵を置く。設置操作とセーブデータからの復元で共通に使う
        const addAttractionAccess = (
          accessStep: Exclude<AttractionBuildStep, 'body'>,
          x: number,
          y: number,
          frame: number,
        ) => {
          const drawn = accessDrawTile(accessStep, x, y, frame)
          const tile = point(drawn.x, drawn.y)
          const [offsetX, offsetY] = accessStep === 'entrance'
            ? [tileWidth / 2, stepY]
            : accessOffsetAt(accessStep, frame)
          const image = seasonFrame(this.add.image(
            tile.x + offsetX,
            tile.y + offsetY,
            `facility-${accessStep}-frame-${frame}`,
          ).setOrigin(accessStep === 'entrance' ? 0.5 : 0, accessStep === 'entrance' ? 1 : 0)
            // 入口・出口は設備や建物と同じ扱い。前後は位置だけで決まる。
            // 出口は降りた客が立つマスに描くので、客より奥にする
            .setDepth(renderDepthAt('facility', drawn.x, drawn.y) - (accessStep === 'exit' ? 1 : 0)))
          // 入口は敷地の外のマスを 1 つ占める。出口は敷地の内側なのですでに占有済み
          if (accessStep === 'entrance') occupiedByAttraction.add(tileKey(x, y))
          return { x, y, frame, image }
        }
        // 先に整列歩道が敷かれている場所に入口を置いたときも、その歩道につないで向きを合わせる
        const connectEntranceToQueue = (facility: PlacedAttraction) => {
          const entrance = facility.entrance
          if (!entrance) return
          const connection = queueNeighbors
            .map((neighbor) => ({
              neighbor,
              x: entrance.x + neighbor.x,
              y: entrance.y + neighbor.y,
              key: tileKey(entrance.x + neighbor.x, entrance.y + neighbor.y),
            }))
            .find(({ key }) => {
              const state = queueStates.get(key)
              return state !== undefined && isQueueConnectionTarget(state)
            })
          if (!connection) return
          const state = queueStates.get(connection.key)!
          queueStates.set(connection.key, queueStateAdding(state, connection.neighbor.reverseMask))
          facility.entranceQueueKey = connection.key
          facility.entranceFrame = connection.neighbor.entranceFrameToward
          entrance.image.setTexture(`facility-entrance-frame-${entranceFrameAt(facility)}`)
          redrawQueueTiles(connection.x, connection.y)
        }
        // 出入口変更。今の入口・出口を外して、設置のときと同じ手順で置き直す。
        // 取り消したときに戻せるよう、外した位置を控えておく
        const dropAccess = (placed: PlacedAttraction, accessStep: 'entrance' | 'exit') => {
          const access = placed[accessStep]
          if (!access) return
          access.image.destroy()
          if (accessStep === 'entrance') {
            occupiedByAttraction.delete(tileKey(access.x, access.y))
            redrawQueueTiles(access.x, access.y)
          }
          placed[accessStep] = undefined
        }
        const startAccessRelocation = (placed: PlacedAttraction) => {
          relocatingAccess = placed
          relocatedFrom = { entrance: placed.entrance, exit: placed.exit }
          dropAccess(placed, 'entrance')
          dropAccess(placed, 'exit')
          pendingAttraction = placed
          activeAttractionBuildStep = 'entrance'
          accessSide = 'bottom'
          snapAccessCursor(placed.x + Math.floor(placed.width / 2), placed.y + placed.height)
          drawCursor()
        }
        // 取り消し。置きかけの入口を外し、元の入口・出口を描き直す
        const cancelAccessRelocation = () => {
          const placed = relocatingAccess
          const before = relocatedFrom
          relocatingAccess = null
          relocatedFrom = null
          pendingAttraction = null
          activeAttractionBuildStep = 'body'
          if (!placed) return
          dropAccess(placed, 'entrance')
          dropAccess(placed, 'exit')
          if (before?.entrance) {
            placed.entrance = addAttractionAccess('entrance', before.entrance.x, before.entrance.y, before.entrance.frame)
            connectEntranceToQueue(placed)
            redrawQueueTiles(before.entrance.x, before.entrance.y)
          }
          if (before?.exit) {
            placed.exit = addAttractionAccess('exit', before.exit.x, before.exit.y, before.exit.frame)
          }
          drawCursor()
        }
        const placeAttractionAccess = () => {
          const facility = pendingAttraction
          const { x, y } = cursorPosition
          if (!facility) return
          if (!canPlaceAccess(x, y)) {
            buildMessageHandler.current('その場所には設置できません。')
            return
          }
          buildMessageHandler.current('')
          const accessStep = activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit'
          const access = addAttractionAccess(accessStep, x, y, entranceFrameForSide[accessSide])
          if (accessStep === 'entrance') {
            facility.entrance = access
            connectEntranceToQueue(facility)
            redrawQueueTiles(x, y)
            activeAttractionBuildStep = 'exit'
            // 出口は敷地の内側の縁に移るので、手前の辺の中央から選び直す
            accessSide = 'bottom'
            snapAccessCursor(facility.x + Math.floor(facility.width / 2), facility.y + facility.height - 1)
            attractionAccessPlacedHandler.current('entrance')
          }
          else {
            facility.exit = access
            pendingAttraction = null
            activeAttractionBuildStep = 'body'
            relocatingAccess = null
            relocatedFrom = null
            attractionAccessPlacedHandler.current('exit')
          }
          drawCursor()
        }
        const removeRoad = () => {
          if (!isBuildableTile(cursorPosition.x, cursorPosition.y)) return
          const key = tileKey(cursorPosition.x, cursorPosition.y)
          // ショップ前の道はショップの敷地なので、道路の撤去では消せない
          if (shopRoads.has(key)) return
          const stairs = stairsTiles.get(key)
          if (stairs) {
            stairs.images.forEach((image) => image.destroy())
            stairsTiles.delete(key)
            redrawRoadTiles(stairs.x, stairs.y)
            redrawRoadTiles(stairs.x + stairs.dx, stairs.y + stairs.dy)
          }
          if (roads.delete(key)) {
            // 歩道を撤去すると、その上に落ちているゴミも一緒に消える
            clearLitter(cursorPosition.x, cursorPosition.y)
            redrawRoadTiles(cursorPosition.x, cursorPosition.y)
            redrawQueueTiles(cursorPosition.x, cursorPosition.y)
          }
          const queueState = queueStates.get(key)
          if (queueState !== undefined) {
            const mask = queueMaskByState[queueState]
            const entrance = placedAttractions.find((attraction) => attraction.entranceQueueKey === key)
            queueRoads.delete(key)
            queueStates.delete(key)
            queueNeighbors.forEach((neighbor) => {
              if ((mask & neighbor.mask) === 0) return
              const neighborKey = tileKey(cursorPosition.x + neighbor.x, cursorPosition.y + neighbor.y)
              const neighborState = queueStates.get(neighborKey)
              if (neighborState === undefined) return
              queueStates.set(neighborKey, queueStateRemoving(neighborState, neighbor.reverseMask))
            })
            if (entrance?.entrance) {
              const connection = queueNeighbors
                .map((neighbor) => ({
                  neighbor,
                  x: entrance.entrance!.x + neighbor.x,
                  y: entrance.entrance!.y + neighbor.y,
                  key: tileKey(entrance.entrance!.x + neighbor.x, entrance.entrance!.y + neighbor.y),
                }))
                .find(({ key: candidateKey }) => {
                  const state = queueStates.get(candidateKey)
                  return state !== undefined && isQueueConnectionTarget(state)
                })
              if (connection) {
                const state = queueStates.get(connection.key)!
                queueStates.set(connection.key, queueStateAdding(state, connection.neighbor.reverseMask))
                entrance.entranceQueueKey = connection.key
                entrance.entranceFrame = connection.neighbor.entranceFrameToward
                redrawQueueTiles(connection.x, connection.y)
              }
              else {
                entrance.entranceQueueKey = undefined
                entrance.entranceFrame = undefined
              }
            }
            redrawQueueTiles(cursorPosition.x, cursorPosition.y)
          }
          drawCursor()
        }
        // カーソルタイルを覆う設備(複数マス設備は原点以外を指しても対象にする)を探す
        const facilityCoveringTile = (x: number, y: number) => {
          for (const [key, placed] of placedFacilities) {
            const { x: anchorX, y: anchorY } = parseKey(key)
            if (x >= anchorX && x < anchorX + placed.facility.width
              && y <= anchorY && y > anchorY - placed.facility.height) {
              return { anchorX, anchorY, placed }
            }
          }
          return null
        }
        const removeFacilityAtCursor = () => {
          const found = facilityCoveringTile(cursorPosition.x, cursorPosition.y)
          if (!found) return
          const { anchorX, anchorY, placed } = found
          const facility = placed.facility
          removeFacility(anchorX, anchorY)
          if (facility.placement === 'building') placedBuildings.delete(facility.id)
          // 連結系は撤去後に周囲のフレームを組み直す
          if (facility.placement === 'fence') {
            refreshFenceTile(anchorX + 1, anchorY)
            refreshFenceTile(anchorX - 1, anchorY)
            refreshFenceTile(anchorX, anchorY + 1)
            refreshFenceTile(anchorX, anchorY - 1)
          }
          if (facility.placement === 'pond') {
            pondNeighbours.forEach(([offsetX, offsetY]) => refreshPondTile(anchorX + offsetX, anchorY + offsetY))
          }
          drawCursor()
        }
        // 撤去はカーソルの下にあるものを 2 系統に分けて扱う。
        // 道路・設備は確認なし、アトラクション・ショップは確認あり
        const coversTile = (
          area: { x: number, y: number, width: number, height: number },
          x: number,
          y: number,
        ) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height
        const attractionCoveringTile = (x: number, y: number) => (
          placedAttractions.find((placed) => placed !== pendingAttraction && coversTile(placed, x, y)) ?? null
        )
        const shopCoveringTile = (x: number, y: number) => (
          placedShops.find(({ shop, x: shopX, y: shopY }) => (
            coversTile({ x: shopX, y: shopY, width: shop.width, height: shop.height }, x, y)
          )) ?? null
        )
        const removeAttraction = (placed: PlacedAttraction) => {
          const index = placedAttractions.indexOf(placed)
          if (index >= 0) placedAttractions.splice(index, 1)
          if (settingsAttraction === placed) closeFacilitySettings()
          // 修理の柵と故障の煙も一緒に消す
          clearRepairFence(placed)
          breakdownSmoke.get(placed)?.destroy()
          breakdownSmoke.delete(placed)
          // 乗車中の客は支払いなしで降ろし、並んでいた客は列を離れさせる
          releaseRiders(placed, false)
          guests.forEach((guest) => {
            if (guest.targetAttraction === placed && guest.phase === 'queueing') abandonQueue(guest)
          })
          queueDistanceCache.delete(placed)
          markFootprint(placed, false)
          if (placed.entrance) occupiedByAttraction.delete(tileKey(placed.entrance.x, placed.entrance.y))
          placed.image.destroy()
          placed.riderImages.forEach((image) => image.destroy())
          placed.baseImages.forEach((image) => image.destroy())
          placed.entrance?.image.destroy()
          placed.exit?.image.destroy()
          // 入口につながっていた整列歩道は行き先を失うので描き直す
          if (placed.entrance) redrawQueueTiles(placed.entrance.x, placed.entrance.y)
          drawCursor()
        }
        // 爆発したアトラクションの跡地に残るガレキ。原作は跡地のマスを 1 つずつ見て、
        // 抽選に当たったマスだけをガレキにし、外れたマスは更地に戻す
        // (`FUN_801f7368` の爆発の枝。当たりはおよそ半々)
        const addRubble = (x: number, y: number) => {
          const key = tileKey(x, y)
          if (rubbleTiles.has(key)) return
          const offset = terrain.tileObjectOffsets.rubble
          const tile = point(x, y)
          rubbleTiles.set(key, this.add.image(tile.x + offset.x, tile.y + offset.y, 'rubble')
            .setOrigin(0).setDepth(roadPieceDepth(x, y)))
        }
        const removeRubble = (x: number, y: number) => {
          const key = tileKey(x, y)
          rubbleTiles.get(key)?.destroy()
          rubbleTiles.delete(key)
        }
        // ガレキは設置できないが、撤去はできる。費用は 1 マスあたり 3,000
        const removeRubbleAtCursor = () => {
          const { x, y } = cursorPosition
          if (!rubbleTiles.has(tileKey(x, y))) return
          const cost = breakdownConfig.rubbleRemovalCost
          if (currentCash < cost) {
            buildMessageHandler.current('資金が足りないので撤去できません。')
            return
          }
          currentCash -= cost
          spendHandler.current(cost)
          removeRubble(x, y)
          drawCursor()
        }
        const scatterRubble = (placed: PlacedAttraction) => {
          for (let offsetY = 0; offsetY < placed.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < placed.width; offsetX += 1) {
              if (Math.random() < breakdownConfig.rubbleChance) addRubble(placed.x + offsetX, placed.y + offsetY)
            }
          }
        }
        // 1 回運転するごとに耐久度を減らす。一定割合を下回るとメカニックを呼び、
        // 0 になると事故で壊れて爆発し、跡地にガレキが残る
        const wearAttraction = (placed: PlacedAttraction) => {
          const limit = durabilityLimitOf(placed.attraction, placed.version)
          placed.durability = Math.max(0, placed.durability - breakdownConfig.wearPerRun)
          if (placed.durability <= 0) {
            const name = attractionForm(placed.attraction).name
            scatterRubble(placed)
            removeAttraction(placed)
            buildMessageHandler.current(`${name} が事故を起こしました。`)
            return
          }
          if (!placed.needsRepair && placed.durability < limit * breakdownConfig.smokeThreshold) {
            placed.needsRepair = true
            buildMessageHandler.current(`${attractionForm(placed.attraction).name} から煙が出ています。`)
          }
        }
        const removeShop = (placed: PlacedShop) => {
          const index = placedShops.indexOf(placed)
          if (index >= 0) placedShops.splice(index, 1)
          if (settingsShop === placed) closeFacilitySettings()
          const { shop, x, y } = placed
          rebuildShopEntranceSpots()
          const entrance = shopEntranceTile(shop, x, y, placed.direction)
          // この店を目指していた客・利用中の客は入口マスへ出して徘徊に戻す
          guests.forEach((guest) => {
            if (guest.targetShop !== placed) return
            guest.targetShop = null
            guest.path = null
            guest.pathIndex = 0
            if (guest.phase === 'shopping') {
              guest.phase = 'walking'
              guest.image.setVisible(true)
              guest.serviceRemaining = 0
              guest.fromX = entrance.x
              guest.fromY = entrance.y
              guest.toX = entrance.x
              guest.toY = entrance.y
              guest.previousX = entrance.x
              guest.previousY = entrance.y
              guest.progress = 0
            }
          })
          markFootprint({ x, y, width: shop.width, height: shop.height }, false)
          placed.image.destroy()
          // ショップ前の道もショップの一部なので一緒に消す
          const removed: Array<[number, number]> = []
          shopRoads.forEach((key) => {
            const { x: roadX, y: roadY } = parseKey(key)
            if (!coversTile({ x, y, width: shop.width, height: shop.height }, roadX, roadY)) return
            removed.push([roadX, roadY])
          })
          removed.forEach(([roadX, roadY]) => {
            roads.delete(tileKey(roadX, roadY))
            shopRoads.delete(tileKey(roadX, roadY))
            clearLitter(roadX, roadY)
          })
          removed.forEach(([roadX, roadY]) => {
            redrawRoadTiles(roadX, roadY)
            redrawQueueTiles(roadX, roadY)
          })
          drawCursor()
        }

        // ---- 設置済みの施設の設定メニュー ----
        // カーソルを合わせて決定すると開く。原作の運転設定・運営設定にあたるもので、
        // 項目とステータスの並びは施設の種類ごとに変わる
        const settingsConfig = game.facilityMenu
        const clampSetting = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
        let settingsAttraction: PlacedAttraction | null = null
        let settingsShop: PlacedShop | null = null
        // バージョンが上がると定員(ショップは接客数)が増える。0 と 9 のときの値の間を等間隔に割り振る
        const byVersion = (base: number, top: number, version: number) => (
          base + Math.round((top - base) * version / settingsConfig.maxVersion)
        )
        const capacityLimitOf = (placed: PlacedAttraction) => (
          byVersion(placed.attraction.capacity, placed.attraction.capacityMax, placed.version)
        )
        const serviceCountOf = (placed: PlacedShop) => (
          byVersion(placed.shop.serviceCount, placed.shop.serviceCountMax, placed.version)
        )
        // 施設・ショップは「性能ＵＰ」、スタッフは「能力ＵＰ」で、アイコン(41)と定額の費用は共通
        const versionItem = (version: number, label = '性能', target = '性能'): FacilitySettingItem => ({
          id: 'versionUp',
          label,
          icon: 41,
          kind: 'confirm',
          text: `Lv.${version}`,
          description: `${target}を上げられます。費用は ${settingsConfig.versionUpCost.toLocaleString()} です。`,
          enabled: version < settingsConfig.maxVersion,
        })
        // 金額の項目。桁ごとに変えるので、桁数は上限の桁数に合わせる
        const priceItem = (
          id: string, label: string, icon: number, description: string, value: number,
        ): FacilitySettingItem => ({
          id,
          label,
          icon,
          kind: 'digits',
          value,
          min: 0,
          max: settingsConfig.maxPrice,
          digits: String(settingsConfig.maxPrice).length,
          description,
          enabled: true,
        })
        const attractionSettingItems = (placed: PlacedAttraction): FacilitySettingItem[] => {
          const items: FacilitySettingItem[] = [
            {
              id: 'suspend',
              label: '運転休止',
              icon: 74,
              kind: 'toggle',
              text: placed.underInspection ? '点 検' : placed.suspended ? '休 止' : '運 転',
              on: !placed.suspended && !placed.underInspection,
              description: placed.underInspection
                ? '点検中は運転できません。'
                : 'アトラクションの運転や休止の設定ができます。',
              enabled: !placed.underInspection,
            },
            {
              id: 'capacity',
              label: '定員数',
              icon: 36,
              kind: 'step',
              value: placed.capacity,
              min: 1,
              max: capacityLimitOf(placed),
              description: `アトラクションに乗れるお客さんの数を設定できます。(最大 ${capacityLimitOf(placed)})`,
              enabled: true,
            },
          ]
          // 展望系・見せ物系・船の乗り物系は速度を設定できない
          if (placed.attraction.speedAdjustable) {
            items.push({
              id: 'speed',
              label: 'スピード',
              icon: 29,
              kind: 'step',
              value: placed.speedSetting,
              min: 0,
              max: settingsConfig.maxSetting,
              description: 'アトラクションのスピードを設定できます。',
              enabled: true,
            })
          }
          items.push(
            {
              id: 'rideTime',
              label: '稼働時間',
              icon: 37,
              kind: 'step',
              value: placed.rideTimeSetting,
              min: 0,
              max: settingsConfig.maxSetting,
              description: 'お客さんがアトラクションに乗っている時間を設定できます。',
              enabled: true,
            },
            {
              id: 'inspect',
              label: '点検',
              icon: 38,
              kind: 'confirm',
              text: placed.underInspection ? '点検中' : placed.inspectRequested || placed.needsRepair ? '呼出中' : '',
              description: 'アトラクションを修理するためにメカニックをよべます。',
              enabled: !placed.inspectRequested && !placed.needsRepair && !placed.underInspection,
            },
            priceItem('price', '乗車額', 40, 'アトラクションの乗車額を設定できます。', placed.price),
            versionItem(placed.version),
            {
              id: 'relocateAccess',
              label: '出入口変更',
              icon: 42,
              kind: 'confirm',
              description: placed.underInspection
                ? '点検中は出入口変更ができません。'
                : 'アトラクションの出入口を移動できます。',
              enabled: !placed.underInspection,
            },
          )
          // 開発サーバでだけ出すデバッグ操作。本番の書き出しにはこの分岐ごと残らない
          if (import.meta.env.DEV) {
            items.push(
              {
                id: 'debugBreak',
                label: '故障させる',
                icon: 38,
                kind: 'confirm',
                description: '【デバッグ】耐久度を黒煙が上がるところまで下げます。',
                enabled: !placed.underInspection,
              },
              {
                id: 'debugExplode',
                label: '事故を起こす',
                icon: 38,
                kind: 'confirm',
                description: '【デバッグ】耐久度を 1 にします。次に運転すると事故を起こします。',
                enabled: !placed.underInspection,
              },
            )
          }
          return items
        }
        const shopSettingItems = (placed: PlacedShop): FacilitySettingItem[] => {
          const { shop } = placed
          const isGame = shop.category === 'game'
          const items: FacilitySettingItem[] = [priceItem(
            'price',
            isGame ? 'ゲーム料金' : '販売価格',
            43,
            isGame ? 'ゲームの料金を設定できます。' : 'ショップで売る商品の販売価格を設定できます。',
            placed.price,
          )]
          const tasteName = shopTasteName(shop)
          if (tasteName) {
            items.push({
              id: 'taste',
              label: tasteName,
              icon: 44,
              kind: 'step',
              value: placed.tasteLevel,
              min: 0,
              max: settingsConfig.maxTasteLevel,
              description: `${shop.name}の${tasteName}を設定できます。`,
              enabled: true,
            })
          }
          // 賞品のあるゲームショップだけ賞品価格と勝率を持つ
          if (shopPrize(shop)) {
            items.push(
              priceItem('prizePrice', '賞品価格', 45, 'ゲームの賞品価格を設定できます。', placed.prizePrice),
              {
                id: 'winRate',
                label: '勝率',
                icon: 46,
                kind: 'step',
                value: placed.winRate,
                min: 0,
                max: settingsConfig.maxWinRate,
                description: 'ゲームの勝率を設定できます。高いとお客さんは喜びますがお金がかかります。',
                enabled: true,
              },
            )
          }
          items.push(versionItem(placed.version))
          return items
        }
        // ステータス枠の中身。並びは原作のステータス表示に合わせる(原作の記録は
        // `0x80118254`、耐久度は message 783、アイコン 38)。
        // 耐久性・撤去費用・在庫はまだ扱っていないので出さない
        const usedText = (placed: { usedLastMonth: number, usedThisMonth: number }) => (
          `${placed.usedLastMonth} / ${placed.usedThisMonth}`
        )
        const attractionStatus = (placed: PlacedAttraction): FacilityStatusItem[] => {
          const status: FacilityStatusItem[] = [
            { icon: 35, label: '運転状態', value: placed.suspended ? '休 止' : '運 転' },
            { icon: 40, label: '乗車額', value: placed.price.toLocaleString() },
            { icon: 36, label: '定員数 / 最大', value: `${placed.capacity} / ${capacityLimitOf(placed)}` },
            {
              icon: 38,
              label: '耐久度',
              value: `${placed.durability} / ${durabilityLimitOf(placed.attraction, placed.version)}`,
            },
            { icon: 52, label: '興奮度', value: `${placed.attraction.excitement}` },
            { icon: 53, label: '経費', value: placed.attraction.maintenanceCost.toLocaleString() },
          ]
          if (placed.attraction.speedAdjustable) {
            status.push({ icon: 29, label: 'スピード', value: `${placed.speedSetting}` })
          }
          status.push(
            { icon: 55, label: '利用者数 先月 / 今月', value: usedText(placed) },
            { icon: 37, label: '稼働時間', value: `${placed.rideTimeSetting}` },
          )
          return status
        }
        const shopStatus = (placed: PlacedShop): FacilityStatusItem[] => {
          const { shop } = placed
          const isGame = shop.category === 'game'
          const prize = shopPrize(shop)
          const status: FacilityStatusItem[] = [{
            icon: 43,
            label: isGame ? 'ゲーム料金 / 賞品価格' : '販売価格 / 仕入価格',
            value: isGame
              ? `${placed.price.toLocaleString()} / ${prize ? placed.prizePrice.toLocaleString() : '-'}`
              : `${placed.price.toLocaleString()} / ${shop.stockPrice.toLocaleString()}`,
          }]
          status.push({ icon: 36, label: '接客数', value: `${serviceCountOf(placed)}` })
          if (!isGame) status.push({ icon: 57, label: '販売品目', value: shop.product })
          status.push({ icon: 53, label: '経費', value: shop.maintenanceCost.toLocaleString() })
          if (prize) status.push({ icon: 46, label: '勝率', value: `${placed.winRate} ％` })
          const addiction = 'addiction' in shop ? shop.addiction : undefined
          if (addiction) status.push({ icon: 58, label: 'ハマリ度', value: addiction })
          status.push({ icon: 55, label: '利用者数 先月 / 今月', value: usedText(placed) })
          const tasteName = shopTasteName(shop)
          if (tasteName) status.push({ icon: 44, label: tasteName, value: `${placed.tasteLevel}` })
          return status
        }
        const facilitySettingsModel = (): FacilitySettings | null => {
          if (settingsAttraction) {
            // 秋冬で姿が変わるアトラクションは、今の季節の名前で見せる
            const base = attractions.find((entry) => entry.id === settingsAttraction!.id)
            return {
              title: base ? attractionForm(base).name : '',
              version: settingsAttraction.version,
              items: attractionSettingItems(settingsAttraction),
              status: attractionStatus(settingsAttraction),
            }
          }
          if (settingsShop) {
            return {
              title: settingsShop.shop.name,
              version: settingsShop.version,
              items: shopSettingItems(settingsShop),
              status: shopStatus(settingsShop),
            }
          }
          if (settingsStaff) {
            return {
              title: `${settingsStaff.name}(${settingsStaff.type.label})`,
              version: settingsStaff.version,
              items: staffSettingItems(settingsStaff),
              status: staffStatus(settingsStaff),
            }
          }
          return null
        }
        const pushFacilitySettings = () => facilitySettingsHandler.current(facilitySettingsModel())
        const closeFacilitySettings = () => {
          if (!settingsAttraction && !settingsShop && !settingsStaff) return
          settingsAttraction = null
          settingsShop = null
          settingsStaff = null
          pushFacilitySettings()
        }
        // カーソルの下に設置済みの施設・スタッフがあれば設定メニューを開く
        const openFacilitySettings = () => {
          const { x, y } = cursorPosition
          const attraction = attractionCoveringTile(x, y)
          const shop = attraction ? null : shopCoveringTile(x, y)
          const worker = attraction || shop ? null : staffAtTile(x, y)
          if (!attraction && !shop && !worker) return false
          settingsAttraction = attraction
          settingsShop = shop
          settingsStaff = worker
          pushFacilitySettings()
          return true
        }
        // 数値の項目を書き換える。範囲は項目ごとの下限・上限で押さえる
        const setFacilitySetting = (itemId: string, value: number) => {
          const attraction = settingsAttraction
          const shop = settingsShop
          const worker = settingsStaff
          const price = (input: number) => clampSetting(input, 0, settingsConfig.maxPrice)
          if (attraction) {
            if (itemId === 'capacity') attraction.capacity = clampSetting(value, 1, capacityLimitOf(attraction))
            if (itemId === 'speed') attraction.speedSetting = clampSetting(value, 0, settingsConfig.maxSetting)
            if (itemId === 'rideTime') attraction.rideTimeSetting = clampSetting(value, 0, settingsConfig.maxSetting)
            if (itemId === 'price') attraction.price = price(value)
          }
          else if (shop) {
            if (itemId === 'price') shop.price = price(value)
            if (itemId === 'taste') shop.tasteLevel = clampSetting(value, 0, settingsConfig.maxTasteLevel)
            if (itemId === 'prizePrice') shop.prizePrice = price(value)
            if (itemId === 'winRate') shop.winRate = clampSetting(value, 0, settingsConfig.maxWinRate)
          }
          else if (worker) {
            if (itemId === 'wage') worker.wage = price(value)
          }
          else return
          pushFacilitySettings()
        }
        // 切り替えの項目(運転休止)と、確認を経て効く項目(性能・解雇)
        const activateFacilitySetting = (itemId: string) => {
          const attraction = settingsAttraction
          const shop = settingsShop
          const worker = settingsStaff
          if (!attraction && !shop && !worker) return
          if (itemId === 'suspend') {
            if (!attraction) return
            attraction.suspended = !attraction.suspended
            pushFacilitySettings()
            return
          }
          if (itemId === 'inspect') {
            if (!attraction || attraction.inspectRequested || attraction.needsRepair) return
            if (attraction.underInspection) return
            // 呼べるメカニックがいなければ受け付けない
            if (!staff.some((entry) => entry.type.id === 'mechanic' && !entry.striking)) {
              buildMessageHandler.current('点検できるメカニックがいません。')
              return
            }
            attraction.inspectRequested = true
            buildMessageHandler.current('メカニックをよびました。')
            pushFacilitySettings()
            return
          }
          if (itemId === 'suspend' && attraction?.underInspection) {
            buildMessageHandler.current('点検中は運転できません。')
            return
          }
          // 開発サーバでだけ効くデバッグ操作
          if (itemId === 'debugBreak' || itemId === 'debugExplode') {
            if (!import.meta.env.DEV || !attraction || attraction.underInspection) return
            if (itemId === 'debugExplode') {
              // 次に運転したときに耐久度が 0 になって事故を起こす
              attraction.durability = 1
              buildMessageHandler.current('【デバッグ】耐久度を 1 にしました。')
            }
            else {
              // 黒煙が上がる境目のすぐ下まで下げ、その場で故障の状態にする
              const limit = durabilityLimitOf(attraction.attraction, attraction.version)
              attraction.durability = Math.max(1, Math.ceil(limit * breakdownConfig.smokeThreshold) - 1)
              attraction.needsRepair = true
              buildMessageHandler.current(`${attractionForm(attraction.attraction).name} から煙が出ています。`)
            }
            pushFacilitySettings()
            return
          }
          if (itemId === 'relocateAccess') {
            if (!attraction) return
            if (attraction.underInspection) {
              buildMessageHandler.current('点検中は出入口変更ができません。')
              return
            }
            closeFacilitySettings()
            startAccessRelocation(attraction)
            buildMessageHandler.current('入口を置く場所を選んでください。')
            return
          }
          if (itemId === 'dismiss') {
            if (!worker || worker.striking) return
            dismissStaff(worker)
            closeFacilitySettings()
            return
          }
          if (itemId === 'reposition') {
            if (!worker || worker.striking || staffIsBusy(worker)) return
            // つまみ上げる。以降カーソルに付いて動き、決定で下ろす
            movingStaff = worker
            carriedFrom = { x: worker.fromX, y: worker.fromY }
            worker.path = null
            worker.pathIndex = 0
            worker.progress = 0
            worker.walked = 0
            closeFacilitySettings()
            buildMessageHandler.current(`${worker.type.label}をつまみました。下ろす場所を選んでください。`)
            return
          }
          if (itemId === 'route') {
            if (!worker || worker.type.id !== 'sweeper' || worker.striking || staffIsBusy(worker)) return
            routeStaff = worker
            routeTiles = worker.route ? [...worker.route] : []
            closeFacilitySettings()
            buildMessageHandler.current('清掃するマスを選んでください。決定で追加・削除、キャンセルで確定します。')
            return
          }
          if (itemId !== 'versionUp') return
          const version = attraction?.version ?? shop?.version ?? worker!.version
          if (version >= settingsConfig.maxVersion) return
          if (currentCash < settingsConfig.versionUpCost) {
            buildMessageHandler.current('資金が足りないので性能を上げられません。')
            return
          }
          spendHandler.current(settingsConfig.versionUpCost)
          if (attraction) attraction.version += 1
          else if (shop) shop.version += 1
          else worker!.version += 1
          pushFacilitySettings()
        }


        // 確認待ちの撤去対象。返事が来るまで保持する
        let pendingRemoval: (() => void) | null = null
        const removeAtCursor = () => {
          const { x, y } = cursorPosition
          // 設置モード中は同じ系統のものだけ撤去できる。何のモードでもなければどちらも撤去できる
          const buildingMode = Boolean(activeAttraction || activeShop)
          const groundMode = Boolean(activeRoadBuildMode || activeFacility)
          // スタッフの配置中・移動先選択中・清掃ルート編集中は撤去に何も反応させない(道を消してしまわないように)
          if (activeStaffType || movingStaff || routeStaff || relocatingAccess) return
          if (!buildingMode) {
            removeRoad()
            removeFacilityAtCursor()
            removeRubbleAtCursor()
          }
          if (groundMode || pendingRemoval) return
          // 確認を出したら押しっぱなし扱いは解除する。返事のあと勝手に続きが消えないように
          const askRemoval = (remove: () => void, name: string) => {
            pendingRemoval = remove
            removeHeld = false
            removeConfirmHandler.current(name)
          }
          const attraction = attractionCoveringTile(x, y)
          if (attraction?.underInspection) {
            buildMessageHandler.current('修理中のアトラクションは撤去できません。')
            return
          }
          if (attraction) {
            askRemoval(() => removeAttraction(attraction), (() => {
              const base = attractions.find((entry) => entry.id === attraction.id)
              // 秋冬はスケートリンク側の名前で確認を出す
              return base ? attractionForm(base).name : ''
            })())
            return
          }
          const shop = shopCoveringTile(x, y)
          if (shop) askRemoval(() => removeShop(shop), shop.shop.name)
        }
        const resolveRemoval = (confirmed: boolean) => {
          const remove = pendingRemoval
          pendingRemoval = null
          if (confirmed) remove?.()
        }
        // 道路・設備を置いているところか(連続設置できる系統)
        const isGroundBuild = () => Boolean(
          (activeRoadBuildMode && stairsStep === 'body')
          || (activeFacility && facilityStep === 'body'),
        )
        // つまんでいるスタッフをカーソルのマスに置く。1 マスずつ運ぶので歩かせない
        const holdStaffAtCursor = (worker: Staff, x: number, y: number) => {
          worker.fromX = x
          worker.fromY = y
          worker.toX = x
          worker.toY = y
          worker.previousX = x
          worker.previousY = y
          worker.progress = 1
          worker.walked = 0
          placeStaffImage(worker)
        }
        // 決定でその場に下ろす
        const moveStaffToCursor = () => {
          const worker = movingStaff
          if (!worker) return
          if (!canPlaceStaffType(worker.type, cursorPosition.x, cursorPosition.y)) {
            buildMessageHandler.current(
              worker.type.id === 'mechanic'
                ? '何もない地面にしか下ろせません。'
                : 'その場所には下ろせません。',
            )
            return
          }
          movingStaff = null
          carriedFrom = null
          clearCarriedLook(worker)
          // メカニックは拠点ごと移る
          if (worker.type.id === 'mechanic') {
            removeMechanicPost(worker.homeX, worker.homeY)
            addMechanicPost(cursorPosition.x, cursorPosition.y)
          }
          holdStaffAtCursor(worker, cursorPosition.x, cursorPosition.y)
          worker.homeX = cursorPosition.x
          worker.homeY = cursorPosition.y
          // 楽しませる職種は下ろした場所を持ち場にして待ちから始める(雇ったときと同じ)
          worker.settled = true
          worker.performing = false
          worker.performTick = 0
          worker.waitTick = 0
          buildMessageHandler.current(`${worker.type.label}を下ろしました。`)
          drawCursor()
          staffMovedHandler.current()
        }
        // 取り消し。つまむ前のマスへ戻す
        const cancelCarry = () => {
          const worker = movingStaff
          const origin = carriedFrom
          movingStaff = null
          carriedFrom = null
          if (worker && origin) {
            clearCarriedLook(worker)
            holdStaffAtCursor(worker, origin.x, origin.y)
          }
        }
        // 清掃ルートのマスを 1 つ選ぶかどうか。同じ高さの歩道だけ、既にあれば外す、
        // なければ上限まで足す(清掃ルートは同じ高さの場所だけに設定できる)
        const canToggleRouteTile = (x: number, y: number) => {
          if (!roads.has(tileKey(x, y))) return false
          if (routeTiles.length === 0) return true
          return heightAt(x, y) === heightAt(routeTiles[0].x, routeTiles[0].y)
        }
        const toggleRouteTile = () => {
          const { x, y } = cursorPosition
          const index = routeTiles.findIndex((tile) => tile.x === x && tile.y === y)
          if (index >= 0) { routeTiles.splice(index, 1); drawCursor(); return }
          if (!canToggleRouteTile(x, y)) {
            buildMessageHandler.current('清掃ルートは同じ高さの歩道だけに設定できます。')
            return
          }
          if (routeTiles.length >= routeTileLimit) {
            buildMessageHandler.current(`清掃ルートは ${routeTileLimit} マスまでです。`)
            return
          }
          routeTiles.push({ x, y })
          drawCursor()
        }
        // カーソル位置に今のモードのものを置く
        const placeAtCursor = () => {
          if (routeStaff) toggleRouteTile()
          else if (movingStaff) moveStaffToCursor()
          else if (activeStaffType) placeStaff()
          else if (activeRoadBuildMode) stairsStep === 'direction' ? finishStairsDirection() : placeRoad()
          else if (activeFacility) facilityStep === 'direction' ? finishFacilityDirection() : placeFacility()
          else if (activeShop) shopStep === 'direction' ? confirmShopDirection() : placeShop()
          else if (pendingAttraction && activeAttractionBuildStep !== 'body') placeAttractionAccess()
          else if (activeAttraction) {
            if (activeAttractionBuildStep === 'body') placeAttraction()
            else placeAttractionAccess()
          }
          // 何も置いていないときは、カーソルの下の施設の設定メニューを開く
          else openFacilitySettings()
        }
        // 高いマスは画面上で高さぶん上に描かれる。高い順に「その高さとして読んだときに
        // 本当にその高さのマスか」を試し、最初に一致した面を選ぶ
        const tileAtWorld = (worldX: number, worldY: number) => {
          const candidate = (lift: number) => {
            const y = Math.floor((worldY - padding + lift) / stepY)
            const localY = worldY - padding + lift - y * stepY
            const x = Math.floor((worldX - padding - y * rowOffsetX - Math.floor(localY / 2)) / stepX)
            return { x, y }
          }
          for (let lift = 3; lift >= 1; lift -= 1) {
            const tile = candidate(lift * terrain.heightStepPx)
            if (heightAt(tile.x, tile.y) === lift) return tile
          }
          return candidate(0)
        }
        const selectTileAtPointer = (pointer: Phaser.Input.Pointer) => {
          const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
          const { x, y } = tileAtWorld(world.x, world.y)
          if (x < left || x > right || y < top || y > buildBottomRow) return false
          // 入口・出口を置いている間は敷地の縁から離れられない
          if (pendingAttraction && activeAttractionBuildStep !== 'body') snapAccessCursor(x, y)
          else placeCursor(x, y)
          return true
        }
        // カメラが動いたぶんカーソルをずらし、画面上の同じ場所にあるマスを選び直す。
        // 入口・出口の設置中はカーソルが敷地の縁から離れられないので追従させない
        const moveCursorWithCamera = (movedX: number, movedY: number) => {
          if (pendingAttraction && activeAttractionBuildStep !== 'body') return
          if (movedX === 0 && movedY === 0) return
          cursorTrack.x += movedX
          cursorTrack.y += movedY
          const tile = tileAtWorld(cursorTrack.x, cursorTrack.y)
          const position = setCursorTile(tile.x, tile.y)
          // 端で止まったら、追従の位置もそこで止める
          if (tile.x !== cursorPosition.x) cursorTrack.x = position.x
          if (tile.y !== cursorPosition.y) cursorTrack.y = position.y
        }
        clampCameraToMap()
        this.scale.on('resize', clampCameraToMap)
        const changeZoom = (amount: number) => {
          const nextZoom = Phaser.Math.Clamp(
            Math.round((camera.zoom + amount) * 2) / 2,
            game.park.minDisplayScale,
            game.park.displayScale,
          )
          camera.setZoom(nextZoom)
          clampCameraToMap()
        }

        // マウスの役割: 左=決定・設置、中ドラッグ=カメラ移動、右=メニュー開閉とキャンセル(App 側で処理)、ホイール=ズーム
        this.input.mouse?.disableContextMenu()
        // 2 本指でのズーム。指の間隔が決まった割合まで変わるたびに 1 段ずつ動かす
        this.input.addPointer(1)
        let pinchDistance = 0
        const updatePinch = () => {
          const first = this.input.pointer1
          const second = this.input.pointer2
          if (!first?.isDown || !second?.isDown) {
            pinchDistance = 0
            return false
          }
          const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y)
          if (pinchDistance === 0) {
            pinchDistance = distance
            return true
          }
          const ratio = distance / pinchDistance
          if (ratio >= game.park.pinchZoomRatio) {
            changeZoom(game.park.zoomStep)
            pinchDistance = distance
          }
          else if (ratio <= 1 / game.park.pinchZoomRatio) {
            changeZoom(-game.park.zoomStep)
            pinchDistance = distance
          }
          return true
        }
        // 中ドラッグと、タッチ操作でのなぞりはどちらもカメラ移動
        let dragPanning = false
        let dragPreviousX = 0
        let dragPreviousY = 0
        // 向きを選んでいる最中は、なぞる操作が向きの指定に使われる
        const choosingDirection = () => Boolean(
          (activeShop && shopStep === 'direction')
          || (activeFacility && facilityStep === 'direction')
          || (pendingStairs && stairsStep === 'direction'),
        )
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          const swipePan = touchLayout && pointer.button === 0 && !choosingDirection()
          if (pointer.button !== 1 && !swipePan) return
          dragPanning = true
          dragPreviousX = pointer.x
          dragPreviousY = pointer.y
        })
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
          if (updatePinch()) {
            dragPanning = false
            return
          }
          if (dragPanning && pointer.isDown) {
            // マップを掴んで引っ張る方向感覚。カーソルも画面上の同じ場所に留める
            const beforeX = camera.scrollX
            const beforeY = camera.scrollY
            camera.scrollX -= (pointer.x - dragPreviousX) / camera.zoom
            camera.scrollY -= (pointer.y - dragPreviousY) / camera.zoom
            dragPreviousX = pointer.x
            dragPreviousY = pointer.y
            clampCameraToMap()
            moveCursorWithCamera(camera.scrollX - beforeX, camera.scrollY - beforeY)
            return
          }
          if (!mapInteractive) return
          if (activeShop && shopStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setShopDirection(shopDirectionAtPointer(world.x, world.y))
            return
          }
          if (activeFacility && facilityStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setFacilityDirection(facilityDirectionAtPointer(world.x, world.y))
            return
          }
          if (pendingStairs && stairsStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setStairsDirection(stairsDirectionAtPointer(world.x, world.y))
            return
          }
          // タッチ操作ではマップを触ってもカーソルは動かさない
          if (touchLayout) return
          const moved = selectTileAtPointer(pointer)
          if (!moved || !pointer.isDown) return
          // 左ドラッグはボタンの押しっぱなしと同じ扱い
          if (pointer.button === 0 && isGroundBuild()) placeAtCursor()
        })
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          pinchDistance = 0
          dragPanning = false
          if (pointer.button === 1) return
          if (pointer.button !== 0 || !mapInteractive) return
          if (activeShop && shopStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setShopDirection(shopDirectionAtPointer(world.x, world.y))
            confirmShopDirection()
          }
          else if (activeFacility && facilityStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setFacilityDirection(facilityDirectionAtPointer(world.x, world.y))
            finishFacilityDirection()
          }
          else if (pendingStairs && stairsStep === 'direction') {
            const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
            setStairsDirection(stairsDirectionAtPointer(world.x, world.y))
            finishStairsDirection()
          }
          else if (!touchLayout && selectTileAtPointer(pointer)) placeAtCursor()
        })
        this.input.on('wheel', (
          _pointer: Phaser.Input.Pointer,
          _gameObjects: Phaser.GameObjects.GameObject[],
          _deltaX: number,
          deltaY: number,
        ) => changeZoom(deltaY > 0 ? -game.park.zoomStep : game.park.zoomStep))
        // 右スティックのカメラ移動。ズームに依らず画面上の速さが一定になるよう zoom で割る。
        // カメラの位置はドット単位に丸められるので、1 ドット未満のぶんは次のフレームへ持ち越す
        let panLeftoverX = 0
        let panLeftoverY = 0
        this.events.on('camera-pan', (deltaX: number, deltaY: number) => {
          const moveX = deltaX / camera.zoom + panLeftoverX
          const moveY = deltaY / camera.zoom + panLeftoverY
          const stepPixelsX = Math.trunc(moveX)
          const stepPixelsY = Math.trunc(moveY)
          panLeftoverX = moveX - stepPixelsX
          panLeftoverY = moveY - stepPixelsY
          const beforeX = camera.scrollX
          const beforeY = camera.scrollY
          camera.scrollX += stepPixelsX
          camera.scrollY += stepPixelsY
          clampCameraToMap()
          // カメラが動いたぶんだけカーソルも動かし、画面上の同じ場所に留める。
          // そうしないと、次にカーソルを動かしたときカメラが元の位置へ戻ってしまう
          moveCursorWithCamera(camera.scrollX - beforeX, camera.scrollY - beforeY)
        })
        this.events.on('pan', (direction: MenuAction) => {
          if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') {
            if (activeShop && shopStep === 'direction') setShopDirection(directionByPad[direction])
            else if (activeFacility && facilityStep === 'direction') setFacilityDirection(directionByPad[direction])
            else if (pendingStairs && stairsStep === 'direction') setStairsDirection(directionByPad[direction])
            else if (pendingAttraction && activeAttractionBuildStep !== 'body') moveAccessCursor(direction)
            else {
              moveCursor(direction)
              // 押しっぱなしのまま動かすと連続して置ける・消せる。
              // 連続して置けるのは道路と設備だけ(アトラクション・ショップは 1 つずつ手順を踏む)
              if (confirmHeld && isGroundBuild()) placeAtCursor()
              if (removeHeld) removeAtCursor()
            }
          }
          if (direction === 'confirm') {
            confirmHeld = true
            placeAtCursor()
          }
          if (direction === 'confirmRelease') confirmHeld = false
          if (direction === 'cancel' && activeShop && shopStep === 'direction') cancelShopDirection()
          if (direction === 'cancel' && activeFacility && facilityStep === 'direction') cancelFacilityDirection()
          if (direction === 'cancel' && stairsStep === 'direction') cancelStairsDirection()
          if (direction === 'cancel' && relocatingAccess) cancelAccessRelocation()
          if (direction === 'cancel' && movingStaff) cancelCarry()
          // 清掃ルートの編集を終える。それまでに選んだマスをそのまま清掃ルートにする
          if (direction === 'cancel' && routeStaff) {
            routeStaff.route = routeTiles.length > 0 ? [...routeTiles] : null
            routeStaff.routeIndex = 0
            routeStaff = null
            routeTiles = []
          }
          if (direction === 'remove') {
            removeHeld = true
            removeAtCursor()
          }
          if (direction === 'removeRelease') removeHeld = false
          if (direction === 'zoomIn') changeZoom(game.park.zoomStep)
          if (direction === 'zoomOut') changeZoom(-game.park.zoomStep)
        })
        this.events.on('road-build-mode', (mode: RoadBuildMode) => {
          activeRoadBuildMode = mode
          if (!mode) confirmHeld = false
          // モードが変わったら向き選び中の階段は取り消す
          if (mode !== 'stairs') cancelStairsDirection()
          drawCursor()
        })
        this.events.on('attraction-build-mode', (attraction: Attraction | null) => {
          if (!attraction && pendingAttraction) {
            const pendingIndex = placedAttractions.indexOf(pendingAttraction)
            if (pendingIndex >= 0) placedAttractions.splice(pendingIndex, 1)
            markFootprint(pendingAttraction, false)
            if (pendingAttraction.entrance) {
              occupiedByAttraction.delete(tileKey(pendingAttraction.entrance.x, pendingAttraction.entrance.y))
            }
            pendingAttraction.image.destroy()
            pendingAttraction.baseImages.forEach((image) => image.destroy())
            pendingAttraction.entrance?.image.destroy()
            attractionCancelledHandler.current(pendingAttraction.cost)
            pendingAttraction = null
          }
          activeAttraction = attraction
          confirmHeld = false
          drawCursor()
        })
        this.events.on('attraction-build-step', (step: AttractionBuildStep) => {
          activeAttractionBuildStep = step
          drawCursor()
        })
        this.events.on('shop-build-mode', (shop: Shop | null) => {
          if (shopStep === 'direction') cancelShopDirection()
          activeShop = shop
          shopDirection = 0
          confirmHeld = false
          drawCursor()
        })
        this.events.on('facility-build-mode', (facility: Facility | null) => {
          if (facilityStep === 'direction') cancelFacilityDirection()
          facilityDirection = 0
          activeFacility = facility
          confirmHeld = false
          drawCursor()
        })
        this.events.on('staff-build-mode', (type: StaffType | null) => {
          activeStaffType = type
          confirmHeld = false
          drawCursor()
        })
        this.events.on('available-cash', (cash: number) => {
          currentCash = cash
          drawCursor()
        })
        this.events.on('seconds-per-day', (value: number) => { daysPerMs = gameDaysPerMs(value) })
        this.events.on('resolve-removal', resolveRemoval)
        this.events.on('set-facility-setting', setFacilitySetting)
        this.events.on('activate-facility-setting', activateFacilitySetting)
        this.events.on('close-facility-settings', closeFacilitySettings)
        this.events.on('touch-layout', (value: boolean) => { touchLayout = value })
        // 日付を飛ばす(開発サーバでのみ使う)。来園者や経営はさかのぼって計算しない。
        // 地形の描き直しはゲームの描画の流れの中でしか効かないので、次のフレームに回す
        this.events.on('set-elapsed-days', (value: number) => {
          elapsedDays = value
          seasonDirty = true
        })
        this.events.on('map-blocked', (blocked: boolean) => {
          mapInteractive = !blocked
          if (blocked) {
            confirmHeld = false
            removeHeld = false
          }
          drawCursor()
        })

        // ---- セーブ ----
        // 園の中身を書き出す。ショップ前の道はショップから敷き直せるので含めない
        takeSnapshot.current = (): ParkSnapshot => ({
          roads: [...roads].filter((key) => !shopRoads.has(key)),
          stairs: [...stairsTiles.values()].map(({ x, y, dx, dy }) => ({ x, y, dx, dy })),
          queues: [...queueStates].map(([key, state]) => ({ key, state })),
          litter: [...litterTiles].map(([key, mask]) => ({ key, mask })),
          attractions: placedAttractions
            // 入口・出口を置いている途中のものは完成扱いにしない
            .filter((placed) => placed !== pendingAttraction)
            .map((placed) => ({
              id: placed.id,
              x: placed.x,
              y: placed.y,
              entrance: placed.entrance && {
                x: placed.entrance.x,
                y: placed.entrance.y,
                frame: placed.entrance.frame,
              },
              exit: placed.exit && {
                x: placed.exit.x,
                y: placed.exit.y,
                frame: placed.exit.frame,
              },
              entranceQueueKey: placed.entranceQueueKey,
              entranceFrame: placed.entranceFrame,
              settings: {
                suspended: placed.suspended,
                capacity: placed.capacity,
                speed: placed.speedSetting,
                rideTime: placed.rideTimeSetting,
                price: placed.price,
                version: placed.version,
                usedThisMonth: placed.usedThisMonth,
                usedLastMonth: placed.usedLastMonth,
                durability: placed.durability,
                needsRepair: placed.needsRepair,
              },
            })),
          shops: placedShops.map((placed) => ({
            id: placed.shop.id,
            x: placed.x,
            y: placed.y,
            direction: placed.direction,
            settings: {
              price: placed.price,
              tasteLevel: placed.tasteLevel,
              prizePrice: placed.prizePrice,
              winRate: placed.winRate,
              version: placed.version,
              usedThisMonth: placed.usedThisMonth,
              usedLastMonth: placed.usedLastMonth,
            },
          })),
          facilities: [...placedFacilities].map(([key, placed]) => ({
            id: placed.facility.id,
            ...parseKey(key),
            frame: placed.frame,
          })),
          buildings: [...placedBuildings],
          rubble: [...rubbleTiles.keys()].map((key) => parseKey(key)),
          staff: staff.map((worker) => ({
            id: worker.type.id,
            x: worker.fromX,
            y: worker.fromY,
            homeX: worker.homeX,
            homeY: worker.homeY,
            name: worker.name,
            version: worker.version,
            wage: worker.wage,
            hireDay: worker.hireDay,
            efficiency: worker.efficiency,
            paid: worker.paid,
            anger: worker.anger,
            route: worker.route ?? undefined,
          })),
        })
        // セーブデータから園を組み立て直す。道の絵は全部そろえてから一度に描き直す
        const restoreSnapshot = (snapshot: ParkSnapshot) => {
          // 道と整列歩道を先に並べる。ショップの前の道を敷く処理が入口の向きを見に来るので、
          // 整列歩道がそろう前に見られると入口のつなぎ先が失われる
          snapshot.roads.forEach((key) => roads.add(key))
          snapshot.stairs?.forEach(({ x, y, dx, dy }) => {
            const direction = stairsDirections.find((entry) => entry.dx === dx && entry.dy === dy)
            addStairs(x, y, direction ?? stairsDirectionAt(x, y))
          })
          snapshot.queues.forEach(({ key, state }) => {
            queueRoads.add(key)
            queueStates.set(key, state)
          })
          snapshot.litter?.forEach(({ key, mask }) => {
            litterTiles.set(key, mask)
            const { x, y } = parseKey(key)
            drawLitter(x, y)
          })
          snapshot.facilities.forEach(({ id, x, y, frame }) => {
            const facility = facilities.find((entry) => entry.id === id)
            if (facility) addFacility(facility, frame, x, y)
          })
          snapshot.buildings.forEach((id) => placedBuildings.add(id))
          snapshot.rubble?.forEach(({ x, y }) => addRubble(x, y))
          snapshot.attractions.forEach((saved) => {
            let attraction = attractions.find((entry) => entry.id === saved.id)
            // 古いセーブに秋冬の姿の ID で残っている場合は元のアトラクションに読み替える
            if (attraction && 'seasonalFormOf' in attraction) {
              attraction = attractions.find((entry) => entry.id === attraction!.seasonalFormOf)
            }
            if (!attraction) return
            const placed = addAttraction(attraction, saved.x, saved.y)
            if (saved.entrance) {
              placed.entrance = addAttractionAccess('entrance', saved.entrance.x, saved.entrance.y, saved.entrance.frame)
            }
            if (saved.exit) {
              placed.exit = addAttractionAccess('exit', saved.exit.x, saved.exit.y, saved.exit.frame)
            }
            placed.entranceQueueKey = saved.entranceQueueKey
            placed.entranceFrame = saved.entranceFrame
            if (saved.settings) {
              placed.suspended = saved.settings.suspended
              placed.capacity = saved.settings.capacity
              placed.speedSetting = saved.settings.speed
              placed.rideTimeSetting = saved.settings.rideTime
              placed.price = saved.settings.price
              placed.version = saved.settings.version
              placed.usedThisMonth = saved.settings.usedThisMonth ?? 0
              placed.usedLastMonth = saved.settings.usedLastMonth ?? 0
              // 古いセーブには耐久度がないので、そのバージョンでの満杯として扱う
              placed.durability = saved.settings.durability ?? durabilityLimitOf(attraction, placed.version)
              placed.needsRepair = saved.settings.needsRepair ?? false
            }
            // 手動で稼動させる系統は、ロード後は休止から始める
            if (attraction.manualStart) placed.suspended = true
          })
          snapshot.shops.forEach(({ id, x, y, direction, settings }) => {
            const shop = shops.find((entry) => entry.id === id)
            if (!shop) return
            completeShop(shop, x, y, direction, addShopBody(shop, x, y, direction))
            const placed = placedShops[placedShops.length - 1]
            if (!settings) return
            placed.price = settings.price
            placed.tasteLevel = settings.tasteLevel
            placed.prizePrice = settings.prizePrice
            placed.winRate = settings.winRate
            placed.version = settings.version
            placed.usedThisMonth = settings.usedThisMonth ?? 0
            placed.usedLastMonth = settings.usedLastMonth ?? 0
          })
          roads.forEach((key) => {
            const { x, y } = parseKey(key)
            redrawRoadTiles(x, y)
          })
          queueRoads.forEach((key) => {
            const { x, y } = parseKey(key)
            redrawQueueTiles(x, y)
          })
          updateAttractionEntranceFrames()
        }
        if (initialParkData.current) restoreSnapshot(initialParkData.current)

        // ---- 来園者 ----
        // バスはゲート下の道路(busRow)を走って busHaltX で停まり、
        // 来園者は U 字路中央下の看板マス(busStop)に並んで乗り降りする
        const busRow = gateRow + 4
        const busStop = { x: gateCenter, y: gateRow + 3 }
        const busHaltX = busStop.x - 1
        // U 字路(固定のゲート構造)の中央下のマス。バスから降りた客はここに現れる
        const gateCrossing = { x: gateCenter, y: gateRow + 2 }
        const guestConfig = game.guests
        const busConfig = game.bus
        const isSignTile = (x: number, y: number) => x === busStop.x && y === busStop.y

        // 来園者は 4 つの段階を一方向に進む。
        // walking(マス目を歩く) → queued(看板前で待つ) → toSign(看板へ) → toBus(バスへ乗り消える)
        // shopping はショップ利用中で、姿を消して一定時間後に walking へ戻る。
        // facility は設備(ゴミバコ・トイレ・ベンチ)の利用中。
        // queueing は整列歩道でアトラクション待ち、riding は乗車中(姿を消す)
        // 乗り物への行き来は 2 段で、看板マスを経由する。
        // 乗る: toSign(看板へ)→ toBus(看板の 1 マス南へ)で消える
        // 降りる: fromBus(看板へ)→ fromSign(ゲート下へ)で歩き出す
        type GuestPhase = 'walking' | 'queued' | 'toSign' | 'toBus' | 'fromBus' | 'fromSign'
          | 'shopping' | 'facility' | 'queueing' | 'riding'
        type Guest = {
          type: number
          bank: GuestBank
          // 1 日あたり何マス歩くか。種類ごとの設定値をそのまま持つ
          tilesPerDay: number
          phase: GuestPhase
          // 所持金。施設利用と入場料で減り、なくなると帰宅する
          money: number
          // 満腹度・水分(0〜250)。時間とともに減り、しきい値を下回ると飲食ショップを探す。
          // 0 になったままだと気分が下がる
          satiety: number
          hydration: number
          // 疲労(0〜250)。歩いている間増え、ベンチとトイレで回復する
          fatigue: number
          // 気分(-512〜511)。施設を利用した評価と欲求の限界で動き、尽きると帰宅する
          mood: number
          // 滞在値(0〜250)。1 日 5 増え、150 で帰宅の時刻になる
          stayValue: number
          // 今出ている反応の番号と、その残りフレーム。残りが visibleFrames を切ると絵は消える
          reaction: number
          reactionFrames: number
          reactionImage: Phaser.GameObjects.Image
          // 持っているゴミの数(独自仕様)。屋台型ショップの利用で増え、ゴミバコとトイレに移す。
          // 種類ごとに数えるので、一部だけ移しても残りの種類が分かる。
          // 並びは litterKinds と同じ(0 = 飲み物、1 = 食べ物)
          trash: number[]
          // 酔い(0〜250)。乗り物で増え、201 を超えると自分でも増え続け、249 で吐く
          nausea: number
          // 散らかりへの我慢(0〜250)。汚れたマスを歩くたびに減り、尽きると気分が下がる
          litterPatience: number
          // トイレ欲求(0〜250)。飲食すると発生し、しきい値以上で正面のトイレを使う
          toiletUrge: number
          // 利用中の設備。enter(利用マスへ) → stay(利用) → exit(立ち位置へ戻る)
          facility: { spot: FacilitySpot, placed: PlacedFacility, stage: 'enter' | 'stay' | 'exit', front: { x: number, y: number }, timer: number } | null
          // 欲求更新の端数持ち越し
          needTick: number
          // ショップが見つからなかったあとの再探索までの残り日数
          seekCooldown: number
          // 目的地のショップと、そこへ向かう(または出てくる)マス列
          targetShop: PlacedShop | null
          path: Array<{ x: number, y: number }> | null
          pathIndex: number
          // 並んでいる・乗っているアトラクションと、待機値(0〜250)。
          // ridden は乗車済みのアトラクション(種類 ID)で、同じ種類には乗り直さない
          targetAttraction: PlacedAttraction | null
          queueWait: number
          ridden: Set<string>
          // shopping 中の残り日数
          serviceRemaining: number
          // walking 用。マス間を progress(0〜1)で補間する
          fromX: number
          fromY: number
          toX: number
          toY: number
          progress: number
          previousX: number
          previousY: number
          // walking 以外で使う自由座標と、待ち行列で並ぶ側(1 = 右、-1 = 左)
          queueX: number
          queueY: number
          queueSide: number
          // 乗り降りする乗り物が停まっている列。バスは看板の列、バイクはその 1 マス左
          rideX: number
          facing: number
          walked: number
          paid: boolean
          leaveAtDay: number
          // バイクで乗り付けて園内で問題を起こす来園者。買い物も乗車もしない
          outlaw: boolean
          // 帰る時刻を過ぎ、ゲート下で迎えのバイクを待っている
          waitingForRide: boolean
          // ガードマンに退治され、バス待ち看板まで連れて行かれている間。自分では歩かない
          arrested: boolean
          // アウトローに出くわしたキッズが、次に怖がるまでの日付
          shockedUntil: number
          // 子とはぐれた親。ファミリーだけがなる
          lost: boolean
          // 迷子の子から見た親。null ならこの来園者は子ではない
          lostParent: Guest | null
          image: Phaser.GameObjects.Sprite
        }
        const guests: Guest[] = []
        // セーブから再開したときは経過日数も引き継ぐ(季節や滞在日数の基準になる)
        let elapsedDays = initialDays.current

        const guestNeighbours = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
        const wideAreaCorners = [[0, 0], [-1, 0], [0, -1], [-1, -1]]
        type Walkable = (x: number, y: number) => boolean
        // 入園済み(paid)で帰宅中でない客は、ゲート構造にも看板マスにも戻らない。
        // ショップ前の道はそのショップを利用する客だけが入るので、ここでは歩ける場所に含めない。
        // アウトローは入場料を払わないので、ゲートはいつでも通り抜ける
        const walkableFor = (guest: Guest, leaving: boolean): Walkable => {
          const allowGate = !guest.paid || leaving || guest.outlaw
          return (x, y) => {
            const key = tileKey(x, y)
            return (
              (roads.has(key) && !shopRoads.has(key))
              || stairsTiles.has(key)
              || (allowGate && isLockedEntranceTile(x, y))
              || (leaving && isSignTile(x, y))
            )
          }
        }
        // 現在地を含む 2×2 の4マスが全部歩けるブロックが1つでもあれば、広場や幅の広い道にいるとみなす。
        // 分岐点は斜めに他の道が接するだけで周囲マスの数は増えるので、正方形が埋まっているかで見る
        const isWideArea = (x: number, y: number, walkable: Walkable) => (
          wideAreaCorners.some(([ox, oy]) => (
            walkable(x + ox, y + oy) && walkable(x + ox + 1, y + oy)
            && walkable(x + ox, y + oy + 1) && walkable(x + ox + 1, y + oy + 1)
          ))
        )
        // 進行方向をスプライトの向きに直す(0=下 1=上 2=左 3=右)。動いていなければ下向き
        const directionOf = (dx: number, dy: number) => {
          if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 3 : dx < 0 ? 2 : 0
          return dy > 0 ? 0 : 1
        }

        // 待ち行列は看板マスを空け、左右の列が 1 マス目から 1 マス間隔で外へ広がる。
        // マップの端に達したらそれ以上は広がらず端に溜まる。
        // 側は客ごとに固定し、前が抜けても同じ側の中で前へ詰めるだけにする
        // (通し番号で左右を決めると、詰まるたびに全員が反対側へ歩き直してしまう)
        const waitingGuests: Guest[] = []
        const joinQueue = (guest: Guest) => {
          guest.phase = 'queued'
          const rightCount = waitingGuests.filter((other) => other.queueSide === 1).length
          guest.queueSide = rightCount * 2 <= waitingGuests.length ? 1 : -1
          waitingGuests.push(guest)
        }
        const leaveQueue = (guest: Guest) => {
          const index = waitingGuests.indexOf(guest)
          if (index >= 0) waitingGuests.splice(index, 1)
        }
        const queueTargetOf = (guest: Guest) => {
          // 乗り物のマスは看板の 1 マス南。列は乗り物の停まる位置に合わせる
          if (guest.phase === 'toBus') return { x: guest.rideX, y: busStop.y + 1 }
          if (guest.phase === 'toSign' || guest.phase === 'fromBus') return { x: busStop.x, y: busStop.y }
          if (guest.phase === 'fromSign') return { x: gateCrossing.x, y: gateCrossing.y }
          // 同じ側で自分より先に並んだ人数だけ外側へ
          let rank = 0
          for (const other of waitingGuests) {
            if (other === guest) break
            if (other.queueSide === guest.queueSide) rank += 1
          }
          const x = busStop.x + guest.queueSide * (rank + 1)
          return { x: Math.min(right, Math.max(left, x)), y: busStop.y }
        }

        // ショップ前の道(敷地内)にいる客は、店の向きが手前側(下・左)なら建物より前に、
        // 奥側(上・右)なら建物の陰に描く
        const guestDepthAt = (tileX: number, tileY: number) => {
          if (shopRoads.has(tileKey(tileX, tileY))) {
            const placed = shopCoveringTile(tileX, tileY)
            if (placed && (placed.direction === 0 || placed.direction === 2)) {
              return renderDepthAt('facility', placed.x, placed.y + placed.shop.height - 1) + 1
            }
          }
          return renderDepthAt('facility', tileX, tileY)
        }
        // 客の表示位置(マス単位)。tileOffset はマス内の足元の基準点、
        // benchSeatOffsets は着席中だけ足すずらし(添字は向き 0=下 1=上 2=左 3=右)
        const guestDisplay = guestConfig.display
        // ベンチの席にいる客の重なり順。上(奥)向きのベンチだけ背もたれが客より手前に
        // 来るので絵のすぐ後ろに、それ以外の向きは絵のすぐ前に描く
        const benchSeatDepth = (guest: Guest, tileX: number, tileY: number) => {
          const info = guest.facility
          if (!info || info.spot.kind !== 'bench') return null
          if (tileX !== info.spot.tile.x || tileY !== info.spot.tile.y) return null
          const placed = placedFacilities.get(info.spot.key)
          if (!placed) return null
          const anchor = parseKey(info.spot.key)
          const depth = renderDepthAt('facility', anchor.x, anchor.y)
          // 同じベンチの 2 席の間でも位置深度の原則(左・下が前)を守る。
          // 下・上向きは横並びで左の席、左・右向きは縦並びで下の席が前
          const front = placed.frame <= 1 ? tileX === anchor.x : tileY === anchor.y
          const bias = front ? 2 : 1
          return placed.frame === 1 ? depth - 3 + bias : depth + bias
        }
        // 立ち止まっている客は歩きの先頭コマ(直立)で止める
        const standStill = (guest: Guest) => {
          guest.walked = Math.floor(guest.walked)
        }
        const drawGuest = (guest: Guest, x: number, y: number, tileX: number, tileY: number, lift = heightAt(tileX, tileY)) => {
          // 着席中は専用ポーズ(シート 5 行目、列 = 方向)で固定。それ以外は歩行 4 コマ送り
          const seated = guest.facility?.spot.kind === 'bench' && guest.facility.stage === 'stay'
          const base = flatPoint(x + guestDisplay.tileOffset.x, y + guestDisplay.tileOffset.y)
          guest.image.setFrame(seated ? 16 + guest.facing : guest.facing * 4 + (Math.floor(guest.walked * 4) % 4))
            .setPosition(base.x - guest.bank.anchorX, base.y - lift * terrain.heightStepPx - guest.bank.anchorY)
            .setDepth(benchSeatDepth(guest, tileX, tileY) ?? guestDepthAt(tileX, tileY))
        }
        const placeGuestImage = (guest: Guest) => {
          // 乗車中は姿を消しているので描かない
          if (guest.phase === 'riding') return
          if (guest.phase === 'shopping') {
            // 店舗型は中にいるので描かない。屋台型は店先に立ち止まった姿を描く
            if (guest.targetShop?.shop.serviceStyle === 'building') return
            drawGuest(guest, guest.fromX, guest.fromY, guest.fromX, guest.fromY)
            return
          }
          if (guest.phase !== 'walking' && guest.phase !== 'facility' && guest.phase !== 'queueing') {
            drawGuest(guest, guest.queueX, guest.queueY, Math.round(guest.queueX), Math.round(guest.queueY))
            return
          }
          // ベンチ着席中だけ、席マスの通常位置に benchSeatOffsets を足した位置に描く
          if (guest.facility?.stage === 'stay' && guest.facility.spot.kind === 'bench') {
            const offset = guestDisplay.benchSeatOffsets[guest.facing]
            drawGuest(guest, guest.fromX + offset.x, guest.fromY + offset.y, guest.fromX, guest.fromY)
            return
          }
          // 投影はマス座標に対して線形なので、マス座標で補間してから投影してよい。
          // 高さは階段の昇り降りに合わせてなめらかに補間する
          const x = guest.fromX + (guest.toX - guest.fromX) * guest.progress
          const y = guest.fromY + (guest.toY - guest.fromY) * guest.progress
          const fromLift = heightAt(guest.fromX, guest.fromY)
          const toLift = heightAt(guest.toX, guest.toY)
          const lift = fromLift + (toLift - fromLift) * guest.progress
          const leading = guest.progress < 0.5
          drawGuest(guest, x, y, leading ? guest.fromX : guest.toX, leading ? guest.fromY : guest.toY, lift)
        }
        // 反応のアイコンは客の基準点から決まった位置に、客のすぐ手前へ描く。
        // 姿が見えないとき(乗車中・店舗型の店内)は出さない
        const placeReactionImage = (guest: Guest) => {
          const reactionConfig = guestConfig.reaction
          // 正面ゲートを出てバスへ向かう客には出さない
          const leaving = guest.phase === 'queued' || guest.phase === 'toSign' || guest.phase === 'toBus'
          const visible = !leaving && guest.image.visible && guest.reactionFrames >= reactionConfig.visibleFrames
          guest.reactionImage.setVisible(visible)
          if (!visible) return
          guest.reactionImage
            .setTexture(`reaction-${guest.reaction}`)
            .setPosition(
              guest.image.x + guest.bank.anchorX + reactionConfig.offset.x,
              guest.image.y + guest.bank.anchorY + reactionConfig.offset.y,
            )
            .setDepth(guest.image.depth + 1)
        }

        // 道路が撤去されるなどして完全に孤立した場合、歩ける道は無視して最寄りの道路のマスへ直線的に進む
        const strandedRoadStep = (guest: Guest) => {
          let best: { x: number, y: number } | null = null
          let bestDistance = Infinity
          for (const key of roads) {
            if (shopRoads.has(key)) continue
            const { x: roadX, y: roadY } = parseKey(key)
            const distance = Math.abs(roadX - guest.toX) + Math.abs(roadY - guest.toY)
            if (distance >= bestDistance) continue
            bestDistance = distance
            best = { x: roadX, y: roadY }
          }
          if (!best) return null
          const dx = best.x - guest.toX
          const dy = best.y - guest.toY
          if (dx === 0 && dy === 0) return best
          return Math.abs(dx) >= Math.abs(dy)
            ? { x: guest.toX + Math.sign(dx), y: guest.toY }
            : { x: guest.toX, y: guest.toY + Math.sign(dy) }
        }
        // 帰る客はバス停へ近づく方向を選び、それ以外は来た道以外から無作為に選ぶ
        const chooseGuestStep = (guest: Guest, leaving: boolean) => {
          const walkable = walkableFor(guest, leaving)
          const options = guestNeighbours
            .map(({ x, y }) => ({ x: guest.toX + x, y: guest.toY + y }))
            .filter(({ x, y }) => walkable(x, y)
              && (sameHeight(x, y, guest.toX, guest.toY) || stairsLink(guest.toX, guest.toY, x, y))
              && stairsTraversable(guest.toX, guest.toY, x, y))
          if (options.length === 0) return strandedRoadStep(guest)
          const forward = options.filter(({ x, y }) => !(x === guest.previousX && y === guest.previousY))
          const pool = forward.length > 0 ? forward : options
          if (leaving) {
            // 交差点(選択肢が複数)でのみ最短方向を選び直す。一本道は後ろ以外に選択肢がないので直進が保たれる
            const distance = ({ x, y }: { x: number, y: number }) => Math.abs(x - busStop.x) + Math.abs(y - busStop.y)
            return pool.reduce((best, option) => distance(option) < distance(best) ? option : best)
          }
          const dx = guest.fromX - guest.previousX
          const dy = guest.fromY - guest.previousY
          if ((dx !== 0 || dy !== 0) && isWideArea(guest.fromX, guest.fromY, walkable)) {
            const straight = pool.find(({ x, y }) => x === guest.fromX + dx && y === guest.fromY + dy)
            if (straight) return straight
          }
          return pool[Math.floor(Math.random() * pool.length)]
        }

        // ---- 飲食ショップの利用 ----
        // 満腹度と水分は 1 日 15 回の更新で 1 ずつ減り、100 を下回ると飲食ショップを探す。
        // 原作は逆に「空腹値」「渇き値」が増えていく作りで、それとは別に満腹値を持っていた
        const needsConfig = guestConfig.needs
        const lostChildConfig = game.lostChild
        // ショップの分類と、それが満たす内部値の対応
        const needFieldOf = { food: 'satiety', drink: 'hydration' } as const
        const moodConfig = guestConfig.mood
        const stayConfig = guestConfig.stay
        const shopUseConfig = game.shopUse
        const shopUseEffectOf = (shop: Shop) => ('useEffect' in shop ? shop.useEffect : null)
        // 味付けを濃くすると商品の効き方が変わる。設定の 1 段目を基準に、
        // 段階に比例して効くもの・薄いほど効くもの・段階によらないものがある(design/15)
        const shopEffectAt = (shop: Shop, level: number, field: 'satiety' | 'hydration') => {
          const effect = shopUseEffectOf(shop)
          if (!effect) return 0
          const base = effect[field]
          const scale = ('useEffectScale' in shop ? shop.useEffectScale : null)?.[field] ?? 'fixed'
          if (scale === 'level') return base * (level + 1)
          const steps = game.facilityMenu.maxTasteLevel + 1
          if (scale === 'inverse') return Math.trunc(base * (steps - level) / steps)
          return base
        }
        const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
        const changeMood = (guest: Guest, delta: number) => {
          guest.mood = clamp(guest.mood + delta, moodConfig.min, moodConfig.max)
        }
        const updateGuestNeeds = (guest: Guest, days: number) => {
          // 施設を利用している間(向かっている途中を含む)は欲求も滞在値も進まない
          if (guest.phase === 'shopping' || guest.phase === 'riding' || guest.phase === 'facility') return
          guest.stayValue = Math.min(stayConfig.max, guest.stayValue + stayConfig.perDay * days)
          guest.needTick += days * needsConfig.updatesPerDay
          while (guest.needTick >= 1) {
            guest.needTick -= 1
            // 満腹度と水分は常に減り、尽きたままだと気分が下がっていく
            const needs = ['hydration', 'satiety'] as const
            needs.forEach((field) => {
              if (guest[field] <= 0) {
                changeMood(guest, moodConfig.limitPenalty)
                return
              }
              guest[field] -= 1
            })
            // 満腹度か水分が一定を割ると、包み紙を持ち歩くのが面倒になってくる。
            // 我慢できる数を超えていたら足元にまとめて捨てる(独自仕様)。
            // 歩道は種類の有無しか持たないので、同じ種類を何個捨てても絵は 1 つになる
            const belowDropThreshold = guest.satiety < litterConfig.dropThreshold
              || guest.hydration < litterConfig.dropThreshold
            if (belowDropThreshold && trashTotal(guest.trash) >= litterThreshold) {
              guest.trash.forEach((count, kind) => {
                if (count > 0) addLitter(guest.fromX, guest.fromY, litterKinds[kind].bit)
              })
              guest.trash.fill(0)
            }
            // 酔いは限界に近づくと自分でも上がっていき、限りまで来ると足元に吐く(原作 0x801ecf28)
            if (guest.nausea >= litterConfig.nauseaRiseThreshold) {
              guest.nausea = Math.min(litterConfig.nauseaMax, guest.nausea + litterConfig.nauseaRisePerUpdate)
            }
            if (guest.nausea >= litterConfig.vomitThreshold) {
              guest.nausea = 0
              addLitter(guest.fromX, guest.fromY, 4)
            }
            // トイレ欲求は飲食後に発生し、限界に達すると我慢できずに消えて気分が大きく下がる
            if (guest.toiletUrge > 0) {
              if (guest.toiletUrge < needsConfig.max) guest.toiletUrge += 1
              else {
                guest.toiletUrge = 0
                changeMood(guest, moodConfig.toiletPenalty)
              }
            }
            if (guest.phase === 'walking') {
              guest.fatigue = Math.min(needsConfig.max, guest.fatigue + needsConfig.fatigueWalkPerUpdate)
              // 迷子は原作 `FUN_801efb78`(D2MAIN)の条件そのまま: 種別 7/8(ファミリー)だけが対象、
              // 疲労が 100 以下、パーク全体で同時に 1 件まで(`_DAT_8014f560` の 0x40/0x20 ビット)
              if (lostChildArmed && !guest.lost && !guest.lostParent
                && guestConfig.types[guest.type].id === 'family'
                && guest.fatigue <= lostChildConfig.maxFatigue
                && !guests.some((other) => other.lost)
                && Math.random() < lostChildConfig.chancePerUpdate) {
                lostChildArmed = false
                guest.lost = true
                guest.path = null
                guest.pathIndex = 0
                guest.targetShop = null
                spawnLostChild(guest)
                buildMessageHandler.current('パーク内で迷子になっている子どもがいるようです。')
              }
            }
            if (guest.fatigue >= needsConfig.max) changeMood(guest, moodConfig.limitPenalty)
          }
          // 気分が尽きた客は滞在時間を待たずに帰る
          if (guest.mood <= moodConfig.leave) guest.leaveAtDay = Math.min(guest.leaveAtDay, elapsedDays)
        }

        // ---- 反応(吹き出し) ----
        // 原作仕様: 来園者は反応を 1 つだけ持ち、優先度の値が小さいほど強い。
        // 同じか強い反応は即座に上書きし、弱い反応は今の反応の残りが尽きてからしか出ない。
        // 出た反応は holdFrames 保たれ、残りが visibleFrames を切ると絵だけ消える
        // (原作 FUN_800c8af8 / FUN_800c8b88 / FUN_800c8888)
        const reactionPriority = reactions.list.map(({ priority }) => priority)
        const reactionConfig = guestConfig.reaction
        const showReaction = (guest: Guest, id: number) => {
          if (reactionPriority[id] > reactionPriority[guest.reaction] && guest.reactionFrames > 0) return
          if (guest.reaction === id) return
          guest.reaction = id
          guest.reactionFrames = reactionConfig.holdFrames
        }
        // 何も起きていないときに、今の状態から出る反応を選び直す。
        // 上から順に試し、優先度の強いものが残る
        const refreshStandingReaction = (guest: Guest, attractionKinds: number) => {
          const wantsFood = guest.satiety < needsConfig.seekThreshold
          const wantsDrink = guest.hydration < needsConfig.seekThreshold
          if (wantsFood && wantsDrink) showReaction(guest, 0x00)
          if (wantsFood) showReaction(guest, 0x01)
          if (wantsDrink) showReaction(guest, 0x02)
          if (guest.mood <= moodConfig.leave) showReaction(guest, 0x0b)
          if (guest.ridden.size > 0) {
            if (guest.ridden.size === attractionKinds) showReaction(guest, 0x0e)
            else if (Math.floor((guest.ridden.size + 1) * 100 / (attractionKinds + 1) / 10) >= 7) {
              showReaction(guest, 0x0d)
            }
          }
          if (guest.stayValue >= stayConfig.limit) {
            showReaction(guest, 0x0f)
            if (guest.fatigue >= needsConfig.max) showReaction(guest, 0x06)
            return
          }
          if (guest.toiletUrge > needsConfig.toiletComplaint && guest.fatigue >= needsConfig.fatigueComplaint) {
            showReaction(guest, 0x07)
            return
          }
          if (guest.litterPatience < litterConfig.complaintPatience) {
            showReaction(guest, 0x17)
            return
          }
          if (guest.fatigue >= needsConfig.max) {
            showReaction(guest, 0x10)
            return
          }
          // 気分がふつうの範囲なら何も出さない
          if (guest.mood >= moodConfig.good) showReaction(guest, 0x1b)
          else if (guest.mood < moodConfig.bad) showReaction(guest, 0x1d)
        }

        // ---- 施設の評価 ----
        // 原作仕様: 利用のたびに点数を出し、点数から反応・気分・施設の評価が決まる。
        // 点数は -1023〜1023 に収め、気分にその 1/10、施設の評価に 1/100 を足す
        const evaluationConfig = game.evaluation
        const applyScore = (guest: Guest, score: number, rate: (delta: number) => void) => {
          changeMood(guest, Math.trunc(score / evaluationConfig.moodDivisor))
          rate(Math.trunc(score / evaluationConfig.ratingDivisor))
        }
        // 点数が負なら値段への不満が出る(原作 FUN_800c9a28)
        const showPriceComplaint = (guest: Guest, score: number) => {
          if (score < evaluationConfig.ripoff) showReaction(guest, 0x16)
          else if (score < 0) showReaction(guest, 0x15)
        }
        // 店を利用した客の評価(原作 FUN_800b37dc)。点数は販売価格と仕入価格の比、
        // それに味付けの段階で決まる。味付けが適正から外れていると店の評価も下がる
        const evaluateShopUse = (guest: Guest, placed: PlacedShop) => {
          const { shop, tasteLevel: level } = placed
          let score = shop.stockPrice > 0
            ? (evaluationConfig.priceStandard - Math.floor(placed.price * 10 / shop.stockPrice)) * 100
            : 0
          let complaint = 0
          const kind = shop.tasteKind
          const middle = evaluationConfig.tasteMiddle
          if (kind !== null && kind < 6) {
            // 甘さ・ニク・メン・シーフード系は濃いほど良い
            score += evaluationConfig.tastePerStep * (level - middle)
            if (level === 0) complaint = evaluationConfig.complaintRating
          }
          else if (kind !== null && kind >= 11) {
            // 氷・水分は多いほど中身が減るので方向が逆になる
            score += evaluationConfig.tastePerStep * (middle - level)
            if (level === 4) complaint = evaluationConfig.complaintRating
          }
          else if (kind !== null && kind >= 7) {
            // シオ・タバスコ・辛さ・カフェインは中間が良く、濃すぎても薄すぎても下がる
            score -= evaluationConfig.tasteMismatch * Math.abs(level - middle)
            if (level === 0 || level === 4) complaint = evaluationConfig.complaintRating
          }
          if (complaint !== 0) {
            showReaction(guest, shop.category === 'drink' ? 0x11 : 0x12)
            placed.rating = clamp(placed.rating + complaint, -evaluationConfig.ratingRange, evaluationConfig.ratingRange)
          }
          score = clamp(score, -evaluationConfig.scoreRange, evaluationConfig.scoreRange)
          if (score >= evaluationConfig.satisfied) showReaction(guest, 0x1e)
          applyScore(guest, score, (delta) => {
            placed.rating = clamp(placed.rating + delta, -evaluationConfig.ratingRange, evaluationConfig.ratingRange)
          })
          guest.fatigue = Math.max(0, guest.fatigue - shopUseConfig.useFatigueRelief)
          showPriceComplaint(guest, score)
        }
        // 乗り終えた客の評価(原作 FUN_800b32c4)。興奮度に対する速度設定のずれ、運転時間、
        // 乗車額、列で待った長さから点数を出す
        const evaluateRide = (guest: Guest, placed: PlacedAttraction) => {
          const excitement = placed.attraction.excitement
          const fit = 10 - Math.abs(excitement - placed.speedSetting)
          const score = clamp(
            2 * fit * Math.abs(excitement * 10 - 45)
            + (placed.rideTimeSetting - evaluationConfig.rideTimeBase) * evaluationConfig.rideTimePerStep
            - Math.trunc(evaluationConfig.ridePriceWeight * placed.price / 10)
            - Math.floor(guest.queueWait),
            -evaluationConfig.scoreRange, evaluationConfig.scoreRange,
          )
          const rate = (delta: number) => {
            placed.rating = clamp(placed.rating + delta, -evaluationConfig.ratingRange, evaluationConfig.ratingRange)
          }
          showPriceComplaint(guest, score)
          if (score < 0) {
            rate(score < evaluationConfig.ripoff ? evaluationConfig.ripoffRating : evaluationConfig.expensiveRating)
          }
          // 運転設定が興奮度に合っていないと不満が出る
          if (excitement >= evaluationConfig.thrillExcitement && placed.speedSetting < evaluationConfig.settingLow) {
            showReaction(guest, 0x18)
          }
          if (excitement < evaluationConfig.moodExcitement && placed.speedSetting >= evaluationConfig.settingHigh) {
            showReaction(guest, 0x19)
          }
          if (placed.rideTimeSetting < evaluationConfig.settingLow) showReaction(guest, 0x1a)
          if (score >= evaluationConfig.satisfied) showReaction(guest, 0x1f)
          else if (score >= evaluationConfig.good) showReaction(guest, 0x1b)
          else if (score >= evaluationConfig.fair) showReaction(guest, 0x1c)
          else if (score >= 0) showReaction(guest, 0x1d)
          applyScore(guest, score, rate)
        }
        // 客の現在地から歩ける各マスへ、1 つ手前のマスを幅優先で記録する。
        // 歩ける条件は徘徊時と同じで、ショップ前の道は含めない
        const buildReachMap = (startX: number, startY: number, walkable: Walkable) => {
          const previous = new Map<string, string | null>()
          previous.set(tileKey(startX, startY), null)
          const frontier = [{ x: startX, y: startY }]
          for (let head = 0; head < frontier.length; head += 1) {
            const current = frontier[head]
            for (const { x: ox, y: oy } of guestNeighbours) {
              const x = current.x + ox
              const y = current.y + oy
              const key = tileKey(x, y)
              if (previous.has(key) || !walkable(x, y)) continue
              if (!sameHeight(x, y, current.x, current.y) && !stairsLink(current.x, current.y, x, y)) continue
              if (!stairsTraversable(current.x, current.y, x, y)) continue
              previous.set(key, tileKey(current.x, current.y))
              frontier.push({ x, y })
            }
          }
          return previous
        }
        // 入口マス(ショップ前の道の 1 マス外)まで道路を歩き、そこから敷地の前端
        // (ショップ前の道のいちばん外側のマス)へ 1 マス入った位置が利用位置。
        // 入口まで歩いて行けなければ null
        const shopApproachPath = (reach: Map<string, string | null>, placed: PlacedShop) => {
          const entrance = shopEntranceTile(placed.shop, placed.x, placed.y, placed.direction)
          const entranceKey = tileKey(entrance.x, entrance.y)
          if (!reach.has(entranceKey)) return null
          const path: Array<{ x: number, y: number }> = []
          let key: string | null = entranceKey
          while (key) {
            path.unshift(parseKey(key))
            key = reach.get(key) ?? null
          }
          path.shift()
          const walkway = shopWalkwayTiles(placed.shop, placed.x, placed.y, placed.direction)
          path.push(walkway[walkway.length - 1])
          return path
        }
        // インフォメーションの正面マス。無ければ null
        const informationFront = () => {
          for (const [key, placed] of placedFacilities) {
            if (placed.facility.id === 'information') return parseKey(key)
          }
          return null
        }
        // はぐれた親子をインフォメーションへ向かわせる。原作は迷子が出たときに
        // 親の目的地をインフォメーションにし、子も手が空くたびにそこを目指す
        const headForInformation = (guest: Guest) => {
          const target = informationFront()
          if (!target) return
          if (guest.fromX === target.x && guest.fromY === target.y) return
          const reach = buildReachMap(guest.fromX, guest.fromY, walkableFor(guest, false))
          const goal = tileKey(target.x, target.y)
          if (!reach.has(goal)) return
          const path: Array<{ x: number, y: number }> = []
          let key: string | null = goal
          while (key) {
            path.unshift(parseKey(key))
            key = reach.get(key) ?? null
          }
          path.shift()
          if (path.length === 0) return
          guest.path = path
          guest.pathIndex = 0
        }
        // 店を利用できるか(支払い能力とキッズ制限)。探索と通りすがり発見で共通
        const canAffordShop = (guest: Guest, shop: Shop) => {
          if (shopUseConfig.initialPrice * guestConfig.types[guest.type].people > guest.money) return false
          return !(guestConfig.types[guest.type].id === 'kids' && 'kidsAllowed' in shop && shop.kidsAllowed === false)
        }
        // その分類の商品を欲しがっているか(満腹度・水分がしきい値を下回っている)
        const wantsShopCategory = (guest: Guest, category: 'food' | 'drink') => (
          guest[needFieldOf[category]] < needsConfig.seekThreshold
        )
        // 行き先の候補。原作は来園者区分ごとに 5 件までの候補表を持っていて、そこから
        // 支払える店を絞る。候補表の作られ方は未確定なので、本作は同じ分類の店から
        // 無作為に 5 件まで選ぶことで置き換えている
        const pickShopCandidates = (guest: Guest, category: 'food' | 'drink') => {
          const pool = placedShops.filter(({ shop }) => shop.category === category)
          for (let index = pool.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1))
            const held = pool[index]
            pool[index] = pool[swap]
            pool[swap] = held
          }
          return pool.slice(0, shopUseConfig.candidateCount).filter(({ shop }) => canAffordShop(guest, shop))
        }
        // 満腹度・水分がしきい値を下回った客の行き先を選ぶ。原作と同じく食べ物を先に調べ、
        // 候補 5 件のうち支払額(価格 × 人数倍率)を払えるものから無作為に 1 件選ぶ。
        // キッズはビアホールを利用できない
        const chooseShopTarget = (guest: Guest): Array<{ x: number, y: number }> | null => {
          const wants: Array<'food' | 'drink'> = []
          if (wantsShopCategory(guest, 'food')) wants.push('food')
          if (wantsShopCategory(guest, 'drink')) wants.push('drink')
          if (wants.length === 0) return null
          let reach: Map<string, string | null> | null = null
          for (const category of wants) {
            const candidates = pickShopCandidates(guest, category)
            if (candidates.length === 0) continue
            reach = reach ?? buildReachMap(guest.fromX, guest.fromY, walkableFor(guest, false))
            const options: Array<{ placed: PlacedShop, path: Array<{ x: number, y: number }> }> = []
            for (const placed of candidates) {
              const path = shopApproachPath(reach, placed)
              if (path) options.push({ placed, path })
            }
            if (options.length === 0) continue
            const choice = options[Math.floor(Math.random() * options.length)]
            guest.targetShop = choice.placed
            guest.path = choice.path
            guest.pathIndex = 0
            return choice.path
          }
          guest.seekCooldown = 1
          return null
        }
        // 原作は空腹・渇きがしきい値を超えると店を 1 件決めて、そこを目的地にして歩く
        // (FUN_801ece50 が FUN_801ee838 で候補を選び、客の目的地タイルに設定する)。
        // 本作は目的地までの道順を経路探索で出すので、原作より迷わずたどり着く
        const guestRouteSearchEnabled = true
        // 徘徊中に店の前(入口の 1 マス外、shopEntranceSpots)を通りかかった客が、
        // 条件を満たせばその場で気づいて入店する(原作 FUN_801eddc4: 立ち止まるたびに
        // 隣接マスの目印を調べる処理に相当。ショップ前の道はその店の一部なので、
        // そこにつながるマスを通ったときに見つかる)
        const tryDiscoverShopAtEntrance = (guest: Guest, leaving: boolean): boolean => {
          if (leaving) return false
          const placed = shopEntranceSpots.get(tileKey(guest.fromX, guest.fromY))
          if (!placed) return false
          const { shop } = placed
          if (shop.category !== 'food' && shop.category !== 'drink') return false
          // 利用できない理由はそれぞれ反応になる(原作は店の前で立ち止まるたびに調べる)
          const need = guest[needFieldOf[shop.category]]
          if (guest.satiety > needsConfig.fullThreshold && guest.hydration > needsConfig.fullThreshold) {
            showReaction(guest, 0x03)
            return false
          }
          if (need > needsConfig.fullThreshold) {
            showReaction(guest, shop.category === 'food' ? 0x04 : 0x05)
            return false
          }
          if (!wantsShopCategory(guest, shop.category)) return false
          // 払えないときは反応を出さずに素通りする
          if (!canAffordShop(guest, shop)) return false
          const walkway = shopWalkwayTiles(shop, placed.x, placed.y, placed.direction)
          guest.targetShop = placed
          guest.path = [walkway[walkway.length - 1]]
          guest.pathIndex = 0
          return true
        }
        // 入口マスから店を向く方向(店の向きの反対)
        const facingByShopDirection = [1, 0, 3, 2]
        // ---- アトラクションの利用 ----
        // 原作仕様: 立ち止まるたびに隣の整列歩道を調べ、条件(未乗車の種類・所持金・確率)を
        // 満たすと列に入る。列は 1 マス 1 組で入口へ詰め、待機値が 250 に達すると離脱する。
        // 入口に着くと定員まで乗り込んで姿を消し、乗車が終わると全員が出口の前に出て
        // 乗車額を払う(原作 FUN_801eddc4 / FUN_801ec200 / FUN_801e6950)
        const occupiedQueueTiles = new Set<string>()
        // 受け入れ(loading)と稼働(running)を繰り返す。受け入れ中に定員に達するか
        // 受け入れ時間が過ぎると入口を閉めて動き出し、乗車時間が過ぎると全員降ろす
        // seats は席順に並んだ乗車中の客の見た目(乗車用バンク番号)
        type RideState = {
          aboard: Guest[], people: number, seats: number[],
          phase: 'loading' | 'running', timer: number,
        }
        // 稼働 1 回の日数。原作は (運転時間の設定値 + 1) × 一段あたりの時間
        const rideDaysOf = (placed: PlacedAttraction) => (
          (placed.rideTimeSetting + 1) * attractionUseConfig.rideDaysPerStep
        )
        // アニメのコマを切り替える。絵が変わったら true
        const showAttractionFrame = (placed: PlacedAttraction, frame: number, remaining: number) => {
          placed.animRemaining = remaining
          if (placed.animFrame === frame) return false
          placed.animFrame = frame
          placed.image.setTexture(attractionFrameKey(attractionForm(placed.attraction).id, frame))
          return true
        }
        // コマを表示する内部フレーム数。原作はコマ表の値を高速なら 1/4、それ以外は 1/2 に
        // するので、速度を落としても絵の速さが変わらない(原作 FUN_800abb1c)。
        // 本作は高速のときの速さを基準にして、ゲーム速度に比例させる
        const celFrames = (duration: number) => (duration >> 2) + 1
        // 1 日あたりに送るコマ数。高速(1 日 fastestSecondsPerDay 秒)で
        // 原作と同じ 30fps になるように決める
        const animFramesPerDay = game.time.originalFramesPerSecond * fastestSecondsPerDay
        // 動き出すとき。停止中の絵を持つ種類は稼働中の絵の先頭へ切り替え、
        // 1 つしかない種類は止めた続きから送る(そうしないと乗車客との位相がずれる)
        const startRideAnimation = (placed: PlacedAttraction) => {
          const form = attractionForm(placed.attraction)
          if (form.animation.groups.length < 2) return
          const group = runGroupOf(form)
          showAttractionFrame(placed, group.from, celFrames(group.durations[0]))
        }
        // 止まったら停止中の絵に戻す。グループが 1 つしかない種類は止めた位置のまま
        const stopRideAnimation = (placed: PlacedAttraction) => {
          const form = attractionForm(placed.attraction)
          if (form.animation.groups.length < 2) return
          const group = idleGroupOf(form)
          showAttractionFrame(placed, group.from, celFrames(group.durations[0]))
        }
        // 稼働中のコマ送り。繰り返す絵は先頭へ戻り、繰り返さない絵は最後のコマで止まる。
        // 絵が変わったら true
        const advanceRideAnimation = (placed: PlacedAttraction, days: number) => {
          const group = runGroupOf(attractionForm(placed.attraction))
          if (group.count <= 1) return false
          let index = placed.animFrame - group.from
          if (index < 0 || index >= group.count) index = 0
          let remaining = placed.animRemaining - days * animFramesPerDay
          while (remaining <= 0) {
            if (index + 1 < group.count) index += 1
            else if (group.loop) index = 0
            else {
              remaining = 0
              break
            }
            remaining += celFrames(group.durations[index])
          }
          return showAttractionFrame(placed, group.from + index, remaining)
        }
        // 施設の基準点(絵をマスに合わせる位置)。乗車客の位置はここからのずれで決まる
        const attractionAnchorPoint = (placed: PlacedAttraction) => point(
          placed.x + Math.floor(placed.width / 2),
          placed.y + placed.height - 1 - Math.floor(placed.height / 2),
        )
        const ridersOf = (placed: PlacedAttraction) => {
          const form = attractionForm(placed.attraction)
          return 'riders' in form ? form.riders : null
        }
        // 席ごとに、位相から決まる姿勢で客を描く(原作 FUN_801f8094)
        const drawRiders = (placed: PlacedAttraction) => {
          const riders = ridersOf(placed)
          const seats = rideStates.get(placed)?.seats ?? []
          const shown = riders ? Math.min(seats.length, riders.seatPhases.length) : 0
          const anchor = attractionAnchorPoint(placed)
          const depth = renderDepthAt('facility', placed.x, placed.y + placed.height - 1) + 1
          for (let seat = 0; seat < shown; seat += 1) {
            const pose = riders!.poses[(placed.riderPhase + riders!.seatPhases[seat]) % riders!.poses.length]
            const bank = riderBanks[String(seats[seat])]
            if (!pose || !bank) {
              placed.riderImages[seat]?.setVisible(false)
              continue
            }
            const key = `rider-${seats[seat]}`
            const image = placed.riderImages[seat] ?? this.add.image(0, 0, key).setOrigin(0)
            placed.riderImages[seat] = image
            image.setTexture(key, pose.frame)
              .setPosition(anchor.x + pose.x - bank.anchorX, anchor.y + pose.y - bank.anchorY)
              // 先の席ほど手前(原作は先に描いたものが手前に来る)
              .setDepth(depth + shown - seat)
              .setVisible(true)
          }
          for (let seat = shown; seat < placed.riderImages.length; seat += 1) {
            placed.riderImages[seat].setVisible(false)
          }
        }
        const rideStates = new Map<PlacedAttraction, RideState>()
        const queueDistanceMap = (placed: PlacedAttraction) => {
          const cached = queueDistanceCache.get(placed)
          if (cached) return cached
          const map = new Map<string, number>()
          if (placed.entranceQueueKey && queueRoads.has(placed.entranceQueueKey)) {
            map.set(placed.entranceQueueKey, 0)
            const frontier = [parseKey(placed.entranceQueueKey)]
            for (let head = 0; head < frontier.length; head += 1) {
              const current = frontier[head]
              const currentState = queueStates.get(tileKey(current.x, current.y))
              if (currentState === undefined) continue
              const distance = map.get(tileKey(current.x, current.y))!
              for (const neighbor of queueNeighbors) {
                // 絵に出ているつながりに沿ってだけ辿る。隣り合っただけのマスへは進まないので、
                // コの字に折り返した列でも近道せずに道順どおりに並ぶ
                if ((queueMaskByState[currentState] & neighbor.mask) === 0) continue
                const x = current.x + neighbor.x
                const y = current.y + neighbor.y
                const key = tileKey(x, y)
                if (map.has(key) || !queueRoads.has(key)) continue
                if (!sameHeight(x, y, current.x, current.y)) continue
                map.set(key, distance + 1)
                frontier.push({ x, y })
              }
            }
          }
          queueDistanceCache.set(placed, map)
          return map
        }
        // 列で立ち止まっているときに向く方向。列の道順で 1 つ前のマス(先頭は入口)を向く
        const queueFacingAt = (placed: PlacedAttraction, x: number, y: number) => {
          const distances = queueDistanceMap(placed)
          const distance = distances.get(tileKey(x, y))
          if (distance === undefined) return null
          if (distance === 0) {
            const entrance = placed.entrance
            return entrance ? directionOf(entrance.x - x, entrance.y - y) : null
          }
          const ahead = queueNeighbors.find((neighbor) => (
            distances.get(tileKey(x + neighbor.x, y + neighbor.y)) === distance - 1
          ))
          return ahead ? directionOf(ahead.x, ahead.y) : null
        }
        const rideStateOf = (placed: PlacedAttraction) => {
          let state = rideStates.get(placed)
          if (!state) {
            state = { aboard: [], people: 0, seats: [], phase: 'loading', timer: 0 }
            rideStates.set(placed, state)
          }
          return state
        }
        // 立ち止まったマスの隣の整列歩道(入口につながっているもの)から列に入るかどうか
        const tryJoinAttractionQueue = (guest: Guest, leaving: boolean): boolean => {
          if (leaving) return false
          for (const { x: ox, y: oy } of guestNeighbours) {
            const x = guest.fromX + ox
            const y = guest.fromY + oy
            const key = tileKey(x, y)
            if (!queueRoads.has(key) || occupiedQueueTiles.has(key)) continue
            if (!sameHeight(guest.fromX, guest.fromY, x, y)) continue
            const placed = placedAttractions.find((attraction) => (
              attraction.exit && queueDistanceMap(attraction).has(key)
            ))
            if (!placed || guest.ridden.has(placed.id)) continue
            // 休止中・点検中のアトラクションには並ばない
            if (placed.suspended || placed.underInspection) continue
            if (placed.price * guestConfig.types[guest.type].people > guest.money) continue
            if (Math.random() >= attractionUseConfig.joinChance) continue
            occupiedQueueTiles.add(key)
            guest.targetAttraction = placed
            guest.phase = 'queueing'
            guest.progress = 0
            guest.toX = x
            guest.toY = y
            guest.facing = directionOf(ox, oy)
            return true
          }
          return false
        }
        // 列から離れて徘徊に戻す。待ちくたびれて離れた場合(goHome)は待機値を戻して帰宅へ向かう
        const abandonQueue = (guest: Guest, goHome = false) => {
          occupiedQueueTiles.delete(tileKey(guest.fromX, guest.fromY))
          occupiedQueueTiles.delete(tileKey(guest.toX, guest.toY))
          guest.targetAttraction = null
          guest.phase = 'walking'
          if (!goHome) return
          // 待ちくたびれると気分が下がり、待ちくたびれ具合は種類ごとの初期値に戻る
          changeMood(guest, moodConfig.queueGiveUpPenalty)
          guest.queueWait = guestConfig.types[guest.type].queueWaitBase
          guest.leaveAtDay = elapsedDays
        }
        // 出口の絵のあるマス(敷地のすぐ外)。出口が未設置なら敷地の手前中央
        const rideExitSpot = (placed: PlacedAttraction) => (
          placed.exit
            ? accessDrawTile('exit', placed.exit.x, placed.exit.y, placed.exit.frame)
            : { x: placed.x + (placed.width >> 1), y: placed.y + placed.height }
        )
        // 乗車終了。全員を出口の前に出し、乗車額を払って徘徊に戻す。
        // 撤去で降ろすときは支払いなし
        const releaseRiders = (placed: PlacedAttraction, charge: boolean) => {
          const state = rideStates.get(placed)
          if (!state) return
          stopRideAnimation(placed)
          const spot = rideExitSpot(placed)
          const facing = placed.exit?.frame ?? 0
          state.aboard.forEach((guest) => {
            if (charge) {
              const payment = placed.price * guestConfig.types[guest.type].people
              guest.money -= payment
              shopSaleHandler.current(payment)
              placed.usedThisMonth += guestConfig.types[guest.type].people
              guest.ridden.add(placed.id)
              // 評価は列で待った長さも見るので、待機値を戻す前に出す
              evaluateRide(guest, placed)
              guest.fatigue = Math.max(0, guest.fatigue - attractionUseConfig.rideFatigueRelief)
              // 乗るたびに酔いがたまる。原作はアトラクションごとの酔いやすさを掛けるが、
              // その表がまだ取れていないので速度設定だけで増やしている
              guest.nausea = Math.min(litterConfig.nauseaMax, guest.nausea + placed.speedSetting)
              // 煙が出たまま乗せると気分が大きく下がる
              if (placed.needsRepair) changeMood(guest, breakdownConfig.brokenRating)
              // 乗り終えると待ちくたびれ具合が種類ごとの初期値に戻る
              guest.queueWait = guestConfig.types[guest.type].queueWaitBase
              if (guest.money <= 0) guest.leaveAtDay = elapsedDays
            }
            guest.targetAttraction = null
            guest.phase = 'walking'
            guest.image.setVisible(true)
            guest.fromX = spot.x
            guest.fromY = spot.y
            guest.toX = spot.x
            guest.toY = spot.y
            guest.previousX = spot.x
            guest.previousY = spot.y
            guest.progress = 1
            guest.facing = facing
          })
          rideStates.delete(placed)
          drawRiders(placed)
          // 1 回運転するたびに耐久度が減る。休止中は運転しないので減らない
          if (charge) wearAttraction(placed)
        }
        // 列の先頭で乗り込む。入口のマスへは踏み込まず、その手前で姿を消す
        const boardRide = (guest: Guest, placed: PlacedAttraction) => {
          occupiedQueueTiles.delete(tileKey(guest.fromX, guest.fromY))
          const state = rideStateOf(placed)
          // 最初の 1 組が乗った時点から受け入れ時間を数え始める
          if (state.aboard.length === 0) state.timer = attractionUseConfig.loadTimeoutDays
          state.aboard.push(guest)
          state.people += guestConfig.types[guest.type].people
          state.seats.push(...(riderCodesByBank[guest.bank.bank] ?? []))
          // 定員に達したら受け入れを締め切ってすぐ動き出す
          if (state.people >= placed.capacity) {
            state.phase = 'running'
            state.timer = rideDaysOf(placed)
            startRideAnimation(placed)
          }
          guest.phase = 'riding'
          guest.image.setVisible(false)
          drawRiders(placed)
        }
        // 整列歩道を入口へ向かって進む客を 1 フレーム分進める
        const updateQueueingGuest = (guest: Guest, step: number, days: number) => {
          const placed = guest.targetAttraction
          if (!placed || !placedAttractions.includes(placed)) {
            abandonQueue(guest)
            return
          }
          // 待機値は列にいる間ずっと増え、限界に達すると待ちくたびれて帰宅へ向かう。
          // 帰宅時刻が来ても列は離れず、乗り終えてから帰る
          guest.queueWait = Math.min(needsConfig.max, guest.queueWait + days * needsConfig.updatesPerDay)
          if (guest.queueWait >= needsConfig.max) {
            abandonQueue(guest, true)
            return
          }
          const entrance = placed.entrance
          if (guest.toX !== guest.fromX || guest.toY !== guest.fromY) {
            guest.walked += step
            guest.progress += step
            if (guest.progress < 1) return
            guest.progress = 0
            occupiedQueueTiles.delete(tileKey(guest.fromX, guest.fromY))
            guest.previousX = guest.fromX
            guest.previousY = guest.fromY
            guest.fromX = guest.toX
            guest.fromY = guest.toY
          }
          const distances = queueDistanceMap(placed)
          const distance = distances.get(tileKey(guest.fromX, guest.fromY))
          // 列や入口・出口がなくなっていたら離脱する
          if (distance === undefined || !entrance || !placed.exit) {
            abandonQueue(guest)
            return
          }
          if (distance === 0) {
            // 入口の前。受け入れ中で定員に空きがあればここで乗り込む。
            // 稼働中は入口が閉まっているので次の受け入れまで待つ
            const state = rideStates.get(placed)
            const boardable = !placed.suspended && !placed.underInspection
              && (!state || state.phase === 'loading')
              && (state?.people ?? 0) + guestConfig.types[guest.type].people <= placed.capacity
            if (boardable) {
              guest.facing = directionOf(entrance.x - guest.fromX, entrance.y - guest.fromY)
              boardRide(guest, placed)
              return
            }
          }
          else {
            for (const { x: ox, y: oy } of guestNeighbours) {
              const x = guest.fromX + ox
              const y = guest.fromY + oy
              const key = tileKey(x, y)
              if (distances.get(key) !== distance - 1 || occupiedQueueTiles.has(key)) continue
              occupiedQueueTiles.add(key)
              guest.toX = x
              guest.toY = y
              guest.facing = directionOf(ox, oy)
              return
            }
          }
          // 前が詰まっているので動かない。立ち止まっている間は列の道順のほうを向く
          guest.facing = queueFacingAt(placed, guest.fromX, guest.fromY) ?? guest.facing
          standStill(guest)
        }
        // ---- 設備の利用 ----
        // 立ち止まったマスが設備の正面なら条件を確認して利用マスへ 1 マス進む。
        // トイレは欲求 100 以上、ベンチは乱数(1〜100)が疲労 ÷ 5 未満のときに座る。
        // ゴミバコは独自仕様で、ゴミを持っていれば利用して全部移す(上限まで)
        const facilityUseConfig = game.facilityUse
        const tryUseFacility = (guest: Guest, spot: FacilitySpot): boolean => {
          const placed = placedFacilities.get(spot.key)
          if (!placed) return false
          // 向き選択中(未確定)の設備は使わせない。確定前に回転すると座り位置がずれるため
          if (pendingFacility && spot.key === tileKey(pendingFacility.x, pendingFacility.y)) return false
          const tile = tileKey(spot.tile.x, spot.tile.y)
          if (occupiedSpotTiles.has(tile)) return false
          if (!sameHeight(guest.fromX, guest.fromY, spot.tile.x, spot.tile.y)) return false
          if (spot.kind === 'trash') {
            // ゴミを持っていれば国によらず寄る。満杯のゴミバコは素通りする
            if (trashTotal(guest.trash) <= 0) return false
            if (placed.trash >= facilityTrashCapacityOf(placed.facility)) return false
          }
          else if (spot.kind === 'toilet') {
            // トイレへ寄るのはトイレ欲求だけが理由で、ゴミのためには寄らない
            if (guest.toiletUrge < needsConfig.toiletSeekThreshold) return false
            if (placed.used >= facilityCapacityOf(placed.facility)) return false
          }
          else if (Math.floor(Math.random() * 100) + 1 >= guest.fatigue / 5) return false
          occupiedSpotTiles.add(tile)
          // ショップへ向かう途中でも立ち寄れる。経路は保持し、利用後に続きを歩く
          guest.facility = { spot, placed, stage: 'enter', front: { x: guest.fromX, y: guest.fromY }, timer: 0 }
          guest.phase = 'facility'
          guest.progress = 0
          guest.toX = spot.tile.x
          guest.toY = spot.tile.y
          guest.facing = directionOf(spot.tile.x - guest.fromX, spot.tile.y - guest.fromY)
          return true
        }
        // 持っているゴミを設備へ移す。設備側は種類を持たず個数だけ数える。
        // 空きが足りなければ入るぶんだけ移し、残りは来園者が持ったままになる(独自仕様)
        const depositTrash = (guest: Guest, placed: PlacedFacility) => {
          let room = facilityTrashCapacityOf(placed.facility) - placed.trash
          for (let kind = 0; kind < guest.trash.length && room > 0; kind += 1) {
            const moved = Math.min(room, guest.trash[kind])
            guest.trash[kind] -= moved
            placed.trash += moved
            room -= moved
          }
        }
        const releaseFacilityGuest = (guest: Guest) => {
          const info = guest.facility
          if (!info) return
          occupiedSpotTiles.delete(tileKey(info.spot.tile.x, info.spot.tile.y))
          guest.facility = null
          guest.phase = 'walking'
          guest.image.setVisible(true)
          // 次の更新で待ち時間なく歩き出す
          guest.progress = 1
        }
        const updateFacilityGuest = (guest: Guest, step: number, days: number) => {
          const info = guest.facility
          if (!info) {
            guest.phase = 'walking'
            return
          }
          if (info.stage === 'enter') {
            guest.walked += step
            guest.progress += step
            if (guest.progress < 1) return
            guest.progress = 0
            guest.previousX = guest.fromX
            guest.previousY = guest.fromY
            guest.fromX = guest.toX
            guest.fromY = guest.toY
            info.stage = 'stay'
            if (info.spot.kind === 'toilet') {
              // トイレは中に入るので姿を消す
              guest.image.setVisible(false)
              info.timer = facilityUseConfig.serviceDays
            }
            else if (info.spot.kind === 'bench') {
              // 座るときに外側を向き、疲労が回復する。立つのは翌日の日付更新のとき。
              // ベンチで休むとショップへの用事は取りやめる
              guest.facing = directionOf(info.front.x - guest.fromX, info.front.y - guest.fromY)
              guest.fatigue = Math.max(0, guest.fatigue - needsConfig.benchFatigueRelief)
              guest.targetShop = null
              guest.path = null
              guest.pathIndex = 0
              info.timer = Math.floor(elapsedDays) + 1 - elapsedDays
            }
            else info.timer = facilityUseConfig.serviceDays
            return
          }
          if (info.stage === 'stay') {
            info.timer -= days
            if (info.timer > 0) return
            if (info.spot.kind === 'trash') depositTrash(guest, info.placed)
            else if (info.spot.kind === 'toilet') {
              // トイレは 1 回の利用で内容量が増える。ゴミはそれとは別枠で受け入れる
              info.placed.used = Math.min(
                facilityCapacityOf(info.placed.facility),
                info.placed.used + facilityUseConfig.usePerVisit,
              )
              depositTrash(guest, info.placed)
              guest.toiletUrge = 0
              guest.fatigue = Math.max(0, guest.fatigue - needsConfig.toiletFatigueRelief)
              guest.image.setVisible(true)
            }
            info.stage = 'exit'
            guest.progress = 0
            guest.toX = info.front.x
            guest.toY = info.front.y
            guest.facing = directionOf(info.front.x - guest.fromX, info.front.y - guest.fromY)
            return
          }
          guest.walked += step
          guest.progress += step
          if (guest.progress < 1) return
          guest.progress = 0
          guest.previousX = guest.fromX
          guest.previousY = guest.fromY
          guest.fromX = guest.toX
          guest.fromY = guest.toY
          releaseFacilityGuest(guest)
        }

        const enterShop = (guest: Guest) => {
          guest.phase = 'shopping'
          guest.serviceRemaining = shopUseConfig.serviceDays
          guest.path = null
          guest.pathIndex = 0
          if (!guest.targetShop) return
          guest.facing = facingByShopDirection[guest.targetShop.direction]
          // 店舗型は中へ入るので姿を消す。屋台型は店先に立ったまま利用する
          if (guest.targetShop.shop.serviceStyle === 'building') guest.image.setVisible(false)
        }
        // 利用を終えて支払い、商品の効果ぶん欲求を動かして満腹にし、店から出る
        const finishShopping = (guest: Guest) => {
          const placed = guest.targetShop
          guest.targetShop = null
          guest.phase = 'walking'
          guest.image.setVisible(true)
          if (!placed) return
          const people = guestConfig.types[guest.type].people
          const payment = placed.price * people
          guest.money -= payment
          shopSaleHandler.current(payment)
          placed.usedThisMonth += people
          // ゲームショップは勝率のぶんだけ賞品を渡し、その額が支出になる
          if (placed.prizePrice > 0) {
            let prizes = 0
            for (let index = 0; index < people; index += 1) {
              if (Math.random() * 100 < placed.winRate) prizes += 1
            }
            if (prizes > 0) shopSaleHandler.current(-placed.prizePrice * prizes)
          }
          // 満たす側の内部値は、いったん探し始めるしきい値まで戻してから店ごとの値を足す。
          // こうすると、我慢して 0 まで落ちていた客でも必ずしきい値より上まで戻るので、
          // 食べた直後にまた食べたくなることがない。我慢したぶんは気分の減点として残っている
          const category = placed.shop.category
          if (category === 'food' || category === 'drink') {
            const field = needFieldOf[category]
            guest[field] = Math.max(guest[field], needsConfig.seekThreshold)
          }
          guest.satiety = clamp(guest.satiety + shopEffectAt(placed.shop, placed.tasteLevel, 'satiety'), 0, needsConfig.max)
          guest.hydration = clamp(guest.hydration + shopEffectAt(placed.shop, placed.tasteLevel, 'hydration'), 0, needsConfig.max)
          // 飲食するとトイレ欲求が発生する
          guest.toiletUrge = Math.min(needsConfig.max, guest.toiletUrge + 1)
          // 屋台型の商品はゴミが出る(独自仕様)。種類は飲み物と食べ物で絵が違う
          if (placed.shop.serviceStyle === 'stall') {
            guest.trash[placed.shop.category === 'drink' ? 0 : 1] += 1
          }
          evaluateShopUse(guest, placed)
          // 所持金がなくなった来園者は帰宅する
          if (guest.money <= 0) guest.leaveAtDay = elapsedDays
          // 店とは反対を向き、入口マスへ 1 マス出てから徘徊に戻る。
          // progress を 1 にしておくと次の更新で待ち時間なく歩き出す
          const entrance = shopEntranceTile(placed.shop, placed.x, placed.y, placed.direction)
          guest.path = [entrance]
          guest.pathIndex = 0
          guest.facing = placed.direction
          guest.progress = 1
        }

        const spawnGuest = () => {
          if (guests.length >= game.park.visitorLimit) return false
          const type = Math.floor(Math.random() * guestConfig.types.length)
          const banks = guestConfig.types[type].banks.filter((id) => guestBankById.has(id))
          if (banks.length === 0) return false
          const bank = guestBankById.get(banks[Math.floor(Math.random() * banks.length)])!
          const money = (guestConfig.money.base + Math.floor(Math.random() * (guestConfig.money.randomRange + 1)))
            * guestConfig.types[type].people
          const guest: Guest = {
            type,
            bank,
            tilesPerDay: guestConfig.types[type].tilesPerDay,
            // バスのマスに現れ、看板を経由してゲート下まで歩いてから徘徊を始める
            phase: 'fromBus',
            money,
            satiety: needsConfig.max,
            hydration: needsConfig.max,
            fatigue: 0,
            mood: 0,
            stayValue: 0,
            // 来園直後は「まあまあ」を持たせておく(残りフレーム 0 なので絵は出ない)
            reaction: 0x1c,
            reactionFrames: 0,
            reactionImage: this.add.image(0, 0, `reaction-${0x1c}`).setOrigin(0).setVisible(false),
            trash: Array<number>(trashKindCount).fill(0),
            nausea: 0,
            litterPatience: litterConfig.patience,
            toiletUrge: 0,
            facility: null,
            needTick: 0,
            seekCooldown: 0,
            targetShop: null,
            path: null,
            pathIndex: 0,
            targetAttraction: null,
            queueWait: guestConfig.types[type].queueWaitBase,
            ridden: new Set(),
            serviceRemaining: 0,
            fromX: gateCrossing.x,
            fromY: gateCrossing.y,
            toX: gateCrossing.x,
            toY: gateCrossing.y,
            // 1 にしておくと次の更新で即座に進む先を選ぶ
            progress: 1,
            previousX: gateCrossing.x,
            previousY: gateCrossing.y,
            queueX: busStop.x,
            queueY: busStop.y + 1,
            queueSide: 1,
            rideX: busStop.x,
            // 看板のほうを向いて降りる
            facing: 1,
            walked: 0,
            paid: false,
            leaveAtDay: elapsedDays + guestConfig.stayDays,
            outlaw: false,
            waitingForRide: false,
            arrested: false,
            shockedUntil: 0,
            lost: false,
            lostParent: null,
            image: this.add.sprite(0, 0, `guest-${bank.bank}`).setOrigin(0, 0),
          }
          guests.push(guest)
          placeGuestImage(guest)
          return true
        }
        // バイクから降りたアウトロー。歩き方は来園者と同じ仕組みを使い、
        // 買い物・乗車・入場料・欲求はすべて持たない
        const spawnOutlaw = () => {
          const bank = guestBankById.get(outlawConfig.bank)
          if (!bank) return
          const guest: Guest = {
            type: outlawTypeIndex,
            bank,
            tilesPerDay: guestConfig.types[outlawTypeIndex].tilesPerDay,
            // バイクのマスに現れ、来園者と同じ道すじでゲート下まで歩く
            phase: 'fromBus',
            money: 0,
            satiety: needsConfig.max,
            hydration: needsConfig.max,
            fatigue: 0,
            mood: 0,
            stayValue: 0,
            reaction: 0x1c,
            reactionFrames: 0,
            reactionImage: this.add.image(0, 0, `reaction-${0x1c}`).setOrigin(0).setVisible(false),
            trash: Array<number>(trashKindCount).fill(0),
            nausea: 0,
            litterPatience: litterConfig.patience,
            toiletUrge: 0,
            facility: null,
            needTick: 0,
            seekCooldown: 0,
            targetShop: null,
            path: null,
            pathIndex: 0,
            targetAttraction: null,
            queueWait: 0,
            ridden: new Set(),
            serviceRemaining: 0,
            fromX: gateCrossing.x,
            fromY: gateCrossing.y,
            toX: gateCrossing.x,
            toY: gateCrossing.y,
            progress: 1,
            previousX: gateCrossing.x,
            previousY: gateCrossing.y,
            queueX: busStop.x,
            queueY: busStop.y + 1,
            queueSide: 1,
            rideX: busStop.x,
            facing: 1,
            walked: 0,
            // 入場料は払わない
            paid: true,
            leaveAtDay: elapsedDays + outlawConfig.stayDays,
            outlaw: true,
            waitingForRide: false,
            arrested: false,
            shockedUntil: 0,
            lost: false,
            lostParent: null,
            image: this.add.sprite(0, 0, `guest-${bank.bank}`).setOrigin(0, 0),
          }
          guests.push(guest)
          placeGuestImage(guest)
          buildMessageHandler.current('アウトローがやってきました。')
        }
        // 親とはぐれた子。親と同じ姿で親のいたマスに現れ、買い物も乗車もせずに歩き回る。
        // 親と同じマスで出会うか、ガードマンに親のところまで運ばれると再会する
        const spawnLostChild = (parent: Guest) => {
          const child: Guest = {
            ...parent,
            money: 0,
            paid: true,
            satiety: needsConfig.max,
            hydration: needsConfig.max,
            fatigue: 0,
            nausea: 0,
            toiletUrge: 0,
            trash: Array<number>(trashKindCount).fill(0),
            facility: null,
            targetShop: null,
            targetAttraction: null,
            ridden: new Set(),
            path: null,
            pathIndex: 0,
            serviceRemaining: 0,
            phase: 'walking',
            progress: 1,
            reactionFrames: 0,
            reactionImage: this.add.image(0, 0, `reaction-${0x1c}`).setOrigin(0).setVisible(false),
            lost: false,
            lostParent: parent,
            image: this.add.sprite(0, 0, `guest-${parent.bank.bank}`).setOrigin(0, 0),
          }
          guests.push(child)
          placeGuestImage(child)
          return child
        }
        // 親と子が同じマスにいれば再会する。原作は親の疲労・空腹・渇き・気分を
        // 子と平均してから迷子の状態を解く
        const reuniteLostChild = (child: Guest) => {
          const parent = child.lostParent
          if (!parent) return
          const mix = (a: number, b: number) => Math.round((a + b) / 2)
          parent.fatigue = mix(parent.fatigue, child.fatigue)
          parent.satiety = mix(parent.satiety, child.satiety)
          parent.hydration = mix(parent.hydration, child.hydration)
          parent.mood = mix(parent.mood, child.mood)
          parent.lost = false
          const index = guests.indexOf(child)
          if (index >= 0) removeGuest(index)
        }
        const removeGuest = (index: number) => {
          const guest = guests[index]
          // 子が消えるときは親の迷子を解く。親が帰るときは子もゲートへ向かわせる
          if (guest.lostParent) guest.lostParent.lost = false
          guests.forEach((other) => {
            if (other.lostParent !== guest) return
            other.lostParent = null
            other.leaveAtDay = elapsedDays
          })
          leaveQueue(guest)
          guest.image.destroy()
          guest.reactionImage.destroy()
          guests.splice(index, 1)
        }

        // ---- スタッフ ----
        // 雇用メニューで職種を選ぶと配置モードになり、置いた場所から働き始める。
        // 歩道の外に置かれた場合は、いちばん近い歩道まで歩いてから仕事を探す
        const staffSettings = game.staff
        const staffTypeById = new Map<string, StaffType>(staffConfig.map((entry) => [entry.id, entry]))
        type Staff = {
          type: StaffType
          bank: GuestBank
          x: number
          y: number
          fromX: number
          fromY: number
          toX: number
          toY: number
          previousX: number
          previousY: number
          progress: number
          facing: number
          walked: number
          // 個体名(原作の 60 姓から雇用時に重複しないよう選ぶ。構造体 +0xb8 の番号にあたる)
          name: string
          efficiency: number
          striking: boolean
          // 性能ＵＰ(施設・ショップと同じ定額の仕組み)で上がるバージョン。
          // ガードマンの勝率と楽しませる効果に効く
          version: number
          // 月給。既定は職種ごとの月給で、設定メニューから変えられる
          wage: number
          // 雇用した日(経過日数)。30 年勤務すると定年退職する
          hireDay: number
          // 配置したマス。仕事が終わったらここへ戻る
          homeX: number
          homeY: number
          path: Array<{ x: number, y: number }> | null
          pathIndex: number
          // 目的地がゴミバコ・トイレなら、正面に着いたあとに中へ入ってから戻ってくる
          useSpot: FacilitySpot | null
          useStage: 'enter' | 'clean' | 'exit' | null
          useTimer: number
          useFront: { x: number, y: number } | null
          // メカニックが修理に向かっているアトラクション
          repairTarget: PlacedAttraction | null
          // ガードマンが保護に向かっている迷子と、連れ歩いている迷子
          rescueTarget: Guest | null
          escorting: Guest | null
          // 退治してバス待ち看板まで連れて行く途中のアウトロー。うしろを付いて歩く
          arresting: Guest | null
          // 仕事の残り時間(修理・戦闘に負けたあとの休み)
          jobTimer: number
          // 楽しませる効果の更新の端数持ち越し(欲求と同じ 1 日 15 回の刻み)
          entertainTick: number
          // スイーパーの清掃ルート(最大 72 マス)。設定してある間はこの順に巡回する
          route: Array<{ x: number, y: number }> | null
          routeIndex: number
          // ステータス枠の「ウケた数」。仕事をこなした回数を数える
          pleased: number
          // このスタッフに払った月給の累計(経営の「スタッフ経費」の内訳になる)
          paid: number
          // 立ち止まっているか(歩行でなく動作のアニメを出す)と、そのコマ送りの進み
          idle: boolean
          idleTick: number
          // ガードマンがアウトローに負けて倒れている間
          downed: boolean
          // メカニックの修理の順路の何歩目か
          repairStep: number
          // 柵を 1 つ建てる・回収するあいだ、その場で作業の動きを見せている残り時間
          workTimer: number
          // 怒りやすさ 1〜5。雇用時に決まり、毎月これに応じて能率が下がる
          anger: number
          // 楽しませる職種。持ち場に落ち着いているか、いま芸をしているか、
          // 芸の残り時間と、誰も来ないまま待っている時間
          settled: boolean
          performing: boolean
          performTick: number
          waitTick: number
          image: Phaser.GameObjects.Sprite
        }
        const staff: Staff[] = []
        const addMechanicPost = (x: number, y: number) => {
          const key = tileKey(x, y)
          if (mechanicPosts.has(key)) return
          const offset = terrain.tileObjectOffsets['mechanic-post']
          const tile = point(x, y)
          mechanicPosts.set(key, this.add.image(tile.x + offset.x, tile.y + offset.y, 'mechanic-post')
            .setOrigin(0).setDepth(roadPieceDepth(x, y)))
        }
        const removeMechanicPost = (x: number, y: number) => {
          const key = tileKey(x, y)
          mechanicPosts.get(key)?.destroy()
          mechanicPosts.delete(key)
        }
        // スタッフは歩道と階段の上だけを歩く。ショップ前の道も通り道として使う
        const staffWalkable: Walkable = (x, y) => {
          const key = tileKey(x, y)
          return roads.has(key) || stairsTiles.has(key)
        }
        // 2 点を結ぶマスの並び。上下左右にしか進まないので、
        // 縦横の差が大きいほうから 1 マスずつ詰めていく。歩道の外を歩くときだけ使う
        const straightTilesTo = (from: { x: number, y: number }, to: { x: number, y: number }) => {
          const tiles: Array<{ x: number, y: number }> = []
          let { x, y } = from
          while (x !== to.x || y !== to.y) {
            if (Math.abs(to.x - x) >= Math.abs(to.y - y)) x += Math.sign(to.x - x)
            else y += Math.sign(to.y - y)
            tiles.push({ x, y })
          }
          return tiles
        }
        // 歩道でないマスから、いちばん近い歩道を探す。
        // 原作は置く場所を選ばないので、歩道の外に置かれたスタッフはここへ歩いて働き始める
        const nearestWalkableTile = (x: number, y: number) => {
          if (staffWalkable(x, y)) return { x, y }
          const seen = new Set([tileKey(x, y)])
          const frontier = [{ x, y }]
          for (let head = 0; head < frontier.length && head < 4096; head += 1) {
            const current = frontier[head]
            for (const { x: ox, y: oy } of guestNeighbours) {
              const nx = current.x + ox
              const ny = current.y + oy
              const key = tileKey(nx, ny)
              if (seen.has(key)) continue
              seen.add(key)
              if (staffWalkable(nx, ny)) return { x: nx, y: ny }
              frontier.push({ x: nx, y: ny })
            }
          }
          return null
        }
        const staffTilesPerDay = staffSettings.tilesPerDay
        // 動作速度。原作は `(能力 + 1) ×(能率 + 1) ÷ 101` を 0〜9 に丸める
        // (構造体 +0xb2 能力=バージョン、+0xb3 能率。`FUN_801e9420`)。能力は雇用時 0
        const staffAnimSpeed = (worker: Staff) => Math.min(
          9, Math.floor((worker.version + 1) * (worker.efficiency + 1) / 101),
        )
        // 歩く速さの倍率。原作は速度テーブル `0x801d0e62` を「動作速度 × 0x19 + 1」から作った
        // 段(0〜4)で引く。段は動作速度 0〜2→0 / 3〜4→1 / 5〜6→2 / 7〜8→3 / 9→4、
        // 段ごとの速さは基準(段 0)比で 1 / 1.2 / 1.5 / 2 / 3。能力 0 のスタッフは動作速度が
        // 0〜1 にしかならず必ず段 0(= 基準速度 staffTilesPerDay)になる
        const staffSpeedTierByAnim = [0, 0, 0, 1, 1, 2, 2, 3, 3, 4]
        const staffSpeedFactorByTier = [1, 1.2, 1.5, 2, 3]
        const staffSpeedFactor = (worker: Staff) => (
          staffSpeedFactorByTier[staffSpeedTierByAnim[staffAnimSpeed(worker)]]
        )
        // 怒りやすさ。雇用時に 1〜5 を重み付きで抽選する
        // (原作は `func_0x800c5128(5, DAT_801facc0) + 1`、重みは 10 / 20 / 40 / 20 / 10)
        const rollAnger = () => {
          const weights: number[] = staffSettings.efficiency.angerWeights
          const total = weights.reduce((sum, value) => sum + value, 0)
          let roll = Math.random() * total
          for (let index = 0; index < weights.length; index += 1) {
            roll -= weights[index]
            if (roll < 0) return index + 1
          }
          return weights.length
        }
        // 個体名は原作の 60 姓から選ぶ。原作は雇用時に他のスタッフと重複しない番号を
        // 無作為に選ぶ(`FUN_801e41bc`)ので、空いている名前から選び、全部埋まっていれば
        // 重複を許して選ぶ
        const staffNames: string[] = staffSettings.names
        const pickStaffName = () => {
          const used = new Set(staff.map((worker) => worker.name))
          const free = staffNames.filter((candidate) => !used.has(candidate))
          const pool = free.length > 0 ? free : staffNames
          return pool[Math.floor(Math.random() * pool.length)]
        }
        const spawnStaff = (
          id: string,
          at: { x: number, y: number },
          efficiency?: number,
          version?: number,
          wage?: number,
          hireDay?: number,
          route?: Array<{ x: number, y: number }>,
          paid?: number,
          anger?: number,
          name?: string,
          // 拠点。省略すると置いた場所がそのまま拠点になる(雇ったときはこれ)。
          // セーブから戻すときは、出動先で保存されていても拠点は動かさない
          home?: { x: number, y: number },
        ) => {
          const typeConfig = staffTypeById.get(id)
          if (!typeConfig) return null
          const bank = guestBankById.get(typeConfig.bank)
          if (!bank) return null
          const start = at
          const base = home ?? at
          const entry: Staff = {
            type: typeConfig,
            bank,
            x: start.x,
            y: start.y,
            fromX: start.x,
            fromY: start.y,
            toX: start.x,
            toY: start.y,
            previousX: start.x,
            previousY: start.y,
            progress: 1,
            facing: 0,
            walked: 0,
            name: name ?? pickStaffName(),
            efficiency: efficiency ?? staffSettings.efficiency.start,
            striking: false,
            // 施設・ショップと同じくバージョン 0 から始まり、性能ＵＰで上げる
            version: version ?? 0,
            wage: wage ?? typeConfig.monthlyWage,
            hireDay: hireDay ?? elapsedDays,
            homeX: base.x,
            homeY: base.y,
            path: null,
            pathIndex: 0,
            useSpot: null,
            useStage: null,
            useTimer: 0,
            useFront: null,
            repairTarget: null,
            rescueTarget: null,
            escorting: null,
            arresting: null,
            jobTimer: 0,
            entertainTick: 0,
            route: route && route.length > 0 ? route : null,
            routeIndex: 0,
            pleased: 0,
            paid: paid ?? 0,
            idle: true,
            idleTick: 0,
            downed: false,
            repairStep: 0,
            workTimer: 0,
            anger: anger ?? rollAnger(),
            // 原作は雇った時点で待ちの段(その場が持ち場)から始まる
            settled: true,
            performing: false,
            performTick: 0,
            waitTick: 0,
            image: this.add.sprite(0, 0, `guest-${bank.bank}`).setOrigin(0, 0),
          }
          staff.push(entry)
          if (typeConfig.id === 'mechanic') addMechanicPost(base.x, base.y)
          placeStaffImage(entry)
          return entry
        }
        const removeStaff = (index: number) => {
          staff[index].image.destroy()
          staff.splice(index, 1)
        }
        // カーソルが乗っているマスに立っているスタッフ(いなければ null)
        const staffAtTile = (x: number, y: number) => (
          staff.find((worker) => worker.fromX === x && worker.fromY === y) ?? null
        )
        // 解雇する。迷子を連れている途中なら、その場で解放してから消す。
        // 点検の途中なら、そのアトラクションの運転を戻す
        const dismissStaff = (worker: Staff) => {
          if (worker.type.id === 'mechanic') removeMechanicPost(worker.homeX, worker.homeY)
          if (worker.repairTarget) {
            worker.repairTarget.underInspection = false
            clearRepairFence(worker.repairTarget)
          }
          worker.image.setVisible(true)
          if (worker.escorting) worker.escorting.image.setVisible(true)
          const index = staff.indexOf(worker)
          if (index >= 0) removeStaff(index)
        }
        // 出動・修理・保護・清掃の途中かどうか。仕事中は位置変更できない(原作仕様)
        const staffIsBusy = (worker: Staff) => (
          worker.repairTarget !== null || worker.rescueTarget !== null || worker.escorting !== null
          || worker.arresting !== null || worker.useStage !== null
        )
        // 項目の並び・アイコン・説明は原作のスタッフ設定メニュー表による。
        // 一覧アイコン `0x80117fa0`(6 byte × 2 行、先頭バイトが件数)、
        // ヘルプ ID `0x80117fb8`(u16 × 6 × 2 行)= メッセージ 302〜306、
        // 項目 ID `0x80118120`(u8 × 5 × 2 行)。
        // 2 行目はスイーパー以外で、清掃ルートだけが抜ける
        const staffSettingItems = (worker: Staff): FacilitySettingItem[] => {
          const items: FacilitySettingItem[] = [
            priceItem('wage', '月給', 53, '月給を設定できます。低いとスタッフがおこってしまいます。', worker.wage),
            {
              id: 'reposition',
              label: 'ピンセット',
              icon: 47,
              kind: 'confirm',
              description: worker.striking
                ? 'ストライキ中はピンセットアイコンを使用できません。'
                : staffIsBusy(worker)
                  ? '仕事中はピンセットアイコンを使用できません。'
                  : 'スタッフの位置を移動させられます。',
              enabled: !worker.striking && !staffIsBusy(worker),
            },
            versionItem(worker.version, '能力', '能力'),
          ]
          if (worker.type.id === 'sweeper') {
            items.push({
              id: 'route',
              label: '清掃ルート',
              icon: 48,
              kind: 'confirm',
              text: worker.route ? `${worker.route.length} マス` : '未設定',
              description: worker.striking
                ? 'ストライキ中は清掃ルートアイコンを使用できません。'
                : staffIsBusy(worker)
                  ? '仕事中は清掃ルートアイコンを使用できません。'
                  : 'スイーパーの清掃ルートを設定できます。',
              enabled: !worker.striking && !staffIsBusy(worker),
            })
          }
          items.push({
            id: 'dismiss',
            label: '解雇',
            icon: 49,
            kind: 'confirm',
            description: worker.striking
              ? 'ストライキ中は解雇できません。'
              : 'スタッフをやめさせられます。',
            enabled: !worker.striking,
          })
          return items
        }
        // 並びとアイコンは原作のステータス枠表(種別 6)による。
        // 索引表 `0x801183e4` + 6 × 0x1a、項目は `0x80118254` の (x, y, アイコン, メッセージ ID)
        const staffStatus = (worker: Staff): FacilityStatusItem[] => [
          { icon: 43, label: '月給', value: worker.wage.toLocaleString() },
          { icon: 62, label: '雇用年数', value: `${Math.floor((elapsedDays - worker.hireDay) / 365)}` },
          { icon: 63, label: '能率', value: `${worker.efficiency}` },
          { icon: 4, label: '職種', value: worker.type.label },
          { icon: 64, label: 'ウケた数', value: `${worker.pleased}` },
        ]
        // 雇用の上限。全体 64 人、ガードマン 5 人、楽しませる 3 職種は合計 5 人
        // 上限は原作の雇用処理そのまま。メカニック 20、スイーパー 20、ガードマン 5、
        // 楽しませる 3 職種は合計 5。全体はスタッフ配列の 50 人
        const staffCaps: Record<string, number> = staffSettings.caps
        const capLabel: Record<string, string> = {
          mechanic: 'メカニック',
          sweeper: 'スイーパー',
          guard: 'ガードマン',
          entertainer: 'お客さんを楽しませるスタッフ',
        }
        const staffCapacityMessage = (type: StaffType) => {
          if (staff.length >= staffSettings.maxTotal) return 'スタッフはこれ以上雇えません。'
          const limit = staffCaps[type.cap]
          const hired = staff.filter((worker) => worker.type.cap === type.cap).length
          if (limit !== undefined && hired >= limit) return `${capLabel[type.cap]}はこれ以上雇えません。`
          return null
        }
        // メカニックは道路の上ではなく、何もない地面に拠点を構える
        const isEmptyGroundTile = (x: number, y: number) => {
          const key = tileKey(x, y)
          return !roads.has(key) && !stairsTiles.has(key) && !queueRoads.has(key)
            && !placedFacilities.has(key) && !mechanicPosts.has(key)
            && !attractionCoveringTile(x, y) && !shopCoveringTile(x, y)
        }
        // カーソルの位置にスタッフを配置できるか。メカニックだけ何もない地面が必要で、
        // それ以外は原作と同じく置く場所を選ばない(歩道の外なら最寄りの歩道まで歩いて働く)
        // 置ける場所は原作の判定(`FUN_801e46f8`)そのまま。歩道か何もない地面で、
        // メカニックだけは何もない地面に限る
        const canPlaceStaffType = (type: StaffType, x: number, y: number) => (
          type.id === 'mechanic'
            ? isEmptyGroundTile(x, y)
            : staffWalkable(x, y) || isEmptyGroundTile(x, y)
        )
        // カーソルの位置にスタッフを配置して雇用費を払う
        const placeStaff = () => {
          const type = activeStaffType
          if (!type) return
          const capacity = staffCapacityMessage(type)
          if (capacity) {
            buildMessageHandler.current(capacity)
            return
          }
          if (currentCash < type.hireCost) {
            buildMessageHandler.current('資金が足りないので雇えません。')
            return
          }
          if (!canPlaceStaffType(type, cursorPosition.x, cursorPosition.y)) {
            buildMessageHandler.current(
              type.id === 'mechanic'
                ? '何もない地面にしか拠点を構えられません。'
                : 'その場所には配置できません。',
            )
            return
          }
          currentCash -= type.hireCost
          staffHiredHandler.current(type.hireCost)
          parkValue += type.hireCost
          // 置いた場所にそのまま現れる。メカニック以外は、そこからいちばん近い歩道まで歩いていく
          const hired = spawnStaff(type.id, { x: cursorPosition.x, y: cursorPosition.y })
          // ストライキ中に雇うと、その新人も能率 0 でストライキに加わる
          if (hired && staff.some((worker) => worker !== hired && worker.striking)) {
            hired.efficiency = 0
            hired.striking = true
          }
          buildMessageHandler.current(`${type.label}を雇いました。`)
          drawCursor()
        }
        // 歩いていないときのアニメ。バンクは歩行 4 方向のほかに動作のグループを持っており、
        // どれを使うかは staff.json の idleGroup で指す(メカニックの弁当、
        // ガードマンのきょろきょろなど)。指したグループが無いバンクは歩行の 1 コマ目で立つ
        const groupRangeOf = (worker: Staff, group: number | undefined) => (
          group === undefined ? null : worker.bank.groups?.find((entry) => entry.group === group) ?? null
        )
        // ガードマンはアウトローに負けている間だけ別のグループ(倒れている絵)になり、
        // メカニックは柵を建てている間だけ作業のグループになる
        const idleRangeOf = (worker: Staff) => groupRangeOf(worker, (
          worker.downed && 'downGroup' in worker.type ? worker.type.downGroup
            : worker.workTimer > 0 && 'workGroup' in worker.type ? worker.type.workGroup
              : worker.type.idleGroup
        ))
        const placeStaffImage = (worker: Staff) => {
          const fx = worker.fromX + (worker.toX - worker.fromX) * worker.progress
          const fy = worker.fromY + (worker.toY - worker.fromY) * worker.progress
          const fromLift = heightAt(worker.fromX, worker.fromY)
          const toLift = heightAt(worker.toX, worker.toY)
          const lift = fromLift + (toLift - fromLift) * worker.progress
          const base = flatPoint(fx + guestDisplay.tileOffset.x, fy + guestDisplay.tileOffset.y)
          const tileX = worker.progress < 0.5 ? worker.fromX : worker.toX
          const tileY = worker.progress < 0.5 ? worker.fromY : worker.toY
          const idle = worker.idle ? idleRangeOf(worker) : null
          // 柵の作業中は、その 1 回の持ち時間でちょうど 1 周ぶん見せる
          const workSpan = staffSettings.mechanic.fenceWorkFrames / game.time.originalFramesPerDay
          const frame = idle
            ? idle.frame + (worker.workTimer > 0
              ? Math.min(idle.count - 1, Math.floor((1 - worker.workTimer / workSpan) * idle.count))
              : Math.floor(worker.idleTick * staffSettings.idleFramesPerDay) % idle.count)
            : worker.facing * 4 + (Math.floor(worker.walked * 4) % 4)
          worker.image.setFrame(frame)
            .setPosition(base.x - worker.bank.anchorX, base.y - lift * terrain.heightStepPx - worker.bank.anchorY)
            .setDepth(renderDepthAt('facility', tileX, tileY))
          // ピンセットでつまんでいる間は、施設を置くときと同じ見せ方にする。
          // 半透明で、置けないマスでは赤くする
          if (worker === movingStaff) {
            const valid = canPlaceStaffType(worker.type, worker.fromX, worker.fromY)
            worker.image.setAlpha(valid ? 0.7 : 0.4).setTint(valid ? 0xffffff : 0xff6048)
          }
        }
        // つまむのをやめたときに見た目を戻す
        const clearCarriedLook = (worker: Staff) => {
          worker.image.setAlpha(1).clearTint()
        }
        // 目的地までの経路を経路探索で組む(BFS)。着けなければ null。
        // 出発地・目的地が歩道の外にあるときは、いちばん近い歩道までのまっすぐな道のりを
        // 前後に足す(配置したその場から歩き出す・拠点や施設の前まで戻るときに使う)
        const findStaffPath = (from: { x: number, y: number }, to: { x: number, y: number }) => {
          const entry = nearestWalkableTile(from.x, from.y)
          if (!entry) return null
          const lead = straightTilesTo(from, entry)
          const goalEntry = nearestWalkableTile(to.x, to.y)
          if (!goalEntry) return null
          const reach = buildReachMap(entry.x, entry.y, staffWalkable)
          const goal = tileKey(goalEntry.x, goalEntry.y)
          if (!reach.has(goal)) return null
          const path: Array<{ x: number, y: number }> = []
          let key: string | null = goal
          while (key) {
            path.unshift(parseKey(key))
            key = reach.get(key) ?? null
          }
          path.shift()
          const tail = straightTilesTo(goalEntry, to)
          return [...lead, ...path, ...tail]
        }
        // 経路に沿って 1 フレーム分進める。マスに着くたびに onArrive を呼び、
        // 経路を使い切ったら true を返す(呼び出し側はここで次の行動を選び直す)
        const advanceStaffPath = (
          worker: Staff,
          step: number,
          onArrive?: (x: number, y: number) => void,
        ): boolean => {
          if (!worker.path) return true
          worker.walked += step
          worker.progress += step
          while (worker.progress >= 1) {
            worker.progress -= 1
            worker.previousX = worker.fromX
            worker.previousY = worker.fromY
            worker.fromX = worker.toX
            worker.fromY = worker.toY
            onArrive?.(worker.fromX, worker.fromY)
            if (worker.pathIndex >= worker.path.length) {
              worker.progress = 0
              worker.path = null
              return true
            }
            const next = worker.path[worker.pathIndex]
            worker.pathIndex += 1
            worker.toX = next.x
            worker.toY = next.y
            worker.facing = directionOf(next.x - worker.fromX, next.y - worker.fromY)
          }
          return false
        }
        // 経路を渡して歩き出させる。前の行き先が残ったままだと 1 マス飛んでしまうので、
        // 最初の 1 マスをここで目標に据える。歩き出せたら true
        const startStaffPath = (worker: Staff, path: Array<{ x: number, y: number }> | null) => {
          worker.pathIndex = 0
          worker.progress = 0
          if (!path || path.length === 0) {
            worker.path = null
            worker.toX = worker.fromX
            worker.toY = worker.fromY
            return false
          }
          worker.path = path
          worker.pathIndex = 1
          worker.toX = path[0].x
          worker.toY = path[0].y
          worker.facing = directionOf(path[0].x - worker.fromX, path[0].y - worker.fromY)
          return true
        }
        // アトラクションの敷地が占めるマス
        const attractionFootprintTiles = (placed: PlacedAttraction) => {
          const tiles: Array<{ x: number, y: number }> = []
          for (let oy = 0; oy < placed.height; oy += 1) {
            for (let ox = 0; ox < placed.width; ox += 1) tiles.push({ x: placed.x + ox, y: placed.y + oy })
          }
          return tiles
        }
        // 敷地の縁に接するマスのうち、いちばん近いもの(直線距離)。
        // メカニックは池や崖を無視してまっすぐ歩くので、歩道の到達可否は問わない
        const nearestFootprintAdjacent = (from: { x: number, y: number }, footprint: Array<{ x: number, y: number }>) => {
          const footprintSet = new Set(footprint.map((tile) => tileKey(tile.x, tile.y)))
          let best: { x: number, y: number } | null = null
          let bestDist = Infinity
          for (const tile of footprint) {
            for (const { x: ox, y: oy } of guestNeighbours) {
              const nx = tile.x + ox
              const ny = tile.y + oy
              if (footprintSet.has(tileKey(nx, ny))) continue
              const dist = Math.hypot(nx - from.x, ny - from.y)
              if (dist < bestDist) { bestDist = dist; best = { x: nx, y: ny } }
            }
          }
          return best
        }
        // T 字路・十字路(道が 3 方向以上つながるマス)。ガードマンの見張り場所に使う
        const isJunctionTile = (x: number, y: number) => {
          const mask = roadMaskAt(x, y)
          const count = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)
          return roads.has(tileKey(x, y)) && count >= 3
        }
        // 歩いたマスの汚れは、通りがけに拾って歩く
        const cleanLitterAt = (x: number, y: number) => {
          const key = tileKey(x, y)
          if (!litterTiles.has(key)) return false
          clearLitter(x, y)
          return true
        }
        // ゴミバコ・トイレのマスの中身を空にする(スイーパーが中に入って作業したとき)
        const emptyFacilitySpot = (spot: FacilitySpot) => {
          const placed = placedFacilities.get(spot.key)
          if (!placed) return
          if (spot.kind === 'trash' || spot.kind === 'toilet') placed.trash = 0
          if (spot.kind === 'toilet') placed.used = 0
        }
        // 今立っているマスでできる仕事を片づける。中身の残ったゴミバコ・トイレの正面なら
        // 設備のマスへ 1 マス進む段に入り、true を返す。
        // 行き先選びより先にここを通さないと、足元の汚れを目的地に選んでその場から動けなくなる
        const workAtCurrentTile = (worker: Staff) => {
          if (cleanLitterAt(worker.fromX, worker.fromY)) worker.pleased += 1
          const spot = facilitySpots.get(tileKey(worker.fromX, worker.fromY))
          if (!spot || (spot.kind !== 'trash' && spot.kind !== 'toilet')) return false
          const placed = placedFacilities.get(spot.key)
          if (!placed) return false
          if (placed.trash <= 0 && !(spot.kind === 'toilet' && placed.used > 0)) return false
          const spotKey = tileKey(spot.tile.x, spot.tile.y)
          if (occupiedSpotTiles.has(spotKey)) return false
          occupiedSpotTiles.add(spotKey)
          worker.useSpot = spot
          worker.useStage = 'enter'
          worker.useFront = { x: worker.fromX, y: worker.fromY }
          worker.progress = 0
          worker.toX = spot.tile.x
          worker.toY = spot.tile.y
          worker.facing = directionOf(worker.toX - worker.fromX, worker.toY - worker.fromY)
          return true
        }
        // スイーパーを 1 フレーム分進める。清掃ルートが無ければ歩道をあてもなく歩き、
        // 踏んだマスが汚れていれば掃除する(遠くのゴミを探しには行かない)
        const updateSweeper = (worker: Staff, step: number, days: number) => {
          if (worker.striking) return
          // ゴミバコ・トイレの中に入って清掃する短い演出(客の利用と同じ仕組み)。
          // 中にこもっている時間は歩く速さに依らない純粋な時間
          if (worker.useStage === 'clean') {
            worker.useTimer -= days
            if (worker.useTimer > 0) return
            if (worker.useSpot) emptyFacilitySpot(worker.useSpot)
            worker.pleased += 1
            // 元の正面マスへ 1 マス戻る
            worker.useStage = 'exit'
            worker.progress = 0
            if (worker.useFront) {
              worker.toX = worker.useFront.x
              worker.toY = worker.useFront.y
              worker.facing = directionOf(worker.toX - worker.fromX, worker.toY - worker.fromY)
            }
            return
          }
          if (worker.useStage === 'exit') {
            worker.walked += step
            worker.progress += step
            if (worker.progress < 1) return
            worker.progress = 0
            worker.previousX = worker.fromX
            worker.previousY = worker.fromY
            worker.fromX = worker.toX
            worker.fromY = worker.toY
            if (worker.useSpot) {
              occupiedSpotTiles.delete(tileKey(worker.useSpot.tile.x, worker.useSpot.tile.y))
            }
            worker.useSpot = null
            worker.useStage = null
            worker.useFront = null
            return
          }
          if (worker.useStage === 'enter') {
            worker.walked += step
            worker.progress += step
            if (worker.progress < 1) return
            worker.progress = 0
            worker.previousX = worker.fromX
            worker.previousY = worker.fromY
            worker.fromX = worker.toX
            worker.fromY = worker.toY
            worker.useStage = 'clean'
            // 清掃 1 回の時間は原作 `FUN_801d705c` で `(速度 + 1) ×(0xb − 動作速度)× 4` フレーム
            // (対象により ÷2・×2 のモード差がある)。標準速度・1 日 150 フレームで
            // `(11 − 動作速度)× 4 ÷ 75` 日。動作速度は能力と能率で決まり、能力が高いほど速い
            worker.useTimer = (11 - staffAnimSpeed(worker)) * 4 / 75
            return
          }
          if (!worker.path) {
            // 足元の仕事が先。ゴミバコ・トイレに入る段へ移ったら今回はここまで
            if (workAtCurrentTile(worker)) return
            // 清掃ルートを設定してあれば、その順に巡回する
            if (worker.route && worker.route.length > 0) {
              worker.routeIndex = worker.routeIndex % worker.route.length
              const target = worker.route[worker.routeIndex]
              worker.routeIndex = (worker.routeIndex + 1) % worker.route.length
              if (!startStaffPath(worker, findStaffPath({ x: worker.fromX, y: worker.fromY }, target))) return
            }
            // ルートが無ければ歩道をあてもなく 1 マスずつ歩く。原作のスイーパーは
            // 遠くのゴミを探しに行かず、歩き回って踏んだマスが汚れていたら掃除するだけで
            // (`FUN_801d6954` の段 0 が徘徊 `FUN_801e9460` と足元の判定 `FUN_801d797c` を呼ぶ)、
            // だから何人雇っても勝手にばらける
            else if (!roads.has(tileKey(worker.fromX, worker.fromY))) {
              // 歩道の外に出ていたら、いちばん近い歩道へ戻ってから歩き回る
              const entry = nearestWalkableTile(worker.fromX, worker.fromY)
              if (!entry) return
              if (!startStaffPath(worker, straightTilesTo({ x: worker.fromX, y: worker.fromY }, entry))) return
            }
            else {
              const next = wanderStep(worker)
              if (!next || !startStaffPath(worker, [next])) return
            }
          }
          // 目的地に着いたら、足元の汚れを拾い、ゴミバコ・トイレの正面なら中へ入る
          const sweepAlong = (x: number, y: number) => { if (cleanLitterAt(x, y)) worker.pleased += 1 }
          if (advanceStaffPath(worker, step, sweepAlong)) workAtCurrentTile(worker)
        }

        // ---- メカニック ----
        // 耐久度が煙の出るしきい値を下回ったアトラクションと、設定メニューの「点検」で
        // 呼ばれたアトラクションのうち、手の空いているメカニックの中で最も近い者が出動する。
        // 点検が終わると耐久度を全快させて拠点へ戻る
        const mechanicConfig = staffSettings.mechanic
        // 修理中に敷地の外周へ建てる柵。原作はマスの属性 4 ビットで
        // 「そのマスのどの辺に柵があるか」を持ち(`FUN_801d66dc`)、
        // 地形描画が辺ごとの絵を重ねる。本作はマスごとに絵を持つ
        const repairFences = new Map<PlacedAttraction, Map<string, Phaser.GameObjects.Image[]>>()
        type RepairSpot = { x: number, y: number, edges: Array<'top' | 'bottom' | 'left' | 'right'> }
        // 柵を建てるマス。原作の順路表(`FUN_801d5ef4` が引く座標列)を読むと、
        // 5 × 5 の敷地なら中心から ±2 のリング ── つまり**敷地そのものの外周**であって、
        // 1 マス外側ではない。6 × 6 は横 -3〜+2・縦 -2〜+3、7 × 7 は ±3 で、いずれも敷地と同じ
        const repairRingOf = (placed: PlacedAttraction): RepairSpot[] => {
          const left = placed.x
          const right = placed.x + placed.width - 1
          const top = placed.y
          const bottom = placed.y + placed.height - 1
          const ring: RepairSpot[] = []
          const add = (x: number, y: number) => {
            const edges: RepairSpot['edges'] = []
            if (y === top) edges.push('top')
            if (y === bottom) edges.push('bottom')
            if (x === left) edges.push('left')
            if (x === right) edges.push('right')
            ring.push({ x, y, edges })
          }
          for (let x = left; x <= right; x += 1) add(x, top)
          for (let y = top + 1; y <= bottom; y += 1) add(right, y)
          for (let x = right - 1; x >= left; x -= 1) add(x, bottom)
          for (let y = bottom - 1; y > top; y -= 1) add(left, y)
          return ring
        }
        // 作業の順路。入口から外周を 1 周して柵を建て、入口へ戻り、
        // もう 1 周して回収する。真ん中が入口になる
        const repairRouteOf = (placed: PlacedAttraction): RepairSpot[] => {
          const ring = repairRingOf(placed)
          if (ring.length === 0) return []
          const door = placed.entrance
            ?? nearestFootprintAdjacent({ x: placed.x, y: placed.y }, attractionFootprintTiles(placed))
            ?? ring[0]
          let start = 0
          let best = Infinity
          ring.forEach((spot, index) => {
            const distance = Math.hypot(spot.x - door.x, spot.y - door.y)
            if (distance < best) { best = distance; start = index }
          })
          const lap = [...ring.slice(start), ...ring.slice(0, start)]
          return [...lap, { x: door.x, y: door.y, edges: [] }, ...lap]
        }
        const fenceTexture = {
          top: 'repair-fence-top',
          bottom: 'repair-fence-bottom',
          left: 'repair-fence-left',
          right: 'repair-fence-right',
        } as const
        const addRepairFence = (placed: PlacedAttraction, spot: RepairSpot) => {
          if (spot.edges.length === 0) return
          const perTile = repairFences.get(placed) ?? new Map<string, Phaser.GameObjects.Image[]>()
          repairFences.set(placed, perTile)
          const key = tileKey(spot.x, spot.y)
          if (perTile.has(key)) return
          const tile = point(spot.x, spot.y)
          perTile.set(key, spot.edges.map((edge) => {
            const offset = terrain.tileObjectOffsets[fenceTexture[edge]]
            return this.add.image(tile.x + offset.x, tile.y + offset.y, fenceTexture[edge])
              .setOrigin(0).setDepth(renderDepthAt('facility', spot.x, spot.y))
          }))
        }
        const removeRepairFence = (placed: PlacedAttraction, spot: RepairSpot) => {
          const perTile = repairFences.get(placed)
          const key = tileKey(spot.x, spot.y)
          perTile?.get(key)?.forEach((image) => image.destroy())
          perTile?.delete(key)
        }
        const clearRepairFence = (placed: PlacedAttraction) => {
          repairFences.get(placed)?.forEach((images) => images.forEach((image) => image.destroy()))
          repairFences.delete(placed)
        }
        // メカニックが着いたら運転を止める。乗っている客は支払いなしで降ろし、
        // 並んでいた客は列を離れる(撤去したときと同じ扱い)
        const startInspection = (placed: PlacedAttraction) => {
          if (placed.underInspection) return
          placed.underInspection = true
          releaseRiders(placed, false)
          guests.forEach((guest) => {
            if (guest.targetAttraction === placed && guest.phase === 'queueing') abandonQueue(guest)
          })
          if (settingsAttraction === placed) pushFacilitySettings()
        }
        // 故障中の見せ方。原作はアトラクションの絵そのものを毎フレーム揺らし、
        // その揺れた位置に黒煙のアニメを 1 つ重ねる(`FUN_801f609c`)。
        // ずらし幅は縦横それぞれ「3 − 乱数(0〜100) ÷ 20」で、+3〜-2 ピクセル。
        // 煙は 3 コマのアニメで、16 フレームごとにコマが進む(`FUN_801f7b64`)
        const breakdownSmoke = new Map<PlacedAttraction, Phaser.GameObjects.Graphics>()
        let breakdownTick = 0
        const shakeOffset = () => breakdownConfig.shakeBase - Math.floor(Math.random() * 101 / 20)
        const updateBreakdownEffects = (days: number) => {
          breakdownTick += days * originalFramesPerDay
          // 煙のコマ番号。原作と同じく 16 フレームごとに 3 コマを巡る
          const smokeFrame = Math.floor(breakdownTick / breakdownConfig.smokeFrameHold)
            % breakdownConfig.smokeFrames
          placedAttractions.forEach((placed) => {
            const broken = placed.needsRepair && !placed.underInspection
            const smoke = breakdownSmoke.get(placed)
            if (!broken) {
              if (smoke) { smoke.destroy(); breakdownSmoke.delete(placed) }
              if (placed.image.x !== placed.imageX) placed.image.setPosition(placed.imageX, placed.imageY)
              return
            }
            const offsetX = shakeOffset()
            const offsetY = shakeOffset()
            placed.image.setPosition(placed.imageX + offsetX, placed.imageY + offsetY)
            const graphics = smoke ?? this.add.graphics().setDepth(renderDepthAt('facility', placed.x, placed.y) + 1)
            if (!smoke) breakdownSmoke.set(placed, graphics)
            // 煙は揺れたアトラクションの位置に重なる。原作の絵はまだ取り出せていないので
            // ここは仮の見た目で、コマの進み方だけ原作に合わせている
            const base = point(placed.x + placed.width / 2, placed.y + placed.height / 2)
            graphics.clear()
            const spread = 1 + smokeFrame
            graphics.fillStyle(0x101010, 0.55 - smokeFrame * 0.1)
            graphics.fillCircle(base.x + offsetX, base.y - 16 - smokeFrame * 4 + offsetY, 3 + spread * 2)
          })
        }
        // 修理が終わったときの後始末
        const finishInspection = (worker: Staff, placed: PlacedAttraction) => {
          if (placedAttractions.includes(placed)) {
            placed.durability = durabilityLimitOf(placed.attraction, placed.version)
            placed.needsRepair = false
            placed.inspectRequested = false
            placed.underInspection = false
            // 手動で稼動させる系統は、点検が終わっても休止のままにする
            if (placed.attraction.manualStart) placed.suspended = true
            worker.pleased += 1
            buildMessageHandler.current(`${attractionForm(placed.attraction).name} の点検が終わりました。`)
            if (settingsAttraction === placed) pushFacilitySettings()
          }
          clearRepairFence(placed)
          worker.repairTarget = null
          worker.repairStep = 0
          worker.workTimer = 0
        }
        const updateMechanic = (worker: Staff, step: number, days: number) => {
          if (worker.striking) return
          const target = worker.repairTarget
          // 出動先が撤去されていたら柵を片づけて手が空いたことにする
          if (target && !placedAttractions.includes(target)) {
            clearRepairFence(target)
            worker.repairTarget = null
            worker.repairStep = 0
            worker.workTimer = 0
          }
          // 入口の中で作業している間。こもっている時間は歩く速さに依らない純粋な時間
          if (target && worker.jobTimer > 0 && !worker.path) {
            worker.jobTimer -= days
            if (worker.jobTimer > 0) return
            // 出てきて、残りの順路で柵を回収する
            worker.image.setVisible(true)
            worker.repairStep += 1
            return
          }
          // 順路を 1 マスずつ回る。前半は柵を建て、中間の入口で中に入り、後半は回収する
          if (target && target.underInspection) {
            // 柵 1 つぶんの作業を見せているあいだは、その場から動かない。
            // 原作もマスに着くたびに作業の動きを一通り再生し終えるまで次へ進まない
            if (worker.workTimer > 0) {
              worker.workTimer -= days
              worker.walked = 0
              return
            }
            if (worker.path) { advanceStaffPath(worker, step); return }
            const route = repairRouteOf(target)
            const half = Math.floor(route.length / 2)
            if (worker.repairStep >= route.length) { finishInspection(worker, target); return }
            const spot = route[worker.repairStep]
            if (worker.fromX !== spot.x || worker.fromY !== spot.y) {
              worker.walked = 0
              startStaffPath(worker, straightTilesTo({ x: worker.fromX, y: worker.fromY }, spot))
              return
            }
            // 中間の入口に着いたら中へ入って一定時間こもる。原作の待ちは
            // `(速度 + 1) ×(0xb − 動作速度)× 5` フレーム(外周のあるアトラクション)。
            // 標準速度・1 日 150 フレームで `(11 − 動作速度)÷ 15` 日。能力が高いほど短い
            if (worker.repairStep === half) {
              worker.image.setVisible(false)
              worker.jobTimer = (11 - staffAnimSpeed(worker)) / needsConfig.updatesPerDay
              return
            }
            if (worker.repairStep < half) addRepairFence(target, spot)
            else removeRepairFence(target, spot)
            // 作業の動き 1 周ぶん(2 コマ × 11 フレーム)その場に留まる
            worker.workTimer = mechanicConfig.fenceWorkFrames / originalFramesPerDay
            worker.repairStep += 1
            return
          }
          // 移動中。入口に着いたらアトラクションを止めて作業を始める
          if (worker.path) {
            if (advanceStaffPath(worker, step) && target) {
              startInspection(target)
              worker.repairStep = 0
            }
            return
          }
          if (worker.repairTarget) { worker.walked = 0; return }
          // 他のメカニックがすでに向かっている出動先は外して、近い順に試す
          const busy = new Set(
            staff.filter((other) => other.type.id === 'mechanic' && other.repairTarget)
              .map((other) => other.repairTarget),
          )
          const candidate = placedAttractions
            .filter((placed) => (placed.needsRepair || placed.inspectRequested) && !busy.has(placed))
            .sort((a, b) => (
              Math.hypot(a.x - worker.fromX, a.y - worker.fromY) - Math.hypot(b.x - worker.fromX, b.y - worker.fromY)
            ))[0]
          if (candidate) {
            // 急行する先はアトラクションの入口
            const tile = candidate.entrance
              ?? nearestFootprintAdjacent({ x: worker.fromX, y: worker.fromY }, attractionFootprintTiles(candidate))
            if (tile) {
              worker.repairTarget = candidate
              worker.repairStep = 0
              worker.walked = 0
              // 移動時に池や崖は障害にならないので、歩道の経路探索は使わずまっすぐ歩く
              const path = straightTilesTo({ x: worker.fromX, y: worker.fromY }, { x: tile.x, y: tile.y })
              // すでに入口にいて経路が空なら、その場で作業を始める
              if (!startStaffPath(worker, path)) startInspection(candidate)
              return
            }
          }
          const atHome = worker.fromX === worker.homeX && worker.fromY === worker.homeY
          if (!atHome) {
            worker.walked = 0
            startStaffPath(worker, straightTilesTo({ x: worker.fromX, y: worker.fromY }, { x: worker.homeX, y: worker.homeY }))
            return
          }
          // 拠点に着いた。以降のコマ送りは立ち止まりのアニメが受け持つ
          worker.walked = 0
        }

        // ---- ガードマン ----
        // アウトローと接触すると戦闘になる。勝率はそのガードマンの能率(%)そのもので、
        // 能率 100 なら必ず勝ち、下がるほど負けやすい。アウトローの強さは一定
        // (原作 `FUN_801d45b4` の case 6。アウトローの体力 -1 で割ると能率がそのまま確率になる)
        const fightOutlaw = (worker: Staff, outlaw: Guest) => {
          if (Math.floor(Math.random() * 100) < worker.efficiency) {
            // 退治したらその場では消さず、うしろに連れてバス待ち看板まで送り届ける
            worker.arresting = outlaw
            outlaw.waitingForRide = false
            outlaw.arrested = true
            // 歩きかけのまま止まらないよう、いま乗っているマスに揃える
            outlaw.toX = outlaw.fromX
            outlaw.toY = outlaw.fromY
            outlaw.progress = 1
            standStill(outlaw)
            worker.pleased += 1
            buildMessageHandler.current('ガードマンがアウトローを退治しました。')
            startStaffPath(worker, findStaffPath(
              { x: worker.fromX, y: worker.fromY },
              { x: gateCrossing.x, y: gateCrossing.y },
            ))
          }
          else {
            // 倒れている時間は原作で `(0xd − 能力)× 0x14 ÷(3 − 速度)` フレーム。標準速度・
            // 1 日 150 フレームで換算すると `(13 − 能力)÷ 15` 日。能力が高いほど早く起きる
            worker.jobTimer = (13 - worker.version) / needsConfig.updatesPerDay
            buildMessageHandler.current('ガードマンがアウトローにやられてしまいました。')
          }
        }
        const updateGuard = (worker: Staff, step: number, days: number) => {
          if (worker.striking) return
          // 戦闘に負けて倒れている間は動かない。原作は倒れている絵に切り替え、
          // 手前を向かせる(`FUN_801d45b4` の case 4 が向き 0xc0 とグループ 8 を設定する)。
          // 休みは歩く速さに依らない純粋な時間なので、経過日数で減らす
          if (worker.jobTimer > 0) {
            worker.jobTimer -= days
            worker.downed = worker.jobTimer > 0
            worker.facing = 0
            worker.walked = 0
            return
          }
          worker.downed = false
          // 退治したアウトローをバス待ち看板まで連行する。アウトローは 1 マスうしろを付いて歩く
          if (worker.arresting) {
            const outlaw = worker.arresting
            // 途中でアウトローが消えていたら連行をやめる
            if (!guests.includes(outlaw)) {
              worker.arresting = null
              worker.path = null
              return
            }
            if (worker.path) {
              // ガードマンが次のマスへ移るたび、アウトローは直前までいたマスへ動く
              advanceStaffPath(worker, step, () => {
                outlaw.previousX = outlaw.fromX
                outlaw.previousY = outlaw.fromY
                outlaw.fromX = worker.previousX
                outlaw.fromY = worker.previousY
                outlaw.toX = outlaw.fromX
                outlaw.toY = outlaw.fromY
                outlaw.progress = 1
                outlaw.facing = directionOf(outlaw.fromX - outlaw.previousX, outlaw.fromY - outlaw.previousY)
                outlaw.walked += 1
              })
              return
            }
            // 看板の 1 マス北に着いた。ガードマンはここで止まり、
            // アウトローだけが看板のマスへ進む。同時に迎えのバイクが来る
            worker.arresting = null
            outlaw.arrested = false
            outlaw.phase = 'toSign'
            outlaw.queueX = outlaw.fromX
            outlaw.queueY = outlaw.fromY
            if (!bike && !bus) spawnBike(true)
            return
          }
          // 迷子を連れている間は、道連れにして目的地(インフォメーションか拠点)まで運ぶ
          if (worker.escorting) {
            const child = worker.escorting
            if (!worker.path) {
              child.image.setVisible(true)
              child.progress = 1
              child.toX = worker.fromX
              child.toY = worker.fromY
              worker.escorting = null
              worker.pleased += 1
              buildMessageHandler.current('迷子を保護しました。')
              // 親のところまで運べていれば再会、届いていなければその場から自力で親を探す
              if (child.lostParent
                && Math.abs(child.fromX - child.lostParent.fromX) <= 1
                && Math.abs(child.fromY - child.lostParent.fromY) <= 1) {
                reuniteLostChild(child)
              }
              return
            }
            advanceStaffPath(worker, step, (x, y) => {
              child.fromX = x
              child.fromY = y
              child.toX = x
              child.toY = y
              child.previousX = x
              child.previousY = y
              child.progress = 1
            })
            return
          }
          // 迷子へ向かっている途中
          if (worker.rescueTarget) {
            const child = worker.rescueTarget
            if (!guests.includes(child) || !child.lostParent) {
              worker.rescueTarget = null
              worker.path = null
              return
            }
            if (worker.path) {
              advanceStaffPath(worker, step)
              return
            }
            // 迷子のマスまで来たので抱えて運ぶ
            worker.escorting = child
            worker.rescueTarget = null
            child.image.setVisible(false)
            // 親のところまで運ぶ。親が帰ってしまっていればインフォメーションへ
            const parent = child.lostParent
            const infoEntry = [...placedFacilities].find(([, placed]) => placed.facility.id === 'information')
            const destination = parent
              ? { x: parent.fromX, y: parent.fromY }
              : infoEntry ? parseKey(infoEntry[0]) : { x: worker.homeX, y: worker.homeY }
            startStaffPath(worker, findStaffPath({ x: worker.fromX, y: worker.fromY }, destination))
            return
          }
          // 出くわしたアウトローとは、見張り中でも移動中でもその場で戦う。
          // 隣のマスまで来たら接触とみなす
          const nearbyOutlaw = guests.find((guest) => (
            guest.outlaw && !guest.arrested && guest.phase === 'walking'
            && Math.abs(guest.fromX - worker.fromX) + Math.abs(guest.fromY - worker.fromY) <= 1
          ))
          if (nearbyOutlaw) { fightOutlaw(worker, nearbyOutlaw); return }
          if (worker.path) {
            advanceStaffPath(worker, step)
            return
          }
          worker.walked = 0
          // 他のガードマンがすでに向かっている・保護している迷子は外す
          const busy = new Set(
            staff.filter((other) => other.type.id === 'guard' && (other.rescueTarget || other.escorting))
              .flatMap((other) => [other.rescueTarget, other.escorting].filter((g): g is Guest => g !== null)),
          )
          const lostChild = guests
            .filter((guest) => guest.lostParent !== null && !busy.has(guest))
            .sort((a, b) => (
              Math.hypot(a.fromX - worker.fromX, a.fromY - worker.fromY)
                - Math.hypot(b.fromX - worker.fromX, b.fromY - worker.fromY)
            ))[0]
          if (lostChild) {
            const path = findStaffPath({ x: worker.fromX, y: worker.fromY }, { x: lostChild.fromX, y: lostChild.fromY })
            if (path && startStaffPath(worker, path)) worker.rescueTarget = lostChild
            return
          }
          // パーク内のアウトローは見つけしだい追いかける(退治は接触したときに起きる)
          const outlaw = guests
            .filter((guest) => (
              guest.outlaw && guest.image.visible && !guest.arrested && guest.phase === 'walking'
            ))
            .sort((a, b) => (
              Math.hypot(a.fromX - worker.fromX, a.fromY - worker.fromY)
                - Math.hypot(b.fromX - worker.fromX, b.fromY - worker.fromY)
            ))[0]
          if (outlaw) {
            const path = findStaffPath({ x: worker.fromX, y: worker.fromY }, { x: outlaw.fromX, y: outlaw.fromY })
            if (path && startStaffPath(worker, path)) return
          }
          // 保護も戦闘もなければ、いちばん近い十字路・T 字路まで歩いてそこで見張る。
          // 原作のガードマンは持ち場を持たず、十字路・T 字路のマスに着くとそこで立ち止まり
          // きょろきょろするだけで自分からは動かない。アウトローや迷子が現れたときだけ動き、
          // 片付いたらまた近くの十字路で見張りに就く(原作 `FUN_801d45b4` の case 0/5)
          if (isJunctionTile(worker.fromX, worker.fromY)) return
          const here = tileKey(worker.fromX, worker.fromY)
          const reach = buildReachMap(worker.fromX, worker.fromY, staffWalkable)
          let target: { x: number, y: number } | null = null
          let best = Infinity
          for (const key of reach.keys()) {
            if (key === here || !roads.has(key)) continue
            const pos = parseKey(key)
            if (!isJunctionTile(pos.x, pos.y)) continue
            const distance = Math.hypot(pos.x - worker.fromX, pos.y - worker.fromY)
            if (distance < best) { best = distance; target = pos }
          }
          // 十字路・T 字路が 1 つも無いパークでは、いちばん近い歩道まで出てその場で見張る
          if (!target) {
            if (roads.has(here)) return
            const entry = nearestWalkableTile(worker.fromX, worker.fromY)
            if (entry) startStaffPath(worker, straightTilesTo({ x: worker.fromX, y: worker.fromY }, entry))
            return
          }
          startStaffPath(worker, findStaffPath({ x: worker.fromX, y: worker.fromY }, target))
        }

        // ---- 来園者を楽しませる職種 ----
        // 原作の処理は 3 職種で共通(D2MAIN の `FUN_801d51bc`、種別 13〜15)。
        // 持ち場に立って待ち、来園者が近づくと芸のアニメ(グループ 4)を出す。
        // 誰も来ないまま待ち時間が尽きると歩き出し、T 字路・十字路に着いたら
        // そこを新しい持ち場にする。演じてよいマスはタイル種別 0x0c〜0x0f と 0x14 で、
        // これは道が 3 方向以上つながるマス(表 `0x801179b4` で確認)。
        // 直前の持ち場と、他のエンターテイナーがいるマスは選ばない
        const entertainerConfig = staffSettings.entertainer
        // 原作の当たり判定は毎フレーム走る。標準速度で 1 日 150 フレーム
        // (高速 75・低速 300。[来園者](design/20_guests.md) 参照)なので、1 日あたり 150 回判定する
        const entertainFramesPerDay = 150
        // 効きの範囲は原作 `FUN_801d7ad8` で自分の位置から縦横 ±1 マスの矩形
        // (x が ±0x16 = ±1 マス、y が ±0x10 = ±1 マス)。斜めも入るので市松距離で見る
        const guestInEntertainRange = (worker: Staff, guest: Guest) => (
          Math.abs(guest.fromX - worker.fromX) <= entertainerConfig.range
          && Math.abs(guest.fromY - worker.fromY) <= entertainerConfig.range
        )
        const guestNearStaff = (worker: Staff) => guests.some((guest) => (
          !guest.outlaw && guest.image.visible && guestInEntertainRange(worker, guest)
        ))
        // 次の 1 マス。行き止まりでなければ来た道は選ばない
        const wanderStep = (worker: Staff) => {
          const options = guestNeighbours
            .map(({ x: ox, y: oy }) => ({ x: worker.fromX + ox, y: worker.fromY + oy }))
            .filter((tile) => staffWalkable(tile.x, tile.y) && sameHeight(worker.fromX, worker.fromY, tile.x, tile.y))
          const ahead = options.filter((tile) => tile.x !== worker.previousX || tile.y !== worker.previousY)
          const pool = ahead.length > 0 ? ahead : options
          return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null
        }
        const updateEntertainer = (worker: Staff, step: number, days: number) => {
          if (worker.striking) { worker.walked = 0; worker.performing = false; return }
          // 芸をしている間だけ近くの来園者の気分が上がる。原作 `FUN_801d7b80` は毎フレーム
          // (エンティティ更新ごとに 1 回 = 標準速度で 1 日 150 回)、範囲内の来園者ごとに
          // 「乱数(0〜99) < 職種の係数 × 能力」で当たり判定し、当たると気分を 50 上げて
          // ウケた数を 1 増やす。係数はウサギ 1・グーチョくん 3・ミュージシャン 2。
          // 当たりに効くのは能率ではなく能力(バージョン)で、能力 0 では当たらない
          if (worker.performing && worker.version >= 1) {
            worker.entertainTick += days * entertainFramesPerDay
            const weight = 'entertainWeight' in worker.type ? worker.type.entertainWeight ?? 1 : 1
            const chance = weight * worker.version / 100
            while (worker.entertainTick >= 1) {
              worker.entertainTick -= 1
              guests.forEach((guest) => {
                if (guest.outlaw) return
                if (!guestInEntertainRange(worker, guest)) return
                if (Math.random() >= chance) return
                changeMood(guest, entertainerConfig.moodGain)
                worker.pleased += 1
              })
            }
          }
          else worker.entertainTick = 0
          if (worker.path) {
            worker.performing = false
            advanceStaffPath(worker, step)
            return
          }
          worker.walked = 0
          if (worker.settled) {
            // 待っている間も芸をしている間も手前を向く。原作は向きで選ばない
            // グループ 0(待ち)とグループ 4(芸)を直に指定する
            worker.facing = 0
            if (worker.performing) {
              worker.performTick += days
              if (worker.performTick < entertainerConfig.performDays) return
              worker.performing = false
              worker.performTick = 0
              worker.waitTick = 0
              return
            }
            // 来園者が近づいたら芸をする
            if (guestNearStaff(worker)) {
              worker.performing = true
              worker.performTick = 0
              worker.waitTick = 0
              return
            }
            // 誰も来ないまま待ち時間が尽きたら別の場所を探しに歩き出す
            worker.waitTick += days
            if (worker.waitTick < entertainerConfig.waitDays) return
            worker.settled = false
            worker.waitTick = 0
            return
          }
          // 場所探しの途中。落ち着ける条件を満たしたマスならそこを持ち場にする
          const taken = staff.some((other) => (
            other !== worker && other.type.cap === 'entertainer'
            && other.fromX === worker.fromX && other.fromY === worker.fromY
          ))
          const usable = isJunctionTile(worker.fromX, worker.fromY)
            && !(worker.fromX === worker.homeX && worker.fromY === worker.homeY)
            && !taken
          if (usable || guestNearStaff(worker)) {
            worker.settled = true
            worker.homeX = worker.fromX
            worker.homeY = worker.fromY
            return
          }
          const next = wanderStep(worker)
          if (next) startStaffPath(worker, [next])
        }

        const updateStaff = (worker: Staff, days: number) => {
          // つまんでいる間は仕事をしない
          if (worker === movingStaff) return
          // 歩く速さは能力と能率で決まる動作速度に応じて上がる(原作の速度テーブル段)。
          // 能力 0 のスタッフは能率が変わっても段 0 のまま基準速度で、能力を上げると速くなる
          const step = staffTilesPerDay * days * staffSpeedFactor(worker)
          if (worker.type.id === 'sweeper') updateSweeper(worker, step, days)
          else if (worker.type.id === 'mechanic') updateMechanic(worker, step, days)
          else if (worker.type.id === 'guard') updateGuard(worker, step, days)
          else updateEntertainer(worker, step, days)
          // 動作のアニメを出す状態か。楽しませる職種は芸をしている間だけで、
          // それ以外の職種は経路を持たず設備の出入りもしていないとき。
          // 状態に入った瞬間からアニメを頭出しする
          const idle = worker.downed
            || (worker.type.cap === 'entertainer'
              ? worker.performing
              : !worker.path && worker.useStage === null)
          worker.idleTick = idle ? (worker.idle ? worker.idleTick + days : 0) : 0
          worker.idle = idle
        }
        // 半数以上のスタッフの能率が 0 になるとストライキが起きる(月ごと判定)
        // 能率 0 のスタッフが半数以上になるとストライキ、半数を割ると解除
        // (原作 `FUN_800bc5ec`)。解除のときは全員の能率が 102 相当に戻る
        const refreshStrike = (notify = true) => {
          if (staff.length === 0) return
          const dead = staff.filter((worker) => worker.efficiency <= 0).length
          const striking = dead / staff.length >= staffSettings.efficiency.strikeThreshold
          const before = staff.some((worker) => worker.striking)
          staff.forEach((worker) => { worker.striking = striking })
          if (before && !striking) {
            staff.forEach((worker) => { worker.efficiency = staffSettings.efficiency.start })
            if (notify) buildMessageHandler.current('ストライキが終わりました。')
            return
          }
          if (striking && !before && notify) {
            buildMessageHandler.current('スタッフがストライキを起こしました。')
          }
        }
        // 月給の支払いと能率の増減。月が替わったときに 1 回だけ呼ぶ。
        // 月給が既定額を下回っている間は能率が下がり(月給が低いと怒ることがある)、
        // 既定額以上を払っていれば能率が少しずつ戻る(月給を上げると回復する)
        const payWages = () => {
          // 経費はスタッフ 1 人ずつ積み上げる。先月ぶんは経営の内訳に出すための控え
          staffExpenseLastMonth = staffExpenseThisMonth
          staffExpenseThisMonth = 0
          if (staff.length === 0) return
          let total = 0
          staff.forEach((worker) => {
            worker.paid += worker.wage
            staffExpenseThisMonth += worker.wage
            total += worker.wage
          })
          if (total > 0) spendHandler.current(total)
          // 能率は毎月「乱数 % (怒りやすさ × 2)」だけ下がる(原作 `FUN_800bc330` の呼び分け 0)
          staff.forEach((worker) => {
            const drop = Math.floor(Math.random() * worker.anger * 2)
            worker.efficiency = Math.max(0, worker.efficiency - drop)
          })
          refreshStrike()
          // 30 年勤務したスタッフは定年退職する。後ろから調べて解雇中の詰め直しに影響させない
          for (let index = staff.length - 1; index >= 0; index -= 1) {
            const worker = staff[index]
            if (elapsedDays - worker.hireDay < staffSettings.retirementYears * 365) continue
            buildMessageHandler.current(`${worker.type.label}が定年退職しました。`)
            dismissStaff(worker)
          }
        }
        // 経営の「スタッフ経費」に出す集計。一覧画面が無いので表には出していないが、
        // スタッフ 1 人ずつの累計(Staff.paid)と月ごとの合計は積んでいる
        let staffExpenseThisMonth = 0
        let staffExpenseLastMonth = 0
        readStaffExpense.current = () => ({
          thisMonth: staffExpenseThisMonth,
          lastMonth: staffExpenseLastMonth,
          total: staff.reduce((sum, worker) => sum + worker.paid, 0),
          byStaff: staff.map((worker) => ({ id: worker.type.id, wage: worker.wage, paid: worker.paid })),
        })
        // 労使交渉。毎年 4 月 10 日にスタッフの能率を一定量戻す(原作の労使交渉に当たる)
        const negotiationConfig = staffSettings.negotiation
        let lastNegotiationYear = -1
        {
          const start = new Date(startDateMs + Math.floor(initialDays.current) * 86_400_000)
          // 開始日が 4 月 10 日以降なら、その年はもう済んだ扱いにして翌年から
          const passed = start.getUTCMonth() > negotiationConfig.month - 1
            || (start.getUTCMonth() === negotiationConfig.month - 1 && start.getUTCDate() >= negotiationConfig.day)
          if (passed) lastNegotiationYear = start.getUTCFullYear()
        }
        const runNegotiationIfDue = () => {
          const date = new Date(startDateMs + Math.floor(elapsedDays) * 86_400_000)
          const y = date.getUTCFullYear()
          if (y === lastNegotiationYear) return
          const due = date.getUTCMonth() > negotiationConfig.month - 1
            || (date.getUTCMonth() === negotiationConfig.month - 1 && date.getUTCDate() >= negotiationConfig.day)
          if (!due) return
          lastNegotiationYear = y
          if (staff.length === 0) return
          // 成立すると能率が一定量戻り、月給が定率で上がる(原作 `FUN_800bc330` の呼び分け 1)。
          // 断ると能率が同じだけ下がる。断る操作はまだ無いのでいまは必ず成立する
          staff.forEach((worker) => {
            worker.efficiency = Math.min(
              staffSettings.efficiency.start,
              worker.efficiency + staffSettings.efficiency.negotiationGain,
            )
            worker.wage = Math.min(
              settingsConfig.maxPrice,
              worker.wage + Math.round(worker.wage * negotiationConfig.raisePerMille / 1000),
            )
          })
          refreshStrike()
          buildMessageHandler.current('労使交渉が成立しました。月給が上がります。')
        }
        // セーブから復元する
        const savedStaff = initialParkData.current?.staff
        if (savedStaff) {
          for (const entry of savedStaff) {
            spawnStaff(
              entry.id, { x: entry.x, y: entry.y }, entry.efficiency, entry.version,
              entry.wage, entry.hireDay, entry.route, entry.paid, entry.anger, entry.name,
              entry.homeX === undefined || entry.homeY === undefined
                ? undefined
                : { x: entry.homeX, y: entry.homeY },
            )
          }
          refreshStrike(false)
        }
        monthlyExtraTask = payWages

        // マス目を歩く客を 1 フレーム分進める
        const updateWalkingGuest = (guest: Guest, step: number) => {
          const leaving = elapsedDays >= guest.leaveAtDay
          // 帰宅が決まったらショップへの用事は取りやめる
          if (leaving && guest.targetShop) {
            guest.targetShop = null
            guest.path = null
            guest.pathIndex = 0
          }
          guest.walked += step
          guest.progress += step
          while (guest.progress >= 1) {
            guest.progress -= 1
            guest.previousX = guest.fromX
            guest.previousY = guest.fromY
            guest.fromX = guest.toX
            guest.fromY = guest.toY
            // 汚れたマスを踏むたびに我慢が減り、使い切ると気分が大きく下がる(原作 0x801e64ec)。
            // 一度使い切った来園者はそれ以上下がらない
            if (!guest.outlaw && guest.litterPatience > 0 && isLittered(guest.fromX, guest.fromY)) {
              guest.litterPatience = Math.max(0, guest.litterPatience - litterConfig.patiencePerStep)
              if (guest.litterPatience === 0) changeMood(guest, litterConfig.moodPenalty)
            }
            // 敷地内に道路が敷かれ、実際にそこへ足を踏み入れた時点で入場料を払う。
            // 園外の道路では払わない(払うまでは固定歩道も歩けるので、ゲートへ戻れる)
            if (!guest.paid
              && roads.has(tileKey(guest.fromX, guest.fromY))
              && isInsidePark(guest.fromX, guest.fromY)) {
              guest.paid = true
              guest.money -= guestConfig.admissionFee
              admissionHandler.current(guestConfig.admissionFee)
              visitorsThisYear += 1
            }
            // アウトローは店にも乗り物にも設備にも用がなく、バスにも乗らない。
            // 歩き方だけ来園者と同じで、行き先の判断はすべて飛ばす
            if (guest.outlaw) {
              // 帰る時刻を過ぎてゲート下まで戻ったら、迎えのバイクをその場で待つ
              if (leaving && guest.fromX === gateCrossing.x && guest.fromY === gateCrossing.y) {
                guest.waitingForRide = true
                guest.progress = 0
                guest.toX = guest.fromX
                guest.toY = guest.fromY
                guest.facing = 0
                standStill(guest)
                return
              }
              const step = chooseGuestStep(guest, leaving)
              if (!step) {
                guest.progress = 0
                break
              }
              guest.toX = step.x
              guest.toY = step.y
              continue
            }
            // 看板マスに着いた帰る客は、ここから待ち行列の位置まで歩く
            if (leaving && isSignTile(guest.fromX, guest.fromY)) {
              joinQueue(guest)
              guest.queueX = guest.fromX
              guest.queueY = guest.fromY
              guest.progress = 0
              guest.toX = guest.fromX
              guest.toY = guest.fromY
              return
            }
            // 立ち止まったマスが設備の正面なら利用を試みる(入園前の園外でも使う)
            if (!leaving) {
              const spot = facilitySpots.get(tileKey(guest.fromX, guest.fromY))
              if (spot && tryUseFacility(guest, spot)) return
            }
            // 通りかかった店の前で条件を満たせば気づいて入る(経路探索とは独立に毎回判定)。
            // 見つけたらそのまま下の経路処理が店前の道への一歩を進める
            if (!guest.targetShop) tryDiscoverShopAtEntrance(guest, leaving)
            // 隣に整列歩道があれば並び始める(店と同じ立ち止まり判定)
            if (!guest.targetShop && !guest.path && tryJoinAttractionQueue(guest, leaving)) return
            // ショップへの経路の途中なら次のマスへ進む。終点(店の中心)に着いたら利用を始める
            if (guest.path) {
              if (guest.pathIndex >= guest.path.length) {
                guest.path = null
                guest.pathIndex = 0
                if (guest.targetShop) {
                  guest.progress = 0
                  guest.toX = guest.fromX
                  guest.toY = guest.fromY
                  enterShop(guest)
                  return
                }
              }
              else {
                const nextTile = guest.path[guest.pathIndex]
                const nextKey = tileKey(nextTile.x, nextTile.y)
                if ((roads.has(nextKey) || stairsTiles.has(nextKey))
                  && (sameHeight(nextTile.x, nextTile.y, guest.fromX, guest.fromY)
                    || stairsLink(guest.fromX, guest.fromY, nextTile.x, nextTile.y))
                  && stairsTraversable(guest.fromX, guest.fromY, nextTile.x, nextTile.y)) {
                  guest.pathIndex += 1
                  guest.toX = nextTile.x
                  guest.toY = nextTile.y
                  continue
                }
                // 道が撤去されるなどして経路が壊れたら取りやめて徘徊に戻る
                guest.path = null
                guest.pathIndex = 0
                guest.targetShop = null
              }
            }
            // 空腹・渇きがしきい値に達していたら行き先のショップを探す(経路探索が有効なときだけ)
            if (guestRouteSearchEnabled && !leaving && !guest.targetShop && guest.seekCooldown <= 0) {
              const chosenPath = chooseShopTarget(guest)
              if (chosenPath && chosenPath.length > 0) {
                guest.pathIndex = 1
                guest.toX = chosenPath[0].x
                guest.toY = chosenPath[0].y
                continue
              }
            }
            const next = chooseGuestStep(guest, leaving)
            if (!next) {
              guest.progress = 0
              break
            }
            guest.toX = next.x
            guest.toY = next.y
          }
          // その場に留まっている間(移動量ゼロ)は向きを変えない
          if (guest.toX !== guest.fromX || guest.toY !== guest.fromY) {
            guest.facing = directionOf(guest.toX - guest.fromX, guest.toY - guest.fromY)
          }
        }
        // 看板前の客を目標地点へ近づける。バスに乗り込んだら true(呼び出し側が取り除く)
        const updateQueuedGuest = (guest: Guest, days: number) => {
          const target = queueTargetOf(guest)
          const dx = target.x - guest.queueX
          const dy = target.y - guest.queueY
          const distance = Math.hypot(dx, dy)
          const maxStep = guest.tilesPerDay * days
          if (distance > maxStep) {
            guest.queueX += (dx / distance) * maxStep
            guest.queueY += (dy / distance) * maxStep
            guest.walked += maxStep
            guest.facing = directionOf(dx, dy)
            return false
          }
          guest.queueX = target.x
          guest.queueY = target.y
          standStill(guest)
          if (guest.phase === 'toBus') return true
          if (guest.phase === 'toSign') {
            // 看板の中心に着いたら下を向き、そのまま 1 マス進んで乗り物に乗る。
            // ガードマンに連行されたアウトローは先に看板へ着くので、
            // 迎えのバイクが停まるまでここで待つ
            guest.facing = 0
            if (guest.outlaw && bike?.state !== 'stopped') return false
            guest.phase = 'toBus'
            return false
          }
          if (guest.phase === 'fromBus') {
            // 乗り物から看板の中心まで出たら、続けてゲート下へ上がる
            guest.phase = 'fromSign'
            guest.facing = 1
            return false
          }
          if (guest.phase === 'fromSign') {
            // ゲート下に着いたらふつうの歩きに切り替える
            guest.phase = 'walking'
            guest.fromX = gateCrossing.x
            guest.fromY = gateCrossing.y
            guest.toX = gateCrossing.x
            guest.toY = gateCrossing.y
            guest.previousX = gateCrossing.x
            guest.previousY = gateCrossing.y
            // 1 にしておくと次の更新で待たずに進む先を選ぶ
            guest.progress = 1
            return false
          }
          // 待機中は看板(中央)を向く
          guest.facing = directionOf(busStop.x - guest.queueX, 0)
          return false
        }

        // ---- バス ----
        // 車体は 先頭 + 中間 × バージョン数 + 後尾 の連結。現状はバージョン 1 相当で中間なし
        const busMiddleCount = 0
        const busOffsets = busSprites.variants[0].offsetsByKind[sceneryKind]
        const busParts = (() => {
          const parts = [{ part: 0, slotX: 0 }]
          for (let index = 0; index < busMiddleCount; index += 1) {
            parts.push({ part: 1, slotX: busSprites.partSpacing * index })
          }
          parts.push({ part: 2, slotX: busSprites.partSpacing * busMiddleCount })
          return parts
        })()
        type Bus = {
          x: number
          state: 'arriving' | 'stopped' | 'leaving'
          timer: number
          unloaded: number
          unloadDone: boolean
          boarded: number
          images: Phaser.GameObjects.Image[]
          gaugeBack: Phaser.GameObjects.Rectangle
          gaugeFill: Phaser.GameObjects.Rectangle
        }
        let bus: Bus | null = null
        const busEnterX = right + 3
        const busExitX = left - 3
        const placeBusImage = (current: Bus) => {
          const position = point(current.x + 1, busRow)
          const baseX = position.x + busConfig.anchor.x
          const baseY = position.y + busConfig.anchor.y
          const leftEdge = Math.min(...busParts.map(({ part, slotX }) => slotX - busOffsets[part].x))
          const rightEdge = Math.max(...busParts.map(({ part, slotX }, index) => slotX - busOffsets[part].x + current.images[index].width))
          // 車体は何マスにもまたがるので、アトラクションと同じくいちばん手前(左)のマスで
          // 重ね順を決める。基準の列で決めると、車体に隠れる位置の客が車体より前に出る
          const column = Math.round(current.x + 1 + (busConfig.anchor.x + leftEdge) / stepX)
          const depth = renderDepthAt('facility', column, busRow)
          current.images.forEach((image, index) => {
            const { part, slotX } = busParts[index]
            image.setPosition(baseX + slotX - busOffsets[part].x, baseY - busOffsets[part].y).setDepth(depth)
          })
          // 乗車率のバーは車体の中央下に置く
          const bottomEdge = Math.max(...busParts.map(({ part }, index) => current.images[index].height - busOffsets[part].y))
          const gauge = busConfig.gauge
          const gaugeX = baseX + (leftEdge + rightEdge - gauge.width) / 2
          const gaugeY = baseY + bottomEdge + gauge.offsetY
          // 到着時は満員で来て、降ろした分だけ減り、乗せた分だけ増える
          const aboard = busConfig.capacity - current.unloaded + current.boarded
          const filled = gauge.width * Math.min(1, Math.max(0, aboard) / busConfig.capacity)
          const gaugeDepth = renderDepthAt('overlay', column, busRow)
          current.gaugeBack.setPosition(gaugeX, gaugeY).setDepth(gaugeDepth)
          current.gaugeFill
            .setPosition(gaugeX, gaugeY)
            .setSize(filled, gauge.height)
            .setVisible(filled > 0)
            .setDepth(gaugeDepth + 1)
        }
        // 乗車が決まった客はその場から看板・バスへ歩いて乗り込む(実際に消えるのは到着時)
        const boardWaitingGuest = () => {
          // 乗るのは列の先頭から
          const guest = waitingGuests[0]
          if (!guest) return false
          leaveQueue(guest)
          guest.phase = 'toSign'
          return true
        }
        const updateBus = (days: number) => {
          if (!bus) return
          if (bus.state === 'arriving') {
            bus.x -= busConfig.tilesPerDay * days
            if (bus.x <= busHaltX) {
              bus.x = busHaltX
              bus.state = 'stopped'
              bus.timer = 0
            }
          }
          else if (bus.state === 'stopped') {
            bus.timer += days
            // 停車中は一定の間隔で 1 人ずつ降ろし、待っている客を 1 人ずつ乗せる
            const slots = Math.floor(bus.timer * busConfig.boardsPerDay)
            while (!bus.unloadDone && bus.unloaded + bus.boarded < slots) {
              if (!spawnGuest()) {
                bus.unloadDone = true
                break
              }
              bus.unloaded += 1
              if (bus.unloaded >= busConfig.capacity) bus.unloadDone = true
            }
            while (bus.boarded < busConfig.capacity && bus.unloaded + bus.boarded < slots) {
              if (!boardWaitingGuest()) break
              bus.boarded += 1
            }
            // 定員に空きがあり待っている客が残っている間と、
            // バスへ歩いている途中の客がいる間は発車しない(乗り込んで消えるのを待つ)
            const wantsMore = bus.boarded < busConfig.capacity && waitingGuests.length > 0
            const boarding = guests.some((guest) => guest.phase === 'toSign' || guest.phase === 'toBus')
            if (bus.timer >= busConfig.stopDays && bus.unloadDone && !wantsMore && !boarding) bus.state = 'leaving'
          }
          else {
            bus.x -= busConfig.tilesPerDay * days
            if (bus.x < busExitX) {
              bus.images.forEach((image) => image.destroy())
              bus.gaugeBack.destroy()
              bus.gaugeFill.destroy()
              bus = null
              return
            }
          }
          placeBusImage(bus)
        }
        // ---- アウトロー ----
        // バスと同じ道をバイクで乗り付け、ゲート下でアウトローだけを降ろして走り去る。
        // 原作では降ろした瞬間に絵が 2 人乗りから運転手だけに替わる
        const outlawConfig = game.outlaw
        // 歩く速さはヤングに合わせる。区分の設定が変わればそのまま追従する
        const outlawTypeIndex = Math.max(0, guestConfig.types.findIndex((entry) => entry.id === 'young'))
        const bikeOffsets = bikeSprites.variants.map((variant) => variant.offsetsByKind[sceneryKind])
        type Bike = {
          x: number
          state: 'arriving' | 'stopped' | 'leaving'
          timer: number
          // 迎えに来た側か。送り届けるときは false、乗せて帰るときは true
          pickup: boolean
          // rider = アウトローを乗せている間。絵が 2 人乗りと運転手だけで替わる
          rider: boolean
          frame: number
          frameTimer: number
          image: Phaser.GameObjects.Image
        }
        let bike: Bike | null = null
        let outlawCheckTimer = 0
        const placeBikeImage = (current: Bike) => {
          const variant = current.rider ? 0 : 1
          const offset = bikeOffsets[variant][current.frame]
          const position = point(current.x + 1, busRow)
          const baseX = position.x + busConfig.anchor.x
          const baseY = position.y + busConfig.anchor.y
          const column = Math.round(current.x + 1 - offset.x / stepX)
          current.image
            .setTexture(`bike-${variant}-${current.frame}-s${seasonIndex}`)
            .setPosition(baseX - offset.x, baseY - offset.y)
            .setDepth(renderDepthAt('facility', column, busRow))
        }
        const updateBike = (days: number) => {
          if (!bike) return
          if (bike.state === 'stopped') {
            // いったん停まってから乗り降りする。乗っているかどうかで絵が替わる
            bike.timer += days
            if (bike.timer < outlawConfig.dropDays) return
            if (!bike.pickup) {
              bike.frame = 0
              bike.state = 'leaving'
              bike.rider = false
              spawnOutlaw()
            }
            else {
              // 待っているアウトローに乗り込みを始めさせ、消えるまで停まって待つ
              const outlaw = guests.find((guest) => guest.outlaw)
              if (outlaw) {
                if (outlaw.waitingForRide) {
                  outlaw.waitingForRide = false
                  outlaw.phase = 'toSign'
                  outlaw.queueX = outlaw.fromX
                  outlaw.queueY = outlaw.fromY
                }
              }
              else {
                bike.frame = 0
                bike.state = 'leaving'
                bike.rider = true
              }
            }
          }
          else {
            bike.x -= outlawConfig.bikeTilesPerDay * days
            // 車輪のコマ送り。停まっている間は動かさない
            bike.frameTimer += days
            while (bike.frameTimer >= outlawConfig.bikeFrameDays) {
              bike.frameTimer -= outlawConfig.bikeFrameDays
              bike.frame = (bike.frame + 1) % bikeOffsets[bike.rider ? 0 : 1].length
            }
            // 停まる位置はバスと同じ
            if (bike.state === 'arriving' && bike.x <= busHaltX) {
              bike.x = busHaltX
              bike.state = 'stopped'
              bike.timer = 0
              bike.frame = 0
            }
            if (bike.x < busExitX) {
              bike.image.destroy()
              bike = null
              return
            }
          }
          placeBikeImage(bike)
        }
        const spawnBike = (pickup: boolean) => {
          bike = {
            x: busEnterX,
            state: 'arriving',
            timer: 0,
            pickup,
            // 送り届けるときは 2 人乗りで来て、迎えのときは運転手だけで来る
            rider: !pickup,
            frame: 0,
            frameTimer: 0,
            image: this.add.image(0, 0, `bike-${pickup ? 1 : 0}-0-s${seasonIndex}`).setOrigin(0),
          }
          placeBikeImage(bike)
        }
        // アウトローに出くわしたキッズは怖がって気分が大きく下がる。
        // 同じ子が続けて何度も下がらないよう、少し間を空ける
        const scareNearbyKids = (outlaw: Guest) => {
          guests.forEach((guest) => {
            if (guest.outlaw || guestConfig.types[guest.type].id !== 'kids') return
            if (guest.fromX !== outlaw.fromX || guest.fromY !== outlaw.fromY) return
            if (elapsedDays < guest.shockedUntil) return
            guest.shockedUntil = elapsedDays + outlawConfig.kidShockDays
            changeMood(guest, outlawConfig.kidMoodPenalty)
          })
        }
        const spawnBus = () => {
          bus = {
            x: busEnterX,
            state: 'arriving',
            timer: 0,
            unloaded: 0,
            unloadDone: false,
            boarded: 0,
            images: busParts.map(({ part }) => this.add.image(0, 0, `bus-0-${part}-s${seasonIndex}`).setOrigin(0)),
            gaugeBack: this.add
              .rectangle(0, 0, busConfig.gauge.width, busConfig.gauge.height, 0x000000, 0.6)
              .setOrigin(0, 0),
            gaugeFill: this.add
              .rectangle(0, 0, busConfig.gauge.width, busConfig.gauge.height, 0x4ade80)
              .setOrigin(0, 0),
          }
          placeBusImage(bus)
        }

        // 来園者もバスもゲーム内の日数で動く。速度を上げれば日付と同じだけ速くなる
        let busTimerDays = 0
        let reportedGuestCount = -1
        this.simulate = (deltaMs: number) => {
          // 日付を飛ばした直後は、時間が止まっていても季節と月を見直す
          if (seasonDirty) {
            seasonDirty = false
            refreshSeason()
            refreshMonth()
          // 日をまたいだら、迷子を出してよい状態へ戻すか抽選する
          const today = Math.floor(elapsedDays)
          if (today !== lastLostChildDay) {
            lastLostChildDay = today
            const year = new Date(startDateMs + today * 86_400_000).getUTCFullYear()
            if (year !== visitorYear) { visitorYear = year; visitorsThisYear = 0 }
            if (!lostChildArmed && !guests.some((guest) => guest.lost)) {
              const threshold = Math.floor(parkValue / Math.max(1, visitorsThisYear) / 100)
              lostChildArmed = Math.floor(Math.random() * 100) + 1 < threshold
            }
          }
          }
          const days = deltaMs * daysPerMs
          if (days <= 0) return
          elapsedDays += days
          refreshSeason()
          refreshMonth()
          // 前のバスが去ってから次の間隔で、右手からバスが入ってくる。
          // バスとバイクは同じ道を走るので、相手が走っている間は入ってこない
          if (!bus) {
            busTimerDays += days
            if (busTimerDays >= busConfig.intervalDays && !bike) {
              busTimerDays = 0
              spawnBus()
            }
          }
          updateBus(days)
          // 決まった間隔でアウトローの出現を判定する。園内に居る間と走行中は判定しない
          outlawCheckTimer += days
          if (outlawCheckTimer >= outlawConfig.checkIntervalDays) {
            outlawCheckTimer = 0
            const present = bus !== null || bike !== null || guests.some((guest) => guest.outlaw)
            if (!present && Math.random() < outlawConfig.chance) spawnBike(false)
          }
          updateBike(days)
          updateBreakdownEffects(days)
          // 受け入れ中は時間切れで入口を閉めて動き出し、稼働が終わったら全員降ろす
          rideStates.forEach((state, placed) => {
            if (state.aboard.length === 0) return
            if (state.phase === 'running') {
              // 原作は「今の位相で客を描いてから、絵が変わっていれば位相を 1 進める」
              const changed = advanceRideAnimation(placed, days)
              drawRiders(placed)
              const riders = ridersOf(placed)
              if (changed && riders) placed.riderPhase = (placed.riderPhase + 1) % riders.period
            }
            state.timer -= days
            if (state.timer > 0) return
            if (state.phase === 'loading') {
              state.phase = 'running'
              state.timer = rideDaysOf(placed)
              startRideAnimation(placed)
            }
            else releaseRiders(placed, true)
          })

          // 「全部乗った」の判定に使う、園内にあるアトラクションの種類数
          const attractionKinds = new Set(placedAttractions.map(({ id }) => id)).size
          for (let index = guests.length - 1; index >= 0; index -= 1) {
            const guest = guests[index]
            // アウトローは欲求も反応も持たない。歩いてキッズを怖がらせ、頃合いで帰る
            if (guest.outlaw) {
              if (guest.phase === 'walking') {
                // ガードマンに連行されている間は自分では歩かない(絵はガードマンが動かす)
                if (guest.arrested) { /* 何もしない */ }
                else if (guest.waitingForRide) {
                  // ゲート下で迎えを待つ。バスが走っている間は呼べないので、空くまで待つ
                  if (!bike && !bus) spawnBike(true)
                }
                else {
                  updateWalkingGuest(guest, guest.tilesPerDay * days)
                  scareNearbyKids(guest)
                }
              }
              else if (updateQueuedGuest(guest, days)) {
                // バイクのマスまで進みきったら乗り込んで消える
                removeGuest(index)
                continue
              }
              placeGuestImage(guest)
              continue
            }
            updateGuestNeeds(guest, days)
            // ガードマンに抱えられている間は自分では動かない(絵はガードマンが動かす)
            if (guest.lostParent && !guest.image.visible) continue
            // はぐれた親子は、同じマスで出会えば再会する
            if (guest.lostParent && guest.image.visible
              && guest.fromX === guest.lostParent.fromX && guest.fromY === guest.lostParent.fromY) {
              reuniteLostChild(guest)
              continue
            }
            // インフォメーションがあれば、はぐれた親も子もそこを目指す
            if ((guest.lost || guest.lostParent) && !guest.path) headForInformation(guest)
            // 出ていた反応を出しきったら、今の状態から選び直す
            guest.reactionFrames = Math.max(0, guest.reactionFrames - originalFramesPerStep)
            if (guest.reactionFrames === 0) refreshStandingReaction(guest, attractionKinds)
            if (guest.seekCooldown > 0) guest.seekCooldown = Math.max(0, guest.seekCooldown - days)
            if (guest.phase === 'walking') updateWalkingGuest(guest, guest.tilesPerDay * days)
            else if (guest.phase === 'queueing') updateQueueingGuest(guest, guest.tilesPerDay * days, days)
            else if (guest.phase === 'riding') { /* 降車はアトラクション側の時間経過で行う */ }
            else if (guest.phase === 'facility') updateFacilityGuest(guest, guest.tilesPerDay * days, days)
            else if (guest.phase === 'shopping') {
              guest.serviceRemaining -= days
              if (guest.serviceRemaining <= 0) finishShopping(guest)
            }
            else if (updateQueuedGuest(guest, days)) {
              removeGuest(index)
              continue
            }
            placeGuestImage(guest)
            placeReactionImage(guest)
          }
          // スタッフはメニューから雇うと足元(ゲート下)に現れる。歩き回るだけの職種も、
          // スイーパーの実際の仕事も、来園者と同じ 1 日 15 マスの刻みで進める
          runNegotiationIfDue()
          for (const worker of staff) {
            updateStaff(worker, days)
            placeStaffImage(worker)
          }
          // 来園者数にアウトローは数えない
          const visitorCount = guests.reduce((total, guest) => total + (guest.outlaw ? 0 : 1), 0)
          if (visitorCount !== reportedGuestCount) {
            reportedGuestCount = visitorCount
            guestCountHandler.current(visitorCount)
          }
        }
        // ここまでで絵の読み込みと園の組み立てが終わり、遊べる状態になる
        readyHandler.current()
      }
    }

    phaserGame.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#1d2d2a',
      pixelArt: true,
      // 描画は画面の更新に任せて間引かない。ディスプレイの更新間隔と上限が近いと
      // 描画する回とそうでない回が交互に出て画面がちらつくため。
      // 演算の回数は update() 側で固定してあるので、描画が何回でも進み方は変わらない
      fps: { target: game.time.framesPerSecond },
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: ParkScene,
    })

    return () => {
      phaserGame.current?.destroy(true)
      phaserGame.current = null
    }
  }, [country])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('road-build-mode', roadBuildMode)
  }, [roadBuildMode])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('attraction-build-mode', attractionBuild)
  }, [attractionBuild])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('shop-build-mode', shopBuild)
  }, [shopBuild])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('facility-build-mode', facilityBuild)
  }, [facilityBuild])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('staff-build-mode', staffBuild)
  }, [staffBuild])

  useEffect(() => {
    initialSecondsPerDay.current = secondsPerDay
    phaserGame.current?.scene.getScene('park')?.events.emit('seconds-per-day', secondsPerDay)
  }, [secondsPerDay])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('attraction-build-step', attractionBuildStep)
  }, [attractionBuildStep])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('available-cash', availableCash)
  }, [availableCash])

  useEffect(() => {
    initialMapBlocked.current = mapBlocked
    phaserGame.current?.scene.getScene('park')?.events.emit('map-blocked', mapBlocked)
  }, [mapBlocked])

  useEffect(() => {
    initialTouchLayout.current = touchLayout
    phaserGame.current?.scene.getScene('park')?.events.emit('touch-layout', touchLayout)
  }, [touchLayout])

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
})

export default ParkMap
