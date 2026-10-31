//! The `network` permission (decision Q97): an HTTP client in roster-core that a Plugin reaches
//! only through `roster.http`, and only for the sites its manifest lists and the user granted
//! (`network:api.example.com`). The frontend never sees it: a request's answer comes back to the
//! Plugin's own Lua, and only the UI changes its callback makes reach the app.
//!
//! The rules, each enforced here and tested in `tests/network.rs`:
//!
//! - **Sites are matched exactly.** `api.example.com` is that name on port 443 over https and
//!   nothing else; `*.example.com` is any name under `example.com` (not `example.com` itself);
//!   `http://` before a site allows plain http to it (and only http); `:PORT` after it allows that
//!   port instead of the scheme's own. An IP address is a site of its own, never matched by a name.
//! - **Redirects** are followed (at most 5) only to a site the Plugin may reach, by the same rule.
//! - **Nothing private by name.** Every name is resolved here, and if any address it gives is on
//!   this computer or a private, link-local or otherwise non-public network, the request fails.
//!   The connection then goes to exactly the addresses that were checked, so a name can't be
//!   re-pointed between the check and the connection (DNS rebinding). Such an address is reached
//!   only when the manifest lists the address itself (`network:http://10.0.0.5:8080`).
//! - **Nothing of roster's goes along**: no cookie jar, no proxy (so no proxy credentials), no
//!   `Referer`, no retries, no credentials; only the headers the Plugin sets, minus the ones
//!   that steer the connection.
//! - **Caps:** a request body of 256 KB, a response body of 1 MB, 10 s to connect, 30 s in all,
//!   and 4 requests in flight per Plugin.
//! - **Async:** the request runs on the core's own network threads; the Plugin's function is
//!   called with the answer later, as a call of its own with a call's budget.

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::{Client, Method, Url, redirect};
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

/// The most a request's body may be.
pub const MAX_REQUEST_BODY: usize = 256 * 1024;
/// The most a response's body may be; a longer one fails the request.
pub const MAX_RESPONSE_BODY: usize = 1024 * 1024;
/// The longest a request may take in all, and the default.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(30);
/// The longest to wait for a connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How many requests one Plugin may have in flight.
pub const MAX_IN_FLIGHT: usize = 4;
/// How many redirects a request follows.
pub const MAX_REDIRECTS: usize = 5;
/// The most headers a request may set.
pub const MAX_HEADERS: usize = 50;
/// Headers a Plugin may not set: they steer the connection, not the request.
pub const FORBIDDEN_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "expect",
    "proxy-authorization",
    "proxy-authenticate",
    "proxy-connection",
];
/// The methods a request may use.
pub const METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

/// One site a Plugin may reach, as `network:SITE` names it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Site {
    /// Plain http (`http://` before it); else https only.
    pub http: bool,
    pub host: SiteHost,
    /// The one port; `None`: the scheme's own (443, or 80 for http).
    pub port: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SiteHost {
    /// `api.example.com`: that name exactly.
    Name(String),
    /// `*.example.com` (kept as `example.com`): any name that ends in `.example.com`.
    Under(String),
    /// `10.0.0.5`, `[fd00::5]`: that address exactly.
    Ip(IpAddr),
}

fn is_label(l: &str) -> bool {
    !l.is_empty()
        && l.len() <= 63
        && !l.starts_with('-')
        && !l.ends_with('-')
        && l.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A domain name as a site writes it: lower case ASCII labels (punycode for others), at least two.
fn is_domain(s: &str) -> bool {
    let labels: Vec<&str> = s.split('.').collect();
    s.len() <= 253
        && labels.len() >= 2
        && labels.iter().all(|l| is_label(l))
        // The last label is a top-level domain, never all digits (that'd be an address).
        && !labels[labels.len() - 1].chars().all(|c| c.is_ascii_digit())
}

const SITE_HELP: &str = "a site is a domain such as api.example.com, *.example.com for the names under it, or an address such as 10.0.0.5; http:// before it allows plain http, :PORT after it another port";

impl Site {
    /// `api.example.com`, `*.example.com`, `http://10.0.0.5:8080`, `[fd00::5]:8443`.
    pub fn parse(text: &str) -> Result<Site, String> {
        let bad = |why: &str| Err(format!("\"network:{text}\": {why} ({SITE_HELP})"));
        let (http, rest) = match text.strip_prefix("http://") {
            Some(rest) => (true, rest),
            None if text.contains("://") => return bad("only http:// may come before a site; https is the default"),
            None => (false, text),
        };
        if rest.is_empty() {
            return bad("which site?");
        }
        if rest.chars().any(|c| c.is_ascii_uppercase()) {
            return bad("write it in lower case");
        }
        if rest.contains(['/', '?', '#', '@', ' ']) {
            return bad("only a site, with no path, user or spaces");
        }
        // The host, then an optional port.
        let (host, port) = if let Some(after) = rest.strip_prefix('[') {
            let Some((addr, tail)) = after.split_once(']') else {
                return bad("an IPv6 address goes in [ ]");
            };
            let port = match tail {
                "" => None,
                t => match t.strip_prefix(':') {
                    Some(p) => Some(p),
                    None => return bad("only :PORT may follow ]"),
                },
            };
            let Ok(ip) = addr.parse::<Ipv6Addr>() else {
                return bad("that isn't an IPv6 address");
            };
            if ip.to_string() != addr {
                return bad(&format!("write the address as [{ip}]"));
            }
            (SiteHost::Ip(IpAddr::V6(ip)), port)
        } else {
            let (host, port) = match rest.split_once(':') {
                Some((h, p)) => (h, Some(p)),
                None => (rest, None),
            };
            let host = if let Ok(ip) = host.parse::<Ipv4Addr>() {
                if ip.to_string() != host {
                    return bad(&format!("write the address as {ip}"));
                }
                SiteHost::Ip(IpAddr::V4(ip))
            } else if let Some(under) = host.strip_prefix("*.") {
                if !is_domain(under) {
                    return bad("*. goes before a domain of two names or more, such as *.example.com");
                }
                SiteHost::Under(under.to_string())
            } else if host.contains('*') {
                return bad("a wildcard is only *. at the start");
            } else if is_domain(host) {
                SiteHost::Name(host.to_string())
            } else if host.chars().all(|c| c.is_ascii_digit() || c == '.') {
                return bad("that isn't an IPv4 address");
            } else {
                return bad("that isn't a domain with a dot in it, such as api.example.com");
            };
            (host, port)
        };
        let port = match port {
            None => None,
            Some(p) => match p.parse::<u16>() {
                Ok(n) if n > 0 && n.to_string() == p => Some(n),
                _ => return bad("the port is a number from 1 to 65535"),
            },
        };
        Ok(Site { http, host, port })
    }

    /// Whether `url` is on this site: its scheme, host and port.
    pub fn allows(&self, url: &Url) -> bool {
        let scheme = if self.http { "http" } else { "https" };
        if url.scheme() != scheme {
            return false;
        }
        if url.port_or_known_default() != Some(self.port.unwrap_or(if self.http { 80 } else { 443 })) {
            return false;
        }
        match (&self.host, url.host()) {
            (SiteHost::Name(name), Some(url::Host::Domain(d))) => d == name,
            (SiteHost::Under(under), Some(url::Host::Domain(d))) => d
                .strip_suffix(under.as_str())
                .is_some_and(|head| head.len() > 1 && head.ends_with('.')),
            (SiteHost::Ip(IpAddr::V4(ip)), Some(url::Host::Ipv4(a))) => *ip == a,
            (SiteHost::Ip(IpAddr::V6(ip)), Some(url::Host::Ipv6(a))) => *ip == a,
            _ => false,
        }
    }

    /// Why the install prompt flags it.
    pub fn risk(&self) -> String {
        let mut text = format!(
            "Can send data to {} and fetch from it: anything the Plugin can read (your Hosts, what your Sessions print) could leave this computer.",
            self.shown()
        );
        if self.http {
            text.push_str(" Plain http: anyone on the way can read and change it.");
        }
        if let SiteHost::Ip(ip) = &self.host
            && !is_public(*ip)
        {
            text.push_str(" That address is on this computer or a private network.");
        }
        text
    }

    /// The site as a person reads it: `api.example.com`, `any name under example.com`.
    pub fn shown(&self) -> String {
        match &self.host {
            SiteHost::Under(under) => format!(
                "any site under {under}{}{}",
                if self.http { " over plain http" } else { "" },
                self.port.map(|p| format!(" on port {p}")).unwrap_or_default()
            ),
            _ => self.to_string(),
        }
    }
}

impl fmt::Display for Site {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.http {
            f.write_str("http://")?;
        }
        match &self.host {
            SiteHost::Name(n) => f.write_str(n)?,
            SiteHost::Under(u) => write!(f, "*.{u}")?,
            SiteHost::Ip(IpAddr::V4(ip)) => write!(f, "{ip}")?,
            SiteHost::Ip(IpAddr::V6(ip)) => write!(f, "[{ip}]")?,
        }
        if let Some(p) = self.port {
            write!(f, ":{p}")?;
        }
        Ok(())
    }
}

/// Whether `ip` is a public internet address: not this computer, a private or link-local
/// network, shared address space (CGNAT), multicast, documentation or reserved ranges, and not
/// an IPv6 address that carries one of those (mapped, compatible, 6to4, NAT64).
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let s = v6.segments();
            let embedded = |hi: u16, lo: u16| Ipv4Addr::from(((hi as u32) << 16) | lo as u32);
            // ::a.b.c.d (IPv4-compatible, deprecated) and 64:ff9b::/96 (NAT64) carry an IPv4 address.
            if s[..6] == [0; 6] && !(s[6] == 0 && s[7] <= 1) {
                return is_public_v4(embedded(s[6], s[7]));
            }
            if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
                return is_public_v4(embedded(s[6], s[7]));
            }
            // 2002::/16 (6to4) carries one in its next 32 bits.
            if s[0] == 0x2002 {
                return is_public_v4(embedded(s[1], s[2]));
            }
            // Only global unicast (2000::/3), minus documentation (2001:db8::/32) and the IETF
            // protocol assignments (2001::/23: Teredo, benchmarking, ORCHID).
            (s[0] & 0xe000) == 0x2000 && !(s[0] == 0x2001 && s[1] == 0x0db8) && !(s[0] == 0x2001 && s[1] < 0x0200)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0                                    // "this network"
        || a == 10                              // private
        || a == 127                             // loopback
        || (a == 100 && (64..128).contains(&b)) // shared (CGNAT)
        || (a == 169 && b == 254)               // link-local
        || (a == 172 && (16..32).contains(&b))  // private
        || (a == 192 && b == 0 && c == 0)       // IETF protocol assignments
        || (a == 192 && b == 0 && c == 2)       // documentation
        || (a == 192 && b == 88 && c == 99)     // 6to4 relay
        || (a == 192 && b == 168)               // private
        || (a == 198 && (18..20).contains(&b))  // benchmarking
        || (a == 198 && b == 51 && c == 100)    // documentation
        || (a == 203 && b == 0 && c == 113)     // documentation
        || a >= 224) // multicast, reserved, broadcast
}

/// Whether any of `sites` allows `url`.
pub fn allowed(sites: &[Site], url: &Url) -> bool {
    sites.iter().any(|s| s.allows(url))
}

/// Resolves a name and refuses it if any address it gives isn't public; the connection then
/// goes only to the addresses checked here (no second lookup to re-point).
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| format!("couldn't look up {host}: {e}"))?
                .collect();
            if addrs.is_empty() {
                return Err(format!("{host} has no address").into());
            }
            if let Some(a) = addrs.iter().find(|a| !is_public(a.ip())) {
                return Err(format!(
                    "{host} is at {}, an address on this computer or a private network: a Plugin reaches one only when its manifest lists the address itself",
                    a.ip()
                )
                .into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// The core's network threads, shared by every Plugin, started the first time one needs them.
fn runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    static RUNTIME: OnceLock<Result<tokio::runtime::Runtime, String>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .thread_name("plugin-network")
                .enable_all()
                .build()
                .map_err(|e| format!("couldn't start the network threads: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// A request a Plugin asked for, checked.
#[derive(Debug)]
pub struct Request {
    pub method: Method,
    pub url: Url,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
}

/// How a request ended: an answer (any status), or why there was none.
#[derive(Debug, Clone)]
pub enum Answer {
    Response {
        status: u16,
        /// Where it ended, after redirects.
        url: String,
        /// Lower-case names; a repeated header's values joined with ", ".
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    },
    Failed(String),
}

/// One Plugin's client: its sites, its connections (never shared with another Plugin), and its
/// requests in flight.
pub struct Net {
    sites: Arc<Vec<Site>>,
    client: Client,
    in_flight: Arc<AtomicUsize>,
    tasks: std::cell::RefCell<Vec<tokio::task::AbortHandle>>,
}

impl Net {
    pub fn new(sites: Vec<Site>) -> Result<Net, String> {
        // rustls with ring; the platform's trust store checks certificates.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let sites = Arc::new(sites);
        let for_redirects = Arc::clone(&sites);
        let client = Client::builder()
            .no_proxy()
            .referer(false)
            .retry(reqwest::retry::never())
            .redirect(redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() > MAX_REDIRECTS {
                    attempt.error(format!("more than {MAX_REDIRECTS} redirects"))
                } else if allowed(&for_redirects, attempt.url()) {
                    attempt.follow()
                } else {
                    let to = attempt.url().origin().ascii_serialization();
                    attempt.error(format!("redirected to {to}, which the Plugin may not reach"))
                }
            }))
            .dns_resolver(PublicOnly)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(Duration::from_secs(30))
            .user_agent(concat!("roster/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| format!("couldn't start the HTTP client: {}", chain(&e)))?;
        Ok(Net {
            sites,
            client,
            in_flight: Arc::new(AtomicUsize::new(0)),
            tasks: std::cell::RefCell::default(),
        })
    }

    pub fn sites(&self) -> &[Site] {
        &self.sites
    }

    /// Checks what a Plugin asked for: the URL against its sites, the method, the headers.
    pub fn check(
        &self,
        method: &str,
        url: &str,
        headers: Vec<(String, String)>,
        body: Option<Vec<u8>>,
        timeout: Option<f64>,
    ) -> Result<Request, String> {
        let parsed = Url::parse(url).map_err(|e| format!("{url:?} isn't a URL: {e}"))?;
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("a URL with a user or password in it isn't sent: put a token in a header".into());
        }
        if !allowed(&self.sites, &parsed) {
            let may: Vec<String> = self.sites.iter().map(Site::to_string).collect();
            return Err(format!(
                "{} isn't a site this Plugin may reach (it may reach {})",
                parsed.origin().ascii_serialization(),
                may.join(", ")
            ));
        }
        let upper = method.to_ascii_uppercase();
        if !METHODS.contains(&upper.as_str()) {
            return Err(format!("{method:?} isn't a method (there's {})", METHODS.join(", ")));
        }
        if headers.len() > MAX_HEADERS {
            return Err(format!("more than {MAX_HEADERS} headers"));
        }
        let mut checked = Vec::with_capacity(headers.len());
        for (name, value) in headers {
            let lower = name.to_ascii_lowercase();
            if FORBIDDEN_HEADERS.contains(&lower.as_str()) || lower.starts_with("proxy-") {
                return Err(format!("the {name} header is roster's to set"));
            }
            if reqwest::header::HeaderName::from_bytes(lower.as_bytes()).is_err()
                || reqwest::header::HeaderValue::from_str(&value).is_err()
            {
                return Err(format!("the {name:?} header isn't one HTTP can carry"));
            }
            checked.push((lower, value));
        }
        if let Some(b) = &body
            && b.len() > MAX_REQUEST_BODY
        {
            return Err(format!("the body is over {MAX_REQUEST_BODY} bytes"));
        }
        let timeout = match timeout {
            None => MAX_TIMEOUT,
            Some(t) if t.is_finite() && t > 0.0 => Duration::from_secs_f64(t).min(MAX_TIMEOUT),
            Some(_) => return Err("the timeout is a number of seconds above 0".into()),
        };
        Ok(Request {
            method: Method::from_bytes(upper.as_bytes()).map_err(|e| e.to_string())?,
            url: parsed,
            headers: checked,
            body,
            timeout,
        })
    }

    /// Starts `request`; `done` gets the answer on a network thread. Refused when the Plugin has
    /// [`MAX_IN_FLIGHT`] requests going already.
    pub fn start(&self, request: Request, done: impl FnOnce(Answer) + Send + 'static) -> Result<(), String> {
        let rt = runtime()?;
        let n = self.in_flight.fetch_add(1, Ordering::SeqCst);
        if n >= MAX_IN_FLIGHT {
            self.in_flight.fetch_sub(1, Ordering::SeqCst);
            return Err(format!(
                "{MAX_IN_FLIGHT} requests are going already: wait for one to answer"
            ));
        }
        let in_flight = Arc::clone(&self.in_flight);
        let client = self.client.clone();
        let task = rt.spawn(async move {
            let answer = fetch(&client, request).await;
            in_flight.fetch_sub(1, Ordering::SeqCst);
            // Delivering waits for the Plugin's thread: not on a network thread.
            let _ = tokio::task::spawn_blocking(move || done(answer)).await;
        });
        let mut tasks = self.tasks.borrow_mut();
        tasks.retain(|t| !t.is_finished());
        tasks.push(task.abort_handle());
        Ok(())
    }
}

impl Drop for Net {
    /// The Plugin is gone (unloaded, reloaded, disabled): its requests stop with it.
    fn drop(&mut self) {
        for t in self.tasks.borrow().iter() {
            t.abort();
        }
    }
}

async fn fetch(client: &Client, request: Request) -> Answer {
    let timeout = request.timeout;
    let mut builder = client.request(request.method, request.url).timeout(timeout);
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let mut response = match builder.send().await {
        Ok(r) => r,
        Err(e) => return Answer::Failed(describe(&e, timeout)),
    };
    let status = response.status().as_u16();
    let url = response.url().to_string();
    let mut headers: Vec<(String, String)> = Vec::new();
    for (name, value) in response.headers() {
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        match headers.iter_mut().find(|(n, _)| n == name.as_str()) {
            Some((_, v)) => {
                v.push_str(", ");
                v.push_str(&value);
            }
            None => headers.push((name.as_str().to_string(), value)),
        }
    }
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE_BODY as u64) {
        return Answer::Failed(format!("the response is over {MAX_RESPONSE_BODY} bytes"));
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > MAX_RESPONSE_BODY {
                    return Answer::Failed(format!("the response is over {MAX_RESPONSE_BODY} bytes"));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return Answer::Failed(describe(&e, timeout)),
        }
    }
    Answer::Response {
        status,
        url,
        headers,
        body,
    }
}

/// A failure as one line: what failed, then its first cause (`couldn't connect to
/// http://127.0.0.1:1: tcp connect error: Connection refused (os error 111)`).
fn describe(e: &reqwest::Error, timeout: Duration) -> String {
    if e.is_timeout() {
        return format!("no answer within {} s", timeout.as_secs_f64());
    }
    let origin = e.url().map(|u| u.origin().ascii_serialization()).unwrap_or_default();
    // reqwest's own text repeats the URL; the causes say what happened.
    let mut causes = Vec::new();
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        let text = s.to_string();
        if !causes.iter().any(|c: &String| c.contains(&text)) && text != "client error (Connect)" {
            causes.push(text);
        }
        source = s.source();
    }
    let why = if causes.is_empty() {
        e.to_string()
    } else {
        causes.join(": ")
    };
    if e.is_redirect() {
        why
    } else if e.is_connect() {
        format!("couldn't connect to {origin}: {why}")
    } else if e.is_body() || e.is_decode() {
        format!("the answer from {origin} broke off: {why}")
    } else {
        format!("{origin}: {why}")
    }
}

fn chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut source = e.source();
    while let Some(s) = source {
        let text = s.to_string();
        if !parts.iter().any(|p| p.contains(&text)) {
            parts.push(text);
        }
        source = s.source();
    }
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn a_site_is_matched_exactly() {
        let site = Site::parse("api.example.com").unwrap();
        assert!(site.allows(&url("https://api.example.com/v1?x=1")));
        assert!(site.allows(&url("https://API.Example.com:443/")));
        for no in [
            "http://api.example.com/",
            "https://api.example.com:8443/",
            "https://example.com/",
            "https://x.api.example.com/",
            "https://api.example.com.evil.example/",
            "https://evil-api.example.com/",
            "https://api.example.com./",
        ] {
            assert!(!site.allows(&url(no)), "{no} must not be allowed");
        }
    }

    #[test]
    fn a_wildcard_is_the_names_under_a_domain_and_not_the_domain() {
        let site = Site::parse("*.example.com").unwrap();
        assert!(site.allows(&url("https://a.example.com/")));
        assert!(site.allows(&url("https://a.b.example.com/")));
        assert!(!site.allows(&url("https://example.com/")));
        assert!(!site.allows(&url("https://badexample.com/")));
        assert!(!site.allows(&url("https://a.example.com.evil.example/")));
    }

    #[test]
    fn http_and_a_port_are_allowed_only_when_written() {
        let site = Site::parse("http://127.0.0.1:8080").unwrap();
        assert!(site.allows(&url("http://127.0.0.1:8080/x")));
        assert!(!site.allows(&url("https://127.0.0.1:8080/x")));
        assert!(!site.allows(&url("http://127.0.0.1/x")));
        assert!(!site.allows(&url("http://localhost:8080/x")));
        // The URL parser writes other spellings of an address the one way.
        assert!(site.allows(&url("http://2130706433:8080/")));
        assert!(
            Site::parse("[fd00::5]:8443")
                .unwrap()
                .allows(&url("https://[fd00:0::5]:8443/"))
        );
    }

    #[test]
    fn a_name_never_matches_an_address() {
        let site = Site::parse("api.example.com").unwrap();
        assert!(!site.allows(&url("https://45.10.20.30/")));
    }

    #[test]
    fn sites_print_as_they_were_written() {
        for s in [
            "api.example.com",
            "*.example.com",
            "http://10.0.0.5:8080",
            "[fd00::5]",
            "xn--bcher-kva.example",
        ] {
            assert_eq!(Site::parse(s).unwrap().to_string(), s);
        }
    }

    /// DNS rebinding and names that point inside: `localhost` is in every hosts file, so no
    /// network is needed. The connection only ever gets the addresses this returns.
    #[test]
    fn a_name_that_resolves_to_this_computer_is_refused() {
        use std::str::FromStr;
        let rt = runtime().unwrap();
        let err = match rt.block_on(PublicOnly.resolve(Name::from_str("localhost").unwrap())) {
            Ok(addrs) => panic!("localhost resolved to {:?}", addrs.collect::<Vec<_>>()),
            Err(e) => e.to_string(),
        };
        assert!(
            err.contains("localhost is at") && err.contains("private network"),
            "{err}"
        );
    }

    #[test]
    fn private_and_special_addresses_are_not_public() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "192.0.2.1",
            "::1",
            "::",
            "fe80::1",
            "fd00::1",
            "fc00::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::127.0.0.1",
            "64:ff9b::a00:1",
            "2002:7f00:1::",
            "2001:db8::1",
            "fec0::1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} must not count as public");
        }
        for ip in [
            "45.10.20.30",
            "172.32.0.1",
            "2a05:1234::1",
            "::ffff:45.10.20.30",
            "2002:2d0a:141e::",
        ] {
            assert!(is_public(ip.parse().unwrap()), "{ip} is public");
        }
    }
}
