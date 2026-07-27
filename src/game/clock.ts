import game from '../config/game.json'

const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
export const daysInMonth = (year: number, month: number) => (
  month === 2 && isLeapYear(year) ? 29 : daysPerMonth[month - 1]
)

const [startYear, startMonth, startDay] = game.park.startDate.split('-').map(Number)

export type GameDate = { year: number, month: number, day: number }

/** 経過日数から日付を求める。時刻は扱わない。 */
export function dateFromElapsed(elapsedDays: number): GameDate {
  let year = startYear
  let month = startMonth
  let day = startDay + Math.floor(elapsedDays)
  while (day > daysInMonth(year, month)) {
    day -= daysInMonth(year, month)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return { year, month, day }
}

const pad = (value: number) => String(value).padStart(2, '0')
export const formatDate = ({ year, month, day }: GameDate) => `${year}/${pad(month)}/${pad(day)}`

/** 実時間 1 ミリ秒あたりに進むゲーム内の日数。速度が変わったときに 1 回だけ求める。 */
export const gameDaysPerMs = (secondsPerDay: number) => 1 / (secondsPerDay * 1000)
