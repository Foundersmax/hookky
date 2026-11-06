const paths: Record<string, string> = {
  play: "M7 5.5v13l11-6.5z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  send: "M4 12l16-8-6 16-2.5-6.5z",
  clip: "M16.5 6.5l-8 8a2.5 2.5 0 003.5 3.5l8.5-8.5a4.2 4.2 0 00-6-6L5.8 12.2a5.8 5.8 0 008.2 8.2L20 14.5",
  mic: "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM6 11a6 6 0 0012 0M12 17v4",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4L15 12l5 5M15.5 8.5h.01",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  plus: "M12 5v14M5 12h14",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  copy: "M8 8h11v11H8zM5 16V5h11",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  search: "M11 4a7 7 0 110 14 7 7 0 010-14zM20 20l-4-4",
  reset: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4",
  loop: "M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3",
  sun: "M12 7a5 5 0 110 10 5 5 0 010-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  panelLeft: "M4 5h16v14H4zM9.5 5v14",
  panelRight: "M4 5h16v14H4zM14.5 5v14",
  focus: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  wand: "M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1.5 1.5M18 9l-1.5-1.5M3 21l11-11",
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  const filled = name === "play" || name === "pause" || name === "send";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
