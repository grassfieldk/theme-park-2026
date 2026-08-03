import { useEffect, useRef, type ReactNode } from 'react'

type Item = {
  id: string
  label: string
  description: string
  iconSrc?: string
  /** 設定メニューの現在値。行の右端に出す */
  value?: ReactNode
  enabled: boolean
}

type Props = {
  items: Item[]
  selectedIndex: number
  onSelect: (index: number) => void
  onConfirm: (index: number) => void
  // 一度に見えている行数。左右キーのページ移動量に使う
  onPageSizeChange?: (pageSize: number) => void
}

export default function ParkMenu({ items, selectedIndex, onSelect, onConfirm, onPageSizeChange }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // 表示領域と行の高さから、画面に収まっている行数を測って親へ伝える。
  // 画面サイズやリストの中身が変わるたびに測り直す
  useEffect(() => {
    const list = listRef.current
    if (!list || !onPageSizeChange) return
    const measure = () => {
      const item = list.children[0] as HTMLElement | undefined
      if (!item) return
      const visible = Math.floor(list.clientHeight / item.offsetHeight)
      onPageSizeChange(Math.max(1, visible))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [items, onPageSizeChange])

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
            {item.value}
          </button>
        ))}
      </div>
    </nav>
  )
}
