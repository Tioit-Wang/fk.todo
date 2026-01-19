use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::models::{SettingsFile, TasksFile};

const DATA_FILE: &str = "data.json";
const SETTINGS_FILE: &str = "settings.json";
const BACKUP_DIR: &str = "backups";
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
        let temp_path = path.with_extension("tmp");
        let json = serde_json::to_vec_pretty(data)?;
        {
            let mut file = File::create(&temp_path)?;
            file.write_all(&json)?;
            file.sync_all()?;
        }
        fs::rename(temp_path, path)?;
        Ok(())
    }

    pub fn create_backup(&self, path: &Path) -> Result<(), StorageError> {
        // Use millisecond resolution to avoid filename collisions when multiple backups are created
        // within the same second (common during tests or rapid manual triggers).
        let timestamp_ms = chrono::Local::now().timestamp_millis();
        let backup_name = format!("data-{timestamp_ms}.json");
        let backup_path = self.root.join(BACKUP_DIR).join(backup_name);
        fs::copy(path, backup_path)?;
        self.trim_backups()?;
        Ok(())
    }

    pub fn list_backups(&self) -> Result<Vec<(String, i64)>, StorageError> {
        let mut entries: Vec<_> = fs::read_dir(self.root.join(BACKUP_DIR))?
            .filter_map(|entry| entry.ok())
            .collect();
        entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Settings, SettingsFile, TasksFile};

    fn sample_tasks_file() -> TasksFile {
        TasksFile {
            schema_version: 1,
            tasks: Vec::new(),
        }
    }

    fn sample_settings_file() -> SettingsFile {
        SettingsFile {
            schema_version: 1,
            settings: Settings::default(),
        }
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
        assert!(matches!(err, StorageError::Io(_)));
    }

    #[test]
    fn load_tasks_errors_on_missing_file_and_invalid_json() {
        let root = tempfile::tempdir().unwrap();
        let storage = Storage::new(root.path().to_path_buf());
        storage.ensure_dirs().unwrap();

        // Missing file => io error.
        let err = storage.load_tasks().expect_err("missing data.json");
        assert!(matches!(err, StorageError::Io(_)));

        // Invalid JSON => json error.
        let mut file = File::create(root.path().join(DATA_FILE)).unwrap();
        file.write_all(b"not-json").unwrap();
        file.sync_all().unwrap();
        let err = storage.load_tasks().expect_err("invalid json should fail");
        assert!(matches!(err, StorageError::Json(_)));
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
    fn storage_error_display_formats_both_variants() {
        let io_err: StorageError = std::io::Error::other("x").into();
        assert!(format!("{io_err}").contains("io error"));

        let json_err: StorageError = serde_json::from_str::<serde_json::Value>("oops")
            .unwrap_err()
            .into();
        assert!(format!("{json_err}").contains("json error"));
    }
}
