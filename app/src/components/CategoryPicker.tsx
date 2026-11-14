import { Check, ChevronDown, LayoutGrid } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_LABEL } from '../lib/format';
import type { Category } from '../types';

interface Props {
  value: Category[];
  onChange: (next: Category[]) => void;
}

/** Botão de categorias embutido na barra de busca, com lista de várias escolhas. */
export default function CategoryPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Fecha ao clicar fora ou apertar Esc (devolvendo o foco ao botão).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (c: Category) =>
    onChange(value.includes(c) ? value.filter((v) => v !== c) : CATEGORIES.filter((k) => k === c || value.includes(k)));

  const label =
    value.length === 0 ? 'Todas as categorias' : value.length === 1 ? CATEGORY_LABEL[value[0]] : `${value.length} categorias`;

  return (
    <div className="cat-picker" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="cat-picker-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        data-active={value.length > 0}
        onClick={() => setOpen((o) => !o)}
      >
        <LayoutGrid size={18} aria-hidden />
        <span className="cat-picker-label">{label}</span>
        {value.length > 0 && <span className="cat-picker-count">{value.length}</span>}
        <ChevronDown size={16} aria-hidden className="cat-picker-chev" />
      </button>

      {open && (
        <div id={menuId} className="cat-menu" role="group" aria-label="Categorias">
          <div className="cat-menu-head">
            <span className="small" style={{ fontWeight: 700 }}>
              Categorias
            </span>
            {value.length > 0 && (
              <button type="button" className="link-btn" onClick={() => onChange([])}>
                Limpar
              </button>
            )}
          </div>
          <div className="cat-menu-list">
            {CATEGORIES.map((c) => {
              const on = value.includes(c);
              return (
                <label key={c} className="cat-option" data-on={on}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c)} />
                  <span className="cat-check" aria-hidden>
                    {on && <Check size={14} strokeWidth={3} />}
                  </span>
                  {CATEGORY_LABEL[c]}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
