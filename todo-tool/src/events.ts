// Shared event names (DOM + Tauri) used across multiple components/windows.
//
// Keeping these centralized avoids "stringly-typed" drift between emitters/listeners.

// DOM event emitted by WindowTitlebar before starting a native drag operation.
export const DOM_WINDOW_DRAG_START = "fk.todo:window-drag-start";

// Tauri event emitted by the Rust backend to request frontend navigation (hash route).
export const TAURI_NAVIGATE = "fk.todo:navigate";

