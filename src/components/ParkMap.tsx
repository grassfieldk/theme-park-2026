import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import Phaser from 'phaser'
import attractions from '../config/attractions.json'
import shops from '../config/shops.json'
import facilities from '../config/facilities.json'
import game from '../config/game.json'
import type { MenuAction } from './GamepadController'
import busSprites from '../config/busSprites.json'
import guestSprites from '../config/guestSprites.json'
import pointers from '../config/pointers.json'
import seasons from '../config/seasons.json'
import terrainObjects from '../config/terrainObjects.json'
import { gameDaysPerMs } from '../game/clock'
import type { ParkSnapshot } from '../game/save'

type Country = {
  id: string
  name: string
  map: { x: number, y: number, width: number, height: number }
}

type Props = {
  country: Country
  roadBuildMode: RoadBuildMode
  attractionBuild: Attraction | null
  attractionBuildStep: AttractionBuildStep
  shopBuild: Shop | null
  facilityBuild: Facility | null
  availableCash: number
  onAttractionPlaced: (cost: number) => void
  onAttractionPlacementCancelled: (cost: number) => void
  onAttractionAccessPlaced: (step: 'entrance' | 'exit') => void
  onShopPlaced: (cost: number) => void
  onShopBuildStep: (step: 'body' | 'direction') => void
  onShopComplete: () => void
  onFacilityPlaced: (cost: number) => void
  onFacilityBuildStep: (step: 'body' | 'direction') => void
  secondsPerDay: number
  onAdmissionPaid: (fee: number) => void
  onGuestCountChange: (count: number) => void
  onBuildMessage: (message: string) => void
  /** アトラクション・ショップの撤去前に確認を出す。返事は resolveRemoval で返す */
  onRemoveConfirm: (name: string) => void
  /** メニューや確認が開いている間は、マップへのクリックを受け付けない */
  mapBlocked: boolean
  /** セーブデータから再開するときの園の中身。新規開始なら null */
  initialPark: ParkSnapshot | null
  /** 開始時点の経過日数。季節や滞在日数の基準になる */
  initialElapsedDays: number
}

export type ParkMapHandle = {
  handleAction: (action: MenuAction) => void
  /** カメラを画面ピクセル単位で動かす(右スティック) */
  panCamera: (deltaX: number, deltaY: number) => void
  /** 現在の園の中身を書き出す。まだ読み込みが終わっていなければ null */
  snapshot: () => ParkSnapshot | null
  /** 撤去の確認に対する返事 */
  resolveRemoval: (confirmed: boolean) => void
}

type Attraction = (typeof attractions)[number]
type Shop = (typeof shops)[number]
type Facility = (typeof facilities)[number]
type GuestBank = { bank: number, frameWidth: number, frameHeight: number, anchorX: number, anchorY: number }
type Footprint = { width: number, height: number, constructionCost: number }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
type RoadBuildMode = 'path' | 'queue' | null
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
  availableCash,
  onAttractionPlaced,
  onAttractionPlacementCancelled,
  onAttractionAccessPlaced,
  onShopPlaced,
  onShopBuildStep,
  onShopComplete,
  onFacilityPlaced,
  onFacilityBuildStep,
  secondsPerDay,
  onAdmissionPaid,
  onGuestCountChange,
  onBuildMessage,
  onRemoveConfirm,
  mapBlocked,
  initialPark,
  initialElapsedDays,
}: Props, ref) {
  const host = useRef<HTMLDivElement>(null)
  // 再開データはマップを組み立てるときに 1 回だけ使う
  const initialParkData = useRef(initialPark)
  const initialDays = useRef(initialElapsedDays)
  const takeSnapshot = useRef<(() => ParkSnapshot) | null>(null)
  const initialSecondsPerDay = useRef(secondsPerDay)
  const phaserGame = useRef<Phaser.Game | null>(null)
  const attractionPlacedHandler = useRef(onAttractionPlaced)
  const attractionCancelledHandler = useRef(onAttractionPlacementCancelled)
  const attractionAccessPlacedHandler = useRef(onAttractionAccessPlaced)
  const shopPlacedHandler = useRef(onShopPlaced)
  const shopStepHandler = useRef(onShopBuildStep)
  const shopCompleteHandler = useRef(onShopComplete)
  const facilityPlacedHandler = useRef(onFacilityPlaced)
  const facilityStepHandler = useRef(onFacilityBuildStep)
  const admissionHandler = useRef(onAdmissionPaid)
  const guestCountHandler = useRef(onGuestCountChange)
  const buildMessageHandler = useRef(onBuildMessage)
  const removeConfirmHandler = useRef(onRemoveConfirm)
  const initialMapBlocked = useRef(mapBlocked)
  attractionPlacedHandler.current = onAttractionPlaced
  attractionCancelledHandler.current = onAttractionPlacementCancelled
  attractionAccessPlacedHandler.current = onAttractionAccessPlaced
  shopPlacedHandler.current = onShopPlaced
  shopStepHandler.current = onShopBuildStep
  shopCompleteHandler.current = onShopComplete
  facilityPlacedHandler.current = onFacilityPlaced
  facilityStepHandler.current = onFacilityBuildStep
  admissionHandler.current = onAdmissionPaid
  guestCountHandler.current = onGuestCountChange
  buildMessageHandler.current = onBuildMessage
  removeConfirmHandler.current = onRemoveConfirm

  useImperativeHandle(ref, () => ({
    handleAction(action) {
      phaserGame.current?.scene.getScene('park')?.events.emit('pan', action)
    },
    panCamera(deltaX, deltaY) {
      phaserGame.current?.scene.getScene('park')?.events.emit('camera-pan', deltaX, deltaY)
    },
    snapshot() {
      return takeSnapshot.current?.() ?? null
    },
    resolveRemoval(confirmed) {
      phaserGame.current?.scene.getScene('park')?.events.emit('resolve-removal', confirmed)
    },
  }), [])

  useEffect(() => {
    if (!host.current) return

    const { width: gridWidth, height: gridHeight, stepX, stepY, rowOffsetX, tileWidth } = game.park.mapGrid
    const padding = 80
    const worldWidth = (gridWidth - 1) * stepX + (gridHeight - 1) * rowOffsetX + tileWidth + padding * 2
    const worldHeight = gridHeight * stepY + padding * 2
    const point = (x: number, y: number) => ({ x: padding + x * stepX + y * rowOffsetX, y: padding + y * stepY })

    const peopleSetByCountry = guestSprites.peopleSetByCountry as Record<string, string>
    const peopleSet = (peopleSetByCountry[country.id] ?? 'A').toLowerCase()
    const guestBanks = (guestSprites.sets as Record<string, GuestBank[]>)[peopleSet] ?? []
    const guestBankById = new Map(guestBanks.map((bank) => [bank.bank, bank]))
    // 木・設備・階段・バスの絵柄は国ごとのシーナリー種で決まる
    const sceneryKind = (seasons.countryScenery as Record<string, number>)[country.id] ?? 0

    // 演算は画面の更新間隔と切り離し、この刻み幅で必要な回数だけ進める。
    // どの環境でも 1 回あたりの進む量が同じになり、毎秒の回数も一定になる
    const stepMs = 1000 / game.time.framesPerSecond
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
        attractions.forEach((attraction) => this.load.image(attraction.id, `${attraction.asset}?v=4`))
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
        }
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
        type PlacedShop = { shop: Shop, x: number, y: number, direction: number, image: Phaser.GameObjects.Image }
        const placedShops: PlacedShop[] = []
        let activeFacility = facilityBuild
        let facilityDirection = 0
        let facilityStep: 'body' | 'direction' = 'body'
        let pendingFacility: { x: number, y: number } | null = null
        let currentCash = availableCash
        let daysPerMs = gameDaysPerMs(initialSecondsPerDay.current)
        let confirmHeld = false
        let removeHeld = false
        // メニューや確認が開いている間はマップへのクリックを無視する
        let mapInteractive = !initialMapBlocked.current

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
        const layerDepth = {
          terrain: 0,
          road: 100_000,
          access: 200_000,
          facility: 300_000,
          overlay: 400_000,
        } as const
        type RenderLayer = keyof typeof layerDepth
        // 重ね順は下(y が大きい)ほど手前で、同じ行なら左(x が小さい)ほど手前
        const positionDepthAt = (x: number, y: number) => 10 + gridWidth * 7 + y * 200 - x * 7
        const renderDepthAt = (layer: RenderLayer, x: number, y: number) => layerDepth[layer] + positionDepthAt(x, y)
        const depthAt = (x: number, y: number) => -positionDepthAt(x, y)
        const queue = (key: string, x: number, y: number, depth = depthAt(x, y), offsetX = 0, offsetY = 0) => {
          commands.push({ key, x, y, depth, offsetX, offsetY, order })
          order += 1
        }
        const draw = (target: Phaser.GameObjects.RenderTexture, { key, x, y, offsetX = 0, offsetY = 0 }: DrawCommand) => {
          const position = point(x, y)
          if (seasonalKeys.has(key)) target.drawFrame(key, seasonVariant, position.x - offsetX, position.y - offsetY)
          else target.draw(key, position.x - offsetX, position.y - offsetY)
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

        for (let y = 0; y < gridHeight; y += 1) {
          for (let x = 0; x < gridWidth; x += 1) {
            const entranceTile = entranceTileKey(x, y)
            const isGateBarrierTile = y === gateRow + 5 && x === gateCenter
            if (!isGateBarrierTile) queue('ground-tile', x, y)
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
        queue('entrance-special-50', gateCenter, gateRow + 3, depthAt(gateCenter, gateRow + 3) - 1, -10, 8)
        queue('entrance-background-3', gateCenter, gateRow + 5, depthAt(gateCenter, gateRow + 5) + 7)

        commands.sort((a, b) => b.depth - a.depth || a.order - b.order)
        const fixedRoadKeys = new Set(['gate-base-2', 'gate-base-3', 'gate-base-6', 'gate-base-17', 'gate-base-19'])
        const isFacility = ({ key }: DrawCommand) => key.startsWith('border-') || (key.startsWith('gate-') && !fixedRoadKeys.has(key))
        const isAccess = ({ key }: DrawCommand) => key === 'entrance-special-50'
        const isTerrainForeground = (command: DrawCommand) => (
          command.key !== 'ground-tile'
          && !fixedRoadKeys.has(command.key)
          && !isFacility(command)
          && !isAccess(command)
        )
        const backgroundCommands = commands.filter((command) => !isFacility(command) && !isAccess(command) && !isTerrainForeground(command))
        const terrainForegroundCommands = commands.filter(isTerrainForeground)
        const facilityCommands = commands.filter(isFacility)
        const accessCommands = commands.filter(isAccess)
        const terrainForeground = this.add.renderTexture(0, 0, worldWidth, worldHeight).setOrigin(0).setDepth(0.5)
        const addStaticImage = (layer: RenderLayer, command: DrawCommand) => {
          const position = point(command.x, command.y)
          seasonFrame(
            this.add.image(position.x - (command.offsetX ?? 0), position.y - (command.offsetY ?? 0), command.key)
              .setOrigin(0)
              .setDepth(layerDepth[layer] - command.depth),
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
        accessCommands.forEach((command) => addStaticImage('access', command))
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
            if (placed.image.texture.key === form.id) return
            const position = attractionImagePosition(base, form.imageOffset, placed.x, placed.y + base.height - 1)
            placed.image.setTexture(form.id).setPosition(position.x, position.y)
          })
        }

        const roadFrameByMask = [16, 2, 4, 0, 3, 10, 11, 7, 5, 13, 12, 9, 1, 6, 8, 15]
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
        const roadImages = new Map<string, Phaser.GameObjects.Image>()
        const queueRoads = new Set<string>()
        const queueStates = new Map<string, number>()
        const queueRoadImages = new Map<string, Phaser.GameObjects.Image>()
        const occupiedByAttraction = new Set<string>()
        const placedAttractions: PlacedAttraction[] = []
        let pendingAttraction: PlacedAttraction | null = null
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
        // 設置できる範囲は敷地の x 範囲(外周ブロック除く)と、その下の園外(マップ下端手前まで)。
        // 上と左右は敷地の外に出ない
        const isBuildableTile = (x: number, y: number) => (
          x > left && x < right
          && y > top && y < gridHeight - 1
          && !isOuterEdge(x, y)
          && !isLockedEntranceTile(x, y)
          && !occupiedByAttraction.has(tileKey(x, y))
        )
        const hasRoadConnection = (x: number, y: number) => roads.has(tileKey(x, y)) || isLockedEntranceTile(x, y)
        const roadMaskAt = (x: number, y: number) => (
          (hasRoadConnection(x + 1, y) ? 1 : 0)
          | (hasRoadConnection(x - 1, y) ? 2 : 0)
          | (hasRoadConnection(x, y + 1) ? 4 : 0)
          | (hasRoadConnection(x, y - 1) ? 8 : 0)
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
            seasonFrame(image.setTexture(`road-frame-${roadFrameByMask[roadMaskAt(tileX, tileY)]}`)
              .setDepth(renderDepthAt('road', tileX, tileY)))
          })
        }
        const redrawQueueTiles = (x: number, y: number) => {
          const affectedTiles = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          affectedTiles.forEach(([tileX, tileY]) => {
            const key = tileKey(tileX, tileY)
            const currentImage = queueRoadImages.get(key)
            if (!queueRoads.has(key)) {
              currentImage?.destroy()
              queueRoadImages.delete(key)
              return
            }
            const frame = queueFrameByState[queueStates.get(key) ?? 0]
            const position = point(tileX, tileY)
            const image = currentImage ?? this.add.image(position.x, position.y, `queue-frame-${frame}`).setOrigin(0)
            if (!currentImage) queueRoadImages.set(key, image)
            seasonFrame(image.setTexture(`queue-frame-${frame}`).setPosition(position.x, position.y)
              .setDepth(renderDepthAt('road', tileX, tileY)))
          })
          updateAttractionEntranceFrames()
        }

        const cursorPosition = { x: gateLeft + 1, y: bottom - 1 }
        // 入口・出口を置いている間、カーソルが敷地のどの辺にいるか(向きもこれで決まる)
        let accessSide: AccessSide = 'bottom'
        const cursor = this.add.graphics().setDepth(layerDepth.overlay)
        const shopArrow = this.add.graphics().setDepth(layerDepth.overlay).setVisible(false)
        // 原作のポインタ。通常は矢印、設置操作中はシャベルに変わる
        const pointer = this.add.image(0, 0, 'pointer-arrow').setOrigin(0).setDepth(layerDepth.overlay)
        let attractionPreview: Phaser.GameObjects.Image | null = null
        let accessPreview: Phaser.GameObjects.Image | null = null
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
              if (roads.has(tileKey(tileX, tileY)) || queueRoads.has(tileKey(tileX, tileY))) return false
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
            return !(facility.entrance?.x === drawn.x && facility.entrance.y === drawn.y)
          }
          if (x <= left || x >= right || y <= top || y >= bottom) return false
          if (roads.has(tileKey(x, y)) || queueRoads.has(tileKey(x, y))) return false
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
        )
        const canPlacePath = canPlaceRoad
        const canPlaceQueue = canPlaceRoad
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
        type PlacedFacility = { facility: Facility, frame: number, image: Phaser.GameObjects.Image }
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
          (isFenceAt(x + 1, y) ? 1 : 0)
          | (isFenceAt(x - 1, y) ? 2 : 0)
          | (isFenceAt(x, y + 1) ? 4 : 0)
          | (isFenceAt(x, y - 1) ? 8 : 0)
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
        }
        const removeFacility = (x: number, y: number) => {
          const placed = facilityAt(x, y)
          if (!placed) return
          placed.image.destroy()
          placedFacilities.delete(tileKey(x, y))
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
          placedFacilities.set(tileKey(x, y), { facility, frame, image })
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
          const placingAccess = attraction && activeAttractionBuildStep !== 'body'
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
            ? { key: attractionForm(attraction).id, offset: attractionForm(attraction).imageOffset }
            : placingShopBody
              ? { key: `shop-${shop.id}-${shopDirection}`, offset: shop.imageOffsets[shopDirection] }
              : placingFacility
                ? {
                  key: facilityTexture(placingFacility, facilityFrame),
                  offset: facilityOffsets(placingFacility)[facilityFrame] ?? facilityOffsets(placingFacility)[0],
                }
                : null
          const attractionOrigin = footprint ? attractionOriginAtCursor(footprint) : null
          const valid = placingFacility
            ? canPlaceFacility(placingFacility, cursorPosition.x, cursorPosition.y)
            : footprint && attractionOrigin
              ? canPlaceAttraction(footprint, attractionOrigin.x, attractionOrigin.y)
              : placingAccess
                ? canPlaceAccess(cursorPosition.x, cursorPosition.y)
                : activeRoadBuildMode === 'path'
                  ? canPlacePath(cursorPosition.x, cursorPosition.y)
                  : activeRoadBuildMode === 'queue'
                    ? canPlaceQueue(cursorPosition.x, cursorPosition.y)
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
                  .setDepth(renderDepthAt('terrain', attractionOrigin.x + offsetX, attractionOrigin.y - offsetY))
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
          // ポインタはメニューやダイアログが開いている間は隠す(原作のフラグ 0x8000 相当)
          const pointerConfig = activeRoadBuildMode || attraction || shop || activeFacility
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
        }
        const placeCursor = (x: number, y: number) => {
          // カーソルは敷地の x 範囲内、上は敷地の上端、下は園外を経てマップ下端手前まで
          cursorPosition.x = Phaser.Math.Clamp(x, left, right)
          cursorPosition.y = Phaser.Math.Clamp(y, top, gridHeight - 2)
          const position = point(cursorPosition.x, cursorPosition.y)
          cursor.setPosition(position.x, position.y)
          drawCursor()
        }
        placeCursor(cursorPosition.x, cursorPosition.y)

        const camera = this.cameras.main
        // カメラの追従範囲。下は園外の設置範囲までカバーする
        const cameraTopRow = top - game.park.cameraMarginTiles.top
        const cameraBottomRow = gridHeight - 2
        const focus = point(gateCenter, gateRow + 1)
        const cameraTopLeft = point(left, cameraTopRow)
        const cameraBottomRight = point(right, cameraBottomRow)
        camera
          .setZoom(game.park.displayScale)
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
            gridHeight - 2,
          )
          placeCursor(nextX, nextY)
          keepCursorVisible(direction === 'left' || direction === 'right' ? 'x' : 'y')
        }
        const placeRoad = () => {
          const { x, y } = cursorPosition
          const key = tileKey(x, y)
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
              const depth = renderDepthAt('terrain', x + offsetX, y + offsetY)
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
            terrainObjects.stairs[sceneryKind].forEach((offset, index) => {
              const tileY = centerY - index
              const tile = point(centerX, tileY)
              baseImages.push(
                this.add.image(tile.x - offset.x, tile.y - offset.y, `terrain-stairs-${index}-s${seasonIndex}`)
                  .setOrigin(0).setDepth(renderDepthAt('facility', centerX, tileY)),
              )
            })
          }
          const form = attractionForm(attraction)
          const imagePosition = attractionImagePosition(attraction, form.imageOffset, bottomX, bottomY)
          const image = this.add.image(imagePosition.x, imagePosition.y, form.id)
            .setOrigin(0).setDepth(renderDepthAt('facility', bottomX, bottomY))
          const placed: PlacedAttraction = {
            id: attraction.id,
            x,
            y,
            width: attraction.width,
            height: attraction.height,
            cost: attraction.constructionCost,
            image,
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
        // 向きが確定したショップを記録し、前の道を敷く
        const completeShop = (shop: Shop, x: number, y: number, direction: number, image: Phaser.GameObjects.Image) => {
          placedShops.push({ shop, x, y, direction, image })
          layShopWalkway(shop, x, y, direction)
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
            // 入口・出口は設備や建物と同じ扱い。前後は位置だけで決まる
            .setDepth(renderDepthAt('facility', drawn.x, drawn.y)))
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
            attractionAccessPlacedHandler.current('exit')
          }
          drawCursor()
        }
        const removeRoad = () => {
          if (!isBuildableTile(cursorPosition.x, cursorPosition.y)) return
          const key = tileKey(cursorPosition.x, cursorPosition.y)
          // ショップ前の道はショップの敷地なので、道路の撤去では消せない
          if (shopRoads.has(key)) return
          if (roads.delete(key)) {
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
          markFootprint(placed, false)
          if (placed.entrance) occupiedByAttraction.delete(tileKey(placed.entrance.x, placed.entrance.y))
          placed.image.destroy()
          placed.baseImages.forEach((image) => image.destroy())
          placed.entrance?.image.destroy()
          placed.exit?.image.destroy()
          // 入口につながっていた整列歩道は行き先を失うので描き直す
          if (placed.entrance) redrawQueueTiles(placed.entrance.x, placed.entrance.y)
          drawCursor()
        }
        const removeShop = (placed: PlacedShop) => {
          const index = placedShops.indexOf(placed)
          if (index >= 0) placedShops.splice(index, 1)
          const { shop, x, y } = placed
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
          })
          removed.forEach(([roadX, roadY]) => {
            redrawRoadTiles(roadX, roadY)
            redrawQueueTiles(roadX, roadY)
          })
          drawCursor()
        }
        // 確認待ちの撤去対象。返事が来るまで保持する
        let pendingRemoval: (() => void) | null = null
        const removeAtCursor = () => {
          const { x, y } = cursorPosition
          // 設置モード中は同じ系統のものだけ撤去できる。何のモードでもなければどちらも撤去できる
          const buildingMode = Boolean(activeAttraction || activeShop)
          const groundMode = Boolean(activeRoadBuildMode || activeFacility)
          if (!buildingMode) {
            removeRoad()
            removeFacilityAtCursor()
          }
          if (groundMode || pendingRemoval) return
          // 確認を出したら押しっぱなし扱いは解除する。返事のあと勝手に続きが消えないように
          const askRemoval = (remove: () => void, name: string) => {
            pendingRemoval = remove
            removeHeld = false
            removeConfirmHandler.current(name)
          }
          const attraction = attractionCoveringTile(x, y)
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
        const isGroundBuild = () => Boolean(activeRoadBuildMode || (activeFacility && facilityStep === 'body'))
        // カーソル位置に今のモードのものを置く
        const placeAtCursor = () => {
          if (activeRoadBuildMode) placeRoad()
          else if (activeFacility) facilityStep === 'direction' ? finishFacilityDirection() : placeFacility()
          else if (activeShop) shopStep === 'direction' ? confirmShopDirection() : placeShop()
          else if (activeAttraction) {
            if (activeAttractionBuildStep === 'body') placeAttraction()
            else placeAttractionAccess()
          }
        }
        const selectTileAtPointer = (pointer: Phaser.Input.Pointer) => {
          const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
          const y = Math.floor((world.y - padding) / stepY)
          const localY = world.y - padding - y * stepY
          const x = Math.floor((world.x - padding - y * rowOffsetX - Math.floor(localY / 2)) / stepX)
          if (x < left || x > right || y < top || y >= gridHeight - 1) return false
          // 入口・出口を置いている間は敷地の縁から離れられない
          if (pendingAttraction && activeAttractionBuildStep !== 'body') snapAccessCursor(x, y)
          else placeCursor(x, y)
          return true
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
        let middlePanPreviousX = 0
        let middlePanPreviousY = 0
        let middlePanning = false
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button !== 1) return
          middlePanning = true
          middlePanPreviousX = pointer.x
          middlePanPreviousY = pointer.y
        })
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
          if (middlePanning && pointer.buttons & 4) {
            // 中ドラッグでカメラ移動。マップを掴んで引っ張る方向感覚
            camera.scrollX -= (pointer.x - middlePanPreviousX) / camera.zoom
            camera.scrollY -= (pointer.y - middlePanPreviousY) / camera.zoom
            middlePanPreviousX = pointer.x
            middlePanPreviousY = pointer.y
            clampCameraToMap()
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
          const moved = selectTileAtPointer(pointer)
          if (!moved || !pointer.isDown) return
          // 左ドラッグはボタンの押しっぱなしと同じ扱い
          if (pointer.button === 0 && isGroundBuild()) placeAtCursor()
        })
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button === 1) {
            middlePanning = false
            return
          }
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
          else if (selectTileAtPointer(pointer)) placeAtCursor()
        })
        this.input.on('wheel', (
          _pointer: Phaser.Input.Pointer,
          _gameObjects: Phaser.GameObjects.GameObject[],
          _deltaX: number,
          deltaY: number,
        ) => changeZoom(deltaY > 0 ? -game.park.zoomStep : game.park.zoomStep))
        // 右スティックのカメラ移動。ズームに依らず画面上の速さが一定になるよう zoom で割る
        this.events.on('camera-pan', (deltaX: number, deltaY: number) => {
          camera.scrollX += deltaX / camera.zoom
          camera.scrollY += deltaY / camera.zoom
          clampCameraToMap()
        })
        this.events.on('pan', (direction: MenuAction) => {
          if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') {
            if (activeShop && shopStep === 'direction') setShopDirection(directionByPad[direction])
            else if (activeFacility && facilityStep === 'direction') setFacilityDirection(directionByPad[direction])
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
        this.events.on('available-cash', (cash: number) => {
          currentCash = cash
          drawCursor()
        })
        this.events.on('seconds-per-day', (value: number) => { daysPerMs = gameDaysPerMs(value) })
        this.events.on('resolve-removal', resolveRemoval)
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
          queues: [...queueStates].map(([key, state]) => ({ key, state })),
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
            })),
          shops: placedShops.map(({ shop, x, y, direction }) => ({ id: shop.id, x, y, direction })),
          facilities: [...placedFacilities].map(([key, placed]) => ({
            id: placed.facility.id,
            ...parseKey(key),
            frame: placed.frame,
          })),
          buildings: [...placedBuildings],
        })
        // セーブデータから園を組み立て直す。道の絵は全部そろえてから一度に描き直す
        const restoreSnapshot = (snapshot: ParkSnapshot) => {
          // 道と整列歩道を先に並べる。ショップの前の道を敷く処理が入口の向きを見に来るので、
          // 整列歩道がそろう前に見られると入口のつなぎ先が失われる
          snapshot.roads.forEach((key) => roads.add(key))
          snapshot.queues.forEach(({ key, state }) => {
            queueRoads.add(key)
            queueStates.set(key, state)
          })
          snapshot.facilities.forEach(({ id, x, y, frame }) => {
            const facility = facilities.find((entry) => entry.id === id)
            if (facility) addFacility(facility, frame, x, y)
          })
          snapshot.buildings.forEach((id) => placedBuildings.add(id))
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
          })
          snapshot.shops.forEach(({ id, x, y, direction }) => {
            const shop = shops.find((entry) => entry.id === id)
            if (!shop) return
            completeShop(shop, x, y, direction, addShopBody(shop, x, y, direction))
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
        type GuestPhase = 'walking' | 'queued' | 'toSign' | 'toBus'
        type Guest = {
          type: number
          bank: GuestBank
          // 1 日あたり何マス歩くか。種類ごとの設定値をそのまま持つ
          tilesPerDay: number
          phase: GuestPhase
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
          facing: number
          walked: number
          paid: boolean
          leaveAtDay: number
          image: Phaser.GameObjects.Sprite
        }
        const guests: Guest[] = []
        // セーブから再開したときは経過日数も引き継ぐ(季節や滞在日数の基準になる)
        let elapsedDays = initialDays.current

        const guestNeighbours = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
        const wideAreaCorners = [[0, 0], [-1, 0], [0, -1], [-1, -1]]
        type Walkable = (x: number, y: number) => boolean
        // 入園済み(paid)で帰宅中でない客は、ゲート構造にも看板マスにも戻らない。
        // ショップ前の道はそのショップを利用する客だけが入るので、ここでは歩ける場所に含めない
        const walkableFor = (guest: Guest, leaving: boolean): Walkable => {
          const allowGate = !guest.paid || leaving
          return (x, y) => {
            const key = tileKey(x, y)
            return (
              (roads.has(key) && !shopRoads.has(key))
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

        // 待ち行列は看板マスを空け、左右の列が 1 マス目から 0.5 マス間隔で外へ広がる。
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
          if (guest.phase === 'toBus') return { x: busStop.x, y: busStop.y + 1 }
          if (guest.phase === 'toSign') return { x: busStop.x, y: busStop.y }
          // 同じ側で自分より先に並んだ人数だけ外側へ
          let rank = 0
          for (const other of waitingGuests) {
            if (other === guest) break
            if (other.queueSide === guest.queueSide) rank += 1
          }
          const x = busStop.x + guest.queueSide * (rank * 0.5 + 1)
          return { x: Math.min(right, Math.max(left, x)), y: busStop.y }
        }

        const drawGuest = (guest: Guest, x: number, y: number, tileX: number, tileY: number) => {
          const position = point(x + 0.4, y + 0.52)
          guest.image.setFrame(guest.facing * 4 + (Math.floor(guest.walked * 4) % 4))
            .setPosition(position.x - guest.bank.anchorX, position.y - guest.bank.anchorY)
            .setDepth(renderDepthAt('facility', tileX, tileY))
        }
        const placeGuestImage = (guest: Guest) => {
          if (guest.phase !== 'walking') {
            drawGuest(guest, guest.queueX, guest.queueY, Math.round(guest.queueX), Math.round(guest.queueY))
            return
          }
          // point は x・y に対して線形なので、マス座標で補間してから投影してよい
          const x = guest.fromX + (guest.toX - guest.fromX) * guest.progress
          const y = guest.fromY + (guest.toY - guest.fromY) * guest.progress
          const leading = guest.progress < 0.5
          drawGuest(guest, x, y, leading ? guest.fromX : guest.toX, leading ? guest.fromY : guest.toY)
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
            .filter(({ x, y }) => walkable(x, y))
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

        const spawnGuest = () => {
          if (guests.length >= game.park.visitorLimit) return false
          const type = Math.floor(Math.random() * guestConfig.types.length)
          const banks = guestConfig.types[type].banks.filter((id) => guestBankById.has(id))
          if (banks.length === 0) return false
          const bank = guestBankById.get(banks[Math.floor(Math.random() * banks.length)])!
          const guest: Guest = {
            type,
            bank,
            tilesPerDay: guestConfig.types[type].tilesPerDay,
            phase: 'walking',
            fromX: gateCrossing.x,
            fromY: gateCrossing.y,
            toX: gateCrossing.x,
            toY: gateCrossing.y,
            // 1 にしておくと次の更新で即座に進む先を選ぶ
            progress: 1,
            previousX: gateCrossing.x,
            previousY: gateCrossing.y,
            queueX: gateCrossing.x,
            queueY: gateCrossing.y,
            queueSide: 1,
            facing: 0,
            walked: 0,
            paid: false,
            leaveAtDay: elapsedDays + guestConfig.stayDays,
            image: this.add.sprite(0, 0, `guest-${bank.bank}`).setOrigin(0, 0),
          }
          guests.push(guest)
          placeGuestImage(guest)
          return true
        }
        const removeGuest = (index: number) => {
          leaveQueue(guests[index])
          guests[index].image.destroy()
          guests.splice(index, 1)
        }

        // マス目を歩く客を 1 フレーム分進める
        const updateWalkingGuest = (guest: Guest, step: number) => {
          const leaving = elapsedDays >= guest.leaveAtDay
          guest.walked += step
          guest.progress += step
          while (guest.progress >= 1) {
            guest.progress -= 1
            guest.previousX = guest.fromX
            guest.previousY = guest.fromY
            guest.fromX = guest.toX
            guest.fromY = guest.toY
            // 敷地内に道路が敷かれ、実際にそこへ足を踏み入れた時点で入場料を払う
            if (!guest.paid && roads.has(tileKey(guest.fromX, guest.fromY))) {
              guest.paid = true
              admissionHandler.current(guestConfig.admissionFee)
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
            const next = chooseGuestStep(guest, leaving)
            if (!next) {
              guest.progress = 0
              break
            }
            guest.toX = next.x
            guest.toY = next.y
          }
          guest.facing = directionOf(guest.toX - guest.fromX, guest.toY - guest.fromY)
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
          if (guest.phase === 'toBus') return true
          if (guest.phase === 'toSign') {
            // 看板の中心に着いたら下を向き、そのまま 1 マス進んでバスに乗る
            guest.phase = 'toBus'
            guest.facing = 0
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
          const position = point(current.x, busRow)
          const baseX = position.x + busConfig.anchor.x
          const baseY = position.y + busConfig.anchor.y
          const column = Math.round(current.x)
          const depth = renderDepthAt('facility', column, busRow)
          current.images.forEach((image, index) => {
            const { part, slotX } = busParts[index]
            image.setPosition(baseX + slotX - busOffsets[part].x, baseY - busOffsets[part].y).setDepth(depth)
          })
          // 乗車率のバーは車体の中央下に置く
          const leftEdge = Math.min(...busParts.map(({ part, slotX }) => slotX - busOffsets[part].x))
          const rightEdge = Math.max(...busParts.map(({ part, slotX }, index) => slotX - busOffsets[part].x + current.images[index].width))
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
          const days = deltaMs * daysPerMs
          if (days <= 0) return
          elapsedDays += days
          const season = seasonAt(elapsedDays)
          if (season !== seasonIndex) {
            seasonIndex = season
            seasonVariant = seasons.variantBySeason[season]
            applySeason()
          }
          // 前のバスが去ってから次の間隔で、右手からバスが入ってくる
          if (!bus) {
            busTimerDays += days
            if (busTimerDays >= busConfig.intervalDays) {
              busTimerDays = 0
              spawnBus()
            }
          }
          updateBus(days)

          for (let index = guests.length - 1; index >= 0; index -= 1) {
            const guest = guests[index]
            if (guest.phase === 'walking') updateWalkingGuest(guest, guest.tilesPerDay * days)
            else if (updateQueuedGuest(guest, days)) {
              removeGuest(index)
              continue
            }
            placeGuestImage(guest)
          }
          if (guests.length !== reportedGuestCount) {
            reportedGuestCount = guests.length
            guestCountHandler.current(guests.length)
          }
        }
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

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
})

export default ParkMap
