# Sessions run the system `ssh`, with passwords sent through SSH_ASKPASS

Each terminal Session runs the system `ssh` client in a PTY, on the active Backend (natively, or inside WSL through `wsl.exe`). For Hosts that only take a password, `ssh` gets the password from an askpass helper that asks `roster serve` for it, so the secret goes straight from roster to ssh and never through the UI. This reuses what `roster setup` already writes (ssh config, known_hosts, the box's key) and supports jump hosts, agents and every ssh option without extra work. A Session behaves exactly like `ssh HOST` in a plain terminal.

## Considered Options

- **An SSH library in the process (paramiko, or russh in Rust)**: it would mean redoing ssh config parsing, host-key checking and agent support, and Sessions would behave differently from the CLI.
