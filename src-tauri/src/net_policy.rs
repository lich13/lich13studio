//! Outbound HTTP policy for native requests.
//!
//! * `HostPolicy::App` is for app-initiated requests to fixed public services and
//!   never reaches loopback, private, link-local or cloud metadata addresses.
//! * `HostPolicy::User` is for hosts the user configured (providers, WebDAV). Local
//!   model servers and LAN WebDAV stay usable, but a DNS name must not resolve to
//!   loopback/link-local/metadata (DNS rebinding), and the resolved addresses are
//!   pinned so the connection uses exactly what was checked.

use reqwest::header::HeaderName;
use reqwest::redirect;
use reqwest::ClientBuilder;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use url::{Host, Url};

const MAX_REDIRECTS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostPolicy {
    App,
    User,
}

pub fn validate_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| String::from("Invalid request URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https requests are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials in request URLs are not allowed".into());
    }
    if url.host().is_none() {
        return Err("Request URL has no host".into());
    }
    Ok(url)
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(v6)),
        other => other,
    }
}

fn is_metadata(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4 == Ipv4Addr::new(169, 254, 169, 254) || v4 == Ipv4Addr::new(100, 100, 100, 200)
        }
        IpAddr::V6(v6) => v6 == Ipv6Addr::new(0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254),
    }
}

fn is_always_blocked(ip: IpAddr) -> bool {
    let special = match ip {
        IpAddr::V4(v4) => v4.is_unspecified() || v4.is_multicast() || v4.is_broadcast(),
        IpAddr::V6(v6) => v6.is_unspecified() || v6.is_multicast(),
    };
    special || is_metadata(ip)
}

fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

fn is_link_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_link_local(),
        IpAddr::V6(v6) => (v6.segments()[0] & 0xffc0) == 0xfe80,
    }
}

fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_private() || (a == 100 && (64..128).contains(&b)) || a == 0
        }
        IpAddr::V6(v6) => (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

/// `literal` is true when the user typed an IP literal or `localhost` directly.
pub fn check_ip(ip: IpAddr, policy: HostPolicy, literal: bool) -> Result<(), String> {
    let ip = canonical(ip);
    let blocked = is_always_blocked(ip)
        || match policy {
            HostPolicy::App => is_loopback(ip) || is_link_local(ip) || is_private(ip),
            HostPolicy::User => !literal && (is_loopback(ip) || is_link_local(ip)),
        };
    if blocked {
        Err("Request target address is not allowed".into())
    } else {
        Ok(())
    }
}

fn is_localhost_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost" || host.ends_with(".localhost")
}

fn literal_ip(url: &Url) -> Option<IpAddr> {
    match url.host()? {
        Host::Ipv4(v4) => Some(IpAddr::V4(v4)),
        Host::Ipv6(v6) => Some(IpAddr::V6(v6)),
        Host::Domain(_) => None,
    }
}

/// Validate addresses for a URL. Returns the domain and its checked addresses when
/// the host is a DNS name, so callers can pin them.
pub fn check_resolved(url: &Url, policy: HostPolicy, addrs: &[SocketAddr]) -> Result<(), String> {
    let literal = url.host_str().is_some_and(is_localhost_name);
    if addrs.is_empty() {
        return Err("Request host did not resolve".into());
    }
    addrs
        .iter()
        .try_for_each(|addr| check_ip(addr.ip(), policy, literal))
}

fn resolve_blocking(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url.host_str().ok_or("Request URL has no host")?;
    let port = url.port_or_known_default().unwrap_or(443);
    (host, port)
        .to_socket_addrs()
        .map(|addrs| addrs.collect())
        .map_err(|_| String::from("Request host did not resolve"))
}

fn check_url_blocking(url: &Url, policy: HostPolicy) -> Result<Vec<SocketAddr>, String> {
    if let Some(ip) = literal_ip(url) {
        check_ip(ip, policy, true)?;
        return Ok(Vec::new());
    }
    let addrs = resolve_blocking(url)?;
    check_resolved(url, policy, &addrs)?;
    Ok(addrs)
}

/// Validate the URL, resolve once, check every address and return a client builder
/// pinned to those addresses with a redirect policy that re-applies the checks.
pub async fn guarded_client(raw: &str, policy: HostPolicy) -> Result<(Url, ClientBuilder), String> {
    let url = validate_url(raw)?;
    let check_target = url.clone();
    let addrs =
        tauri::async_runtime::spawn_blocking(move || check_url_blocking(&check_target, policy))
            .await
            .map_err(|_| String::from("Request host did not resolve"))??;
    let mut builder = ClientBuilder::new().redirect(redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("Too many redirects");
        }
        match validate_url(attempt.url().as_str())
            .and_then(|next| check_url_blocking(&next, policy).map(|_| ()))
        {
            Ok(()) => attempt.follow(),
            Err(error) => attempt.error(error),
        }
    }));
    if let (Some(domain), false) = (url.host_str(), addrs.is_empty()) {
        builder = builder.resolve_to_addrs(domain, &addrs);
    }
    Ok((url, builder))
}

/// Headers the transport owns. Renderer-supplied overrides are dropped.
pub fn is_forbidden_header(name: &HeaderName) -> bool {
    let name = name.as_str();
    matches!(
        name,
        "host"
            | "content-length"
            | "transfer-encoding"
            | "connection"
            | "keep-alive"
            | "upgrade"
            | "te"
            | "trailer"
            | "expect"
            | "proxy-authorization"
            | "proxy-connection"
    ) || name.starts_with("proxy-")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(value: &str) -> IpAddr {
        value.parse().unwrap()
    }

    #[test]
    fn rejects_non_http_schemes_and_userinfo() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com",
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "http://",
        ] {
            assert!(validate_url(raw).is_err(), "{raw}");
        }
        assert!(validate_url("https://api.example.com/v1").is_ok());
    }

    #[test]
    fn app_policy_blocks_internal_addresses() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.2",
            "172.16.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "169.254.1.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fd00::1",
            "::ffff:127.0.0.1",
            "fd00:ec2::254",
        ] {
            assert!(
                check_ip(ip(value), HostPolicy::App, true).is_err(),
                "{value}"
            );
        }
        assert!(check_ip(ip("140.82.112.3"), HostPolicy::App, false).is_ok());
    }

    #[test]
    fn user_policy_allows_typed_local_hosts_but_blocks_rebinding() {
        assert!(check_ip(ip("127.0.0.1"), HostPolicy::User, true).is_ok());
        assert!(check_ip(ip("192.168.1.2"), HostPolicy::User, false).is_ok());
        assert!(check_ip(ip("127.0.0.1"), HostPolicy::User, false).is_err());
        assert!(check_ip(ip("fe80::1"), HostPolicy::User, false).is_err());
        assert!(check_ip(ip("169.254.169.254"), HostPolicy::User, true).is_err());
        assert!(check_ip(ip("::ffff:169.254.169.254"), HostPolicy::User, true).is_err());

        let named = Url::parse("https://rebind.example.com/").unwrap();
        let loopback = [SocketAddr::new(ip("127.0.0.1"), 443)];
        assert!(check_resolved(&named, HostPolicy::User, &loopback).is_err());
        let localhost = Url::parse("http://localhost:11434/").unwrap();
        assert!(check_resolved(&localhost, HostPolicy::User, &loopback).is_ok());
        assert!(check_resolved(&named, HostPolicy::User, &[]).is_err());
    }

    #[test]
    fn literal_hosts_are_checked_without_dns() {
        let url = Url::parse("http://169.254.169.254/latest/meta-data").unwrap();
        assert!(check_url_blocking(&url, HostPolicy::User).is_err());
        let url = Url::parse("http://127.0.0.1:1234/v1").unwrap();
        assert!(check_url_blocking(&url, HostPolicy::User)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn drops_transport_owned_headers() {
        for name in [
            "host",
            "Host",
            "content-length",
            "transfer-encoding",
            "proxy-authorization",
            "connection",
        ] {
            assert!(
                is_forbidden_header(&HeaderName::from_bytes(name.as_bytes()).unwrap()),
                "{name}"
            );
        }
        for name in [
            "authorization",
            "x-api-key",
            "content-type",
            "anthropic-version",
        ] {
            assert!(
                !is_forbidden_header(&HeaderName::from_bytes(name.as_bytes()).unwrap()),
                "{name}"
            );
        }
    }
}
