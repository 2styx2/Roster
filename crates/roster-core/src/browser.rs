//! Opening a Host's web service in the default browser (ticket 18, decision Q71). The frontend
//! checks the URL before it asks; this checks it again, because it's what hands it to the OS:
//! only http and https, with a host, nothing a shell or ShellExecute could read as anything else,
//! and never a user or password in it (a secret never travels in a URL).

/// The URL if it's one to hand the default browser, else why not.
pub fn checked_url(url: &str) -> Result<&str, String> {
    let refuse = |why: &str| Err(format!("won't open {url:?}: {why}"));
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return refuse("it has spaces or control characters in it");
    }
    let rest = if let Some(r) = url.strip_prefix("https://") {
        r
    } else if let Some(r) = url.strip_prefix("http://") {
        r
    } else {
        return refuse("only http and https URLs open in the browser");
    };
    // The authority ends at the first /, ? or #.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return refuse("it has a user or password in it");
    }
    let host = authority.rsplit_once(':').map_or(authority, |(h, port)| {
        // An IPv6 literal's colons are inside its brackets.
        if h.starts_with('[') && !h.ends_with(']') {
            authority
        } else if port.chars().all(|c| c.is_ascii_digit()) {
            h
        } else {
            authority
        }
    });
    if host.is_empty() || host == "[]" {
        return refuse("it has no host");
    }
    if url.starts_with('-') || url.contains('"') {
        return refuse("it has characters a URL never needs");
    }
    Ok(url)
}

/// Opens `url` in the default browser once it passes [`checked_url`].
pub fn open_url(url: &str) -> Result<(), String> {
    let url = checked_url(url)?;
    open(url).map_err(|e| format!("can't open the browser: {e}"))
}

#[cfg(windows)]
fn open(url: &str) -> std::io::Result<()> {
    // ShellExecute's "open" on a URL is the default browser; no shell parses it (unlike `start`).
    if crate::config::editor::win::shell_execute(std::path::Path::new(url), "open") {
        Ok(())
    } else {
        Err(std::io::Error::other("Windows has no browser for it"))
    }
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> std::io::Result<()> {
    spawn("open", url)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open(url: &str) -> std::io::Result<()> {
    spawn("xdg-open", url)
}

#[cfg(unix)]
fn spawn(program: &str, url: &str) -> std::io::Result<()> {
    let mut child = std::process::Command::new(program).arg(url).spawn()?;
    // Reap it when it exits (xdg-open hands off and ends at once).
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::checked_url;

    #[test]
    fn takes_http_and_https_urls() {
        for url in [
            "https://10.0.0.5",
            "http://10.0.0.5:8080/ui?x=1#top",
            "https://appliance.example:8443/",
            "https://[fe80::1]:8443/",
        ] {
            assert_eq!(checked_url(url), Ok(url), "{url}");
        }
    }

    #[test]
    fn refuses_anything_else() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ssh://10.0.0.5",
            "HTTPS//10.0.0.5",
            "https://",
            "https:///path",
            "https://10.0.0.5/a b",
            "https://10.0.0.5/\n",
            "",
            "-https://10.0.0.5",
            "https://10.0.0.5/\"&calc",
        ] {
            assert!(checked_url(url).is_err(), "{url:?} should be refused");
        }
    }

    #[test]
    fn never_opens_a_url_with_a_user_or_password() {
        for url in [
            "https://admin:hunter2@10.0.0.5",
            "https://admin@10.0.0.5/",
            "http://:x@10.0.0.5",
        ] {
            let err = checked_url(url).unwrap_err();
            assert!(err.contains("user or password"), "{err}");
        }
        // An @ after the host is part of the path, not a login.
        assert!(checked_url("https://10.0.0.5/users/@me").is_ok());
    }
}
