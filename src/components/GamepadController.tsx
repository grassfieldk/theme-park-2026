import { useEffect, useRef } from 'react'
import game from '../config/game.json'

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel'

type Props = { onAction: (action: MenuAction) => void }

const buttonActions: Array<[number, MenuAction, boolean]> = [
  [12, 'up', true], [13, 'down', true], [14, 'left', true], [15, 'right', true],
  [0, 'confirm', false], [9, 'confirm', false], [1, 'cancel', false],
]

export function GamepadController({ onAction }: Props) {
  const actionHandler = useRef(onAction)
  actionHandler.current = onAction

  useEffect(() => {
    const active = new Map<string, number>()
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
    const release = (key: string) => { active.delete(key) }

    const update = () => {
      const now = performance.now()
      const gamepad = navigator.getGamepads().find(Boolean)
      if (gamepad) {
        buttonActions.forEach(([index, action, repeat]) => {
          const key = `button-${index}`
          gamepad.buttons[index]?.pressed ? press(key, action, repeat, now) : release(key)
        })
        const directions: Array<[string, number, MenuAction]> = [
          ['axis-left', gamepad.axes[0] ?? 0, 'left'], ['axis-right', gamepad.axes[0] ?? 0, 'right'],
          ['axis-up', gamepad.axes[1] ?? 0, 'up'], ['axis-down', gamepad.axes[1] ?? 0, 'down'],
        ]
        directions.forEach(([key, value, action]) => {
          const pressed = (action === 'left' || action === 'up') ? value < -0.6 : value > 0.6
          pressed ? press(key, action, true, now) : release(key)
        })
      }
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
