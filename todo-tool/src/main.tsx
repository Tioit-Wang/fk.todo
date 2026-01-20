import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { detectPlatform } from "./platform";

// Make platform available to CSS before the first paint.
document.documentElement.dataset.platform = detectPlatform();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
