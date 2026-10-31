source /usr/lib/openfoam/openfoam2512/etc/bashrc
export PETSC_DIR=/opt/aerodesk/petsc
export PETSC_ARCH=arch-cuda
export LD_LIBRARY_PATH=/usr/lib/wsl/lib:/opt/aerodesk/petsc/arch-cuda/lib:$LD_LIBRARY_PATH
export PETSC_OPTIONS='-use_gpu_aware_mpi 0 -log_view :log.petsc'
export OMP_NUM_THREADS=1
