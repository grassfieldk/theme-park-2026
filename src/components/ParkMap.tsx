import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import game from '../config/game.json'
import type { MenuAction } from './GamepadController'

type Country = {
  id: string
  name: string
  map: { x: number, y: number, width: number, height: number }
}

type Props = {
  country: Country
  movement: { events: Array<{ direction: MenuAction, serial: number }> }
  pathBuildMode: boolean
}

export default function ParkMap({ country, movement, pathBuildMode }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const phaserGame = useRef<Phaser.Game | null>(null)
  const lastMovementSerial = useRef(0)

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
        for (let index = 0; index < 16; index += 1) {
          this.load.image(`road-frame-${index}`, `/assets/park/road-frame-${index}.png`)
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
        let isPathBuildMode = pathBuildMode
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
        const depthAt = (x: number, y: number) => 4800 - y * 200 + x * 7
        const queue = (key: string, x: number, y: number, depth = depthAt(x, y), offsetX = 0, offsetY = 0) => {
          commands.push({ key, x, y, depth, offsetX, offsetY, order })
          order += 1
        }
        const draw = ({ key, x, y, offsetX = 0, offsetY = 0 }: DrawCommand) => {
          const position = point(x, y)
          ground.draw(key, position.x - offsetX, position.y - offsetY)
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
        commands.forEach(draw)

        const roadFrameByMask = [0, 2, 4, 0, 3, 10, 11, 7, 5, 13, 12, 9, 1, 6, 8, 15]
        const roads = new Set<string>()
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
        )
        const hasRoadConnection = (x: number, y: number) => roads.has(tileKey(x, y)) || isLockedEntranceTile(x, y)
        const roadMaskAt = (x: number, y: number) => (
          (hasRoadConnection(x + 1, y) ? 1 : 0)
          | (hasRoadConnection(x - 1, y) ? 2 : 0)
          | (hasRoadConnection(x, y + 1) ? 4 : 0)
          | (hasRoadConnection(x, y - 1) ? 8 : 0)
        )
        const fixedRoadKeys = new Set(['gate-base-2', 'gate-base-3', 'gate-base-6', 'gate-base-17', 'gate-base-19'])
        const foregroundCommands = commands.filter(({ key }) => key !== 'ground-tile' && !fixedRoadKeys.has(key))
        const redrawRoadTiles = (x: number, y: number) => {
          const affectedTiles = [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          affectedTiles.forEach(([tileX, tileY]) => {
            if (!isBuildableTile(tileX, tileY) && !isLockedEntranceTile(tileX, tileY)) return
            const position = point(tileX, tileY)
            ground.draw('ground-tile', position.x, position.y)
            if (roads.has(tileKey(tileX, tileY)) || isLockedEntranceTile(tileX, tileY)) {
              ground.draw(`road-frame-${roadFrameByMask[roadMaskAt(tileX, tileY)]}`, position.x, position.y)
            }
          })
          foregroundCommands.forEach(draw)
        }

        const cursorPosition = { x: gateLeft + 1, y: bottom - 1 }
        const cursor = this.add.graphics().setDepth(1)
        cursor.fillStyle(0xffef70, 0.2)
        cursor.lineStyle(1, 0xffef70, 1)
        const cursorShape = [
          new Phaser.Geom.Point(0, 0),
          new Phaser.Geom.Point(stepX, 0),
          new Phaser.Geom.Point(stepX + rowOffsetX, stepY),
          new Phaser.Geom.Point(rowOffsetX, stepY),
        ]
        cursor.fillPoints(cursorShape, true)
        cursor.strokePoints(cursorShape, true)
        const placeCursor = (x: number, y: number) => {
          cursorPosition.x = Phaser.Math.Clamp(x, left, right)
          cursorPosition.y = Phaser.Math.Clamp(y, top, selectionBottom)
          const position = point(cursorPosition.x, cursorPosition.y)
          cursor.setPosition(position.x, position.y)
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
          if (direction === 'left') placeCursor(cursorPosition.x - 1, cursorPosition.y)
          if (direction === 'right') placeCursor(cursorPosition.x + 1, cursorPosition.y)
          if (direction === 'up') placeCursor(cursorPosition.x, cursorPosition.y - 1)
          if (direction === 'down') placeCursor(cursorPosition.x, cursorPosition.y + 1)
          keepCursorVisible()
        }
        const placeRoad = () => {
          const { x, y } = cursorPosition
          if (!isBuildableTile(x, y)) return
          const key = tileKey(x, y)
          if (roads.has(key)) return
          roads.add(key)
          redrawRoadTiles(x, y)
        }
        const removeRoad = () => {
          if (!isBuildableTile(cursorPosition.x, cursorPosition.y)) return
          if (!roads.delete(tileKey(cursorPosition.x, cursorPosition.y))) return
          redrawRoadTiles(cursorPosition.x, cursorPosition.y)
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
        this.events.on('postupdate', clampCameraToMap)
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
          if (!dragging || !pointer.isDown) return
          const deltaX = pointer.x - previousX
          const deltaY = pointer.y - previousY
          dragDistance += Math.hypot(deltaX, deltaY)
          camera.scrollX -= deltaX / camera.zoom
          camera.scrollY -= deltaY / camera.zoom
          previousX = pointer.x
          previousY = pointer.y
        })
        this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
          if (pointer.button === 0 && selectTileAtPointer(pointer) && isPathBuildMode) {
            placeRoad()
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
            if (confirmHeld && isPathBuildMode) placeRoad()
          }
          if (direction === 'confirm') {
            confirmHeld = true
            placeRoad()
          }
          if (direction === 'confirmRelease') confirmHeld = false
          if (direction === 'remove') removeRoad()
          if (direction === 'zoomIn') changeZoom(game.park.zoomStep)
          if (direction === 'zoomOut') changeZoom(-game.park.zoomStep)
        })
        this.events.on('path-build-mode', (active: boolean) => {
          isPathBuildMode = active
          if (!active) confirmHeld = false
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
    const pending = movement.events.filter(({ serial }) => serial > lastMovementSerial.current)
    pending.forEach(({ direction }) => {
      phaserGame.current?.scene.getScene('park')?.events.emit('pan', direction)
    })
    if (pending.length > 0) lastMovementSerial.current = pending[pending.length - 1].serial
  }, [movement])

  useEffect(() => {
    phaserGame.current?.scene.getScene('park')?.events.emit('path-build-mode', pathBuildMode)
  }, [pathBuildMode])

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
}
