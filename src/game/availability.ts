import countryAvailability from '../config/countryAvailability.json'

type Entry = { countries: string | string[] }
type Variant = { name: string, width: number, height: number, constructionCost: number }
type Kind = 'attractions' | 'shops' | 'facilities'

const availability = countryAvailability as unknown as
  & Record<Kind, Record<string, Entry | undefined>>
  & { countryVariants: Record<string, Record<string, Variant | undefined> | undefined> }

// countryAvailability.json に載っていない項目は全国で設置できる扱いにする
const isAvailable = (kind: Kind, id: string, country: string) => {
  const entry = availability[kind][id]
  if (!entry) return true
  return entry.countries === 'all' || entry.countries.includes(country)
}

const variantOf = (id: string, country: string) => availability.countryVariants[id]?.[country]

/** その国で設置できるものだけに絞り、国別に名前や大きさが変わるものは差し替える。 */
export function forCountry<T extends { id: string }>(items: readonly T[], kind: Kind, country: string) {
  return items
    .filter((item) => isAvailable(kind, item.id, country))
    .map((item) => {
      const variant = variantOf(item.id, country)
      return (variant ? { ...item, ...variant } : item) as T
    })
}
