#!/usr/bin/env bash
# Install roster on this box, one stage at a time. Every stage asks first and is safe to re-run.
#
#   ./install.sh               interactive
#   ./install.sh --yes         accept every default (stages that need a person, like `bw login`, are skipped)
#   ./install.sh --dry-run     show what would happen, change nothing
#   ./install.sh --prefix DIR  put the roster command in DIR/bin and its man page in DIR/share/man/man1
#                              (default: uv's tool bin dir, ~/.local/bin, so ~/.local/share/man/man1); or PREFIX=DIR
#
# Stages: prerequisites, uv, roster (with its man page, so `man roster` works), Bitwarden CLI, the roster config folder, making roster work from
# any directory, unlocking the vault, `roster setup`, and auto-updates from cron.
# Output of each step goes to ~/.cache/roster/install.log; it is shown only when a step fails.
set -uo pipefail

ROSTER_REPO="git@github.com:2styx2/roster.git"
INFRA_REPO="git@example.com:yourteam/infra.git"
LOG="$HOME/.cache/roster/install.log"
SESSION_FILE="$HOME/.config/roster/bw-session"
MARK="# roster: ROSTER_CONFIG"           # marks the line we add to shell startup files

YES=0 DRY=0 PREFIX=${PREFIX:-}
while (( $# )); do
    case "$1" in
        -y|--yes) YES=1 ;;
        -n|--dry-run) DRY=1 ;;
        --prefix) [[ -n ${2:-} ]] || { echo "--prefix needs a directory" >&2; exit 2; }; PREFIX=$2; shift ;;
        --prefix=*) PREFIX=${1#--prefix=} ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done
PREFIX=${PREFIX/#\~/$HOME}

# ---- look

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    B=$'\e[1m' D=$'\e[2m' R=$'\e[31m' G=$'\e[32m' Y=$'\e[33m' C=$'\e[36m' N=$'\e[0m'
else
    B='' D='' R='' G='' Y='' C='' N=''
fi
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8*|*utf8*) FULL="█" EMPTY="░" OK="✔" BAD="✘" SKIP="–" SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) ;;
    *) FULL="#" EMPTY="-" OK="ok" BAD="x" SKIP="-" SPIN=('|' '/' '-' '\') ;;
esac

STAGES=("Prerequisites" "uv" "roster" "Bitwarden CLI" "Config folder" "Work from anywhere"
        "Unlock the vault" "Set up this box" "Auto-update")
TOTAL=${#STAGES[@]}
DONE=() SKIPPED=() FAILED=()

stage() {                       # stage N: progress bar + title
    local n=$1 w=30 fill
    fill=$(( n * w / TOTAL ))
    local bar="" i
    for ((i = 0; i < w; i++)); do (( i < fill )) && bar+="$FULL" || bar+="$EMPTY"; done
    printf '\n%s%s%s %s%d/%d%s  %s%s%s\n' "$C" "$bar" "$N" "$D" "$n" "$TOTAL" "$N" "$B" "${STAGES[n-1]}" "$N"
    CUR="${STAGES[n-1]}"
}
ok()   { printf '  %s%s%s %s\n' "$G" "$OK" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
bad()  { printf '  %s%s%s %s\n' "$R" "$BAD" "$N" "$*"; }
info() { printf '  %s%s%s\n' "$D" "$*" "$N"; }
skip() { printf '  %s%s %s%s\n' "$D" "$SKIP" "$*" "$N"; SKIPPED+=("$CUR"); }
done_stage() { DONE+=("$CUR"); }
fail_stage() { FAILED+=("$CUR"); }

TTY=/dev/tty                    # prompts read the keyboard even when piped into bash
( : < "$TTY" ) 2>/dev/null || TTY=/dev/stdin

ask() {                         # ask "Question?" Y|N  -> 0 for yes
    local q=$1 def=${2:-Y} hint reply
    [[ $def == Y ]] && hint="Y/n" || hint="y/N"
    if (( YES )); then
        printf '  %s?%s %s %s[%s]%s %s\n' "$C" "$N" "$q" "$D" "$hint" "$N" "$([[ $def == Y ]] && echo yes || echo no)"
        [[ $def == Y ]]; return
    fi
    while true; do
        printf '  %s?%s %s %s[%s]%s ' "$C" "$N" "$q" "$D" "$hint" "$N"
        read -r reply < "$TTY" || reply=""
        case "${reply:-$def}" in
            [Yy]*) return 0 ;;
            [Nn]*) return 1 ;;
        esac
    done
}

ask_value() {                   # ask_value "Prompt" default -> echoes the answer
    local q=$1 def=$2 reply
    if (( YES )); then printf '  %s?%s %s %s%s\n' "$C" "$N" "$q" "$def" "$N" >&2; echo "$def"; return; fi
    printf '  %s?%s %s %s[%s]%s ' "$C" "$N" "$q" "$D" "$def" "$N" > "$TTY"
    read -r reply < "$TTY" || reply=""
    echo "${reply:-$def}"
}

step() {                        # step "what" cmd...  - runs with a spinner, output to the log
    local what=$1; shift
    if (( DRY )); then info "would run: $*"; return 0; fi
    printf '\n==== %s: %s\n' "$what" "$*" >> "$LOG"
    "$@" >> "$LOG" 2>&1 &
    local pid=$! i=0
    if [[ -t 1 ]]; then
        while kill -0 "$pid" 2>/dev/null; do
            printf '\r  %s%s%s %s' "$C" "${SPIN[i++ % ${#SPIN[@]}]}" "$N" "$what"
            sleep 0.1
        done
        printf '\r\e[K'
    fi
    if wait "$pid"; then ok "$what"; return 0; fi
    bad "$what failed - last lines of $LOG:"
    tail -n 8 "$LOG" | sed "s/^/      $D/; s/\$/$N/"
    return 1
}

live() {                        # live "what" cmd...  - runs in the foreground (it needs the keyboard)
    local what=$1; shift
    if (( DRY )); then info "would run: $*"; return 0; fi
    info "$what"
    if "$@" < "$TTY"; then ok "$what"; else bad "$what failed"; return 1; fi
}

have() { command -v "$1" >/dev/null 2>&1; }

pkg_install() {                 # pkg_install name... with the box's package manager
    if   have apt-get; then step "apt install $*" sudo apt-get install -y "$@"
    elif have dnf;     then step "dnf install $*" sudo dnf install -y "$@"
    elif have yum;     then step "yum install $*" sudo yum install -y "$@"
    elif have pacman;  then step "pacman -S $*" sudo pacman -S --noconfirm "$@"
    elif have brew;    then step "brew install $*" brew install "$@"
    else bad "no package manager found - install $* yourself"; return 1
    fi
}

# ---- start

mkdir -p "$(dirname "$LOG")"
(( DRY )) || : > "$LOG"
export PATH="$HOME/.local/bin:$PATH"
[[ -n $PREFIX ]] && export PATH="$PREFIX/bin:$PATH"

printf '\n%sroster installer%s\n' "$B" "$N"
info "Give this box (and Claude on it) access to every host in roster.yml. Passwords stay in the vault."
(( DRY )) && warn "dry run: nothing will be changed"
(( YES )) && info "--yes: taking the default answer everywhere"

# 1. Prerequisites
stage 1
missing=()
if have python3 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    ok "Python $(python3 -c 'import platform; print(platform.python_version())')"
else
    bad "Python 3.10 or newer"; missing+=(python3)
fi
for t in ssh ssh-keygen ssh-keyscan; do
    if have "$t"; then ok "$t"; else bad "$t (OpenSSH client)"; missing+=(openssh-client); break; fi
done
for t in git curl; do
    if have "$t"; then ok "$t"; else bad "$t"; missing+=("$t"); fi
done
if have jq; then ok "jq"; else warn "jq not installed (optional: the vault listings in the docs use it)"; fi
if have nmap; then ok "nmap"; else warn "nmap not installed (optional: makes roster discover faster and better)"; fi
if (( ${#missing[@]} )); then
    if have dnf || have yum; then missing=("${missing[@]/openssh-client/openssh-clients}"); fi
    if ask "Install ${missing[*]} with your package manager?" Y && pkg_install "${missing[@]}"; then done_stage
    else fail_stage; bad "roster needs these - install them and run this again"; exit 1; fi
else
    done_stage
fi
if ! have jq || ! have nmap; then
    opt=(); have jq || opt+=(jq); have nmap || opt+=(nmap)
    ask "Install the optional tools too (${opt[*]})?" N && pkg_install "${opt[@]}"
fi

# 2. uv
stage 2
if have uv; then ok "uv $(uv --version | awk '{print $2}') already installed"; done_stage
elif ask "uv (Python tool installer) is missing. Install it from astral.sh?" Y; then
    if step "install uv" sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'; then done_stage
    else fail_stage; exit 1; fi
else
    skip "roster is installed with uv - can't continue without it"; exit 1
fi

# 3. roster
stage 3
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -f "$here/pyproject.toml" ]] && grep -q '^name = "roster"' "$here/pyproject.toml"; then
    src=$here
    ok "using this checkout: $src"
else
    src=$(ask_value "Where should the roster source live?" "$HOME/roster")
    src=${src/#\~/$HOME}
    if [[ -d "$src/.git" ]]; then ok "already cloned: $src"
    elif ! step "clone roster into $src" git clone -q "$ROSTER_REPO" "$src"; then fail_stage; exit 1; fi
fi
if have roster && ! ask "roster $(roster --version 2>/dev/null | awk '{print $NF}') is installed. Reinstall from $src?" Y; then
    skip "kept the installed roster"
# The man page goes next to the command, PREFIX/share/man/man1 beside PREFIX/bin: man finds it from PATH.
elif bindir=${PREFIX:+$PREFIX/bin}; bindir=${bindir:-$(uv tool dir --bin 2>/dev/null || echo "$HOME/.local/bin")}
     step "install roster (uv tool install) into $bindir" \
        env "UV_TOOL_BIN_DIR=$bindir" uv tool install --force --quiet "$src"; then
    page="$(dirname "$bindir")/share/man/man1/roster.1"
    step "install the man page (man roster)" sh -c 'mkdir -p "$(dirname "$1")" && cp "$2" "$1"' _ \
        "$page" "$src/src/roster/roster.1" || warn "no man page; roster man shows it"
    done_stage
    case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "add ~/.local/bin to PATH (stage 6 does it)";; esac
    [[ -n $PREFIX ]] && warn "add $PREFIX/bin to PATH yourself"
else
    fail_stage; exit 1
fi

# 4. Bitwarden CLI
stage 4
if have bw; then ok "bw $(bw --version 2>/dev/null) already installed"; done_stage
elif ask "Install the Bitwarden CLI (bw)? roster fetches passwords with it" Y; then
    if have npm; then
        step "npm install -g @bitwarden/cli" npm install -g @bitwarden/cli && done_stage || fail_stage
    elif [[ $(uname -s) == Linux ]] && have unzip; then
        tmp=$(mktemp -d)
        if step "download bw" curl -fsSL -o "$tmp/bw.zip" "https://vault.bitwarden.com/download/?app=cli&platform=linux" \
           && step "unpack bw into ~/.local/bin" sh -c "mkdir -p '$HOME/.local/bin' && unzip -oq '$tmp/bw.zip' -d '$HOME/.local/bin' && chmod +x '$HOME/.local/bin/bw'"
        then done_stage; else fail_stage; fi
        rm -rf "$tmp"
    elif have brew; then pkg_install bitwarden-cli && done_stage || fail_stage
    else bad "install npm or unzip first, or get bw from https://bitwarden.com/help/cli/"; fail_stage
    fi
else
    skip "no Bitwarden CLI - logins that use bw: won't work on this box"
fi

# 5. Config folder
stage 5
cfg_dir=$(ask_value "Folder for your roster config (roster.yml)" "$HOME/infra")
cfg_dir=${cfg_dir/#\~/$HOME}
CFG="$cfg_dir/roster.yml"
if [[ -f "$CFG" ]]; then
    ok "found $CFG"
    if [[ -d "$cfg_dir/.git" ]] && ask "Pull the latest map into $cfg_dir?" Y; then
        step "git pull" git -C "$cfg_dir" pull --ff-only --quiet || warn "couldn't fast-forward; using it as it is"
    fi
    done_stage
elif ask "Create $cfg_dir with the team's map (clone yourteam/infra)?" Y; then
    if [[ -e "$cfg_dir" && -n "$(ls -A "$cfg_dir" 2>/dev/null)" ]]; then
        bad "$cfg_dir exists and isn't empty - pick another folder or empty it"; fail_stage
    elif step "clone yourteam/infra into $cfg_dir" git clone -q "$INFRA_REPO" "$cfg_dir"; then done_stage
    else warn "no git access? copy roster.yml into $cfg_dir by hand"; fail_stage; fi
elif ask "Start $cfg_dir from the commented example instead (roster init)?" N; then
    if (( DRY )) || mkdir -p "$cfg_dir"; then step "roster init" roster -c "$CFG" init && done_stage || fail_stage; fi
else
    skip "no config folder"
fi
[[ -f "$CFG" ]] || (( DRY )) || CFG=""

# 6. Work from anywhere
stage 6
rc_files=()
for f in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do [[ -f $f ]] && rc_files+=("$f"); done
(( ${#rc_files[@]} )) || rc_files=("$HOME/.profile")
if [[ -z $CFG ]]; then
    skip "no roster.yml to point at"
elif ask "Make roster work from any directory (set ROSTER_CONFIG=$CFG in ${rc_files[*]/#$HOME/\~})?" Y; then
    line="export ROSTER_CONFIG=\"${CFG/#$HOME/\$HOME}\"   $MARK"
    path_line="export PATH=\"\$HOME/.local/bin:\$PATH\"   # roster: uv tools"
    for f in "${rc_files[@]}"; do
        if (( DRY )); then info "would add ROSTER_CONFIG to $f"; continue; fi
        # replace a line from an earlier run (or a hand-written one), else append
        if grep -q 'ROSTER_CONFIG=' "$f"; then
            tmp=$(mktemp) && grep -v 'ROSTER_CONFIG=' "$f" > "$tmp" && cat "$tmp" > "$f" && rm -f "$tmp"
        fi
        printf '\n%s\n' "$line" >> "$f"
        grep -q '\.local/bin' "$f" || printf '%s\n' "$path_line" >> "$f"
        ok "updated ${f/#$HOME/\~}"
    done
    export ROSTER_CONFIG="$CFG"
    info "open a new terminal (or: source ~/.bashrc) to pick it up here"
    done_stage
else
    export ROSTER_CONFIG="$CFG"
    skip "run roster from $cfg_dir, or pass -c $CFG"
fi

# 7. Unlock the vault
stage 7
if ! have bw; then
    skip "no Bitwarden CLI"
elif (( DRY )); then
    info "would run: bw login (if needed), bw sync, bw unlock > ${SESSION_FILE/#$HOME/\~}"; done_stage
else
    status=$(bw status --nointeraction 2>/dev/null | sed -n 's/.*"status":"\([a-z]*\)".*/\1/p')
    info "Bitwarden status: ${status:-unknown}"
    if [[ $status == unauthenticated ]]; then
        if (( YES )); then skip "bw login needs you - run: bw login"; status=""
        elif ask "Log in to Bitwarden now?" Y && live "bw login" bw login; then status=locked
        else skip "not logged in"; status=""; fi
    fi
    if [[ -n $status ]]; then
        if [[ -f $SESSION_FILE ]] && BW_SESSION=$(cat "$SESSION_FILE") bw unlock --check --nointeraction >/dev/null 2>&1; then
            ok "vault session in ${SESSION_FILE/#$HOME/\~} still works"
            done_stage
        elif (( YES )); then
            skip "unlocking needs your master password - run: (umask 077; bw unlock --raw > $SESSION_FILE)"
        elif ask "Unlock the vault and save the session for every roster run on this box (${SESSION_FILE/#$HOME/\~}, mode 600)?" Y; then
            mkdir -p "$(dirname "$SESSION_FILE")"
            info "Bitwarden asks for your master password:"
            if key=$(bw unlock --raw < "$TTY") && [[ -n $key ]]; then
                (umask 077; printf '%s' "$key" > "$SESSION_FILE"); unset key
                ok "vault unlocked, session saved"
                BW_SESSION=$(cat "$SESSION_FILE") step "bw sync" bw sync
                done_stage
            else
                bad "unlock failed"; fail_stage
            fi
        else
            skip "vault left locked - roster asks for the master password when it needs it"
        fi
    fi
fi

# 8. Set up this box
stage 8
if [[ -z $CFG ]] || ! have roster; then
    skip "needs roster and a roster.yml"
else
    [[ -f $SESSION_FILE ]] && export BW_SESSION="${BW_SESSION:-$(cat "$SESSION_FILE")}"
    cd "$(dirname "$CFG")" || exit 1
    if ask "Check that every vault reference in roster.yml can be found (roster auth-check)?" Y; then
        if (( DRY )); then info "would run: roster auth-check"
        else
            out=$(roster auth-check 2>&1)
            fails=$(grep -c '^  FAIL' <<<"$out")
            oks=$(grep -c '^  ok' <<<"$out")
            reasons=$(grep -A1 '^  FAIL' <<<"$out" | grep -v '^  FAIL\|^--' | sed 's/^ *//' | sort -u)
            if (( ! fails )); then ok "all $oks vault references found"
            elif [[ $(wc -l <<<"$reasons") -eq 1 ]]; then warn "$oks found, $fails missing: $reasons"
            else
                warn "$oks found, $fails missing:"
                grep -A1 '^  FAIL' <<<"$out" | grep -v '^--' | sed 's/^/    /'
            fi
        fi
    fi
    info "setup creates this box's SSH key, records host fingerprints, installs the key on key hosts"
    info "and writes ~/.ssh/config.d/roster and ROSTER.md. It logs in to each host once."
    if ask "Run roster setup now?" Y; then
        if (( DRY )); then step "roster setup --dry-run" roster setup --dry-run; done_stage
        else
            live "roster setup" roster setup && done_stage || fail_stage
        fi
    else
        skip "run it later: roster setup"
    fi
fi

# 9. Auto-update
stage 9
pull="$cfg_dir/bin/roster-pull"
job="*/15 * * * * $pull >> \$HOME/.cache/roster-pull.log 2>&1"
if [[ ! -x $pull ]] && (( ! DRY )); then
    skip "no bin/roster-pull in $cfg_dir"
elif ! have crontab; then
    skip "no crontab on this box - run $pull yourself to update"
elif crontab -l 2>/dev/null | grep -qF "$pull"; then
    ok "cron job already there"; done_stage
elif ask "Pull map updates every 15 minutes (cron job running bin/roster-pull)?" Y; then
    if (( DRY )); then info "would add to crontab: $job"; done_stage
    elif (crontab -l 2>/dev/null; echo "$job") | crontab -; then ok "cron job added"; done_stage
    else bad "couldn't write the crontab"; fail_stage; fi
else
    skip "update by hand: $pull"
fi

# ---- summary

printf '\n%sSummary%s\n' "$B" "$N"
for s in "${STAGES[@]}"; do
    if   [[ " ${FAILED[*]-} " == *" $s "* ]];  then bad "$s"
    elif [[ " ${SKIPPED[*]-} " == *" $s "* ]]; then printf '  %s%s %s (skipped)%s\n' "$D" "$SKIP" "$s" "$N"
    elif [[ " ${DONE[*]-} " == *" $s "* ]];    then ok "$s"
    else printf '  %s%s %s%s\n' "$D" "$SKIP" "$s" "$N"
    fi
done
printf '\n'
info "Next: open a new terminal, then try"
printf '    roster hosts                      %s# every host you can reach%s\n' "$D" "$N"
printf '    ssh <host>                        %s# key hosts%s\n' "$D" "$N"
printf '    roster run <host> -- hostname     %s# password-only hosts%s\n' "$D" "$N"
(( ${#FAILED[@]} )) && { info "Some stages failed - details in $LOG. Re-running this is safe."; exit 1; }
exit 0
