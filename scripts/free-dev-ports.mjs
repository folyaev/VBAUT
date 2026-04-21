import { execSync } from "node:child_process";

function parsePorts(argv) {
  const parsed = argv
    .map((value) => Number.parseInt(String(value ?? "").trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 65535);
  if (parsed.length) return [...new Set(parsed)];
  return [8787, 5187];
}

function listListeningPidsWindows(port) {
  try {
    const psScript = [
      `$items = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
      "if ($items) { $items | Sort-Object -Unique | ForEach-Object { $_ } }"
    ].join("; ");
    const output = execSync(`powershell -NoProfile -Command "${psScript}"`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const pids = new Set(
      String(output)
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0)
    );
    if (pids.size) return [...pids];
  } catch {
    // fallback to netstat below
  }

  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8"
    });
    const pids = new Set();
    String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (!/\sLISTENING\s/i.test(line)) return;
        const parts = line.split(/\s+/);
        const pid = Number.parseInt(parts.at(-1) ?? "", 10);
        if (Number.isFinite(pid) && pid > 0) {
          pids.add(pid);
        }
      });
    return [...pids];
  } catch {
    return [];
  }
}

function listListeningPidsUnix(port) {
  const commands = [`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, `ss -ltnp "sport = :${port}"`];
  for (const command of commands) {
    try {
      const output = execSync(command, {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8"
      });
      const pids = new Set();
      String(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const directPid = Number.parseInt(line, 10);
          if (Number.isFinite(directPid) && directPid > 0) {
            pids.add(directPid);
            return;
          }
          const match = line.match(/pid=(\d+)/i);
          if (match) {
            const pid = Number.parseInt(match[1], 10);
            if (Number.isFinite(pid) && pid > 0) {
              pids.add(pid);
            }
          }
        });
      if (pids.size) return [...pids];
    } catch {
      // try next command
    }
  }
  return [];
}

function listListeningPids(port) {
  if (process.platform === "win32") {
    return listListeningPidsWindows(port);
  }
  return listListeningPidsUnix(port);
}

function killPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    return false;
  }
}

const ports = parsePorts(process.argv.slice(2));
const killed = [];

for (const port of ports) {
  const pids = listListeningPids(port);
  for (const pid of pids) {
    if (killPid(pid)) {
      killed.push({ port, pid });
    }
  }
}

if (killed.length) {
  const summary = killed.map((item) => `${item.pid}@${item.port}`).join(", ");
  console.log(`[free-dev-ports] killed: ${summary}`);
} else {
  console.log("[free-dev-ports] no listeners to kill");
}
