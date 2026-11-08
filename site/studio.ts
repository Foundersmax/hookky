// Where the studio (and its sign-in API) lives: the app. subdomain of wherever this page is served.
const LOCAL = /^((.+\.)?localhost|127\.0\.0\.1)$/;

export function studioUrl(): string {
  const { hostname, protocol } = location;
  // Local testing only: ?app=http://localhost:8787 points the page at a local server. Never honoured
  // on the real site, where it would let a crafted link send typed passwords elsewhere.
  if (LOCAL.test(hostname)) {
    const o = new URL(location.href).searchParams.get("app") ?? sessionStorage.getItem("hookky.app");
    if (o && /^https?:\/\/((.+\.)?localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(o)) {
      sessionStorage.setItem("hookky.app", o);
      return o.replace(/\/$/, "");
    }
  }
  if (LOCAL.test(hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.endsWith(".github.io")) return "https://app.rookker.com";
  return `${protocol}//app.${hostname.replace(/^www\./, "")}`;
}
