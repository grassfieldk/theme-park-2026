/**
 * セーブデータの保存先と読み書き。
 *
 * セーブはモード(スタンダード / シナリオ)ごとに 1 枠。シナリオはさらに個別の枠を持つ。
 * 保存先はブラウザの localStorage で、書き込みに失敗しても遊びは止めない。
 */

export const SAVE_VERSION = 1

export type SaveMode = 'standard' | 'scenario'

/** 園の中身。来園者とバスは保存せず、再開時は無人の状態から始める */
export type ParkSnapshot = {
  roads: string[]
  stairs?: Array<{ x: number, y: number, dx?: number, dy?: number }>
  queues: Array<{ key: string, state: number }>
  /** 歩道に落ちているゴミ。1 = 飲み物、2 = 食べ物、4 = ゲロ の組み合わせ */
  litter?: Array<{ key: string, mask: number }>
  attractions: Array<{
    id: string
    x: number
    y: number
    entrance?: { x: number, y: number, frame: number }
    exit?: { x: number, y: number, frame: number }
    entranceQueueKey?: string
    entranceFrame?: number
    /** 運転設定。古いデータには入っていないので、無ければ初期値で始める */
    settings?: {
      suspended: boolean
      capacity: number
      speed: number
      rideTime: number
      price: number
      version: number
      usedThisMonth: number
      usedLastMonth: number
    }
  }>
  shops: Array<{
    id: string
    x: number
    y: number
    direction: number
    /** 運営設定。古いデータには入っていないので、無ければ初期値で始める */
    settings?: {
      price: number
      tasteLevel: number
      prizePrice: number
      winRate: number
      version: number
      usedThisMonth: number
      usedLastMonth: number
    }
  }>
  facilities: Array<{ id: string, x: number, y: number, frame: number }>
  buildings: string[]
}

export type SaveData = {
  version: number
  mode: SaveMode
  scenarioId: string | null
  countryId: string
  elapsedDays: number
  cash: number
  speedIndex: number
  savedAt: string
  park: ParkSnapshot
}

const storageKey = (mode: SaveMode, scenarioId: string | null) => (
  `theme-park-2026/save/${mode}${scenarioId ? `/${scenarioId}` : ''}`
)

const storage = () => {
  try {
    return window.localStorage
  }
  catch {
    // 設定でストレージが無効な環境ではセーブなしで遊べるようにする
    return null
  }
}

export function writeSave(data: SaveData) {
  try {
    storage()?.setItem(storageKey(data.mode, data.scenarioId), JSON.stringify(data))
    return true
  }
  catch {
    return false
  }
}

export function readSave(mode: SaveMode, scenarioId: string | null): SaveData | null {
  try {
    const raw = storage()?.getItem(storageKey(mode, scenarioId))
    if (!raw) return null
    const data = JSON.parse(raw) as SaveData
    // 形式が変わった古いデータは読み込まない
    if (data.version !== SAVE_VERSION) return null
    return data
  }
  catch {
    return null
  }
}

export function clearSave(mode: SaveMode, scenarioId: string | null) {
  try {
    storage()?.removeItem(storageKey(mode, scenarioId))
  }
  catch {
    // 消せなくても遊びには影響しない
  }
}
