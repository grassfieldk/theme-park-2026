import { useEffect, useRef } from 'react'

type Item = {
  id: string
  label: string
  description: string
  iconSrc?: string
  enabled: boolean
}

type Props = {
  items: Item[]
  selectedIndex: number
  onSelect: (index: number) => void
  onConfirm: (index: number) => void
}

export default function ParkMenu({ items, selectedIndex, onSelect, onConfirm }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <nav className="park-menu" aria-label="パークメニュー">
      <div className="park-menu-items" ref={listRef}>
        {items.map((item, index) => (
          <button
            className={index === selectedIndex ? 'park-menu-item selected' : 'park-menu-item'}
            key={item.id}
            aria-current={index === selectedIndex ? 'true' : undefined}
            aria-disabled={!item.enabled}
            onFocus={() => onSelect(index)}
            onMouseEnter={() => onSelect(index)}
            onClick={() => onConfirm(index)}
          >
            {item.iconSrc ? (
              <img className="park-menu-icon" src={item.iconSrc} alt="" />
            ) : null}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
