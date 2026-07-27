import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import countries from './config/countries.json'
import attractions from './config/attractions.json'
import shops from './config/shops.json'
import facilities from './config/facilities.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import type { ParkMapHandle } from './components/ParkMap'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'
import { forCountry } from './game/availability'
import { dateFromElapsed, formatDate, gameDaysPerMs } from './game/clock'
import { readSave, writeSave, SAVE_VERSION, type ParkSnapshot, type SaveMode } from './game/save'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild' | 'queueBuild' | 'attractionMenu' | 'attractionBuild' | 'attractionQueueBuild' | 'shopMenu' | 'shopBuild' | 'facilityMenu' | 'facilityBuild'
const mainMenuModeById: Record<string, ParkMode> = { roads: 'roadMenu', attractions: 'attractionMenu', shops: 'shopMenu', facilities: 'facilityMenu' }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
const countryColumns = 2

function moveMenu(index: number, input: MenuAction, length: number) {
  if (input === 'left' || input === 'up') return (index - 1 + length) % length
  if (input === 'right' || input === 'down') return (index + 1) % length
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
  const [attractionBuildStep, setAttractionBuildStep] = useState<AttractionBuildStep>('body')
  const [cash, setCash] = useState(game.park.initialCash)
  const [titleStep, setTitleStep] = useState<'menu' | 'mode'>('menu')
  const [titleIndex, setTitleIndex] = useState(0)
  const [buildMessage, setBuildMessage] = useState('')
  const [speedIndex, setSpeedIndex] = useState(game.time.defaultSpeedIndex)
  const [guestCount, setGuestCount] = useState(0)
  const [clock, setClock] = useState(() => dateFromElapsed(0))
  const elapsedDays = useRef(0)
  const [mode, setMode] = useState<SaveMode>('standard')
  const [savedGame, setSavedGame] = useState(() => readSave('standard', null))
  // セーブから再開するときだけ中身が入る。ニューゲームでは null
  const [loadedPark, setLoadedPark] = useState<ParkSnapshot | null>(null)

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

  // パーク画面にいる間だけ日付を進める。表示は日が変わったときだけ更新する
  const secondsPerDay = game.speeds[speedIndex].secondsPerDay
  useEffect(() => {
    if (screen !== 'park') return
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
  const startNewGame = useCallback((countryIndex: number) => {
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
  const countryAttractions = useMemo(() => forCountry(attractions, 'attractions', selected.id), [selected.id])
  const countryShops = useMemo(() => forCountry(shops, 'shops', selected.id), [selected.id])
  const countryFacilities = useMemo(() => forCountry(facilities, 'facilities', selected.id), [selected.id])

  const action = useCallback((input: MenuAction) => {
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
      if (parkMode === 'mainMenu') {
        if (input === 'cancel') setParkMode('map')
        else if (input === 'confirm' && parkMenu.main[mainMenuIndex].enabled) {
          setParkMode(mainMenuModeById[parkMenu.main[mainMenuIndex].id] ?? 'roadMenu')
        }
        else setMainMenuIndex((current) => moveMenu(current, input, parkMenu.main.length))
        return
      }
      if (parkMode === 'roadMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm' && parkMenu.roads[roadMenuIndex].enabled) {
          const road = parkMenu.roads[roadMenuIndex].id
          if (road === 'path') setParkMode('pathBuild')
          if (road === 'queue') setParkMode('queueBuild')
        }
        else setRoadMenuIndex((current) => moveMenu(current, input, parkMenu.roads.length))
        return
      }
      if ((parkMode === 'pathBuild' || parkMode === 'queueBuild') && input === 'cancel') {
        setParkMode('roadMenu')
        return
      }
      if (parkMode === 'attractionQueueBuild' && input === 'cancel') {
        setParkMode('attractionMenu')
        return
      }
      if (parkMode === 'attractionMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') {
          setAttractionBuildStep('body')
          setParkMode('attractionBuild')
        }
        else setAttractionMenuIndex((current) => moveMenu(current, input, countryAttractions.length))
        return
      }
      if (parkMode === 'attractionBuild' && input === 'cancel') {
        setParkMode('attractionMenu')
        return
      }
      if (parkMode === 'shopMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') setParkMode('shopBuild')
        else setShopMenuIndex((current) => moveMenu(current, input, countryShops.length))
        return
      }
      if (parkMode === 'shopBuild' && input === 'cancel') {
        if (shopBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('shopMenu')
        return
      }
      if (parkMode === 'facilityMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') setParkMode('facilityBuild')
        else setFacilityMenuIndex((current) => moveMenu(current, input, countryFacilities.length))
        return
      }
      if (parkMode === 'facilityBuild' && input === 'cancel') {
        if (facilityBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('facilityMenu')
        return
      }
      const mapAction = input === 'left' || input === 'right' || input === 'up' || input === 'down'
        || input === 'zoomIn' || input === 'zoomOut'
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'attractionBuild' || parkMode === 'shopBuild' || parkMode === 'facilityBuild') && (input === 'confirm' || input === 'confirmRelease'))
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'facilityBuild') && input === 'remove')
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
  }, [screen, selectedCountry, parkMode, mainMenuIndex, roadMenuIndex, shopBuildStep, facilityBuildStep, titleStep, titleIndex, activateTitleItem, startNewGame, countryAttractions, countryShops, countryFacilities])


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
            iconSrc: `/assets/park/facility-icons/${facility.id}.png`,
            enabled: true,
          }))
          : null
  const menuSelectedIndex = parkMode === 'mainMenu' ? mainMenuIndex : parkMode === 'roadMenu' ? roadMenuIndex : parkMode === 'shopMenu' ? shopMenuIndex : parkMode === 'facilityMenu' ? facilityMenuIndex : attractionMenuIndex
  const buildModeLabel = parkMode === 'pathBuild'
    ? '歩道設置中'
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

  return (
    <main
      className="app-shell"
      onContextMenu={(event) => {
        event.preventDefault()
        if (screen === 'park') action(parkMode === 'map' ? 'menu' : 'cancel')
        else action('cancel')
      }}
    >
      <GamepadController onAction={action} />
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
              roadBuildMode={parkMode === 'pathBuild' ? 'path' : parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' ? 'queue' : null}
              attractionBuild={parkMode === 'attractionBuild' ? countryAttractions[attractionMenuIndex] : null}
              attractionBuildStep={attractionBuildStep}
              shopBuild={parkMode === 'shopBuild' ? countryShops[shopMenuIndex] : null}
              facilityBuild={parkMode === 'facilityBuild' ? countryFacilities[facilityMenuIndex] : null}
              onFacilityPlaced={(cost) => setCash((current) => current - cost)}
              onFacilityBuildStep={setFacilityBuildStep}
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
              onGuestCountChange={setGuestCount}
              initialPark={loadedPark}
            />
          </Suspense>
          <div className="park-status-overlay">
            <span>{formatDate(clock)}</span>
            <span>資金: {cash.toLocaleString()}</span>
            <span>来園者: {guestCount.toLocaleString()}</span>
            <span className="park-speed">
              {game.speeds.map((speed, index) => (
                <button
                  key={speed.id}
                  type="button"
                  className={index === speedIndex ? 'park-speed-button selected' : 'park-speed-button'}
                  onClick={() => setSpeedIndex(index)}
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
              onSelect={parkMode === 'mainMenu' ? setMainMenuIndex : parkMode === 'roadMenu' ? setRoadMenuIndex : parkMode === 'shopMenu' ? setShopMenuIndex : parkMode === 'facilityMenu' ? setFacilityMenuIndex : setAttractionMenuIndex}
              onConfirm={(index) => {
                if (parkMode === 'mainMenu' && parkMenu.main[index].enabled) {
                  setMainMenuIndex(index)
                  setParkMode(mainMenuModeById[parkMenu.main[index].id] ?? 'roadMenu')
                }
                if (parkMode === 'roadMenu' && parkMenu.roads[index].enabled) {
                  setRoadMenuIndex(index)
                  if (parkMenu.roads[index].id === 'path') setParkMode('pathBuild')
                  if (parkMenu.roads[index].id === 'queue') setParkMode('queueBuild')
                }
                if (parkMode === 'attractionMenu') {
                  setAttractionMenuIndex(index)
                  setAttractionBuildStep('body')
                  setParkMode('attractionBuild')
                }
                if (parkMode === 'shopMenu') {
                  setShopMenuIndex(index)
                  setParkMode('shopBuild')
                }
                if (parkMode === 'facilityMenu') {
                  setFacilityMenuIndex(index)
                  setParkMode('facilityBuild')
                }
              }}
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
    </main>
  )
}
