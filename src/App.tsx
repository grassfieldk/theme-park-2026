import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import countries from './config/countries.json'
import attractions from './config/attractions.json'
import shops from './config/shops.json'
import facilities from './config/facilities.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import seasons from './config/seasons.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import type { FacilitySettingItem, FacilitySettings, ParkMapHandle } from './components/ParkMap'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'
import { forCountry } from './game/availability'
import { dateFromElapsed, daysInMonth, formatDate, gameDaysPerMs } from './game/clock'
import { readSave, writeSave, SAVE_VERSION, type ParkSnapshot, type SaveMode } from './game/save'
import { buttonStyleLabels, readControls, writeControls, type ControlSettings } from './game/controls'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild' | 'queueBuild' | 'stairsBuild' | 'attractionMenu' | 'attractionBuild' | 'attractionQueueBuild' | 'shopMenu' | 'shopBuild' | 'facilityMenu' | 'facilityBuild' | 'systemMenu' | 'controlsMenu' | 'facilitySettings'
const mainMenuModeById: Record<string, ParkMode> = { roads: 'roadMenu', attractions: 'attractionMenu', shops: 'shopMenu', facilities: 'facilityMenu', system: 'systemMenu' }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
type ConfirmPrompt = { message: string, confirmLabel: string, onConfirm: () => void, onCancel?: () => void }
const countryColumns = 2

function moveMenu(index: number, input: MenuAction, length: number, pageSize = 1) {
  if (input === 'up') return (index - 1 + length) % length
  if (input === 'down') return (index + 1) % length
  // 左右は「表示中の行数」分だけまとめて動く。両端は行き過ぎず端に止める
  if (input === 'left') return Math.max(0, index - pageSize)
  if (input === 'right') return Math.min(length - 1, index + pageSize)
  return index
}

// スマートフォンなど狭い画面では、タッチで操作できる配置に切り替える
const compactLayoutQuery = `(max-width: ${game.park.narrowViewportWidth}px)`
function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia(compactLayoutQuery).matches)
  useEffect(() => {
    const query = window.matchMedia(compactLayoutQuery)
    const update = () => setCompact(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return compact
}

type HoldButtonProps = {
  className: string
  label: string
  onPress: () => void
  onRelease?: () => void
  /** 押しっぱなしで繰り返すか。決定ボタンのように押した瞬間だけ効くものは false */
  repeat?: boolean
  children: ReactNode
}

// 画面上の押しボタン。押しっぱなしの繰り返しはパッドの十字キーと同じ間隔で送る
function HoldButton({ className, label, onPress, onRelease, repeat = true, children }: HoldButtonProps) {
  const press = useRef(onPress)
  const release = useRef(onRelease)
  press.current = onPress
  release.current = onRelease
  const held = useRef(false)
  const timer = useRef(0)
  const [pressed, setPressed] = useState(false)
  const stop = useCallback(() => {
    if (!held.current) return
    held.current = false
    setPressed(false)
    window.clearTimeout(timer.current)
    release.current?.()
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const start = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (held.current) return
    held.current = true
    setPressed(true)
    press.current()
    if (!repeat) return
    const again = (delay: number) => {
      timer.current = window.setTimeout(() => {
        press.current()
        again(game.input.repeatIntervalMs)
      }, delay)
    }
    again(game.input.initialRepeatDelayMs)
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      data-pressed={pressed ? 'true' : undefined}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {children}
    </button>
  )
}

const iconSize = 8

// 停止の目印。縦棒 2 本
function PauseIcon() {
  return (
    <svg className="park-icon" viewBox={`0 0 ${iconSize} ${iconSize}`} width={iconSize} height={iconSize} aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="3" height={iconSize} fill="currentColor" />
      <rect x="5" y="0" width="3" height={iconSize} fill="currentColor" />
    </svg>
  )
}

// 十字ボタンの矢印。向きは扇ごとに CSS で回す
function ArrowIcon() {
  return (
    <svg className="park-icon pad-arrow" viewBox={`0 0 ${iconSize} ${iconSize}`} width="12" height="12" aria-hidden="true" focusable="false">
      <path d={`M0 0L${iconSize} ${iconSize / 2}L0 ${iconSize}Z`} fill="currentColor" />
    </svg>
  )
}

// 設定を調整している間に値のまわりへ出す三角。向きごとに頂点の位置を変える
/** 調整中の項目。決まるまでは書き戻さず、この値だけを動かす */
type SettingEdit = { id: string, digit: number, value: number }

const caretPaths = {
  left: 'M6 0L0 3L6 6Z',
  right: 'M0 0L6 3L0 6Z',
  up: 'M3 0L6 6H0Z',
  down: 'M0 0H6L3 6Z',
}
// 場所は常に取り、出さないときは見えなくするだけ。三角の有無で数字がずれないようにする
function Caret({ direction, hidden }: { direction: keyof typeof caretPaths, hidden?: boolean }) {
  return (
    <svg
      className="park-caret"
      style={hidden ? { visibility: 'hidden' } : undefined}
      viewBox="0 0 6 6"
      width="6"
      height="6"
      aria-hidden="true"
      focusable="false"
    >
      <path d={caretPaths[direction]} fill="currentColor" />
    </svg>
  )
}

// メニューの右端に出す値。調整中は動かせる向きに三角を添え、決まる前の値を見せる
function SettingValue({ item, edit }: { item: FacilitySettingItem, edit: SettingEdit | null }) {
  const editing = edit !== null
  const digit = edit?.digit ?? null
  if (item.kind === 'toggle' || item.kind === 'confirm') {
    const tone = item.kind === 'toggle' ? (item.on ? ' toggle-on' : ' toggle-off') : ''
    return (
      <span className={`park-menu-value${tone}`}>
        <Caret direction="left" hidden />
        <span className="park-menu-number">{item.text}</span>
        <Caret direction="right" hidden />
      </span>
    )
  }
  const value = edit ? edit.value : item.value ?? 0
  if (item.kind === 'step') {
    return (
      <span className="park-menu-value">
        <Caret direction="left" hidden={!editing} />
        <span className="park-menu-number">{value}</span>
        <Caret direction="right" hidden={!editing} />
      </span>
    )
  }
  // 桁ごとに変える項目。上下の三角は今の桁にだけ出す。
  // 桁数は固定なので、位取りのカンマは入れない
  const text = String(value).padStart(item.digits ?? 1, '0')
  return (
    <span className="park-menu-value">
      <Caret direction="left" hidden={!editing} />
      {[...text].map((character, index) => (
        <span className="park-menu-digit" key={index}>
          <Caret direction="up" hidden={index !== digit} />
          <span className="park-menu-number">{character}</span>
          <Caret direction="down" hidden={index !== digit} />
        </span>
      ))}
      <Caret direction="right" hidden={!editing} />
    </span>
  )
}

// パッドの操作ボタンの印。PlayStation は記号、Xbox は文字で描く
type FaceGlyph = 'triangle' | 'circle' | 'cross' | 'square' | 'Y' | 'B' | 'A' | 'X'
const faceGlyphs: Record<ControlSettings['buttonStyle'], Record<'up' | 'right' | 'down' | 'left', FaceGlyph>> = {
  playstation: { up: 'triangle', right: 'circle', down: 'cross', left: 'square' },
  xbox: { up: 'Y', right: 'B', down: 'A', left: 'X' },
}
function FaceIcon({ glyph }: { glyph: FaceGlyph }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const
  return (
    <svg className="park-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      {glyph === 'triangle' ? <path d="M8 2.8L14 13.2H2Z" {...line} strokeLinejoin="round" />
        : glyph === 'circle' ? <circle cx="8" cy="8" r="5.2" {...line} />
          : glyph === 'cross' ? <path d="M3.4 3.4L12.6 12.6M12.6 3.4L3.4 12.6" {...line} strokeLinecap="round" />
            : glyph === 'square' ? <rect x="3" y="3" width="10" height="10" rx="1" {...line} />
              : <text x="8" y="8" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="bold" fill="currentColor">{glyph}</text>}
    </svg>
  )
}

// 速度の目印。段が上がるごとに三角が 1 つ増え、そのぶん 1 つあたりを細くする
// (1 つ = 基準の幅、2 つ = その 2/3、3 つ = その 1/2)。高さは変えない
function SpeedIcon({ count }: { count: number }) {
  const round = (value: number) => Math.round(value * 100) / 100
  const height = iconSize
  const narrowing = 2 / (count + 1)
  const width = round(height * narrowing)
  const step = round((height + 2) * narrowing)
  const total = round(step * (count - 1) + width)
  return (
    <svg className="park-icon" viewBox={`0 0 ${total} ${height}`} width={total} height={height} aria-hidden="true" focusable="false">
      {Array.from({ length: count }, (_, index) => {
        const left = round(index * step)
        return <path key={index} d={`M${left} 0L${round(left + width)} ${height / 2}L${left} ${height}Z`} fill="currentColor" />
      })}
    </svg>
  )
}

// 待たせている間に順ぐりに出す文言。開園前の支度と月末の事務を風景として見せる
const loadingMessages = [
  'ゲートを開いています...',
  '芝生を刈っています...',
  '風船をふくらませています...',
  'ポップコーンを補充しています...',
  '安全バーを確認しています...',
  'チケットを刷っています...',
  'マスコットを起こしています...',
  'ベンチのペンキを乾かしています...',
  '園内放送のマイクを試しています...',
]
const monthChangeMessages = [
  '月末の事務処理に追われています...',
  '今月の売上を集計しています...',
  '来月のシフトを組んでいます...',
  '看板を掛け替えています...',
  '花壇を植え替えています...',
  'アトラクションを点検しています...',
  'スタッフに給料を配っています...',
  'カレンダーをめくっています...',
]
// 待ち時間はフレーム数で決める(game.json)。暗転はすばやく暗くして最低の長さだけ保つ
const framesToMs = (frames: number) => frames * 1000 / game.time.framesPerSecond
const loadingMessageMs = framesToMs(game.loading.messageFrames)
const blackoutFadeMs = framesToMs(game.loading.blackoutFadeFrames)
const blackoutHoldMs = framesToMs(game.loading.blackoutHoldFrames)

function ParkLoading({ messages }: { messages: string[] }) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * messages.length))
  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % messages.length)
    }, loadingMessageMs)
    return () => window.clearInterval(timer)
  }, [messages])
  return (
    <div className="park-loading" role="status">
      <span className="park-loading-spinner" aria-hidden="true" />
      <p>{messages[index % messages.length]}</p>
    </div>
  )
}

type Direction = Extract<MenuAction, 'up' | 'down' | 'left' | 'right'>
const padSectors: Array<{ direction: Direction, className: string, label: string }> = [
  { direction: 'up', className: 'park-pad-button park-pad-up', label: '上' },
  { direction: 'right', className: 'park-pad-button park-pad-right', label: '右' },
  { direction: 'down', className: 'park-pad-button park-pad-down', label: '下' },
  { direction: 'left', className: 'park-pad-button park-pad-left', label: '左' },
]

// 画面上の十字ボタン。指の位置で向きが決まるので、押したまま指をずらすと向きが変わる
function DirectionPad({ solid, onDirection }: { solid: boolean, onDirection: (direction: Direction) => void }) {
  const fire = useRef(onDirection)
  fire.current = onDirection
  const [active, setActive] = useState<Direction | null>(null)
  const held = useRef<Direction | null>(null)
  const timer = useRef(0)

  const stop = useCallback(() => {
    held.current = null
    setActive(null)
    window.clearTimeout(timer.current)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const begin = (direction: Direction) => {
    held.current = direction
    setActive(direction)
    fire.current(direction)
    window.clearTimeout(timer.current)
    const again = (delay: number) => {
      timer.current = window.setTimeout(() => {
        if (!held.current) return
        fire.current(held.current)
        again(game.input.repeatIntervalMs)
      }, delay)
    }
    again(game.input.initialRepeatDelayMs)
  }

  // 中心から見て縦横どちらに寄っているかで、斜めに四分割した扇のどれかを選ぶ
  const directionAt = (event: React.PointerEvent<HTMLDivElement>): Direction => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const offsetX = event.clientX - (bounds.left + bounds.width / 2)
    const offsetY = event.clientY - (bounds.top + bounds.height / 2)
    if (Math.abs(offsetX) >= Math.abs(offsetY)) return offsetX >= 0 ? 'right' : 'left'
    return offsetY >= 0 ? 'down' : 'up'
  }

  return (
    <div
      className="park-pad"
      data-solid={solid ? 'true' : undefined}
      role="group"
      aria-label="カーソル操作"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        begin(directionAt(event))
      }}
      onPointerMove={(event) => {
        if (!held.current) return
        const direction = directionAt(event)
        if (direction !== held.current) begin(direction)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {padSectors.map(({ direction, className, label }) => (
        <button
          key={direction}
          type="button"
          className={className}
          aria-label={label}
          data-pressed={active === direction ? 'true' : undefined}
          onClick={() => fire.current(direction)}
        >
          <ArrowIcon />
        </button>
      ))}
    </div>
  )
}

function moveCountry(index: number, input: MenuAction) {
  const lastRowStart = countries.length - countryColumns
  if (input === 'left') return index % countryColumns === 0 ? index + countryColumns - 1 : index - 1
  if (input === 'right') return index % countryColumns === countryColumns - 1 ? index - countryColumns + 1 : index + 1
  if (input === 'up') return index < countryColumns ? index + lastRowStart : index - countryColumns
  if (input === 'down') return index >= lastRowStart ? index - lastRowStart : index + countryColumns
  return index
}

export default function App() {
  const compact = useCompactLayout()
  const [screen, setScreen] = useState<Screen>('title')
  const [selectedCountry, setSelectedCountry] = useState(0)
  const parkMap = useRef<ParkMapHandle>(null)
  const [parkMode, setParkMode] = useState<ParkMode>('map')
  const [mainMenuIndex, setMainMenuIndex] = useState(0)
  const [roadMenuIndex, setRoadMenuIndex] = useState(0)
  const [attractionMenuIndex, setAttractionMenuIndex] = useState(0)
  const [shopMenuIndex, setShopMenuIndex] = useState(0)
  const [facilityMenuIndex, setFacilityMenuIndex] = useState(0)
  const [systemMenuIndex, setSystemMenuIndex] = useState(0)
  const [controlsMenuIndex, setControlsMenuIndex] = useState(0)
  // 設置済みの施設に合わせて開く設定メニュー。中身はマップ側が組み立てる
  const [facilitySettings, setFacilitySettings] = useState<FacilitySettings | null>(null)
  const [facilitySettingsIndex, setFacilitySettingsIndex] = useState(0)
  const [editingSetting, setEditingSetting] = useState<SettingEdit | null>(null)
  const [controls, setControls] = useState(readControls)
  const [shopBuildStep, setShopBuildStep] = useState<'body' | 'direction'>('body')
  const [facilityBuildStep, setFacilityBuildStep] = useState<'body' | 'direction'>('body')
  const [stairsBuildStep, setStairsBuildStep] = useState<'body' | 'direction'>('body')
  const [attractionBuildStep, setAttractionBuildStep] = useState<AttractionBuildStep>('body')
  const [cash, setCash] = useState(game.park.initialCash)
  const [titleStep, setTitleStep] = useState<'menu' | 'mode'>('menu')
  const [titleIndex, setTitleIndex] = useState(0)
  const [buildMessage, setBuildMessage] = useState('')
  const [speedIndex, setSpeedIndex] = useState(game.time.defaultSpeedIndex)
  // 停止ボタンによる一時停止。メニュー操作中の自動停止とは別に覚えておく
  const [paused, setPaused] = useState(false)
  // 左右キーで送るページの大きさ。ParkMenu が実際に見えている行数を測って伝える
  const [menuPageSize, setMenuPageSize] = useState(1)
  const [guestCount, setGuestCount] = useState(0)
  const [clock, setClock] = useState(() => dateFromElapsed(0))
  const elapsedDays = useRef(0)
  const [mode, setMode] = useState<SaveMode>('standard')
  const [savedGame, setSavedGame] = useState(() => readSave('standard', null))
  // セーブから再開するときだけ中身が入る。ニューゲームでは null
  const [loadedPark, setLoadedPark] = useState<ParkSnapshot | null>(null)
  // 確認の問い合わせ。入っている間は確認だけを受け付ける
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null)
  // 絵の読み込みと園の組み立てが終わるまでは読み込み中の表示を出す
  const [mapReady, setMapReady] = useState(false)
  // 月が変わる間の暗転
  const [monthChanging, setMonthChanging] = useState(false)

  const titleMenus = useMemo(() => ({
    menu: [
      { id: 'new', label: 'ニューゲーム', enabled: true },
      { id: 'load', label: 'ロードゲーム', enabled: savedGame !== null },
      { id: 'training', label: 'トレーニング', enabled: false },
    ],
    mode: [
      { id: 'standard', label: 'スタンダード', enabled: true },
      { id: 'scenario', label: 'シナリオ', enabled: false },
    ],
  }), [savedGame])

  // タイトルに戻るたびに、続きから始められるかを見直す
  useEffect(() => {
    if (screen === 'title') setSavedGame(readSave(mode, null))
  }, [screen, mode])

  // 停止ボタンのほか、メニューや設置などの操作中・確認中も時間を止める
  const timePaused = paused || parkMode !== 'map' || confirmPrompt !== null
  // パーク画面にいる間だけ日付を進める。表示は日が変わったときだけ更新する
  const secondsPerDay = timePaused ? Number.POSITIVE_INFINITY : game.speeds[speedIndex].secondsPerDay
  useEffect(() => {
    if (screen !== 'park' || secondsPerDay === Number.POSITIVE_INFINITY) return
    const daysPerMs = gameDaysPerMs(secondsPerDay)
    // 来園者の演算と同じ刻み幅・同じ上限で進めることで、日付と園内の動きがずれないようにする
    const stepMs = 1000 / game.time.framesPerSecond
    const maxPendingMs = stepMs * 15
    let frame = 0
    let previous = performance.now()
    let pending = 0
    let shownDay = -1
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      pending = Math.min(pending + (now - previous), maxPendingMs)
      previous = now
      if (pending < stepMs) return
      const steps = Math.floor(pending / stepMs)
      pending -= steps * stepMs
      elapsedDays.current += steps * stepMs * daysPerMs
      const day = Math.floor(elapsedDays.current)
      if (day !== shownDay) {
        shownDay = day
        setClock(dateFromElapsed(elapsedDays.current))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [screen, secondsPerDay])

  // 月が替わったら暗転させ、季節の絵の差し替えが済むまで見せない。
  // 差し替えは月が替わった直後のフレームで終わるので、実際には最低の長さが待ち時間になる
  const shownMonth = useRef<number | null>(null)
  useEffect(() => {
    if (screen !== 'park') {
      shownMonth.current = null
      return
    }
    if (shownMonth.current === clock.month) return
    const first = shownMonth.current === null
    shownMonth.current = clock.month
    if (!first) setMonthChanging(true)
  }, [screen, clock])
  useEffect(() => {
    if (!monthChanging) return
    const timer = window.setTimeout(() => setMonthChanging(false), blackoutFadeMs + blackoutHoldMs)
    return () => window.clearTimeout(timer)
  }, [monthChanging])

  // セーブデータの続きから park 画面に入る
  const startLoadedGame = useCallback(() => {
    if (!savedGame) return
    const countryIndex = countries.findIndex((entry) => entry.id === savedGame.countryId)
    setSelectedCountry(countryIndex < 0 ? 0 : countryIndex)
    setMode(savedGame.mode)
    setCash(savedGame.cash)
    setSpeedIndex(savedGame.speedIndex)
    elapsedDays.current = savedGame.elapsedDays
    setClock(dateFromElapsed(savedGame.elapsedDays))
    setGuestCount(0)
    setAttractionMenuIndex(0)
    setShopMenuIndex(0)
    setFacilityMenuIndex(0)
    setMapReady(false)
    setParkMode('map')
    setLoadedPark(savedGame.park)
    logGameEvent('game_loaded', { mode: savedGame.mode, country: savedGame.countryId })
    setScreen('park')
  }, [savedGame])

  // 選んだ国で最初から始める
  const beginNewGame = useCallback((countryIndex: number) => {
    logGameEvent('country_selected', { country: countries[countryIndex].id })
    setSelectedCountry(countryIndex)
    setAttractionMenuIndex(0)
    setShopMenuIndex(0)
    setFacilityMenuIndex(0)
    elapsedDays.current = 0
    setClock(dateFromElapsed(0))
    setGuestCount(0)
    setParkMode('map')
    setCash(game.park.initialCash)
    setLoadedPark(null)
    setScreen('park')
  }, [])
  // 続きが残っているモードで新しく始めるときは、上書きになるので確認する
  const startNewGame = useCallback((countryIndex: number) => {
    if (!readSave(mode, null)) {
      beginNewGame(countryIndex)
      return
    }
    setConfirmPrompt({
      message: 'このモードのセーブデータは上書きされます。新しく始めますか？',
      confirmLabel: 'はじめる',
      onConfirm: () => beginNewGame(countryIndex),
    })
  }, [mode, beginNewGame])

  const activateTitleItem = useCallback((step: 'menu' | 'mode', index: number) => {
    const item = titleMenus[step][index]
    if (!item?.enabled) return
    if (step === 'menu') {
      if (item.id === 'load') {
        startLoadedGame()
        return
      }
      setTitleStep('mode')
      setTitleIndex(0)
      return
    }
    const selectedMode = item.id as SaveMode
    setMode(selectedMode)
    setLoadedPark(null)
    logGameEvent('mode_selected', { mode: selectedMode })
    setScreen('country')
  }, [titleMenus, startLoadedGame])

  const selected = countries[selectedCountry]
  // 国ごとに設置できるものだけを一覧に出す(countryAvailability.json)
  // 季節で切り替わる姿(スケートリンク・プール)はメニューに出さない。設置後に自動で切り替わる
  const countryAttractions = useMemo(
    () => forCountry(attractions, 'attractions', selected.id).filter((attraction) => !('seasonalFormOf' in attraction)),
    [selected.id],
  )
  const countryShops = useMemo(() => forCountry(shops, 'shops', selected.id), [selected.id])
  const countryFacilities = useMemo(() => forCountry(facilities, 'facilities', selected.id), [selected.id])

  const answerConfirm = useCallback((confirmed: boolean) => {
    setConfirmPrompt((prompt) => {
      if (confirmed) prompt?.onConfirm()
      else prompt?.onCancel?.()
      return null
    })
  }, [])

  // 操作設定を変えて残す。原作にはない独自の設定
  const changeControls = useCallback((change: Partial<ControlSettings>) => {
    setControls((current) => {
      const next = { ...current, ...change }
      writeControls(next)
      return next
    })
  }, [])
  const controlItems = useMemo(() => [
    {
      id: 'buttonStyle',
      label: `ボタンの絵柄: ${buttonStyleLabels[controls.buttonStyle]}`,
      description: '画面に出す操作ボタンの絵柄を選べます。',
      enabled: true,
    },
    {
      id: 'swapConfirm',
      label: `決定ボタン: ${controls.swapConfirm ? '右' : '下'}`,
      description: '決定と取り消しを入れ替えられます。',
      enabled: true,
    },
  ], [controls])

  // 施設の設定項目を決定したとき。切り替えはその場で、数値は調整に入り、性能は確認を出す
  const startSettingItem = useCallback((item: FacilitySettingItem) => {
    if (item.kind === 'toggle') {
      parkMap.current?.activateFacilitySetting(item.id)
      return
    }
    if (item.kind === 'confirm') {
      setConfirmPrompt({
        message: `${game.facilityMenu.versionUpCost.toLocaleString()} かかります。性能を上げますか？`,
        confirmLabel: '上げる',
        onConfirm: () => parkMap.current?.activateFacilitySetting(item.id),
      })
      return
    }
    setEditingSetting({ id: item.id, digit: 0, value: item.value ?? 0 })
  }, [])

  // メニュー項目を開く。キー操作の決定とクリックの両方から使う
  const openMenuItem = useCallback((mode: ParkMode, index: number) => {
    if (mode === 'mainMenu') {
      if (!parkMenu.main[index].enabled) return
      setMainMenuIndex(index)
      setParkMode(mainMenuModeById[parkMenu.main[index].id] ?? 'roadMenu')
    }
    else if (mode === 'roadMenu') {
      if (!parkMenu.roads[index].enabled) return
      setRoadMenuIndex(index)
      const road = parkMenu.roads[index].id
      if (road === 'path') setParkMode('pathBuild')
      if (road === 'queue') setParkMode('queueBuild')
      if (road === 'stairs') setParkMode('stairsBuild')
    }
    else if (mode === 'attractionMenu') {
      setAttractionMenuIndex(index)
      setAttractionBuildStep('body')
      setParkMode('attractionBuild')
    }
    else if (mode === 'shopMenu') {
      setShopMenuIndex(index)
      setParkMode('shopBuild')
    }
    else if (mode === 'facilityMenu') {
      setFacilityMenuIndex(index)
      setParkMode('facilityBuild')
    }
    else if (mode === 'systemMenu') {
      if (!parkMenu.system[index].enabled) return
      setSystemMenuIndex(index)
      if (parkMenu.system[index].id === 'controls') {
        setControlsMenuIndex(0)
        setParkMode('controlsMenu')
      }
    }
    else if (mode === 'facilitySettings') {
      setFacilitySettingsIndex(index)
      const item = facilitySettings?.items[index]
      if (item?.enabled) startSettingItem(item)
    }
    else if (mode === 'controlsMenu') {
      setControlsMenuIndex(index)
      if (controlItems[index].id === 'buttonStyle') {
        changeControls({ buttonStyle: controls.buttonStyle === 'playstation' ? 'xbox' : 'playstation' })
      }
      else changeControls({ swapConfirm: !controls.swapConfirm })
    }
  }, [controlItems, controls, changeControls, facilitySettings, startSettingItem])

  const action = useCallback((input: MenuAction) => {
    if (confirmPrompt) {
      // ボタンを離した通知だけは通す。ここで止めると押しっぱなし扱いのままになる
      if (input === 'confirmRelease' || input === 'removeRelease') parkMap.current?.handleAction(input)
      else if (input === 'confirm' || input === 'cancel') answerConfirm(input === 'confirm')
      return
    }
    if (screen === 'title') {
      if (input === 'up' || input === 'down') {
        setTitleIndex((current) => moveMenu(current, input, titleMenus[titleStep].length))
      }
      else if (input === 'confirm' || input === 'start') activateTitleItem(titleStep, titleIndex)
      else if (input === 'cancel' && titleStep === 'mode') {
        setTitleStep('menu')
        setTitleIndex(0)
      }
      return
    }

    if (screen === 'park') {
      if (input === 'menu' || input === 'start') {
        setParkMode((current) => current === 'map' ? 'mainMenu' : 'map')
        return
      }
      // 速度の増減は停止を経由せず、低速〜高速の間だけを動く
      if (input === 'speedUp' || input === 'speedDown') {
        const delta = input === 'speedUp' ? 1 : -1
        setSpeedIndex((current) => Math.min(Math.max(current + delta, 0), game.speeds.length - 1))
        return
      }
      if (input === 'pause') {
        setPaused((current) => !current)
        return
      }
      if (parkMode === 'mainMenu') {
        if (input === 'cancel') setParkMode('map')
        else if (input === 'confirm') openMenuItem('mainMenu', mainMenuIndex)
        else setMainMenuIndex((current) => moveMenu(current, input, parkMenu.main.length, menuPageSize))
        return
      }
      if (parkMode === 'roadMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') openMenuItem('roadMenu', roadMenuIndex)
        else setRoadMenuIndex((current) => moveMenu(current, input, parkMenu.roads.length, menuPageSize))
        return
      }
      if ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'stairsBuild') && input === 'cancel') {
        if (parkMode === 'stairsBuild' && stairsBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('roadMenu')
        return
      }
      if (parkMode === 'attractionQueueBuild' && input === 'cancel') {
        setParkMode('attractionMenu')
        return
      }
      if (parkMode === 'attractionMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') openMenuItem('attractionMenu', attractionMenuIndex)
        else setAttractionMenuIndex((current) => moveMenu(current, input, countryAttractions.length, menuPageSize))
        return
      }
      if (parkMode === 'attractionBuild' && input === 'cancel') {
        setParkMode('attractionMenu')
        return
      }
      if (parkMode === 'shopMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') openMenuItem('shopMenu', shopMenuIndex)
        else setShopMenuIndex((current) => moveMenu(current, input, countryShops.length, menuPageSize))
        return
      }
      if (parkMode === 'shopBuild' && input === 'cancel') {
        if (shopBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('shopMenu')
        return
      }
      if (parkMode === 'facilityMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') openMenuItem('facilityMenu', facilityMenuIndex)
        else setFacilityMenuIndex((current) => moveMenu(current, input, countryFacilities.length, menuPageSize))
        return
      }
      if (parkMode === 'systemMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') openMenuItem('systemMenu', systemMenuIndex)
        else setSystemMenuIndex((current) => moveMenu(current, input, parkMenu.system.length, menuPageSize))
        return
      }
      // 施設の設定。上下で項目を選び、決定でその項目の調整に入る
      if (parkMode === 'facilitySettings') {
        const items = facilitySettings?.items ?? []
        // 調整中は、その項目だけを相手にする。決めるまでは施設に書き戻さない
        if (editingSetting) {
          const edit = editingSetting
          const item = items.find((entry) => entry.id === edit.id)
          if (!item || input === 'cancel') {
            setEditingSetting(null)
            return
          }
          if (input === 'confirm') {
            parkMap.current?.setFacilitySetting(edit.id, edit.value)
            setEditingSetting(null)
            return
          }
          if (item.kind === 'step') {
            const min = item.min ?? 0
            const max = item.max ?? 0
            // 左右で 1 ずつ、上下でいっぺんに最大・最低へ
            const next = input === 'left' ? edit.value - 1
              : input === 'right' ? edit.value + 1
              : input === 'up' ? max
              : input === 'down' ? min
              : edit.value
            setEditingSetting({ ...edit, value: Math.min(max, Math.max(min, next)) })
            return
          }
          const digits = item.digits ?? 1
          if (input === 'left' || input === 'right') {
            const step = input === 'left' ? digits - 1 : 1
            setEditingSetting({ ...edit, digit: (edit.digit + step) % digits })
            return
          }
          if (input !== 'up' && input !== 'down') return
          // 選んでいる桁だけを 0〜9 で回す。繰り上がりで隣の桁は動かさない
          const place = 10 ** (digits - 1 - edit.digit)
          const current = Math.floor(edit.value / place) % 10
          const next = (current + (input === 'up' ? 1 : 9)) % 10
          setEditingSetting({ ...edit, value: edit.value + (next - current) * place })
          return
        }
        const item = items[facilitySettingsIndex]
        if (input === 'cancel') parkMap.current?.closeFacilitySettings()
        else if (input === 'up' || input === 'down') {
          setBuildMessage('')
          setFacilitySettingsIndex((current) => moveMenu(current, input, items.length))
        }
        else if (input === 'confirm' && item?.enabled) {
          setBuildMessage('')
          startSettingItem(item)
        }
        return
      }
      if (parkMode === 'controlsMenu') {
        if (input === 'cancel') setParkMode('systemMenu')
        else if (input === 'confirm') openMenuItem('controlsMenu', controlsMenuIndex)
        else setControlsMenuIndex((current) => moveMenu(current, input, controlItems.length, menuPageSize))
        return
      }
      if (parkMode === 'facilityBuild' && input === 'cancel') {
        if (facilityBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('facilityMenu')
        return
      }
      const mapAction = input === 'left' || input === 'right' || input === 'up' || input === 'down'
        || input === 'zoomIn' || input === 'zoomOut'
        // 何のモードでもないときの決定は、カーソルの下の施設の設定メニューを開く
        || ((parkMode === 'map' || parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'stairsBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'attractionBuild' || parkMode === 'shopBuild' || parkMode === 'facilityBuild') && (input === 'confirm' || input === 'confirmRelease'))
        // 撤去はどのモードでも使える。何を消せるかはマップ側で判断する
        || input === 'remove' || input === 'removeRelease'
      if (mapAction) parkMap.current?.handleAction(input)
      return
    }

    if (input === 'cancel') {
      setScreen('title')
      return
    }
    if (input === 'confirm') {
      startNewGame(selectedCountry)
      return
    }

    const nextCountry = moveCountry(selectedCountry, input)
    if (nextCountry === selectedCountry) return
    setSelectedCountry(nextCountry)
  }, [screen, selectedCountry, parkMode, mainMenuIndex, roadMenuIndex, attractionMenuIndex, shopMenuIndex, facilityMenuIndex, systemMenuIndex, controlsMenuIndex, controlItems, menuPageSize, shopBuildStep, facilityBuildStep, stairsBuildStep, titleStep, titleIndex, confirmPrompt, answerConfirm, activateTitleItem, openMenuItem, startNewGame, countryAttractions, countryShops, countryFacilities, facilitySettings, facilitySettingsIndex, editingSetting, startSettingItem])


  useEffect(() => setBuildMessage(''), [parkMode])

  // 設定メニューを閉じたら選択位置を先頭に戻し、次に開いたときの起点にする
  const settingsOpen = facilitySettings !== null
  useEffect(() => {
    if (settingsOpen) return
    setFacilitySettingsIndex(0)
    setEditingSetting(null)
  }, [settingsOpen])

  // オートセーブ。日付が変わったときだけ書き込む(clock は日が変わったときにしか更新されない)
  const autoSaveState = useRef({ mode, cash, speedIndex, countryId: selected.id })
  autoSaveState.current = { mode, cash, speedIndex, countryId: selected.id }
  useEffect(() => {
    if (screen !== 'park') return
    const park = parkMap.current?.snapshot()
    if (!park) return
    const { mode: saveMode, cash: savedCash, speedIndex: savedSpeed, countryId } = autoSaveState.current
    writeSave({
      version: SAVE_VERSION,
      mode: saveMode,
      scenarioId: null,
      countryId,
      elapsedDays: elapsedDays.current,
      cash: savedCash,
      speedIndex: savedSpeed,
      savedAt: new Date().toISOString(),
      park,
    })
  }, [screen, clock])

  const listMenus: Partial<Record<ParkMode, typeof parkMenu.main>> = {
    mainMenu: parkMenu.main,
    roadMenu: parkMenu.roads,
    systemMenu: parkMenu.system,
  }
  const listMenu = listMenus[parkMode]
  const menuItems = listMenu
    ? listMenu.map((item) => ({
      ...item,
      iconSrc: `/assets/park/menu-icon-${item.icon}.png`,
    }))
    : parkMode === 'controlsMenu'
    ? controlItems
    : parkMode === 'facilitySettings'
    ? (facilitySettings?.items ?? []).map((item) => ({
      ...item,
      iconSrc: `/assets/park/menu-icon-${item.icon}.png`,
      value: <SettingValue item={item} edit={editingSetting?.id === item.id ? editingSetting : null} />,
    }))
    : parkMode === 'attractionMenu'
      ? countryAttractions.map((attraction) => ({
        id: attraction.id,
        label: attraction.name,
        description: `設置費 ${attraction.constructionCost.toLocaleString()}　${attraction.width} × ${attraction.height} マス`,
        iconSrc: `/assets/park/attraction-icons/${attraction.id}.png`,
        enabled: true,
      }))
      : parkMode === 'shopMenu'
        ? countryShops.map((shop) => ({
          id: shop.id,
          label: shop.name,
          description: `設置費 ${shop.constructionCost.toLocaleString()}　${shop.width} × ${shop.height} マス`,
          iconSrc: `/assets/park/shop-icons/${shop.id}.png`,
          enabled: true,
        }))
        : parkMode === 'facilityMenu'
          ? countryFacilities.map((facility) => ({
            id: facility.id,
            label: facility.name,
            description: `${facility.width} × ${facility.height} マス`,
            // 設備のアイコンは国ごとのシーナリー種の絵柄になる
            iconSrc: `/assets/park/facility-icons/${(seasons.countryScenery as Record<string, number>)[countries[selectedCountry].id] ?? 0}/${facility.id}.png`,
            enabled: true,
          }))
          : null
  const menuIndexByMode: Partial<Record<ParkMode, [number, (index: number) => void]>> = {
    mainMenu: [mainMenuIndex, setMainMenuIndex],
    roadMenu: [roadMenuIndex, setRoadMenuIndex],
    shopMenu: [shopMenuIndex, setShopMenuIndex],
    facilityMenu: [facilityMenuIndex, setFacilityMenuIndex],
    systemMenu: [systemMenuIndex, setSystemMenuIndex],
    controlsMenu: [controlsMenuIndex, setControlsMenuIndex],
    facilitySettings: [facilitySettingsIndex, setFacilitySettingsIndex],
  }
  const [menuSelectedIndex, selectMenuIndex] = menuIndexByMode[parkMode] ?? [attractionMenuIndex, setAttractionMenuIndex]
  const buildModeLabel = parkMode === 'facilitySettings' && facilitySettings
    ? `${facilitySettings.title} Lv.${facilitySettings.version}`
    : parkMode === 'pathBuild'
    ? '歩道設置中'
    : parkMode === 'stairsBuild'
      ? stairsBuildStep === 'direction' ? '向きを選んでください' : '階段設置中'
      : parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild'
      ? '整列歩道設置中'
      : parkMode === 'attractionBuild'
        ? attractionBuildStep === 'body'
          ? `${countryAttractions[attractionMenuIndex].name} 設置中`
          : attractionBuildStep === 'entrance' ? '入口設置中' : '出口設置中'
        : parkMode === 'shopBuild'
          ? shopBuildStep === 'direction' && countryShops[shopMenuIndex].directions > 1
            ? '向きを選んでください'
            : `${countryShops[shopMenuIndex].name} 設置中`
          : parkMode === 'facilityBuild'
            ? facilityBuildStep === 'direction'
              ? '向きを選んでください'
              : `${countryFacilities[facilityMenuIndex].name} 設置中`
            : ''
  // 左上は今のモード、下部のバーは通知・アドバイスなどのメッセージと役割を分ける。
  // 設定メニューでは資金不足などの知らせを項目の説明より先に出す
  const statusBarText = parkMode === 'facilitySettings' && buildMessage
    ? buildMessage
    : menuItems ? menuItems[menuSelectedIndex]?.description ?? '' : buildMessage
  // 時間操作は停止と速度変更の 2 つ。速度は押すたびに低速→標準→高速と回る
  const cycleSpeed = () => {
    setSpeedIndex((current) => paused ? current : (current + 1) % game.speeds.length)
    setPaused(false)
  }
  // 開発サーバでだけ出すデバッグ操作。本番の書き出しにはこの分岐ごと残らない
  const jumpToMonthEnd = () => {
    const date = dateFromElapsed(elapsedDays.current)
    const lastDay = daysInMonth(date.year, date.month)
    // すでに月末なら翌月の月末へ送る
    const nextMonth = date.month === 12 ? 1 : date.month + 1
    const nextYear = date.month === 12 ? date.year + 1 : date.year
    elapsedDays.current += date.day < lastDay ? lastDay - date.day : daysInMonth(nextYear, nextMonth)
    setClock(dateFromElapsed(elapsedDays.current))
    parkMap.current?.setElapsedDays(elapsedDays.current)
  }
  const debugControls = import.meta.env.DEV ? (
    <button type="button" className="park-action-button park-debug-button" onClick={jumpToMonthEnd}>
      月末
    </button>
  ) : null
  const speedControls = (
    <span className="park-time-actions">
      <button
        type="button"
        className={timePaused ? 'park-action-button selected' : 'park-action-button'}
        aria-label={paused ? '再開' : '停止'}
        title={paused ? '再開' : '停止'}
        onClick={() => setPaused((current) => !current)}
      >
        <PauseIcon />
      </button>
      <button
        type="button"
        className={timePaused ? 'park-action-button' : 'park-action-button selected'}
        aria-label={`速度: ${game.speeds[speedIndex].label}`}
        title={game.speeds[speedIndex].label}
        onClick={cycleSpeed}
      >
        <SpeedIcon count={speedIndex + 1} />
      </button>
    </span>
  )
  // メニューや確認を出している間は、マップへのクリックを届かせない
  const mapBlocked = menuItems !== null || confirmPrompt !== null
  // 設定に出てこないぶんの数値。広い画面ではメニューの反対側、狭い画面では上部のバーの下に置く
  const statusPanel = parkMode === 'facilitySettings' && facilitySettings ? (
    <div className="park-status-panel" aria-label={`${facilitySettings.title} のようす`}>
      {facilitySettings.status.map((entry) => (
        <div className="park-status-row" key={entry.label}>
          <img className="park-status-icon" src={`/assets/park/menu-icon-${entry.icon}.png`} alt="" />
          <span>{entry.label}</span>
          <span className="park-status-value">{entry.value}</span>
        </div>
      ))}
    </div>
  ) : null

  return (
    <main
      className="app-shell"
      onContextMenu={(event) => {
        event.preventDefault()
        // 右クリックは、どのモードにも入っていなければメニューを開く。
        // メニュー表示中や設置などの操作中はキャンセル
        if (screen === 'park' && !mapBlocked && parkMode === 'map') action('menu')
        else action('cancel')
      }}
    >
      <GamepadController
        onAction={action}
        swapConfirm={controls.swapConfirm}
        onCameraPan={(deltaX, deltaY) => parkMap.current?.panCamera(deltaX, deltaY)}
      />
      {screen === 'title' ? (
        <section className="title-screen" aria-label="開始画面">
          <p className="logo-subtitle">NEW THEME PARK</p>
          <h1>新テーマパーク</h1>
          <div className="mode-select">
            {titleMenus[titleStep].map((item, index) => (
              <button
                className={index === titleIndex ? 'primary-button selected' : 'primary-button'}
                key={item.id}
                disabled={!item.enabled}
                onMouseEnter={() => setTitleIndex(index)}
                onFocus={() => setTitleIndex(index)}
                onClick={() => activateTitleItem(titleStep, index)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      ) : screen === 'country' ? (
        <section className="country-screen" aria-label="国選択画面">
          <p className="logo-subtitle">スタンダード</p>
          <div className="country-grid">
            {countries.map((country, index) => (
              <button
                className={index === selectedCountry ? 'country-button selected' : 'country-button'}
                key={country.id}
                onClick={() => startNewGame(index)}
              >
                <span>{country.name}</span>
                <small>{country.map.width} × {country.map.height}</small>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="park-screen" aria-label="パーク画面">
          <div className="park-view">
          <Suspense fallback={null}>
            <ParkMap
              ref={parkMap}
              country={selected}
              roadBuildMode={parkMode === 'pathBuild' ? 'path' : parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' ? 'queue' : parkMode === 'stairsBuild' ? 'stairs' : null}
              attractionBuild={parkMode === 'attractionBuild' ? countryAttractions[attractionMenuIndex] : null}
              attractionBuildStep={attractionBuildStep}
              shopBuild={parkMode === 'shopBuild' ? countryShops[shopMenuIndex] : null}
              facilityBuild={parkMode === 'facilityBuild' ? countryFacilities[facilityMenuIndex] : null}
              onFacilityPlaced={(cost) => setCash((current) => current - cost)}
              onFacilityBuildStep={setFacilityBuildStep}
              onStairsBuildStep={setStairsBuildStep}
              availableCash={cash}
              onAttractionPlaced={(cost) => {
                setCash((current) => current - cost)
                setAttractionBuildStep('entrance')
              }}
              onAttractionPlacementCancelled={(cost) => setCash((current) => current + cost)}
              onAttractionAccessPlaced={(step) => {
                if (step === 'entrance') setAttractionBuildStep('exit')
                else {
                  setAttractionBuildStep('body')
                  setParkMode('attractionQueueBuild')
                }
              }}
              onShopPlaced={(cost) => setCash((current) => current - cost)}
              onShopBuildStep={setShopBuildStep}
              onShopComplete={() => setParkMode('shopMenu')}
              onBuildMessage={setBuildMessage}
              onReady={() => setMapReady(true)}
              secondsPerDay={secondsPerDay}
              onAdmissionPaid={(fee) => setCash((current) => current + fee)}
              onShopSale={(amount) => setCash((current) => current + amount)}
              onGuestCountChange={setGuestCount}
              onFacilitySettings={(settings) => {
                setFacilitySettings(settings)
                setParkMode((current) => (
                  settings ? 'facilitySettings' : current === 'facilitySettings' ? 'map' : current
                ))
              }}
              onSpend={(cost) => setCash((current) => current - cost)}
              onRemoveConfirm={(name) => setConfirmPrompt({
                message: `${name} を撤去しますか？`,
                confirmLabel: '撤去する',
                onConfirm: () => parkMap.current?.resolveRemoval(true),
                onCancel: () => parkMap.current?.resolveRemoval(false),
              })}
              mapBlocked={mapBlocked}
              touchLayout={compact}
              initialPark={loadedPark}
              initialElapsedDays={elapsedDays.current}
            />
          </Suspense>
          <div className="park-hud-top">
            {buildModeLabel ? <div className="park-mode-label">{buildModeLabel}</div> : null}
            {/* 狭い画面では、モード名の下に続けてステータスを並べる */}
            {compact ? statusPanel : null}
            <div className="park-status-overlay">
              <span>{formatDate(clock)}</span>
              <span>資金: {cash.toLocaleString()}</span>
              <span>来園者: {guestCount.toLocaleString()}</span>
              {compact ? null : speedControls}
              {compact ? null : debugControls}
            </div>
          </div>
          {menuItems ? (
            <ParkMenu
              items={menuItems}
              selectedIndex={menuSelectedIndex}
              onPageSizeChange={setMenuPageSize}
              onSelect={selectMenuIndex}
              onConfirm={(index) => openMenuItem(parkMode, index)}
            />
          ) : null}
          {compact ? null : statusPanel}
          {compact ? (
            <>
              {/* メニューを開いている間は操作の主役になるので、薄くせず出す */}
              <DirectionPad solid={menuItems !== null} onDirection={action} />
              {/* 時間操作は十字とアクションボタンの間。デバッグ操作はその上に積む */}
              <div className="park-time-float">
                {debugControls}
                {speedControls}
              </div>
              {/* パッドと同じ配置・同じ割り当ての操作ボタン */}
              <div
                className="park-face"
                data-style={controls.buttonStyle}
                data-solid={menuItems ? 'true' : undefined}
                role="group"
                aria-label="操作ボタン"
              >
                <HoldButton className="park-face-button park-face-up" label="メニュー" repeat={false} onPress={() => action('menu')}>
                  <FaceIcon glyph={faceGlyphs[controls.buttonStyle].up} />
                </HoldButton>
                <HoldButton
                  className="park-face-button park-face-right"
                  label={controls.swapConfirm ? '決定' : 'キャンセル'}
                  repeat={false}
                  onPress={() => action(controls.swapConfirm ? 'confirm' : 'cancel')}
                  onRelease={controls.swapConfirm ? () => action('confirmRelease') : undefined}
                >
                  <FaceIcon glyph={faceGlyphs[controls.buttonStyle].right} />
                </HoldButton>
                <HoldButton
                  className="park-face-button park-face-down"
                  label={controls.swapConfirm ? 'キャンセル' : '決定'}
                  repeat={false}
                  onPress={() => action(controls.swapConfirm ? 'cancel' : 'confirm')}
                  onRelease={controls.swapConfirm ? undefined : () => action('confirmRelease')}
                >
                  <FaceIcon glyph={faceGlyphs[controls.buttonStyle].down} />
                </HoldButton>
                <HoldButton
                  className="park-face-button park-face-left"
                  label="撤去"
                  repeat={false}
                  onPress={() => action('remove')}
                  onRelease={() => action('removeRelease')}
                >
                  <FaceIcon glyph={faceGlyphs[controls.buttonStyle].left} />
                </HoldButton>
              </div>
            </>
          ) : null}
          </div>
          <div className="park-bottom">
            <div className="park-status-bar">{statusBarText}</div>
          </div>
          {/* 最初の読み込みと月替わりの暗転。どちらも明けるときにフェードさせる */}
          <div
            className="park-blackout"
            style={{ transitionDuration: `${blackoutFadeMs}ms` }}
            data-visible={mapReady ? undefined : 'true'}
            aria-hidden={mapReady}
          >
            <ParkLoading messages={loadingMessages} />
          </div>
          <div
            className="park-blackout"
            style={{ transitionDuration: `${blackoutFadeMs}ms` }}
            data-visible={monthChanging ? 'true' : undefined}
            aria-hidden={!monthChanging}
          >
            <ParkLoading messages={monthChangeMessages} />
          </div>
        </section>
      )}
      {screen === 'country' || (screen === 'title' && titleStep === 'mode') ? (
        <div className="screen-control-bar">
          {screen === 'country' ? <span>開始時の資金: {game.park.initialCash.toLocaleString()}</span> : <span />}
          <button
            className="secondary-button"
            onClick={() => {
              if (screen === 'country') setScreen('title')
              else {
                setTitleStep('menu')
                setTitleIndex(0)
              }
            }}
          >
            戻る
          </button>
        </div>
      ) : null}
      {confirmPrompt ? (
        <div className="park-confirm" role="dialog" aria-label="確認">
          <p>{confirmPrompt.message}</p>
          <div className="park-confirm-buttons">
            <button className="primary-button" onClick={() => answerConfirm(true)}>{confirmPrompt.confirmLabel}</button>
            <button className="secondary-button" onClick={() => answerConfirm(false)}>やめる</button>
          </div>
        </div>
      ) : null}
    </main>
  )
}
