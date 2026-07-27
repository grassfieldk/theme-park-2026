import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import Phaser from 'phaser'
import attractions from '../config/attractions.json'
import shops from '../config/shops.json'
import facilities from '../config/facilities.json'
import game from '../config/game.json'
import type { MenuAction } from './GamepadController'
import guestSprites from '../config/guestSprites.json'
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
  /** セーブデータから再開するときの園の中身。新規開始なら null */
  initialPark: ParkSnapshot | null
}

export type ParkMapHandle = {
  handleAction: (action: MenuAction) => void
  /** 現在の園の中身を書き出す。まだ読み込みが終わっていなければ null */
  snapshot: () => ParkSnapshot | null
}

type Attraction = (typeof attractions)[number]
type Shop = (typeof shops)[number]
type Facility = (typeof facilities)[number]
type GuestBank = { bank: number, frameWidth: number, frameHeight: number, anchorX: number, anchorY: number }
type Footprint = { width: number, height: number, constructionCost: number }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
type RoadBuildMode = 'path' | 'queue' | null
type AccessPoint = { x: number, y: number, image: Phaser.GameObjects.Image }
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
  initialPark,
}: Props, ref) {
  const host = useRef<HTMLDivElement>(null)
  // 再開データはマップを組み立てるときに 1 回だけ使う
  const initialParkData = useRef(initialPark)
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

  useImperativeHandle(ref, () => ({
    handleAction(action) {
      phaserGame.current?.scene.getScene('park')?.events.emit('pan', action)
    },
    snapshot() {
      return takeSnapshot.current?.() ?? null
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
        facilities.forEach((facility) => {
          for (let frame = 0; frame < facility.frames; frame += 1) {
            this.load.image(`facility-${facility.id}-${frame}`, `${facility.assetBase}-${frame}.png`)
          }
        })
        // 来園者は国ごとの PEOPLE セットを使う。1 枚に 4 方向 × 4 コマ
        guestBanks.forEach((bank) => {
          this.load.spritesheet(`guest-${bank.bank}`, `/assets/park/guests/${peopleSet}-${bank.bank}.png`, {
            frameWidth: bank.frameWidth,
            frameHeight: bank.frameHeight,
          })
        })
        for (let index = 0; index < 13; index += 1) {
          this.load.image(`build-base-frame-${index}`, `/assets/park/build-base-frame-${index}.png`)
        }
        for (let index = 0; index < 4; index += 1) {
          this.load.image(`facility-entrance-frame-${index}`, `/assets/park/facility-entrance-frame-${index}.png`)
          this.load.image(`facility-exit-frame-${index}`, `/assets/park/facility-exit-frame-${index}.png`)
        }
        for (let index = 0; index < 17; index += 1) {
          this.load.image(`road-frame-${index}`, `/assets/park/road-frame-${index}.png`)
        }
        for (let index = 0; index < 14; index += 1) {
          this.load.image(`queue-frame-${index}`, `/assets/park/queue-frame-${index}.png?v=6`)
        }
        this.load.image('ground-tile', '/assets/park/ground-tile.png')
        this.load.image('gate-base-2', '/assets/park/gate-base-2.png')
        this.load.image('gate-base-3', '/assets/park/gate-base-3.png')
        this.load.image('gate-base-6', '/assets/park/gate-base-6.png')
        this.load.image('gate-base-17', '/assets/park/gate-base-17.png')
        this.load.image('gate-base-19', '/assets/park/gate-base-19.png')
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
        this.load.image('entrance-background-1', '/assets/park/entrance-background-1.png')
        this.load.image('entrance-background-2', '/assets/park/entrance-background-2.png')
        this.load.image('entrance-background-3', '/assets/park/entrance-background-3.png')
        this.load.image('entrance-background-4', '/assets/park/entrance-background-4.png')
        this.load.image('entrance-special-49', '/assets/park/entrance-special-49.png')
        this.load.image('entrance-special-50', '/assets/park/entrance-special-50.png')
      }

      create() {
        let activeRoadBuildMode = roadBuildMode
        let activeAttraction = attractionBuild
        let activeAttractionBuildStep = attractionBuildStep
        let activeShop = shopBuild
        let shopDirection = 0
        let shopStep: 'body' | 'direction' = 'body'
        type PendingShop = { x: number, y: number, cost: number, image: Phaser.GameObjects.Image, baseImages: Phaser.GameObjects.Image[] }
        let pendingShop: PendingShop | null = null
        // 設置済みのショップ。向きが決まった時点で記録する
        const placedShops: Array<{ id: string, x: number, y: number, direction: number }> = []
        let activeFacility = facilityBuild
        let facilityDirection = 0
        let facilityStep: 'body' | 'direction' = 'body'
        let pendingFacility: { x: number, y: number } | null = null
        let currentCash = availableCash
        let daysPerMs = gameDaysPerMs(initialSecondsPerDay.current)
        let confirmHeld = false
        const ground = this.add.renderTexture(0, 0, worldWidth, worldHeight).setOrigin(0)
        const { x: left, y: top, width, height } = country.map
        const right = left + width - 1
        const bottom = top + height - 1
        const gateLeft = left + (width - 5) / 2
        const gateRow = top + height
        const gateCenter = left + Math.floor(width / 2)
        const buildableBottom = bottom + game.park.frontBuildableRows
        const selectionBottom = bottom + game.park.frontSelectableRows
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
          target.draw(key, position.x - offsetX, position.y - offsetY)
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
          this.add.image(position.x - (command.offsetX ?? 0), position.y - (command.offsetY ?? 0), command.key)
            .setOrigin(0)
            .setDepth(layerDepth[layer] - command.depth)
        }
        backgroundCommands.forEach((command) => draw(ground, command))
        terrainForegroundCommands.forEach((command) => draw(terrainForeground, command))
        facilityCommands.forEach((command) => addStaticImage('facility', command))
        accessCommands.forEach((command) => addStaticImage('access', command))

        const roadFrameByMask = [16, 2, 4, 0, 3, 10, 11, 7, 5, 13, 12, 9, 1, 6, 8, 15]
        const queueStateByMask = [0, 9, 10, 1, 7, 3, 4, 1, 8, 6, 5, 1, 2, 2, 2, 2]
        const queueMaskByState = [0, 3, 12, 5, 6, 10, 9, 4, 8, 1, 2, 0, 0]
        const queueFrameByState = [13, 0, 1, 2, 3, 4, 5, 1, 1, 0, 0, 0, 6]
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
        const isLockedEntranceTile = (x: number, y: number) => (
          (y === bottom && (x === gateLeft + 1 || x === gateLeft + 3))
          || ((y === gateRow || y === gateRow + 1) && (x === gateLeft + 1 || x === gateLeft + 3))
          || (y === gateRow + 2 && x >= gateLeft + 1 && x <= gateLeft + 3)
        )
        const isBuildableTile = (x: number, y: number) => (
          x > left && x < right
          && ((y > top && y < bottom) || (y === bottom && x === gateCenter) || (y > bottom && y <= buildableBottom))
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
            return facility.entranceFrame ?? 0
          }
          facility.entranceQueueKey = undefined
          facility.entranceFrame = undefined
          if (entrance.x < facility.x) return entranceFrameForSide.left
          if (entrance.x >= facility.x + facility.width) return entranceFrameForSide.right
          if (entrance.y < facility.y) return entranceFrameForSide.top
          return entranceFrameForSide.bottom
        }
        const updateAttractionEntranceFrames = () => {
          placedAttractions.forEach((facility) => {
            facility.entrance?.image.setTexture(`facility-entrance-frame-${entranceFrameAt(facility)}`)
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
            image.setTexture(`road-frame-${roadFrameByMask[roadMaskAt(tileX, tileY)]}`)
              .setDepth(renderDepthAt('road', tileX, tileY))
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
            image.setTexture(`queue-frame-${frame}`).setPosition(position.x, position.y)
              .setDepth(renderDepthAt('road', tileX, tileY))
          })
          updateAttractionEntranceFrames()
        }

        const cursorPosition = { x: gateLeft + 1, y: bottom - 1 }
        const cursor = this.add.graphics().setDepth(layerDepth.overlay)
        const shopArrow = this.add.graphics().setDepth(layerDepth.overlay).setVisible(false)
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
              if (tileX <= left || tileX >= right || tileY <= top || tileY >= bottom) return false
              if (roads.has(tileKey(tileX, tileY)) || queueRoads.has(tileKey(tileX, tileY)) || occupiedByAttraction.has(tileKey(tileX, tileY))) return false
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
        const accessSideAt = (facility: PlacedAttraction, x: number, y: number) => {
          const leftEdge = facility.x - 1
          const rightEdge = facility.x + facility.width
          const topEdge = facility.y - 1
          const bottomEdge = facility.y + facility.height
          const onLeft = x === leftEdge && y >= facility.y && y < facility.y + facility.height
          const onRight = x === rightEdge && y >= facility.y && y < facility.y + facility.height
          const onTop = y === topEdge && x >= facility.x && x < facility.x + facility.width
          const onBottom = y === bottomEdge && x >= facility.x && x < facility.x + facility.width
          if (onLeft) return 'left'
          if (onRight) return 'right'
          if (onTop) return 'top'
          if (onBottom) return 'bottom'
          return null
        }
        const accessFrameAt = (facility: PlacedAttraction, x: number, y: number) => {
          const side = accessSideAt(facility, x, y)
          if (!side) return -1
          return entranceFrameForSide[side]
        }
        const accessOffsetAt = (step: Exclude<AttractionBuildStep, 'body'>, frame: number) => {
          const offsets = step === 'entrance'
            ? [[-2, 0], [-2, 0], [-1, 0], [-1, 0]]
            : [[0, -8], [12, 16], [24, -1], [-3, 4]]
          return offsets[frame] ?? [0, 0]
        }
        const canPlaceAccess = (x: number, y: number) => {
          const facility = pendingAttraction
          if (!facility || !accessSideAt(facility, x, y)) return false
          if (x <= left || x >= right || y <= top || y >= bottom) return false
          if (roads.has(tileKey(x, y)) || queueRoads.has(tileKey(x, y))) return false
          if (occupiedByAttraction.has(tileKey(x, y))) return false
          if (facility.entrance?.x === x && facility.entrance.y === y) return false
          return true
        }
        const attractionAccessAt = (x: number, y: number) => placedAttractions.some((attraction) => (
          (attraction.entrance?.x === x && attraction.entrance.y === y)
          || (attraction.exit?.x === x && attraction.exit.y === y)
        ))
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
        const canPlaceRoad = (x: number, y: number) => (
          isBuildableTile(x, y)
          && !roads.has(tileKey(x, y))
          && !queueRoads.has(tileKey(x, y))
          && !attractionAccessAt(x, y)
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
        // 設備スプライトは footprint の前(下)タイルを基準にする。原作のオブジェクトセルが
        // ここに当たり、imageOffsets はそのセルからの相対で抽出している。中心合わせにすると
        // 2×2 以上で右上へずれるので point(x, y) をそのまま基準にする
        const facilityImagePosition = (facility: Facility, frame: number, x: number, y: number) => {
          const offset = facility.imageOffsets[frame] ?? facility.imageOffsets[0]
          const base = point(x, y)
          return { x: base.x - offset.x, y: base.y - offset.y }
        }
        const setFacilityFrame = (x: number, y: number, frame: number) => {
          const placed = facilityAt(x, y)
          if (!placed || frame < 0 || frame === placed.frame) return
          placed.frame = frame
          const position = facilityImagePosition(placed.facility, frame, x, y)
          placed.image.setTexture(`facility-${placed.facility.id}-${frame}`).setPosition(position.x, position.y)
        }
        const removeFacility = (x: number, y: number) => {
          const placed = facilityAt(x, y)
          if (!placed) return
          placed.image.destroy()
          placedFacilities.delete(tileKey(x, y))
          for (let offsetY = 0; offsetY < placed.facility.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < placed.facility.width; offsetX += 1) {
              occupiedByAttraction.delete(tileKey(x + offsetX, y - offsetY))
            }
          }
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
          return canPlaceAttraction(facilityFootprint(facility), x, y)
        }
        const addFacility = (facility: Facility, frame: number, x: number, y: number) => {
          for (let offsetY = 0; offsetY < facility.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < facility.width; offsetX += 1) {
              occupiedByAttraction.add(tileKey(x + offsetX, y - offsetY))
            }
          }
          const position = facilityImagePosition(facility, frame, x, y)
          const image = this.add.image(position.x, position.y, `facility-${facility.id}-${frame}`).setOrigin(0)
            .setDepth(renderDepthAt('facility', x, y))
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
        // 向きを選ぶ設備はショップと同じ手順。向き番号とタイル方向の対応もショップに合わせる
        const facilityDirectionStep = (direction: number) => (
          { 0: { x: 0, y: 1 }, 1: { x: 0, y: -1 }, 2: { x: -1, y: 0 }, 3: { x: 1, y: 0 } }[direction] ?? { x: 0, y: 1 }
        )
        const drawFacilityArrow = () => {
          const facility = activeFacility
          shopArrow.clear()
          if (facilityStep !== 'direction' || !pendingFacility || !facility) {
            shopArrow.setVisible(false)
            return
          }
          const step = facilityDirectionStep(facilityDirection)
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
            const step = facilityDirectionStep(direction)
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
        const isPaintFacility = (facility: Facility | null) => (
          facility !== null && (facility.placement === 'fence' || facility.placement === 'pond')
        )
        const cancelFacilityDirection = () => {
          if (facilityStep !== 'direction' || !pendingFacility || !activeFacility) return
          removeFacility(pendingFacility.x, pendingFacility.y)
          // 向き選択を取り消したら設置費を払い戻す(ショップと同じ)
          currentCash += activeFacility.constructionCost
          attractionCancelledHandler.current(activeFacility.constructionCost)
          finishFacilityDirection()
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
            ? { key: attraction.id, offset: attraction.imageOffset }
            : placingShopBody
              ? { key: `shop-${shop.id}-${shopDirection}`, offset: shop.imageOffsets[shopDirection] }
              : placingFacility
                ? {
                  key: `facility-${placingFacility.id}-${facilityFrame}`,
                  offset: placingFacility.imageOffsets[facilityFrame] ?? placingFacility.imageOffsets[0],
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
          const cursorAreaOrigin = attractionOrigin ?? cursorPosition
          for (let offsetY = 0; offsetY < height; offsetY += 1) {
            for (let offsetX = 0; offsetX < width; offsetX += 1) {
              const tile = point(cursorAreaOrigin.x + offsetX, cursorAreaOrigin.y - offsetY)
              const origin = point(cursorPosition.x, cursorPosition.y)
              const translated = cursorShape.map(({ x, y }) => new Phaser.Geom.Point(tile.x - origin.x + x, tile.y - origin.y + y))
              cursor.fillPoints(translated, true)
              cursor.strokePoints(translated, true)
            }
          }
          buildBasePreview.forEach((image) => image.setVisible(false))
          // 盛り上げベースのプレビューはアトラクションのみ(ショップ・施設は不要)
          if (placingBody && footprint && attractionOrigin) {
            let previewIndex = 0
            for (let offsetY = 0; offsetY < footprint.height; offsetY += 1) {
              for (let offsetX = 0; offsetX < footprint.width; offsetX += 1) {
                const key = `build-base-frame-${buildBaseFrameAt(offsetX, footprint.height - offsetY - 1, footprint.width, footprint.height)}`
                const image = buildBasePreview[previewIndex] ?? this.add.image(0, 0, key).setOrigin(0)
                if (!buildBasePreview[previewIndex]) buildBasePreview.push(image)
                const tile = point(attractionOrigin.x + offsetX, attractionOrigin.y - offsetY)
                image.setTexture(key).setPosition(tile.x, tile.y).setVisible(true)
                  .setDepth(renderDepthAt('terrain', attractionOrigin.x + offsetX, attractionOrigin.y - offsetY))
                  .setAlpha(valid ? 1 : 0.55).setTint(valid ? 0xffffff : 0xff6048)
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
            // 設備は placeFacility と同じ前タイル基準、アトラクション/ショップは中心基準
            const position = placingFacility
              ? facilityImagePosition(placingFacility, facilityFrame, attractionOrigin.x, attractionOrigin.y)
              : attractionImagePosition(footprint, previewImage.offset, attractionOrigin.x, attractionOrigin.y)
            attractionPreview.setPosition(position.x, position.y).setVisible(true)
              .setDepth(renderDepthAt('facility', attractionOrigin.x, attractionOrigin.y))
              .setAlpha(valid ? 0.7 : 0.4).setTint(valid ? 0xffffff : 0xff6048)
          }
          accessPreview?.setVisible(false)
          if (placingAccess && pendingAttraction) {
            const accessStep = activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit'
            const frame = accessFrameAt(pendingAttraction, cursorPosition.x, cursorPosition.y)
            const key = `facility-${accessStep}-frame-${Math.max(0, frame)}`
            if (!accessPreview) accessPreview = this.add.image(0, 0, key).setOrigin(0)
            const tile = point(cursorPosition.x, cursorPosition.y)
            const [offsetX, offsetY] = accessStep === 'entrance'
              ? [tileWidth / 2, stepY]
              : accessOffsetAt(accessStep, frame)
            accessPreview.setTexture(key).setOrigin(accessStep === 'entrance' ? 0.5 : 0, accessStep === 'entrance' ? 1 : 0)
              .setPosition(tile.x + offsetX, tile.y + offsetY)
              .setDepth(renderDepthAt('access', cursorPosition.x, cursorPosition.y))
              .setVisible(true).setAlpha(valid ? 1 : 0.55).setTint(valid ? 0xffffff : 0xff6048)
          }
        }
        const placeCursor = (x: number, y: number) => {
          cursorPosition.x = Phaser.Math.Clamp(x, left, right)
          cursorPosition.y = Phaser.Math.Clamp(y, top, selectionBottom)
          const position = point(cursorPosition.x, cursorPosition.y)
          cursor.setPosition(position.x, position.y)
          drawCursor()
        }
        placeCursor(cursorPosition.x, cursorPosition.y)

        const camera = this.cameras.main
        const cameraTopRow = top - game.park.cameraMarginTiles.top
        const cameraBottomRow = gateRow + 6 + game.park.cameraMarginTiles.bottom
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

        const clampCameraToMap = () => {
          const viewWidth = camera.width / camera.zoom
          const viewHeight = camera.height / camera.zoom
          const viewInsetX = (camera.width - viewWidth) / 2
          const viewInsetY = (camera.height - viewHeight) / 2
          const maxViewTop = cameraBottomRight.y + stepY - viewHeight
          const viewTop = Phaser.Math.Clamp(camera.scrollY + viewInsetY, cameraTopLeft.y, maxViewTop)
          camera.scrollY = viewTop - viewInsetY

          const rowAt = (screenY: number) => (screenY - padding) / stepY
          const sideMargin = game.park.cameraMarginTiles.side * stepX
          const minViewLeft = padding + left * stepX + rowAt(viewTop) * rowOffsetX - sideMargin
          const maxViewLeft = padding + right * stepX + rowAt(viewTop + viewHeight) * rowOffsetX + tileWidth - viewWidth + sideMargin
          const viewLeft = minViewLeft <= maxViewLeft
            ? Phaser.Math.Clamp(camera.scrollX + viewInsetX, minViewLeft, maxViewLeft)
            : (minViewLeft + maxViewLeft) / 2
          camera.scrollX = viewLeft - viewInsetX
        }
        const keepCursorVisible = () => {
          const viewWidth = camera.width / camera.zoom
          const viewHeight = camera.height / camera.zoom
          const viewInsetX = (camera.width - viewWidth) / 2
          const viewInsetY = (camera.height - viewHeight) / 2
          const margin = game.park.cursorCameraMarginTiles * tileWidth
          const position = point(cursorPosition.x, cursorPosition.y)
          const viewLeft = camera.scrollX + viewInsetX
          const viewTop = camera.scrollY + viewInsetY
          if (position.x < viewLeft + margin) camera.scrollX -= viewLeft + margin - position.x
          if (position.x + stepX > viewLeft + viewWidth - margin) camera.scrollX += position.x + stepX - (viewLeft + viewWidth - margin)
          if (position.y < viewTop + margin) camera.scrollY -= viewTop + margin - position.y
          if (position.y + stepY > viewTop + viewHeight - margin) camera.scrollY += position.y + stepY - (viewTop + viewHeight - margin)
          clampCameraToMap()
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
            selectionBottom,
          )
          placeCursor(nextX, nextY)
          keepCursorVisible()
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
              queueStates.set(neighborKey, queueStateByMask[queueMaskByState[neighborState] | neighbor.reverseMask])
            })
            redrawQueueTiles(x, y)
          }
          drawCursor()
        }
        // アトラクション本体を置く。設置操作とセーブデータからの復元で共通に使う
        const addAttraction = (attraction: Attraction, x: number, y: number) => {
          const bottomX = x
          const bottomY = y + attraction.height - 1
          for (let offsetY = 0; offsetY < attraction.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < attraction.width; offsetX += 1) {
              occupiedByAttraction.add(tileKey(x + offsetX, y + offsetY))
            }
          }
          const baseImages: Phaser.GameObjects.Image[] = []
          for (let offsetY = 0; offsetY < attraction.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < attraction.width; offsetX += 1) {
              const tile = point(x + offsetX, y + offsetY)
              const frame = buildBaseFrameAt(offsetX, offsetY, attraction.width, attraction.height)
              baseImages.push(
                this.add.image(tile.x, tile.y, `build-base-frame-${frame}`).setOrigin(0)
                  .setDepth(renderDepthAt('terrain', x + offsetX, y + offsetY)),
              )
            }
          }
          const imagePosition = attractionImagePosition(attraction, attraction.imageOffset, bottomX, bottomY)
          const image = this.add.image(imagePosition.x, imagePosition.y, attraction.id)
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
          const initialAccess = [
            ...Array.from({ length: attraction.width }, (_, index) => ({ x: x + index, y: y + attraction.height })),
            ...Array.from({ length: attraction.width }, (_, index) => ({ x: x + index, y: y - 1 })),
            ...Array.from({ length: attraction.height }, (_, index) => ({ x: x - 1, y: y + index })),
            ...Array.from({ length: attraction.height }, (_, index) => ({ x: x + attraction.width, y: y + index })),
          ].find(({ x: accessX, y: accessY }) => canPlaceAccess(accessX, accessY))
          if (initialAccess) placeCursor(initialAccess.x, initialAccess.y)
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
          const step = { 0: { x: 0, y: 1 }, 1: { x: 0, y: -1 }, 2: { x: -1, y: 0 }, 3: { x: 1, y: 0 } }[shopDirection] ?? { x: 0, y: 1 }
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
          const step = { 0: { x: 0, y: 1 }, 1: { x: 0, y: -1 }, 2: { x: -1, y: 0 }, 3: { x: 1, y: 0 } }[direction] ?? { x: 0, y: 1 }
          const centerX = shopX + Math.floor(shop.width / 2)
          const centerY = shopY + Math.floor(shop.height / 2)
          const reach = Math.floor((direction < 2 ? shop.height : shop.width) / 2)
          const laid: Array<[number, number]> = []
          for (let i = 0; i <= reach; i += 1) {
            const tileX = centerX + step.x * i
            const tileY = centerY + step.y * i
            roads.add(tileKey(tileX, tileY))
            shopRoads.add(tileKey(tileX, tileY))
            laid.push([tileX, tileY])
          }
          laid.forEach(([tileX, tileY]) => {
            redrawRoadTiles(tileX, tileY)
            redrawQueueTiles(tileX, tileY)
          })
        }
        // ショップ本体を置く。設置操作とセーブデータからの復元で共通に使う
        const addShopBody = (shop: Shop, x: number, y: number, direction: number) => {
          const bottomX = x
          const bottomY = y + shop.height - 1
          // ショップは地面の盛り上げベースを敷かない(占有マークのみ)
          for (let offsetY = 0; offsetY < shop.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < shop.width; offsetX += 1) {
              occupiedByAttraction.add(tileKey(x + offsetX, y + offsetY))
            }
          }
          const imagePosition = attractionImagePosition(shop, shop.imageOffsets[direction], bottomX, bottomY)
          return this.add.image(imagePosition.x, imagePosition.y, `shop-${shop.id}-${direction}`)
            .setOrigin(0).setDepth(renderDepthAt('facility', bottomX, bottomY))
        }
        // 向きが確定したショップを記録し、前の道を敷く
        const completeShop = (shop: Shop, x: number, y: number, direction: number) => {
          placedShops.push({ id: shop.id, x, y, direction })
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
          pendingShop = { x, y, cost: shop.constructionCost, image, baseImages: [] }
          currentCash -= shop.constructionCost
          shopPlacedHandler.current(shop.constructionCost)
          if (shop.directions > 1) {
            shopStep = 'direction'
            shopStepHandler.current('direction')
            drawShopArrow()
          }
          else {
            completeShop(shop, x, y, shopDirection)
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
        }
        const confirmShopDirection = () => {
          const shop = activeShop
          if (shopStep !== 'direction' || !pendingShop || !shop) return
          completeShop(shop, pendingShop.x, pendingShop.y, shopDirection)
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
          for (let offsetY = 0; offsetY < shop.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < shop.width; offsetX += 1) {
              occupiedByAttraction.delete(tileKey(pendingShop.x + offsetX, pendingShop.y + offsetY))
            }
          }
          pendingShop.image.destroy()
          pendingShop.baseImages.forEach((image) => image.destroy())
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
          const tile = point(x, y)
          const [offsetX, offsetY] = accessStep === 'entrance'
            ? [tileWidth / 2, stepY]
            : accessOffsetAt(accessStep, frame)
          const image = this.add.image(
            tile.x + offsetX,
            tile.y + offsetY,
            `facility-${accessStep}-frame-${frame}`,
          ).setOrigin(accessStep === 'entrance' ? 0.5 : 0, accessStep === 'entrance' ? 1 : 0)
            .setDepth(renderDepthAt('access', x, y))
          return { x, y, image }
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
          const access = addAttractionAccess(accessStep, x, y, accessFrameAt(facility, x, y))
          if (accessStep === 'entrance') {
            facility.entrance = access
            redrawQueueTiles(x, y)
            activeAttractionBuildStep = 'exit'
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
              queueStates.set(neighborKey, queueStateByMask[queueMaskByState[neighborState] & ~neighbor.reverseMask])
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
                queueStates.set(
                  connection.key,
                  queueStateByMask[queueMaskByState[state] | connection.neighbor.reverseMask],
                )
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
            const [anchorX, anchorY] = key.split(',').map(Number)
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
        // 道路・設備どちらの設置モードでも □ でカーソル上の道路と設備を削除する
        const removeAtCursor = () => {
          removeRoad()
          removeFacilityAtCursor()
        }
        const selectTileAtPointer = (pointer: Phaser.Input.Pointer) => {
          const world = pointer.positionToCamera(camera) as Phaser.Math.Vector2
          const y = Math.floor((world.y - padding) / stepY)
          const localY = world.y - padding - y * stepY
          const x = Math.floor((world.x - padding - y * rowOffsetX - Math.floor(localY / 2)) / stepX)
          if (x < left || x > right || y < top || y > selectionBottom) return false
          placeCursor(x, y)
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

        let dragging = false
        let previousX = 0
        let previousY = 0
        let dragDistance = 0
        this.input.mouse?.disableContextMenu()
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button !== 1) return
          dragging = true
          previousX = pointer.x
          previousY = pointer.y
          dragDistance = 0
        })
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
          if (dragging && pointer.isDown) {
            const deltaX = pointer.x - previousX
            const deltaY = pointer.y - previousY
            dragDistance += Math.hypot(deltaX, deltaY)
            camera.scrollX -= deltaX / camera.zoom
            camera.scrollY -= deltaY / camera.zoom
            clampCameraToMap()
            previousX = pointer.x
            previousY = pointer.y
            return
          }
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
          if (activeRoadBuildMode || activeAttraction || activeShop || activeFacility) {
            const moved = selectTileAtPointer(pointer)
            // 柵とイケはドラッグで連続して置ける
            if (moved && pointer.isDown && pointer.button === 0 && isPaintFacility(activeFacility)) placeFacility()
          }
        })
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button === 0) {
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
            else if (selectTileAtPointer(pointer)) {
              if (activeRoadBuildMode) placeRoad()
              else if (activeFacility) placeFacility()
              else if (activeShop) placeShop()
              else if (activeAttractionBuildStep === 'body') placeAttraction()
              else placeAttractionAccess()
            }
          }
          if (pointer.button === 1) dragging = false
        })
        this.input.on('gameout', () => { dragging = false })
        this.input.on('wheel', (
          _pointer: Phaser.Input.Pointer,
          _gameObjects: Phaser.GameObjects.GameObject[],
          _deltaX: number,
          deltaY: number,
        ) => changeZoom(deltaY > 0 ? -game.park.zoomStep : game.park.zoomStep))
        this.events.on('pan', (direction: MenuAction) => {
          if (direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down') {
            if (activeShop && shopStep === 'direction') setShopDirection(directionByPad[direction])
            else if (activeFacility && facilityStep === 'direction') setFacilityDirection(directionByPad[direction])
            else {
              moveCursor(direction)
              if (confirmHeld && activeRoadBuildMode) placeRoad()
              if (confirmHeld && isPaintFacility(activeFacility)) placeFacility()
            }
          }
          if (direction === 'confirm') {
            confirmHeld = true
            if (activeRoadBuildMode) placeRoad()
            else if (activeFacility) facilityStep === 'direction' ? finishFacilityDirection() : placeFacility()
            else if (activeShop) shopStep === 'direction' ? confirmShopDirection() : placeShop()
            else if (activeAttractionBuildStep === 'body') placeAttraction()
            else placeAttractionAccess()
          }
          if (direction === 'confirmRelease') confirmHeld = false
          if (direction === 'cancel' && activeShop && shopStep === 'direction') cancelShopDirection()
          if (direction === 'cancel' && activeFacility && facilityStep === 'direction') cancelFacilityDirection()
          if (direction === 'remove' && (activeRoadBuildMode || (activeFacility && facilityStep === 'body'))) removeAtCursor()
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
            for (let offsetY = 0; offsetY < pendingAttraction.height; offsetY += 1) {
              for (let offsetX = 0; offsetX < pendingAttraction.width; offsetX += 1) {
                occupiedByAttraction.delete(tileKey(pendingAttraction.x + offsetX, pendingAttraction.y + offsetY))
              }
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

        // ---- セーブ ----
        const parseKey = (key: string) => {
          const comma = key.indexOf(',')
          return { x: Number(key.slice(0, comma)), y: Number(key.slice(comma + 1)) }
        }
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
                frame: accessFrameAt(placed, placed.entrance.x, placed.entrance.y),
              },
              exit: placed.exit && {
                x: placed.exit.x,
                y: placed.exit.y,
                frame: accessFrameAt(placed, placed.exit.x, placed.exit.y),
              },
              entranceQueueKey: placed.entranceQueueKey,
              entranceFrame: placed.entranceFrame,
            })),
          shops: placedShops.map((placed) => ({ ...placed })),
          facilities: [...placedFacilities].map(([key, placed]) => ({
            id: placed.facility.id,
            ...parseKey(key),
            frame: placed.frame,
          })),
          buildings: [...placedBuildings],
        })
        // セーブデータから園を組み立て直す。道の絵は全部そろえてから一度に描き直す
        const restoreSnapshot = (snapshot: ParkSnapshot) => {
          snapshot.facilities.forEach(({ id, x, y, frame }) => {
            const facility = facilities.find((entry) => entry.id === id)
            if (facility) addFacility(facility, frame, x, y)
          })
          snapshot.buildings.forEach((id) => placedBuildings.add(id))
          snapshot.attractions.forEach((saved) => {
            const attraction = attractions.find((entry) => entry.id === saved.id)
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
            addShopBody(shop, x, y, direction)
            completeShop(shop, x, y, direction)
          })
          snapshot.roads.forEach((key) => roads.add(key))
          snapshot.queues.forEach(({ key, state }) => {
            queueRoads.add(key)
            queueStates.set(key, state)
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
          // walking 以外で使う自由座標と、待ち行列の何番目か
          queueX: number
          queueY: number
          queueSlot: number
          facing: number
          walked: number
          paid: boolean
          leaveAtDay: number
          image: Phaser.GameObjects.Sprite
        }
        const guests: Guest[] = []
        let elapsedDays = 0

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

        // 待ち行列は看板マスを空け、先頭が左右 1 マス、以降 0.5 マス間隔で交互に外へ広がる。
        // マップの端に達したらそれ以上は広がらず端に溜まる
        const queueSlotX = (slot: number) => {
          const side = slot % 2 === 0 ? 1 : -1
          const rank = Math.floor(slot / 2) + 2
          return Math.min(right, Math.max(left, busStop.x + side * rank * 0.5))
        }
        // 並び順は毎フレーム 1 回だけ数える(客ごとに数え直すと客数の 2 乗になる)
        const refreshQueueSlots = () => {
          let slot = 0
          for (const guest of guests) {
            if (guest.phase !== 'queued') continue
            guest.queueSlot = slot
            slot += 1
          }
        }
        const queueTargetOf = (guest: Guest) => {
          if (guest.phase === 'toBus') return { x: busStop.x, y: busStop.y + 1 }
          if (guest.phase === 'toSign') return { x: busStop.x, y: busStop.y }
          return { x: queueSlotX(guest.queueSlot), y: busStop.y }
        }

        const drawGuest = (guest: Guest, x: number, y: number, tileX: number, tileY: number) => {
          const position = point(x + 0.4, y + 0.53)
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
            const comma = key.indexOf(',')
            const roadX = Number(key.slice(0, comma))
            const roadY = Number(key.slice(comma + 1))
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
            queueSlot: 0,
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
              guest.phase = 'queued'
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
        type Bus = {
          x: number
          state: 'arriving' | 'stopped' | 'leaving'
          timer: number
          unloaded: number
          unloadDone: boolean
          boarded: number
          // 原作のバスのテクスチャが未特定のため、車体は暫定の矩形で描いている
          image: Phaser.GameObjects.Rectangle
          gaugeBack: Phaser.GameObjects.Rectangle
          gaugeFill: Phaser.GameObjects.Rectangle
        }
        let bus: Bus | null = null
        const busEnterX = left - 3
        const busExitX = right + 3
        const placeBusImage = (current: Bus) => {
          const position = point(current.x + 0.5, busRow + 0.5)
          const originX = position.x - busConfig.anchor.x
          const originY = position.y - busConfig.anchor.y
          const column = Math.round(current.x)
          current.image.setPosition(originX, originY).setDepth(renderDepthAt('facility', column, busRow))
          // 乗車率のバーは車体の中央下に置く
          const gauge = busConfig.gauge
          const gaugeX = originX + (busConfig.size.width - gauge.width) / 2
          const gaugeY = originY + busConfig.size.height + gauge.offsetY
          const filled = gauge.width * Math.min(1, current.boarded / busConfig.capacity)
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
          const guest = guests.find((candidate) => candidate.phase === 'queued')
          if (!guest) return false
          guest.phase = 'toSign'
          return true
        }
        const updateBus = (days: number) => {
          if (!bus) return
          if (bus.state === 'arriving') {
            bus.x += busConfig.tilesPerDay * days
            if (bus.x >= busHaltX) {
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
            // 定員に達していない限り、待っている客も歩いている途中の客も乗り終えるまで発車しない
            const atStop = guests.some((guest) => guest.phase !== 'walking')
            const boardDone = bus.boarded >= busConfig.capacity || !atStop
            if (bus.timer >= busConfig.stopDays && bus.unloadDone && boardDone) bus.state = 'leaving'
          }
          else {
            bus.x += busConfig.tilesPerDay * days
            if (bus.x > busExitX) {
              bus.image.destroy()
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
            image: this.add
              .rectangle(0, 0, busConfig.size.width, busConfig.size.height, 0xd8d8d8)
              .setOrigin(0, 0)
              .setStrokeStyle(1, 0x404040),
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
          // 前のバスが去ってから次の間隔で、左手からバスが入ってくる
          if (!bus) {
            busTimerDays += days
            if (busTimerDays >= busConfig.intervalDays) {
              busTimerDays = 0
              spawnBus()
            }
          }
          updateBus(days)

          refreshQueueSlots()
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

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
})

export default ParkMap
