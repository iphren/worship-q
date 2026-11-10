//! Notices when the app is open more than once on this computer.
//!
//! Two copies share one database, one overlay address and one church credential, and the
//! church server keeps only the newest connection of a device, so each copy keeps dropping
//! the other's. Neither can tell why on its own, so both are told and show a banner.
//!
//! A version older than this one marks nothing, so a copy that could not have the overlay
//! address also asks whether the app is what holds it (`overlay`).
//!
//! Each copy holds a locked file in a shared folder for as long as it runs. The system
//! releases the lock when the process ends, however it ends, so a file that can be locked
//! was left by a copy that is gone.

use crate::overlay::Overlay;
use std::fs::{self, File, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

const INSTANCES_DIR: &str = "instances";
pub const CHANGED_EVENT: &str = "instances-changed";
/// Also the wait before the first look, so a copy restarting into an update does not count
/// the one it replaces.
const CHECK_EVERY: Duration = Duration::from_secs(2);
/// A file this new may belong to a copy that has not locked it yet, so it is not removed.
const SETTLING: Duration = Duration::from_secs(10);

pub struct Instances {
    /// How many other copies were running at the last look.
    others: Arc<AtomicUsize>,
    /// Held, locked, until the process ends.
    _own: Option<File>,
}

impl Instances {
    /// Marks this copy as running and keeps watching for others. The app opens all the same
    /// if the folder cannot be used; it then never reports another copy.
    pub fn start(app: AppHandle<Wry>, root: &Path) -> Self {
        let others = Arc::new(AtomicUsize::new(0));
        let dir = root.join(INSTANCES_DIR);
        let own = match claim(&dir) {
            Ok(own) => own,
            Err(e) => {
                eprintln!("could not watch for other copies of the app: {e}");
                return Self { others, _own: None };
            }
        };
        let (name, file) = own;
        let count = others.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(CHECK_EVERY);
            let mut now = count_others(&dir, &name);
            // A version from before this file existed holds no lock, but it does hold the
            // overlay address if it was opened first.
            if now == 0
                && app
                    .try_state::<Overlay>()
                    .is_some_and(|overlay| overlay.held_by_another_copy())
            {
                now = 1;
            }
            if count.swap(now, Ordering::Relaxed) != now {
                let _ = app.emit(CHANGED_EVENT, now);
            }
        });
        Self {
            others,
            _own: Some(file),
        }
    }
}

/// Creates this copy's file and locks it.
fn claim(dir: &Path) -> std::io::Result<(PathBuf, File)> {
    fs::create_dir_all(dir)?;
    let started = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = dir.join(format!("{}-{started}.lock", std::process::id()));
    let file = File::create_new(&path)?;
    // Another copy may be holding it for a moment while it looks.
    file.lock()?;
    Ok((path, file))
}

/// Counts the other copies' files that are still locked, and clears away those left behind.
fn count_others(dir: &Path, own: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut running = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path == own {
            continue;
        }
        let Ok(file) = File::open(&path) else {
            continue;
        };
        match file.try_lock() {
            Err(TryLockError::WouldBlock) => running += 1,
            Ok(()) => {
                let settled = file
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|at| at.elapsed().ok())
                    .is_some_and(|age| age > SETTLING);
                if settled {
                    let _ = fs::remove_file(&path);
                }
            }
            Err(TryLockError::Error(_)) => {}
        }
    }
    running
}

/// How many other copies of the app are running on this computer.
#[tauri::command]
pub fn other_instances(instances: State<'_, Instances>) -> usize {
    instances.others.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("worship-q-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn counts_the_copies_that_are_still_running() {
        let dir = temp_dir("instances-running");
        let (first, first_file) = claim(&dir).unwrap();
        assert_eq!(count_others(&dir, &first), 0);

        let (second, second_file) = claim(&dir).unwrap();
        assert_eq!(count_others(&dir, &first), 1);
        assert_eq!(count_others(&dir, &second), 1);

        drop(second_file);
        assert_eq!(count_others(&dir, &first), 0);
        drop(first_file);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clears_a_file_left_behind_once_it_has_settled() {
        let dir = temp_dir("instances-stale");
        let (own, _own_file) = claim(&dir).unwrap();
        let (left, left_file) = claim(&dir).unwrap();
        drop(left_file);

        // Too new to tell from a copy that is still starting.
        assert_eq!(count_others(&dir, &own), 0);
        assert!(left.exists());

        let old = SystemTime::now() - SETTLING - Duration::from_secs(1);
        File::options()
            .write(true)
            .open(&left)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(count_others(&dir, &own), 0);
        assert!(!left.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
