//! The system keychain, for the church device token (decision D23): Keychain on macOS,
//! Credential Manager on Windows. Each workspace on this computer has its own entry.
//!
//! Debug builds (`pnpm dev`) keep the secrets in a plain file instead. Every rebuild is a
//! new, ad-hoc signed binary that macOS no longer recognises, so the keychain would ask for
//! the login password again after each one. Release builds never compile that file store.

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn check(account: &str) -> Result<(), String> {
    if account.is_empty() || account.len() > 200 {
        return Err("invalid keychain account".into());
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
mod store {
    use super::{check, err};
    use keyring::Entry;

    const SERVICE: &str = "com.worship-q.desktop";

    fn entry(account: &str) -> Result<Entry, String> {
        check(account)?;
        Entry::new(SERVICE, account).map_err(err)
    }

    /// Stores a secret. The interface reads it back before trusting that it is kept.
    #[tauri::command(async)]
    pub fn keychain_set(account: String, secret: String) -> Result<(), String> {
        entry(&account)?.set_password(&secret).map_err(err)
    }

    /// The stored secret, or nothing when there is none.
    #[tauri::command(async)]
    pub fn keychain_get(account: String) -> Result<Option<String>, String> {
        match entry(&account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(err(e)),
        }
    }

    #[tauri::command(async)]
    pub fn keychain_delete(account: String) -> Result<(), String> {
        match entry(&account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
}

#[cfg(debug_assertions)]
mod store {
    use super::{check, err};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tauri::{AppHandle, Manager};

    /// Development only: the secrets, unencrypted, beside the app's data.
    const FILE: &str = "dev-keychain.json";

    /// Commands run on worker threads; one change at a time keeps the file whole.
    static LOCK: Mutex<()> = Mutex::new(());

    type Secrets = BTreeMap<String, String>;

    fn path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(app.path().app_data_dir().map_err(err)?.join(FILE))
    }

    fn read(app: &AppHandle) -> Result<Secrets, String> {
        match fs::read_to_string(path(app)?) {
            Ok(text) => serde_json::from_str(&text).map_err(err),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Secrets::new()),
            Err(e) => Err(err(e)),
        }
    }

    fn write(app: &AppHandle, secrets: &Secrets) -> Result<(), String> {
        let path = path(app)?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(err)?;
        }
        fs::write(path, serde_json::to_string_pretty(secrets).map_err(err)?).map_err(err)
    }

    #[tauri::command(async)]
    pub fn keychain_set(app: AppHandle, account: String, secret: String) -> Result<(), String> {
        check(&account)?;
        let _guard = LOCK.lock().map_err(err)?;
        let mut secrets = read(&app)?;
        secrets.insert(account, secret);
        write(&app, &secrets)
    }

    #[tauri::command(async)]
    pub fn keychain_get(app: AppHandle, account: String) -> Result<Option<String>, String> {
        check(&account)?;
        let _guard = LOCK.lock().map_err(err)?;
        Ok(read(&app)?.remove(&account))
    }

    #[tauri::command(async)]
    pub fn keychain_delete(app: AppHandle, account: String) -> Result<(), String> {
        check(&account)?;
        let _guard = LOCK.lock().map_err(err)?;
        let mut secrets = read(&app)?;
        if secrets.remove(&account).is_some() {
            write(&app, &secrets)?;
        }
        Ok(())
    }
}

// A glob, so the commands' generated handler items come along too.
pub use store::*;
