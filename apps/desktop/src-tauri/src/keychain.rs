//! The system keychain, for the church device token (decision D23): Keychain on macOS and
//! iOS, Credential Manager on Windows, and on Android secrets encrypted with a key in the
//! Android Keystore. Each workspace on this device has its own entry; a phone's grants for
//! the workspaces it controls are kept here too (native apps plan, G16).
//!
//! On Windows, debug builds (`pnpm dev`) always share the release build's entries:
//! Credential Manager keys them by name only, not by the program that wrote them.
//!
//! On macOS, debug builds share the release build's entries when they are launched
//! signed: `scripts/dev-runner.sh` signs them with a Developer ID under the
//! release identifier, so the keychain takes them for the same app, and sets
//! `WORSHIPQ_SYSTEM_KEYCHAIN`. Otherwise every rebuild would be a new, ad-hoc signed binary
//! that macOS no longer recognises, and the keychain would ask for the login password again
//! after each one; so an unsigned debug build keeps the secrets in a plain file instead.
//! Release builds never compile that file store.

use tauri::AppHandle;

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn check(account: &str) -> Result<(), String> {
    if account.is_empty() || account.len() > 200 {
        return Err("invalid keychain account".into());
    }
    Ok(())
}

/// The keychain service the entries are kept under: the app's own identifier.
#[cfg(desktop)]
const SERVICE: &str = "com.worship-q.desktop";
#[cfg(mobile)]
const SERVICE: &str = "com.worship-q.app";

#[cfg(not(target_os = "android"))]
mod system {
    use super::{err, SERVICE};
    use keyring::Entry;

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, account).map_err(err)
    }

    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        entry(account)?.set_password(secret).map_err(err)
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(err(e)),
        }
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
}

/// Android: `keyring-core` with the store that encrypts each secret with a key in the Android
/// Keystore and keeps it in the app's own preferences. Tauri sets up what it needs.
#[cfg(target_os = "android")]
mod system {
    use super::{err, SERVICE};
    use keyring_core::{CredentialStore, Entry, Error};
    use std::sync::{Arc, OnceLock};

    fn store() -> Result<Arc<CredentialStore>, String> {
        static STORE: OnceLock<Arc<CredentialStore>> = OnceLock::new();
        if let Some(store) = STORE.get() {
            return Ok(store.clone());
        }
        let store: Arc<CredentialStore> =
            android_native_keyring_store::Store::new().map_err(err)?;
        Ok(STORE.get_or_init(|| store).clone())
    }

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new_in_store(&store()?, SERVICE, account).map_err(err)
    }

    pub fn set(account: &str, secret: &str) -> Result<(), String> {
        entry(account)?.set_password(secret).map_err(err)
    }

    pub fn get(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(err(e)),
        }
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    }
}

#[cfg(debug_assertions)]
mod file {
    use super::err;
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

    /// Whether this run uses the system keychain: always on Windows, where Credential
    /// Manager does not tie entries to the binary that wrote them, and on phones and
    /// tablets, whose debug builds are signed for the team too; on macOS only when the dev
    /// runner signed it.
    pub fn bypassed() -> bool {
        cfg!(windows) || cfg!(mobile) || std::env::var_os("WORSHIPQ_SYSTEM_KEYCHAIN").is_some()
    }

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

    pub fn set(app: &AppHandle, account: &str, secret: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(err)?;
        let mut secrets = read(app)?;
        secrets.insert(account.to_string(), secret.to_string());
        write(app, &secrets)
    }

    pub fn get(app: &AppHandle, account: &str) -> Result<Option<String>, String> {
        let _guard = LOCK.lock().map_err(err)?;
        Ok(read(app)?.remove(account))
    }

    pub fn delete(app: &AppHandle, account: &str) -> Result<(), String> {
        let _guard = LOCK.lock().map_err(err)?;
        let mut secrets = read(app)?;
        if secrets.remove(account).is_some() {
            write(app, &secrets)?;
        }
        Ok(())
    }
}

/// Stores a secret. The interface reads it back before trusting that it is kept.
#[tauri::command(async)]
pub fn keychain_set(app: AppHandle, account: String, secret: String) -> Result<(), String> {
    check(&account)?;
    #[cfg(debug_assertions)]
    if !file::bypassed() {
        return file::set(&app, &account, &secret);
    }
    let _ = app;
    system::set(&account, &secret)
}

/// The stored secret, or nothing when there is none.
#[tauri::command(async)]
pub fn keychain_get(app: AppHandle, account: String) -> Result<Option<String>, String> {
    check(&account)?;
    #[cfg(debug_assertions)]
    {
        if !file::bypassed() {
            return file::get(&app, &account);
        }
        // A dev run on the system keychain (signed on macOS, any on Windows): a token an
        // earlier run kept in the file moves into the keychain, where the release build
        // finds it too. The keychain's own entry wins.
        if let Some(secret) = system::get(&account)? {
            return Ok(Some(secret));
        }
        let Some(secret) = file::get(&app, &account)? else {
            return Ok(None);
        };
        if system::set(&account, &secret).is_ok()
            && system::get(&account).ok().flatten().as_deref() == Some(secret.as_str())
        {
            file::delete(&app, &account)?;
        }
        return Ok(Some(secret));
    }
    #[allow(unreachable_code)]
    {
        let _ = app;
        system::get(&account)
    }
}

#[tauri::command(async)]
pub fn keychain_delete(app: AppHandle, account: String) -> Result<(), String> {
    check(&account)?;
    #[cfg(debug_assertions)]
    {
        // Both, so a file copy left from an unsigned run cannot come back later.
        file::delete(&app, &account)?;
        if !file::bypassed() {
            return Ok(());
        }
    }
    let _ = app;
    system::delete(&account)
}
