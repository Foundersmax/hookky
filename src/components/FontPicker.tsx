import { useEffect, useRef, useState } from "react";
import { FONT_GROUPS } from "../presets";
import { fontFamilies } from "../fonts";
import { useStudio } from "../store";
import { displayWeight } from "../engine/text";

/**
 * Pick a display font, seeing each one in its own typeface. `value` undefined means "the brand's
 * font" (shown first); uploaded brand fonts come next, then the built-ins by group.
 */
export function FontPicker({ value, onChange, label = "Font" }: { value?: string; onChange: (font: string | undefined) => void; label?: string }) {
  const brandFont = useStudio((s) => s.project.brand.fontDisplay);
  const assets = useStudio((s) => s.assets);
  const custom = fontFamilies(assets);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = value ?? brandFont;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    // Bring the chosen font into view.
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const choose = (f: string | undefined) => {
    onChange(f);
    setOpen(false);
  };
  const move = (dir: 1 | -1) => {
    const opts = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const i = opts.findIndex((o) => o === document.activeElement);
    opts[Math.max(0, Math.min(opts.length - 1, (i < 0 ? -1 : i) + dir))]?.focus();
  };
  const Option = ({ font, name, note }: { font: string; name?: string; note?: string }) => {
    const selected = name === "brand" ? value === undefined : value === font;
    return (
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={`font-opt ${selected ? "on" : ""}`}
        onClick={() => choose(name === "brand" ? undefined : font)}
        style={{ fontFamily: `"${font}", var(--sans)`, fontWeight: displayWeight(font) }}
      >
        <span className="font-sample">{name === "brand" ? font : font}</span>
        {note && <span className="font-note">{note}</span>}
      </button>
    );
  };

  return (
    <div className="field font-picker" ref={ref}>
      <span className="label">{label}</span>
      <button
        type="button"
        className="font-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "ArrowDown" && (e.preventDefault(), setOpen(true), setTimeout(() => move(1)))}
        style={{ fontFamily: `"${current}", var(--sans)`, fontWeight: displayWeight(current) }}
      >
        <span>{current}</span>
        <span className="font-note">{value === undefined ? "brand" : ""}</span>
        <span className="font-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="font-list"
          role="listbox"
          aria-label={label}
          ref={list}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), move(1));
            if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
            if (e.key === "Escape") (e.preventDefault(), setOpen(false));
          }}
        >
          <Option font={brandFont} name="brand" note="Brand font" />
          {!!custom.length && <p className="font-group">Your fonts</p>}
          {custom.map((f) => (
            <Option key={f} font={f} />
          ))}
          {FONT_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="font-group">{g.label}</p>
              {g.fonts.map((f) => (
                <Option key={f} font={f} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
