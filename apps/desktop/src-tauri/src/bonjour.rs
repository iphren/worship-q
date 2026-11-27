//! mDNS on iPhone and iPad through the system's Bonjour (native apps plan; spike results).
//!
//! `mdns-sd` sends its own multicast packets, which iOS blocks unless Apple grants a restricted
//! entitlement. The system's DNS-SD calls need only `NSBonjourServices` and the local network
//! permission, and they find and are found by `mdns-sd` on computers (checked with macOS and
//! Windows in the spike).

use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

type Ref = *mut c_void;
type Err = i32;

const FLAGS_MORE_COMING: u32 = 0x1;
const FLAGS_ADD: u32 = 0x2;
const PROTOCOL_BOTH: u32 = 0x3;
/// DNS-SD wants the type without the domain that `mdns-sd` adds.
const REGTYPE: &str = "_worship-q._tcp";
/// The TXT keys the desktop advertises (`lan_advertise`).
const TXT_KEYS: [&str; 4] = ["ws", "dev", "fp", "name"];

type BrowseReply = unsafe extern "C" fn(
    Ref,
    u32,
    u32,
    Err,
    *const c_char,
    *const c_char,
    *const c_char,
    *mut c_void,
);
type ResolveReply = unsafe extern "C" fn(
    Ref,
    u32,
    u32,
    Err,
    *const c_char,
    *const c_char,
    u16,
    u16,
    *const u8,
    *mut c_void,
);
type AddrReply =
    unsafe extern "C" fn(Ref, u32, u32, Err, *const c_char, *const u8, u32, *mut c_void);

extern "C" {
    fn DNSServiceRegister(
        sd_ref: *mut Ref,
        flags: u32,
        interface: u32,
        name: *const c_char,
        regtype: *const c_char,
        domain: *const c_char,
        host: *const c_char,
        port: u16,
        txt_len: u16,
        txt: *const c_void,
        callback: Option<unsafe extern "C" fn()>,
        context: *mut c_void,
    ) -> Err;
    fn DNSServiceBrowse(
        sd_ref: *mut Ref,
        flags: u32,
        interface: u32,
        regtype: *const c_char,
        domain: *const c_char,
        callback: BrowseReply,
        context: *mut c_void,
    ) -> Err;
    fn DNSServiceResolve(
        sd_ref: *mut Ref,
        flags: u32,
        interface: u32,
        name: *const c_char,
        regtype: *const c_char,
        domain: *const c_char,
        callback: ResolveReply,
        context: *mut c_void,
    ) -> Err;
    fn DNSServiceGetAddrInfo(
        sd_ref: *mut Ref,
        flags: u32,
        interface: u32,
        protocol: u32,
        hostname: *const c_char,
        callback: AddrReply,
        context: *mut c_void,
    ) -> Err;
    fn DNSServiceRefSockFD(sd_ref: Ref) -> i32;
    fn DNSServiceProcessResult(sd_ref: Ref) -> Err;
    fn DNSServiceRefDeallocate(sd_ref: Ref);
    fn TXTRecordGetValuePtr(
        len: u16,
        txt: *const u8,
        key: *const c_char,
        value_len: *mut u8,
    ) -> *const u8;
}

/// A DNS-SD reference, released when dropped.
struct Owned(Ref);
// SAFETY: a reference is used by one thread at a time: the advertisement's only from behind
// its mutex, browsing's only within one call.
unsafe impl Send for Owned {}
impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the reference came from a successful DNS-SD call and is released once.
        unsafe { DNSServiceRefDeallocate(self.0) }
    }
}

static ADVERTISED: Mutex<Option<Owned>> = Mutex::new(None);

/// Processes replies on `sd_ref` until `until`, or until `done` says enough.
fn pump(sd_ref: Ref, until: Instant, done: &dyn Fn() -> bool) {
    // SAFETY: `sd_ref` is a live reference for the whole call.
    let fd = unsafe { DNSServiceRefSockFD(sd_ref) };
    while !done() {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        let mut pfd = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let wait = left.as_millis().min(i32::MAX as u128) as i32;
        // SAFETY: one valid pollfd.
        let ready = unsafe { libc::poll(&mut pfd, 1, wait) };
        // SAFETY: as above; replies call back into this thread only.
        if ready > 0 && unsafe { DNSServiceProcessResult(sd_ref) } != 0 {
            break;
        }
    }
}

fn cstr(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|e| e.to_string())
}

/// A TXT record in DNS-SD's wire form: each entry as its length and `key=value`.
fn txt_record(txt: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    let mut record = Vec::new();
    for (key, value) in txt {
        let entry = format!("{key}={value}");
        if entry.len() > 255 {
            return Err(format!("TXT entry {key} is too long"));
        }
        record.push(entry.len() as u8);
        record.extend_from_slice(entry.as_bytes());
    }
    Ok(record)
}

/// Advertises this device under `name` on `port`, replacing any earlier advertisement, or
/// stops advertising.
pub fn advertise(on: bool, name: &str, port: u16, txt: &[(&str, &str)]) -> Result<(), String> {
    let mut slot = ADVERTISED.lock().map_err(|e| e.to_string())?;
    *slot = None;
    if !on {
        return Ok(());
    }
    let record = txt_record(txt)?;
    let (name, regtype) = (cstr(name)?, cstr(REGTYPE)?);
    let mut sd_ref: Ref = std::ptr::null_mut();
    // SAFETY: the strings and the record outlive the call, which copies them.
    let code = unsafe {
        DNSServiceRegister(
            &mut sd_ref,
            0,
            0,
            name.as_ptr(),
            regtype.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            port.to_be(),
            record.len() as u16,
            record.as_ptr().cast(),
            None,
            std::ptr::null_mut(),
        )
    };
    if code != 0 {
        return Err(format!("could not advertise on the local network ({code})"));
    }
    *slot = Some(Owned(sd_ref));
    Ok(())
}

/// A device found on the local network.
pub struct Service {
    pub txt: HashMap<String, String>,
    pub addresses: Vec<String>,
    pub port: u16,
}

unsafe extern "C" fn on_browse(
    _: Ref,
    flags: u32,
    interface: u32,
    code: Err,
    name: *const c_char,
    _: *const c_char,
    domain: *const c_char,
    context: *mut c_void,
) {
    if code != 0 || flags & FLAGS_ADD == 0 {
        return;
    }
    // SAFETY: the context is the `Vec` `browse` passed, alive while it pumps.
    let out = &mut *(context as *mut Vec<(String, String, u32)>);
    let name = CStr::from_ptr(name).to_string_lossy().into_owned();
    let domain = CStr::from_ptr(domain).to_string_lossy().into_owned();
    if !out.iter().any(|(n, _, _)| *n == name) {
        out.push((name, domain, interface));
    }
}

#[derive(Default)]
struct Resolved {
    host: Option<String>,
    port: u16,
    txt: HashMap<String, String>,
}

unsafe extern "C" fn on_resolve(
    _: Ref,
    _: u32,
    _: u32,
    code: Err,
    _: *const c_char,
    host: *const c_char,
    port: u16,
    txt_len: u16,
    txt: *const u8,
    context: *mut c_void,
) {
    if code != 0 {
        return;
    }
    // SAFETY: the context is the `Resolved` `browse` passed, alive while it pumps.
    let out = &mut *(context as *mut Resolved);
    out.host = Some(CStr::from_ptr(host).to_string_lossy().into_owned());
    out.port = u16::from_be(port);
    for key in TXT_KEYS {
        let Ok(k) = CString::new(key) else { continue };
        let mut len = 0u8;
        let value = TXTRecordGetValuePtr(txt_len, txt, k.as_ptr(), &mut len);
        if !value.is_null() {
            let bytes = std::slice::from_raw_parts(value, len as usize);
            out.txt
                .insert(key.into(), String::from_utf8_lossy(bytes).into_owned());
        }
    }
}

struct Addresses {
    list: Vec<IpAddr>,
    settled: bool,
}

unsafe extern "C" fn on_addr(
    _: Ref,
    flags: u32,
    _: u32,
    code: Err,
    _: *const c_char,
    address: *const u8,
    _: u32,
    context: *mut c_void,
) {
    // SAFETY: the context is the `Addresses` `browse` passed, alive while it pumps.
    let out = &mut *(context as *mut Addresses);
    if code == 0 && !address.is_null() {
        // A `sockaddr`: length, family, then the address at its family's offset.
        let ip = match *address.add(1) as i32 {
            libc::AF_INET => {
                let b = std::slice::from_raw_parts(address.add(4), 4);
                Some(IpAddr::V4(Ipv4Addr::new(b[0], b[1], b[2], b[3])))
            }
            libc::AF_INET6 => {
                let b: [u8; 16] = std::slice::from_raw_parts(address.add(8), 16)
                    .try_into()
                    .unwrap_or([0; 16]);
                Some(IpAddr::V6(Ipv6Addr::from(b)))
            }
            _ => None,
        };
        if let Some(ip) = ip {
            if !out.list.contains(&ip) {
                out.list.push(ip);
            }
        }
    }
    if flags & FLAGS_MORE_COMING == 0 {
        out.settled = true;
    }
}

/// The addresses worth trying, best first: private IPv4 (the venue Wi-Fi), other IPv4, then
/// IPv6 with a global or unique-local address. Link-local IPv4 (`169.254`, such as a cable to
/// a Mac) comes last, and loopback and link-local IPv6, which need an interface, are left out.
pub fn order_addresses(found: &[IpAddr]) -> Vec<String> {
    fn rank(ip: &IpAddr) -> Option<u8> {
        match ip {
            IpAddr::V4(v4) if v4.is_loopback() || v4.is_unspecified() => None,
            IpAddr::V4(v4) if v4.is_private() => Some(0),
            IpAddr::V4(v4) if v4.is_link_local() => Some(3),
            IpAddr::V4(_) => Some(1),
            IpAddr::V6(v6) if v6.is_loopback() || v6.is_unspecified() => None,
            // fe80::/10 needs a scope to be reached.
            IpAddr::V6(v6) if v6.segments()[0] & 0xffc0 == 0xfe80 => None,
            IpAddr::V6(_) => Some(2),
        }
    }
    let mut ranked: Vec<(u8, usize, &IpAddr)> = found
        .iter()
        .enumerate()
        .filter_map(|(i, ip)| rank(ip).map(|r| (r, i, ip)))
        .collect();
    ranked.sort();
    ranked
        .into_iter()
        .map(|(_, _, ip)| ip.to_string())
        .collect()
}

/// Browses for `seconds`, then resolves each device found and looks up its addresses.
pub fn browse(seconds: u64) -> Result<Vec<Service>, String> {
    let regtype = cstr(REGTYPE)?;
    let local = cstr("local.")?;
    let mut found: Vec<(String, String, u32)> = Vec::new();
    let mut sd_ref: Ref = std::ptr::null_mut();
    // SAFETY: `found` outlives the reference, which is released before it is read.
    let code = unsafe {
        DNSServiceBrowse(
            &mut sd_ref,
            0,
            0,
            regtype.as_ptr(),
            local.as_ptr(),
            on_browse,
            (&mut found as *mut Vec<(String, String, u32)>).cast(),
        )
    };
    if code != 0 {
        return Err(format!("could not look on the local network ({code})"));
    }
    let browsing = Owned(sd_ref);
    pump(
        browsing.0,
        Instant::now() + Duration::from_secs(seconds),
        &|| false,
    );
    drop(browsing);

    let mut services = Vec::new();
    for (name, domain, interface) in found {
        let (name, domain) = (cstr(&name)?, cstr(&domain)?);
        let mut resolved = Resolved::default();
        let ctx: *mut Resolved = &mut resolved;
        let mut sd_ref: Ref = std::ptr::null_mut();
        // SAFETY: `resolved` outlives the reference, released before it is read.
        let code = unsafe {
            DNSServiceResolve(
                &mut sd_ref,
                0,
                interface,
                name.as_ptr(),
                regtype.as_ptr(),
                domain.as_ptr(),
                on_resolve,
                ctx.cast(),
            )
        };
        if code != 0 {
            continue;
        }
        let resolving = Owned(sd_ref);
        // SAFETY: only this thread writes `resolved`, from within `pump`.
        pump(
            resolving.0,
            Instant::now() + Duration::from_secs(3),
            &|| unsafe { (*ctx).host.is_some() },
        );
        drop(resolving);
        let Some(host) = resolved.host.take() else {
            continue;
        };

        // On any interface: limited to the one the service was seen on, the spike found
        // the lookup answered nothing.
        let host = cstr(&host)?;
        let mut addresses = Addresses {
            list: Vec::new(),
            settled: false,
        };
        let actx: *mut Addresses = &mut addresses;
        let mut sd_ref: Ref = std::ptr::null_mut();
        // SAFETY: `addresses` outlives the reference, released before it is read.
        let code = unsafe {
            DNSServiceGetAddrInfo(
                &mut sd_ref,
                0,
                0,
                PROTOCOL_BOTH,
                host.as_ptr(),
                on_addr,
                actx.cast(),
            )
        };
        if code != 0 {
            continue;
        }
        let looking = Owned(sd_ref);
        // SAFETY: as above.
        pump(
            looking.0,
            Instant::now() + Duration::from_secs(2),
            &|| unsafe { (*actx).settled && (*actx).list.iter().any(IpAddr::is_ipv4) },
        );
        drop(looking);
        services.push(Service {
            txt: resolved.txt,
            addresses: order_addresses(&addresses.list),
            port: resolved.port,
        });
    }
    Ok(services)
}

#[cfg(test)]
mod tests {
    use super::{order_addresses, txt_record};
    use std::net::IpAddr;

    fn ips(list: &[&str]) -> Vec<IpAddr> {
        list.iter().map(|s| s.parse().unwrap()).collect()
    }

    #[test]
    fn tries_the_venue_wifi_first_and_a_cable_to_a_mac_last() {
        assert_eq!(
            order_addresses(&ips(&[
                "169.254.10.2",
                "fe80::1",
                "fdb7::5",
                "127.0.0.1",
                "203.0.113.4",
                "10.0.0.52",
                "::1",
                "192.168.1.9",
            ])),
            [
                "10.0.0.52",
                "192.168.1.9",
                "203.0.113.4",
                "fdb7::5",
                "169.254.10.2"
            ]
        );
    }

    #[test]
    fn writes_txt_entries_with_their_lengths() {
        assert_eq!(
            txt_record(&[("ws", "a"), ("fp", "bc")]).unwrap(),
            b"\x04ws=a\x05fp=bc"
        );
        assert!(txt_record(&[("name", &"x".repeat(260))]).is_err());
    }
}
