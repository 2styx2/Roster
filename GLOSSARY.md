# Roster

Roster is the team's shared map of the network: which hosts exist, how to reach them, and which vault login opens each one.

## Language

**Inventory**:
The team's one list of hosts and resources, kept in `roster.yml` in the infra repo.
_Avoid_: config, host list, map file

**Host**:
A machine or device recorded in the Inventory, saved with its address, type, services and logins.
_Avoid_: session (SecureCRT's word for this), server, node

**Box**:
A machine that runs roster and connects to Hosts from there, such as a laptop, a jump host or a Claude box.
_Avoid_: client, workstation

**Session**:
One live terminal connection from a Box to a Host. A Host can have several Sessions open at once.
_Avoid_: connection profile, saved session

**Login**:
A pointer from a Host, or one of its services, to the vault item that opens it. A Login never contains the password itself.
_Avoid_: credential, account (an account is a kind of resource)

**Vault item**:
One entry in the team's password manager, named `<host> <what it opens>`.
_Avoid_: secret, entry, password

**Quick Connect**:
Opening a Session to an address that isn't a Host in the Inventory yet. If you choose to save it, it becomes a Host with its own Vault item.
_Avoid_: ad-hoc session, direct connect

**Pending change**:
An edit to the Inventory made on this Box that hasn't been Published yet.
_Avoid_: draft, unsaved edit

**Publish**:
Committing the Pending changes and pushing them to the infra repo, so every Box picks them up.
_Avoid_: save, sync (sync means rewriting a Box's ssh config from the Inventory)
