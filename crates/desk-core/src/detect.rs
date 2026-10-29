//! Finding the Backend: where roster lives and the argv that starts `roster serve` there.
//!
//! On Windows each WSL distro is probed in `wsl.exe -l` order (the default distro first) until one
//! has both roster and an Inventory. On Linux roster runs locally. The probe is one login-shell
//! script per target; it resolves the roster program to an absolute path (`~/.local/bin` is only
//! on PATH in interactive shells on some distros) and finds `roster.yml` the way roster would,
//! plus `~/infra/roster.yml`. `serve` then gets `-c <path>` because it isn't started from a login
//! shell, so variables like `ROSTER_CONFIG` from the user's profile never reach it.

pub use crate::error::{BackendError, ErrorKind, OVERRIDE_VAR};
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

/// The roster command line: `ROSTER_DESK_ROSTER` split on whitespace, or just `roster`.
pub fn roster_command(override_value: Option<&str>) -> Vec<String> {
    let v: Vec<String> = override_value
        .unwrap_or("")
        .split_whitespace()
        .map(String::from)
        .collect();
    if v.is_empty() { vec!["roster".into()] } else { v }
}

/// Run with `bash -lc PROBE probe <program>`. Prints `roster=<abs path>` if the program resolves,
/// then `inventory=<path>` (empty when there's none).
const PROBE: &str = r#"PATH="$HOME/.local/bin:$PATH"
p=$(command -v -- "$1") || exit 0
echo "roster=$p"
for f in "$ROSTER_CONFIG" "$HOME/roster.yml" "$HOME/.config/roster/roster.yml" "$HOME/infra/roster.yml"; do
  if [ -n "$f" ] && [ -e "${f/#\~/$HOME}" ]; then echo "inventory=${f/#\~/$HOME}"; exit 0; fi
done
echo "inventory="
"#;

#[derive(Debug, Default, PartialEq, Eq)]
struct Probe {
    roster: Option<String>,
    inventory: Option<String>,
}

fn parse_probe(stdout: &str) -> Probe {
    let mut p = Probe::default();
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("roster=").filter(|v| !v.is_empty()) {
            p.roster = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("inventory=").filter(|v| !v.is_empty()) {
            p.inventory = Some(v.to_string());
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

/// `wsl.exe -l -q`, read as UTF-8 thanks to WSL_UTF8=1 (and cleaned of UTF-16 leftovers anyway).
fn list_distros(runner: &dyn Runner) -> Result<Vec<String>, BackendError> {
    let no_wsl = || {
        BackendError::new(
            ErrorKind::NoWsl,
            "No WSL distro was found.",
            "Install WSL and a Linux distro with roster in it (`wsl --install`), then retry.",
        )
    };
    let out = runner
        .run(&["wsl.exe", "-l", "-q"].map(String::from), &[("WSL_UTF8", "1")])
        .map_err(|e| no_wsl().with_detail(format!("wsl.exe -l -q: {e}")))?;
    let distros: Vec<String> = out
        .stdout
        .replace(['\0', '\u{feff}'], "")
        .lines()
        .map(str::trim)
        .filter(|d| !d.is_empty() && !d.starts_with("docker-desktop"))
        .map(String::from)
        .collect();
    if distros.is_empty() {
        Err(no_wsl().with_detail(out.stderr))
    } else {
        Ok(distros)
    }
}

fn candidate(target: Target, roster_cmd: &[String], p: &Probe) -> Candidate {
    let mut argv = vec![p.roster.clone().unwrap_or_default()];
    argv.extend_from_slice(&roster_cmd[1..]);
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

/// Find the Backend for `roster_cmd` (see [`roster_command`]).
pub fn detect(runner: &dyn Runner, platform: Platform, roster_cmd: &[String]) -> Result<Candidate, BackendError> {
    let program = &roster_cmd[0];
    let targets = match platform {
        Platform::Linux => vec![Target::Local],
        Platform::Windows => list_distros(runner)?
            .into_iter()
            .map(|distro| Target::Wsl { distro })
            .collect(),
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
        let where_ = match platform {
            Platform::Linux => "on this machine".to_string(),
            Platform::Windows => format!(
                "in any WSL distro (searched: {})",
                targets
                    .iter()
                    .map(|t| match t {
                        Target::Wsl { distro } => distro.as_str(),
                        Target::Local => "local",
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        BackendError::new(
            ErrorKind::RosterMissing,
            format!("`{program}` wasn't found {where_}."),
            format!(
                "Install roster (`uv tool install roster` from the roster repo) so it's on PATH, \
                 or set {OVERRIDE_VAR} to the command that runs it, e.g. \
                 `uv run --project ~/work/roster roster`."
            ),
        )
    })
}
