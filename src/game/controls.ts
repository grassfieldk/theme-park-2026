/**
 * 操作設定。原作にはない独自の設定で、セーブデータとは別にブラウザへ残す。
 *
 * buttonStyle は画面に出すボタンの絵柄、swapConfirm は決定と取り消しの入れ替え。
 */

export type ButtonStyle = 'playstation' | 'xbox'

export type ControlSettings = {
  buttonStyle: ButtonStyle
  swapConfirm: boolean
}

export const defaultControls: ControlSettings = { buttonStyle: 'playstation', swapConfirm: false }

export const buttonStyleLabels: Record<ButtonStyle, string> = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
}

const storageKey = 'theme-park-2026/controls'

const storage = () => {
  try {
    return window.localStorage
  }
  catch {
    // 設定でストレージが無効な環境では既定のまま遊べるようにする
    return null
  }
}

export function readControls(): ControlSettings {
  try {
    const raw = storage()?.getItem(storageKey)
    if (!raw) return defaultControls
    const data = JSON.parse(raw) as Partial<ControlSettings>
    return {
      buttonStyle: data.buttonStyle === 'xbox' ? 'xbox' : 'playstation',
      swapConfirm: data.swapConfirm === true,
    }
  }
  catch {
    return defaultControls
  }
}

export function writeControls(settings: ControlSettings) {
  try {
    storage()?.setItem(storageKey, JSON.stringify(settings))
  }
  catch {
    // 残せなくてもその場の設定としては効く
  }
}
