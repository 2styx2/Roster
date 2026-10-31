//! The `network` permission (decision Q97): `roster.http`, through the host the Tauri shell uses,
//! against a small HTTP server on 127.0.0.1 that each test lists explicitly
//! (`network:http://127.0.0.1:PORT`). Nothing here reaches the internet.

use roster_core::plugin::{Limits, Permission, PluginHost, Reply, Serve, Source, read_manifest};
use serde_json::{Value, json};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

struct NoServe;

impl Serve for NoServe {
    fn call(&self, method: &str, _params: Value) -> Result<Value, String> {
        Err(format!("unknown method {method}"))
    }
}

/// A proxy in the environment that would fail every request, with credentials in it: the client
/// must use neither.
fn no_proxy_env() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: set once, before any test of this binary starts a request.
        unsafe {
            for k in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                std::env::set_var(k, "http://someone:secret@127.0.0.1:9");
            }
        }
    });
}

/// A tiny HTTP/1.1 server: what each request's head was, and answers by path.
struct Server {
    port: u16,
    heads: Arc<Mutex<Vec<String>>>,
}

fn serve_one(mut stream: TcpStream, heads: &Mutex<Vec<String>>) {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(1) => head.push(byte[0]),
            _ => return,
        }
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    heads.lock().unwrap().push(head.clone());
    let path = head.split(' ').nth(1).unwrap_or("/").to_string();
    let reply = |status: &str, extra: &str, body: &[u8]| {
        let mut out = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    };
    let out = match path.as_str() {
        "/hello" => reply(
            "200 OK",
            "Content-Type: text/plain\r\nSet-Cookie: session=abc\r\nX-Two: a\r\nX-Two: b\r\n",
            b"hi there",
        ),
        "/echo" => reply("200 OK", "", head.as_bytes()),
        "/missing" => reply("404 Not Found", "", b"nope"),
        "/redirect-in" => reply("302 Found", "Location: /hello\r\n", b""),
        "/redirect-out" => reply("302 Found", "Location: https://elsewhere.example/steal\r\n", b""),
        "/redirect-loopback" => reply("302 Found", "Location: http://127.0.0.2/hello\r\n", b""),
        "/redirect-loop" => reply("302 Found", "Location: /redirect-loop\r\n", b""),
        "/big" => reply("200 OK", "", &vec![b'x'; 2 * 1024 * 1024]),
        "/big-unsized" => {
            // No Content-Length: the cap must hold while reading.
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
            let chunk = vec![b'y'; 64 * 1024];
            for _ in 0..40 {
                if stream.write_all(&chunk).is_err() {
                    return;
                }
            }
            return;
        }
        p if p.starts_with("/to/") => reply(
            "302 Found",
            &format!("Location: http://127.0.0.1:{}/echo\r\n", &p[4..]),
            b"",
        ),
        "/binary" => reply("200 OK", "", &[0, 159, 146, 150, 255]),
        "/slow" => {
            std::thread::sleep(Duration::from_secs(5));
            reply("200 OK", "", b"late")
        }
        _ => reply("404 Not Found", "", b""),
    };
    let _ = stream.write_all(&out);
}

impl Server {
    fn start() -> Server {
        no_proxy_env();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let heads = Arc::new(Mutex::new(Vec::new()));
        let h = Arc::clone(&heads);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let h = Arc::clone(&h);
                std::thread::spawn(move || serve_one(stream, &h));
            }
        });
        Server { port, heads }
    }

    fn site(&self) -> String {
        format!("network:http://127.0.0.1:{}", self.port)
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }
}

fn plugin_dir(test: &str, permissions: &[&str], init: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-network-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let list: Vec<String> = permissions.iter().map(|p| format!("{p:?}")).collect();
    std::fs::write(
        dir.join("roster-plugin.lua"),
        format!(
            "return {{ name = \"fetcher\", version = \"1.0.0\", api = 2, permissions = {{ {} }} }}",
            list.join(", ")
        ),
    )
    .unwrap();
    std::fs::write(dir.join("init.lua"), init).unwrap();
    dir
}

/// Loads a Plugin granted `permissions`, with `config` as `roster.plugin.config`; the replies
/// it sends on its own come out of the receiver.
fn load(test: &str, permissions: &[&str], config: Value, init: &str) -> (PluginHost, Reply, Receiver<Reply>) {
    let host = PluginHost::new(Arc::new(NoServe), Limits::default());
    let (tx, rx) = channel();
    let tx = Mutex::new(tx);
    host.set_listener(Arc::new(move |r: Reply| {
        let _ = tx.lock().unwrap().send(r);
    }));
    let grants: Vec<Permission> = permissions.iter().map(|p| Permission::parse(p).unwrap()).collect();
    let (_, reply) = host
        .load_with(&Source::Dir(plugin_dir(test, permissions, init)), &grants, &config)
        .unwrap();
    (host, reply, rx)
}

/// The notices in the replies that come within `secs`.
fn notices(rx: &Receiver<Reply>, want: usize, secs: u64) -> Vec<String> {
    let mut out = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(secs);
    while out.len() < want {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        let Ok(r) = rx.recv_timeout(left) else { break };
        assert!(r.error.is_none(), "the callback failed: {:?}", r.error);
        for op in r.ops {
            if op["op"] == "notify" {
                out.push(op["text"].as_str().unwrap().to_string());
            }
        }
    }
    out
}

/// init.lua that fetches `config.url` (with `config.req`'s other keys) and says what came back.
const FETCH: &str = r#"
local c = roster.plugin.config
local req = c.req or {}
req.url = c.url
roster.http.request(req, function(res, err)
  if res then
    local names = {}
    for k in pairs(res.headers) do names[#names + 1] = k end
    table.sort(names)
    roster.notify(res.status .. " " .. #res.body .. " " .. res.body:sub(1, 300) .. " | " .. table.concat(names, ","))
  else
    roster.notify("failed: " .. err)
  end
end)
"#;

fn fetch(test: &str, server: &Server, path: &str, req: Value) -> String {
    let (_host, reply, rx) = load(
        test,
        &[&server.site()],
        json!({ "url": server.url(path), "req": req }),
        FETCH,
    );
    assert!(reply.error.is_none(), "{:?}", reply.error);
    let got = notices(&rx, 1, 20);
    assert_eq!(got.len(), 1, "no answer for {path}");
    got[0].clone()
}

#[test]
fn without_a_network_grant_there_is_no_roster_http() {
    let server = Server::start();
    let init = "roster.notify(tostring(roster.http))";
    // Asked for but not granted: still nothing.
    let host = PluginHost::new(Arc::new(NoServe), Limits::default());
    let dir = plugin_dir("ungranted", &[&server.site()], init);
    let (_, reply) = host.load(&Source::Dir(dir), &[]).unwrap();
    assert_eq!(reply.ops[0]["text"], "nil");
    let (_, reply, _) = load("other-grant", &["inventory.read"], json!({}), init);
    assert_eq!(reply.ops[0]["text"], "nil");
    assert!(server.heads.lock().unwrap().is_empty());
}

#[test]
fn roster_has_answers_for_a_site_and_for_any_site() {
    let init = r#"
      for _, p in ipairs({ "network", "network:api.example.com", "network:other.example.com", "network:bad site" }) do
        roster.notify(p .. "=" .. tostring(roster.has(p)))
      end
    "#;
    let (_h, reply, _) = load("has", &["network:api.example.com"], json!({}), init);
    let texts: Vec<&str> = reply.ops.iter().map(|o| o["text"].as_str().unwrap()).collect();
    assert_eq!(
        texts,
        [
            "network=true",
            "network:api.example.com=true",
            "network:other.example.com=false",
            "network:bad site=false"
        ]
    );
    let (_h, reply, _) = load("has-none", &[], json!({}), init);
    assert_eq!(reply.ops[0]["text"], "network=false");
}

#[test]
fn a_bare_network_permission_names_no_site_and_doesnt_install() {
    let dir = plugin_dir("bare", &["network"], "");
    let e = read_manifest(&dir).unwrap_err();
    assert!(e.message.contains("network:api.example.com"), "{e}");
}

#[test]
fn a_granted_plugin_fetches_from_its_site_and_its_callback_reaches_the_app() {
    let server = Server::start();
    assert_eq!(
        fetch("hello", &server, "/hello", json!({})),
        "200 8 hi there | connection,content-length,content-type,set-cookie,x-two"
    );
    let echoed = fetch(
        "post",
        &server,
        "/echo",
        json!({ "method": "post", "body": "a=1", "headers": { "Authorization": "Bearer t0ken", "X-Mine": "yes" } }),
    );
    assert!(echoed.starts_with("200 "), "{echoed}");
    assert!(echoed.contains("POST /echo HTTP/1.1"), "{echoed}");
    assert!(echoed.contains("authorization: Bearer t0ken"), "{echoed}");
    assert!(echoed.contains("x-mine: yes"), "{echoed}");
    // A 404 is an answer, not a failure.
    assert!(fetch("missing", &server, "/missing", json!({})).starts_with("404 4 nope"));
}

#[test]
fn nothing_of_roster_goes_along() {
    let server = Server::start();
    // Twice: a cookie the first answer set isn't sent back.
    fetch("cookie1", &server, "/hello", json!({}));
    let echoed = fetch("cookie2", &server, "/echo", json!({}));
    let head = echoed.to_ascii_lowercase();
    for h in ["cookie:", "referer:", "proxy-authorization:", "authorization:"] {
        assert!(!head.contains(h), "{h} was sent: {echoed}");
    }
    // The proxy in the environment (port 9, with a password) wasn't used: the server saw them.
    assert_eq!(server.heads.lock().unwrap().len(), 2);
}

#[test]
fn an_answer_that_comes_while_init_lua_still_runs_isnt_lost() {
    let server = Server::start();
    let init = r#"
      roster.http.get(roster.plugin.config.url, function(res) roster.notify("got " .. res.status) end)
      local n = 0
      for i = 1, 20000000 do n = n + i end
    "#;
    let (_h, lr, rx) = load(
        "during-load",
        &[&server.site()],
        json!({ "url": server.url("/hello") }),
        init,
    );
    assert!(lr.error.is_none(), "{:?}", lr.error);
    assert_eq!(notices(&rx, 1, 20), ["got 200"]);
}

#[test]
fn a_binary_body_comes_back_as_its_bytes() {
    let server = Server::start();
    let init = r#"roster.http.get(roster.plugin.config.url, function(res)
      roster.notify(table.concat({ res.body:byte(1, -1) }, ","))
    end)"#;
    let (_h, lr, rx) = load(
        "binary",
        &[&server.site()],
        json!({ "url": server.url("/binary") }),
        init,
    );
    assert!(lr.error.is_none(), "{:?}", lr.error);
    assert_eq!(notices(&rx, 1, 20), ["0,159,146,150,255"]);
}

#[test]
fn a_site_it_wasnt_granted_is_refused_before_anything_is_sent() {
    let server = Server::start();
    let init = r#"
      local c = roster.plugin.config
      for _, url in ipairs(c.urls) do
        local ok, err = pcall(roster.http.get, url, function() end)
        roster.notify(ok and "sent" or err)
      end
    "#;
    let other = format!("http://127.0.0.1:{}/hello", server.port + 1);
    let urls = json!([
        format!("https://127.0.0.1:{}/hello", server.port),
        other,
        format!("http://localhost:{}/hello", server.port),
        "https://elsewhere.example/",
        format!("http://user:pw@127.0.0.1:{}/hello", server.port),
        "file:///etc/passwd",
        "not a url",
    ]);
    let (_h, reply, _) = load("refused", &[&server.site()], json!({ "urls": urls }), init);
    let texts: Vec<&str> = reply.ops.iter().map(|o| o["text"].as_str().unwrap()).collect();
    assert_eq!(texts.len(), 7);
    for t in &texts[..4] {
        assert!(t.contains("isn't a site this Plugin may reach"), "{t}");
    }
    assert!(texts[4].contains("user or password"), "{}", texts[4]);
    assert!(texts[5].contains("isn't a site"), "{}", texts[5]);
    assert!(texts[6].contains("isn't a URL"), "{}", texts[6]);
    assert!(server.heads.lock().unwrap().is_empty());
}

#[test]
fn headers_that_steer_the_connection_are_refused() {
    let server = Server::start();
    let init = r#"
      for _, h in ipairs({ "Host", "Proxy-Authorization", "Transfer-Encoding", "Content-Length", "Connection" }) do
        local ok, err = pcall(roster.http.request, { url = roster.plugin.config.url, headers = { [h] = "x" } }, function() end)
        roster.notify(ok and "sent" or err)
      end
      local ok, err = pcall(roster.http.request, { url = roster.plugin.config.url, headers = { ["X-Bad"] = "a\r\nInjected: 1" } }, function() end)
      roster.notify(ok and "sent" or err)
      ok, err = pcall(roster.http.request, { url = roster.plugin.config.url, method = "CONNECT" }, function() end)
      roster.notify(ok and "sent" or err)
      ok, err = pcall(roster.http.request, { url = roster.plugin.config.url, cookies = true }, function() end)
      roster.notify(ok and "sent" or err)
    "#;
    let (_h, reply, _) = load(
        "headers",
        &[&server.site()],
        json!({ "url": server.url("/hello") }),
        init,
    );
    let texts: Vec<&str> = reply.ops.iter().map(|o| o["text"].as_str().unwrap()).collect();
    for t in &texts[..5] {
        assert!(t.contains("header is roster's to set"), "{t}");
    }
    assert!(texts[5].contains("isn't one HTTP can carry"), "{}", texts[5]);
    assert!(texts[6].contains("isn't a method"), "{}", texts[6]);
    assert!(texts[7].contains("isn't a key of a request"), "{}", texts[7]);
    assert!(server.heads.lock().unwrap().is_empty());
}

#[test]
fn redirects_are_followed_only_to_its_sites() {
    let server = Server::start();
    assert!(fetch("redir-in", &server, "/redirect-in", json!({})).starts_with("200 8 hi there"));
    let out = fetch("redir-out", &server, "/redirect-out", json!({}));
    assert!(
        out.starts_with("failed: ") && out.contains("redirected to https://elsewhere.example"),
        "{out}"
    );
    let lo = fetch("redir-lo", &server, "/redirect-loopback", json!({}));
    assert!(lo.contains("redirected to http://127.0.0.2"), "{lo}");
    let looped = fetch("redir-loop", &server, "/redirect-loop", json!({}));
    assert!(looped.contains("more than 5 redirects"), "{looped}");
}

#[test]
fn a_token_isnt_carried_to_another_site_by_a_redirect() {
    let (a, b) = (Server::start(), Server::start());
    let (_h, _, rx) = load(
        "redir-token",
        &[&a.site(), &b.site()],
        json!({ "url": a.url(&format!("/to/{}", b.port)), "req": { "headers": { "Authorization": "Bearer t0ken" } } }),
        FETCH,
    );
    let got = notices(&rx, 1, 20);
    assert!(got[0].starts_with("200 ") && got[0].contains("GET /echo"), "{got:?}");
    assert!(!got[0].to_ascii_lowercase().contains("authorization"), "{got:?}");
    assert!(a.heads.lock().unwrap()[0].contains("authorization: Bearer t0ken"));
}

#[test]
fn a_response_over_the_cap_fails() {
    let server = Server::start();
    let big = fetch("big", &server, "/big", json!({}));
    assert!(big.contains("failed: the response is over 1048576 bytes"), "{big}");
    let unsized_ = fetch("big-unsized", &server, "/big-unsized", json!({}));
    assert!(
        unsized_.contains("failed: the response is over 1048576 bytes"),
        "{unsized_}"
    );
}

#[test]
fn a_slow_answer_times_out() {
    let server = Server::start();
    let started = std::time::Instant::now();
    let slow = fetch("slow", &server, "/slow", json!({ "timeout": 0.5 }));
    assert_eq!(slow, "failed: no answer within 0.5 s");
    assert!(started.elapsed() < Duration::from_secs(4));
}

#[test]
fn the_plugin_isnt_blocked_while_a_request_runs() {
    let server = Server::start();
    let init = r#"
      roster.http.get(roster.plugin.config.url, function(res, err) roster.notify("answered") end)
      roster.commands.add("ping", { run = function() roster.notify("pong") end })
    "#;
    let (host, reply, _) = load(
        "unblocked",
        &[&server.site()],
        json!({ "url": server.url("/slow") }),
        init,
    );
    let handler = reply.ops[0]["run"]["handler"].as_u64().unwrap();
    let started = std::time::Instant::now();
    let r = host.call("fetcher", handler, json!({}));
    assert_eq!(r.ops[0]["text"], "pong");
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn at_most_four_requests_go_at_once() {
    let server = Server::start();
    let init = r#"
      for i = 1, 5 do
        local ok, err = pcall(roster.http.get, roster.plugin.config.url, function() end)
        roster.notify(ok and "sent" or err)
      end
    "#;
    let (_h, reply, _) = load(
        "in-flight",
        &[&server.site()],
        json!({ "url": server.url("/slow") }),
        init,
    );
    let texts: Vec<&str> = reply.ops.iter().map(|o| o["text"].as_str().unwrap()).collect();
    assert_eq!(&texts[..4], ["sent"; 4]);
    assert!(texts[4].contains("4 requests are going already"), "{}", texts[4]);
}

#[test]
fn an_answer_for_a_plugin_that_was_unloaded_goes_nowhere() {
    let server = Server::start();
    let init = r#"roster.http.get(roster.plugin.config.url, function() roster.notify("late") end)"#;
    let (host, _, rx) = load(
        "unloaded",
        &[&server.site()],
        json!({ "url": server.url("/slow") }),
        init,
    );
    assert!(host.unload("fetcher"));
    assert!(rx.recv_timeout(Duration::from_secs(7)).is_err());
}

#[test]
fn an_error_in_the_callback_names_the_plugin_and_counts() {
    let server = Server::start();
    let init = r#"roster.http.get(roster.plugin.config.url, function() error("boom") end)"#;
    let (_h, _, rx) = load(
        "callback-error",
        &[&server.site()],
        json!({ "url": server.url("/hello") }),
        init,
    );
    let r = rx.recv_timeout(Duration::from_secs(20)).unwrap();
    let e = r.error.unwrap();
    assert_eq!(e.plugin, "fetcher");
    assert!(e.message.contains("boom"), "{}", e.message);
}

#[test]
fn the_install_prompt_shows_each_site_flagged() {
    let dir = plugin_dir(
        "prompt",
        &[
            "network:api.example.com",
            "network:http://10.0.0.5:8080",
            "network:*.example.org",
        ],
        "",
    );
    let m = read_manifest(&dir).unwrap();
    let v = serde_json::to_value(&m).unwrap();
    let ps = v["permissions"].as_array().unwrap();
    assert_eq!(ps[0]["name"], "network:api.example.com");
    assert!(
        ps[0]["risk"]
            .as_str()
            .unwrap()
            .contains("Can send data to api.example.com")
    );
    let plain = ps[1]["risk"].as_str().unwrap();
    assert!(
        plain.contains("Plain http") && plain.contains("private network"),
        "{plain}"
    );
    assert!(ps[2]["risk"].as_str().unwrap().contains("any site under example.org"));
    assert!(
        ps[2]["summary"]
            .as_str()
            .unwrap()
            .contains("any site under example.org")
    );
}

#[test]
fn nothing_listening_is_said_plainly() {
    no_proxy_env();
    let (_h, _, rx) = load(
        "refused-port",
        &["network:http://127.0.0.1:1"],
        json!({ "url": "http://127.0.0.1:1/x" }),
        FETCH,
    );
    let got = notices(&rx, 1, 20);
    assert!(
        got[0].starts_with("failed: couldn't connect to http://127.0.0.1:1: "),
        "{got:?}"
    );
}

/// Ticket 74 (decision Q92): `done` runs with a call's budget under the same global hook, so a
/// loop in it, inside a coroutine too, is stopped; and the `cmd:`/`env:` redaction is only for
/// roster serve's answers, never a web service's (`/echo`'s body has `auth: cmd:` text in it).
#[test]
fn a_done_callback_that_loops_in_a_coroutine_is_stopped_and_http_isnt_redacted() {
    let server = Server::start();
    let init = r#"
roster.http.request({ url = roster.plugin.config.url, headers = { auth = "cmd:pass show x" } }, function(res)
  roster.notify(tostring(res.body:find("cmd:pass show x", 1, true) ~= nil))
end)
roster.http.request({ url = roster.plugin.config.url }, function()
  coroutine.wrap(function() while true do end end)()
end)
"#;
    let (_host, reply, rx) = load("loop", &[&server.site()], json!({ "url": server.url("/echo") }), init);
    assert!(reply.error.is_none(), "{:?}", reply.error);
    let mut seen_true = false;
    let mut seen_loop = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    while !(seen_true && seen_loop) {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        let Ok(r) = rx.recv_timeout(left) else { break };
        if let Some(e) = &r.error {
            assert!(e.to_string().contains("an endless loop?"), "{e}");
            seen_loop = true;
        }
        if r.ops.iter().any(|o| o["op"] == "notify" && o["text"] == "true") {
            seen_true = true;
        }
    }
    assert!(seen_true, "the echoed header wasn't there whole");
    assert!(seen_loop, "the looping callback wasn't stopped");
}
