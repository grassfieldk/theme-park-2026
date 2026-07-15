type Item = {
  id: string
  label: string
  description: string
  enabled: boolean
}

type Props = {
  items: Item[]
  selectedIndex: number
  onSelect: (index: number) => void
  onConfirm: (index: number) => void
}

export default function ParkMenu({ items, selectedIndex, onSelect, onConfirm }: Props) {
  const selected = items[selectedIndex]

  return (
    <nav className="park-menu" aria-label="パークメニュー">
      <div className="park-menu-description">{selected.description}</div>
      <div className="park-menu-items">
        {items.map((item, index) => (
          <button
            className={index === selectedIndex ? 'park-menu-item selected' : 'park-menu-item'}
            key={item.id}
            aria-current={index === selectedIndex ? 'true' : undefined}
            aria-disabled={!item.enabled}
            onFocus={() => onSelect(index)}
            onClick={() => onConfirm(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
