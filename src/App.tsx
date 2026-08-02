import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import countries from './config/countries.json'
import attractions from './config/attractions.json'
import shops from './config/shops.json'
import facilities from './config/facilities.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import seasons from './config/seasons.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import type { ParkMapHandle } from './components/ParkMap'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'
import { forCountry } from './game/availability'
import { dateFromElapsed, formatDate, gameDaysPerMs } from './game/clock'
import { readSave, writeSave, SAVE_VERSION, type ParkSnapshot, type SaveMode } from './game/save'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild' | 'queueBuild' | 'stairsBuild' | 'attractionMenu' | 'attractionBuild' | 'attractionQueueBuild' | 'shopMenu' | 'shopBuild' | 'facilityMenu' | 'facilityBuild'
const mainMenuModeById: Record<string, ParkMode> = { roads: 'roadMenu', attractions: 'attractionMenu', shops: 'shopMenu', facilities: 'facilityMenu' }
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

function moveCountry(index: number, input: MenuAction) {
  const lastRowStart = countries.length - countryColumns
  if (input === 'left') return index % countryColumns === 0 ? index + countryColumns - 1 : index - 1
  if (input === 'right') return index % countryColumns === countryColumns - 1 ? index - countryColumns + 1 : index + 1
  if (input === 'up') return index < countryColumns ? index + lastRowStart : index - countryColumns
  if (input === 'down') return index >= lastRowStart ? index - lastRowStart : index + countryColumns
  return index
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [selectedCountry, setSelectedCountry] = useState(0)
  const parkMap = useRef<ParkMapHandle>(null)
  const [parkMode, setParkMode] = useState<ParkMode>('map')
  const [mainMenuIndex, setMainMenuIndex] = useState(0)
  const [roadMenuIndex, setRoadMenuIndex] = useState(0)
  const [attractionMenuIndex, setAttractionMenuIndex] = useState(0)
  const [shopMenuIndex, setShopMenuIndex] = useState(0)
  const [facilityMenuIndex, setFacilityMenuIndex] = useState(0)
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
  }, [])

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
      if (parkMode === 'facilityBuild' && input === 'cancel') {
        if (facilityBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('facilityMenu')
        return
      }
      const mapAction = input === 'left' || input === 'right' || input === 'up' || input === 'down'
        || input === 'zoomIn' || input === 'zoomOut'
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'stairsBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'attractionBuild' || parkMode === 'shopBuild' || parkMode === 'facilityBuild') && (input === 'confirm' || input === 'confirmRelease'))
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
  }, [screen, selectedCountry, parkMode, mainMenuIndex, roadMenuIndex, attractionMenuIndex, shopMenuIndex, facilityMenuIndex, menuPageSize, shopBuildStep, facilityBuildStep, stairsBuildStep, titleStep, titleIndex, confirmPrompt, answerConfirm, activateTitleItem, openMenuItem, startNewGame, countryAttractions, countryShops, countryFacilities])


  useEffect(() => setBuildMessage(''), [parkMode])

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

  const menuItems = parkMode === 'mainMenu' || parkMode === 'roadMenu'
    ? (parkMode === 'mainMenu' ? parkMenu.main : parkMenu.roads).map((item) => ({
      ...item,
      iconSrc: `/assets/park/menu-icon-${item.icon}.png`,
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
  const menuSelectedIndex = parkMode === 'mainMenu' ? mainMenuIndex : parkMode === 'roadMenu' ? roadMenuIndex : parkMode === 'shopMenu' ? shopMenuIndex : parkMode === 'facilityMenu' ? facilityMenuIndex : attractionMenuIndex
  const buildModeLabel = parkMode === 'pathBuild'
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
  const statusBarText = menuItems ? menuItems[menuSelectedIndex]?.description ?? '' : buildMessage || buildModeLabel
  // メニューや確認を出している間は、マップへのクリックを届かせない
  const mapBlocked = menuItems !== null || confirmPrompt !== null

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
          <Suspense fallback={<div className="map-loading">マップを読み込み中...</div>}>
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
              secondsPerDay={secondsPerDay}
              onAdmissionPaid={(fee) => setCash((current) => current + fee)}
              onShopSale={(amount) => setCash((current) => current + amount)}
              onGuestCountChange={setGuestCount}
              onRemoveConfirm={(name) => setConfirmPrompt({
                message: `${name} を撤去しますか？`,
                confirmLabel: '撤去する',
                onConfirm: () => parkMap.current?.resolveRemoval(true),
                onCancel: () => parkMap.current?.resolveRemoval(false),
              })}
              mapBlocked={mapBlocked}
              initialPark={loadedPark}
              initialElapsedDays={elapsedDays.current}
            />
          </Suspense>
          <div className="park-status-overlay">
            <span>{formatDate(clock)}</span>
            <span>資金: {cash.toLocaleString()}</span>
            <span>来園者: {guestCount.toLocaleString()}</span>
            <span className="park-speed">
              <button
                type="button"
                className={timePaused ? 'park-speed-button selected' : 'park-speed-button'}
                onClick={() => setPaused(true)}
              >
                停止
              </button>
              {game.speeds.map((speed, index) => (
                <button
                  key={speed.id}
                  type="button"
                  className={index === speedIndex && !timePaused ? 'park-speed-button selected' : 'park-speed-button'}
                  onClick={() => {
                    setSpeedIndex(index)
                    setPaused(false)
                  }}
                >
                  {speed.label}
                </button>
              ))}
            </span>
          </div>
          {menuItems ? (
            <ParkMenu
              items={menuItems}
              selectedIndex={menuSelectedIndex}
              onPageSizeChange={setMenuPageSize}
              onSelect={parkMode === 'mainMenu' ? setMainMenuIndex : parkMode === 'roadMenu' ? setRoadMenuIndex : parkMode === 'shopMenu' ? setShopMenuIndex : parkMode === 'facilityMenu' ? setFacilityMenuIndex : setAttractionMenuIndex}
              onConfirm={(index) => openMenuItem(parkMode, index)}
            />
          ) : null}
          <div className="park-status-bar">{statusBarText}</div>
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
