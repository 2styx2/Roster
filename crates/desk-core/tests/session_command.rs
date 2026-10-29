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
            "COLORTERM=truecolor",
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
            ("COLORTERM".to_string(), "truecolor".to_string()),
            ("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string()),
        ]
    );
}

#[test]
fn an_empty_env_still_sets_term_and_colorterm() {
    let cmd = session_command(&Target::Wsl { distro: "D".into() }, &prepared(json!({})));
    assert_eq!(
        cmd.argv[6..10],
        strings(&["env", "TERM=xterm-256color", "COLORTERM=truecolor", "/usr/bin/ssh"])
    );
}

/// Decision Q37: the user's own terminal config wins. The app adds TERM and COLORTERM and
/// nothing else (no PS1, no sourced files); every other variable comes from `session.prepare`
/// (askpass, ticket 06).
#[test]
fn the_app_adds_only_term_and_colorterm_to_the_session_env() {
    let from_roster = json!({"SSH_ASKPASS": "/run/askpass", "SSH_ASKPASS_REQUIRE": "force"});
    let cmd = session_command(&Target::Local, &prepared(from_roster.clone()));
    let added: Vec<&str> = cmd
        .env
        .iter()
        .map(|(k, _)| k.as_str())
        .filter(|k| from_roster.get(k).is_none())
        .collect();
    assert_eq!(added, ["TERM", "COLORTERM"]);
    let wsl = session_command(&Target::Wsl { distro: "D".into() }, &prepared(from_roster.clone()));
    let env_args: Vec<&str> = wsl.argv[7..]
        .iter()
        .take_while(|a| !a.starts_with('/'))
        .map(|a| a.split_once('=').unwrap().0)
        .filter(|k| from_roster.get(k).is_none())
        .collect();
    assert_eq!(env_args, ["TERM", "COLORTERM"]);
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
