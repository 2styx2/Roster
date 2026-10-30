//! Finding the Backend: where roster lives and the argv that starts `roster serve` there.
//!
//! On Windows the default WSL distro is probed first, then every other distro that's already
//! Running (`wsl.exe -l -v`), until one has both roster and an Inventory. A stopped distro other
//! than the default is never probed, because probing would boot it (see [`list_distros`]);
//! `ROSTER_APP_WSL_DISTRO=<name>` picks one distro explicitly, starting it if needed. On Linux roster runs locally. The probe is one login-shell
//! script per target; it resolves the roster program to an absolute path (`~/.local/bin` is only
//! on PATH in interactive shells on some distros) and finds `roster.yml` the way roster would,
//! plus `~/infra/roster.yml`. `serve` then gets `-c <path>` because it isn't started from a login
//! shell, so variables like `ROSTER_CONFIG` from the user's profile never reach it. For the same
//! reason it gets the login shell's PATH (`env PATH=...`): `wsl.exe --exec` has no `~/.local/bin`,
//! and roster finds the vault CLI (`bw`) and `ssh` on PATH. No shell expands `~` in the override
//! (`ROSTER_APP_ROSTER`) either, so the probe reports the target's `$HOME` and a leading `~/` in
//! the program or its arguments is expanded with it.

pub use crate::error::{BackendError, DISTRO_VAR, ErrorKind, OVERRIDE_VAR};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Local,
    Wsl { distro: String },
}

impl Target {
    /// How the Backend is named in the UI (GLOSSARY: "Local" or "WSL: <distro>").
    pub fn label(&self) -> String {
        match self {
            Target::Local => "Local".into(),
            Target::Wsl { distro } => format!("WSL: {distro}"),
        }
    }

    /// `argv` run on this target: as is locally, through `wsl.exe --exec` (no shell) in WSL.
    pub fn wrap(&self, argv: &[String]) -> Vec<String> {
        match self {
            Target::Local => argv.to_vec(),
            Target::Wsl { distro } => {
                let mut v: Vec<String> = ["wsl.exe", "-d", distro, "--cd", "~", "--exec"]
                    .map(String::from)
                    .into();
                v.extend_from_slice(argv);
                v
            }
        }
    }
}

/// A Backend that's been found, ready to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub target: Target,
    /// Starts `roster serve` on the target.
    pub serve_argv: Vec<String>,
    /// True when the probe found a `roster.yml`.
    pub has_inventory: bool,
}

#[derive(Debug, Clone)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Runs a short command to completion. The seam the detection tests script.
pub trait Runner {
    fn run(&self, argv: &[String], env: &[(&str, &str)]) -> std::io::Result<Output>;
}

/// Runs commands for real (with no console window on Windows).
pub struct SystemRunner;

impl Runner for SystemRunner {
    fn run(&self, argv: &[String], env: &[(&str, &str)]) -> std::io::Result<Output> {
        let mut c = Command::new(&argv[0]);
        c.args(&argv[1..])
            .envs(env.iter().copied())
            .stdin(std::process::Stdio::null());
        crate::rpc::no_console_window(&mut c);
        let o = c.output()?;
        Ok(Output {
            code: o.status.code(),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        })
    }
}

/// The roster command line: `ROSTER_APP_ROSTER` split on whitespace, or just `roster`.
pub fn roster_command(override_value: Option<&str>) -> Vec<String> {
    let v: Vec<String> = override_value
        .unwrap_or("")
        .split_whitespace()
        .map(String::from)
        .collect();
    if v.is_empty() { vec!["roster".into()] } else { v }
}

/// Run with `bash -lc PROBE probe <program>`. Prints `roster=<abs path>` if the program resolves
/// (a leading `~` means the target's home: no shell expands it, as the program comes in quoted),
/// then `home=$HOME`, `path=<the login PATH>` and `inventory=<path>` (empty when there's none).
const PROBE: &str = r#"PATH="$HOME/.local/bin:$PATH"
case $1 in "~" | "~/"*) set -- "$HOME${1#"~"}" ;; esac
p=$(command -v -- "$1") || exit 0
echo "roster=$p"
echo "home=$HOME"
echo "path=$PATH"
for f in "$ROSTER_CONFIG" "$HOME/roster.yml" "$HOME/.config/roster/roster.yml" "$HOME/infra/roster.yml"; do
  if [ -n "$f" ] && [ -e "${f/#\~/$HOME}" ]; then echo "inventory=${f/#\~/$HOME}"; exit 0; fi
done
echo "inventory="
"#;

#[derive(Debug, Default, PartialEq, Eq)]
struct Probe {
    roster: Option<String>,
    inventory: Option<String>,
    path: Option<String>,
    home: Option<String>,
}

fn parse_probe(stdout: &str) -> Probe {
    let mut p = Probe::default();
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("roster=").filter(|v| !v.is_empty()) {
            p.roster = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("inventory=").filter(|v| !v.is_empty()) {
            p.inventory = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("path=").filter(|v| !v.is_empty()) {
            p.path = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("home=").filter(|v| !v.is_empty()) {
            p.home = Some(v.to_string());
        }
    }
    p
}

fn probe(runner: &dyn Runner, target: &Target, program: &str) -> Probe {
    let argv = target.wrap(&["bash", "-lc", PROBE, "probe", program].map(String::from));
    match runner.run(&argv, &[]) {
        Ok(o) => parse_probe(&o.stdout),
        Err(_) => Probe::default(),
    }
}

/// The distros detection may probe, in order, and the ones it left alone because they're stopped.
#[derive(Debug, Default, PartialEq, Eq)]
struct Distros {
    probe: Vec<String>,
    stopped: Vec<String>,
}

/// One row of `wsl.exe -l -v`: `[*] NAME STATE VERSION`. The header (localized) and blank lines
/// give `None`: a row ends in the WSL version number. STATE may be localized and contain spaces.
fn parse_list_row(line: &str) -> Option<(bool, String, String)> {
    let mut words: Vec<&str> = line.split_whitespace().collect();
    let is_default = words.first() == Some(&"*");
    if is_default {
        words.remove(0);
    }
    if words.len() < 3 || words.last()?.parse::<u8>().is_err() {
        return None;
    }
    let state = words[1..words.len() - 1].join(" ");
    Some((is_default, words[0].to_string(), state))
}

/// `wsl.exe -l -v`, read as UTF-8 thanks to WSL_UTF8=1 (and cleaned of UTF-16 leftovers anyway).
/// Probing runs `bash` in the distro, which boots it if it's stopped, and booting a distro can
/// have side effects for the whole WSL VM (OracleLinux_9's systemd-binfmt unregistered
/// WSLInterop, so every distro lost cmd.exe/wsl.exe). So only the default distro (the user's
/// main one) may be started; any other distro is probed only if it's already Running.
fn list_distros(runner: &dyn Runner) -> Result<Distros, BackendError> {
    let no_wsl = || {
        BackendError::new(
            ErrorKind::NoWsl,
            "No WSL distro was found.",
            "Install WSL and a Linux distro with roster in it (`wsl --install`), then retry.",
        )
    };
    let out = runner
        .run(&["wsl.exe", "-l", "-v"].map(String::from), &[("WSL_UTF8", "1")])
        .map_err(|e| no_wsl().with_detail(format!("wsl.exe -l -v: {e}")))?;
    let rows: Vec<(bool, String, String)> = out
        .stdout
        .replace(['\0', '\u{feff}'], "")
        .lines()
        .filter_map(parse_list_row)
        .filter(|(_, name, _)| !name.starts_with("docker-desktop"))
        .collect();
    if rows.is_empty() {
        return Err(no_wsl().with_detail(out.stderr));
    }
    let mut d = Distros::default();
    d.probe.extend(rows.iter().filter(|r| r.0).map(|r| r.1.clone()));
    for (is_default, name, state) in rows {
        if is_default {
            continue;
        }
        if state == "Running" {
            d.probe.push(name);
        } else {
            d.stopped.push(name);
        }
    }
    Ok(d)
}

/// `~` or a leading `~/` in `arg` as the target's `home`. serve starts through `wsl.exe --exec` (or
/// directly on Linux), with no shell to expand it, and tools like uv take `~/work/roster` literally.
fn expand_home(arg: &str, home: Option<&str>) -> String {
    match (home, arg.strip_prefix('~')) {
        (Some(h), Some(rest)) if rest.is_empty() || rest.starts_with('/') => format!("{h}{rest}"),
        _ => arg.to_string(),
    }
}

fn candidate(target: Target, roster_cmd: &[String], p: &Probe) -> Candidate {
    let mut argv = match &p.path {
        Some(path) => vec!["/usr/bin/env".into(), format!("PATH={path}")],
        None => vec![],
    };
    argv.push(p.roster.clone().unwrap_or_default());
    argv.extend(roster_cmd[1..].iter().map(|a| expand_home(a, p.home.as_deref())));
    if let Some(inv) = &p.inventory {
        argv.extend(["-c".into(), inv.clone()]);
    }
    argv.push("serve".into());
    Candidate {
        serve_argv: target.wrap(&argv),
        target,
        has_inventory: p.inventory.is_some(),
    }
}

/// Find the Backend for `roster_cmd` (see [`roster_command`]). On Windows, `distro` is the value of
/// [`DISTRO_VAR`]: when it's set (not blank), only that distro is probed, and started if needed.
pub fn detect(
    runner: &dyn Runner,
    platform: Platform,
    roster_cmd: &[String],
    distro: Option<&str>,
) -> Result<Candidate, BackendError> {
    let program = &roster_cmd[0];
    let chosen = distro.map(str::trim).filter(|d| !d.is_empty());
    let mut stopped = Vec::new();
    let targets = match (platform, chosen) {
        (Platform::Linux, _) => vec![Target::Local],
        (Platform::Windows, Some(d)) => vec![Target::Wsl { distro: d.to_string() }],
        (Platform::Windows, None) => {
            let d = list_distros(runner)?;
            stopped = d.stopped;
            d.probe.into_iter().map(|distro| Target::Wsl { distro }).collect()
        }
    };
    let mut fallback = None;
    for t in &targets {
        let p = probe(runner, t, program);
        if p.roster.is_none() {
            continue;
        }
        if p.inventory.is_some() {
            return Ok(candidate(t.clone(), roster_cmd, &p));
        }
        fallback.get_or_insert_with(|| candidate(t.clone(), roster_cmd, &p));
    }
    fallback.ok_or_else(|| {
        let names = |ts: &[Target]| {
            ts.iter()
                .map(|t| match t {
                    Target::Wsl { distro } => distro.as_str(),
                    Target::Local => "local",
                })
                .collect::<Vec<_>>()
                .join(", ")
        };
        let mut where_ = match (platform, chosen) {
            (Platform::Linux, _) => "on this machine".to_string(),
            (Platform::Windows, Some(d)) => format!("in WSL distro {d} (chosen with {DISTRO_VAR})"),
            (Platform::Windows, None) => format!("in any WSL distro (searched: {})", names(&targets)),
        };
        let mut hint = format!(
            "Install roster (`uv tool install roster` from the roster repo) so it's on PATH, \
             or set {OVERRIDE_VAR} to the command that runs it, e.g. \
             `uv run --project /home/you/work/roster roster`."
        );
        if !stopped.is_empty() {
            where_ += &format!("; skipped because they're stopped: {}", stopped.join(", "));
            hint += &format!(
                " To use a stopped distro, start it yourself or set {DISTRO_VAR}={} \
                 (the app then probes only that distro, starting it if needed).",
                stopped[0]
            );
        }
        BackendError::new(
            ErrorKind::RosterMissing,
            format!("`{program}` wasn't found {where_}."),
            hint,
        )
    })
}
