//! Finding the Backend: which WSL distro (or the local machine) has roster and an Inventory, and
//! the exact argv that starts `roster serve` there. Driven through a scripted command runner.

use desk_core::detect::{Candidate, ErrorKind, Output, Platform, Runner, Target, detect, roster_command};
use std::cell::RefCell;
use std::collections::HashMap;

/// Answers by the argv it's asked to run; records every call.
#[derive(Default)]
struct Scripted {
    distros: Option<String>,
    probes: HashMap<String, String>, // distro ("" = local) -> probe stdout
    calls: RefCell<Vec<Vec<String>>>,
}

impl Runner for Scripted {
    fn run(&self, argv: &[String], _env: &[(&str, &str)]) -> std::io::Result<Output> {
        self.calls.borrow_mut().push(argv.to_vec());
        let ok = |s: &str| {
            Ok(Output {
                code: Some(0),
                stdout: s.to_string(),
                stderr: String::new(),
            })
        };
        if argv[0] == "wsl.exe" && argv[1] == "-l" {
            return match &self.distros {
                Some(d) => ok(d),
                None => Err(std::io::Error::new(std::io::ErrorKind::NotFound, "wsl.exe not found")),
            };
        }
        let distro = if argv[0] == "wsl.exe" {
            argv[2].clone()
        } else {
            String::new()
        };
        ok(self.probes.get(&distro).map(String::as_str).unwrap_or(""))
    }
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

const FOUND: &str = "roster=/home/u/.local/bin/roster\ninventory=/home/u/infra/roster.yml\n";

#[test]
fn on_windows_the_first_distro_with_roster_and_an_inventory_wins() {
    let r = Scripted {
        distros: Some("Ubuntu\r\nFedoraLinux-44\r\nOther\r\n".into()),
        probes: HashMap::from([("Ubuntu".into(), "".into()), ("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"])).unwrap();
    assert_eq!(
        c.target,
        Target::Wsl {
            distro: "FedoraLinux-44".into()
        }
    );
    assert_eq!(
        c.serve_argv,
        s(&[
            "wsl.exe",
            "-d",
            "FedoraLinux-44",
            "--cd",
            "~",
            "--exec",
            "/home/u/.local/bin/roster",
            "-c",
            "/home/u/infra/roster.yml",
            "serve"
        ])
    );
    // stops probing once it has found one
    assert!(!r.calls.borrow().iter().any(|a| a.contains(&"Other".to_string())));
}

#[test]
fn the_probe_resolves_roster_through_a_login_shell_with_local_bin_on_path() {
    let r = Scripted {
        distros: Some("FedoraLinux-44\n".into()),
        probes: HashMap::from([("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    detect(&r, Platform::Windows, &s(&["roster"])).unwrap();
    let calls = r.calls.borrow();
    let probe = &calls[1];
    assert_eq!(
        &probe[..8],
        &s(&["wsl.exe", "-d", "FedoraLinux-44", "--cd", "~", "--exec", "bash", "-lc"])[..]
    );
    assert!(probe[8].contains(".local/bin"), "{}", probe[8]);
    assert_eq!(probe.last().unwrap(), "roster");
}

#[test]
fn an_override_command_keeps_its_arguments_and_resolves_only_the_program() {
    let r = Scripted {
        distros: Some("FedoraLinux-44\n".into()),
        probes: HashMap::from([(
            "FedoraLinux-44".into(),
            "roster=/usr/bin/uv\ninventory=/home/u/infra/roster.yml\n".into(),
        )]),
        ..Default::default()
    };
    let cmd = roster_command(Some("uv run --project /home/u/work/roster roster"));
    let c = detect(&r, Platform::Windows, &cmd).unwrap();
    assert_eq!(r.calls.borrow()[1].last().unwrap(), "uv");
    assert_eq!(
        &c.serve_argv[6..],
        &s(&[
            "/usr/bin/uv",
            "run",
            "--project",
            "/home/u/work/roster",
            "roster",
            "-c",
            "/home/u/infra/roster.yml",
            "serve"
        ])[..]
    );
}

#[test]
fn roster_without_an_inventory_is_still_chosen_so_serve_can_say_what_is_missing() {
    let r = Scripted {
        distros: Some("A\nB\n".into()),
        probes: HashMap::from([("A".into(), "roster=/r\ninventory=\n".into()), ("B".into(), "".into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"])).unwrap();
    assert_eq!(c.target, Target::Wsl { distro: "A".into() });
    assert_eq!(&c.serve_argv[6..], &s(&["/r", "serve"])[..]);
}

#[test]
fn no_distro_with_roster_is_roster_missing_and_names_the_distros_searched() {
    let r = Scripted {
        distros: Some("A\nB\n".into()),
        ..Default::default()
    };
    let e = detect(&r, Platform::Windows, &s(&["roster"])).unwrap_err();
    assert_eq!(e.kind, ErrorKind::RosterMissing);
    assert!(e.message.contains("A, B"), "{}", e.message);
}

#[test]
fn no_wsl_at_all_is_its_own_error() {
    let r = Scripted::default();
    assert_eq!(
        detect(&r, Platform::Windows, &s(&["roster"])).unwrap_err().kind,
        ErrorKind::NoWsl
    );
    let r = Scripted {
        distros: Some("\n".into()),
        ..Default::default()
    };
    assert_eq!(
        detect(&r, Platform::Windows, &s(&["roster"])).unwrap_err().kind,
        ErrorKind::NoWsl
    );
}

#[test]
fn distro_names_survive_utf16_noise_and_skip_docker_desktop() {
    let r = Scripted {
        distros: Some("\u{feff}docker-desktop\0\r\nFedora\0\r\n".into()),
        probes: HashMap::from([("Fedora".into(), FOUND.into())]),
        ..Default::default()
    };
    let c: Candidate = detect(&r, Platform::Windows, &s(&["roster"])).unwrap();
    assert_eq!(
        c.target,
        Target::Wsl {
            distro: "Fedora".into()
        }
    );
    assert!(
        !r.calls
            .borrow()
            .iter()
            .any(|a| a.contains(&"docker-desktop".to_string()))
    );
}

#[test]
fn on_linux_roster_runs_locally() {
    let r = Scripted {
        probes: HashMap::from([("".into(), FOUND.into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Linux, &s(&["roster"])).unwrap();
    assert_eq!(c.target, Target::Local);
    assert_eq!(
        c.serve_argv,
        s(&["/home/u/.local/bin/roster", "-c", "/home/u/infra/roster.yml", "serve"])
    );
    assert_eq!(r.calls.borrow()[0][..2], s(&["bash", "-lc"])[..]);
}

#[test]
fn the_override_is_split_on_whitespace_and_blank_means_roster() {
    assert_eq!(roster_command(None), s(&["roster"]));
    assert_eq!(roster_command(Some("  ")), s(&["roster"]));
    assert_eq!(roster_command(Some(" uv  run roster ")), s(&["uv", "run", "roster"]));
}
