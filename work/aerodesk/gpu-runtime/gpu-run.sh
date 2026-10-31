source /opt/aerodesk/gpu-env.sh
case_dir=$1
shift
cd "$case_dir" || exit 2
test ! -f .aerodesk-cancel || exit 130
"$@" &
solver_pid=$!
printf '%s\n' "$solver_pid" > .aerodesk-process
if [ -f .aerodesk-cancel ]; then kill -TERM "$solver_pid" 2>/dev/null; fi
wait "$solver_pid"
solver_status=$?
rm -f .aerodesk-process
exit "$solver_status"
