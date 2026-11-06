import { createRoot } from "react-dom/client";
import { App } from "./App";
import { hydrate } from "./store";
import "./styles.css";

// Restore the last session first, but never hold the studio back for more than 2s.
Promise.race([hydrate(), new Promise((r) => setTimeout(r, 2000))]).finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
