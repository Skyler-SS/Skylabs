source /opt/aerodesk/gpu-env.sh
test -f /opt/aerodesk/gpu-verified.json || exit 2
test -f "$FOAM_USER_LIBBIN/libpetscFoam.so" || exit 3
/usr/lib/wsl/lib/nvidia-smi --query-gpu=name --format=csv,noheader
