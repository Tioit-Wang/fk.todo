fn main() {
    // Keep `check-cfg` happy even when we skip `tauri_build::build()` (core-only unit tests).
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");

    // `tauri_build::build()` expects the `tauri` crate to be present and will read
    // env vars it exports (e.g. `DEP_TAURI_DEV`). When running core-only unit tests
    // (e.g. `--no-default-features`), we intentionally do not compile the full Tauri
    // runtime stack, so we skip the build helpers.
    if std::env::var_os("CARGO_FEATURE_APP").is_some() {
        tauri_build::build()
    }
}
