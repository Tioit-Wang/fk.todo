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
        let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let backup_name = format!("data-{timestamp}.json");
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
            if let Some(name) = entry.file_name().to_str() {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|dur| dur.as_secs() as i64)
                    .unwrap_or(0);
                results.push((name.to_string(), modified));
            }
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
