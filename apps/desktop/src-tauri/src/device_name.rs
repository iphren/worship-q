//! The phone's or tablet's own name, offered in the name box when it first joins a
//! workspace (native apps plan M2.17).
//!
//! iOS gives an app the name its owner set only with Apple's user-assigned-device-name
//! entitlement; without it, the name is just the model ("iPhone", "iPad"), which tells no
//! phone from another on the desktop's list, so none is offered. Android gives the name set
//! in its settings. Desktops ask nothing: they have their own name.

/// The name, if the system gives one worth offering. A sync command, so Tauri runs it on the
/// main thread, which UIKit wants.
#[tauri::command]
pub fn device_name() -> Option<String> {
    let name = platform_name()?;
    let name = name.trim();
    (!name.is_empty()).then(|| name.chars().take(40).collect())
}

#[cfg(target_os = "ios")]
fn platform_name() -> Option<String> {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    // SAFETY: UIDevice's class methods and properties, on the main thread.
    let (name, model) = unsafe {
        let device: Retained<AnyObject> = msg_send![class!(UIDevice), currentDevice];
        let name: Retained<NSString> = msg_send![&device, name];
        let model: Retained<NSString> = msg_send![&device, model];
        (name.to_string(), model.to_string())
    };
    // Without the entitlement the name is the model.
    (name != model).then_some(name)
}

#[cfg(target_os = "android")]
fn platform_name() -> Option<String> {
    use jni::objects::{JObject, JString};
    use jni::JavaVM;

    let context = ndk_context::android_context();
    // SAFETY: the process's VM and application context, which tao keeps alive.
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let app = unsafe { JObject::from_raw(context.context().cast()) };
    let mut read = || -> jni::errors::Result<Option<String>> {
        let resolver = env
            .call_method(
                &app,
                "getContentResolver",
                "()Landroid/content/ContentResolver;",
                &[],
            )?
            .l()?;
        let key = env.new_string("device_name")?;
        let value = env
            .call_static_method(
                "android/provider/Settings$Global",
                "getString",
                "(Landroid/content/ContentResolver;Ljava/lang/String;)Ljava/lang/String;",
                &[(&resolver).into(), (&key).into()],
            )?
            .l()?;
        if value.is_null() {
            return Ok(None);
        }
        Ok(Some(env.get_string(&JString::from(value))?.into()))
    };
    let name = read();
    if name.is_err() {
        let _ = env.exception_clear();
    }
    name.ok().flatten()
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn platform_name() -> Option<String> {
    None
}
