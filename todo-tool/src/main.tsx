import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { detectPlatform } from "./platform";
import { ToastProvider } from "./components/ToastProvider";

// Make platform available to CSS before the first paint.
document.documentElement.dataset.platform = detectPlatform();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
