import { useEffect, useRef } from 'react'
import game from '../config/game.json'

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'confirmRelease' | 'cancel' | 'menu' | 'start' | 'remove' | 'removeRelease' | 'zoomIn' | 'zoomOut'
type Direction = Extract<MenuAction, 'up' | 'down' | 'left' | 'right'>

type Props = { onAction: (action: MenuAction) => void }

const buttonActions: Array<[number, MenuAction, boolean, MenuAction?]> = [
  [4, 'zoomOut', false], [5, 'zoomIn', false],
  [2, 'remove', false, 'removeRelease'], [3, 'menu', false],
  [0, 'confirm', false, 'confirmRelease'], [9, 'start', false], [1, 'cancel', false],
]

export function GamepadController({ onAction }: Props) {
  const actionHandler = useRef(onAction)
  actionHandler.current = onAction

  useEffect(() => {
    const active = new Map<string, number>()
    let activeDirectionKey = ''
    let activeDirections: Direction[] = []
    let nextDiagonalIndex = 0
    let nextDirectionRepeatAt = 0
    let frame = 0

    const press = (key: string, action: MenuAction, repeat: boolean, now: number) => {
      const nextRepeatAt = active.get(key)
      if (nextRepeatAt === undefined) {
        active.set(key, repeat ? now + game.input.initialRepeatDelayMs : Number.POSITIVE_INFINITY)
        actionHandler.current(action)
        return
      }
      if (!repeat || now < nextRepeatAt) return
      active.set(key, now + game.input.repeatIntervalMs)
      actionHandler.current(action)
    }
    const release = (key: string, releaseAction?: MenuAction) => {
      if (active.delete(key) && releaseAction) actionHandler.current(releaseAction)
    }

    const updateDirection = (gamepad: Gamepad, now: number) => {
      const axisX = gamepad.axes[0] ?? 0
      const axisY = gamepad.axes[1] ?? 0
      const up = Boolean(gamepad.buttons[12]?.pressed) || axisY < -0.6
      const down = Boolean(gamepad.buttons[13]?.pressed) || axisY > 0.6
      const left = Boolean(gamepad.buttons[14]?.pressed) || axisX < -0.6
      const right = Boolean(gamepad.buttons[15]?.pressed) || axisX > 0.6
      const vertical: Direction | null = up === down ? null : up ? 'up' : 'down'
      const horizontal: Direction | null = left === right ? null : left ? 'left' : 'right'
      const directions = [vertical, horizontal].filter((direction): direction is Direction => direction !== null)
      const directionKey = directions.join('-')

      if (!directionKey) {
        activeDirectionKey = ''
        activeDirections = []
        nextDiagonalIndex = 0
        nextDirectionRepeatAt = 0
        return
      }

      if (directionKey !== activeDirectionKey) {
        const previousDirectionKey = activeDirectionKey
        const continuedDirectionIndex = directions.indexOf(previousDirectionKey as Direction)
        const joinedExistingDirection = directions.length === 2 && continuedDirectionIndex >= 0
        const firstDirectionIndex = joinedExistingDirection ? 1 - continuedDirectionIndex : 0

        activeDirectionKey = directionKey
        activeDirections = directions
        nextDiagonalIndex = directions.length === 2 ? 1 - firstDirectionIndex : 0
        nextDirectionRepeatAt = now + (
          joinedExistingDirection ? game.input.repeatIntervalMs : game.input.initialRepeatDelayMs
        )
        actionHandler.current(directions[firstDirectionIndex])
        return
      }

      if (now < nextDirectionRepeatAt) return

      actionHandler.current(activeDirections[nextDiagonalIndex])
      if (activeDirections.length === 2) nextDiagonalIndex = 1 - nextDiagonalIndex
      nextDirectionRepeatAt = now + game.input.repeatIntervalMs
    }

    const update = () => {
      const now = performance.now()
      const gamepad = navigator.getGamepads().find(Boolean)
      if (gamepad) {
        buttonActions.forEach(([index, action, repeat, releaseAction]) => {
          const key = `button-${index}`
          gamepad.buttons[index]?.pressed ? press(key, action, repeat, now) : release(key, releaseAction)
        })
        updateDirection(gamepad, now)
      } else {
        activeDirectionKey = ''
        activeDirections = []
        nextDiagonalIndex = 0
        nextDirectionRepeatAt = 0
      }
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
