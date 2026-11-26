//! Outbound HTTP policy for native requests.
//!
//! * `HostPolicy::App` is for app-initiated requests to fixed public services and
//!   never reaches loopback, private, link-local or cloud metadata addresses.
//! * `HostPolicy::User` is for hosts the user configured (providers, WebDAV). Local
//!   model servers and LAN WebDAV stay usable, but a DNS name must not resolve to
//!   loopback/link-local/metadata (DNS rebinding), and the resolved addresses are
//!   pinned so the connection uses exactly what was checked.

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::HeaderName;
use reqwest::{redirect, Client, ClientBuilder};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use url::{Host, Url};

pub const MAX_REDIRECTS: usize = 10;
const CLIENT_CACHE_TTL: Duration = Duration::from_secs(300);
const CLIENT_CACHE_MAX_ENTRIES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HostPolicy {
    App,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ClientCacheKey {
    policy: HostPolicy,
    follow_redirects: bool,
    scheme: String,
    host: String,
    port: u16,
    addrs: Vec<SocketAddr>,
}

struct CachedClient {
    client: Client,
    created_at: Instant,
}

static CLIENT_POOL: OnceLock<Mutex<HashMap<ClientCacheKey, CachedClient>>> = OnceLock::new();

fn client_pool() -> &'static Mutex<HashMap<ClientCacheKey, CachedClient>> {
    CLIENT_POOL.get_or_init(|| Mutex::new(HashMap::new()))
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

struct PolicyDnsResolver {
    policy: HostPolicy,
    pinned_host: Option<String>,
    pinned_addrs: Vec<SocketAddr>,
}

impl PolicyDnsResolver {
    fn resolve_and_validate_host(
        host: &str,
        policy: HostPolicy,
    ) -> Result<Vec<SocketAddr>, String> {
        let bare = host.trim_start_matches('[').trim_end_matches(']');
        if let Ok(ip) = bare.parse::<IpAddr>() {
            check_ip(ip, policy, true)?;
            return Ok(vec![SocketAddr::new(ip, 0)]);
        }
        let addrs: Vec<SocketAddr> = (host, 0)
            .to_socket_addrs()
            .map(|iter| iter.collect())
            .map_err(|_| String::from("Request host did not resolve"))?;
        if addrs.is_empty() {
            return Err("Request host did not resolve".into());
        }
        let literal = is_localhost_name(host);
        addrs
            .iter()
            .try_for_each(|addr| check_ip(addr.ip(), policy, literal))?;
        Ok(addrs)
    }
}

impl Resolve for PolicyDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        if self
            .pinned_host
            .as_deref()
            .is_some_and(|pinned| pinned.eq_ignore_ascii_case(&host))
            && !self.pinned_addrs.is_empty()
        {
            let pinned = self.pinned_addrs.clone();
            return Box::pin(async move { Ok(Box::new(pinned.into_iter()) as Addrs) });
        }

        let policy = self.policy;
        Box::pin(async move {
            let addrs = tauri::async_runtime::spawn_blocking(move || {
                Self::resolve_and_validate_host(&host, policy)
            })
            .await
            .map_err(|_| -> Box<dyn std::error::Error + Send + Sync> {
                Box::new(std::io::Error::other("Request host did not resolve"))
            })?
            .map_err(|err| -> Box<dyn std::error::Error + Send + Sync> {
                Box::new(std::io::Error::other(err))
            })?;
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

pub fn is_same_origin(left: &Url, right: &Url) -> bool {
    left.scheme().eq_ignore_ascii_case(right.scheme())
        && left.host() == right.host()
        && left.port_or_known_default() == right.port_or_known_default()
}

pub fn validate_redirect_hop(
    prev: &Url,
    next_raw: &str,
    policy: HostPolicy,
) -> Result<Url, String> {
    let next = validate_url(next_raw)?;
    if prev.scheme().eq_ignore_ascii_case("https") && !next.scheme().eq_ignore_ascii_case("https") {
        return Err("Redirect scheme downgrade is not allowed".into());
    }
    if policy == HostPolicy::User && !is_same_origin(prev, &next) {
        return Err("Cross-origin redirects are not allowed".into());
    }
    if let Some(ip) = literal_ip(&next) {
        check_ip(ip, policy, true)?;
    }
    Ok(next)
}

fn build_pinned_client_builder(
    url: &Url,
    policy: HostPolicy,
    addrs: &[SocketAddr],
    follow_redirects: bool,
) -> ClientBuilder {
    // Store port 0 so hyper-util always applies the active hop's scheme/explicit port
    // while keeping the exact validated IP addresses pinned without proxy bypass.
    let portless_pinned: Vec<SocketAddr> = addrs
        .iter()
        .map(|addr| SocketAddr::new(addr.ip(), 0))
        .collect();
    let resolver = Arc::new(PolicyDnsResolver {
        policy,
        pinned_host: url.host_str().map(ToOwned::to_owned),
        pinned_addrs: portless_pinned,
    });
    let redirect_policy = if follow_redirects {
        redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("Too many redirects");
            }
            let Some(prev) = attempt.previous().last() else {
                return attempt.error("Missing redirect origin");
            };
            match validate_redirect_hop(prev, attempt.url().as_str(), policy) {
                Ok(_) => attempt.follow(),
                Err(error) => attempt.error(error),
            }
        })
    } else {
        redirect::Policy::none()
    };
    ClientBuilder::new()
        .no_proxy()
        .dns_resolver(resolver)
        .redirect(redirect_policy)
}

fn get_or_build_cached_client(
    url: &Url,
    policy: HostPolicy,
    addrs: &[SocketAddr],
    follow_redirects: bool,
) -> Result<Client, String> {
    let mut sorted_addrs = addrs.to_vec();
    sorted_addrs.sort_unstable();
    sorted_addrs.dedup();

    let key = ClientCacheKey {
        policy,
        follow_redirects,
        scheme: url.scheme().to_ascii_lowercase(),
        host: url.host_str().unwrap_or_default().to_ascii_lowercase(),
        port: url.port_or_known_default().unwrap_or(443),
        addrs: sorted_addrs,
    };

    let now = Instant::now();
    if let Ok(mut pool) = client_pool().lock() {
        pool.retain(|_, entry| now.duration_since(entry.created_at) < CLIENT_CACHE_TTL);
        if let Some(entry) = pool.get(&key) {
            return Ok(entry.client.clone());
        }
    }

    let client = build_pinned_client_builder(url, policy, addrs, follow_redirects)
        .build()
        .map_err(|error| error.to_string())?;

    if let Ok(mut pool) = client_pool().lock() {
        if pool.len() >= CLIENT_CACHE_MAX_ENTRIES {
            if let Some(oldest_key) = pool
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(k, _)| k.clone())
            {
                pool.remove(&oldest_key);
            }
        }
        pool.insert(
            key,
            CachedClient {
                client: client.clone(),
                created_at: now,
            },
        );
    }

    Ok(client)
}

async fn guarded_http_client_inner(
    raw: &str,
    policy: HostPolicy,
    follow_redirects: bool,
) -> Result<(Url, Client), String> {
    let url = validate_url(raw)?;
    let check_target = url.clone();
    let addrs =
        tauri::async_runtime::spawn_blocking(move || check_url_blocking(&check_target, policy))
            .await
            .map_err(|_| String::from("Request host did not resolve"))??;
    let client = get_or_build_cached_client(&url, policy, &addrs, follow_redirects)?;
    Ok((url, client))
}

/// Validate the URL, resolve and check every address on each call (preserving DNS
/// rebinding defense), and return a short-TTL cached `Client` pinned to the checked
/// addresses so warm TLS sessions and HTTP/2 pools are reused across turns.
pub async fn guarded_http_client(raw: &str, policy: HostPolicy) -> Result<(Url, Client), String> {
    guarded_http_client_inner(raw, policy, true).await
}

/// Same validation and IP pinning as [`guarded_http_client`], with automatic HTTP
/// redirects disabled so callers with non-replayable streaming bodies can validate
/// and replay each redirect hop manually.
pub async fn guarded_http_client_no_redirect(
    raw: &str,
    policy: HostPolicy,
) -> Result<(Url, Client), String> {
    guarded_http_client_inner(raw, policy, false).await
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
    fn cached_client_pool_partitions_by_policy_and_pinned_addrs() {
        let test_host = "api.example.invalid";
        let count_for_host = || {
            client_pool()
                .lock()
                .unwrap()
                .keys()
                .filter(|k| k.host == test_host)
                .count()
        };
        client_pool()
            .lock()
            .unwrap()
            .retain(|k, _| k.host != test_host);
        let url = Url::parse("https://api.example.invalid/v1").unwrap();
        let addr_a = [SocketAddr::new(ip("93.184.216.34"), 443)];
        let addr_b = [SocketAddr::new(ip("93.184.216.35"), 443)];

        let _first = get_or_build_cached_client(&url, HostPolicy::User, &addr_a, true).unwrap();
        assert_eq!(count_for_host(), 1);

        let _reused = get_or_build_cached_client(&url, HostPolicy::User, &addr_a, true).unwrap();
        assert_eq!(count_for_host(), 1);

        let _rotated_dns =
            get_or_build_cached_client(&url, HostPolicy::User, &addr_b, true).unwrap();
        assert_eq!(count_for_host(), 2);

        let _app_policy = get_or_build_cached_client(&url, HostPolicy::App, &addr_a, true).unwrap();
        assert_eq!(count_for_host(), 3);

        let _no_redirect =
            get_or_build_cached_client(&url, HostPolicy::User, &addr_a, false).unwrap();
        assert_eq!(count_for_host(), 4);
    }

    #[test]
    fn redirect_hop_policy_blocks_cross_origin_and_scheme_downgrades() {
        let user_origin = Url::parse("https://api.example.invalid/v1/messages").unwrap();
        assert!(validate_redirect_hop(
            &user_origin,
            "https://api.example.invalid/v2/messages",
            HostPolicy::User
        )
        .is_ok());
        assert_eq!(
            validate_redirect_hop(
                &user_origin,
                "https://evil.example.invalid/collect",
                HostPolicy::User
            )
            .unwrap_err(),
            "Cross-origin redirects are not allowed"
        );
        assert_eq!(
            validate_redirect_hop(
                &user_origin,
                "https://api.example.invalid:8443/v2/messages",
                HostPolicy::User
            )
            .unwrap_err(),
            "Cross-origin redirects are not allowed"
        );
        assert_eq!(
            validate_redirect_hop(
                &user_origin,
                "http://api.example.invalid/v2/messages",
                HostPolicy::User
            )
            .unwrap_err(),
            "Redirect scheme downgrade is not allowed"
        );

        let app_origin =
            Url::parse("https://api.github.com/repos/example/releases/latest").unwrap();
        assert!(validate_redirect_hop(
            &app_origin,
            "https://objects.githubusercontent.com/asset",
            HostPolicy::App
        )
        .is_ok());
        assert_eq!(
            validate_redirect_hop(
                &app_origin,
                "http://objects.githubusercontent.com/asset",
                HostPolicy::App
            )
            .unwrap_err(),
            "Redirect scheme downgrade is not allowed"
        );
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

    #[tokio::test]
    async fn follows_same_origin_redirects_while_blocking_cross_origin_metadata_and_env_proxy() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        // 1. Same-origin redirect on HostPolicy::User preserves pinned IP and headers
        let same_origin_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let same_origin_port = same_origin_listener.local_addr().unwrap().port();
        let same_origin_task = tokio::spawn(async move {
            for step in 0..2 {
                let (mut sock, _) = same_origin_listener.accept().await.unwrap();
                let mut buf = [0u8; 1024];
                let n = sock.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                assert!(req.contains("x-api-key: secret-anthropic-key"));
                if step == 0 {
                    let resp = format!(
                        "HTTP/1.1 302 Found\r\nLocation: http://localhost:{same_origin_port}/v2/ok\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    sock.write_all(resp.as_bytes()).await.unwrap();
                } else {
                    sock.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npinned!",
                    )
                    .await
                    .unwrap();
                }
            }
        });

        let start_url = format!("http://localhost:{same_origin_port}/v1/start");
        let parsed = validate_url(&start_url).unwrap();
        let pinned_v4 = [SocketAddr::new(ip("127.0.0.1"), same_origin_port)];
        let client =
            get_or_build_cached_client(&parsed, HostPolicy::User, &pinned_v4, true).unwrap();
        let body = client
            .get(parsed)
            .header("x-api-key", "secret-anthropic-key")
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(body, "pinned!");
        same_origin_task.await.unwrap();

        // 2. Cross-port / cross-origin redirect on HostPolicy::User must fail BEFORE connecting to target
        let trap_target_hit = Arc::new(AtomicBool::new(false));
        let trap_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let trap_port = trap_listener.local_addr().unwrap().port();
        let trap_flag = Arc::clone(&trap_target_hit);
        let _trap_task = tokio::spawn(async move {
            if trap_listener.accept().await.is_ok() {
                trap_flag.store(true, Ordering::SeqCst);
            }
        });

        let cross_port_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cross_port_src = cross_port_listener.local_addr().unwrap().port();
        let cross_port_task = tokio::spawn(async move {
            let (mut sock, _) = cross_port_listener.accept().await.unwrap();
            let mut buf = [0u8; 512];
            let _ = sock.read(&mut buf).await;
            let resp = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://localhost:{trap_port}/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            sock.write_all(resp.as_bytes()).await.unwrap();
        });
        let (cross_url, cross_client) = guarded_http_client(
            &format!("http://localhost:{cross_port_src}/v1/messages"),
            HostPolicy::User,
        )
        .await
        .unwrap();
        assert!(cross_client
            .post(cross_url)
            .header("x-api-key", "secret-anthropic-key")
            .header("x-custom-secret", "extra-header-secret")
            .send()
            .await
            .is_err());
        cross_port_task.await.unwrap();
        assert!(
            !trap_target_hit.load(Ordering::SeqCst),
            "Cross-origin redirect target must never receive a connection or headers"
        );

        // 3. Bracketed IPv6 literal validation + relative redirect
        assert_eq!(
            PolicyDnsResolver::resolve_and_validate_host("[::1]", HostPolicy::User).unwrap(),
            vec![SocketAddr::new(ip("::1"), 0)]
        );
        assert!(PolicyDnsResolver::resolve_and_validate_host("[::1]", HostPolicy::App).is_err());

        if let Ok(v6_listener) = TcpListener::bind("[::1]:0").await {
            let v6_port = v6_listener.local_addr().unwrap().port();
            let v6_task = tokio::spawn(async move {
                for step in 0..2 {
                    let (mut sock, _) = v6_listener.accept().await.unwrap();
                    let mut buf = [0u8; 512];
                    let _ = sock.read(&mut buf).await;
                    if step == 0 {
                        sock.write_all(
                            b"HTTP/1.1 302 Found\r\nLocation: /v2/v6-ok\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                    } else {
                        sock.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nv6-ok",
                        )
                        .await
                        .unwrap();
                    }
                }
            });
            let (v6_url, v6_client) = guarded_http_client(
                &format!("http://[::1]:{v6_port}/v1/start"),
                HostPolicy::User,
            )
            .await
            .unwrap();
            assert_eq!(
                v6_client
                    .get(v6_url)
                    .send()
                    .await
                    .unwrap()
                    .text()
                    .await
                    .unwrap(),
                "v6-ok"
            );
            v6_task.await.unwrap();
        }

        // 4. Redirect from allowed local server to blocked metadata IP must fail before connecting
        let ssrf_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ssrf_port = ssrf_listener.local_addr().unwrap().port();
        let ssrf_task = tokio::spawn(async move {
            let (mut sock, _) = ssrf_listener.accept().await.unwrap();
            let mut buf = [0u8; 512];
            let _ = sock.read(&mut buf).await;
            sock.write_all(
                b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        });
        let (ssrf_url, ssrf_client) = guarded_http_client(
            &format!("http://127.0.0.1:{ssrf_port}/start"),
            HostPolicy::User,
        )
        .await
        .unwrap();
        assert!(ssrf_client.get(ssrf_url).send().await.is_err());
        ssrf_task.await.unwrap();

        // 5. Environment HTTP_PROXY / ALL_PROXY must never bypass PolicyDnsResolver IP pinning
        let proxy_hit = Arc::new(AtomicBool::new(false));
        let proxy_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_port = proxy_listener.local_addr().unwrap().port();
        let proxy_flag = Arc::clone(&proxy_hit);
        let _proxy_task = tokio::spawn(async move {
            if proxy_listener.accept().await.is_ok() {
                proxy_flag.store(true, Ordering::SeqCst);
            }
        });

        let direct_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let direct_port = direct_listener.local_addr().unwrap().port();
        let direct_task = tokio::spawn(async move {
            let (mut sock, _) = direct_listener.accept().await.unwrap();
            let mut buf = [0u8; 512];
            let _ = sock.read(&mut buf).await;
            sock.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ndirect",
            )
            .await
            .unwrap();
        });

        let prev_http_proxy = std::env::var_os("HTTP_PROXY");
        let prev_all_proxy = std::env::var_os("ALL_PROXY");
        let prev_no_proxy = std::env::var_os("NO_PROXY");
        std::env::set_var("HTTP_PROXY", format!("http://127.0.0.1:{proxy_port}"));
        std::env::set_var("ALL_PROXY", format!("http://127.0.0.1:{proxy_port}"));
        std::env::remove_var("NO_PROXY");

        let pinned_domain_url = Url::parse(&format!(
            "http://pinned-direct.example.invalid:{direct_port}/check"
        ))
        .unwrap();
        let pinned_direct_addr = [SocketAddr::new(ip("127.0.0.1"), direct_port)];
        let direct_client_res = build_pinned_client_builder(
            &pinned_domain_url,
            HostPolicy::User,
            &pinned_direct_addr,
            true,
        )
        .build()
        .unwrap()
        .get(pinned_domain_url)
        .send()
        .await;

        match prev_http_proxy {
            Some(val) => std::env::set_var("HTTP_PROXY", val),
            None => std::env::remove_var("HTTP_PROXY"),
        }
        match prev_all_proxy {
            Some(val) => std::env::set_var("ALL_PROXY", val),
            None => std::env::remove_var("ALL_PROXY"),
        }
        match prev_no_proxy {
            Some(val) => std::env::set_var("NO_PROXY", val),
            None => std::env::remove_var("NO_PROXY"),
        }

        assert_eq!(direct_client_res.unwrap().text().await.unwrap(), "direct");
        direct_task.await.unwrap();
        assert!(
            !proxy_hit.load(Ordering::SeqCst),
            "Pinned client must ignore HTTP_PROXY/ALL_PROXY and connect directly"
        );
    }
}
