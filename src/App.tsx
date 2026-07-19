import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import countries from './config/countries.json'
import attractions from './config/attractions.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import type { ParkMapHandle } from './components/ParkMap'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild' | 'queueBuild' | 'attractionMenu' | 'attractionBuild' | 'attractionQueueBuild'
type AttractionBuildStep = 'body' | 'entrance' | 'exit'
const countryColumns = 2

function moveMenu(index: number, input: MenuAction, length: number) {
  if (input === 'left') return (index - 1 + length) % length
  if (input === 'right') return (index + 1) % length
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
  const [attractionBuildStep, setAttractionBuildStep] = useState<AttractionBuildStep>('body')
  const [cash, setCash] = useState(game.park.initialCash)

  const action = useCallback((input: MenuAction) => {
    if (screen === 'title') {
      if (input === 'confirm' || input === 'start') {
        logGameEvent('mode_selected', { mode: 'standard' })
        setScreen('country')
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
          setParkMode(parkMenu.main[mainMenuIndex].id === 'attractions' ? 'attractionMenu' : 'roadMenu')
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
      const mapAction = input === 'left' || input === 'right' || input === 'up' || input === 'down'
        || input === 'zoomIn' || input === 'zoomOut'
        || ((parkMode === 'pathBuild' || parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' || parkMode === 'attractionBuild') && (input === 'confirm' || input === 'confirmRelease'))
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
  }, [screen, selectedCountry, parkMode, mainMenuIndex, roadMenuIndex])

  const selected = countries[selectedCountry]

  return (
    <main
      className="app-shell"
      onContextMenu={(event) => {
        event.preventDefault()
        if (screen === 'park') action(parkMode === 'map' ? 'menu' : 'cancel')
        else if (screen === 'country') action('cancel')
      }}
    >
      <GamepadController onAction={action} />
      {screen === 'title' ? (
        <section className="title-screen" aria-label="開始画面">
          <p className="logo-subtitle">NEW THEME PARK</p>
          <h1>新テーマパーク</h1>
          <p>テーマパーク経営シミュレーション</p>
          <button className="primary-button" onClick={() => {
            logGameEvent('mode_selected', { mode: 'standard' })
            setScreen('country')
          }}>スタンダードを始める</button>
          <p className="control-help">ゲームパッド: 十字キーで選択　A / START で決定</p>
        </section>
      ) : screen === 'country' ? (
        <section className="menu-card country-card" aria-label="国選択画面">
          <p className="logo-subtitle">STANDARD MODE</p>
          <h1>国を選んでください</h1>
          <p>国によって、パークとして使える土地の広さが変わります。</p>
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
                <small>{country.map.width} × {country.map.height} タイル</small>
              </button>
            ))}
          </div>
          <div className="selection-status">{selected.name} を選択中</div>
          <div className="country-footer">
            <span>開始時の資金: {game.park.initialCash.toLocaleString()}</span>
            <button className="secondary-button" onClick={() => setScreen('title')}>戻る</button>
          </div>
          <p className="control-help">ゲームパッド: 十字キーで選択　A で決定　B で戻る</p>
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
            />
          </Suspense>
          <div className="park-status-overlay">
            <span>{game.park.startDate.replaceAll('-', ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}</span>
            <span>資金: {cash.toLocaleString()}</span>
          </div>
          {parkMode === 'mainMenu' || parkMode === 'roadMenu' || parkMode === 'attractionMenu' ? (
            <ParkMenu
              items={parkMode === 'mainMenu' ? parkMenu.main : parkMode === 'roadMenu' ? parkMenu.roads : attractions.map((attraction) => ({
                id: attraction.id,
                label: attraction.name,
                description: `設置費 ${attraction.constructionCost.toLocaleString()}　${attraction.width} × ${attraction.height} マス`,
                enabled: true,
              }))}
              selectedIndex={parkMode === 'mainMenu' ? mainMenuIndex : parkMode === 'roadMenu' ? roadMenuIndex : attractionMenuIndex}
              onSelect={parkMode === 'mainMenu' ? setMainMenuIndex : parkMode === 'roadMenu' ? setRoadMenuIndex : setAttractionMenuIndex}
              onConfirm={(index) => {
                if (parkMode === 'mainMenu' && parkMenu.main[index].enabled) {
                  setMainMenuIndex(index)
                  setParkMode(parkMenu.main[index].id === 'attractions' ? 'attractionMenu' : 'roadMenu')
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
              }}
            />
          ) : null}
          {parkMode === 'pathBuild' ? <div className="build-mode-overlay">歩道設置中</div> : null}
          {parkMode === 'queueBuild' || parkMode === 'attractionQueueBuild' ? <div className="build-mode-overlay">整列歩道設置中</div> : null}
          {parkMode === 'attractionBuild' ? (
            <div className="build-mode-overlay">
              {attractionBuildStep === 'body'
                ? `${attractions[attractionMenuIndex].name} 設置中`
                : attractionBuildStep === 'entrance' ? '入口設置中' : '出口設置中'}
            </div>
          ) : null}
        </section>
      )}
    </main>
  )
}
