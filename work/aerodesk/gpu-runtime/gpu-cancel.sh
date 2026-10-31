case_dir=$1
cd "$case_dir" || exit 0
pid=$(cat .aerodesk-process 2>/dev/null) || exit 0
case "$pid" in ''|*[!0-9]*) exit 0;; esac
if [ "$(readlink -f /proc/$pid/cwd)" = "$(pwd -P)" ]; then
  kill -TERM "$pid" 2>/dev/null || true
fi
