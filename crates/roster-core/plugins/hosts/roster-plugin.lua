-- The status bar's Host count ("1,284 Hosts"), a built-in feature written as a Plugin on the
-- public API (ticket 23): it proves a Plugin can do what the app does. It asks for
-- inventory.read like any Plugin would, and `:plugins` lists it and can revoke it.
return {
  name = "hosts",
  version = "1.0.0",
  description = "The status bar's Host count",
  author = "roster",
  api = 2,
  permissions = { "inventory.read" },
}
