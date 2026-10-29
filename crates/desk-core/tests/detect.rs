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

/// `wsl.exe -l -v` output for `(default marker, name, state)` rows.
fn list(rows: &[(&str, &str, &str)]) -> String {
    let mut out = "  NAME      STATE      VERSION\r\n".to_string();
    for (mark, name, state) in rows {
        out += &format!("{mark:1} {name:9} {state:10} 2\r\n");
    }
    out
}

const FOUND: &str = "roster=/home/u/.local/bin/roster\ninventory=/home/u/infra/roster.yml\n";

#[test]
fn on_windows_the_first_distro_with_roster_and_an_inventory_wins() {
    let r = Scripted {
        distros: Some(list(&[
            ("*", "Ubuntu", "Running"),
            ("", "FedoraLinux-44", "Running"),
            ("", "Other", "Running"),
        ])),
        probes: HashMap::from([("Ubuntu".into(), "".into()), ("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
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
        distros: Some(list(&[("*", "FedoraLinux-44", "Stopped")])),
        probes: HashMap::from([("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
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
        distros: Some(list(&[("*", "FedoraLinux-44", "Stopped")])),
        probes: HashMap::from([(
            "FedoraLinux-44".into(),
            "roster=/usr/bin/uv\ninventory=/home/u/infra/roster.yml\n".into(),
        )]),
        ..Default::default()
    };
    let cmd = roster_command(Some("uv run --project /home/u/work/roster roster"));
    let c = detect(&r, Platform::Windows, &cmd, None).unwrap();
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
        distros: Some(list(&[("*", "A", "Running"), ("", "B", "Running")])),
        probes: HashMap::from([("A".into(), "roster=/r\ninventory=\n".into()), ("B".into(), "".into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
    assert_eq!(c.target, Target::Wsl { distro: "A".into() });
    assert_eq!(&c.serve_argv[6..], &s(&["/r", "serve"])[..]);
}

#[test]
fn no_distro_with_roster_is_roster_missing_and_names_the_distros_searched() {
    let r = Scripted {
        distros: Some(list(&[("*", "A", "Running"), ("", "B", "Running")])),
        ..Default::default()
    };
    let e = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err();
    assert_eq!(e.kind, ErrorKind::RosterMissing);
    assert!(e.message.contains("A, B"), "{}", e.message);
}

#[test]
fn no_wsl_at_all_is_its_own_error() {
    let r = Scripted::default();
    assert_eq!(
        detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err().kind,
        ErrorKind::NoWsl
    );
    let r = Scripted {
        distros: Some("\n".into()),
        ..Default::default()
    };
    assert_eq!(
        detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err().kind,
        ErrorKind::NoWsl
    );
}

#[test]
fn distro_names_survive_utf16_noise_and_skip_docker_desktop() {
    let r = Scripted {
        distros: Some(
            "\u{feff}  NAME STATE VERSION\0\r\n* docker-desktop Running 2\0\r\n  Fedora Running 2\0\r\n".into(),
        ),
        probes: HashMap::from([("Fedora".into(), FOUND.into())]),
        ..Default::default()
    };
    let c: Candidate = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
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
    let c = detect(&r, Platform::Linux, &s(&["roster"]), None).unwrap();
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

/// `wsl.exe --exec` starts serve with a bare PATH (no `~/.local/bin`), so roster couldn't find the
/// vault CLI (`bw` from npm or `~/.local/bin`) and the lock screen said "not installed".
#[test]
fn serve_gets_the_login_shells_path_so_it_finds_the_vault_cli() {
    let found = format!("{FOUND}path=/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin\n");
    let r = Scripted {
        distros: Some(LIST_V.into()),
        probes: HashMap::from([("FedoraLinux-44".into(), found)]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
    assert_eq!(
        c.serve_argv,
        s(&[
            "wsl.exe",
            "-d",
            "FedoraLinux-44",
            "--cd",
            "~",
            "--exec",
            "/usr/bin/env",
            "PATH=/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin",
            "/home/u/.local/bin/roster",
            "-c",
            "/home/u/infra/roster.yml",
            "serve"
        ])
    );
}

#[test]
fn the_probe_reports_the_login_path() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        probes: HashMap::from([("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
    let script = r.calls.borrow()[1][8].clone();
    assert!(script.contains(r#"echo "path=$PATH""#), "{script}");
}

/// `wsl.exe -l -v` as WSL_UTF8=1 prints it: `*` marks the default distro.
const LIST_V: &str = "  NAME              STATE           VERSION\r\n\
* FedoraLinux-44    Running         2\r\n\
  OracleLinux_9     Stopped         2\r\n\
  Ubuntu            Running         2\r\n";

fn probed(r: &Scripted) -> Vec<String> {
    r.calls
        .borrow()
        .iter()
        .filter(|a| a[0] == "wsl.exe" && a[1] == "-d")
        .map(|a| a[2].clone())
        .collect()
}

#[test]
fn a_stopped_distro_that_is_not_the_default_is_never_probed() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        ..Default::default()
    };
    let e = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err();
    assert_eq!(probed(&r), s(&["FedoraLinux-44", "Ubuntu"]));
    assert_eq!(e.kind, ErrorKind::RosterMissing);
}

#[test]
fn the_default_distro_is_probed_first_and_may_be_started() {
    let r = Scripted {
        distros: Some(list(&[("", "Ubuntu", "Running"), ("*", "Fedora", "Stopped")])),
        probes: HashMap::from([("Fedora".into(), FOUND.into()), ("Ubuntu".into(), FOUND.into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap();
    assert_eq!(
        c.target,
        Target::Wsl {
            distro: "Fedora".into()
        }
    );
    assert_eq!(probed(&r), s(&["Fedora"]));
}

#[test]
fn localized_states_and_a_utf16_listing_still_parse() {
    // Without WSL_UTF8 honoured: UTF-16 read as bytes leaves NULs; STATE words are localized.
    let raw = "\u{feff}  NAME  ZUSTAND  VERSION\r\n* Fedora  Wird ausgeführt  2\r\n  Oracle  Beendet  2\r\n";
    let utf16ish: String = raw.chars().flat_map(|c| [c, '\0']).collect();
    let r = Scripted {
        distros: Some(utf16ish),
        ..Default::default()
    };
    detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err();
    // only the default: an unknown state is never taken for Running
    assert_eq!(probed(&r), s(&["Fedora"]));
}

#[test]
fn when_nothing_matches_the_error_names_the_stopped_distros_and_how_to_pick_one() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        ..Default::default()
    };
    let e = detect(&r, Platform::Windows, &s(&["roster"]), None).unwrap_err();
    assert!(e.message.contains("FedoraLinux-44, Ubuntu"), "{}", e.message);
    assert!(e.message.contains("OracleLinux_9"), "{}", e.message);
    assert!(e.hint.contains("ROSTER_DESK_WSL_DISTRO=OracleLinux_9"), "{}", e.hint);
}

#[test]
fn a_chosen_distro_is_the_only_one_probed_even_if_stopped() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        probes: HashMap::from([
            ("OracleLinux_9".into(), FOUND.into()),
            ("FedoraLinux-44".into(), FOUND.into()),
        ]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), Some("OracleLinux_9")).unwrap();
    assert_eq!(
        c.target,
        Target::Wsl {
            distro: "OracleLinux_9".into()
        }
    );
    assert_eq!(probed(&r), s(&["OracleLinux_9"]));
}

#[test]
fn a_chosen_distro_without_roster_is_named_in_the_error() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        ..Default::default()
    };
    let e = detect(&r, Platform::Windows, &s(&["roster"]), Some(" Ubuntu ")).unwrap_err();
    assert_eq!(probed(&r), s(&["Ubuntu"]));
    assert_eq!(e.kind, ErrorKind::RosterMissing);
    assert!(e.message.contains("Ubuntu"), "{}", e.message);
    assert!(e.message.contains("ROSTER_DESK_WSL_DISTRO"), "{}", e.message);
}

#[test]
fn a_blank_distro_choice_means_none() {
    let r = Scripted {
        distros: Some(LIST_V.into()),
        probes: HashMap::from([("FedoraLinux-44".into(), FOUND.into())]),
        ..Default::default()
    };
    let c = detect(&r, Platform::Windows, &s(&["roster"]), Some("  ")).unwrap();
    assert_eq!(
        c.target,
        Target::Wsl {
            distro: "FedoraLinux-44".into()
        }
    );
}
