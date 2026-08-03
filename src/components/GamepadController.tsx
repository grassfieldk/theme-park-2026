import { useEffect, useRef } from 'react'
import game from '../config/game.json'

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'confirmRelease' | 'cancel' | 'menu' | 'start' | 'remove' | 'removeRelease' | 'zoomIn' | 'zoomOut' | 'speedUp' | 'speedDown' | 'pause'
type Direction = Extract<MenuAction, 'up' | 'down' | 'left' | 'right'>

type Props = {
  onAction: (action: MenuAction) => void
  /** 右スティックによるカメラ移動。倒している間、毎フレーム移動量(画面ピクセル)を渡す */
  onCameraPan?: (deltaX: number, deltaY: number) => void
  /** 決定と取り消しを入れ替える(操作設定) */
  swapConfirm?: boolean
}

// スティックの遊び。これ未満の傾きは無視し、超えた分だけを 0〜1 に均して使う
const stickDeadzone = 0.25
const stickValue = (value: number) => {
  const magnitude = Math.abs(value)
  if (magnitude < stickDeadzone) return 0
  return Math.sign(value) * (magnitude - stickDeadzone) / (1 - stickDeadzone)
}

// 下ボタン(0)と右ボタン(1)の役割は操作設定で入れ替わる
const buttonActionsFor = (swapConfirm: boolean): Array<[number, MenuAction, boolean, MenuAction?]> => [
  [6, 'zoomOut', false], [7, 'zoomIn', false],
  [4, 'speedDown', false], [5, 'speedUp', false], [11, 'pause', false],
  [2, 'remove', false, 'removeRelease'], [3, 'menu', false], [9, 'start', false],
  swapConfirm ? [0, 'cancel', false] : [0, 'confirm', false, 'confirmRelease'],
  swapConfirm ? [1, 'confirm', false, 'confirmRelease'] : [1, 'cancel', false],
]

export function GamepadController({ onAction, onCameraPan, swapConfirm = false }: Props) {
  const actionHandler = useRef(onAction)
  const cameraPanHandler = useRef(onCameraPan)
  const buttonActions = useRef(buttonActionsFor(swapConfirm))
  actionHandler.current = onAction
  cameraPanHandler.current = onCameraPan
  buttonActions.current = buttonActionsFor(swapConfirm)

  useEffect(() => {
    const active = new Map<string, number>()
    let activeDirectionKey = ''
    let activeDirections: Direction[] = []
    let nextDiagonalIndex = 0
    let nextDirectionRepeatAt = 0
    let previousNow = performance.now()
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
      // タブが止まっていた後に一気に動かないよう、1 フレーム分の経過時間に上限を設ける
      const deltaMs = Math.min(now - previousNow, 100)
      previousNow = now
      const gamepad = navigator.getGamepads().find(Boolean)
      if (gamepad) {
        buttonActions.current.forEach(([index, action, repeat, releaseAction]) => {
          const key = `button-${index}`
          gamepad.buttons[index]?.pressed ? press(key, action, repeat, now) : release(key, releaseAction)
        })
        updateDirection(gamepad, now)
        // 右スティックはカメラ移動。倒した量に応じて速くなる
        const panX = stickValue(gamepad.axes[2] ?? 0)
        const panY = stickValue(gamepad.axes[3] ?? 0)
        if (panX !== 0 || panY !== 0) {
          const step = game.input.cameraPanPixelsPerSecond * deltaMs / 1000
          cameraPanHandler.current?.(panX * step, panY * step)
        }
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
