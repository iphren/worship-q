//! The system keychain, for the church device token (decision D23): Keychain on macOS,
//! Credential Manager on Windows. Each workspace on this computer has its own entry.

use keyring::Entry;

const SERVICE: &str = "com.worship-q.desktop";

fn err(e: impl ToString) -> String {
    e.to_string()
}

fn entry(account: &str) -> Result<Entry, String> {
    if account.is_empty() || account.len() > 200 {
        return Err("invalid keychain account".into());
    }
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
