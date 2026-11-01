#!/usr/bin/env bash
# Serve Tachyon Cascade to the local network, detached so it keeps running after the shell exits.
# Port 8099 is open in this host's firewall; Tree Appreciator uses 8089.
#   ./run.sh          start (or restart) the server
#   ./run.sh stop     stop it
set -euo pipefail

cd "$(dirname "$0")"

host="${HOST:-0.0.0.0}"
port="${PORT:-8099}"
log_file="server.log"
pid_file="server.pid"

stop_server() {
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    # Only kill the pid if it is still our server, not a recycled pid of another process.
    if ps -p "$pid" -o args= | grep -q "node server.mjs"; then
      kill "$pid"
      # Wait up to 5 seconds for it to exit, so a restart does not find the port still in use.
      for _ in $(seq 50); do
        kill -0 "$pid" 2> /dev/null || break
        sleep 0.1
      done
      if kill -0 "$pid" 2> /dev/null; then
        # Keep the pid file, so a later ./run.sh stop can still find this server.
        echo "Server $pid did not stop within 5 seconds; try ./run.sh stop again" >&2
        exit 1
      fi
    fi
    rm -f "$pid_file"
  fi
}

if [[ "${1:-start}" == "stop" ]]; then
  stop_server
  echo "Stopped."
  exit 0
fi

stop_server
# Append, so the output of a server that failed to start stays next to the earlier runs' output.
echo "--- start $(date '+%Y-%m-%d %H:%M:%S') on ${host}:${port}" >> "$log_file"
HOST="$host" PORT="$port" setsid nohup node server.mjs >> "$log_file" 2>&1 < /dev/null &
echo "$!" > "$pid_file"
sleep 1
if ! kill -0 "$(cat "$pid_file")" 2> /dev/null; then
  echo "Server failed to start; see $log_file" >&2
  exit 1
fi
address="$host"
if [[ "$host" == "0.0.0.0" ]]; then
  address="$(hostname -I | cut -d' ' -f1)"
fi
echo "Tachyon Cascade running at http://${address}:${port} (log: $log_file, stop: ./run.sh stop)"
