use std::path::Path;

pub const LOG_FILE_BASENAME: &str = "mustdo";
pub const LOG_FILE_SUFFIX: &str = "log";
pub const LOG_ROTATE_SIZE_BYTES: u64 = 100 * 1024 * 1024;
pub const LOG_ROTATE_KEEP_FILES: usize = 30;

/// Returns the directory that contains user-facing app data (data.json/settings.json/backups/)
/// and, by design, the log files.
pub fn log_directory(app_data_dir: &Path) -> &Path {
    app_data_dir
}

#[cfg(all(feature = "app", not(test)))]
pub fn init_logging(app_data_dir: &Path) -> Result<(), flexi_logger::FlexiLoggerError> {
    use flexi_logger::{
        detailed_format, Cleanup, Criterion, Duplicate, FileSpec, Logger, Naming, WriteMode,
    };

    std::fs::create_dir_all(app_data_dir)?;

    // Keep dependency logs at WARN by default; our crate is more verbose in debug builds.
    // Users can override with `MUSTDO_LOG` or `RUST_LOG`.
    let default_spec = if cfg!(debug_assertions) {
        "warn,todo_tool_lib=debug"
    } else {
        "warn,todo_tool_lib=info"
    };
    let spec = std::env::var("MUSTDO_LOG")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("RUST_LOG")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .unwrap_or_else(|| default_spec.to_string());

    Logger::try_with_str(spec)?
        .log_to_file(
            FileSpec::default()
                .directory(log_directory(app_data_dir))
                .basename(LOG_FILE_BASENAME)
                .suffix(LOG_FILE_SUFFIX),
        )
        .write_mode(WriteMode::BufferAndFlush)
        .format_for_files(detailed_format)
        .rotate(
            Criterion::Size(LOG_ROTATE_SIZE_BYTES),
            Naming::Numbers,
            Cleanup::KeepLogFiles(LOG_ROTATE_KEEP_FILES),
        )
        // During `tauri dev` it's helpful to also see logs in the terminal.
        .duplicate_to_stdout(if cfg!(debug_assertions) {
            Duplicate::Info
        } else {
            Duplicate::None
        })
        .start()?;

    install_panic_hook();

    log::info!(
        "logger initialized dir={} rotate_size_bytes={} keep_files={}",
        log_directory(app_data_dir).display(),
        LOG_ROTATE_SIZE_BYTES,
        LOG_ROTATE_KEEP_FILES
    );
    Ok(())
}

#[cfg(all(feature = "app", not(test)))]
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info: &std::panic::PanicHookInfo<'_>| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str()))
            .unwrap_or("<non-string panic payload>");
        let location = info
            .location()
            .map(|loc| format!("{loc}"))
            .unwrap_or_else(|| "<unknown>".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();

        // Best-effort: even if the logger is unavailable, still run the default hook.
        log::error!("panic: payload={payload} location={location}\nbacktrace:\n{backtrace}");
        default_hook(info);
    }));
}
