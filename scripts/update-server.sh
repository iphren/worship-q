#!/usr/bin/env bash
# Updates the church server to the latest commit and restarts it.
# Run on the server from anywhere inside the repository:  scripts/update-server.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
compose=(docker compose -f apps/server/compose.yaml)

git pull --ff-only
"${compose[@]}" up -d --build
docker image prune -f >/dev/null
# Every build leaves its steps in Docker's build cache, which nothing else clears. Keep a
# day's worth, so a second update the same day stays quick.
docker builder prune -f --filter until=24h >/dev/null

# Lays out /api/v1/info. Fields it does not know are shown too, by their shape: switches as
# ✓ or ✗, groups indented under their name, and byte counts under a "limits" key in MB.
# Arguments: the port, the deployed commit, then "color" when writing to a terminal.
format='
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk)).on("end", () => {
  const { name, protocolVersion, minProtocolVersion, ...rest } = JSON.parse(raw);
  const [port, commit, color] = process.argv.slice(1);
  const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const [bold, dim, green, red] = [paint(1), paint(2), paint(32), paint(31)];
  const words = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const value = (key, v, bytes) =>
    typeof v === "number" && bytes ? mb(v) : Array.isArray(v) ? v.join(", ") || "none" : String(v);

  const rows = [];
  const walk = (object, depth, bytes) => {
    const entries = Object.entries(object);
    const switches = entries.filter(([, v]) => typeof v === "boolean");
    if (switches.length) {
      rows.push([depth, null, switches
        .map(([k, v]) => (v ? `${green("✓")} ${words(k)}` : `${red("✗")} ${dim(words(k))}`))
        .join("   ")]);
    }
    const scalars = entries.filter(([, v]) => typeof v !== "boolean" && (v === null || typeof v !== "object" || Array.isArray(v)));
    if (scalars.length && bytes) {
      rows.push([depth, null, scalars.map(([k, v]) => `${words(k)} ${bold(value(k, v, true))}`).join(dim("  ·  "))]);
    } else {
      for (const [k, v] of scalars) rows.push([depth, words(k), value(k, v, false)]);
    }
    for (const [k, v] of entries) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // A blank line sets each top-level group apart from what comes before it.
        if (depth === 0 && rows.length) rows.push(null);
        rows.push([depth, words(k), ""]);
        walk(v, depth + 1, /limit|size|bytes/i.test(k));
      }
    }
  };
  walk(rest, 0, false);

  console.log("");
  console.log(`${green("●")} ${bold(name ?? "Server")} is up on port ${port}`);
  console.log(`  ${dim("commit")}    ${commit}`);
  if (protocolVersion !== undefined) {
    console.log("");
    console.log(`  ${dim("protocol")}  ${protocolVersion}${minProtocolVersion !== undefined ? dim(` (accepts apps from ${minProtocolVersion})`) : ""}`);
  }
  console.log("");
  for (const row of rows) {
    if (row === null) {
      console.log("");
      continue;
    }
    const [depth, label, text] = row;
    const indent = "  ".repeat(depth + 1);
    console.log(label === null ? `${indent}${text}` : `${indent}${dim(label)}${text ? `  ${text}` : ""}`);
  }
});
'

# Asked here, not inside the $(...) below, where standard output is always a pipe.
color=$([ -t 1 ] && echo color || true)

port=$(sed -n 's/^WORSHIP_Q_PORT=//p' apps/server/.env 2>/dev/null || true)
for _ in $(seq 30); do
  if info=$(curl -fsS "http://127.0.0.1:${port:-8080}/api/v1/info" 2>/dev/null); then
    # The host may have neither jq nor Python, so the server's own Node lays the answer out.
    # If that fails for any reason, the raw answer is still shown.
    summary=$(printf '%s' "$info" | "${compose[@]}" exec -T worship-q node -e "$format" \
      "${port:-8080}" "$(git log -1 --format='%h %s')" "$color" 2>/dev/null) || summary="Server is up: $info"
    echo "$summary"
    exit 0
  fi
  sleep 1
done
echo "Server did not answer within 30 seconds. Recent logs:" >&2
"${compose[@]}" logs --tail 50 worship-q >&2
exit 1
