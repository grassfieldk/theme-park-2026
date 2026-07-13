import { useCallback, useState } from 'react'
import countries from './config/countries.json'
import game from './config/game.json'
import { GamepadController, type MenuAction } from './components/GamepadController'
import { logGameEvent } from './game/log'

type Screen = 'title' | 'country'
const countryColumns = 2

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
  const [confirmedCountry, setConfirmedCountry] = useState<number | null>(null)

  const action = useCallback((input: MenuAction) => {
    if (screen === 'title') {
      if (input === 'confirm') {
        logGameEvent('mode_selected', { mode: 'standard', input: 'gamepad' })
        setScreen('country')
      }
      return
    }

    if (input === 'cancel') {
      setScreen('title')
      return
    }
    if (input === 'confirm') {
      logGameEvent('country_selected', { country: countries[selectedCountry].id, input: 'gamepad' })
      setConfirmedCountry(selectedCountry)
      return
    }

    const nextCountry = moveCountry(selectedCountry, input)
    if (nextCountry === selectedCountry) return
    setConfirmedCountry(null)
    setSelectedCountry(nextCountry)
  }, [screen, selectedCountry])

  const selected = countries[selectedCountry]

  return (
    <main className="app-shell">
      <GamepadController onAction={action} />
      {screen === 'title' ? (
        <section className="menu-card title-card" aria-label="開始画面">
          <p className="logo-subtitle">NEW THEME PARK</p>
          <h1>新テーマパーク</h1>
          <p>テーマパーク経営シミュレーション</p>
          <button className="primary-button" onClick={() => {
            logGameEvent('mode_selected', { mode: 'standard', input: 'mouse' })
            setScreen('country')
          }}>スタンダードを始める</button>
          <p className="control-help">ゲームパッド: 十字キーで選択　A / START で決定</p>
        </section>
      ) : (
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
                  logGameEvent('country_selected', { country: country.id, input: 'mouse' })
                  setSelectedCountry(index)
                  setConfirmedCountry(index)
                }}
              >
                <span>{country.name}</span>
                <small>{country.map.width} × {country.map.height} タイル</small>
              </button>
            ))}
          </div>
          <div className="selection-status">
            {confirmedCountry === null ? `${selected.name} を選択中` : `${selected.name} を選択しました`}
          </div>
          <div className="country-footer">
            <span>開始時の資金: {game.park.initialCash.toLocaleString()}</span>
            <button className="secondary-button" onClick={() => setScreen('title')}>戻る</button>
          </div>
          <p className="control-help">ゲームパッド: 十字キーで選択　A / START で決定　B で戻る</p>
        </section>
      )}
    </main>
  )
}
