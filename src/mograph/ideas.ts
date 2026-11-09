// Ideas an ad says, and the words icon kits name them by (Lucide's names; the other kits share
// most of them). Used by the server's kit search and the studio's offline previews.
import { BUILTIN_ICONS } from "./builtin";

export const IDEAS: Record<string, string[]> = {
  sleep: ["moon", "bed"], rest: ["moon", "bed"], night: ["moon", "moon-star"], morning: ["sunrise", "sun", "alarm-clock"], time: ["clock", "timer"], fast: ["zap", "rocket", "gauge"], speed: ["gauge", "zap"], quick: ["zap", "timer"],
  money: ["banknote", "wallet", "coins"], save: ["piggy-bank", "wallet"], price: ["tag", "receipt"], pay: ["credit-card", "wallet"], sale: ["percent", "tag"], offer: ["gift", "percent"], discount: ["percent", "tag"], free: ["gift"],
  battery: ["battery-charging", "battery-full", "battery"], charge: ["battery-charging", "plug-zap", "zap"], power: ["zap", "plug"], energy: ["zap", "flame"],
  phone: ["smartphone", "phone"], app: ["smartphone", "app-window", "layout-grid"], message: ["message-circle", "message"], notification: ["bell"], email: ["mail"],
  heart: ["heart-pulse", "heart"], health: ["heart-pulse", "activity"], fitness: ["dumbbell", "activity"], run: ["footprints", "run", "activity"], walk: ["footprints", "walk"], footprints: ["footprints", "shoe", "walk"],
  team: ["users", "users-round"], people: ["users"], customer: ["user", "smile"], friend: ["users"], family: ["home", "users"], community: ["users"],
  secure: ["shield-check", "lock"], safe: ["shield-check", "lock"], privacy: ["lock", "eye-off"], trust: ["shield-check", "badge-check"],
  growth: ["trending-up", "chart-line", "sprout"], grow: ["sprout", "trending-up"], data: ["chart-bar", "database"], analytics: ["chart-pie", "chart-bar"], results: ["trending-up", "target"],
  world: ["globe", "earth"], global: ["globe"], travel: ["plane", "map"], location: ["map-pin"], home: ["home", "house"], city: ["building", "building-2"],
  idea: ["lightbulb"], smart: ["brain", "sparkles", "cpu"], ai: ["sparkles", "brain", "bot"], magic: ["sparkles", "wand"], new: ["sparkles", "badge"], quality: ["award", "gem"], best: ["award", "trophy", "crown"],
  easy: ["check-circle", "mouse-pointer-click"], simple: ["check-circle", "circle"], done: ["check", "check-circle"], check: ["check"], start: ["play", "rocket"], launch: ["rocket"], goal: ["target", "flag"], win: ["trophy"],
  coffee: ["coffee", "cup-soda"], food: ["utensils", "chef-hat"], eat: ["utensils"], drink: ["cup-soda", "wine"], shop: ["shopping-bag", "store"], buy: ["shopping-cart", "shopping-bag"], delivery: ["truck", "package"], order: ["package", "shopping-bag"],
  watch: ["watch"], music: ["music", "headphones"], listen: ["headphones", "ear"], video: ["video", "clapperboard"], photo: ["camera", "image"], design: ["pen-tool", "palette"], write: ["pen-line", "pencil"], code: ["code", "terminal"],
  calendar: ["calendar"], day: ["sun", "calendar"], week: ["calendar-days"], year: ["calendar"], stress: ["wind", "heart-pulse", "frown"], calm: ["leaf", "wind"], nature: ["leaf", "trees"], water: ["droplet", "waves"], weather: ["cloud-sun"],
  learn: ["graduation-cap", "book-open"], book: ["book-open"], work: ["briefcase", "laptop"], laptop: ["laptop"], cloud: ["cloud"], connect: ["link", "plug"], share: ["share-2", "send"], chat: ["message-circle"],
  stop: ["octagon-x", "hand"], hand: ["hand", "hand-stop", "hand-finger"], wave: ["hand"], hello: ["hand"], tired: ["battery-low", "frown"], sad: ["frown"], problem: ["circle-alert", "frown"], scroll: ["smartphone"], look: ["eye"], see: ["eye"], search: ["search"], find: ["search"], wait: ["hourglass"], slow: ["hourglass"], better: ["trending-up", "sparkles"], less: ["trending-down"], more: ["plus"], relax: ["wind", "leaf"],
  star: ["star"], review: ["star", "message-square-quote"], rating: ["star"], love: ["heart"], like: ["thumbs-up", "heart"], happy: ["smile"], gift: ["gift"], car: ["car"], bike: ["bike"], dog: ["dog"], cat: ["cat"], baby: ["baby"],
};

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "");

/** The best icon from the built-in set for an idea (previews and offline), skipping ones in `used`. */
export function builtinIcon(idea: string, used = new Set<string>()): string | undefined {
  const words = idea.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const cands = [idea.toLowerCase().trim().replace(/\s+/g, "-"), ...words.flatMap((w) => IDEAS[w] ?? IDEAS[stem(w)] ?? []), ...words];
  for (const c of cands) {
    const k = `lucide:${c}`;
    if (BUILTIN_ICONS[k] && !used.has(k)) return k;
  }
  for (const c of cands) for (const k of Object.keys(BUILTIN_ICONS)) if (!used.has(k) && k.slice(7).split("-").includes(c)) return k;
  // Nothing fresh: an icon already used elsewhere beats an empty circle.
  if (used.size) return builtinIcon(idea);
  return undefined;
}
