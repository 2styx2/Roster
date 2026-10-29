//! The command a Session runs: `session.prepare`'s argv and env, made runnable on the Backend's
//! target. On WSL the env has to travel inside the argv (`env K=V`), because Windows-side
//! variables don't cross into WSL (docs/dev/tauri-pty-wsl.md).

use desk_core::detect::Target;
use desk_core::session::{Prepared, session_command};
use serde_json::json;

fn prepared(env: serde_json::Value) -> Prepared {
    serde_json::from_value(json!({
        "argv": ["/usr/bin/ssh", "-o", "BatchMode=yes", "web-1"],
        "env": env,
        "host": "web-1",
        "auth": "key",
    }))
    .unwrap()
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn on_wsl_runs_ssh_through_wsl_exec_with_env_in_the_argv() {
    let cmd = session_command(
        &Target::Wsl {
            distro: "FedoraLinux-44".into(),
        },
        &prepared(json!({"SSH_ASKPASS": "/run/askpass", "SSH_ASKPASS_REQUIRE": "force"})),
    );
    assert_eq!(
        cmd.argv,
        strings(&[
            "wsl.exe",
            "-d",
            "FedoraLinux-44",
            "--cd",
            "~",
            "--exec",
            "env",
            "TERM=xterm-256color",
            "SSH_ASKPASS=/run/askpass",
            "SSH_ASKPASS_REQUIRE=force",
            "/usr/bin/ssh",
            "-o",
            "BatchMode=yes",
            "web-1",
        ])
    );
    assert!(cmd.env.is_empty());
}

#[test]
fn locally_runs_ssh_as_given_with_env_set_on_the_process() {
    let cmd = session_command(&Target::Local, &prepared(json!({"SSH_ASKPASS_REQUIRE": "force"})));
    assert_eq!(cmd.argv, strings(&["/usr/bin/ssh", "-o", "BatchMode=yes", "web-1"]));
    assert_eq!(
        cmd.env,
        vec![
            ("TERM".to_string(), "xterm-256color".to_string()),
            ("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string()),
        ]
    );
}

#[test]
fn an_empty_env_still_sets_term() {
    let cmd = session_command(&Target::Wsl { distro: "D".into() }, &prepared(json!({})));
    assert_eq!(cmd.argv[6..9], strings(&["env", "TERM=xterm-256color", "/usr/bin/ssh"]));
}

#[test]
fn debug_output_never_shows_env_values() {
    let secret = "tok-5f3a9c";
    let wsl = session_command(
        &Target::Wsl { distro: "D".into() },
        &prepared(json!({"ROSTER_ASKPASS_TOKEN": secret})),
    );
    let local = session_command(&Target::Local, &prepared(json!({"ROSTER_ASKPASS_TOKEN": secret})));
    for shown in [
        format!("{wsl:?}"),
        format!("{local:?}"),
        format!("{:?}", prepared(json!({"ROSTER_ASKPASS_TOKEN": secret}))),
    ] {
        assert!(!shown.contains(secret), "{shown}");
        assert!(shown.contains("ROSTER_ASKPASS_TOKEN"), "{shown}");
    }
}

/// What `session.prepare` gives for a password-only Host (roster README, "Password Sessions").
fn password_prepared(token: &str) -> Prepared {
    serde_json::from_value(json!({
        "argv": ["/usr/bin/ssh", "-o", "NumberOfPasswordPrompts=1",
                 "-o", "PreferredAuthentications=password,keyboard-interactive", "sw-core"],
        "env": {
            "SSH_ASKPASS": "/run/user/1000/roster-askpass-x1/askpass",
            "SSH_ASKPASS_REQUIRE": "force",
            "ROSTER_ASKPASS_SOCKET": "/run/user/1000/roster-askpass-x1/sock",
            "ROSTER_ASKPASS_TOKEN": token,
        },
        "host": "sw-core",
        "auth": "password",
    }))
    .unwrap()
}

#[test]
fn a_password_session_on_wsl_carries_the_askpass_env_through_wsl_exec() {
    let cmd = session_command(&Target::Wsl { distro: "D".into() }, &password_prepared("tok-1"));
    assert_eq!(
        cmd.argv,
        strings(&[
            "wsl.exe",
            "-d",
            "D",
            "--cd",
            "~",
            "--exec",
            "env",
            "TERM=xterm-256color",
            "ROSTER_ASKPASS_SOCKET=/run/user/1000/roster-askpass-x1/sock",
            "ROSTER_ASKPASS_TOKEN=tok-1",
            "SSH_ASKPASS=/run/user/1000/roster-askpass-x1/askpass",
            "SSH_ASKPASS_REQUIRE=force",
            "/usr/bin/ssh",
            "-o",
            "NumberOfPasswordPrompts=1",
            "-o",
            "PreferredAuthentications=password,keyboard-interactive",
            "sw-core",
        ])
    );
    assert_eq!(cmd.auth, "password");
    // No DISPLAY: SSH_ASKPASS_REQUIRE=force doesn't need one.
    assert!(!cmd.argv.iter().any(|a| a.starts_with("DISPLAY=")));
}

#[test]
fn an_error_naming_the_command_line_never_shows_the_token() {
    // ConPTY's spawn failure quotes the whole command line, env K=V included.
    let secret = "tok-5f3a9c";
    for target in [Target::Wsl { distro: "D".into() }, Target::Local] {
        let cmd = session_command(&target, &password_prepared(secret));
        let raw = format!("CreateProcessW `{:?}` in cwd `None` failed: 2", cmd.argv.join(" "));
        let shown = cmd.redact(&raw);
        assert!(!shown.contains(secret), "{shown}");
        assert!(
            shown.contains("ROSTER_ASKPASS_TOKEN=…") || matches!(target, Target::Local),
            "{shown}"
        );
    }
}
