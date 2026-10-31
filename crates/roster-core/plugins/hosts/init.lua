local roster = require("roster")

-- Without inventory.read (revoked in :plugins) there's nothing to count: show nothing.
if not roster.inventory then return end

-- 1284 → "1,284", as the app writes counts.
local function grouped(n)
  local s = tostring(n)
  while true do
    local done
    s, done = s:gsub("^(-?%d+)(%d%d%d)", "%1,%2")
    if done == 0 then return s end
  end
end

local function show()
  local n = #roster.inventory.hosts()
  roster.status.set("hosts", { text = grouped(n) .. (n == 1 and " Host" or " Hosts") })
end

show()
roster.on("inventory_changed", show)
