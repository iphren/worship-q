//! Keeps the display awake while live audio broadcasting is switched on (live audio plan,
//! L9; task breakdown M2.5). With the display asleep, WebKit starts no capture and, after some
//! minutes, the audio runs short; so the app holds the system's display-sleep assertion while
//! the switch is on, and releases it when the switch goes off, the workspace closes or the
//! app quits. A screen lock set by policy is not prevented.

use std::sync::Mutex;

/// How an assertion is taken and given back on this system.
trait Assertion: Send {
    fn take(&mut self) -> bool;
    fn release(&mut self);
}

/// Holds at most one assertion: on twice takes one, off releases it once, off alone is harmless.
struct Holder<A: Assertion> {
    assertion: A,
    held: bool,
}

impl<A: Assertion> Holder<A> {
    fn set(&mut self, on: bool) {
        if on && !self.held {
            self.held = self.assertion.take();
        } else if !on && self.held {
            self.assertion.release();
            self.held = false;
        }
    }
}

#[cfg(target_os = "macos")]
mod system {
    use objc2_foundation::NSString;
    use std::ffi::c_void;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: *const c_void,
            level: u32,
            name: *const c_void,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    const LEVEL_ON: u32 = 255;

    /// `PreventUserIdleDisplaySleep`, through IOKit. `NSString` is toll-free bridged to
    /// `CFString`, which IOKit takes.
    #[derive(Default)]
    pub struct DisplayAssertion {
        id: u32,
    }

    impl super::Assertion for DisplayAssertion {
        fn take(&mut self) -> bool {
            let kind = NSString::from_str("PreventUserIdleDisplaySleep");
            let name = NSString::from_str("Worship Q is broadcasting live audio");
            let mut id = 0u32;
            let result = unsafe {
                IOPMAssertionCreateWithName(
                    &*kind as *const NSString as *const c_void,
                    LEVEL_ON,
                    &*name as *const NSString as *const c_void,
                    &mut id,
                )
            };
            self.id = id;
            result == 0
        }

        fn release(&mut self) {
            unsafe {
                IOPMAssertionRelease(self.id);
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod system {
    use std::sync::mpsc;
    use std::thread;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    /// `SetThreadExecutionState` belongs to the thread that calls it, so a thread of its own
    /// holds it until told to let go.
    #[derive(Default)]
    pub struct DisplayAssertion {
        stop: Option<mpsc::Sender<()>>,
    }

    impl super::Assertion for DisplayAssertion {
        fn take(&mut self) -> bool {
            let (stop, wait) = mpsc::channel::<()>();
            let spawned = thread::Builder::new()
                .name("display-awake".into())
                .spawn(move || {
                    unsafe {
                        SetThreadExecutionState(
                            ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED,
                        );
                    }
                    let _ = wait.recv();
                    unsafe {
                        SetThreadExecutionState(ES_CONTINUOUS);
                    }
                });
            if spawned.is_err() {
                return false;
            }
            self.stop = Some(stop);
            true
        }

        fn release(&mut self) {
            if let Some(stop) = self.stop.take() {
                let _ = stop.send(());
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod system {
    #[derive(Default)]
    pub struct DisplayAssertion;

    impl super::Assertion for DisplayAssertion {
        fn take(&mut self) -> bool {
            true
        }
        fn release(&mut self) {}
    }
}

/// The app's one display assertion, managed by Tauri.
pub struct Power(Mutex<Holder<system::DisplayAssertion>>);

impl Power {
    pub fn new() -> Self {
        Power(Mutex::new(Holder {
            assertion: system::DisplayAssertion::default(),
            held: false,
        }))
    }

    /// Releases the assertion, as when the main window's page loads again or the app quits.
    pub fn release(&self) {
        if let Ok(mut holder) = self.0.lock() {
            holder.set(false);
        }
    }
}

/// Keeps the display awake, or lets it sleep again.
#[tauri::command]
pub fn keep_display_awake(power: tauri::State<'_, Power>, on: bool) -> Result<(), String> {
    power.0.lock().map_err(|e| e.to_string())?.set(on);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Counting {
        taken: u32,
        released: u32,
    }

    impl Assertion for Counting {
        fn take(&mut self) -> bool {
            self.taken += 1;
            true
        }
        fn release(&mut self) {
            self.released += 1;
        }
    }

    #[test]
    fn on_twice_then_off_takes_once_and_releases_once() {
        let mut holder = Holder {
            assertion: Counting::default(),
            held: false,
        };
        holder.set(true);
        holder.set(true);
        holder.set(false);
        assert_eq!(holder.assertion.taken, 1);
        assert_eq!(holder.assertion.released, 1);
    }

    #[test]
    fn off_without_on_is_harmless() {
        let mut holder = Holder {
            assertion: Counting::default(),
            held: false,
        };
        holder.set(false);
        assert_eq!(holder.assertion.released, 0);
    }
}
