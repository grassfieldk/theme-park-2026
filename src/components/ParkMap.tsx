import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Phaser from 'phaser'
import attractions from '../config/attractions.json'
import game from '../config/game.json'
import type { MenuAction } from './GamepadController'

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
  availableCash: number
  onAttractionPlaced: (cost: number) => void
  onAttractionPlacementCancelled: (cost: number) => void
  onAttractionAccessPlaced: (step: 'entrance' | 'exit') => void
}

export type ParkMapHandle = {
  handleAction: (action: MenuAction) => void
}

type Attraction = (typeof attractions)[number]
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
type RoadBuildMode = 'path' | 'queue' | null
type AccessPoint = { x: number, y: number, image: Phaser.GameObjects.Image }
type PlacedAttraction = {
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
  availableCash,
  onAttractionPlaced,
  onAttractionPlacementCancelled,
  onAttractionAccessPlaced,
}: Props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const phaserGame = useRef<Phaser.Game | null>(null)
  const attractionPlacedHandler = useRef(onAttractionPlaced)
  const attractionCancelledHandler = useRef(onAttractionPlacementCancelled)
  const attractionAccessPlacedHandler = useRef(onAttractionAccessPlaced)
  attractionPlacedHandler.current = onAttractionPlaced
  attractionCancelledHandler.current = onAttractionPlacementCancelled
  attractionAccessPlacedHandler.current = onAttractionAccessPlaced

  useImperativeHandle(ref, () => ({
    handleAction(action) {
      phaserGame.current?.scene.getScene('park')?.events.emit('pan', action)
    },
  }), [])

  useEffect(() => {
    if (!host.current) return

    const { width: gridWidth, height: gridHeight, stepX, stepY, rowOffsetX, tileWidth } = game.park.mapGrid
    const padding = 80
    const worldWidth = (gridWidth - 1) * stepX + (gridHeight - 1) * rowOffsetX + tileWidth + padding * 2
    const worldHeight = gridHeight * stepY + padding * 2
    const point = (x: number, y: number) => ({ x: padding + x * stepX + y * rowOffsetX, y: padding + y * stepY })

    class ParkScene extends Phaser.Scene {
      constructor() {
        super('park')
      }

      preload() {
        attractions.forEach((attraction) => this.load.image(attraction.id, `${attraction.asset}?v=4`))
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
        let currentCash = availableCash
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
            const isBusStop = y === gateRow + 5 && x === gateCenter
            if (!isBusStop) queue('ground-tile', x, y)
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
        queue('entrance-special-50', gateCenter, gateRow + 3, depthAt(gateCenter, gateRow + 3) - 1, -7, 5)
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
            if (!isBuildableTile(tileX, tileY) && !isLockedEntranceTile(tileX, tileY)) return
            const key = tileKey(tileX, tileY)
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
        let attractionPreview: Phaser.GameObjects.Image | null = null
        let accessPreview: Phaser.GameObjects.Image | null = null
        const buildBasePreview: Phaser.GameObjects.Image[] = []
        const cursorShape = [
          new Phaser.Geom.Point(0, 0),
          new Phaser.Geom.Point(stepX, 0),
          new Phaser.Geom.Point(stepX + rowOffsetX, stepY),
          new Phaser.Geom.Point(rowOffsetX, stepY),
        ]
        const canPlaceAttraction = (attraction: Attraction, x: number, y: number) => {
          if (currentCash < attraction.constructionCost) return false
          for (let offsetY = 0; offsetY < attraction.height; offsetY += 1) {
            for (let offsetX = 0; offsetX < attraction.width; offsetX += 1) {
              const tileX = x + offsetX
              const tileY = y - offsetY
              if (tileX <= left || tileX >= right || tileY <= top || tileY >= bottom) return false
              if (roads.has(tileKey(tileX, tileY)) || queueRoads.has(tileKey(tileX, tileY)) || occupiedByAttraction.has(tileKey(tileX, tileY))) return false
            }
          }
          return true
        }
        const attractionOriginAtCursor = (_attraction: Attraction) => ({
          x: cursorPosition.x,
          y: cursorPosition.y,
        })
        const attractionImagePosition = (attraction: Attraction, x: number, y: number) => {
          const center = point(
            x + Math.floor(attraction.width / 2),
            y - Math.floor(attraction.height / 2),
          )
          return {
            x: center.x - attraction.imageOffset.x,
            y: center.y - attraction.imageOffset.y,
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
        const drawCursor = () => {
          cursor.clear()
          const attraction = activeAttraction
          const placingBody = attraction && activeAttractionBuildStep === 'body'
          const placingAccess = attraction && activeAttractionBuildStep !== 'body'
          const attractionOrigin = placingBody ? attractionOriginAtCursor(attraction) : null
          const valid = attraction && attractionOrigin
            ? canPlaceAttraction(attraction, attractionOrigin.x, attractionOrigin.y)
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
          const width = placingBody ? attraction.width : 1
          const height = placingBody ? attraction.height : 1
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
          if (placingBody && attractionOrigin) {
            let previewIndex = 0
            for (let offsetY = 0; offsetY < attraction.height; offsetY += 1) {
              for (let offsetX = 0; offsetX < attraction.width; offsetX += 1) {
                const key = `build-base-frame-${buildBaseFrameAt(offsetX, attraction.height - offsetY - 1, attraction.width, attraction.height)}`
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
          if (!placingBody) {
            attractionPreview?.setVisible(false)
          }
          else if (!attractionPreview || attractionPreview.texture.key !== attraction.id) {
            attractionPreview?.destroy()
            attractionPreview = this.add.image(0, 0, attraction.id).setOrigin(0)
          }
          if (placingBody && attractionPreview && attractionOrigin) {
            const position = attractionImagePosition(attraction, attractionOrigin.x, attractionOrigin.y)
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
            if (!canPlacePath(x, y)) return
            roads.add(key)
            redrawRoadTiles(x, y)
            redrawQueueTiles(x, y)
          }
          if (activeRoadBuildMode === 'queue') {
            if (!canPlaceQueue(x, y)) return
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
        const placeAttraction = () => {
          const attraction = activeAttraction
          if (!attraction) return
          const { x: bottomX, y: bottomY } = attractionOriginAtCursor(attraction)
          if (!canPlaceAttraction(attraction, bottomX, bottomY)) return
          const x = bottomX
          const y = bottomY - attraction.height + 1
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
          const imagePosition = attractionImagePosition(attraction, bottomX, bottomY)
          const image = this.add.image(imagePosition.x, imagePosition.y, attraction.id)
            .setOrigin(0).setDepth(renderDepthAt('facility', bottomX, bottomY))
          const placed = {
            x,
            y,
            width: attraction.width,
            height: attraction.height,
            cost: attraction.constructionCost,
            image,
            baseImages,
          }
          placedAttractions.push(placed)
          pendingAttraction = placed
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
        const placeAttractionAccess = () => {
          const facility = pendingAttraction
          const { x, y } = cursorPosition
          if (!facility || !canPlaceAccess(x, y)) return
          const accessStep = activeAttractionBuildStep === 'entrance' ? 'entrance' : 'exit'
          const frame = accessFrameAt(facility, x, y)
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
          if (activeAttractionBuildStep === 'entrance') {
            facility.entrance = { x, y, image }
            redrawQueueTiles(x, y)
            activeAttractionBuildStep = 'exit'
            attractionAccessPlacedHandler.current('entrance')
          }
          else {
            facility.exit = { x, y, image }
            pendingAttraction = null
            activeAttractionBuildStep = 'body'
            attractionAccessPlacedHandler.current('exit')
          }
          drawCursor()
        }
        const removeRoad = () => {
          if (!isBuildableTile(cursorPosition.x, cursorPosition.y)) return
          const key = tileKey(cursorPosition.x, cursorPosition.y)
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
            Math.round((camera.zoom + amount) * 10) / 10,
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
          if (activeRoadBuildMode || activeAttraction) selectTileAtPointer(pointer)
        })
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button === 0 && selectTileAtPointer(pointer)) {
            if (activeRoadBuildMode) placeRoad()
            else if (activeAttractionBuildStep === 'body') placeAttraction()
            else placeAttractionAccess()
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
            moveCursor(direction)
            if (confirmHeld && activeRoadBuildMode) placeRoad()
          }
          if (direction === 'confirm') {
            confirmHeld = true
            if (activeRoadBuildMode) placeRoad()
            else if (activeAttractionBuildStep === 'body') placeAttraction()
            else placeAttractionAccess()
          }
          if (direction === 'confirmRelease') confirmHeld = false
          if (direction === 'remove' && activeRoadBuildMode) removeRoad()
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
        this.events.on('available-cash', (cash: number) => {
          currentCash = cash
          drawCursor()
        })
      }
    }

    phaserGame.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current,
      backgroundColor: '#1d2d2a',
      pixelArt: true,
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
    phaserGame.current?.scene.getScene('park')?.events.emit('attraction-build-step', attractionBuildStep)
  }, [attractionBuildStep])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('available-cash', availableCash)
  }, [availableCash])

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
})

export default ParkMap
