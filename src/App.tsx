import { lazy, Suspense, useCallback, useState } from 'react'
import countries from './config/countries.json'
import game from './config/game.json'
import parkMenu from './config/parkMenu.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import ParkMenu from './components/ParkMenu'
import { logGameEvent } from './game/log'

const ParkMap = lazy(() => import('./components/ParkMap'))

type Screen = 'title' | 'country' | 'park'
type ParkMode = 'map' | 'mainMenu' | 'roadMenu' | 'pathBuild'
type MovementEvent = { direction: MenuAction, serial: number }
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
  const [movement, setMovement] = useState<{ events: MovementEvent[] }>({ events: [] })
  const [parkMode, setParkMode] = useState<ParkMode>('map')
  const [mainMenuIndex, setMainMenuIndex] = useState(0)
  const [roadMenuIndex, setRoadMenuIndex] = useState(0)

  const action = useCallback((input: MenuAction) => {
    if (screen === 'title') {
      if (input === 'confirm') {
        logGameEvent('mode_selected', { mode: 'standard' })
        setScreen('country')
      }
      return
    }

    if (screen === 'park') {
      if (input === 'menu') {
        setParkMode((current) => current === 'map' ? 'mainMenu' : 'map')
        return
      }
      if (parkMode === 'mainMenu') {
        if (input === 'cancel') setParkMode('map')
        else if (input === 'confirm' && parkMenu.main[mainMenuIndex].enabled) setParkMode('roadMenu')
        else setMainMenuIndex((current) => moveMenu(current, input, parkMenu.main.length))
        return
      }
      if (parkMode === 'roadMenu') {
        if (input === 'cancel') setParkMode('mainMenu')
        else if (input === 'confirm' && parkMenu.roads[roadMenuIndex].id === 'path') setParkMode('pathBuild')
        else setRoadMenuIndex((current) => moveMenu(current, input, parkMenu.roads.length))
        return
      }
      if (parkMode === 'pathBuild' && input === 'cancel') {
        setParkMode('roadMenu')
        return
      }
      if (input === 'left' || input === 'right' || input === 'up' || input === 'down' || input === 'zoomIn' || input === 'zoomOut' || (parkMode === 'pathBuild' && (input === 'confirm' || input === 'confirmRelease' || input === 'remove'))) {
        setMovement((current) => {
          const serial = (current.events[current.events.length - 1]?.serial ?? 0) + 1
          return { events: [...current.events, { direction: input, serial }].slice(-16) }
        })
      }
      return
    }

    if (input === 'cancel') {
      setScreen('title')
      return
    }
    if (input === 'confirm') {
      logGameEvent('country_selected', { country: countries[selectedCountry].id })
      setParkMode('map')
      setMovement({ events: [] })
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
                  setMovement({ events: [] })
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
          <p className="control-help">ゲームパッド: 十字キーで選択　A / START で決定　B で戻る</p>
        </section>
      ) : (
        <section className="park-screen" aria-label="パーク画面">
          <Suspense fallback={<div className="map-loading">マップを読み込み中...</div>}>
            <ParkMap country={selected} movement={movement} pathBuildMode={parkMode === 'pathBuild'} />
          </Suspense>
          <div className="park-status-overlay">
            <span>{game.park.startDate.replaceAll('-', ' 年 ').replace(/ 年 (\d+)$/, ' 月 $1 日')}</span>
            <span>資金: {game.park.initialCash.toLocaleString()}</span>
          </div>
          {parkMode === 'mainMenu' || parkMode === 'roadMenu' ? (
            <ParkMenu
              items={parkMode === 'mainMenu' ? parkMenu.main : parkMenu.roads}
              selectedIndex={parkMode === 'mainMenu' ? mainMenuIndex : roadMenuIndex}
              onSelect={parkMode === 'mainMenu' ? setMainMenuIndex : setRoadMenuIndex}
              onConfirm={(index) => {
                if (parkMode === 'mainMenu' && parkMenu.main[index].enabled) {
                  setMainMenuIndex(index)
                  setParkMode('roadMenu')
                }
                if (parkMode === 'roadMenu' && parkMenu.roads[index].id === 'path') {
                  setRoadMenuIndex(index)
                  setParkMode('pathBuild')
                }
              }}
            />
          ) : null}
          {parkMode === 'pathBuild' ? <div className="build-mode-overlay">歩道設置中</div> : null}
        </section>
      )}
    </main>
  )
}
