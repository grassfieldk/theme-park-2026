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
  movement: { direction: MenuAction, serial: number }
}

export default function ParkMap({ country, movement }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const phaserGame = useRef<Phaser.Game | null>(null)

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
        const ground = this.add.renderTexture(0, 0, worldWidth, worldHeight).setOrigin(0)
        const { x: left, y: top, width, height } = country.map
        const right = left + width - 1
        const bottom = top + height - 1
        const gateLeft = left + (width - 5) / 2
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

        const camera = this.cameras.main
        const focus = point(left + width / 2, top + (height + 7) / 2)
        camera.setBounds(0, 0, worldWidth, worldHeight).centerOn(focus.x, focus.y)

        let dragging = false
        let previousX = 0
        let previousY = 0
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          dragging = true
          previousX = pointer.x
          previousY = pointer.y
        })
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
          if (!dragging || !pointer.isDown) return
          camera.scrollX -= (pointer.x - previousX) / camera.zoom
          camera.scrollY -= (pointer.y - previousY) / camera.zoom
          previousX = pointer.x
          previousY = pointer.y
        })
        this.input.on('pointerup', () => { dragging = false })
        this.input.on('gameout', () => { dragging = false })
        this.events.on('pan', (direction: MenuAction) => {
          if (direction === 'left') camera.scrollX -= game.park.cameraPanPixels
          if (direction === 'right') camera.scrollX += game.park.cameraPanPixels
          if (direction === 'up') camera.scrollY -= game.park.cameraPanPixels
          if (direction === 'down') camera.scrollY += game.park.cameraPanPixels
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
    if (!movement.serial) return
    phaserGame.current?.scene.getScene('park').events.emit('pan', movement.direction)
  }, [movement])

  return <div className="park-map" ref={host} aria-label={`${country.name} のパークマップ`} />
}
