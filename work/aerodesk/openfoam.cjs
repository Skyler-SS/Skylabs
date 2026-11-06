const gpu=require('./gpu.cjs');
const {environment,groundPlan,sameEnvironment}=require('./environment.cjs');
const {readGroundCheck}=require('./ground-check.cjs');
const quality=require('./quality.cjs');
const {readFlowBalance}=require('./flow-balance.cjs');
const {mpiExecutable,chooseWorkers,calibrationRate,executionSpec}=require('./compute.cjs');
const {readResidualLine,forceConvergence,divergenceVerdict}=require('./solver-diagnostics.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {readSurfaceLoads}=require('./surface-loads.cjs');
const exists=p=>fs.access(p).then(()=>true,()=>false);
// Generous: a bluff body or a yawed vehicle can exceed 2, but nothing physical
// approaches 1000. Only a diverged solve gets near this.
const COEFFICIENT_LIMIT=1000;
const header=(object,klass='dictionary')=>`FoamFile { version 2.0; format ascii; class ${klass}; object ${object}; }\n`;
function hardware(){const cpus=os.cpus();return {cpu:cpus[0]?.model||'Unknown CPU',logicalCores:cpus.length,memoryGB:Math.round(os.totalmem()/2**30),freeGB:os.freemem()/2**30,solverCores:chooseWorkers(),mpiAvailable:!!mpiExecutable()};}
// MS-MPI being installed says nothing about whether the MPI-LINKED OpenFOAM build
// exists. Reporting mpiAvailable from mpiexec alone let the app offer, accept and
// mesh a multi-core run, then fail at the decomposePar step with the whole mesh
// already paid for. Both halves have to be present before parallel is offered.
async function parallelRuntime(rt){
  try{
    const r=rt||await runtime();
    if(!r.mpi)return {ready:false,reason:'Microsoft MPI is not installed. Install Microsoft MPI to solve on more than one core.'};
    if(!r.parallel)return {ready:false,reason:'This OpenFOAM build has no MPI-enabled Pstream in '+r.bin
      +' (expected libPstream.dll matching libPstream.dll-msmpi, plus decomposePar.exe). Single-core solving is unaffected.'};
    return {ready:true,reason:null};
  }catch(e){return {ready:false,reason:e.message};}
}

async function availableHardware(s){const hw=hardware();
  const par=await parallelRuntime();
  hw.parallelRuntime=par;hw.mpiAvailable=par.ready;
  if(s.computeBackend!=='gpu')return hw;const g=await gpu.memoryInfo();return {...hw,memoryGB:Math.min(hw.memoryGB,g.memoryGB),freeGB:Math.min(hw.freeGB,g.freeGB),vramGB:g.vramGB};}
// Resolve the platform build directory by looking, rather than by hardcoding one
// name. Official OpenFOAM.com builds use win64MingwDPInt32Opt, but the precision and
// label vary between distributions (…DPInt64Opt, …SPDPInt32Opt, a debug build), and a
// fixed string makes every other layout invisible.
async function platformBin(root){
  const base=path.join(root,'platforms');
  let entries=[];
  try{entries=await fs.readdir(base);}catch{return null;}
  // Prefer an optimised double-precision build when several are installed.
  const rank=name=>(/DPInt32Opt$/.test(name)?0:/Opt$/.test(name)?1:2);
  for(const name of entries.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b))){
    const bin=path.join(base,name,'bin');
    if(await exists(path.join(bin,'simpleFoam.exe')))return bin;
  }
  return null;
}

// A distribution root (D:/CFD/OpenFOAM-v2512) and a build root (…/OpenFOAM-v2512 inside
// msys64) are both things people reasonably set AERODESK_OPENFOAM_ROOT to - the docs
// have shown one while the code required the other. Accept either.
async function buildRoots(root){
  const out=[root];
  const nested=path.join(root,'msys64/home/ofuser/OpenFOAM');
  try{
    for(const name of await fs.readdir(nested))
      if(/^OpenFOAM-/.test(name))out.push(path.join(nested,name));
  }catch{}
  return out;
}

// Parallel capability comes from the standard bin, not a separate directory. Official
// Windows builds ship libPstream.dll alongside libPstream.dll-msmpi and -dummy, and
// make one of them active by copying it over libPstream.dll. Matching sizes means the
// MPI variant is the live one; the -dummy variant is markedly smaller.
async function parallelCapable(bin){
  if(!await exists(path.join(bin,'decomposePar.exe')))return false;
  const live=path.join(bin,'libPstream.dll'),msmpi=live+'-msmpi';
  if(!await exists(live)||!await exists(msmpi))return false;
  try{
    const [a,b]=await Promise.all([fs.stat(live),fs.stat(msmpi)]);
    return a.size===b.size;
  }catch{return false;}
}

// 0/k and 0/nut are written before meshing, but whether their wall treatment is valid
// is only knowable after the layers are built. This rewrites just the model patch of
// those two fields in place, leaving every other boundary untouched.
async function applyWallTreatment(folder,mode,{k,roughness}){
 const patch=(text,replacement)=>{
  const match=/model \{[^}]*\}/.exec(text);
  if(!match)throw Error('Could not locate the model patch while setting the wall treatment.');
  return text.slice(0,match.index)+'model {'+replacement+'}'+text.slice(match.index+match[0].length);
 };
 const kPath=path.join(folder,'0/k'),nutPath=path.join(folder,'0/nut');
 const resolved=mode==='resolved';
 await fs.writeFile(kPath,patch(await fs.readFile(kPath,'utf8'),
  resolved?'type fixedValue;value uniform 0;':`type kqRWallFunction;value uniform ${k};`));
 // A roughness model is its own wall function and is never overridden here.
 if(!(roughness>0))await fs.writeFile(nutPath,patch(await fs.readFile(nutPath,'utf8'),
  resolved?'type nutLowReWallFunction;value uniform 0;':'type nutkWallFunction;value uniform 0;'));
}

async function runtime(){
  const legacy='OpenFOAM-runtime/msys64/home/ofuser/OpenFOAM/OpenFOAM-v2512';
  const candidates=[process.env.AERODESK_OPENFOAM_ROOT,
    path.resolve(__dirname,'../../outputs',legacy),
    path.resolve(path.dirname(process.execPath),'../../',legacy),
    path.resolve(path.dirname(process.execPath),'../',legacy)];
  for(const candidate of candidates.filter(Boolean)){
    for(const root of await buildRoots(candidate)){
      const bin=await platformBin(root);
      if(!bin)continue;
      return {root,bin,mpi:mpiExecutable(),parallel:await parallelCapable(bin),
        env:{...process.env,WM_PROJECT_DIR:root,WM_PROJECT_VERSION:'v2512',
          FOAM_ETC:path.join(root,'etc'),PATH:bin+';'+process.env.PATH}};
    }
  }
  throw Error('OpenFOAM runtime is missing. Set AERODESK_OPENFOAM_ROOT to an OpenFOAM installation, or keep the OpenFOAM-runtime folder beside the SkyLabs version folder.');
}
function validate(s,vertices){
  quality.qualityMode(s);environment(s);
  chooseWorkers(s.cpuWorkers??'auto');if(s.computeBackend!==undefined&&!['cpu','gpu'].includes(s.computeBackend))throw Error('Invalid compute backend.');
  if(s.turbulenceRatio!==undefined&&(!Number.isFinite(s.turbulenceRatio)||s.turbulenceRatio<.001||s.turbulenceRatio>10000))throw Error('Turbulent viscosity ratio must be between 0.001 and 10000.');
  if(s.roughness!==undefined&&(!Number.isFinite(s.roughness)||s.roughness<0||s.roughness>Math.min(.1,s.length*.01)))throw Error('Invalid sand-grain roughness; maximum is 1% of model length and 0.1 m.');
  if(s.minutes!==undefined&&!Number.isFinite(s.minutes))throw Error('Invalid legacy time setting.');
  for(const [key,min,max] of [['length',.001,1000],['speed',.1,100],['density',.01,2000],['nu',1e-8,.1],['referenceArea',1e-8,1e8],['intensity',.00001,.2]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(`${key} must be between ${min} and ${max}.`);
  if(!vertices||vertices.length<36||vertices.length%9||vertices.length>1800000)throw Error('Invalid triangle model.');
  for(const v of vertices)if(!Number.isFinite(v)||Math.abs(v)>2)throw Error('Model coordinates must be normalized before solving.');
}
function plan(s,vertices,hw=hardware(),calibration=null){
  validate(s,vertices);const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i++){const a=i%3;bounds[a]=Math.min(bounds[a],vertices[i]);bounds[a+3]=Math.max(bounds[a+3],vertices[i]);}
  const thin=Math.min(...bounds.slice(0,3).map((v,i)=>bounds[i+3]-v));
  // Hardware predicts duration and resource feasibility, never a lower accuracy
  // level or a wall-clock stop. Legacy minutes are intentionally not a budget.
  const workers=s.computeBackend==='gpu'?1:chooseWorkers(s.cpuWorkers??'auto',hw.logicalCores,Infinity,hw.mpiAvailable??false);
  // Surface a missing parallel runtime now, while nothing has been computed, rather
  // than after meshing. An explicit >1 request is an error; 'auto' already clamped.
  if(s.computeBackend!=='gpu'&&Number(s.cpuWorkers)>1&&hw.parallelRuntime&&!hw.parallelRuntime.ready)
    throw Error('Multi-core solving is unavailable: '+hw.parallelRuntime.reason
      +' Choose 1 CPU worker, or Auto, to solve on a single core.');
  const rate=(s.computeBackend==='gpu'?calibration?.gpu?.cellIterationsPerSecond:calibrationRate(calibration,workers))||300000;
  const stages=quality.qualityStages(s).map(p=>({...p,wall:quality.wallPlan(s,p)})),last=stages.at(-1),memoryGB=1.5+last.maxCells*3000/1e9;
  if(memoryGB>hw.freeGB*.85)throw Error(last.label+' needs about '+memoryGB.toFixed(1)+' GB free for meshing/solving. Close other apps or select a lower quality; resolution will not be silently reduced.');
  if(s.computeBackend==='gpu'&&Number.isFinite(hw.vramGB)&&last.maxCells*1800/1e9+1>hw.vramGB*.85)throw Error(last.label+' needs more free GPU memory. Close GPU-heavy apps or use CPU solving.');
  const work=stages.reduce((n,p)=>n+p.maxCells*.65*Math.max(p.minIterations*2,1500),0),estimatedSeconds=work/rate;
  return {...last,stages,workers,bounds,thin,hw,rate,memoryGB,estimatedSeconds,estimated:true,warning:'Runtime is an estimate, not a cutoff. '+(thin<3*.25/2**(last.level+1)?'Thin geometry may remain under-resolved; inspect wall and mesh checks. ':'')};
}
async function createCase(folder,vertices,s,p){
  validate(s,vertices);await fs.mkdir(path.join(folder,'constant/triSurface'),{recursive:true});await fs.mkdir(path.join(folder,'system'));await fs.mkdir(path.join(folder,'0'));
  const write=(name,body)=>fs.writeFile(path.join(folder,name),body);
  const wall=p.wall||quality.wallPlan(s,{...quality.qualityStages(s).at(-1),...p,wallScale:1}),L=s.length,U=s.speed,k=1.5*(U*s.intensity)**2,omega=k/(s.nu*(s.turbulenceRatio??10)),vec=a=>'('+a.map(v=>Number(v.toPrecision(10))).join(' ')+')';
  await write('constant/triSurface/model.stl',require('./case-surface.cjs').writeSurface(vertices,L));
  const ground=groundPlan(s,p.bounds,p),floorY=ground?.y??-8;
  const points=[[-8,-8,-8],[16,-8,-8],[16,8,-8],[-8,8,-8],[-8,-8,8],[16,-8,8],[16,8,8],[-8,8,8]];
  if(ground)for(const i of [0,1,4,5])points[i][1]=floorY;
  await write('system/blockMeshDict',header('blockMeshDict')+`scale ${L}; vertices (${points.map(vec).join(' ')}); blocks (hex (0 1 2 3 4 5 6 7) (44 ${ground?.yCells??32} 32) simpleGrading (((7 12 .1)(2 8 1)(15 24 10)) ${ground?.yGrading??'((7 12 .1)(2 8 1)(7 12 10))'} ((7 12 .1)(2 8 1)(7 12 10)))); edges (); boundary (inlet {type patch;faces ((0 4 7 3));} outlet {type patch;faces ((1 2 6 5));} ${ground?'ground {type wall;faces ((0 1 5 4));} ':''}farfield {type symmetry;faces (${ground?'':'(0 1 5 4) '}(3 7 6 2) (0 3 2 1) (4 5 6 7));}); mergePatchPairs ();`);
  await write('system/surfaceFeatureExtractDict',header('surfaceFeatureExtractDict')+'model.stl {extractionMethod extractFromSurface; extractFromSurfaceCoeffs {includedAngle 150;} writeObj no;}');
  await write('system/meshQualityDict',header('meshQualityDict')+'#includeEtc "caseDicts/meshQualityDict"\nminFaceWeight 0.02;maxBoundarySkewness 4;minVol '+(1e-13*L**3)+';');
  await write('system/snappyHexMeshDict',header('snappyHexMeshDict')+`castellatedMesh true; snap true; addLayers true;
geometry {${ground?`groundGap {type box;min ${vec([(p.bounds[0]-.3)*L,floorY*L,(p.bounds[2]-.3)*L])};max ${vec([(p.bounds[3]+.3)*L,(p.bounds[1]+.15)*L,(p.bounds[5]+.3)*L])};}`:''}model.stl {type triSurfaceMesh; name model;} nearBody {type box;min ${vec(p.bounds.slice(0,3).map(x=>(x-.3)*L))};max ${vec(p.bounds.slice(3).map(x=>(x+.3)*L))};} wake {type box;min ${vec([0,p.bounds[1]-.2,p.bounds[2]-.2].map(x=>x*L))};max ${vec([4,p.bounds[4]+.2,p.bounds[5]+.2].map(x=>x*L))};}}
castellatedMeshControls {maxLocalCells ${p.maxCells};maxGlobalCells ${p.maxCells}; minRefinementCells 0;maxLoadUnbalance 0.1;nCellsBetweenLevels 3;features ({file "model.eMesh";level ${p.level};});refinementSurfaces {model {level (${p.level} ${p.level+1});patchInfo {type wall;}}} resolveFeatureAngle 30;refinementRegions {${ground?`groundGap {mode inside;levels ((1e15 ${ground.gapLevel}));}`:''}nearBody {mode inside;levels ((1e15 ${p.volumeLevel??Math.max(1,p.level-1)}));} wake {mode inside;levels ((1e15 1));}}locationInMesh ${vec([-2.875,Math.max(.125,floorY+.25),.125].map(x=>x*L))};allowFreeStandingZoneFaces true;}
snapControls {nSmoothPatch 3;tolerance 2;nSolveIter 30;nRelaxIter 5;nFeatureSnapIter 10;implicitFeatureSnap false;explicitFeatureSnap true;multiRegionFeatureSnap false;}
addLayersControls {relativeSizes false;layers {"model.*" {nSurfaceLayers ${wall.layers};}${ground?`ground {nSurfaceLayers ${wall.layers};}`:''}} expansionRatio ${wall.growth};firstLayerThickness ${wall.firstThickness};minThickness ${wall.firstThickness*.25};nGrow 0;featureAngle 60;slipFeatureAngle 30;nRelaxIter 3;nSmoothSurfaceNormals 1;nSmoothNormals 3;nSmoothThickness 10;maxFaceThicknessRatio .5;maxThicknessToMedialRatio .3;minMedialAxisAngle 90;nBufferCellsNoExtrude 0;nLayerIter 80;}
meshQualityControls {#include "meshQualityDict"
nSmoothScale 4;errorReduction .75;} writeFlags (scalarLevels layerSets layerFields);mergeTolerance 1e-9;`);
  await write('constant/transportProperties',header('transportProperties')+`transportModel Newtonian;nu [0 2 -1 0 0 0 0] ${s.nu};`);
  await write('constant/turbulenceProperties',header('turbulenceProperties')+'simulationType RAS; RAS {RASModel kOmegaSST;turbulence on;printCoeffs on;}');
  const groundFields={U:`type fixedValue;value uniform (${ground?.wallSpeed??0} 0 0);`,p:'type zeroGradient;',k:'type fixedValue;value uniform 0;',omega:`type omegaWallFunction;value uniform ${omega};`,nut:'type nutLowReWallFunction;value uniform 0;'};
  const field=async(name,dimensions,value,model,inlet,outlet,vector=false)=>write('0/'+name,header(name,vector?'volVectorField':'volScalarField')+`dimensions [${dimensions}];internalField uniform ${value};boundaryField {inlet {${inlet}} outlet {${outlet}} farfield {type symmetry;} model {${model}} ${ground?`ground {${groundFields[name]}}`:''}}`);
  await field('U','0 1 -1 0 0 0 0',`(${U} 0 0)`,'type noSlip;',`type fixedValue;value uniform (${U} 0 0);`,`type inletOutlet;inletValue uniform (${U} 0 0);value uniform (${U} 0 0);`,true);
  await field('p','0 2 -2 0 0 0 0',0,'type zeroGradient;','type zeroGradient;','type fixedValue;value uniform 0;');
  await field('k','0 2 -2 0 0 0 0',k,wall.resolved?'type fixedValue;value uniform 0;':`type kqRWallFunction;value uniform ${k};`,`type fixedValue;value uniform ${k};`,`type inletOutlet;inletValue uniform ${k};value uniform ${k};`);
  await field('omega','0 0 -1 0 0 0 0',omega,`type omegaWallFunction;value uniform ${omega};`,`type fixedValue;value uniform ${omega};`,`type inletOutlet;inletValue uniform ${omega};value uniform ${omega};`);
  await field('nut','0 2 -1 0 0 0 0',0,s.roughness>0?`type nutkRoughWallFunction;Ks uniform ${s.roughness};Cs uniform 0.5;value uniform 0;`:wall.resolved?'type nutLowReWallFunction;value uniform 0;':'type nutkWallFunction;value uniform 0;','type calculated;value uniform 0;','type calculated;value uniform 0;');
  const accuracyNumerics=p.numerics==='accuracy';
  // The recovery attempt trades accuracy for a solve that completes: first-order
  // upwind convection is strongly damping and will converge where linearUpwind will
  // not. Results from it are labelled indicative.
  const convection=p.firstOrder?'upwind':`${accuracyNumerics?'linearUpwind':'linearUpwindV'} grad(U)`;
  await write('system/fvSchemes',header('fvSchemes')+`ddtSchemes {default steadyState;} gradSchemes {default Gauss linear;${accuracyNumerics?'':'grad(U) cellLimited Gauss linear 1;'}} divSchemes {default none;div(phi,U) bounded Gauss ${convection};div(phi,k) bounded Gauss upwind;div(phi,omega) bounded Gauss upwind;div((nuEff*dev2(T(grad(U))))) Gauss linear;} laplacianSchemes {default Gauss linear corrected;}interpolationSchemes {default linear;}snGradSchemes {default corrected;}wallDist {method meshWave;}`);
  // smoothSolver/symGaussSeidel only converges on a diagonally dominant matrix. When
  // nut is corrupted by a diverging turbulence field that assumption fails, and the
  // observed symptom is a momentum solve whose residual GROWS (0.60 -> 8.09) after
  // running its full 1000 sweeps. PBiCGStab with DILU is robust to that, and maxIter
  // stops a bad solve from burning a thousand sweeps per outer iteration.
  const relax=p.relaxation||{p:.3,U:.7,k:.5,omega:.5};
  await write('system/fvSolution',header('fvSolution')+`solvers {p {${s.computeBackend==='gpu'?gpu.pressureSolver():'solver GAMG;tolerance 1e-7;relTol .05;smoother GaussSeidel;maxIter 50;'}} "(U|k|omega)" {solver PBiCGStab;preconditioner DILU;tolerance 1e-8;relTol .1;maxIter 100;}} SIMPLE {nNonOrthogonalCorrectors 2;consistent no;residualControl {}} relaxationFactors {fields {p ${relax.p};} equations {U ${relax.U};k ${relax.k};omega ${relax.omega};}}`);
  const control=header('controlDict')+(s.computeBackend==='gpu'?'libs (\"libpetscFoam.so\");\n':'')+`application simpleFoam;startFrom startTime;startTime 0;stopAt endTime;endTime ${p.iterations};deltaT 1;writeControl timeStep;writeInterval 250;purgeWrite 2;writeFormat ascii;writePrecision 12;writeCompression off;timeFormat general;timePrecision 8;runTimeModifiable true;
functions {wallShearStress {type wallShearStress;libs (fieldFunctionObjects);patches (${ground?'model ground':'model'});writeControl writeTime;} coefficients {type forceCoeffs;libs (forces);writeControl timeStep;writeInterval 1;log yes;patches (model);rho rhoInf;rhoInf ${s.density};CofR (0 0 0);liftDir (0 1 0);dragDir (1 0 0);pitchAxis (0 0 1);magUInf ${U};lRef ${L};Aref ${s.referenceArea};} yPlus {type yPlus;libs (fieldFunctionObjects);writeControl writeTime;log true;}}
`;
  // A guard rail, not a substitute for the right wall treatment. These cap the two
  // quantities through which a turbulence excursion actually destroys the momentum
  // equation: the eddy viscosity it feeds, and the velocity that results.
  //
  // limitTurbulenceViscosity takes c, a multiple of the LAMINAR viscosity (default
  // 1e5), so nut cannot exceed c*nu however badly k and omega behave. A healthy
  // external-aero run sits orders of magnitude below this.
  //
  // Note for future edits: `limitFields` is NOT a valid fvOption type in v2512 - the
  // solver rejects the case outright at startup. The available limiters are
  // limitTemperature, limitTurbulenceViscosity and limitVelocity.
  await write('system/fvOptions',header('fvOptions')
    +`limitNut {type limitTurbulenceViscosity;active yes;selectionMode all;nut nut;c 1e5;}`
    +`limitU {type limitVelocity;active yes;selectionMode all;max ${U*10};}`);
  await write('system/controlDict',control);await write('SkyLabs.foam','');
  // A dense, geometry-focused display grid. The native case retains the full solver mesh.
  const grid=displayGrid(p.bounds);
  await writeViewerSampling(folder,grid,L);
  await write('system/bodySurface',header('bodySurface')+'type surfaces;libs (sampling);surfaceFormat vtk;formatOptions {vtk {format ascii;legacy true;}} fields (p wallShearStress yPlus);interpolationScheme cell;surfaces (body {type patch;patches (model);interpolate false;triangulate false;} '+(ground?'ground {type patch;patches (ground);interpolate false;triangulate false;}':'')+');');
  await write('system/layerSurface',header('layerSurface')+'type surfaces;libs (sampling);surfaceFormat vtk;formatOptions {vtk {format ascii;legacy true;}} fields (nSurfaceLayers);interpolationScheme cell;surfaces (body {type patch;patches (model);interpolate false;triangulate false;});');
  await write('study.json',JSON.stringify({settings:s,plan:p,grid},null,2));return {grid,control};
}
class Job {
  constructor(folder,notify=()=>{}){this.folder=folder;this.notify=notify;this.cancelled=false;this.child=null;this.tail='';this.iteration=0;this.residual=1;this.residuals={};this.diverged=null;this.bounding={};}
  cancel(){this.cancelled=true;if(this.child&&this.rt?.gpu){gpu.cancel(this.folder).catch(()=>this.child?.kill());return;}if(this.child){if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(this.child.pid),'/T','/F'],{windowsHide:true}).on('error',()=>this.child?.kill());else this.child.kill();}}
  async command(rt,name,args=[],logName=name,workers=1){
    if(this.cancelled)throw Error('Simulation stopped.');this.rt=rt;this.stage=name;this.notify({stage:name,workers,iteration:this.iteration,residual:this.residual});
    const log=await fs.open(path.join(this.folder,`log.${logName}`),'w');let output='';
    try{return await new Promise((resolve,reject)=>{
      const spec=rt.gpu?gpu.executionSpec(this.folder,name,args):executionSpec(rt,name,args,workers);const child=spawn(spec.executable,spec.args,{cwd:this.folder,env:rt.env,windowsHide:true,shell:false});this.child=child;let pending='';let last=0;
      const read=chunk=>{const text=chunk.toString();log.write(text).catch(()=>{});output=(output+text).slice(-300000);this.tail=output.slice(-6000);pending+=text;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){if(name==='simpleFoam')readResidualLine(this,line);}if(Date.now()-last>700){this.notify({stage:name,workers,iteration:this.iteration,residual:this.residual,line:lines.filter(l=>l.trim()).at(-1)||''});last=Date.now();}};
      child.stdout.on('data',read);child.stderr.on('data',read);child.on('error',reject);child.on('close',code=>{this.child=null;if(this.cancelled)reject(Error('Simulation stopped.'));else if(code!==0)reject(Error(`${name} failed (${code}). ${output.slice(-2000)}`));else resolve(output);});
    });}finally{await log.close();}
  }
  async run(vertices,s,calibration){
    s={...s,qualityMode:quality.qualityMode(s),reynolds:s.speed*s.length/s.nu};
    const root=this.folder,started=Date.now(),rt=await (s.computeBackend==='gpu'?gpu.runtime():runtime()),p=plan(s,vertices,await availableHardware(s),calibration),results=[];
    await fs.mkdir(root,{recursive:true});this.notify({stage:'Preparing '+p.label+' quality',plan:p});
    for(const stage of p.stages){
      this.folder=p.stages.length===1?root:path.join(root,'mesh-'+(stage.index+1));this.iteration=0;this.residuals={};this.residualHistory=[];this.residualIteration=undefined;this.residual=1;
      this.notify({stage:'Mesh '+(stage.index+1)+' / '+p.stages.length+' · '+p.label,meshIndex:stage.index,meshCount:p.stages.length,plan:p});
      let result;try{result=await this.attemptSolve(vertices,s,{...p,...stage,stages:undefined},rt);}catch(e){if(!results.length)throw e;const last=results.at(-1);last.reliability={...last.reliability,status:'needs-review',acceptable:false,blocking:[...last.reliability.blocking,'Mesh study incomplete: '+e.message]};last.meshStudyIncomplete=true;last.meshStudyError=e.message;last.studyFolder=root;last.elapsed=(Date.now()-started)/1000;await this.writeSummary(last);return last;}
      results.push(result);const comparison=p.stages.length>1?quality.compareMeshes(results,s):null;
      result.reliability=quality.qualityEvidence(result,s,stage.wall,result.layerCoverage,comparison);result.studyFolder=root;result.meshStudy=results.map(r=>({folder:r.folder,cells:r.cells,iteration:r.iteration,converged:r.converged,forceConvergence:r.forceConvergence,force:r.liftCenter?.force,moment:r.liftCenter?.moment,layers:r.layerCoverage}));result.elapsed=(Date.now()-started)/1000;
      await this.writeSummary(result);await fs.writeFile(path.join(root,'mesh-study.json'),JSON.stringify({settings:s,complete:results.length===p.stages.length,results:result.meshStudy,comparison},null,2));
    }
    return results.at(-1);
  }
  async writeSummary(result){await fs.writeFile(path.join(result.folder,'result-summary.json'),JSON.stringify({...result,ux:undefined,uy:undefined,uz:undefined,pressure:undefined,solid:undefined,q:undefined,tke:undefined,vorticity:undefined,liftCenter:{...result.liftCenter,panels:undefined,points:undefined,polygons:undefined}},null,2));}
  // One recovery attempt, and only one. A diverged solve is usually the wall treatment
  // disagreeing with the mesh, so the retry forces wall functions and switches to
  // first-order convection with heavier under-relaxation: strongly damped, certain to
  // be more diffusive, but it completes. The result says so plainly.
  async attemptSolve(vertices,s,p,rt){
    try{
      return await this.runSingle(vertices,s,p,rt);
    }catch(e){
      if(!e.diverged||this.cancelled)throw e;
      this.diverged=null;
      this.notify({stage:'Diverged \u00b7 retrying with damped numerics',warning:e.reason});
      // createCase makes system/ and 0/ non-recursively, so it cannot run twice over
      // the same folder - a retry would die with EEXIST instead of re-solving. Move the
      // failed attempt aside rather than deleting it: its logs are the evidence for why
      // the retry happened at all.
      let keptAt=this.folder+'-diverged';
      try{
        await fs.rm(keptAt,{recursive:true,force:true});
        await fs.rename(this.folder,keptAt);
      }catch{
        keptAt=null;
        await fs.rm(this.folder,{recursive:true,force:true}).catch(()=>{});
      }
      const robust={...p,firstOrder:true,relaxation:{p:.3,U:.5,k:.3,omega:.3}};
      const result=await this.runSingle(vertices,s,robust,rt,{forceWallFunctions:true,firstOrder:true});
      result.recovered={from:e.reason,divergedCase:keptAt,
        note:'The first attempt diverged. This result used first-order convection and '
          +'wall functions, which is more numerically diffusive - treat it as indicative '
          +'rather than accuracy-grade.'};
      result.reliability={...result.reliability,acceptable:false,
        status:result.reliability?.status==='acceptable'?'needs-review':result.reliability?.status,
        blocking:[...(result.reliability?.blocking||[]),'Recovered from a diverged solve using first-order numerics.']};
      return result;
    }
  }

  async runSingle(vertices,s,p,rt,{forceWallFunctions=false,firstOrder=false}={}){
    // Same definition as createCase uses; needed again after meshing to restate
    // the wall boundary conditions.
    const kInlet=1.5*(s.speed*s.intensity)**2;
    const started=Date.now(),{grid,control}=await createCase(this.folder,vertices,s,p);
    const surface=await this.command(rt,'surfaceCheck',['-checkSelfIntersection','constant/triSurface/model.stl']);if(!/Surface is closed/.test(surface)||/Surface is not closed/.test(surface))throw Error('The model is not a closed watertight surface. Repair open edges in CAD before running.');
    if(!/Surface is not self-intersecting/.test(surface))throw Error('OpenFOAM detected a surface intersection. Inspect log.surfaceCheck in the case folder.');
    await this.command(rt,'surfaceFeatureExtract');await this.command(rt,'blockMesh');const meshing=await this.command(rt,'snappyHexMesh',['-overwrite']);
    const mesh=await this.command(rt,'checkMesh');if(!/Mesh OK\./.test(mesh))throw Error('Mesh quality checks failed. Inspect log.checkMesh in the case folder or repair the CAD geometry.');
    const cells=Number(/cells:\s+(\d+)/.exec(mesh)?.[1]||0),meshSeconds=(Date.now()-started)/1000;
    quality.checkMeshMemory(cells,await availableHardware(s),!!rt.gpu);
    await this.command(rt,'postProcess',['-func','layerSurface','-time','0'],'postProcess.layers');
    const layerPreflight=require('./layer-mesh.cjs').layerSurface(await fs.readFile(path.join(this.folder,'postProcessing/layerSurface/0/body.vtk'),'utf8'),p.wall.layers);
    const preflightWarning=s.qualityMode!=='draft'&&(layerPreflight.coverage<.9||layerPreflight.mean<p.wall.layers*.7)?'Wall-layer coverage '+(layerPreflight.coverage*100).toFixed(0)+'%; average '+layerPreflight.mean.toFixed(1)+' / '+p.wall.layers+' layers. Accuracy needs review.':null;
    // Match the wall boundary conditions to the mesh that was actually built. Writing
    // low-Re conditions onto a mesh with no boundary layer is what made this diverge.
    const treatment=forceWallFunctions
      ?{mode:'wall-functions',adapted:true,reason:'Wall functions were forced after the first attempt diverged.'}
      :quality.wallTreatment(layerPreflight,p.wall,s.qualityMode);
    await applyWallTreatment(this.folder,treatment.mode,{k:kInlet,roughness:s.roughness});
    this.notify({stage:'Wall layers checked',layerCoverage:layerPreflight,warning:preflightWarning||treatment.reason});
    const workers=rt.gpu?1:chooseWorkers(s.cpuWorkers??'auto',p.hw.logicalCores,cells,!!rt.mpi),execution={backend:rt.gpu?'gpu':'cpu',device:rt.device,scope:rt.gpu?'CUDA pressure linear algebra; meshing, momentum and turbulence on CPU':undefined,workers,mpi:workers>1?'Microsoft MPI':null};
    if(workers>1){
      const par=await parallelRuntime(rt);
      if(!par.ready)throw Error('Multi-core solving is unavailable: '+par.reason+' Choose 1 CPU worker.');
      this.notify({stage:'Splitting mesh across '+workers+' CPU workers',workers});
      await fs.writeFile(path.join(this.folder,'system/decomposeParDict'),header('decomposeParDict')+'numberOfSubdomains '+workers+';method scotch;');
      await this.command(rt,'decomposePar');
    }
    this.notify({stage:rt.gpu?'Solving with GPU pressure acceleration':'Solving on '+workers+' CPU worker'+(workers===1?'':'s'),execution});
    const solveStart=Date.now();let convergenceStopped=false,checking=false,monitorError=null,monitorPromise=Promise.resolve();
    const check=async()=>{if(checking||convergenceStopped||this.cancelled||this.iteration<p.criteria.minIterations)return;checking=true;try{if(!quality.residualConvergence(this.residualHistory||[],p.criteria.residual).passed)return;const history=await readCoefficients(this.folder,s),loads=quality.loadConvergence(history,s,p.criteria);if(!loads.stable)return;await fs.writeFile(path.join(this.folder,'system/controlDict.tmp'),control.replace('stopAt endTime;','stopAt writeNow;'));await fs.rename(path.join(this.folder,'system/controlDict.tmp'),path.join(this.folder,'system/controlDict'));convergenceStopped=true;this.notify({stage:'Residuals, forces and moments settled · saving',iteration:this.iteration});}catch(e){monitorError=e.message;}finally{checking=false;}};
    // The monitor above can only shorten a CONVERGED run. A diverging one had no exit
    // at all and would burn through every remaining iteration - hours - to produce a
    // meaningless number. Stop it the same way, as soon as the log says it is dead.
    const watchDivergence=()=>{
      if(this.diverged||convergenceStopped||this.cancelled)return;
      const verdict=divergenceVerdict(this);
      if(!verdict.diverged)return;
      this.diverged=verdict;
      this.notify({stage:'Diverging \u00b7 stopping',iteration:this.iteration,warning:verdict.reason});
      // Ask OpenFOAM to stop cleanly rather than killing it, so partial output stays
      // readable; fall back to a kill if it does not respond.
      fs.writeFile(path.join(this.folder,'system/controlDict.tmp'),control.replace('stopAt endTime;','stopAt writeNow;'))
        .then(()=>fs.rename(path.join(this.folder,'system/controlDict.tmp'),path.join(this.folder,'system/controlDict')))
        .catch(()=>{});
      setTimeout(()=>{if(this.child&&this.diverged)try{this.child.kill();}catch{}},20000);
    };
    const timer=setInterval(()=>{watchDivergence();if(!checking)monitorPromise=check();},1500);
    let solve;
    try{solve=await this.command(rt,'simpleFoam',[],'simpleFoam',workers);}
    catch(e){
      // A divergence stop often surfaces as a non-zero exit; prefer the specific
      // diagnosis over "simpleFoam failed (3)" plus two kilobytes of log tail.
      if(this.diverged)throw Object.assign(Error(this.diverged.reason),{diverged:true,reason:this.diverged.reason});
      throw e;
    }
    finally{clearInterval(timer);await monitorPromise;}
    if(this.diverged)throw Object.assign(Error(this.diverged.reason),{diverged:true,reason:this.diverged.reason});
    const solveSeconds=(Date.now()-solveStart)/1000;
    if(workers>1)await this.command(rt,'reconstructPar',['-latestTime']);
    await this.command(rt,'postProcess',['-func','Q','-latestTime'],'postProcess.Q');
    await this.command(rt,'postProcess',['-func','vorticity','-latestTime'],'postProcess.vorticity');
    await this.command(rt,'postProcess',['-func','sampleForViewer','-latestTime']);
    const fields=await readSamples(this.folder,grid,s.length),history=await readCoefficients(this.folder,s);
    if(!history.length)throw Error('OpenFOAM produced no force coefficients. Inspect the saved case logs.');
    let liftCenter,agreement;try{await this.command(rt,'postProcess',['-func','bodySurface','-latestTime'],'postProcess.bodySurface');liftCenter=await readSurfaceLoads(this.folder,s.density);agreement=quality.loadAgreement(liftCenter,history.at(-1),s);if(!agreement.passed){liftCenter.center=null;liftCenter.reason='Surface forces or moments disagree with the independent total-load calculation.';}}catch(e){liftCenter={center:null,reason:'Lift center unavailable: '+e.message};}
    const residualCheck=quality.residualConvergence([...(this.residualHistory||[]),this.residuals],p.criteria.residual),forceCheck=quality.loadConvergence(history,s,p.criteria),converged=residualCheck.passed&&forceCheck.stable;
    const layerCoverage=await fs.readFile(path.join(this.folder,'0/nSurfaceLayers'),'utf8').then(text=>quality.parseLayerCoverage(text,liftCenter.panels||[],p.wall.layers),()=>null);
    const result={...fields,grid,history,liftCenter,engine:'openfoam',execution,type:'done',iteration:this.iteration,change:this.residual,residuals:this.residuals,residualCheck,forceConvergence:forceCheck,loadAgreement:agreement,layerCoverage,layerPreflight,preflightWarning,meshLimitReached:quality.meshLimitReached(await fs.readFile(path.join(this.folder,'log.snappyHexMesh'),'utf8')),accuracyValidated:false,wallTreatment:treatment,firstOrder:!!firstOrder,elapsed:(Date.now()-started)/1000,cells,meshSeconds,solveSeconds,converged,convergenceStopped,monitorError,stopReason:converged?'converged':'iteration-limit',plan:p,folder:this.folder};
    result.flowCheck=await readFlowBalance(this.folder,history.at(-1).iteration);
    result.groundCheck=await readGroundCheck(this.folder,s,p);
    result.reliability=quality.qualityEvidence(result,s,p.wall,layerCoverage);await this.writeSummary(result);return result;
  }
}
function displayGrid(bounds){
  // Twice the old linear resolution, bounded to keep display sampling within RAM limits.
  let nx=256,grid;
  do {const h=3.6/nx,ny=Math.max(Math.ceil(nx*24/128),Math.ceil((bounds[4]-bounds[1]+.5)/h)),nz=Math.max(Math.ceil(nx*24/128),Math.ceil((bounds[5]-bounds[2]+.5)/h));grid={nx,ny,nz,h,origin:[-1.2,-ny*h/2,-nz*h/2],N:nx*ny*nz};nx-=16;}while(grid.N>1500000&&nx>=32);
  return grid;
}
async function writeViewerSampling(folder,grid,L,name='sampleForViewer'){
 const {nx,ny,nz,h,origin}=grid,rows=[];
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)rows.push('('+[x,y,z].map((v,i)=>Number(((origin[i]+(v+.5)*h)*L).toPrecision(10))).join(' ')+')');
 await fs.writeFile(path.join(folder,'system',name),header(name)+`type sets;libs (sampling);interpolationScheme cellPoint;setFormat raw;fields (U p k Q vorticity);sets (viewer {type cloud;axis xyz;points (${rows.join('\n')});});`);
}
async function improveViewerSampling(folder){
 const study=JSON.parse(await fs.readFile(path.join(folder,'study.json'),'utf8')),grid=displayGrid(study.plan.bounds),name='sampleForViewerDetail';
 await writeViewerSampling(folder,grid,study.settings.length,name);
 await new Job(folder).command(await runtime(),'postProcess',['-func',name,'-latestTime'],'postProcess.viewerDetail');
 // Validate before publishing the cache. Original samples and solver results remain intact.
 await readSamples(folder,grid,study.settings.length,name);
 const times=(await fs.readdir(folder)).filter(x=>Number.isFinite(+x)).sort((a,b)=>+b-+a);
 await fs.writeFile(path.join(folder,'viewer-detail.json.tmp'),JSON.stringify({grid,name,time:times[0]}));
 await fs.rename(path.join(folder,'viewer-detail.json.tmp'),path.join(folder,'viewer-detail.json'));
 return grid;
}
async function readSamples(folder,g,L,name='sampleForViewer'){
  if(!['sampleForViewer','sampleForViewerDetail'].includes(name))throw Error('Invalid display sample set.');
  const root=path.join(folder,'postProcessing',name),times=(await fs.readdir(root)).filter(x=>Number.isFinite(+x)).sort((a,b)=>+b-+a);if(!times.length)throw Error('No sampled velocity field.');
  const dir=path.join(root,times[0]),files=await fs.readdir(dir),out={ux:new Float32Array(g.N),uy:new Float32Array(g.N),uz:new Float32Array(g.N),pressure:new Float32Array(g.N),q:new Float32Array(g.N).fill(NaN),tke:new Float32Array(g.N).fill(NaN),vorticity:new Float32Array(g.N*3).fill(NaN),solid:new Uint8Array(g.N).fill(1)};let count=0;
  for(const f of files){if(!/\.xy$|\.xyz$/.test(f))continue;const names=f.replace(/\.(xy|xyz)$/,'').split('_').slice(1);let column=3;const offsets={};for(const name of names){offsets[name]=column;column+=['U','vorticity'].includes(name)?3:1;}const velocity=offsets.U!==undefined,pressure=offsets.p!==undefined;if(!velocity&&!pressure)continue;
    for(const line of (await fs.readFile(path.join(dir,f),'utf8')).split(/\r?\n/)){if(!line.trim()||line.trim().startsWith('#'))continue;const a=line.trim().split(/\s+/).map(Number);if(a.length<column||!a.every(Number.isFinite))throw Error('OpenFOAM sampling produced invalid field values.');const ijk=a.slice(0,3).map((v,j)=>Math.round((v/L-g.origin[j])/g.h-.5));if(ijk.some((v,j)=>v<0||v>=[g.nx,g.ny,g.nz][j]))continue;const i=ijk[0]+g.nx*(ijk[1]+g.ny*ijk[2]);if(velocity){out.ux[i]=a[offsets.U];out.uy[i]=a[offsets.U+1];out.uz[i]=a[offsets.U+2];out.solid[i]=0;count++;}if(pressure)out.pressure[i]=a[offsets.p];if(offsets.Q!==undefined)out.q[i]=a[offsets.Q];if(offsets.k!==undefined)out.tke[i]=a[offsets.k];if(offsets.vorticity!==undefined)for(let k=0;k<3;k++)out.vorticity[i*3+k]=a[offsets.vorticity+k];}
  }
  if(count<g.N*.1)throw Error('The sampled velocity field is incomplete. Open the native case for diagnostics.');return out;
}
async function readCoefficients(folder,s){
  const root=path.join(folder,'postProcessing/coefficients');const dirs=await fs.readdir(root);const history=[];
  for(const dir of dirs){const file=path.join(root,dir,'coefficient.dat');if(!await exists(file))continue;let columns=[];for(const line of (await fs.readFile(file,'utf8')).split(/\r?\n/)){if(/^#\s*Time\s/.test(line))columns=line.replace(/^#\s*/,'').trim().split(/\s+/);if(line.startsWith('#')||!line.trim())continue;const a=line.trim().split(/\s+/).map(Number),get=name=>a[columns.indexOf(name)];if(!columns.length)continue;const cd=get('Cd'),cy=get('Cl'),cz=-get('Cs');if(![cd,cy,cz].every(Number.isFinite))throw Error('The simulation diverged; force coefficients are not finite.');
   // Finite is not the same as physical. A diverged run reported Cd = -1.05e+43 here,
   // which passed a finiteness test and reached the UI as a number. Real external-aero
   // coefficients for any body sit far inside this envelope, so anything beyond it is
   // a failed solve, not a surprising design.
   if([cd,cy,cz].some(v=>Math.abs(v)>COEFFICIENT_LIMIT))throw Error('The simulation diverged; force coefficients reached '
     +Math.max(...[cd,cy,cz].map(Math.abs)).toExponential(2)+', far outside any physical range.');history.push({iteration:a[0],cd,cy,cz,mx:get('CmRoll')*.5*s.density*s.speed**2*s.referenceArea*s.length,my:get('CmYaw')*.5*s.density*s.speed**2*s.referenceArea*s.length,mz:-get('CmPitch')*.5*s.density*s.speed**2*s.referenceArea*s.length,drag:.5*s.density*s.speed**2*s.referenceArea*cd,change:0});}}
  return history.sort((a,b)=>a.iteration-b.iteration);
}
async function restoreCase(folder,vertices,s){
 validate(s,vertices);const study=JSON.parse(await fs.readFile(path.join(folder,'study.json'),'utf8'));
 if(!sameEnvironment(s,study.settings))throw Error('Saved result environment differs. Run again for this fluid and ground setting.');
 for(const key of ['length','speed','density','nu','referenceArea','intensity','yaw','pitch','roll','roughness','turbulenceRatio']){
   const fallback=key==='turbulenceRatio'?10:0,a=s[key]??fallback,b=study.settings[key]??fallback;
   if(Math.abs(a-b)>Math.max(1e-12,Math.abs(b)*1e-8))throw Error('Saved result settings differ: '+key+'. Run again for these settings.');
 }
 const savedVertices=require('./case-surface.cjs').readSurface(await fs.readFile(path.join(folder,'constant/triSurface/model.stl')));
 if(savedVertices.length!==vertices.length)throw Error('Saved result belongs to another model.');
 for(let i=0;i<vertices.length;i++)if(Math.abs(savedVertices[i]-vertices[i]*s.length)>s.length*1e-6)throw Error('Saved result geometry differs. Run again for this model.');
 const summary=JSON.parse(await fs.readFile(path.join(folder,'result-summary.json'),'utf8'));let grid=study.grid,name='sampleForViewer';
 if(await exists(path.join(folder,'viewer-detail.json'))){const cache=JSON.parse(await fs.readFile(path.join(folder,'viewer-detail.json'),'utf8')),times=(await fs.readdir(folder)).filter(x=>Number.isFinite(+x)).sort((a,b)=>+b-+a);if(cache.time===times[0]&&cache.name==='sampleForViewerDetail'){grid=cache.grid;name=cache.name;}}
 if(!Number.isSafeInteger(grid.N)||grid.N<1||grid.N>2000000)throw Error('Invalid saved display grid.');
 const history=await readCoefficients(folder,s),liftCenter=await readSurfaceLoads(folder,s.density),loadAgreement=quality.loadAgreement(liftCenter,history.at(-1),s);
 if(!loadAgreement.passed){liftCenter.center=null;liftCenter.reason='Restored surface loads disagree with the native force/moment history.';}
 const flowCheck=await readFlowBalance(folder,history.at(-1)?.iteration);
 const groundCheck=await readGroundCheck(folder,s,study.plan);
 const result={...summary,groundCheck,...await readSamples(folder,grid,s.length,name),grid,history,liftCenter,loadAgreement,flowCheck,folder};
 if(result.reliability&&(!loadAgreement.passed||!flowCheck.passed||history.at(-1)?.iteration!==summary.iteration)){result.reliability={...result.reliability,status:'needs-review',acceptable:false,blocking:[...result.reliability.blocking,'Restored native data no longer agrees with the checked result or flow balance failed. Re-run the numerical checks.']};}
 if(result.reliability&&environment(s).groundMode!=='none'&&quality.qualityMode(s)!=='draft'&&!groundCheck?.passed){result.reliability={...result.reliability,status:'needs-review',acceptable:false,blocking:[...result.reliability.blocking,'Restored ground wall resolution or layer coverage is below target or unverified.']};}
 return result;
}
module.exports={parallelRuntime,runtime,hardware,availableHardware,plan,validate,createCase,Job,readSamples,readCoefficients,restoreCase,displayGrid,improveViewerSampling};


