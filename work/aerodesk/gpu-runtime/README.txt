GPU runtime layout expected by the launch/probe helpers
This is a reference configuration, not an automatic installer.
WSL2 distro: Ubuntu-24.04
OpenFOAM.com 2512: /usr/lib/openfoam/openfoam2512
PETSc v3.24.1: /opt/aerodesk/petsc, PETSC_ARCH=arch-cuda
Adapter: /opt/aerodesk/petsc4foam (PETSc upstream repository)
CUDA 12.0 toolkit from Ubuntu; WSL uses the Windows NVIDIA driver.
CUDA prefix: /opt/aerodesk/cuda (bin/include/lib64 links to Debian paths)
Build: gcc/g++12 via OMPI_CC/OMPI_CXX; OpenMPI; libblas/liblapack.
Example PETSc configure for a compatible compute-capability 8.9 GPU:
Set --with-cuda-arch to the target GPU's supported architecture.
 ./configure PETSC_ARCH=arch-cuda --with-cc=mpicc --with-cxx=mpicxx
 --with-fc=0 --with-debugging=0 --with-cuda=1
 --with-cuda-dir=/opt/aerodesk/cuda --with-cuda-arch=89
 --download-amgx=0 --with-x=0 --with-make-np=4
 make PETSC_DIR=/opt/aerodesk/petsc PETSC_ARCH=arch-cuda -j4 all
Adapter: source OpenFOAM bashrc, export PETSC_DIR/PETSC_ARCH; ./Allwmake -j4
Runtime scripts live under /opt/aerodesk. gpu-verified.json records the
same-mesh CPU/GPU comparison. Do not mark another PC ready without testing.
Uses PETSc CG + GAMG with CUDA matrix operations and Jacobi level smoothing.
AMGX was investigated but is not used. This is partial GPU acceleration.
CPU runtime does not depend on WSL. GPU native cases: user home/AeroDeskGPU/cases.
GPU display in Electron is separate from GPU CFD.
Sources: https://gitlab.com/petsc/petsc4foam
https://petsc.org/release/manual/ksp/
