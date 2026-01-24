use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::models::{SettingsFile, TasksFile};

const DATA_FILE: &str = "data.json";
const SETTINGS_FILE: &str = "settings.json";
const BACKUP_DIR: &str = "backups";
// Keep this aligned with `todo-tool/UNFINISHED.md` (and AGENTS docs).
const BACKUP_LIMIT: usize = 5;

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::Io(err) => write!(f, "io error: {err}"),
            StorageError::Json(err) => write!(f, "json error: {err}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        StorageError::Io(value)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        StorageError::Json(value)
    }
}

trait WriteAndSync {
    fn write_all_bytes(&mut self, buf: &[u8]) -> std::io::Result<()>;
    fn sync_all(&self) -> std::io::Result<()>;
}

impl WriteAndSync for File {
    fn write_all_bytes(&mut self, buf: &[u8]) -> std::io::Result<()> {
        Write::write_all(self, buf)
    }

    fn sync_all(&self) -> std::io::Result<()> {
        File::sync_all(self)
    }
}

type WriterFactory = fn(&Path) -> Result<Box<dyn WriteAndSync>, StorageError>;

fn create_file_writer(path: &Path) -> Result<Box<dyn WriteAndSync>, StorageError> {
    // Use `create_new` to avoid concurrent writers clobbering the same temp file.
    // If the temp name is already taken, the caller can retry with a different suffix.
    Ok(Box::new(
        OpenOptions::new().write(true).create_new(true).open(path)?,
    ))
}

fn write_all_and_sync<W: WriteAndSync + ?Sized>(
    writer: &mut W,
    bytes: &[u8],
) -> Result<(), StorageError> {
    writer.write_all_bytes(bytes)?;
    writer.sync_all()?;
    Ok(())
}

fn invalid_backup_filename_error() -> StorageError {
    StorageError::Io(std::io::Error::other("invalid backup filename"))
}

fn sanitize_backup_filename(filename: &str) -> Result<&str, StorageError> {
    let name = std::path::Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(invalid_backup_filename_error)?;
    if name != filename || name.is_empty() || name == "." || name == ".." {
        return Err(invalid_backup_filename_error());
    }
    Ok(name)
}

struct TempPathGuard {
    path: PathBuf,
    keep: bool,
}

impl TempPathGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, keep: false }
    }

    fn disarm(&mut self) {
        self.keep = true;
    }
}

impl Drop for TempPathGuard {
    fn drop(&mut self) {
        if self.keep {
            return;
        }
        let _ = fs::remove_file(&self.path);
    }
}

fn is_retryable_tempfile_create_error(err: &StorageError) -> bool {
    match err {
        StorageError::Io(err) => matches!(
            err.kind(),
            std::io::ErrorKind::AlreadyExists
                | std::io::ErrorKind::IsADirectory
                | std::io::ErrorKind::PermissionDenied
        ),
        StorageError::Json(_) => false,
    }
}

pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn ensure_dirs(&self) -> Result<(), StorageError> {
        fs::create_dir_all(self.root.join(BACKUP_DIR))?;
        Ok(())
    }

    pub fn load_tasks(&self) -> Result<TasksFile, StorageError> {
        self.load_json(self.root.join(DATA_FILE))
    }

    pub fn load_settings(&self) -> Result<SettingsFile, StorageError> {
        self.load_json(self.root.join(SETTINGS_FILE))
    }

    pub fn save_tasks(&self, data: &TasksFile, with_backup: bool) -> Result<(), StorageError> {
        if with_backup {
            return self.write_with_backup(DATA_FILE, data);
        }
        self.write_atomic(self.root.join(DATA_FILE), data)
    }

    pub fn save_settings(&self, data: &SettingsFile) -> Result<(), StorageError> {
        self.write_atomic(self.root.join(SETTINGS_FILE), data)
    }

    fn load_json<T: DeserializeOwned>(&self, path: PathBuf) -> Result<T, StorageError> {
        let mut file = File::open(path)?;
        let mut buf = String::new();
        file.read_to_string(&mut buf)?;
        Ok(serde_json::from_str(&buf)?)
    }

    fn write_with_backup<T: Serialize>(
        &self,
        filename: &str,
        data: &T,
    ) -> Result<(), StorageError> {
        let path = self.root.join(filename);
        if path.exists() {
            self.create_backup(&path)?;
        }
        self.write_atomic(path, data)
    }

    fn write_atomic<T: Serialize>(&self, path: PathBuf, data: &T) -> Result<(), StorageError> {
        let json = serde_json::to_vec_pretty(data)?;
        self.write_atomic_bytes(path, &json, create_file_writer)
    }

    #[cfg_attr(coverage, inline(never))]
    fn write_atomic_bytes(
        &self,
        path: PathBuf,
        bytes: &[u8],
        create_writer: WriterFactory,
    ) -> Result<(), StorageError> {
        // Prefer the deterministic `*.tmp` name first (readable + stable), but fall back to a
        // suffixed temp name to avoid collisions across concurrent writes.
        const TEMPFILE_ATTEMPTS: usize = 10;

        let mut last_err: Option<StorageError> = None;
        for attempt in 0..=TEMPFILE_ATTEMPTS {
            let temp_path = if attempt == 0 {
                path.with_extension("tmp")
            } else {
                path.with_extension(format!("tmp.{}.{}", std::process::id(), attempt))
            };

            let mut cleanup = TempPathGuard::new(temp_path.clone());
            let mut writer = match create_writer(&temp_path) {
                Ok(writer) => writer,
                Err(err) if is_retryable_tempfile_create_error(&err) => {
                    last_err = Some(err);
                    continue;
                }
                Err(err) => return Err(err),
            };

            write_all_and_sync(writer.as_mut(), bytes)?;
            // On Windows, the rename can fail if the file is still open; explicitly drop first.
            drop(writer);

            fs::rename(&temp_path, &path)?;
            cleanup.disarm();
            return Ok(());
        }

        #[cfg(coverage)]
        let err = last_err.unwrap_or(StorageError::Io(std::io::Error::other(
            "failed to create temporary file",
        )));
        #[cfg(not(coverage))]
        let err = last_err.unwrap_or_else(|| {
            StorageError::Io(std::io::Error::other("failed to create temporary file"))
        });
        Err(err)
    }

    pub fn create_backup(&self, path: &Path) -> Result<(), StorageError> {
        let backup_name = self.next_backup_name()?;
        let backup_path = self.root.join(BACKUP_DIR).join(backup_name);
        fs::copy(path, backup_path)?;
        // Trimming is best-effort: a backup file was successfully created and should not be
        // discarded just because cleanup failed (e.g., transient FS errors).
        let _ = self.trim_backups();
        Ok(())
    }

    pub fn delete_backup(&self, filename: &str) -> Result<(), StorageError> {
        let name = sanitize_backup_filename(filename)?;
        let path = self.root.join(BACKUP_DIR).join(name);
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn list_backups(&self) -> Result<Vec<(String, i64)>, StorageError> {
        let mut entries: Vec<_> = fs::read_dir(self.root.join(BACKUP_DIR))?
            .filter_map(|entry| entry.ok())
            .collect();
        entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
        entries.reverse();
        let mut results = Vec::new();
        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_secs() as i64)
                .unwrap_or(0);
            results.push((name, modified));
        }
        Ok(results)
    }

    pub fn restore_backup(&self, filename: &str) -> Result<TasksFile, StorageError> {
        let filename = sanitize_backup_filename(filename)?;
        let path = self.root.join(BACKUP_DIR).join(filename);
        let data: TasksFile = self.load_json(path)?;
        self.write_atomic(self.root.join(DATA_FILE), &data)?;
        Ok(data)
    }

    pub fn restore_from_path(&self, source: &Path) -> Result<TasksFile, StorageError> {
        let data: TasksFile = self.load_json(source.to_path_buf())?;
        self.write_atomic(self.root.join(DATA_FILE), &data)?;
        Ok(data)
    }

    fn trim_backups(&self) -> Result<(), StorageError> {
        let mut entries: Vec<_> = fs::read_dir(self.root.join(BACKUP_DIR))?
            .filter_map(|entry| entry.ok())
            .collect();
        entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
        let to_remove = entries.len().saturating_sub(BACKUP_LIMIT);
        for entry in entries.into_iter().take(to_remove) {
            let _ = fs::remove_file(entry.path());
        }
        Ok(())
    }

    fn next_backup_name(&self) -> Result<String, StorageError> {
        self.next_backup_name_with_limit(9999)
    }

    fn next_backup_name_with_limit(&self, limit: usize) -> Result<String, StorageError> {
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        for index in 1..=limit {
            let name = if index == 1 {
                format!("data-{date}.json")
            } else {
                format!("data-{date}-{index}.json")
            };
            let path = self.root.join(BACKUP_DIR).join(&name);
            if !path.exists() {
                return Ok(name);
            }
        }
        Err(StorageError::Io(std::io::Error::other(
            "failed to generate backup filename",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Settings, SettingsFile, TasksFile};

    fn is_io(err: &StorageError) -> bool {
        matches!(err, StorageError::Io(_))
    }

    fn is_json(err: &StorageError) -> bool {
        matches!(err, StorageError::Json(_))
    }

    fn sample_tasks_file() -> TasksFile {
        TasksFile {
            schema_version: 1,
            tasks: Vec::new(),
            projects: Vec::new(),
        }
    }

    fn sample_settings_file() -> SettingsFile {
        SettingsFile {
            schema_version: 1,
            settings: Settings::default(),
        }
    }

    #[test]
    fn is_retryable_tempfile_create_error_returns_false_for_json_errors() {
        let json_err: StorageError = serde_json::from_str::<serde_json::Value>("oops")
            .unwrap_err()
            .into();
        assert!(!is_retryable_tempfile_create_error(&json_err));
    }

    #[test]
    fn ensure_dirs_creates_backup_dir_and_fails_on_invalid_path() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();
        assert!(root.path().join(BACKUP_DIR).is_dir());

        // If `backups` exists as a file, create_dir_all must fail.
        let root2 = tempfile::tempdir().unwrap();
        let backups_path = root2.path().join(BACKUP_DIR);
        File::create(&backups_path).unwrap();
        let storage2 = Storage::new(root2.path().to_path_buf());
        let err = storage2.ensure_dirs().expect_err("should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn load_tasks_errors_on_missing_file_and_invalid_json() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // Missing file => io error.
        let err = storage.load_tasks().expect_err("missing data.json");
        assert!(is_io(&err));
        assert!(!is_json(&err));

        // Invalid JSON => json error.
        let mut file = File::create(root.path().join(DATA_FILE)).unwrap();
        file.write_all(b"not-json").unwrap();
        file.sync_all().unwrap();
        let err = storage.load_tasks().expect_err("invalid json should fail");
        assert!(is_json(&err));
        assert!(!is_io(&err));
    }

    #[test]
    fn load_tasks_errors_on_invalid_utf8_data() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // `read_to_string` rejects invalid UTF-8 with an IO error (InvalidData).
        fs::write(root.path().join(DATA_FILE), [0xFF]).unwrap();
        let err = storage.load_tasks().expect_err("invalid utf8 should fail");
        assert!(is_io(&err));
        assert!(!is_json(&err));
    }

    #[test]
    fn write_atomic_covers_serialize_and_tempfile_collisions() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        struct BadSerialize;

        impl serde::Serialize for BadSerialize {
            fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
            where
                S: serde::Serializer,
            {
                Err(serde::ser::Error::custom("boom"))
            }
        }

        let err = storage
            .write_atomic(root.path().join("bad.json"), &BadSerialize)
            .expect_err("serialization should fail");
        assert!(is_json(&err));
        assert!(!is_io(&err));

        // If the preferred temp path is blocked, we should fall back to a suffixed tempfile name
        // so the write remains robust.
        let path = root.path().join("foo.json");
        fs::create_dir_all(path.with_extension("tmp")).unwrap();
        storage
            .write_atomic(path.clone(), &sample_tasks_file())
            .expect("should fall back to a different temp name");
        assert!(path.is_file());
    }

    #[test]
    fn write_atomic_errors_when_all_tempfile_names_are_blocked() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let path = root.path().join("exhaust.json");

        // Block the deterministic temp name and every suffixed retry name.
        fs::create_dir_all(path.with_extension("tmp")).unwrap();
        let pid = std::process::id();
        for attempt in 1..=10 {
            fs::create_dir_all(path.with_extension(format!("tmp.{pid}.{attempt}"))).unwrap();
        }

        let err = storage
            .write_atomic(path, &sample_tasks_file())
            .expect_err("should fail after exhausting all tempfile names");
        assert!(is_io(&err));
    }

    #[test]
    fn save_settings_errors_when_serializing_non_finite_bounds() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // Serde JSON rejects non-finite floats (NaN/inf). This exercises the `to_vec_pretty` error
        // branch for the SettingsFile monomorphization of `write_atomic`.
        let mut settings = Settings::default();
        settings.quick_bounds = Some(crate::models::WindowBounds {
            x: f64::INFINITY,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        });

        let data = SettingsFile {
            schema_version: 1,
            settings,
        };

        let err = storage
            .save_settings(&data)
            .expect_err("non-finite bounds should fail JSON serialization");
        assert!(is_json(&err));
        assert!(!is_io(&err));
    }

    #[test]
    fn write_all_and_sync_covers_error_branches() {
        struct TestWriter {
            fail_write: bool,
            fail_sync: bool,
        }

        impl WriteAndSync for TestWriter {
            fn write_all_bytes(&mut self, _buf: &[u8]) -> std::io::Result<()> {
                if self.fail_write {
                    return Err(std::io::Error::other("write failed"));
                }
                Ok(())
            }

            fn sync_all(&self) -> std::io::Result<()> {
                if self.fail_sync {
                    return Err(std::io::Error::other("sync failed"));
                }
                Ok(())
            }
        }

        let mut ok_writer = TestWriter {
            fail_write: false,
            fail_sync: false,
        };
        assert!(write_all_and_sync(&mut ok_writer, b"ok").is_ok());

        let mut fail_write = TestWriter {
            fail_write: true,
            fail_sync: false,
        };
        let err = write_all_and_sync(&mut fail_write, b"x").expect_err("write should fail");
        assert!(is_io(&err));

        let mut fail_sync = TestWriter {
            fail_write: false,
            fail_sync: true,
        };
        let err = write_all_and_sync(&mut fail_sync, b"x").expect_err("sync should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn write_atomic_bytes_propagates_write_errors() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        struct ConfigurableWriter {
            fail_write: bool,
            fail_sync: bool,
        }

        impl WriteAndSync for ConfigurableWriter {
            fn write_all_bytes(&mut self, _buf: &[u8]) -> std::io::Result<()> {
                if self.fail_write {
                    return Err(std::io::Error::other("write failed"));
                }
                Ok(())
            }

            fn sync_all(&self) -> std::io::Result<()> {
                if self.fail_sync {
                    return Err(std::io::Error::other("sync failed"));
                }
                Ok(())
            }
        }

        fn create_fail_write(_path: &Path) -> Result<Box<dyn WriteAndSync>, StorageError> {
            Ok(Box::new(ConfigurableWriter {
                fail_write: true,
                fail_sync: false,
            }))
        }

        fn create_fail_sync(_path: &Path) -> Result<Box<dyn WriteAndSync>, StorageError> {
            Ok(Box::new(ConfigurableWriter {
                fail_write: false,
                fail_sync: true,
            }))
        }

        fn create_ok_writer(_path: &Path) -> Result<Box<dyn WriteAndSync>, StorageError> {
            Ok(Box::new(ConfigurableWriter {
                fail_write: false,
                fail_sync: false,
            }))
        }

        // Fail in `sync_all` so that branch is exercised.
        let err = storage
            .write_atomic_bytes(root.path().join("any.json"), b"hello", create_fail_sync)
            .expect_err("sync should fail");
        assert!(is_io(&err));

        // Also fail in `write_all_bytes` so the error short-circuit branch is exercised for the
        // dyn-dispatch instantiation of `write_all_and_sync`.
        let err = storage
            .write_atomic_bytes(root.path().join("any2.json"), b"hello", create_fail_write)
            .expect_err("write should fail");
        assert!(is_io(&err));

        // Finally, make both writer operations succeed so we exercise the `Ok(())` path in
        // `sync_all`. This still errors later because no temp file exists to rename.
        let err = storage
            .write_atomic_bytes(root.path().join("any3.json"), b"hello", create_ok_writer)
            .expect_err("rename should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn write_atomic_bytes_returns_non_retryable_create_error_immediately() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        fn create_non_retryable(_path: &Path) -> Result<Box<dyn WriteAndSync>, StorageError> {
            Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "non-retryable",
            )))
        }

        let err = storage
            .write_atomic_bytes(root.path().join("any.json"), b"hello", create_non_retryable)
            .expect_err("create_writer should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn save_and_load_tasks_and_settings_roundtrip() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let tasks = sample_tasks_file();
        storage.save_tasks(&tasks, false).unwrap();
        let loaded = storage.load_tasks().unwrap();
        assert_eq!(loaded.schema_version, 1);
        assert!(loaded.tasks.is_empty());

        let settings = sample_settings_file();
        storage.save_settings(&settings).unwrap();
        let loaded = storage.load_settings().unwrap();
        assert_eq!(loaded.schema_version, 1);
        assert_eq!(loaded.settings.shortcut, Settings::default().shortcut);
    }

    #[test]
    fn save_settings_roundtrip_with_finite_window_bounds() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let mut settings = Settings::default();
        settings.quick_bounds = Some(crate::models::WindowBounds {
            x: 12.5,
            y: 34.0,
            width: 800.0,
            height: 600.0,
        });
        let data = SettingsFile {
            schema_version: 1,
            settings,
        };

        // `Storage::save_settings` uses `serde_json::to_vec_pretty`, which ensures we exercise the
        // `WindowBounds::serialize` monomorphization for PrettyFormatter on the happy path.
        storage.save_settings(&data).unwrap();
        let loaded = storage.load_settings().unwrap();
        let loaded_bounds = loaded
            .settings
            .quick_bounds
            .expect("bounds should roundtrip");
        assert_eq!(loaded_bounds.x, 12.5);
        assert_eq!(loaded_bounds.y, 34.0);
        assert_eq!(loaded_bounds.width, 800.0);
        assert_eq!(loaded_bounds.height, 600.0);
    }

    #[test]
    fn save_tasks_with_backup_creates_backups_and_trims_to_limit() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // When the data file doesn't exist yet, backup mode should not create a backup.
        storage.save_tasks(&sample_tasks_file(), true).unwrap();
        assert_eq!(
            fs::read_dir(root.path().join(BACKUP_DIR)).unwrap().count(),
            0
        );

        // Create an initial data file.
        storage.save_tasks(&sample_tasks_file(), false).unwrap();

        // Trigger more than BACKUP_LIMIT backups; must stay trimmed.
        for _ in 0..(BACKUP_LIMIT + 2) {
            storage.save_tasks(&sample_tasks_file(), true).unwrap();
        }
        let backups = storage.list_backups().unwrap();
        assert!(backups.len() <= BACKUP_LIMIT);
        assert!(backups.iter().all(|(name, _)| name.starts_with("data-")));
    }

    #[test]
    fn create_backup_uses_date_names_and_suffixes() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let data_path = root.path().join(DATA_FILE);
        fs::write(
            &data_path,
            serde_json::to_string_pretty(&sample_tasks_file()).unwrap(),
        )
        .unwrap();

        storage.create_backup(&data_path).unwrap();
        storage.create_backup(&data_path).unwrap();

        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let backups = storage.list_backups().unwrap();
        let names: Vec<_> = backups.into_iter().map(|(name, _)| name).collect();
        assert!(names
            .iter()
            .any(|name| name == &format!("data-{date}.json")));
        assert!(names
            .iter()
            .any(|name| name == &format!("data-{date}-2.json")));
    }

    #[test]
    fn next_backup_name_fails_when_limit_exhausted() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let name = format!("data-{date}.json");
        fs::write(root.path().join(BACKUP_DIR).join(&name), b"x").unwrap();

        let err = storage
            .next_backup_name_with_limit(1)
            .expect_err("should error when all slots are exhausted");
        assert!(is_io(&err));
    }

    #[test]
    fn delete_backup_removes_file_and_rejects_invalid_names() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let backup_path = root.path().join(BACKUP_DIR).join("data-test.json");
        fs::write(&backup_path, b"{}").unwrap();
        storage.delete_backup("data-test.json").unwrap();
        assert!(!backup_path.exists());

        let err = storage
            .delete_backup("../data-test.json")
            .expect_err("should reject invalid filename");
        assert!(is_io(&err));

        let err = storage
            .delete_backup("")
            .expect_err("should reject empty filename");
        assert!(is_io(&err));

        let err = storage
            .delete_backup("data-missing.json")
            .expect_err("should fail when file is missing");
        assert!(is_io(&err));
    }

    #[test]
    fn restore_backup_rejects_invalid_filenames() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let err = storage
            .restore_backup("../data-test.json")
            .expect_err("should reject path traversal");
        assert!(is_io(&err));

        let err = storage
            .restore_backup("")
            .expect_err("should reject empty name");
        assert!(is_io(&err));
    }

    #[test]
    fn create_backup_reports_error_when_names_exhausted() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        for index in 1..=9999 {
            let name = if index == 1 {
                format!("data-{date}.json")
            } else {
                format!("data-{date}-{index}.json")
            };
            fs::write(root.path().join(BACKUP_DIR).join(name), b"x").unwrap();
        }

        let data_path = root.path().join(DATA_FILE);
        fs::write(
            &data_path,
            serde_json::to_string_pretty(&sample_tasks_file()).unwrap(),
        )
        .unwrap();

        let err = storage
            .create_backup(&data_path)
            .expect_err("should error once all names are taken");
        assert!(is_io(&err));
    }

    #[test]
    fn restore_backup_and_restore_from_path_overwrite_data_file() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // Seed data.json and create a backup.
        let tasks = sample_tasks_file();
        storage.save_tasks(&tasks, false).unwrap();
        storage.create_backup(&root.path().join(DATA_FILE)).unwrap();
        let backups = storage.list_backups().unwrap();
        assert!(!backups.is_empty());

        // Restore from the first backup.
        let backup_name = backups[0].0.clone();
        let restored = storage.restore_backup(&backup_name).unwrap();
        assert_eq!(restored.schema_version, 1);
        assert!(root.path().join(DATA_FILE).is_file());

        // Restore from an arbitrary path.
        let external = root.path().join("external.json");
        let mut f = File::create(&external).unwrap();
        f.write_all(serde_json::to_string_pretty(&tasks).unwrap().as_bytes())
            .unwrap();
        f.sync_all().unwrap();
        let restored2 = storage.restore_from_path(&external).unwrap();
        assert_eq!(restored2.schema_version, 1);
    }

    #[test]
    fn restore_backup_propagates_write_atomic_error() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let backup_name = "data-test.json";
        let backup_path = root.path().join(BACKUP_DIR).join(backup_name);
        fs::write(
            &backup_path,
            serde_json::to_string_pretty(&sample_tasks_file()).unwrap(),
        )
        .unwrap();

        // Make the destination a directory so the atomic rename fails.
        fs::create_dir_all(root.path().join(DATA_FILE)).unwrap();

        let err = storage
            .restore_backup(backup_name)
            .expect_err("write_atomic should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn restore_from_path_propagates_write_atomic_error() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        let external = root.path().join("external.json");
        fs::write(
            &external,
            serde_json::to_string_pretty(&sample_tasks_file()).unwrap(),
        )
        .unwrap();

        fs::create_dir_all(root.path().join(DATA_FILE)).unwrap();

        let err = storage
            .restore_from_path(&external)
            .expect_err("write_atomic should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn trim_backups_errors_when_backups_is_not_a_directory() {
        let root = tempfile::tempdir().unwrap();
        File::create(root.path().join(BACKUP_DIR)).unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        let err = storage.trim_backups().expect_err("read_dir should fail");
        assert!(is_io(&err));
    }

    #[test]
    fn storage_error_display_formats_both_variants() {
        let io_err: StorageError = std::io::Error::other("x").into();
        assert!(format!("{io_err}").contains("io error"));

        let json_err: StorageError = serde_json::from_str::<serde_json::Value>("oops")
            .unwrap_err()
            .into();
        assert!(format!("{json_err}").contains("json error"));
    }
}
