import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import countries from './config/countries.json'
import attractions from './config/attractions.json'
import shops from './config/shops.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import type { ParkMapHandle } from './components/ParkMap'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild' | 'queueBuild' | 'attractionMenu' | 'attractionBuild' | 'attractionQueueBuild' | 'shopMenu' | 'shopBuild'
const mainMenuModeById: Record<string, ParkMode> = { roads: 'roadMenu', attractions: 'attractionMenu', shops: 'shopMenu' }
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
const countryColumns = 2
const titleMenus = {
  menu: [
    { id: 'new', label: 'ニューゲーム', enabled: true },
    { id: 'load', label: 'ロードゲーム', enabled: false },
    { id: 'training', label: 'トレーニング', enabled: false },
  ],
  mode: [
    { id: 'standard', label: 'スタンダード', enabled: true },
    { id: 'scenario', label: 'シナリオ', enabled: false },
  ],
} as const

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
  const [shopBuildStep, setShopBuildStep] = useState<'body' | 'direction'>('body')
  const [attractionBuildStep, setAttractionBuildStep] = useState<AttractionBuildStep>('body')
  const [cash, setCash] = useState(game.park.initialCash)
  const [titleStep, setTitleStep] = useState<'menu' | 'mode'>('menu')
  const [titleIndex, setTitleIndex] = useState(0)
  const [buildMessage, setBuildMessage] = useState('')

  const activateTitleItem = useCallback((step: 'menu' | 'mode', index: number) => {
    if (!titleMenus[step][index]?.enabled) return
    if (step === 'menu') {
      setTitleStep('mode')
      setTitleIndex(0)
    }
    else {
      logGameEvent('mode_selected', { mode: 'standard' })
      setScreen('country')
    }
  }, [])

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
        else setAttractionMenuIndex((current) => moveMenu(current, input, attractions.length))
        return
      }
      if (parkMode === 'attractionBuild' && input === 'cancel') {
        setParkMode('attractionMenu')
        return
      }
      if (parkMode === 'shopMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm') setParkMode('shopBuild')
        else setShopMenuIndex((current) => moveMenu(current, input, shops.length))
        return
      }
      if (parkMode === 'shopBuild' && input === 'cancel') {
        if (shopBuildStep === 'direction') parkMap.current?.handleAction('cancel')
        else setParkMode('shopMenu')
        return
      }
      const mapAction = input === 'left' || input === 'right' || input === 'up' || input === 'down'
        || input === 'zoomIn' || input === 'zoomOut'
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'attractionBuild' || parkMode === 'shopBuild') && (input === 'confirm' || input === 'confirmRelease'))
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild') && input === 'remove')
      if (mapAction) parkMap.current?.handleAction(input)
      return
    }

    if (input === 'cancel') {
      setScreen('title')
      return
    }
    if (input === 'confirm') {
      logGameEvent('country_selected', { country: countries[selectedCountry].id })
      setParkMode('map')
      setCash(game.park.initialCash)
      setScreen('park')
      return
    }

    const nextCountry = moveCountry(selectedCountry, input)
    if (nextCountry === selectedCountry) return
    setSelectedCountry(nextCountry)
  }, [screen, selectedCountry, parkMode, mainMenuIndex, roadMenuIndex, shopBuildStep, titleStep, titleIndex, activateTitleItem])

  const selected = countries[selectedCountry]

  useEffect(() => setBuildMessage(''), [parkMode])

  const menuItems = parkMode === 'mainMenu' || parkMode === 'roadMenu'
    ? (parkMode === 'mainMenu' ? parkMenu.main : parkMenu.roads).map((item) => ({
      ...item,
      iconSrc: `/assets/park/menu-icon-${item.icon}.png`,
    }))
    : parkMode === 'attractionMenu'
      ? attractions.map((attraction) => ({
        id: attraction.id,
        label: attraction.name,
        description: `設置費 ${attraction.constructionCost.toLocaleString()}　${attraction.width} × ${attraction.height} マス`,
        iconSrc: `/assets/park/attraction-icons/${attraction.id}.png`,
        enabled: true,
      }))
      : parkMode === 'shopMenu'
        ? shops.map((shop) => ({
          id: shop.id,
          label: shop.name,
          description: `設置費 ${shop.constructionCost.toLocaleString()}　${shop.width} × ${shop.height} マス`,
          iconSrc: `/assets/park/shop-icons/${shop.id}.png`,
          enabled: true,
        }))
        : null
  const menuSelectedIndex = parkMode === 'mainMenu' ? mainMenuIndex : parkMode === 'roadMenu' ? roadMenuIndex : parkMode === 'shopMenu' ? shopMenuIndex : attractionMenuIndex
  const buildModeLabel = parkMode === 'pathBuild'
    ? '歩道設置中'
    : parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild'
      ? '整列歩道設置中'
      : parkMode === 'attractionBuild'
        ? attractionBuildStep === 'body'
          ? `${attractions[attractionMenuIndex].name} 設置中`
          : attractionBuildStep === 'entrance' ? '入口設置中' : '出口設置中'
        : parkMode === 'shopBuild'
          ? shopBuildStep === 'direction' && shops[shopMenuIndex].directions > 1
            ? '向きを選んでください'
            : `${shops[shopMenuIndex].name} 設置中`
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
                onClick={() => {
                  logGameEvent('country_selected', { country: country.id })
                  setSelectedCountry(index)
                  setParkMode('map')
                  setCash(game.park.initialCash)
                  setScreen('park')
                }}
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
              attractionBuild={parkMode === 'attractionBuild' ? attractions[attractionMenuIndex] : null}
              attractionBuildStep={attractionBuildStep}
              shopBuild={parkMode === 'shopBuild' ? shops[shopMenuIndex] : null}
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
            />
          </Suspense>
          <div className="park-status-overlay">
            <span>{game.park.startDate.replaceAll('-', ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}</span>
            <span>資金: {cash.toLocaleString()}</span>
          </div>
          {menuItems ? (
            <ParkMenu
              items={menuItems}
              selectedIndex={menuSelectedIndex}
              onSelect={parkMode === 'mainMenu' ? setMainMenuIndex : parkMode === 'roadMenu' ? setRoadMenuIndex : parkMode === 'shopMenu' ? setShopMenuIndex : setAttractionMenuIndex}
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
