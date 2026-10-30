//! The development env vars ([`OVERRIDE_VAR`], [`DISTRO_VAR`]). They were `ROSTER_DESK_*` while
//! the app was called roster-desk; those names are still read when the new one isn't set, so an
//! old shell profile or script keeps working. A blank value counts as not set.

use crate::error::{DISTRO_VAR, LEGACY_DISTRO_VAR, LEGACY_OVERRIDE_VAR, OVERRIDE_VAR};

/// `name`'s value, else `legacy`'s, looked up with `var`. Blank values don't count.
pub fn var_or_legacy(name: &str, legacy: &str, var: impl Fn(&str) -> Option<String>) -> Option<String> {
    let set = |n: &str| var(n).filter(|v| !v.trim().is_empty());
    set(name).or_else(|| set(legacy))
}

/// The roster command override: `ROSTER_APP_ROSTER`, else `ROSTER_DESK_ROSTER`.
pub fn roster_override() -> Option<String> {
    var_or_legacy(OVERRIDE_VAR, LEGACY_OVERRIDE_VAR, system_var)
}

/// The one WSL distro to use: `ROSTER_APP_WSL_DISTRO`, else `ROSTER_DESK_WSL_DISTRO`.
pub fn wsl_distro() -> Option<String> {
    var_or_legacy(DISTRO_VAR, LEGACY_DISTRO_VAR, system_var)
}

fn system_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}
