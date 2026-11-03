import {fluidPresets,environment,environmentLabel,freeFlight} from '../environment.cjs';
import {modes as qualityModes,qualityMode} from '../quality.cjs';
import materialLibrary from './onshape-materials.json';
import {studyPlan,validateStudies,summarizeStudy,sameCondition,comparisonRows,restorableStudy,assessStudySet} from './studies.mjs';
import {regionAdvice} from './design-advice.mjs';
import {sliceMaterial} from './field-material.mjs';
import {modelRotation,sweepSample,stabilityFindings,spatialFindings} from './plane-diagnostics.mjs';
import {isoSurfaceMesh,refinedIsoSurface,sliceSurface,connectedLoads} from './volume-view.mjs';
import {projectedArea} from './reference-area.mjs';
import {assessmentOptions,planeShape,assessPlane,assessmentHTML} from './plane-assessment.mjs';
import * as T from 'three';
import {fields,ramps,fieldScale,velocityContrast,colorValue,loadBins,shiftedMoment,forceStability,surfaceSampler} from './analysis.mjs';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {U0} from './solver.mjs';
import {modelSeeds,planeSeeds,traceLine,surfaceBlocker} from './streamlines.mjs';
import {chooseDroppedFile,validateModelFile,MAX_MODEL_LABEL} from './drop.mjs';
import {decimateVertices,decimateParts,triangleCount,DECIMATE_TARGET_TRIANGLES} from './decimate.mjs';
import {cleanMesh,asciiSTL} from './clean-mesh.mjs';
import {massProperties,forceCenter,liftLocation,liftBalance} from '../physical-properties.cjs';
import {reynoldsNumber,speedForReynolds,scientificReynolds} from './flow-settings.mjs';
function syncReynoldsInput(){ $('ransRe').setCustomValidity('');const speed=+$('speed').value,length=+$('length').value,nu=+$('nu').value;if([speed,length,nu].every(v=>Number.isFinite(v)&&v>0))$('ransRe').value=scientificReynolds(reynoldsNumber({speed,length,nu})); }
const $=id=>document.getElementById(id),api=window.desktop;
const state={studies:[],selectedStudy:null,studyRunning:false,base:null,mesh:null,name:'Sphere',source:null,result:null,grid:null,solid:null,area:0,history:[],worker:null,mode:'flow',settings:null,started:0,elapsed:0};
function updateAreaBasis(){if($('areaBasis'))$('areaBasis').textContent=state.referenceAreaKind==='model-projection'?'Estimated full-model top projection, including body and tail. This is not measured main-wing area. Updates when size changes.':'Entered reference area. Use measured wing planform area for aircraft comparisons. Forces do not depend on this choice.';}
function estimateReferenceArea(){if(!state.base)return;const area=projectedArea(state.base.attributes.position.array,+$('length').value);if(!(area>0))throw Error('Orient the model with its top along +Y before estimating area.');$('referenceArea').value=area.toPrecision(7);state.referenceAreaKind='model-projection';updateAreaBasis();}
$('estimateArea').onclick=()=>{try{estimateReferenceArea();invalidate();}catch(e){toast(e.message);}};
let browseOffset=0,browseGeneration=0,browseStudios=[];
function fillOptions(id,items,placeholder){const el=$(id);el.replaceChildren(new Option(placeholder,''),...items.map(x=>new Option(x.name,x.id)));el.disabled=!items.length;}
async function browseDocuments(offset=0){
 const token=++browseGeneration;browseOffset=offset;$('onshapeBrowseStatus').textContent='Loading documents…';$('onshapePrevious').disabled=$('onshapeNext').disabled=true;fillOptions('onshapeDocument',[],'Loading…');fillOptions('onshapeWorkspace',[],'Choose a document');fillOptions('onshapeStudio',[],'Choose a workspace');
 try{const r=await api.onshapeBrowse({kind:'documents',query:$('onshapeSearch').value,offset});if(token!==browseGeneration)return;fillOptions('onshapeDocument',r.items,'Choose a document');$('onshapePrevious').disabled=offset===0;$('onshapeNext').disabled=!r.more;$('onshapeBrowseStatus').textContent=r.items.length?'Select a document, workspace, and Part Studio.':'No matching documents. Try another search or paste a Part Studio link.';}catch(e){if(token===browseGeneration)$('onshapeBrowseStatus').textContent=errorText(e);}
}
$('searchOnshape').onclick=()=>browseDocuments();$('onshapeSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();browseDocuments();}};$('onshapePrevious').onclick=()=>browseDocuments(Math.max(0,browseOffset-20));$('onshapeNext').onclick=()=>browseDocuments(browseOffset+20);
$('onshapeDocument').onchange=async()=>{
 const token=++browseGeneration,document=$('onshapeDocument').value;fillOptions('onshapeWorkspace',[],'Loading…');fillOptions('onshapeStudio',[],'Choose a workspace');$('onshapeUrl').value='';if(!document)return;
 try{const r=await api.onshapeBrowse({kind:'workspaces',document});if(token!==browseGeneration)return;fillOptions('onshapeWorkspace',r.items,'Choose a workspace');$('onshapeBrowseStatus').textContent=r.items.length?'Choose the design workspace.':'No readable workspaces.';if(r.items.length===1){$('onshapeWorkspace').value=r.items[0].id;await $('onshapeWorkspace').onchange();}}catch(e){if(token===browseGeneration)$('onshapeBrowseStatus').textContent=errorText(e);}
};
$('onshapeWorkspace').onchange=async()=>{
 const token=++browseGeneration,document=$('onshapeDocument').value,workspace=$('onshapeWorkspace').value;fillOptions('onshapeStudio',[],'Loading…');$('onshapeUrl').value='';if(!workspace)return;
 try{const r=await api.onshapeBrowse({kind:'elements',document,workspace});if(token!==browseGeneration)return;browseStudios=r.items;fillOptions('onshapeStudio',r.items,'Choose a Part Studio');$('onshapeBrowseStatus').textContent=r.items.length?'Select a Part Studio, then Import model.':'No Part Studios here. Assemblies are not supported yet.';if(r.items.length===1){$('onshapeStudio').value=r.items[0].id;await $('onshapeStudio').onchange();}}catch(e){if(token===browseGeneration)$('onshapeBrowseStatus').textContent=errorText(e);}
};
$('onshapeStudio').onchange=async()=>{
 const token=++browseGeneration,studio=browseStudios.find(x=>x.id===$('onshapeStudio').value);$('onshapeUrl').value=studio?.link||'';fillOptions('onshapePart',[],'Loading parts…');if(!studio)return;
 try{const r=await api.onshapeBrowse({kind:'parts',document:$('onshapeDocument').value,workspace:$('onshapeWorkspace').value,element:studio.id});if(token!==browseGeneration)return;fillOptions('onshapePart',r.items,'Entire Part Studio');$('onshapePart').disabled=false;$('onshapeBrowseStatus').textContent=r.items.length+' solids. Choose the exterior body for airflow; importing overlapping construction parts can require CAD repair.';if(r.items.length===1){$('onshapePart').value=r.items[0].id;$('onshapePart').onchange();}}catch(e){if(token===browseGeneration){fillOptions('onshapePart',[],'Entire Part Studio');$('onshapeBrowseStatus').textContent=errorText(e)+' You can still try the whole Part Studio.';}}
};
$('onshapePart').onchange=()=>{const studio=browseStudios.find(x=>x.id===$('onshapeStudio').value);if(!studio)return;const u=new URL(studio.link);if($('onshapePart').value)u.searchParams.set('aerodeskPart',$('onshapePart').value);$('onshapeUrl').value=u.href;};
let toastTimer,busy=false,dragDepth=0,dropTask=Promise.resolve(),ransRunning=false,planVersion=0;
function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6500);}
function errorText(e){return String(e.message||e).replace(/^Error invoking remote method '[^']+': Error: /,'');}
function handle(fn){return async()=>{try{await fn();}catch(e){toast(errorText(e));}};}
const scene=new T.Scene(),camera=new T.PerspectiveCamera(40,1,.01,100);
const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor(0xf1f4f7,1);$('viewer').append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.7;controls.maxDistance=16;
scene.add(new T.HemisphereLight(0xc5e5f2,0x21313f,2.5));const light=new T.DirectionalLight(0xffedda,3);light.position.set(-2,4,4);scene.add(light);const fill=new T.DirectionalLight(0x66c3e6,2);fill.position.set(2,1,-3);scene.add(fill);
const floor=new T.GridHelper(6,24,0x405a6b,0x283f4f);floor.position.set(1,-1.5,0);floor.material.transparent=true;floor.material.opacity=.5;scene.add(floor);
const tunnel=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(6,3,3)),new T.LineBasicMaterial({color:0x486375,transparent:true,opacity:.25}));tunnel.position.x=1;scene.add(tunnel);
const groundSurface=new T.Mesh(new T.PlaneGeometry(8,6),new T.MeshStandardMaterial({color:0xd9e2e5,roughness:1,side:T.DoubleSide}));groundSurface.rotation.x=-Math.PI/2;groundSurface.visible=false;groundSurface.position.x=1;scene.add(groundSurface);
const arrow=new T.ArrowHelper(new T.Vector3(1,0,0),new T.Vector3(-1.65,-1.25,1.25),.7,0xe89c64,.12,.07);scene.add(arrow);floor.visible=tunnel.visible=false;arrow.visible=true;arrow.setColor(0x267da4);arrow.setLength(.45,.09,.045);
const flowGroup=new T.Group();scene.add(flowGroup);const centersGroup=new T.Group();scene.add(centersGroup);
function resetView(){selectView('iso');}
resetView();
new ResizeObserver(()=>{const r=$('viewer').getBoundingClientRect();renderer.setSize(r.width,r.height);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();drawChart();if(state.result?.liftCenter?.panels)drawLoadChart(loadBins(state.result.liftCenter.panels));}).observe($('viewer'));
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);placeCenterLabels();updateViewCube();});
function disposeObject(obj){obj.traverse(c=>{c.geometry?.dispose();if(c.material){c.material.map?.dispose();c.material.dispose();}});}
function clearFlow(){if(state.mesh)state.mesh.visible=true;while(flowGroup.children.length){const c=flowGroup.children[0];flowGroup.remove(c);disposeObject(c);}}
function updateEnvironment(){
 const water=$('fluidMedium').value==='water',mode=$('groundMode').value,ground=mode!=='none';
 $('groundControls').classList.toggle('hidden',!ground);
 $('engine').querySelector('[value="preview"]').disabled=water||ground;
 $('environmentNote').classList.toggle('hidden',!water&&!ground);
 $('environmentNote').textContent=[water?((+$('density').value===998.2&&+$('nu').value===1.004e-6)?'Freshwater at 20°C. ':'Custom water properties. ')+'Flow forces only; no free surface, buoyancy or cavitation.':'',ground?(mode==='moving'?'Ground travels at flow speed in the model frame.':'Fixed no-slip floor; its boundary layer grows from the inlet.'):''].filter(Boolean).join(' ');
 groundSurface.visible=ground&&!!state.mesh;
 if(state.mesh){const bottom=state.mesh.geometry.boundingBox.min.y,L=+$('length').value,y=bottom-+$('groundClearance').value/L;
  if(Number.isFinite(y)){groundSurface.position.y=y;groundSurface.material.color.set(water?0xb8d0db:0xd9e0df);}
  arrow.position.set(-.25,ground&&Number.isFinite(y)?y+.025:bottom-.18,0);arrow.visible=true;
 }
}
function settings(){const s={fluidMedium:$('fluidMedium').value,groundMode:$('groundMode').value,groundClearance:+$('groundClearance').value,length:+$('length').value,speed:+$('speed').value,yaw:+$('yaw').value,pitch:+$('pitch').value,roll:+$('roll').value,re:+$('re').value,nx:+$('quality').value,steps:+$('steps').value,density:+$('density').value,engine:$('engine').value,qualityMode:$('ransQuality').value,cpuWorkers:$('cpuWorkers').value,computeBackend:$('computeBackend').value,nu:+$('nu').value,roughness:+$('roughness').value/1000,referenceArea:+$('referenceArea').value,referenceAreaKind:state.referenceAreaKind||'entered',turbulenceRatio:+$('turbulenceRatio').value,intensity:+$('intensity').value};validateSettings(s);if(s.engine==='openfoam'){if(!$('ransRe').validity.valid)throw Error($('ransRe').validationMessage||'Enter a valid Reynolds number.');s.reynolds=reynoldsNumber(s);}return s;}
function validateSettings(s){qualityMode(s);environment(s);if(s.computeBackend!==undefined&&!['cpu','gpu'].includes(s.computeBackend))throw Error('Invalid compute backend.');if(s.cpuWorkers!==undefined&&!['auto','1','2','4','8'].includes(String(s.cpuWorkers)))throw Error('Invalid CPU worker setting.');if(s.turbulenceRatio!==undefined&&(!Number.isFinite(s.turbulenceRatio)||s.turbulenceRatio<.001||s.turbulenceRatio>10000))throw Error('Turbulent viscosity ratio must be 0.001–10000.');if(s.roughness!==undefined&&(!Number.isFinite(s.roughness)||s.roughness<0||s.roughness>Math.min(.1,s.length*.01)))throw Error('Roughness must be 0–100 mm and no more than 1% of model length.');for(const key of ['pitch','roll'])if(s[key]!==undefined&&(!Number.isFinite(s[key])||Math.abs(s[key])>180))throw Error('Rotation must be between -180 and 180 degrees.');for(const [key,min,max] of [['length',.001,1000],['speed',.001,100],['yaw',-180,180],['re',10,60],['density',.01,2000]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(key+' must be between '+min+' and '+max+'.');if(![64,96].includes(s.nx)||![800,1600,3200].includes(s.steps))throw Error('Invalid preview settings.');if(s.engine==='openfoam')for(const [key,min,max] of [['speed',.1,100],['nu',1e-8,.1],['referenceArea',1e-8,1e8],['intensity',.00001,.2]])if(!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw Error(key+' must be between '+min+' and '+max+'.');if(s.engine&&!['openfoam','preview'].includes(s.engine))throw Error('Unknown solver.');}
function applySettings(s){validateSettings(s);$('fluidMedium').value=s.fluidMedium||'air';$('groundMode').value=s.groundMode||'none';$('groundClearance').value=s.groundClearance??.1;$('ransQuality').value=qualityMode(s);$('computeBackend').value=s.computeBackend||'cpu';$('cpuWorkers').value=s.cpuWorkers??'auto';state.referenceAreaKind=s.referenceAreaKind||'entered';$('turbulenceRatio').value=s.turbulenceRatio??10;updateAreaBasis();$('roughness').value=(s.roughness||0)*1000;$('pitch').value=s.pitch||0;$('roll').value=s.roll||0;for(const k of ['length','speed','yaw','re','steps','density'])$(k).value=s[k];$('quality').value=s.nx;$('engine').value=s.engine||'preview';for(const k of ['nu','referenceArea','intensity','turbulenceRatio'])if(s[k]!==undefined)$(k).value=s[k];syncReynoldsInput();}
function updateFacts(){updateEnvironment();$('reLabel').textContent=state.result||ransRunning||state.worker?'Reynolds number used':'Reynolds number · setup';try{const s=(state.result||ransRunning||state.worker)&&state.settings?state.settings:settings(),rans=s.engine==='openfoam';if(rans)$('ransRe').value=scientificReynolds(reynoldsNumber(s));$('viscosity').textContent=(rans?s.nu:s.speed*s.length/s.re).toExponential(2)+' m²/s';$('reValue').textContent=scientificReynolds(rans?reynoldsNumber(s):s.re);$('reValue').title=rans?'Re = speed × longest dimension / kinematic viscosity = '+reynoldsNumber(s):'Laminar preview Reynolds number';$('ransSettings').classList.toggle('hidden',!rans);$('previewSettings').classList.toggle('hidden',rans);$('residualLabel').textContent=rans?'max initial · p/U/k/ω':'40-step L2';$('methodNote').firstChild.textContent=rans?environmentLabel(s)+' · steady SST.':'Low-Re preview · viscosity is scaled.';updatePlan();}catch{}}
async function updatePlan(){const version=++planVersion;await new Promise(r=>setTimeout(r,180));if(version!==planVersion)return;try{if(!state.mesh||$('engine').value!=='openfoam')return;const p=await api.foamPlan({settings:settings(),vertices:state.mesh.geometry.attributes.position.array});if(version!==planVersion)return;const hours=p.estimatedSeconds/3600,time=hours<1?Math.max(1,Math.round(hours*60*.5))+'–'+Math.round(hours*60*2)+' min':(hours*.5).toFixed(1)+'–'+(hours*2).toFixed(1)+' hours';$('autoPlan').textContent=p.label+' · '+p.stages.length+' mesh'+(p.stages.length>1?'es':'')+' · about '+p.memoryGB.toFixed(1)+' GB RAM. Estimated '+time+'; varies with convergence. '+(settings().computeBackend==='gpu'?'GPU pressure + CPU. ':p.workers+' CPU workers. ')+p.warning;}catch(e){if(version===planVersion)$('autoPlan').textContent=errorText(e);}}
function invalidate(){state.selectedStudy=null;state.stabilityStudy=null;state.spatial=null;state.aiReview=null;if($('sweepFindings'))$('sweepFindings').replaceChildren();if($('aiReviewText'))$('aiReviewText').replaceChildren();clearAdviceMarkers();state.result=null;state.surfaceMap=null;state.surfaceValues=null;state.grid=null;state.solid=null;state.history=[];clearFlow();for(const id of ['cd','drag','lift','change','areaValue','elapsed'])$(id).textContent='—';$('exportCSV').disabled=$('exportVTK').disabled=true;$('emptyHint').classList.remove('hidden');$('legend').classList.add('hidden');$('progress').style.width='0%';$('stateBadge').textContent='Ready to run';$('stateBadge').classList.remove('running');$('status').textContent='Model ready. Run to compute a new flow field.';$('iteration').textContent='0 steps';$('viewportInfo').textContent='3D MODEL · DRAG TO ORBIT';drawChart();updateFacts();updateCenters();updateAnalysis();$('probe').classList.add('hidden');}
function rebuildModel(){if(!state.base)return;if(state.mesh){scene.remove(state.mesh);disposeObject(state.mesh);}const g=state.base.clone();g.rotateX((+$('roll').value||0)*Math.PI/180);g.rotateZ(-(+$('pitch').value||0)*Math.PI/180);g.rotateY((+$('yaw').value||0)*Math.PI/180);g.computeVertexNormals();state.mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:0xc4d3dc,metalness:.1,roughness:.65,side:T.DoubleSide}));scene.add(state.mesh);g.computeBoundingBox();updateEnvironment();state.blocked=surfaceBlocker(g.attributes.position.array);try{state.body=massProperties(g.attributes.position.array,1,1);}catch{state.body=null;}updateCenters();}
function installGeometry(geometry,name,source=null,physicalLength=null,prepared=null){
  const raw=geometry.index?geometry.toNonIndexed():geometry;
  let cleaned;try{cleaned=prepared||cleanMesh(raw.getAttribute('position')?.array);}finally{if(raw!==geometry)raw.dispose();}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(cleaned.vertices,3));
  const pos=g.getAttribute('position');
  if(!pos||pos.count<12||pos.count%3||pos.count>600000)throw Error('Use a closed triangle model with 4–200,000 triangles.');
  for(const v of pos.array)if(!Number.isFinite(v)||Math.abs(v)>1e12)throw Error('The file contains invalid geometry coordinates.');
  g.computeBoundingBox();const size=g.boundingBox.getSize(new T.Vector3()),longest=Math.max(size.x,size.y,size.z);
  if(longest<1e-9||Math.min(size.x,size.y,size.z)<longest*.00001)throw Error('The model must be a 3D solid, not a flat sheet.');
  if(physicalLength===true&&(longest<.001||longest>1000))throw Error('This Onshape model is outside the supported longest-dimension range of 0.001–1,000 meters.');
  const center=g.boundingBox.getCenter(new T.Vector3());g.translate(-center.x,-center.y,-center.z);g.scale(1/longest,1/longest,1/longest);
  state.studies=[];state.selectedStudy=null;state.cleanup=cleaned.report;if(state.material){state.material={...state.material,cgMode:'uniform',cg:[0,0,0]};$('cgMode').value='uniform';for(const id of ['cgX','cgY','cgZ'])$(id).value=0;$('manualCG').classList.add('hidden');}state.base?.dispose();state.base=g;applyAssessmentOptions();state.referenceAreaKind='entered';updateAreaBasis();state.name=String(name).slice(0,150);state.source=source;$('yaw').value=$('pitch').value=$('roll').value=0;
  if(physicalLength!==null)$('length').value=Math.min(1000,Math.max(.001,physicalLength===true?longest:physicalLength));
  estimateReferenceArea();
  $('modelName').textContent=state.name;$('studyTitle').textContent=state.name.replace(/\.(stl|obj)$/i,'')+' / flow study';$('modelDetails').textContent=(pos.count/3).toLocaleString()+' triangles · '+(source?'Onshape':'local model');$('refreshOnshape').classList.toggle('hidden',!source);
  invalidate();rebuildModel();updateFacts();resetView();showCleanup();
}
function showCleanup(){$('cleanupReport').classList.remove('hidden');const r=state.cleanup;if(!r)return;$('cleanupTitle').textContent=r.rebuiltExterior?'Exterior rebuilt · review geometry':r.ready?(r.changed?'Auto-cleaned · checks passed':'Auto-checked · no repair needed'):'Auto-cleaned · needs review';$('cleanupReport').classList.toggle('repair-needed',!r.ready);$('cleanupDetails').textContent=[(r.unionedParts?r.unionedParts+' solid parts joined. ':'')+r.inputFaces.toLocaleString()+' → '+r.outputFaces.toLocaleString()+' triangles',r.invalidFaces+' invalid, '+r.degenerateFaces+' collapsed and '+r.duplicateFaces+' duplicate faces removed',(r.strayFacesRemoved||0)+' tiny stray faces removed; '+(r.boundaryVerticesStitched||0)+' boundary vertices stitched', (r.microPatchesRebuilt||0)+' tiny intersecting patches rebuilt',r.weldedSeams+' near-seam corners joined; '+r.reorientedFaces+' faces reoriented',r.filledHoles+' small holes filled ('+r.addedFaces+' faces added)',r.components+' surface components retained',r.boundaryEdges+' open edges; '+r.nonManifoldEdges+' non-manifold edges; '+r.nonManifoldVertices+' non-manifold vertices',r.intersections+(r.intersections>=20?'+':'')+' overlapping face pairs detected',!r.intersectionCheckComplete?'Intersection scan limited; repair the model before running.':'Intersection scan completed.',r.ready?'Surface checks passed. OpenFOAM will check the surface again and the volume mesh when you run.':'Repair remaining openings / overlaps in CAD, then reimport.',r.filledHoles?'Review filled openings: even a small hole can be intentional.':'', r.unionNote||'Original file unchanged. Closed overlapping parts are automatically joined when possible.'].filter(Boolean).join('\n');$('cleanupReport').open=!r.ready;if(!r.ready){$('stateBadge').textContent='Model needs repair';$('status').textContent='Cleanup finished with unresolved geometry. Open the cleanup summary below the model.';}}
// Reduce an imported mesh to the solver's triangle budget before cleanup and IPC.
// STEP and 3MF arrive already reduced from the worker; this covers STL and OBJ, which
// are parsed in the renderer. Returns a {from,to} summary, or null when nothing changed.
function reduceGeometry(geometry){
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const positions=source.getAttribute('position')?.array;
  if(!positions)throw Error('The model contains no triangle surfaces.');
  const result=decimateVertices(positions,DECIMATE_TARGET_TRIANGLES);
  if(source!==geometry)source.dispose();
  if(!result.reduced)return null;
  geometry.setIndex(null);
  geometry.setAttribute('position',new T.BufferAttribute(result.vertices,3));
  // Stale attributes no longer match the new vertex count; installGeometry keeps only
  // position and derives the rest, so dropping them here is safe.
  for(const name of Object.keys(geometry.attributes))if(name!=='position')geometry.deleteAttribute(name);
  if(geometry.userData?.parts?.length)geometry.userData.parts=decimateParts(geometry.userData.parts,DECIMATE_TARGET_TRIANGLES).parts;
  return {from:result.from,to:result.to};
}
function simplifiedNote(reduction){
  return reduction?' Simplified from '+reduction.from.toLocaleString()+' to '+reduction.to.toLocaleString()+' triangles for solving.':'';
}
async function prepareImport(geometry){const g=geometry.index?geometry.toNonIndexed():geometry,vertices=g.getAttribute('position')?.array.slice();if(g!==geometry)g.dispose();return api.modelClean({vertices,parts:geometry.userData?.parts});}
function ensureClean(){if(!state.cleanup?.ready)throw Error('The model still has geometry problems. Open its cleanup summary, repair the remaining issues in CAD, and reimport before running.');}
function sample(kind){let g;if(kind==='sphere')g=new T.SphereGeometry(.5,48,32);else if(kind==='body'){g=new T.SphereGeometry(.5,48,32);g.scale(1,.6,.6);}else g=new T.BoxGeometry(1,.8,.8);installGeometry(g,{sphere:'Sphere',body:'Streamlined body',cube:'Block'}[kind],null,1);g.dispose();document.querySelectorAll('[data-sample]').forEach(b=>b.classList.toggle('selected',b.dataset.sample===kind));}
async function parseModel(file){if(file.parts?.length){const gs=await Promise.all(file.parts.map(p=>parseModel({name:p.name+".stl",bytes:p.bytes})));const merged=mergeGeometries(gs);merged.userData={parts:gs.map(g=>g.attributes.position.array.slice())};gs.forEach(g=>g.dispose());return merged;}if(/\.(step|stp|3mf)$/i.test(file.name)){const converted=await api.modelConvert({type:/\.3mf$/i.test(file.name)?'3mf':'step',bytes:file.bytes});const geometries=converted.parts.map(p=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.rotateX(-Math.PI/2);return g;});const merged=mergeGeometries(geometries);merged.userData={meters:true,parts:geometries.map(g=>g.attributes.position.array.slice())};geometries.forEach(g=>g.dispose());return merged;}const bytes=new Uint8Array(file.bytes);if(/\.stl$/i.test(file.name))return new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));if(/\.obj$/i.test(file.name)){const group=new OBJLoader().parse(new TextDecoder().decode(bytes));group.updateMatrixWorld(true);const geoms=[];group.traverse(o=>{if(o.isMesh){const g=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(a!=='position')g.deleteAttribute(a);geoms.push(g);}});if(!geoms.length)throw Error('The OBJ has no triangle surfaces.');const merged=mergeGeometries(geoms);merged.userData={parts:geoms.map(g=>g.attributes.position.array.slice())};geoms.forEach(g=>g.dispose());return merged;}throw Error('Choose an STL, OBJ, STEP or 3MF file.');}
async function importLocalModel(f){validateModelFile({name:f.name,size:f.bytes.byteLength});const g=await parseModel(f);let reduction=null;if(triangleCount(g.getAttribute('position')?.array||[])>DECIMATE_TARGET_TRIANGLES){$('status').textContent='Simplifying a large model…';reduction=reduceGeometry(g);}$('status').textContent='Cleaning and checking the model…';try{const cleaned=await prepareImport(g);installGeometry(g,f.name,null,g.userData?.meters?true:null,cleaned);}catch(e){$('status').textContent='Import failed. Your previous model is still available.';throw e;}finally{g.dispose();}document.querySelectorAll('[data-sample]').forEach(b=>b.classList.remove('selected'));toast((state.cleanup.ready?'Imported and checked '+f.name+(g.userData?.meters?'. CAD units converted to meters; source Z is upright.':'. Confirm size in meters.'):'Imported '+f.name+'. Some geometry still needs repair; see the cleanup summary.')+simplifiedNote(reduction));}
async function openModel(){const f=await api.open('model');if(f){setBusy(true);$('stop').disabled=true;try{await importLocalModel(f);}finally{setBusy(false);}}}
function setBusy(b){busy=b;document.querySelectorAll('.setup input,.setup select,.setup button').forEach(el=>el.disabled=b);$('openProject').disabled=b;$('newProject').disabled=b;for(const id of ['runStudies','autoStudies','addStudy','studyPitch','studyYaw','studyGrid','studyQuality','rerunStudies'])$(id).disabled=b;$('stopStudies').disabled=!state.studyRunning;$('stop').disabled=false;$('stop').classList.toggle('hidden',!b);$('run').classList.toggle('hidden',b);renderStudies();}
function clearDropHint(){dragDepth=0;$('dropOverlay').classList.add('hidden');}
async function importDroppedFiles(files){
  let started=false;
  try{
    const file=chooseDroppedFile(files,busy,!!document.querySelector('dialog[open]'));
    setBusy(true);started=true;$('stop').disabled=true;
    const bytes=new Uint8Array(await file.arrayBuffer());
    await importLocalModel({name:file.name,bytes});
    return true;
  }catch(e){toast(errorText(e));return false;}finally{if(started)setBusy(false);}
}
window.addEventListener('dragenter',event=>{event.preventDefault();if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;dragDepth++;$('dropOverlay').classList.remove('hidden');$('dropTitle').textContent=busy?'Finish the current task first':'Drop your model here';$('dropDetail').textContent=busy?'Stop the simulation before importing another model.':'STL, OBJ, STEP or 3MF · up to '+MAX_MODEL_LABEL+' · large models are simplified · stays on your PC';});
window.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=busy?'none':'copy';});
window.addEventListener('dragleave',event=>{event.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)clearDropHint();});
window.addEventListener('drop',event=>{event.preventDefault();clearDropHint();dropTask=importDroppedFiles(Array.from(event.dataTransfer?.files||[]));});
window.addEventListener('dragend',clearDropHint);window.addEventListener('blur',clearDropHint);
function startRun(overrideSteps){
  ensureClean();
  if(!overrideSteps&&settings().engine==='openfoam')return startRans();
  if(state.worker)return;const s=settings();invalidate();state.settings=s;state.started=performance.now();state.elapsed=0;setBusy(true);$('stateBadge').textContent='Computing flow';$('stateBadge').classList.add('running');$('status').textContent='Building the grid around your model…';
  const w=new Worker('worker.js');state.worker=w;updateFacts();
  w.onerror=e=>finishError(e.message||'The solver could not start.');
  w.onmessage=({data:d})=>{
    if(d.type==='error'){finishError(d.message);return;}
    if(d.type==='mesh'){state.grid=d.grid;state.solid=d.solid;state.area=d.area;const frontal=d.area*(d.grid.h*s.length)**2;$('areaValue').textContent=frontal.toPrecision(3)+' m²';$('status').textContent='Grid ready · '+d.count.toLocaleString()+' solid cells. Computing flow…';return;}
    state.result=d;state.elapsed=(performance.now()-state.started)/1000;
    const denom=.5*U0*U0*state.area,cd=d.force[0]/denom,cy=d.force[1]/denom,cz=d.force[2]/denom,drag=d.force[0]*s.density*(s.speed/U0)**2*(state.grid.h*s.length)**2;
    state.history.push({iteration:d.iteration,cd,cy,cz,drag,change:d.change});
    $('cd').textContent=cd.toFixed(3);$('lift').textContent=cy.toFixed(3);$('drag').textContent=Math.abs(drag)<.001?drag.toExponential(2):drag.toFixed(3);$('change').textContent=d.change.toExponential(2);$('elapsed').textContent=state.elapsed.toFixed(1)+' s';$('iteration').textContent=d.iteration.toLocaleString()+' / '+(overrideSteps||s.steps).toLocaleString()+' steps';$('progress').style.width=100*d.iteration/(overrideSteps||s.steps)+'%';$('emptyHint').classList.add('hidden');$('legend').classList.toggle('hidden',state.mode==='model');$('viewportInfo').textContent='COMPUTED 3D FLOW · DRAG TO ORBIT';
    if(d.iteration%160===0||d.type==='done'||state.history.length===1)drawFlow();drawChart();$('status').textContent='Solving locally · '+(100*d.iteration/(overrideSteps||s.steps)).toFixed(0)+'% complete';
    if(d.type==='done'){w.terminate();state.worker=null;setBusy(false);$('stateBadge').textContent='Run finished';$('stateBadge').classList.remove('running');$('status').textContent='Run finished. Inspect drag history and compare grid sizes before interpreting results.';$('exportCSV').disabled=$('exportVTK').disabled=false;}
  };
  w.postMessage({vertices:state.mesh.geometry.getAttribute('position').array.slice(),nx:s.nx,re:s.re,steps:overrideSteps||s.steps});
}
api.foamProgress(d=>{if(d.plan)state.runPlan=d.plan;if(d.meshIndex!==undefined){state.meshProgress=d.meshIndex;state.meshCount=d.meshCount;state.meshWarning=null;}if(d.layerCoverage)state.meshWarning=d.warning;if(state.studyRunning){$('studyStatus').textContent=(state.studyProgressLabel||'Study')+' · '+d.stage+(d.iteration?' · iteration '+d.iteration:'');$('status').textContent=$('studyStatus').textContent;return;}if(state.sweeping){$('sweepStatus').textContent='Study '+state.sweepIndex+'/4 · '+d.stage+(d.iteration?' · iteration '+d.iteration:'');return;}if(!ransRunning)return;const stages={surfaceCheck:'Checking the model',surfaceFeatureExtract:'Finding sharp edges',blockMesh:'Building wind tunnel',snappyHexMesh:'Refining the mesh & wall layers',checkMesh:'Checking mesh quality',decomposePar:'Splitting mesh across CPU workers',reconstructPar:'Combining CPU results',simpleFoam:'Solving 3D RANS',postProcess:'Preparing the flow view'};state.elapsed=(performance.now()-state.started)/1000;$('elapsed').textContent=state.elapsed.toFixed(0)+' s';$('status').textContent=((state.meshCount||1)>1?'Mesh '+((state.meshProgress||0)+1)+' / '+state.meshCount+' · ':'')+(stages[d.stage]||d.stage)+(d.stage==='simpleFoam'?' · '+(state.settings?.computeBackend==='gpu'?'CUDA pressure solve':(d.workers||1)+' CPU workers'):'')+(d.iteration?' · iteration '+d.iteration:'')+(state.meshWarning?' · '+state.meshWarning:'');$('iteration').textContent=d.iteration?d.iteration+' iterations':'Meshing';if(d.residual!==undefined)$('change').textContent=d.residual.toExponential(2);const phase=d.stage==='simpleFoam'?.6:d.stage.startsWith('postProcess')?.9:['checkMesh','decomposePar'].includes(d.stage)?.35:.15;$('progress').style.width=100*((state.meshProgress||0)+phase)/(state.meshCount||1)+'%';});
async function startRans(){
  if(busy)return;ensureClean();const s=settings();state.meshWarning=null;state.meshProgress=0;state.meshCount=qualityMode(s)==='reference'?3:1;invalidate();state.settings=s;state.started=performance.now();state.elapsed=0;ransRunning=true;setBusy(true);updateFacts();$('openCase').disabled=false;$('stateBadge').textContent='OpenFOAM running';$('stateBadge').classList.add('running');
  try{const d=await api.foamRun({settings:s,vertices:solverVertices(s),cleanupReport:state.cleanup});installRansResult(d,s);
  }catch(e){finishError(errorText(e));}finally{ransRunning=false;setBusy(false);$('stateBadge').classList.remove('running');updatePlan();}
}
function finishError(message){state.worker?.terminate();state.worker=null;setBusy(false);$('stateBadge').textContent='Needs attention';$('stateBadge').classList.remove('running');$('status').textContent=message;toast(message);}
function stopRun(){state.stopStudySet=true;if(state.studyRunning){api.foamCancel();return;}if(state.sweeping){state.sweepCancelled=true;api.foamCancel();return;}if(ransRunning){$('status').textContent='Stopping OpenFOAM…';api.foamCancel();return;}state.worker?.terminate();state.worker=null;setBusy(false);$('stateBadge').textContent='Stopped · partial';$('stateBadge').classList.remove('running');$('status').textContent='Stopped. Any visible results are partial and may still contain startup transients.';$('exportCSV').disabled=$('exportVTK').disabled=!state.result;}
// Display RGB values; line vertex colors must be converted to linear RGB.
function lineColor(v){return linearColor(v*(state.result?.engine==='openfoam'?state.settings.speed:state.settings.speed));}
function flowAt(x,y,z){const g=state.grid,d=state.result;if(!g||!d)return null;const gx=(x-g.origin[0])/g.h-.5,gy=(y-g.origin[1])/g.h-.5,gz=(z-g.origin[2])/g.h-.5;const ix=Math.floor(gx),iy=Math.floor(gy),iz=Math.floor(gz);if(ix<0||iy<0||iz<0||ix>=g.nx-1||iy>=g.ny-1||iz>=g.nz-1)return null;let u=0,v=0,w=0,solidWeight=0;for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const a=(dx?gx-ix:1-gx+ix)*(dy?gy-iy:1-gy+iy)*(dz?gz-iz:1-gz+iz),i=ix+dx+g.nx*(iy+dy+g.ny*(iz+dz));u+=a*d.ux[i];v+=a*d.uy[i];w+=a*d.uz[i];solidWeight+=a*state.solid[i];}return solidWeight>.3?null:[u,v,w];}
function drawFlow(){clearFlow();updateCenters();updateAnalysis();$('probe').classList.add('hidden');if(!state.result||state.mode==='model'){if(state.mode==='model')$('viewportInfo').textContent='ORIGINAL CAD · DRAG TO ORBIT';return;}const {grid:g,result:d}=state,referenceSpeed=d.engine==='openfoam'?state.settings.speed:U0;
  if(['section','vortex','cloud'].includes(state.mode)){drawVolume();return;}
  if(state.mode==='slice'){drawWholeVelocity(referenceSpeed);return;}
  if(fields[state.mode]&&!['flow','slice'].includes(state.mode)){drawSurfaceField();return;}
  const speeds=[];for(let i=0;i<g.N;i++)if(!state.solid[i])speeds.push(Math.hypot(d.ux[i],d.uy[i],d.uz[i])/referenceSpeed*state.settings.speed);setDisplayScale(speeds,'flow');
  drawStreamlines(referenceSpeed);
}
function drawStreamlines(referenceSpeed=state.result?.engine==='openfoam'?state.settings.speed:U0){
  const drawStarted=performance.now();
  const {grid:g,result:d}=state,plane=$('linePlane').value;
  const positions=[],colors=[];
  const box=state.mesh.geometry.boundingBox,layout=plane==='all'?null:planeSeeds(box.min.toArray(),box.max.toArray(),g.h,plane,+$('linePosition').value),seeds=layout?.seeds||modelSeeds(state.mesh.geometry.attributes.position.array,g.h);let lineCount=0;
  state.streamlinePlane=layout?{axis:layout.axis,position:layout.position,percent:+$('linePosition').value}:null;
  $('linePositionValue').textContent=layout?['X','Y','Z'][layout.axis]+' = '+number(layout.position*state.settings.length)+' m':'';
  for(const seed of seeds.filter((p,i)=>i%(+$('lineDensity').value||1)===0)){const forward=traceLine(seed,flowAt,g.h,1,300,state.blocked),back=traceLine(seed,flowAt,g.h,-1,120,state.blocked),line=back.reverse().concat(forward.slice(1));if(line.length<5)continue;lineCount++;for(let i=1;i<line.length;i++){const velocity=flowAt(...line[i-1]);if(!velocity)continue;const c=lineColor(Math.hypot(...velocity)/referenceSpeed);positions.push(...line[i-1],...line[i]);colors.push(...c,...c);}}
  state.streamlineCount=lineCount;$('viewportInfo').textContent=(d.engine==='openfoam'?'OPENFOAM RANS':'LAMINAR PREVIEW')+' · '+lineCount.toLocaleString()+' STREAMLINES';
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));flowGroup.add(new T.LineSegments(geometry,new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.55,toneMapped:false})));state.streamlineDrawVersion=(state.streamlineDrawVersion||0)+1;state.streamlineDrawMs=performance.now()-drawStarted;
}
function drawChart(){const canvas=$('chart'),r=canvas.getBoundingClientRect();if(!r.width)return;canvas.width=r.width*2;canvas.height=r.height*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);const w=r.width,h=r.height;ctx.strokeStyle='#edf0f3';ctx.lineWidth=1;for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(29,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}const hist=state.history;if(hist.length<2){ctx.fillStyle='#aab5be';ctx.font='10px Segoe UI';ctx.fillText('Your results will appear here',35,h*.55);return;}const vals=hist.map(a=>a[$('chartQuantity').value]),pad=Math.max(Math.max(...vals)-Math.min(...vals),Math.abs(vals[0]),1e-9)*.05,max=Math.max(0,...vals)+pad,min=Math.min(0,...vals)-pad;ctx.fillStyle='#99a6b0';ctx.font='8px Segoe UI';ctx.fillText(number(max),0,12);ctx.fillText(number(min),0,h-6);ctx.strokeStyle='#dc9863';ctx.lineWidth=1.8;ctx.beginPath();hist.forEach((a,i)=>{const x=30+(w-33)*i/(hist.length-1),y=5+(h-15)*(1-(a[$('chartQuantity').value]-min)/(max-min||1));i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
function projectData(){if(!state.base)throw Error('Import a model before saving a project.');return {format:'AeroDesk',version:1,studies:state.studies||[],selectedStudy:state.selectedStudy,studySetup:{pitch:$('studyPitch').value,yaw:$('studyYaw').value,grid:$('studyGrid').checked,qualityMode:$('studyQuality').value},name:state.name,source:state.source,repair:state.cleanup?.rebuiltExterior?{rebuiltExterior:true,resolution:384}:null,material:readMaterial(),assessment:readAssessmentOptions(),settings:settings(),vertices:Array.from(state.base.attributes.position.array)};}
function loadProject(p){if(p?.format!=='AeroDesk'||p.version!==1||!Array.isArray(p.vertices)||p.vertices.length<36||p.vertices.length%9||p.vertices.length>1800000||!p.vertices.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<100))throw Error('This is not a valid AeroDesk project.');validateSettings(p.settings);const assessment=assessmentOptions(p.assessment),studies=validateStudies(p.studies||[]);for(const row of studies)validateSettings(row.settings);let source=null;if(p.source){const u=new URL(p.source);if(u.protocol!=='https:'||!/^([a-z0-9-]+\.)+onshape\.com$/i.test(u.hostname))throw Error('Invalid Onshape link in project.');source=u.href;}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p.vertices,3));installGeometry(g,p.name||'Model',source);g.dispose();applySettings(p.settings);if(p.repair?.rebuiltExterior===true){state.cleanup.rebuiltExterior=true;state.cleanup.unionNote="Approximate exterior rebuild. Small details and gaps may differ from the original CAD. Rebuild resolution: 384 cells across the model.";showCleanup();}applyMaterial(p.material);applyAssessmentOptions(assessment);state.studies=studies;state.selectedStudy=p.selectedStudy||null;if(p.studySetup){$('studyPitch').value=String(p.studySetup.pitch||'0');$('studyYaw').value=String(p.studySetup.yaw||'0');$('studyGrid').checked=!!p.studySetup.grid;$('studyQuality').value=qualityMode(p.studySetup);}rebuildModel();updateFacts();updateAnalysis();renderStudies();}
async function save(kind,name,data){if(await api.save({kind,name,data}))toast('Saved successfully.');}
function csvData(){const s=state.settings;if(state.result?.engine==='openfoam')return ['# AeroDesk 0.14.0 — OpenFOAM v2512 simpleFoam kOmegaSST','# Status: '+$('stateBadge').textContent,'# Quality: '+(s.qualityMode||'legacy')+'; numerical_checks: '+(state.result.reliability?.status||'not-recorded'),'# Quality_notes: '+[...(state.result.reliability?.blocking||[]),...(state.result.reliability?.warnings||[])].join(' '),'# Environment: '+environmentLabel(s),'# density_kg_m3: '+s.density,'# Forces: flow-induced only; no hydrostatic buoyancy','# Reynolds_number_used: '+reynoldsNumber(s),'# reference_area_basis: '+(s.referenceAreaKind||'entered'),'# turbulent_viscosity_ratio: '+(s.turbulenceRatio??10),'# nu_m2_s: '+s.nu+'; reference_area_m2: '+s.referenceArea+'; speed_m_s: '+s.speed+'; length_m: '+s.length,'iteration,drag_coefficient,lift_y_coefficient,side_z_coefficient,drag_N,moment_x_Nm,moment_y_Nm,moment_z_Nm',...state.history.map(a=>[a.iteration,a.cd,a.cy,a.cz,a.drag,a.mx,a.my,a.mz].join(','))].join('\n');return ['# AeroDesk 0.1 — experimental laminar flow; not validated for design','# Model: '+state.name.replace(/[\r\n]/g,' '),'# Status: '+(state.worker?'running':$('stateBadge').textContent),'# Reynolds: '+s.re+'; length_m: '+s.length+'; speed_m_s: '+s.speed+'; density_kg_m3: '+s.density+'; viscosity_m2_s: '+s.speed*s.length/s.re,'# Grid: '+state.grid.nx+'x'+state.grid.ny+'x'+state.grid.nz+'; frontal_area_m2: '+state.area*(state.grid.h*s.length)**2,'iteration,drag_coefficient,lift_y_coefficient,side_z_coefficient,drag_N,relative_flow_change',...state.history.map(a=>[a.iteration,a.cd,a.cy,a.cz,a.drag,a.change].join(','))].join('\n');}
function vtkData(){const {grid:g,result:d,settings:s}=state,h=g.h*s.length,origin=g.origin.map(v=>v*s.length+h/2);const lines=['# vtk DataFile Version 3.0',d.engine==='openfoam'?'AeroDesk OpenFOAM sampled field — inspect convergence':'AeroDesk experimental low-Re flow — unvalidated','ASCII','DATASET STRUCTURED_POINTS',`DIMENSIONS ${g.nx} ${g.ny} ${g.nz}`,`ORIGIN ${origin.join(' ')}`,`SPACING ${h} ${h} ${h}`,`POINT_DATA ${g.N}`,'VECTORS velocity_m_s float'];for(let i=0;i<g.N;i++)lines.push([d.ux[i],d.uy[i],d.uz[i]].map(v=>(d.engine==='openfoam'?v:v*s.speed/U0).toPrecision(6)).join(' '));lines.push('SCALARS pressure_relative_Pa float 1','LOOKUP_TABLE default');for(let i=0;i<g.N;i++)lines.push((d.engine==='openfoam'?d.pressure[i]*s.density:(d.rho[i]-1)/3*s.density*(s.speed/U0)**2).toPrecision(6));if(d.engine==='openfoam'){for(const [name,values] of [['Q_s-2',d.q],['turbulent_energy_m2_s2',d.tke]])if(values){lines.push('SCALARS '+name+' float 1','LOOKUP_TABLE default');for(const value of values)lines.push(Number.isFinite(value)?value.toPrecision(6):'nan');}if(d.vorticity){lines.push('VECTORS vorticity_s-1 float');for(let i=0;i<g.N;i++)lines.push(Array.from(d.vorticity.slice(i*3,i*3+3)).map(v=>Number.isFinite(v)?v.toPrecision(6):'nan').join(' '));}}lines.push('SCALARS solid int 1','LOOKUP_TABLE default');for(const v of state.solid)lines.push(String(v));return lines.join('\n');}
async function showOnshape(){const c=await api.onshapeStatus();$('connectionState').textContent=c.connected?'Keys saved for '+c.origin:'Not connected · set up once below';$('credentials').open=!c.connected;$('disconnect').disabled=!c.connected;$('onshapeUrl').value=state.source||'';$('onshapeError').textContent='';$('onshapeDialog').showModal();$('onshapeBrowser').classList.toggle('hidden',!c.connected);if(c.connected)await browseDocuments();}
async function importOnshape(link){setBusy(true);$('stop').disabled=true;$('status').textContent='Downloading the Part Studio from Onshape…';try{const f=await api.onshapeImport(link),g=await parseModel(f);g.rotateX(-Math.PI/2);if(g.userData?.parts)g.userData.parts=g.userData.parts.map(p=>{const v=p.slice();for(let i=0;i<v.length;i+=3){v[i+1]=p[i+2];v[i+2]=-p[i+1];}return v;});let reduction=null;if(triangleCount(g.getAttribute('position')?.array||[])>DECIMATE_TARGET_TRIANGLES){$('status').textContent='Simplifying a large Onshape model…';reduction=reduceGeometry(g);}const selectedStudio=browseStudios.find(x=>x.link===link.split('?')[0]);const selectedName=link===state.source?state.name:selectedStudio?selectedStudio.name+($('onshapePart').value?' · '+$('onshapePart').selectedOptions[0].text:''):f.name;$('status').textContent='Cleaning Onshape geometry…';try{const cleaned=await prepareImport(g);installGeometry(g,selectedName,f.link,true,cleaned);}finally{g.dispose();}document.querySelectorAll('[data-sample]').forEach(b=>b.classList.remove('selected'));$('onshapeDialog').close();await useOnshapeMaterial(true).catch(e=>{$('materialSource').textContent='Material lookup unavailable: '+e.message;});toast((f.workspace?'Imported in meters. Refresh anytime after editing in Onshape.':'Imported a fixed Onshape version. Use a workspace link to follow design changes.')+simplifiedNote(reduction));}catch(e){$('status').textContent='Onshape import failed. Your existing model is still available.';throw e;}finally{setBusy(false);}}
$('connect').onclick=async()=>{try{$('connect').disabled=true;$('onshapeError').textContent='Verifying read access with Onshape…';const c=await api.onshapeConnect({origin:$('onshapeOrigin').value,access:$('accessKey').value,secret:$('secretKey').value});$('accessKey').value=$('secretKey').value='';$('connectionState').textContent='Connected to '+c.origin+' · read access verified';$('credentials').open=false;$('disconnect').disabled=false;$('onshapeError').textContent='';$('onshapeBrowser').classList.remove('hidden');await browseDocuments();}catch(e){$('onshapeError').textContent=errorText(e);}finally{$('connect').disabled=false;}};
$('importOnshape').onclick=async()=>{try{$('importOnshape').disabled=true;$('onshapeError').textContent='Downloading your Part Studio…';await importOnshape($('onshapeUrl').value.trim());}catch(e){$('onshapeError').textContent=errorText(e);}finally{$('importOnshape').disabled=false;}};
$('disconnect').onclick=handle(async()=>{await api.onshapeDisconnect();$('onshapeBrowser').classList.add('hidden');$('connectionState').textContent='Keys removed from this PC.';$('credentials').open=true;$('disconnect').disabled=true;});
$('onshapeHelp').onclick=handle(()=>api.onshapeHelp());$('onshape').onclick=handle(showOnshape);$('refreshOnshape').onclick=handle(()=>importOnshape(state.source));
$('openCase').onclick=handle(()=>api.foamCase(state.result?.folder));$('saveCleaned').onclick=handle(()=>save('stl',state.name.replace(/\.(stl|obj)$/i,'')+'-cleaned',cleanedSTL()));$('run').onclick=handle(()=>startRun());$('stop').onclick=stopRun;$('importModel').onclick=handle(openModel);
$('openProject').onclick=handle(async()=>{const f=await api.open('project');if(f){loadProject(JSON.parse(new TextDecoder().decode(f.bytes)));await reopenSelectedStudy();};});$('saveProject').onclick=handle(()=>save('project',state.name.replace(/\.(stl|obj)$/i,''),JSON.stringify(projectData())));
$('exportCSV').onclick=handle(()=>save('csv','AeroDesk-results',csvData()));$('exportVTK').onclick=handle(()=>save('vtk','AeroDesk-flow',vtkData()));
document.querySelectorAll('[data-sample]').forEach(b=>b.onclick=()=>sample(b.dataset.sample));
for(const id of ['fluidMedium','groundMode','groundClearance','length','speed','yaw','pitch','roll','re','quality','steps','density','engine','ransQuality','cpuWorkers','computeBackend','nu','roughness','referenceArea','intensity','turbulenceRatio'])$(id).addEventListener('change',()=>{if(id==='fluidMedium'){const preset=fluidPresets[$('fluidMedium').value];$('density').value=preset.density;$('nu').value=preset.nu;}if(id==='groundMode'&&+$('groundClearance').value>5*+$('length').value)$('groundClearance').value=.1*+$('length').value;if($('fluidMedium').value==='water'||$('groundMode').value!=='none')$('engine').value='openfoam';if(id==='referenceArea')state.referenceAreaKind='entered';if(id==='length'&&state.referenceAreaKind==='model-projection')estimateReferenceArea();updateAreaBasis();syncReynoldsInput();invalidate();if(['yaw','pitch','roll'].includes(id))rebuildModel();updatePlan();});
$('ransRe').addEventListener('change',()=>{try{$('ransRe').setCustomValidity('');$('speed').value=String(speedForReynolds(+$('ransRe').value,+$('length').value,+$('nu').value));syncReynoldsInput();invalidate();}catch(e){$('ransRe').setCustomValidity(e.message);invalidate();$('status').textContent=e.message;toast(e.message);}});
for(const axis of ['X','Z'])$('rotate'+axis).onclick=()=>{state.base['rotate'+axis](Math.PI/2);rotateManualCG(axis);if(state.referenceAreaKind==='model-projection')estimateReferenceArea();invalidate();rebuildModel();updatePlan();};
for(const [id,mode] of [['viewFlow','flow'],['viewSlice','slice'],['viewModel','model']])$(id).onclick=()=>{state.mode=mode;document.querySelectorAll('.segmented button').forEach(b=>b.classList.toggle('active',b.id===id));$('legend').classList.toggle('hidden',!state.result||mode==='model');drawFlow();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>selectView(b.dataset.view));
for(const id of ['materialName','materialDensity','cgMode','cgX','cgY','cgZ'])$(id).addEventListener('change',handle(()=>{applyMaterial(readMaterial());updateAnalysis();}));
$('centersToggle').onclick=()=>{state.showCenters=state.showCenters===false;centersGroup.visible=state.showCenters;$('centersToggle').setAttribute('aria-pressed',String(state.showCenters));};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))resetView();});
$('resetView').onclick=resetView;$('help').onclick=$('methodLink').onclick=()=>$('helpDialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
initAnalysisUI();sample('sphere');
window.connectionProof=async()=>{await showOnshape();return api.onshapeStatus();};
window.testOnshapeImport=async link=>{if(!link)throw Error('Set AERODESK_TEST_ONSHAPE_URL to your own Part Studio URL.');await importOnshape(link);ensureClean();return {ok:true,cleanup:state.cleanup,length:+$('length').value,assessmentClosed:!$('planeAssessment').open};};
window.testOnshapeBrowse=async()=>{
 await showOnshape();const docs=await api.onshapeBrowse({kind:'documents'});if(!docs.items.length)throw Error('No accessible documents to test.');
 const doc=docs.items.find(x=>/astra|solid|plane/i.test(x.name))||docs.items[0];$('onshapeDocument').value=doc.id;await $('onshapeDocument').onchange();
 if(!$('onshapeWorkspace').value){const opts=$('onshapeWorkspace').options;if(opts.length<2)throw Error('No workspace found.');$('onshapeWorkspace').value=opts[1].value;await $('onshapeWorkspace').onchange();}
 if(!$('onshapeStudio').value){if(!browseStudios.length)throw Error('No Part Studio found.');$('onshapeStudio').value=(browseStudios.find(x=>/solid/i.test(x.name))||browseStudios[0]).id;$('onshapeStudio').onchange();}
 const options=Array.from($('onshapePart').options);const solid=options.find(o=>/full|solid body|part 1/i.test(o.text)&&o.value)||options.find(o=>o.value);if(solid){$('onshapePart').value=solid.value;$('onshapePart').onchange();}const link=$('onshapeUrl').value;if(!link)throw Error('Picker did not produce an import link.');try{await importOnshape(link);}catch(e){throw Error(errorText(e)+' — '+doc.name+' / '+$('onshapeStudio').selectedOptions[0].text);}
 if(!state.source||!state.cleanup.ready)throw Error('Imported geometry is not ready: '+JSON.stringify(state.cleanup));
 const originalLink=state.source;await importOnshape(originalLink);if(state.source!==originalLink||!state.cleanup.ready)throw Error('Onshape refresh did not preserve the selected solid.');return {connected:true,documents:docs.items.length,document:doc.name,partStudios:browseStudios.length,imported:true,refresh:true,referenceArea:settings().referenceArea,referenceAreaKind:settings().referenceAreaKind,triangles:state.base.attributes.position.count/3,lengthMeters:+$('length').value,cleanupReady:state.cleanup.ready};
};
window.runSmokeTest=async()=>{sample('sphere');
  $('engine').value='preview';updateFacts();
  const checks=[];const check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);};
  check('WebGL model rendered',!!state.mesh&&renderer.info.render.calls>=0);
  const p=projectData();loadProject(JSON.parse(JSON.stringify(p)));check('Project roundtrip',state.name==='Sphere'&&state.base.attributes.position.count>100);
  const obj=await parseModel({name:'tetra.obj',bytes:new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4')});check('OBJ parser',obj.attributes.position.count===12);obj.dispose();
  const stl=await parseModel({name:'test.stl',bytes:new TextEncoder().encode('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test')});check('ASCII STL parser',stl.attributes.position.count===3);stl.dispose();
  const binary=new ArrayBuffer(134);const dv=new DataView(binary);dv.setUint32(80,1,true);dv.setFloat32(108,1,true);dv.setFloat32(124,1,true);const bg=await parseModel({name:'binary.stl',bytes:new Uint8Array(binary)});check('Binary STL parser',bg.attributes.position.count===3);bg.dispose();
  const box=new T.BoxGeometry(1,1,1).toNonIndexed(),verts=box.attributes.position.array,dropBuffer=new ArrayBuffer(84+50*verts.length/9),dropView=new DataView(dropBuffer);dropView.setUint32(80,verts.length/9,true);for(let t=0;t<verts.length/9;t++)for(let k=0;k<9;k++)dropView.setFloat32(84+t*50+12+k*4,verts[t*9+k],true);box.dispose();
  const dropped=new File([dropBuffer],'dragged-box.STL');
  async function dispatchDrop(files){const transfer=new DataTransfer();for(const f of files)transfer.items.add(f);const enter=new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true});window.dispatchEvent(enter);check('Drop target appears',!$('dropOverlay').classList.contains('hidden'));const event=new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});window.dispatchEvent(event);const success=await dropTask;check('Drop navigation prevented',event.defaultPrevented);check('Drop target cleared',$('dropOverlay').classList.contains('hidden'));return success;}
  check('Dropped binary STL imports',await dispatchDrop([dropped])&&state.name==='dragged-box.STL'&&state.base.attributes.position.count===36);
  check('Invalid drop preserves model',!(await dispatchDrop([new File(['oops'],'bad.txt')]))&&state.name==='dragged-box.STL');
  check('Multiple drops preserve model',!(await dispatchDrop([dropped,dropped]))&&state.name==='dragged-box.STL');
  loadProject(p);
  await showOnshape();check('Onshape setup dialog',$('onshapeDialog').open);$('onshapeDialog').close();
  startRun(800);check('Active simulation rejects drop',!(await dispatchDrop([dropped]))&&state.name==='Sphere'&&!!state.worker);const begin=performance.now();while(state.worker&&performance.now()-begin<180000)await new Promise(r=>setTimeout(r,250));check('Worker completed',!state.worker&&state.result?.type==='done');check('Finite drag',Number.isFinite(state.history.at(-1).cd)&&state.history.at(-1).cd>0);check('Computed streamlines',flowGroup.children.length>0&&flowGroup.children[0].geometry.attributes.position.count>100);$('viewSlice').click();check('Velocity slice',flowGroup.children[0]?.isMesh);$('viewFlow').click();check('CSV export',csvData().includes('iteration,drag_coefficient'));check('VTK export',vtkData().includes('POINT_DATA 65536'));check('Export buttons enabled',!$('exportCSV').disabled);$('toast').classList.add('hidden');const output={ok:checks.every(c=>c.ok),checks,last:state.history.at(-1),elapsedSeconds:state.elapsed};await new Promise(r=>setTimeout(r,300));return output;
};

window.runRansSmokeTest=async()=>{ $('engine').value='openfoam';$('ransQuality').value='draft';sample('body');await startRans();if(!state.result||state.result.engine!=='openfoam'||state.streamlineCount<200)throw Error('RANS UI integration failed: '+$('status').textContent);if(state.result.ux[0]<10||state.result.ux[0]>30||Math.abs(state.result.uy[0])>5)throw Error('Sampled velocity components incorrect');const result={ok:true,inletSample:[state.result.ux[0],state.result.uy[0],state.result.uz[0]],cells:state.result.cells,iterations:state.result.iteration,streamlines:state.streamlineCount,elapsed:state.elapsed,converged:state.result.converged,last:state.history.at(-1),case:state.result.folder};$('viewSlice').click();if(!flowGroup.children[0]?.isMesh)throw Error('RANS slice failed');$('viewFlow').click();if(!vtkData().includes('pressure_relative_Pa')||!csvData().includes('OpenFOAM'))throw Error('RANS export failed');await new Promise(r=>setTimeout(r,500));renderer.render(scene,camera);return result;};

function cleanedSTL(){return asciiSTL(state.mesh.geometry.attributes.position.array,settings().length);}

window.runCleanupSmokeTest=async()=>{
  const checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);};
  const box=new T.BoxGeometry(1,1,1).toNonIndexed(),v=Array.from(box.attributes.position.array);box.dispose();
  const dirty=[...v,...v.slice(0,9),...Array(9).fill(100)];[dirty[3],dirty[6]]=[dirty[6],dirty[3]];[dirty[4],dirty[7]]=[dirty[7],dirty[4]];[dirty[5],dirty[8]]=[dirty[8],dirty[5]];
  setBusy(true);try{await importLocalModel({name:'dirty-test.stl',bytes:new TextEncoder().encode(asciiSTL(new Float32Array(dirty)))});}finally{setBusy(false);}
  check('Imported STL cleaned in worker',state.cleanup.ready&&state.cleanup.duplicateFaces===1&&state.cleanup.degenerateFaces===1&&state.cleanup.reorientedFaces>0);check('Repair summary shown',$('cleanupTitle').textContent.includes('Auto-cleaned'));
  const r=state.cleanup;const exported=cleanedSTL(),g=await parseModel({name:'cleaned.stl',bytes:new TextEncoder().encode(exported)});check('Cleaned STL roundtrips',cleanMesh(g.attributes.position.array).report.ready);g.dispose();
  const bad=projectData();bad.vertices=bad.vertices.slice(9);loadProject(bad);let blocked=false;try{startRun();}catch{blocked=true;}check('Open model blocks simulation',blocked&&!state.cleanup.ready&&!state.worker&&!ransRunning);check('Unresolved issues expanded',$('cleanupReport').open);
  const savedName=state.name;try{await importLocalModel({name:'broken.stl',bytes:new TextEncoder().encode('solid empty\nendsolid empty')});}catch{}check('Failed import preserves model',state.name===savedName);
  sample('sphere');check('Sample model stays valid',state.cleanup.ready);await new Promise(r=>setTimeout(r,300));return {ok:true,checks,repairReport:r};
};

window.openStartupProject=async text=>{loadProject(JSON.parse(text));await reopenSelectedStudy();return {name:state.name,cleanup:state.cleanup};};
window.testModelImport=async file=>{await importLocalModel({...file,bytes:new Uint8Array(file.bytes)});ensureClean();return {ok:true,name:state.name,cleanup:state.cleanup};};
window.runStartupProject=async(visualQA=false,restore=false)=>{const setupChecks=visualQA?window.runViewerSetupChecks():null;if(restore)await window.restoreSavedResult();else await startRans();if(state.result?.engine!=='openfoam')throw Error($('status').textContent);await new Promise(r=>setTimeout(r,500));const upgrades=visualQA?window.runUpgradeChecks():null;const viewer=visualQA?window.checkViewerResult():null;const analysis=visualQA?window.checkAnalysisResult():null;const interaction=visualQA?await window.checkSliceInteraction():null;await new Promise(r=>setTimeout(r,300));const plane=visualQA?window.checkPlaneAssessment():state.assessment;return {ok:true,upgrades,setupChecks,viewer,analysis,interaction,plane,model:state.name,cleanup:state.cleanup,settings:state.settings,reynoldsUsed:reynoldsNumber(state.settings),displayedReynolds:$('reValue').textContent,reynoldsLabel:$('reLabel').textContent,csvHasReynolds:csvData().includes('# Reynolds_number_used: '+reynoldsNumber(state.settings)),cells:state.result.cells,iterations:state.result.iteration,converged:state.result.converged,elapsed:state.elapsed,streamlines:state.streamlineCount,last:state.history.at(-1),case:state.result.folder};};

window.runReynoldsChecks=()=>{if(!state.base)sample('sphere');
 const checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);},saved=projectData();
 const change=(id,value)=>{$(id).value=String(value);$(id).dispatchEvent(new Event('change'));};
 change('engine','openfoam');change('length',1);change('nu',.000015);change('ransRe',1e6);
 check('Reynolds input changes actual inlet velocity',settings().speed===15&&settings().reynolds===1e6);
 check('Fluid viscosity stays physical',settings().nu===.000015);
 check('Reynolds is visibly displayed',$('reValue').textContent==='1.00e+6');
 change('speed',30);check('Speed change updates Reynolds',+$('ransRe').value===2e6);
 change('length',2);check('Size change updates Reynolds',+$('ransRe').value===4e6);
 change('nu',.00003);check('Viscosity change updates Reynolds',+$('ransRe').value===2e6);
 change('ransRe',1e6);const project=projectData();loadProject(JSON.parse(JSON.stringify(project)));
 check('Project restores Reynolds and speed',settings().speed===15&&+$('ransRe').value===1e6);
 const old={...project,settings:{...project.settings}};delete old.settings.reynolds;loadProject(old);
 check('Older projects derive Reynolds from physical settings',settings().reynolds===1e6);
 change('ransRe',1e10);let rejected=false;try{settings();}catch{rejected=true;}check('Out-of-range Reynolds blocks running',rejected&&+$('speed').value===15);
 change('ransRe',1e6);check('Valid correction clears the error',settings().reynolds===1e6);
 change('engine','preview');check('Preview retains its separate Reynolds range',settings().re===saved.settings.re);
 change('engine','openfoam');state.result={engine:'openfoam'};change('turbulenceRatio',5);check('Turbulence change invalidates previous results',state.result===null);$('estimateArea').click();const a=settings().referenceArea;change('length',4);check('Estimated projection scales with size squared',Math.abs(settings().referenceArea/a-4)<1e-5&&settings().referenceAreaKind==='model-projection');change('referenceArea',.8);check('Manual reference area is labeled separately',settings().referenceAreaKind==='entered');loadProject(saved);$('toast').classList.add('hidden');return {ok:true,checks};
};
function readMaterial(){
  const density=+$('materialDensity').value,cg=['X','Y','Z'].map(k=>+$('cg'+k).value),cgMode=$('cgMode').value;
  if(!Number.isFinite(density)||density<.1||density>30000)throw Error('Material density must be 0.1–30,000 kg/m³.');
  if(!cg.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)||!['uniform','manual'].includes(cgMode))throw Error('Enter finite CG coordinates in meters.');
  const name=$('materialName').value.trim().slice(0,80)||'Custom material';const properties=state.material?.name===name&&state.material?.density===density?state.material.properties:undefined;return {name,density,cgMode,cg,...(properties?{properties}:{})};
}
function applyMaterial(material){
  const m=material||{name:'Custom material',density:1000,cgMode:'uniform',cg:[0,0,0]};
  if(typeof m.name!=='string'||!Number.isFinite(m.density)||m.density<.1||m.density>30000||!['uniform','manual'].includes(m.cgMode)||!Array.isArray(m.cg)||m.cg.length!==3||!m.cg.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))throw Error('Invalid material or CG settings.');
  state.material={...m,cg:[...m.cg]};if($('materialPreset')){const i=materialLibrary.materials.findIndex(p=>p.name===m.name&&Math.abs(p.density-m.density)<.01);$('materialPreset').value=i<0?'':String(i);showMaterialProperties(materialLibrary.materials[i]||m);}$('materialName').value=m.name;$('materialDensity').value=m.density;$('cgMode').value=m.cgMode;['X','Y','Z'].forEach((k,i)=>$('cg'+k).value=m.cg[i]);$('manualCG').classList.toggle('hidden',m.cgMode!=='manual');updateCenters();
}
function rotateManualCG(axis){if(state.material?.cgMode==='manual'){const v=new T.Vector3(...state.material.cg);v.applyAxisAngle(axis==='X'?new T.Vector3(1,0,0):new T.Vector3(0,0,1),Math.PI/2);applyMaterial({...state.material,cg:v.toArray()});}}
function centerMarker(point,name,hex,provisional=false){
 const group=new T.Group(),canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d');ctx.translate(48,48);ctx.fillStyle='white';ctx.beginPath();ctx.arc(0,0,34,0,Math.PI*2);ctx.fill();ctx.strokeStyle=hex;ctx.lineWidth=7;ctx.stroke();ctx.fillStyle=hex;
 if(name==='CG'){for(const a of [0,Math.PI]){ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,25,a,a+Math.PI/2);ctx.fill();}}else if(!provisional){ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();}
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,depthTest:false,transparent:true}));sprite.scale.set(.018,.018,1);sprite.renderOrder=1001;group.add(sprite);
 if(name==='LIFT'){const groundSurface=new T.Mesh(new T.PlaneGeometry(8,6),new T.MeshStandardMaterial({color:0xd9e2e5,roughness:1,side:T.DoubleSide}));groundSurface.rotation.x=-Math.PI/2;groundSurface.visible=false;groundSurface.position.x=1;scene.add(groundSurface);
const arrow=new T.ArrowHelper(new T.Vector3(0,Math.sign(state.result.liftCenter.force[1]),0),new T.Vector3(),.055,hex,.014,.007);arrow.traverse(o=>{if(o.material){o.material.depthTest=false;o.material.transparent=true;}o.renderOrder=1000;});group.add(arrow);}
 group.userData={kind:name,provisional};group.position.fromArray(point);centersGroup.add(group);
}
function updateCenters(){
  while(centersGroup.children.length){const g=centersGroup.children[0];centersGroup.remove(g);disposeObject(g);}centersGroup.visible=state.showCenters!==false;
  const m=state.material||{name:'Custom material',density:1000,cgMode:'uniform',cg:[0,0,0]},L=+$('length').value;
  const xyz=p=>p.map(v=>Math.abs(v)<.000005?'0':v.toFixed(5)).join(', ');
  state.cg=null;
  if(state.body&&state.cleanup?.ready&&L>0){const cg=m.cgMode==='manual'?new T.Vector3(...m.cg).divideScalar(L).applyAxisAngle(new T.Vector3(1,0,0),(+$('roll').value||0)*Math.PI/180).applyAxisAngle(new T.Vector3(0,0,1),-(+$('pitch').value||0)*Math.PI/180).applyAxisAngle(new T.Vector3(0,1,0),(+$('yaw').value||0)*Math.PI/180).toArray():state.body.center;
    state.cg=cg;centerMarker(cg,'CG','#a345ad');$('cgLabel').querySelector('small').textContent=m.cgMode==='manual'?'Measured / entered':'Uniform solid estimate';$('cgResult').textContent=xyz(cg.map(v=>v*L))+' · '+(m.cgMode==='manual'?'entered':'uniform estimate');$('massResult').textContent=(state.body.volume*L**3*m.density).toPrecision(5)+' kg · '+m.name;
  }else{$('cgResult').textContent='Needs a valid closed solid.';$('massResult').textContent='—';}
  const lift=state.result?.engine==='openfoam'?state.result.liftCenter:null;state.cl=null;
  const height=(state.cg?.[1]||0)*L,location=lift?liftLocation(lift,height):null;state.liftLocation=location;state.forceLocation=lift?forceCenter(lift,height):null;
  const stable=!!(state.result?.converged&&state.result?.forceConvergence?.stable&&state.result?.reliability?.acceptable),balance=lift?liftBalance(lift,new T.Vector3(0,0,1).applyMatrix4(modelRotation(settings())).toArray()):null;
  if(location?.center){state.cl=location.center.map(v=>v/L);centerMarker(state.cl,'LIFT','#007cbb',!stable);$('clResult').textContent=xyz(location.center);$('clLabel').querySelector('b').textContent='Center of lift';$('clLabel').querySelector('small').textContent=stable?'CFD estimate':'Provisional';$('clLabel').title=location.method;
    $('centerConfidence').textContent=stable?'CFD estimate · numerical checks passed; experimental accuracy unverified.':'Provisional · '+(state.result?.reliability?.blocking?.[0]||(state.result?.reliability?.status==='screening'?'Draft screening result.':'Solver or forces have not converged.'))+' Hollow marker.';
  }else $('centerConfidence').textContent='';
  $('centerLoadBalance').textContent=balance?'Wing-side lift: '+number(balance.negative)+' / '+number(balance.positive)+' N · '+number(balance.imbalance*100)+'% imbalance.':'';
  $('centerLoadBalance').title='Signed vertical forces on the two sides of the model span midplane. Unequal loads can come from the geometry, flight condition or insufficient mesh/convergence. The marker is never snapped to the centerline.';
  $('forceAxisResult').textContent=state.forceLocation?.center?xyz(state.forceLocation.center)+' m · remaining couple '+xyz(state.forceLocation.residualMoment)+' N·m':state.forceLocation?.reason||'Run OpenFOAM to calculate.';
  if(state.cl&&state.cg){const delta=new T.Vector3(...state.cl).sub(new T.Vector3(...state.cg)).multiplyScalar(L).applyMatrix4(modelRotation(settings()).invert());$('centerSeparation').textContent=number(Math.abs(delta.x)*1000)+' mm · lift '+(delta.x>=0?'behind':'ahead of')+' CG';}else $('centerSeparation').textContent='Run a usable study to compare.';
  if(!location?.center)$('clResult').textContent=location?.reason||lift?.reason||(state.result?'Requires OpenFOAM surface loads.':'Run OpenFOAM to calculate.');
}
function selectView(name='iso'){
  const directions={front:[-1,0,0],back:[1,0,0],top:[0,1,0],bottom:[0,-1,0],left:[0,0,1],right:[0,0,-1],iso:[-1.9,1.5,2.6]},v=directions[name]||directions.iso;
  controls.enableDamping=false;controls.update();const bounds=state.mesh?new T.Box3().setFromObject(state.mesh):new T.Box3(new T.Vector3(-.5,-.5,-.5),new T.Vector3(.5,.5,.5)),sphere=bounds.getBoundingSphere(new T.Sphere()),half=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*Math.max(.3,camera.aspect))),distance=sphere.radius/Math.sin(half)*1.08;
  controls.target.copy(sphere.center);camera.up.set(...(name==='top'||name==='bottom'?[-1,0,0]:[0,1,0]));const direction=new T.Vector3(...v).normalize(),right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right),tanV=Math.tan(camera.fov*Math.PI/360),tanH=tanV*camera.aspect;let fit=.7;if(state.mesh){const p=state.mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){const point=new T.Vector3().fromBufferAttribute(p,i).sub(sphere.center),depth=point.dot(direction);fit=Math.max(fit,depth+Math.abs(point.dot(right))/(tanH*.72),depth+Math.abs(point.dot(up))/(tanV*.57));}}else fit=distance;camera.position.copy(sphere.center).add(direction.multiplyScalar(fit));camera.lookAt(sphere.center);controls.update();controls.enableDamping=true;state.selectedView=name;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
}
function drawWholeVelocity(referenceSpeed){
 const geometry=state.mesh.geometry.clone(),p=geometry.attributes.position.array,colors=new Float32Array(p.length),h=state.grid.h,values=[];let sampled=0;
 for(let i=0;i<p.length;i+=9){const a=new T.Vector3().fromArray(p,i),b=new T.Vector3().fromArray(p,i+3),c=new T.Vector3().fromArray(p,i+6),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize(),point=a.add(b).add(c).multiplyScalar(1/3).addScaledVector(normal,h),u=flowAt(point.x,point.y,point.z);values.push(u?Math.hypot(...u)/referenceSpeed*state.settings.speed:null);if(u)sampled++;}
 const scale=setDisplayScale(values,'slice');values.forEach((v,i)=>{const rgb=linearColor(v,scale);for(let j=0;j<3;j++)colors.set(rgb,i*9+j*3);});
 geometry.setAttribute('color',new T.BufferAttribute(colors,3));flowGroup.add(new T.Mesh(geometry,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide,toneMapped:false})));state.mesh.visible=false;state.velocityCoverage=sampled/(p.length/9);drawNativeMesh();
 $('viewportInfo').textContent='WHOLE-PLANE AIR SPEED · '+(100*state.velocityCoverage).toFixed(0)+'% SAMPLED · '+(h*state.settings.length).toPrecision(3)+' m OUTSIDE SURFACE';
}

window.runViewerSetupChecks=()=>{
 const saved=projectData(),checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);};
 applyAssessmentOptions({kind:'plane',targetLD:14,mass:.8});const assessmentProject=projectData();loadProject(JSON.parse(JSON.stringify(assessmentProject)));check('Plane target and mass survive reopening',readAssessmentOptions().targetLD===14&&readAssessmentOptions().mass===.8&&readAssessmentOptions().kind==='plane');const oldAssessment={...assessmentProject};delete oldAssessment.assessment;loadProject(oldAssessment);check('Older projects default to automatic plane assessment without invented mass',readAssessmentOptions().kind==='auto'&&readAssessmentOptions().mass===null);loadProject(saved);
 $('cpuWorkers').value='4';const workersProject=projectData();loadProject(JSON.parse(JSON.stringify(workersProject)));check('CPU workers survive project reopening',settings().cpuWorkers==='4');const legacy={...workersProject,settings:{...workersProject.settings}};delete legacy.settings.cpuWorkers;loadProject(legacy);check('Older projects default to automatic CPU workers',settings().cpuWorkers==='auto');loadProject(saved);
 applyMaterial({name:'Test material',density:1200,cgMode:'uniform',cg:[0,0,0]});const firstCG=[...state.cg],firstMass=state.body.volume*(+$('length').value)**3*state.material.density;
 applyMaterial({...state.material,density:2400});check('Density scales estimated mass',Math.abs(state.body.volume*(+$('length').value)**3*state.material.density-2*firstMass)<1e-9);check('Uniform density does not shift CG',state.cg.every((v,i)=>v===firstCG[i]));
 applyMaterial({...state.material,cgMode:'manual',cg:[.02,.01,-.03]});const expected=new T.Vector3(.02,.01,-.03).divideScalar(+$('length').value).applyAxisAngle(new T.Vector3(0,1,0),(+$('yaw').value)*Math.PI/180).toArray();check('Entered CG is placed in the model frame',state.cg.every((v,i)=>Math.abs(v-expected[i])<1e-10));
 const exported=projectData();loadProject(JSON.parse(JSON.stringify(exported)));check('Material and measured CG survive reopening',state.material.name==='Test material'&&state.material.density===2400&&state.material.cgMode==='manual'&&state.material.cg[0]===.02);
 let rejected=false;try{applyMaterial({...state.material,density:-1});}catch{rejected=true;}check('Invalid material density is rejected',rejected);
 for(const [view,axis] of Object.entries({front:[-1,0,0],back:[1,0,0],top:[0,1,0],bottom:[0,-1,0],left:[0,0,1],right:[0,0,-1]})){document.querySelector('[data-view="'+view+'"]').click();const direction=camera.position.clone().sub(controls.target).normalize();check(view+' camera alignment',direction.dot(new T.Vector3(...axis))>.99999);}
 document.querySelector('[data-view="iso"]').click();check('Isometric view is selectable',state.selectedView==='iso');loadProject(saved);const oldPitch=+$('pitch').value;$('pitch').value=10;rebuildModel();const base=state.base.attributes.position.array,rotated=state.mesh.geometry.attributes.position.array;let tip=0;for(let i=3;i<base.length;i+=3)if(base[i]<base[tip])tip=i;check('Positive angle of attack raises the upstream nose',rotated[tip+1]>base[tip+1]&&settings().pitch===10);$('pitch').value=oldPitch;rebuildModel();return checks;
};
window.checkViewerResult=()=>{
 if(!state.result?.liftCenter?.center)throw Error('Lift center failed: '+state.result?.liftCenter?.reason);
 $('viewSlice').click();selectView('top');
 if(!flowGroup.children[0]?.isMesh||state.mesh.visible||state.velocityCoverage<.7)throw Error('Whole-plane velocity coverage is insufficient: '+state.velocityCoverage);
 if(centersGroup.children.length!==2||!state.cg||!state.cl)throw Error('Center markers are missing');
 return {forceLocation:state.forceLocation,mode:state.mode,wholeModelFaces:flowGroup.children[0].geometry.attributes.position.count/3,velocityCoverage:state.velocityCoverage,view:state.selectedView,material:state.material||readMaterial(),cg:state.cg.map(v=>v*state.settings.length),lift:state.result.liftCenter,markers:centersGroup.children.length};
};

function setDisplayScale(values,key){
  const mode=$('colorRange').value,manual=[+$('colorMin').value,+$('colorMax').value];
  let scale=fieldScale(values,key,mode,manual,state.settings?.speed||20);
  if(key==='layers'&&mode!=='manual')scale={...scale,min:0,max:state.result?.layerCoverage?.requested||state.result?.plan?.wall?.layers||Math.max(1,scale.actualMax),clipped:0};
  if(key==='section'&&fields.section.referenceSpeed&&mode==='auto'){
    if(state.velocityScaleResult!==state.result){state.velocityScaleResult=state.result;const all=volumeValues('speed'),g=state.grid,box=new T.Box3().setFromObject(state.mesh).expandByScalar(.18),near=[];
      for(let i=0;i<all.length;i++){const x=g.origin[0]+(i%g.nx+.5)*g.h,y=g.origin[1]+(Math.floor(i/g.nx)%g.ny+.5)*g.h,z=g.origin[2]+(Math.floor(i/(g.nx*g.ny))+.5)*g.h;if(x>=box.min.x&&x<=box.max.x&&y>=box.min.y&&y<=box.max.y&&z>=box.min.z&&z<=box.max.z)near.push(all[i]);}
      state.velocityScale=velocityContrast(near,state.settings.speed);}
    scale={...state.velocityScale,actualMin:scale.actualMin,actualMax:scale.actualMax,clipped:values.filter(v=>Number.isFinite(v)&&(v<state.velocityScale.min||v>state.velocityScale.max)).length,count:values.length};
  }state.displayScale=scale;
  const def=fields[key]||fields.flow;
  $('legend').firstElementChild.textContent=def.label+' · '+def.unit+(def.referenceSpeed?' · inlet '+number(state.settings.speed)+' m/s':'');
  $('legend').querySelector('.color-ramp').style.background='linear-gradient(90deg,'+ramps[scale.palette].join(',')+')';
  $('legend').querySelector('.legend-values').innerHTML=[scale.min,(scale.min+scale.max)/2,scale.max].map(v=>'<span>'+number(v)+'</span>').join('');
  $('scaleNote').textContent=(mode==='auto'?'Auto · central 96%':mode==='manual'?'Manual limits':'Full / reference range')+' · '+scale.clipped+' values clipped';
  if(key==='section'&&def.referenceSpeed&&mode==='auto')$('scaleNote').textContent='Near-model contrast · locked while dragging · '+scale.clipped+' values clipped';
  if(key==='section')$('scaleNote').textContent+=(def.referenceSpeed&&mode==='fixed'?' · fixed to inlet speed':'')+' · actual '+number(scale.actualMin)+'–'+number(scale.actualMax)+' '+def.unit+(def.referenceSpeed&&mode==='auto'&&(scale.actualMax-scale.actualMin)<state.settings.speed*.02?' · nearly uniform flow on this plane':'');
  if(key==='layers')$('scaleNote').textContent=scale.count?'Native layer counts mapped onto CAD · red = missing':'Layer counts were not saved for this run. Re-run to inspect them.';
  $('scaleNote').title='Actual range: '+number(scale.actualMin)+' to '+number(scale.actualMax)+' '+def.unit+'. Clipping changes colors only; probes and exports retain original values.';
  if(mode!=='manual'){$('colorMin').value=scale.min.toPrecision(5);$('colorMax').value=scale.max.toPrecision(5);}
  $('manualRange').classList.toggle('hidden',mode!=='manual');
  return scale;
}
function number(v){return !Number.isFinite(v)?'—':v===0?'0':Math.abs(v)<.001||Math.abs(v)>=10000?v.toExponential(2):Number(v.toPrecision(4)).toString();}
function linearColor(v,scale=state.displayScale){return new T.Color(...colorValue(v,scale)).convertSRGBToLinear().toArray();}
function selectMode(mode){if(state.mode!==mode&&state.adviceReady){clearAdviceMarkers();}if(mode==='section'&&state.mode!=='section'){state.beforeSliceColors={mode:$('colorRange').value,min:$('colorMin').value,max:$('colorMax').value};$('colorRange').value=state.sliceColorMode||'auto';if(state.sliceManualRange){$('colorMin').value=state.sliceManualRange[0];$('colorMax').value=state.sliceManualRange[1];}}else if(state.mode==='section'&&mode!=='section'){if($('colorRange').value==='manual')state.sliceManualRange=[$('colorMin').value,$('colorMax').value];const saved=state.beforeSliceColors;$('colorRange').value=saved?.mode||'auto';if(saved){$('colorMin').value=saved.min;$('colorMax').value=saved.max;}}state.mode=mode;$('colorRange').classList.toggle('hidden',['model','cloud'].includes(mode));if(['model','cloud'].includes(mode))$('manualRange').classList.add('hidden');$('surfaceField').classList.toggle('hidden',['flow','slice','model','section','vortex','cloud'].includes(mode));for(const id of ['linePlane','lineDensity'])$(id).closest('label').classList.toggle('hidden',mode!=='flow');$('linePositionControl').classList.toggle('hidden',mode!=='flow'||$('linePlane').value==='all');$('volumeControls').classList.toggle('hidden',mode!=='section');$('isoControls').classList.toggle('hidden',!['vortex','cloud'].includes(mode));if(['vortex','cloud'].includes(mode)){$('isoThreshold').value=mode==='cloud'?-.2:defaultQ();$('isoUnit').textContent=mode==='cloud'?'Cp':'s⁻²';}document.querySelectorAll('[data-field]').forEach(b=>b.classList.toggle('active',b.dataset.field===mode));$('surfaceField').value=fields[mode]&&!['slice','flow'].includes(mode)?mode:'pressure';$('legend').classList.toggle('hidden',!state.result||mode==='model');drawFlow();}
function surfaceMapping(){
  if(state.surfaceMap?.result===state.result)return state.surfaceMap.weights;
  const panels=state.result.liftCenter?.panels||[],sample=surfaceSampler(panels),p=state.mesh.geometry.attributes.position.array,L=state.settings.length,weights=[];
  for(let i=0;i<p.length;i+=9){const a=new T.Vector3().fromArray(p,i),b=new T.Vector3().fromArray(p,i+3),c=new T.Vector3().fromArray(p,i+6),normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();weights.push(sample(a.add(b).add(c).multiplyScalar(L/3).toArray(),normal.toArray()));}
  state.surfaceMap={result:state.result,weights};return weights;
}
function drawSurfaceField(){
  const loads=state.result.liftCenter,def=fields[state.mode];
  if(!loads?.panels?.length){$('viewportInfo').textContent='SURFACE FIELDS REQUIRE AN OPENFOAM RUN';$('legend').classList.add('hidden');return;}
  const q=.5*state.settings.density*state.settings.speed**2,values=loads.panels.map(p=>def.value(p,q)),scale=setDisplayScale(values,state.mode),weights=surfaceMapping(),g=state.mesh.geometry.clone(),colors=new Float32Array(g.attributes.position.array.length);
  state.surfaceValues=weights.map(w=>w.length&&w.every(([i])=>Number.isFinite(values[i])&&values[i]!==null)?w.reduce((sum,[i,a])=>sum+a*values[i],0):null);
  state.surfaceValues.forEach((v,i)=>{const c=linearColor(v,scale);for(let k=0;k<3;k++)colors.set(c,i*9+k*3);});
  g.setAttribute('color',new T.BufferAttribute(colors,3));const mesh=new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide,toneMapped:false}));flowGroup.add(mesh);state.mesh.visible=false;
  $('viewportInfo').textContent=def.label.toUpperCase()+' · INTERPOLATED FROM '+loads.faces.toLocaleString()+' CFD WALL FACES · CLICK TO PROBE';
  drawNativeMesh();
}
function drawNativeMesh(){
  if(!$('meshToggle').checked||!state.result?.liftCenter?.polygons)return;const {points,polygons}=state.result.liftCenter,L=state.settings.length,p=[];
  for(const f of polygons)for(let k=0;k<f.length;k++)p.push(...points[f[k]].map(v=>v/L),...points[f[(k+1)%f.length]].map(v=>v/L));
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));flowGroup.add(new T.LineSegments(g,new T.LineBasicMaterial({color:0x193b52,transparent:true,opacity:.35,depthTest:false})));
}
function readAssessmentOptions(){return assessmentOptions({kind:$('planeKind').value,targetLD:Number($('planeTarget').value),mass:$('planeMass').value.trim()===''?null:Number($('planeMass').value)});}
window.runUpgradeChecks=()=>{
 const checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);},project=projectData(),result=state.result,s=state.settings;
 check('Opening a project leaves setup visible',!document.body.classList.contains('focus-view'));
 check('Assessment stays closed until requested',!$('planeAssessment').open);
 check('Snapshot removed and Fit/Focus appear only in view controls',!$('snapshot')&&$('resetView').closest('.view-nav')&&$('focusView').closest('.view-nav')&&!document.querySelector('.view-toolbar #resetView'));
 check('Cube provides all six clickable faces',document.querySelectorAll('.cube-face[data-view]').length===6);
 check('Ground-level wind arrow stays visible',arrow.visible&&arrow.position.y<state.mesh.geometry.boundingBox.min.y);
 $('focusView').click();check('Focus can hide sidebar',document.body.classList.contains('focus-view'));$('focusView').click();check('Setup can be restored',!document.body.classList.contains('focus-view'));
 showHotspots();check('Numbered regions correspond to measured evidence',state.spatial.drag.length>0&&adviceMarkers.children.length===state.spatial.drag.length+state.spatial.turbulence.length);clearAdviceMarkers();
 check('Manual is bundled in the app',$('helpDialog').querySelector('iframe').getAttribute('src')==='manual.html');
 $('newProject').click();check('New project offers save/cancel before clearing',$('newDialog').open);$('newBlank').click();check('New project clears geometry and results',state.base===null&&state.result===null&&!$('planeAssessment').open);loadProject(project);state.settings=s;installRansResult(result,s);return checks;
};
window.checkPlaneAssessment=()=>{
  const checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);},saved=readAssessmentOptions(),material=readMaterial(),result=state.result;
  updatePlaneAssessment();const initial=state.assessment;
  check('User plane is detected from its shape',initial.active&&state.planeShape.candidate);
  if(!result?.reliability?.acceptable||!result.converged||!result.forceConvergence?.stable){check('Unverified CFD cannot produce a plane score',initial.score===null);check('Quality report explains limitations',analysisReport().includes($('reliabilitySummary').textContent.replaceAll('&','&amp;')));return {ok:true,checks,score:null};}
  check('Native CFD produces a bounded provisional score',Number.isInteger(initial.score)&&initial.score>=0&&initial.score<=100);
  check('Unmeasured CG and flying mass are not silently inferred',initial.checks.find(c=>c.id==='trim').value===null&&initial.checks.find(c=>c.id==='weight').value===null);
  $('planeMass').value=initial.metrics.supportedMass;$('planeMass').dispatchEvent(new Event('input'));
  check('Mass input updates lift match immediately',Math.abs(state.assessment.checks.find(c=>c.id==='weight').value-1)<1e-9);
  $('planeTarget').value=20;$('planeTarget').dispatchEvent(new Event('input'));
  check('Target changes rescore without changing CFD',state.result===result&&state.assessment.checks[0].value<initial.checks[0].value);
  const stored=JSON.parse(JSON.stringify(projectData()));check('Project includes assessment preferences',stored.assessment.targetLD===20&&stored.assessment.mass>0);
  applyMaterial({...material,cgMode:'manual',cg:[0,0,0]});updateAnalysis();check('Manual CG enables trim diagnostic',state.assessment.checks.find(c=>c.id==='trim').value!==null);
  $('planeMass').value=-1;$('planeMass').dispatchEvent(new Event('input'));check('Invalid mass clears stale scores',state.assessment===null&&$('planeAdvice').textContent==='');
  applyAssessmentOptions(saved);applyMaterial(material);updateAnalysis();
  check('PDF includes assessment limitations',analysisReport().includes('Static/dynamic stability')&&analysisReport().includes('Provisional plane score'));
  check('Stability is explicitly unassessed',state.assessment.stability.startsWith('Not assessed'));
  return {checks,assessment:state.assessment,shape:state.planeShape};
};
window.qaPlaneView=async()=>{selectMode('pressure');selectView('iso');document.body.classList.remove('focus-view');$('planeAssessment').open=true;document.querySelector('.results').scrollTop=0;updatePlaneAssessment();await new Promise(r=>setTimeout(r,400));return state.assessment;};
function applyAssessmentOptions(options){const o=assessmentOptions(options);$('planeKind').value=o.kind;$('planeTarget').value=o.targetLD;$('planeMass').value=o.mass??'';}
function updatePlaneAssessment(){
  if(!state.base)return;
  try{
    const attr=state.base.attributes.position;
    if(state.assessmentGeometry!==state.base||state.assessmentVersion!==attr.version){state.assessmentGeometry=state.base;state.assessmentVersion=attr.version;state.planeShape=planeShape(attr.array);}
    const s=state.result?state.settings:settings();
    state.assessment=assessPlane({shape:state.planeShape,options:readAssessmentOptions(),result:state.result,settings:s,cg:state.cg?.map(v=>v*s.length),measuredCG:state.material?.cgMode==='manual'});
    if(state.stabilityStudy){state.assessment.stability=state.stabilityStudy.findings.map(f=>f.label+': '+f.status).join('; ')+'. Dynamic stability remains untested.';state.assessment.tips=state.assessment.tips.filter(t=>!t.title.startsWith('Test stability'));}
    if(state.studies?.filter(r=>r.include!==false).length>1)state.assessment=assessStudySet(state.studies,{shape:state.planeShape,options:readAssessmentOptions(),settings:s,cg:state.material?.cg,measuredCG:state.material?.cgMode==='manual'});
    $('planeAdvice').innerHTML=assessmentHTML(state.assessment);$('planeError').textContent='';
    $('planeSummary').textContent=state.assessment.score===null?'Plane assessment':('Plane score '+state.assessment.score+'/100 · provisional');
  }catch(e){state.assessment=null;$('planeAdvice').replaceChildren();$('planeError').textContent=e.message;$('planeSummary').textContent='Plane assessment · check inputs';}
}
function planeReportHTML(){updatePlaneAssessment();return '<h2>Plane assessment</h2><p>Target L/D '+$('planeTarget').value+'; actual flying mass '+($('planeMass').value||'not entered')+' kg. Flight speed '+state.settings.speed+' m/s; pitch '+state.settings.pitch+'°; yaw '+state.settings.yaw+'°; roll '+state.settings.roll+'°.</p>'+(state.assessment?assessmentHTML(state.assessment).replaceAll('<details>','<details open>'):'<p>Assessment unavailable: invalid inputs.</p>');}
function updateAnalysis(){
  updatePlaneAssessment();updateDiagnostics();renderStudies();
  const r=state.result,l=r?.liftCenter,s=state.settings,available=!!l?.panels?.length;
  $('analysisEmpty').classList.toggle('hidden',available);$('analysisContent').classList.toggle('hidden',!available);
  for(const id of ['exportSurface','exportReport'])$(id).disabled=!available;
  if(!available){$('loadChart').getContext('2d').clearRect(0,0,$('loadChart').width,$('loadChart').height);return;}
  const f=l.force,m=state.cg?shiftedMoment(l.moment,f,state.cg.map(v=>v*s.length)):l.moment,q=.5*s.density*s.speed**2;
  $('forceTable').innerHTML=['Drag +X','Lift +Y','Side +Z'].map((label,k)=>'<tr><th>'+label+'</th><td>'+number(l.pressureForce[k])+'</td><td>'+number(l.viscousForce[k])+'</td><td>'+number(f[k])+'</td></tr>').join('');
  $('momentTable').innerHTML=['Roll +X','Yaw +Y','Pitch +Z'].map((label,k)=>'<tr><th>'+label+'</th><td>'+number(l.moment[k])+'</td><td>'+number(m[k])+'</td></tr>').join('');
  $('efficiency').textContent=Math.abs(f[0])>1e-8?number(f[1]/f[0]):'—';$('dragPower').textContent=number(f[0]*s.speed)+' W';$('dynamicPressure').textContent=number(q)+' Pa';
  const stability=forceStability(state.history),yp=l.panels.map(p=>p.yPlus).filter(v=>v!==null&&Number.isFinite(v)),area=l.panels.reduce((a,p)=>a+p.area,0);
  const yMean=yp.length?l.panels.reduce((a,p)=>a+(p.yPlus||0)*p.area,0)/area:null;
  renderReliability(r);$('meshInfo').textContent=r.cells.toLocaleString()+' volume cells · '+l.faces.toLocaleString()+' wall faces';
  $('yPlusInfo').textContent=yp.length?number(Math.min(...yp))+' / '+number(yMean)+' / '+number(Math.max(...yp))+' · min / area mean / max':'Unavailable';
  $('forceStability').textContent=stability?(stability.relative===null?'Near-zero Cd; range '+number(stability.spread):(100*stability.relative).toFixed(2)+'% range / mean')+' · last '+stability.count+' iterations':'Needs 10 iterations';
  $('qualityAdvice').textContent=(r.forceConvergence?.stable?'Forces settled over the checked history window. ':'Force stability not established. ')+(s.referenceAreaKind==='model-projection'?'Coefficients use estimated full-model projection, not measured wing area. ':'')+'Fully turbulent SST: transition is not modeled. '+(r.converged?'Residual targets met. ':'Residual targets not met. ')+(l.faces<2000?'Coarse wall mesh: surface detail and lift location need a finer-mesh comparison. ':'Compare a finer mesh before trusting loads. ')+(yMean>5?'Wall y+ is above the viscous-sublayer target; inspect layer coverage and wall treatment. ':'A low average y+ alone does not establish boundary-layer accuracy. ')+(l.cancellationRatio<.1?'Lift is sensitive to cancellation of opposing loads. ':'');
  const parts=connectedLoads(l.points,l.polygons,l.panels);$('partsTable').innerHTML=parts.map((p,i)=>'<tr><th>'+(i+1)+' · '+p.faces+' faces</th>'+p.force.map(v=>'<td>'+number(v)+'</td>').join('')+'</tr>').join('');
  $('loadSummary').textContent='Signed lift by span · '+number(f[1])+' N total';drawLoadChart(loadBins(l.panels));
}
function renderReliability(result){
 const el=$('reliabilitySummary'),mesh=$('meshComparison');if(!el||!mesh)return;mesh.replaceChildren();
 const r=result.reliability;if(!r){el.textContent='Legacy run · the new wall-layer and convergence checks were not recorded. Re-run at a quality level to check them.';return;}
 el.textContent=(result.plan?.label?result.plan.label+' · ':'')+(r.acceptable?'Numerical checks passed. ':r.status==='screening'?'Draft screening result. ':'Needs review. ')+[...r.blocking,...r.warnings].join(' ');
 if(result.residualCheck&&result.forceConvergence?.window){const p=document.createElement('p');p.textContent='Acceptance checks: all equation residuals ≤ '+result.residualCheck.target.toExponential(1)+' ('+(result.residualCheck.passed?'met':'not met')+'); all forces and moments stable over '+result.forceConvergence.window+' iterations ('+(result.forceConvergence.stable?'met':'not met')+').';mesh.append(p);}
 if(result.groundCheck){const p=document.createElement('p'),g=result.groundCheck;p.textContent='Ground wall: '+(g.passed?'checks passed':'needs review')+(Number.isFinite(g.yPlusFraction)?' · '+(g.yPlusFraction*100).toFixed(1)+'% at y+ ≤ 2 · '+(g.coverage*100).toFixed(1)+'% layer coverage · '+g.mean.toFixed(1)+' / '+g.requested+' layers.':' · '+(g.reason||'No native wall evidence'));mesh.append(p);}
 if(result.flowCheck){const p=document.createElement('p');p.textContent=Number.isFinite(result.flowCheck.relativeImbalance)?'Flow conservation: '+(result.flowCheck.relativeImbalance*100).toExponential(2)+'% imbalance; limit '+(result.flowCheck.tolerance*100)+'% · '+(result.flowCheck.passed?'passed':'needs review')+'.':result.flowCheck.reason;mesh.append(p);}
 if(r.layers){const p=document.createElement('p');p.textContent='Wall layers: '+number(r.layers.mean)+' / '+r.layers.requested+' area mean; '+number(r.layers.coverage*100)+'% surface coverage. '+number(r.wall.areaFractionInTarget*100)+'% of surface meets the y+ target.';mesh.append(p);}
 if(r.meshComparison){const title=document.createElement('b');title.textContent='Mesh comparison';mesh.append(title);for(const pair of r.meshComparison.pairs){const p=document.createElement('p');p.textContent=pair.force?pair.from.toLocaleString()+' → '+pair.to.toLocaleString()+' cells · '+(pair.passed?'within limits':'not within limits')+' · drag change '+number(pair.force[0].change)+' N; lift change '+number(pair.force[1].change)+' N'+(pair.liftCenter?' · lift location change: '+number(pair.liftCenter.frontBack*1000)+' mm front–back, '+number(pair.liftCenter.span*1000)+' mm across span':''):pair.reason;mesh.append(p);}const p=document.createElement('p');p.textContent=r.meshComparison.reason;mesh.append(p);}
}
function drawLoadChart(bins){
  const c=$('loadChart'),r=c.getBoundingClientRect();c.width=Math.max(1,r.width*2);c.height=Math.max(1,r.height*2);const ctx=c.getContext('2d');ctx.scale(2,2);const w=r.width,h=r.height,max=Math.max(...bins.map(b=>Math.abs(b.lift/b.width)),1e-9),zero=h*.5;
  ctx.strokeStyle='#ccd9e2';ctx.beginPath();ctx.moveTo(28,zero);ctx.lineTo(w,zero);ctx.stroke();
  bins.forEach((b,i)=>{const x=30+(w-35)*i/bins.length,v=b.lift/b.width,y=v/max*(h*.36);ctx.fillStyle=v>=0?'#2b8fc2':'#de8559';ctx.fillRect(x,Math.min(zero,zero-y),(w-35)/bins.length-1,Math.abs(y));});ctx.fillStyle='#718399';ctx.font='9px Segoe UI';ctx.fillText(number(max)+' N/m',0,10);ctx.fillText('−Z',30,h-2);ctx.fillText('+Z',w-18,h-2);
}
function surfaceCSV(){
  const l=state.result.liftCenter,q=.5*state.settings.density*state.settings.speed**2;
  return ['# Native CFD wall faces; coordinates in meters; forces on solid; moments use model center','# Cp=p_relative/q; Cf=wall_shear_magnitude/q; q='+q+' Pa','face,x_m,y_m,z_m,area_m2,pressure_Pa,Cp,shear_Pa,Cf,y_plus,boundary_layers,drag_N,lift_N,side_N,pressure_drag_N,friction_drag_N',...l.panels.map(p=>[p.index,...p.center,p.area,p.pressurePa,p.pressurePa/q,p.shearPa,p.shearPa/q,p.yPlus??'',p.layers??'',...p.force,p.pressureForce[0],p.viscousForce[0]].join(','))].join('\n');
}
function analysisReport(){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),r=state.result,l=r.liftCenter,s=state.settings;
  return '<!doctype html><html><meta charset="utf-8"><title>AeroDesk analysis</title><style>body{font:15px system-ui;color:#23394a;max-width:950px;margin:50px auto;padding:20px}h1{font-size:32px}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:10px;border-bottom:1px solid #dbe4ea;text-align:right}th:first-child{text-align:left}img{width:100%;border:1px solid #ddd}small{color:#61778a}@media print{body{margin:0}h2{break-after:avoid}table,img{break-inside:avoid}}</style><h1>'+esc(state.name)+' · analysis</h1><p>'+new Date().toISOString()+' · AeroDesk 0.14.0 · OpenFOAM v2512, steady RANS k–ω SST</p><p>'+esc(environmentLabel(s))+'. Forces exclude hydrostatic buoyancy.</p><p>U='+s.speed+' m/s; Re='+scientificReynolds(reynoldsNumber(s))+'; ρ='+s.density+' kg/m³; ν='+s.nu+' m²/s; reference area='+s.referenceArea+' m² ('+esc(s.referenceAreaKind==='model-projection'?'estimated full-model projection, including tail and body':'entered reference area')+'); roughness Ks='+(s.roughness||0)+' m.</p><img src="'+renderer.domElement.toDataURL('image/png')+'"><p>Displayed field: '+esc(fields[state.mode]?.label||state.mode)+'. '+esc($('viewportInfo').textContent)+'. '+($('legend').classList.contains('hidden')?'':esc($('scaleNote').textContent)+'. Range '+number(state.displayScale?.min)+' to '+number(state.displayScale?.max))+'.</p><h2>Forces · N</h2><table><tr><th>Direction</th><th>Pressure</th><th>Friction</th><th>Total</th></tr>'+$('forceTable').innerHTML+'</table><h2>Moments · N·m</h2><table><tr><th>Axis</th><th>Model center</th><th>CG</th></tr>'+$('momentTable').innerHTML+'</table><p>Lift / drag: '+esc($('efficiency').textContent)+'; drag power: '+esc($('dragPower').textContent)+'.</p><h2>Balance</h2><p>CG: '+esc($('cgResult').textContent)+' m. Center of lift at CG height: '+esc($('clResult').textContent)+' m.</p><p>'+esc($('centerConfidence').textContent)+' '+esc($('centerLoadBalance').textContent)+'</p><p>CG is a uniform-solid estimate unless manually entered. The displayed lift line uses signed vertical surface forces. Drag and side-force moments are separate. This is not the aerodynamic center or a stability prediction.</p>'+planeReportHTML()+studyReportHTML()+'<h2>Computed regions</h2><p>'+esc($('hotspotList').textContent)+'</p><h2>Stability studies</h2><p>'+esc($('sweepFindings').textContent||'Not performed')+'</p><h2>AI suggestions</h2><p>'+esc(state.aiReview?.text||'Not requested')+'</p><h2>Quality</h2><p>'+esc($('meshInfo').textContent)+'. y+: '+esc($('yPlusInfo').textContent)+'. Cd stability: '+esc($('forceStability').textContent)+'.</p><p>'+esc($('reliabilitySummary').textContent)+'</p><p>'+esc($('meshComparison').textContent)+'</p><p>'+esc($('qualityAdvice').textContent)+'</p><small>Surface colors interpolate native wall-face data onto CAD. Velocity colors sample outside the surface. No transient, multiphase, aeroacoustic or adjoint solver is included.</small></html>';
}
function placeCenterLabels(){for(const id of ['cgLabel','clLabel']){$(id).classList.add('hidden');$(id+'Line').style.display='none';}return;

  if(!$('cgLabel'))return;const rect=$('viewer').getBoundingClientRect();
  for(const [id,point,dx,dy] of [['cgLabel',state.cg,-65,27],['clLabel',state.cl,23,-37]]){
    const el=$(id);el.classList.toggle('hidden',!point||state.showCenters===false);if(!point||state.showCenters===false)continue;
    const p=new T.Vector3(...point).project(camera);if(p.z>1||p.z< -1){el.classList.add('hidden');continue;}
    const x=(p.x+1)*rect.width/2,y=(1-p.y)*rect.height/2,lx=Math.max(12,Math.min(rect.width-150,x+dx)),ly=Math.max(70,Math.min(rect.height-135,y+dy));
    el.style.left=lx+'px';el.style.top=ly+'px';const line=$(id+'Line');line.setAttribute('x1',x);line.setAttribute('y1',y);line.setAttribute('x2',lx+22);line.setAttribute('y2',ly+12);line.style.display='';
  }
  for(const [id,point] of [['cgLabel',state.cg],['clLabel',state.cl]])if(!point||state.showCenters===false)$(id+'Line').style.display='none';
}
function initAnalysisUI(){
  $('resultsPlane').onclick=()=>{const card=$('planeAssessment');card.open=true;card.scrollIntoView({block:'start',behavior:'smooth'});};
  for(const id of ['planeKind','planeTarget','planeMass'])$(id).addEventListener('input',updatePlaneAssessment);
  $('planeCG').onclick=()=>{document.body.classList.remove('focus-view');$('cgMode').closest('details').open=true;$('cgMode').scrollIntoView({block:'center',behavior:'smooth'});$('cgMode').focus();};
  $('resultsOverview').onclick=()=>document.querySelector('.results').scrollTop=0;$('resultsForces').onclick=()=>{const t=$('analysisContent').querySelector('details');t.open=true;t.scrollIntoView({block:'start',behavior:'smooth'});};$('resultsQuality').onclick=()=>{const t=$('qualityAdvice').closest('details');t.open=true;t.scrollIntoView({block:'start',behavior:'smooth'});};
  document.querySelectorAll('[data-field]').forEach(b=>b.onclick=()=>selectMode(b.dataset.field));$('surfaceField').onchange=()=>selectMode($('surfaceField').value);
  $('colorRange').onchange=handle(()=>{if(state.mode==='section')state.sliceColorMode=$('colorRange').value;drawFlow();});for(const id of ['colorMin','colorMax'])$(id).onchange=handle(()=>{fieldScale([],state.mode,'manual',[+$('colorMin').value,+$('colorMax').value]);drawFlow();});
  $('meshToggle').onchange=()=>drawFlow();$('lineDensity').onchange=()=>drawFlow();$('linePlane').onchange=()=>{$('linePositionControl').classList.toggle('hidden',state.mode!=='flow'||$('linePlane').value==='all');drawFlow();};$('linePosition').oninput=queueStreamlineDraw;$('linePosition').onchange=queueStreamlineDraw;for(const id of ['slicePlane','volumeField','isoThreshold','isoDetail'])$(id).onchange=handle(drawFlow);$('slicePosition').oninput=queueSliceDraw;$('slicePosition').onchange=queueSliceDraw;$('gridToggle').onchange=()=>{floor.visible=tunnel.visible=$('gridToggle').checked;arrow.visible=true;};
  $('focusView').onclick=()=>{const focus=document.body.classList.toggle('focus-view');$('focusView').textContent=focus?'← Setup':'⛶ Focus';$('focusView').setAttribute('aria-pressed',String(focus));setTimeout(()=>selectView(state.selectedView),50);};
  $('exportSurface').onclick=handle(()=>save('csv','AeroDesk-surface-loads',surfaceCSV()));$('exportReport').onclick=handle(()=>{renderer.render(scene,camera);return save('pdf','AeroDesk-analysis',analysisReport());});
  $('chartQuantity').onchange=drawChart;
  let down;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
  renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4||!fields[state.mode]||['flow','slice'].includes(state.mode))return;
    const rect=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const hit=ray.intersectObject(flowGroup.children.find(c=>c.isMesh)||state.mesh)[0];if(!hit)return;
    const value=state.surfaceValues?.[hit.faceIndex],def=fields[state.mode];$('probe').textContent=def.label+': '+number(value)+' '+def.unit+' · XYZ '+hit.point.toArray().map(v=>number(v*state.settings.length)).join(', ')+' m · interpolated';$('probe').classList.remove('hidden');
  });
}
function defaultQ(){
 const values=Array.from(state.result?.q||[]).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);return values.length?Number(values[Math.floor(values.length*.99)].toPrecision(4)):1;
}
let volumeCacheResult=null,volumeCache=new Map(),sliceFrame=0,streamlineFrame=0;
function queueStreamlineDraw(){
 if(streamlineFrame)return;
 streamlineFrame=requestAnimationFrame(()=>{streamlineFrame=0;if(state.mode!=='flow'||!state.result||$('linePlane').value==='all')return;try{clearFlow();drawStreamlines();}catch(e){toast(e.message);}});
}
function queueSliceDraw(){
 if(sliceFrame)return;
 sliceFrame=requestAnimationFrame(()=>{sliceFrame=0;if(state.mode!=='section'||!state.result)return;try{clearFlow();drawVolume();}catch(e){toast(e.message);}});
}
function volumeValues(key){
 if(volumeCacheResult!==state.result){volumeCacheResult=state.result;volumeCache.clear();}
 if(volumeCache.has(key))return volumeCache.get(key);
 const r=state.result,s=state.settings,N=state.grid.N,out=new Float32Array(N),reference=r.engine==='openfoam'?s.speed:U0;
 for(let i=0;i<N;i++){
   if(state.solid[i]){out[i]=NaN;continue;}
   const speed=Math.hypot(r.ux[i],r.uy[i],r.uz[i])/reference*s.speed;
   out[i]=key==='speed'?speed:key==='cp'?(r.pressure?.[i]??NaN)/(.5*s.speed**2):key==='q'?r.q?.[i]??NaN:key==='tke'?r.tke?.[i]??NaN:r.vorticity?Math.hypot(...r.vorticity.slice(i*3,i*3+3)):NaN;
 }volumeCache.set(key,out);return out;
}
function drawVolume(){
 const g=state.grid,r=state.result,section=state.mode==='section',cloud=state.mode==='cloud';
 if(r.engine!=='openfoam'){$('viewportInfo').textContent='VOLUME ANALYSIS REQUIRES OPENFOAM';return;}
 if(!section){
   const threshold=+$('isoThreshold').value;if(!Number.isFinite(threshold)||(state.mode==='vortex'&&threshold<=0))throw Error('Q vortex threshold must be positive; pressure threshold must be finite.');
   const values=volumeValues(cloud?'cp':'q'),detail=+$('isoDetail').value,cacheKey=(cloud?'cp':'q')+':'+threshold+':'+detail;
   if(state.isoCacheResult!==r){state.isoCacheResult=r;state.isoCache=new Map();}
   if(!state.isoCache.has(cacheKey)){if(state.isoCache.size>3)state.isoCache.clear();state.isoCache.set(cacheKey,refinedIsoSurface(g,values,state.solid,threshold,detail));}
   const {positions,normals}=state.isoCache.get(cacheKey),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('normal',new T.BufferAttribute(normals,3));
   if(cloud)flowGroup.add(new T.Mesh(geometry,new T.MeshStandardMaterial({color:threshold<0?0x3182c7:0xe36f3f,transparent:true,opacity:.62,roughness:.38,metalness:.04,side:T.DoubleSide,depthWrite:false})));
   else {
     const speeds=[];for(let i=0;i<positions.length;i+=3){const u=flowAt(positions[i],positions[i+1],positions[i+2]);speeds.push(u?Math.hypot(...u):null);}
     fields.vortex={label:'Vortex flow speed',unit:'m/s',palette:'velocity'};
     const scale=setDisplayScale(speeds,'vortex'),colors=new Float32Array(positions.length);speeds.forEach((v,i)=>colors.set(linearColor(v,scale),i*3));geometry.setAttribute('color',new T.BufferAttribute(colors,3));
     flowGroup.add(new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.58,metalness:0,side:T.DoubleSide,toneMapped:false})));state.vortexSpeeds=speeds;
   }
   $('legend').classList.toggle('hidden',cloud);$('viewportInfo').textContent=(cloud?'PRESSURE CLOUD · Cp = ':'VORTICES COLORED BY SPEED · Q = ')+number(threshold)+(cloud?'':' s⁻²')+' · '+(positions.length/9).toLocaleString()+' DISPLAY TRIANGLES · '+(detail===2?'REFINED INTERPOLATION':'RESAMPLED FIELD');
   if(cloud)$('scaleNote').textContent=positions.length?'Isosurface from the solved mean field':'No surface at this threshold';state.isoTriangles=positions.length/9;return;
 }
 const key=$('volumeField').value,def={speed:['Flow speed','m/s','velocity'],cp:['Pressure coefficient','Cp','diverging'],vorticity:['Vorticity magnitude','s⁻¹','sequential'],q:['Q criterion','s⁻²','diverging'],tke:['Turbulent kinetic energy','m²/s²','sequential']}[key];
 fields.section={label:def[0],unit:def[1],palette:def[2],referenceSpeed:key==='speed',fixed:key==='cp'?[-1,1]:undefined};const axis=+$('slicePlane').value,all=volumeValues(key),{positions,values,coordinate}=sliceSurface(g,all,state.solid,axis,+$('slicePosition').value/100);
 const scale=setDisplayScale(values,'section'),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('scalar',new T.Float32BufferAttribute(values,1));flowGroup.add(new T.Mesh(geometry,sliceMaterial(scale)));
 $('viewportInfo').textContent=def[0].toUpperCase()+' SLICE · '+['X','Y','Z'][axis]+' = '+number(coordinate*state.settings.length)+' m · RESAMPLED GRID';state.sliceCells=values.length/6;state.sliceCoordinate=coordinate;state.sliceDraws=(state.sliceDraws||0)+1;
}
window.checkAnalysisResult=()=>{
 const checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);},r=state.result,l=r.liftCenter,s=state.settings,q=.5*s.density*s.speed**2,last=state.history.at(-1);
 check('Pressure and viscous force sum to native total',Math.abs(l.force[0]-last.drag)<Math.max(1e-5,Math.abs(last.drag)*.005));
 check('Side force uses viewer +Z',Math.abs(l.force[2]-last.cz*q*s.referenceArea)<Math.max(1e-5,Math.abs(l.force[2])*.01));
 check('Integrated moments agree with solver axes',[last.mx,last.my,last.mz].every((v,k)=>Math.abs(v-l.moment[k])<Math.max(1e-6,Math.abs(v)*.01)));
 check('Lift line has reference height zero',l.center===null||l.center[1]===0);check('Native wall y+ exists',l.panels.every(p=>Number.isFinite(p.yPlus)));
 for(const plane of ['all','vertical','horizontal']){$('linePlane').value=plane;selectMode('flow');check(plane+' streamlines trace the solved field',state.streamlineCount>10);}$('linePlane').value='all';
 const fieldsTest=[];
 for(const mode of ['pressure','pressurePa','friction','cf','drag','yplus']){selectMode(mode);const valid=state.surfaceValues.filter(v=>v!==null&&Number.isFinite(v));check(mode+' covers CAD with a finite legend',valid.length>state.surfaceValues.length*.7&&Number.isFinite(state.displayScale.min)&&state.displayScale.max>state.displayScale.min);fieldsTest.push({mode,coverage:valid.length/state.surfaceValues.length,scale:state.displayScale});}
 $('colorRange').value='manual';$('colorMin').value=-1;$('colorMax').value=1;selectMode('pressure');check('Manual color limits apply',state.displayScale.min===-1&&state.displayScale.max===1);$('colorRange').value='auto';
 $('meshToggle').checked=true;drawFlow();check('Native surface mesh overlay',flowGroup.children.some(c=>c.isLineSegments));$('meshToggle').checked=false;
 for(const field of ['speed','cp','vorticity','q','tke']){$('volumeField').value=field;selectMode('section');check(field+' slice contains real samples',state.sliceCells>100);}
 for(const plane of [0,1,2]){$('slicePlane').value=plane;selectMode('section');check('Slice plane '+plane,state.sliceCells>100);}
 selectMode('vortex');check('Native Q isosurface rendered',state.isoTriangles>0);const vc=flowGroup.children[0].geometry.attributes.color.array;check('Vortices carry finite velocity colors and speed legend',vc.every(Number.isFinite)&&new Set(Array.from(vc,v=>v.toFixed(3))).size>8&&!$('legend').classList.contains('hidden')&&$('legend').textContent.includes('m/s')&&state.vortexSpeeds.some(v=>v>0));selectMode('cloud');check('Native pressure cloud rendered',state.isoTriangles>0);
 selectMode('pressure');selectView('top');renderer.render(scene,camera);const rect=renderer.domElement.getBoundingClientRect();controls.enabled=false;for(const type of ['pointerdown','pointerup'])renderer.domElement.dispatchEvent(new PointerEvent(type,{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}));controls.enabled=true;check('Surface click probes a value',!$('probe').classList.contains('hidden')&&$('probe').textContent.includes('Cp'));
 check('Surface CSV exports physical values',surfaceCSV().includes('pressure_drag_N,friction_drag_N'));check('Native VTK contains Q and vorticity',vtkData().includes('VECTORS vorticity_s-1'));
 check('Printable report includes loads and limitations',analysisReport().includes('Forces · N')&&analysisReport().includes('No transient'));
 selectMode('pressure');selectView('iso');updateAnalysis();return {checks,fields:fieldsTest,force:l.force,moment:l.moment,liftLine:l.center,wallFaces:l.faces,cells:r.cells};
};
window.qaAnalysisView=async mode=>{selectMode(mode);selectView(mode==='section'?'left':'iso');if(mode==='pressure')document.body.classList.add('focus-view');if(mode==='friction')document.querySelector('.results').scrollTop=document.querySelector('.results').scrollHeight;await new Promise(resolve=>setTimeout(resolve,300));selectView(mode==='section'?'left':'iso');renderer.render(scene,camera);return {mode,isoTriangles:state.isoTriangles,sliceCells:state.sliceCells};};
window.qaAnalysisReport=()=>analysisReport();

function installRansResult(d,s){if(d.resultId&&!state.loadingStudy&&!state.studyRunning)rememberStudy(d,s);state.spatial=null;clearAdviceMarkers();state.result=d;state.grid=d.grid;state.solid=d.solid;state.history=d.history;state.elapsed=d.elapsed;state.area=s.referenceArea;$('coefficientBasis').textContent=s.referenceAreaKind==='model-projection'?'Using estimated full-model area':'Using entered reference area';const last=d.history.at(-1);$('cd').textContent=last.cd.toFixed(4);$('lift').textContent=last.cy.toFixed(4);$('drag').textContent=last.drag.toPrecision(5);$('change').textContent=d.change.toExponential(2);$('areaValue').textContent=s.referenceArea.toPrecision(4)+' m²';$('elapsed').textContent=d.elapsed.toFixed(1)+' s';$('iteration').textContent=d.iteration+' iterations · '+d.cells.toLocaleString()+' cells · '+(d.execution?.backend==='gpu'?'GPU pressure + CPU':(d.execution?.workers||1)+' CPU worker'+((d.execution?.workers||1)===1?'':'s'));$('progress').style.width='100%';$('stateBadge').textContent=d.reliability?.acceptable?'Numerical checks passed':d.converged?'Converged · review quality':'Unconverged · review quality';updateFacts();$('status').textContent=(d.converged?'Residual and load targets met.':'Partial result: convergence targets were not met.')+' '+(d.reliability?.acceptable?'Numerical checks passed; experimental accuracy remains unvalidated.':'Inspect Quality for remaining limitations.');$('viewportInfo').textContent='OPENFOAM RANS · SAMPLED VELOCITY';$('emptyHint').classList.add('hidden');$('legend').classList.toggle('hidden',state.mode==='model');$('exportCSV').disabled=$('exportVTK').disabled=false;drawFlow();drawChart();}
window.restoreSavedResult=async()=>{const s=settings();const d=await api.foamRestore({settings:s,vertices:state.mesh.geometry.attributes.position.array});state.settings=s;installRansResult(d,s);$('openCase').disabled=false;return {ok:true,cells:d.cells,last:d.history.at(-1)};};

window.checkSliceInteraction=async()=>{
 const saved=$('slicePosition').value,plane=$('slicePlane').value,field=$('volumeField').value;
 $('slicePlane').value='2';$('volumeField').value='speed';selectMode('section');
 const before=state.sliceDraws,start=performance.now(),originalSpeed=settings().speed,originalRe=reynoldsNumber(settings());
 for(const value of [41,42,43.25]){$('slicePosition').value=value;$('slicePosition').dispatchEvent(new Event('input',{bubbles:true}));}
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const expected=state.grid.origin[2]+(.4325*(state.grid.nz-1)+.5)*state.grid.h;
 if(state.sliceDraws!==before+1||Math.abs(state.sliceCoordinate-expected)>1e-8)throw Error('Slice must move before release and coalesce rapid input events');
 if($('colorRange').value!=='auto'||state.displayScale.max-state.displayScale.min<.099*state.settings.speed)throw Error('Velocity slice must use a bounded contrast range');const lockedRange=[state.displayScale.min,state.displayScale.max];
 const elapsed=performance.now()-start,times=[];
 for(const value of [44.15,45.35,47.55,49.75]){
   const started=performance.now(),draws=state.sliceDraws;$('slicePosition').value=value;$('slicePosition').dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const target=state.grid.origin[2]+(value/100*(state.grid.nz-1)+.5)*state.grid.h;
   if(state.sliceDraws!==draws+1||Math.abs(state.sliceCoordinate-target)>1e-8||state.displayScale.min!==lockedRange[0]||state.displayScale.max!==lockedRange[1])throw Error('Slice did not follow ongoing drag');times.push(performance.now()-started);
 }
 if(settings().speed!==originalSpeed||reynoldsNumber(settings())!==originalRe)throw Error('Display formatting must preserve full simulation precision');
 $('slicePosition').value=saved;$('slicePlane').value=plane;$('volumeField').value=field;selectMode('pressure');
 $('colorRange').value='manual';$('colorMin').value=-1;$('colorMax').value=1;drawFlow();selectMode('section');selectMode('pressure');if(state.displayScale.min!==-1||state.displayScale.max!==1)throw Error('Slice colors changed the surface manual range');$('colorRange').value='auto';drawFlow();return {ok:true,liveInput:true,coalesced:true,continuous:true,manualRangePreserved:true,lockedVelocityContrast:true,elapsedMs:elapsed,ongoingDragMs:times,physicsPreserved:true};
};

api.foamInfo().then(info=>{$('gpuStatus').textContent=info.gpu?.message||'GPU solver is not installed.';$('computeBackend').querySelector('[value=gpu]').disabled=!info.gpu?.ready;}).catch(()=>{$('gpuStatus').textContent='GPU setup status unavailable; CPU solving remains available.';});

window.qaVelocitySliceScale=async mode=>{selectMode('section');$('colorRange').value=mode;state.sliceColorMode=mode;$('volumeField').value='speed';$('slicePlane').value='2';$('slicePosition').value='0';drawFlow();selectView('iso');await new Promise(resolve=>setTimeout(resolve,250));renderer.render(scene,camera);return {mode,scale:state.displayScale,coordinate:state.sliceCoordinate,inlet:state.settings.speed,note:$('scaleNote').textContent};};

function updateViewCube(){const el=$('viewCube');if(!el)return;const q=camera.quaternion.clone().invert(),m=new T.Matrix4().makeRotationFromQuaternion(q),flip=new T.Matrix4().makeScale(1,-1,1);m.premultiply(flip).multiply(flip);el.style.transform='matrix3d('+m.elements.join(',')+')';}
function createBlankProject(){if(busy)return;state.studies=[];state.selectedStudy=null;renderStudies();$('newDialog').close();state.base?.dispose();state.base=null;if(state.mesh){scene.remove(state.mesh);disposeObject(state.mesh);}state.mesh=null;state.body=null;state.cleanup=null;state.source=null;state.settings=null;state.assessment=null;state.planeShape=null;state.name='Untitled';state.stabilityStudy=null;clearFlow();invalidate();$('planeAdvice').replaceChildren();$('planeAssessment').open=false;$('modelName').textContent='No model';$('modelDetails').textContent='Import CAD to begin';$('studyTitle').textContent='Untitled / new project';$('cleanupReport').classList.add('hidden');$('emptyHint').classList.remove('hidden');$('emptyHint').querySelector('strong').textContent='Start a new project';$('emptyHint').querySelector('span').textContent='Import STEP, 3MF, STL or OBJ, or connect CAD.';$('refreshOnshape').classList.add('hidden');$('status').textContent='New project. Choose a model on the left.';document.body.classList.remove('focus-view');$('planeSummary').textContent='Plane assessment';resetView();}
$('newProject').onclick=()=>{if(!busy)$('newDialog').showModal();};$('newBlank').onclick=createBlankProject;$('newSave').onclick=handle(()=>save('project',state.name,JSON.stringify(projectData())));

const adviceMarkers=new T.Group();scene.add(adviceMarkers);state.adviceReady=true;
function clearAdviceMarkers(){$('designCallout')?.classList.add('hidden');const group=scene.children.find(c=>c.name==='advice-markers');if(group){while(group.children.length){const c=group.children[0];group.remove(c);disposeObject(c);}}}
adviceMarkers.name='advice-markers';
function updateDiagnostics(){
 const ready=state.result?.engine==='openfoam'&&state.result.liftCenter?.panels?.length;
 $('showHotspots').disabled=$('askAI').disabled=!ready;$('runStability').disabled=busy||!ready||!freeFlight(state.settings||settings());
 if(!ready){$('hotspotList').textContent='Run OpenFOAM to locate measured drag and turbulence regions.';return;}
 if(!state.spatial)state.spatial=spatialFindings(state.result,state.settings);
 $('hotspotList').replaceChildren();
 for(const r of [...state.spatial.drag,...state.spatial.turbulence]){
  const a=regionAdvice(r,state.result.converged),card=document.createElement('button');card.className='advice-card';
  const badge=document.createElement('span');badge.className='region-badge';badge.textContent=r.id;
  const title=document.createElement('strong');title.textContent=a.title;
  const evidence=document.createElement('small');evidence.textContent=a.evidence;
  card.append(badge,title,evidence);card.onclick=()=>showHotspots(r.id);$('hotspotList').append(card);
 }
}
function showHotspots(selected){
 clearAdviceMarkers();if(!state.spatial)return;selectMode('pressure');
 const regions=[...state.spatial.drag,...state.spatial.turbulence],active=typeof selected==='string'?regions.find(p=>p.id===selected):null;
 for(const p of active?[active]:regions){
  const group=new T.Group(),color=p.id[0]==='D'?'#c9693b':'#765cc5',point=new T.Vector3(...p.xyz).divideScalar(state.settings.length),size=(p.regionSizeM||state.settings.length*.12)/state.settings.length;
  const ring=new T.Mesh(new T.SphereGeometry(size*.55,24,16),new T.MeshBasicMaterial({color,transparent:true,opacity:.16,depthWrite:false}));ring.position.copy(point);group.add(ring);
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const c=canvas.getContext('2d');c.fillStyle=color;c.beginPath();c.roundRect(2,2,124,60,12);c.fill();c.fillStyle='#fff';c.font='600 32px Segoe UI';c.textAlign='center';c.fillText(p.id,64,44);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,depthTest:false}));sprite.position.copy(point).add(new T.Vector3(0,size*.8,0));sprite.scale.set(.054,.027,1);sprite.renderOrder=1100;group.add(sprite);
  const line=new T.Line(new T.BufferGeometry().setFromPoints([point,sprite.position]),new T.LineBasicMaterial({color,depthTest:false}));line.renderOrder=1099;group.add(line);adviceMarkers.add(group);
 }
 $('designCallout').classList.toggle('hidden',!active);
 if(active){const a=regionAdvice(active,state.result.converged);$('adviceTag').textContent=active.id+' · '+a.tag;$('adviceTitle').textContent=a.title;$('adviceEvidence').textContent=a.evidence;$('adviceAction').textContent=a.action;$('adviceVerify').textContent=a.verify;}
}
$('closeAdvice').onclick=()=>{clearAdviceMarkers();$('designCallout').classList.add('hidden');};
async function runStability(){if(busy)return;if(!freeFlight(state.settings||settings()))throw Error('Flight-stability assessment requires air in open space. Use Angle studies to compare underwater or ground-effect forces.');if(state.material?.cgMode!=='manual')throw Error('Enter the measured ready-to-fly CG before running stability studies.');if(!state.result||state.settings.engine!=='openfoam')throw Error('Run the baseline OpenFOAM study first.');const baseline=state.result,s={...state.settings};if(Math.abs(s.yaw)>1e-6||Math.abs(s.roll)>1e-6)throw Error('Use a baseline with zero yaw and roll for this sweep.');const cg=[...state.material.cg],samples=[];state.sweeping=true;state.sweepCancelled=false;setBusy(true);$('runStability').disabled=true;state.stabilityStudy=null;$('sweepFindings').replaceChildren();try{for(const [axis,offset] of [['pitch',-3],['pitch',3],['yaw',-3],['yaw',3]]){if(state.sweepCancelled)throw Error('Stability studies stopped; no stability verdict was produced.');state.sweepIndex=samples.length+1;const test={...s,[axis]:s[axis]+offset},geometry=solverGeometry(test);let result;try{result=await api.foamRun({settings:test,vertices:geometry.attributes.position.array,cleanupReport:state.cleanup});}finally{geometry.dispose();}if(state.sweepCancelled)throw Error('Stability studies stopped.');rememberStudy(result,test);samples.push({...sweepSample(result,test,cg),axis});}state.stabilityStudy={samples,findings:stabilityFindings(samples,s),settings:s,cg};for(const f of state.stabilityStudy.findings){const p=document.createElement('p');p.textContent=f.label+': '+f.status+'. Slope '+(f.slopeNmPerDegree?.toPrecision(3)||'—')+' N·m/°. '+f.advice;$('sweepFindings').append(p);}$('sweepStatus').textContent='Four studies completed. Model and baseline result preserved. '+(state.stabilityStudy.findings.some(f=>f.status.startsWith('Inconclusive'))?'Some responses need better convergence or resolution.':'Static trends only; confirm on a finer mesh.');}catch(e){$('sweepStatus').textContent=e.message;throw e;}finally{state.sweeping=false;state.result=baseline;setBusy(false);updatePlaneAssessment();updateDiagnostics();renderStudies();}}
$('showHotspots').onclick=showHotspots;$('runStability').onclick=handle(runStability);
async function fillAIModels(){const models=await api.aiModels(),selected=$('aiModel').value||localStorage.getItem('aerodesk-ai-model');$('aiModel').replaceChildren(...models.map(m=>new Option(m,m)));if(models.includes(selected))$('aiModel').value=selected;else if(models.includes('gpt-5-mini'))$('aiModel').value='gpt-5-mini';}
$('aiModel').onchange=()=>localStorage.setItem('aerodesk-ai-model',$('aiModel').value);
$('aiSettings').onclick=handle(async()=>{$('aiDialog').showModal();const s=await api.aiStatus();$('aiConnection').textContent=s.connected?'Connected using '+s.source:'Not connected. Enter an API key to enable AI advice.';if(s.connected)await fillAIModels();});
$('connectAI').onclick=async()=>{try{$('connectAI').disabled=true;$('aiError').textContent='Verifying…';await api.aiConnect($('aiKey').value);$('aiKey').value='';$('aiConnection').textContent='Connected · key encrypted on this PC';await fillAIModels();$('aiError').textContent='';}catch(e){$('aiError').textContent=errorText(e);}finally{$('connectAI').disabled=false;}};
$('disconnectAI').onclick=handle(async()=>{const s=await api.aiDisconnect();$('aiConnection').textContent=s.connected?'Saved key removed; environment key remains active.':'Key removed.';});$('getAIKey').onclick=handle(()=>api.apiKeys());
function reviewEvidence(){return {condition:state.settings,assessment:state.assessment,quality:{converged:state.result.converged,forceConvergence:state.result.forceConvergence,cells:state.result.cells,wallFaces:state.result.liftCenter.faces,reliability:state.result.reliability||{acceptable:false,status:'legacy'},meshSensitivity:state.result.reliability?.meshComparison||'unverified'},spatial:state.spatial,stability:state.stabilityStudy||'See study-set findings',angleStudies:state.studies.filter(r=>r.include!==false).map(r=>({environment:environmentLabel(r.settings),pitch:r.settings.pitch,yaw:r.settings.yaw,speed:r.settings.speed,status:r.status,converged:r.summary?.converged,forceStable:r.summary?.forceConvergence?.stable,reliability:r.summary?.reliability||{acceptable:false,status:"legacy"},force:r.summary?.liftCenter?.force,moment:r.summary?.liftCenter?.moment,cells:r.summary?.cells})),cg:state.material?.cgMode==='manual'?state.material.cg:'not measured'};}
$('askAI').onclick=async()=>{try{if(!state.result)throw Error('Run OpenFOAM first.');const status=await api.aiStatus();if(!status.connected){$('aiSettings').click();return;}if(!$('aiModel').value)await fillAIModels();const baseline=state.result;$('askAI').disabled=true;$('aiReviewStatus').textContent='Reviewing numerical evidence…';const review=await api.aiReview({model:$('aiModel').value,evidence:reviewEvidence()});if(state.result!==baseline){$('aiReviewStatus').textContent='The model changed during review; old advice was discarded.';return;}state.aiReview=review;$('aiReviewText').textContent=review.text;$('aiReviewStatus').textContent='AI suggestions · '+review.model+' · verify with simulation.';}catch(e){$('aiReviewStatus').textContent=errorText(e);}finally{$('askAI').disabled=!state.result;}};
$('fusion').onclick=handle(async()=>{$('fusionDialog').showModal();const s=await api.fusionStatus();$('fusionStatus').textContent=s.available?'Ready: '+s.name+' · '+s.exportedAt:'No export yet. Send a design from Fusion first.';});$('installFusion').onclick=handle(async()=>{const s=await api.fusionInstall();$('fusionStatus').textContent='Installed at '+s.folder+'. Enable AeroDeskLink in Fusion Scripts and Add-Ins.';});$('importFusion').onclick=handle(async()=>{if(busy)throw Error('Finish the current operation first.');const f=await api.fusionImport();setBusy(true);try{await importLocalModel(f);$('fusionDialog').close();}finally{setBusy(false);}});
window.runStabilityStudy=runStability;
window.qaStabilityStudy=async()=>{const material=readMaterial(),s=state.settings,baseline=state.result;try{applyMaterial({...material,cgMode:'manual',cg:[0,0,0]});state.settings={...s,qualityMode:'draft'};await runStability();if(state.stabilityStudy?.samples.length!==4||state.result!==baseline)throw Error('Stability workflow did not preserve baseline and complete four studies.');return {ok:true,testOnlyCG:[0,0,0],notUserMeasuredCG:true,...state.stabilityStudy};}finally{applyMaterial(material);state.settings=s;state.stabilityStudy=null;updateAnalysis();}};

$('rebuildExterior').onclick=handle(async()=>{if(busy||!state.base)return;setBusy(true);$('stop').disabled=true;$('status').textContent='Rebuilding an approximate exterior; small features may change…';const g=state.base.clone(),name=state.name,source=state.source,L=+$('length').value;try{const result=await api.modelClean({vertices:g.attributes.position.array,rebuild:true});if(!result.report.ready)throw Error('Exterior rebuild still failed geometry checks. The current model was preserved.');for(let i=0;i<result.vertices.length;i++)result.vertices[i]*=L;installGeometry(g,name,source,true,result);$('cleanupReport').open=true;toast('Exterior rebuilt. Approximate cell size '+(result.report.rebuildSpacing*L*1000).toPrecision(3)+' mm. Review thin details and gaps.');}finally{g.dispose();setBusy(false);}});



window.qaRefinements=async(view='slice')=>{
 document.body.classList.remove('focus-view');$('focusView').textContent='⛶ Focus';document.querySelector('.results').scrollTop=0;
 if($('viewerNew'))throw Error('Duplicate New control remains');
 const l=state.result.liftCenter,at=state.forceLocation,remaining=shiftedMoment(l.moment,l.force,at.center);
 if(remaining.some((v,k)=>Math.abs(v-at.residualMoment[k])>1e-9))throw Error('Displayed center does not preserve total moments');
 if(view==='advice'){$('planeAssessment').open=true;$('hotspotList').querySelector('button').click();$('planeEvidence').scrollIntoView({block:'start'});if($('designCallout').classList.contains('hidden')||adviceMarkers.children.length!==1)throw Error('Selecting advice did not locate the region');}
 else{ $('planeAssessment').open=false;selectMode(view==='vortex'?'vortex':'section');if(view!=='vortex'){$('volumeField').value='speed';$('colorRange').value='auto';state.sliceColorMode='auto';$('slicePlane').value='2';$('slicePosition').value=50;drawFlow();}}
 selectView('iso');await new Promise(r=>setTimeout(r,350));renderer.render(scene,camera);
 return {ok:true,view,forceLocation:at,scale:state.displayScale,isoTriangles:state.isoTriangles,assessmentOpen:$('planeAssessment').open,advice:$('adviceAction').textContent,shaderErrors:renderer.info.programs?.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length||0};
};

window.qaLiftLocation=async()=>{
 const loads=state.result?.liftCenter;if(!loads?.panels?.length)throw Error('Native surface loads required');
 const sum=loads.panels.reduce((a,p)=>{a.lift+=p.force[1];a.x+=p.center[0]*p.force[1];a.z+=p.center[2]*p.force[1];return a;},{lift:0,x:0,z:0}),L=state.settings.length;
 const expected=[sum.x/sum.lift,state.cg[1]*L,sum.z/sum.lift],actual=state.cl.map(v=>v*L);
 if(actual.some((v,k)=>Math.abs(v-expected[k])>1e-10))throw Error('Lift marker differs from native signed loads');
 const material=readMaterial();applyMaterial({...material,cgMode:'manual',cg:[0,.15,0]});
 if(Math.abs(state.cl[0]*L-expected[0])>1e-10||Math.abs(state.cl[2]*L-expected[2])>1e-10)throw Error('Changing CG height moved the lift line sideways');
 applyMaterial(material);selectMode('model');selectView('top');await new Promise(r=>setTimeout(r,350));renderer.render(scene,camera);
 const marker=centersGroup.children.find(g=>g.userData.kind==='LIFT'),arrow=marker.children.find(g=>g.isArrowHelper||g.type==='ArrowHelper');
 const direction=new T.Vector3(0,1,0).applyQuaternion(arrow.quaternion);
 if(Math.abs(direction.x)>1e-12||Math.abs(direction.z)>1e-12||direction.y*Math.sign(sum.lift)<.999)throw Error('Lift arrow includes drag or side force');
 return {ok:true,expected,actual,direction:direction.toArray(),provisional:marker.userData.provisional,confidence:$('centerConfidence').textContent,balance:$('centerLoadBalance').textContent,forceAxis:state.forceLocation,cells:state.result.cells,converged:state.result.converged,iteration:state.result.iteration};
};

window.qaPrepareStreamline=async plane=>{
 if(!state.result)throw Error('A solved model is required');
 document.querySelector('.field-settings').open=true;$('linePlane').value=plane;$('linePosition').value=50;selectMode('flow');selectView('iso');$('linePosition').scrollIntoView({block:'nearest'});await new Promise(r=>setTimeout(r,200));return window.qaStreamlineState();
};
window.qaStreamlineState=()=>{
 const box=$('linePosition').getBoundingClientRect(),positions=flowGroup.children[0]?.geometry?.attributes.position?.array||[];
 return {slider:{x:box.x,y:box.y,width:box.width,height:box.height},visible:!$('linePositionControl').classList.contains('hidden'),plane:state.streamlinePlane,count:state.streamlineCount,version:state.streamlineDrawVersion,drawMs:state.streamlineDrawMs,geometrySample:Array.from(positions.slice(0,30))};
};

window.qaQualityModes=async()=>{
 if(document.body.classList.contains('focus-view'))$('focusView').click();
 const saved=projectData(),r=state.result,original=state.settings,checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);};
 check('Time budget controls removed',!$('minutes')&&!$('studyMinutes'));check('Four quality levels',$('ransQuality').options.length===4&&$('studyQuality').options.length===4);
 for(const mode of ['draft','standard','detailed','reference']){$('ransQuality').value=mode;$('studyQuality').value=mode;const p=projectData();loadProject(JSON.parse(JSON.stringify(p)));check(mode+' survives project reopening',settings().qualityMode===mode&&$('studyQuality').value===mode);}
 const legacy={...saved,settings:{...saved.settings,minutes:2}};delete legacy.settings.qualityMode;loadProject(legacy);check('Legacy project remains readable',settings().qualityMode==='standard');
 loadProject(saved);state.settings=original;installRansResult(r,original);check('Existing result preserved',state.result===r);check('Unconverged plane has no score',r.converged||state.assessment.score===null);
 if(r.reliability&&r.flowCheck){check('Native flow conservation recorded',r.flowCheck.passed&&$('meshComparison').textContent.includes('Flow conservation:'));}
 if(r.liftCenter?.panels?.some(p=>Number.isFinite(p.layers))){selectMode('layers');check('Native wall layers have a finite display',state.surfaceValues.some(Number.isFinite)&&state.displayScale.min===0);}
 $('resultsQuality').click();document.querySelector('.setup-scroll').scrollTop=650;await updatePlan();await new Promise(r=>setTimeout(r,300));return {ok:true,checks,qualityText:$('reliabilitySummary').textContent,score:state.assessment.score};
};

function rememberStudy(result,s,row=null){
 if(!result.resultId)return;
 let entry=row||state.studies.find(r=>r.resultId===result.resultId);
 if(!entry){entry={id:crypto.randomUUID(),include:true};state.studies.push(entry);}
 Object.assign(entry,{settings:{...s},resultId:result.resultId,status:'complete',summary:summarizeStudy(result,s),error:null,finished:new Date().toISOString()});state.selectedStudy=entry.id;
 renderStudies();
}
function renderStudies(){
 if(!$('studyRows'))return;const rows=state.studies||[];$('studyRows').replaceChildren();
 for(const r of rows){const tr=document.createElement('tr'),include=document.createElement('input');include.type='checkbox';include.checked=r.include!==false;include.disabled=busy;include.title='Include matched air/open-space conditions in combined score';include.onchange=()=>{r.include=include.checked;updatePlaneAssessment();};const td=document.createElement('td');td.append(include);tr.append(td);
  tr.title=environmentLabel(r.settings);for(const value of [r.settings.pitch+'°',r.settings.yaw+'°',r.summary?.liftCenter?number(r.summary.liftCenter.force[1]/Math.max(1e-12,r.summary.liftCenter.force[0])):'—',r.status==='complete'?(r.summary.converged&&r.summary.forceConvergence?.stable?'Converged':'Unconverged'):r.status]){const cell=document.createElement('td');cell.textContent=value;tr.append(cell);}
  const cell=document.createElement('td'),button=document.createElement('button');button.textContent=r.status==='complete'?'View':'Run';button.disabled=busy;button.onclick=handle(()=>r.status==='complete'?selectStudy(r):runStudyRows([r]));cell.append(button);if(r.status==='complete'){const rerun=document.createElement('button');rerun.textContent='↻';rerun.title='Re-run this condition with the current quality and compute settings';rerun.disabled=busy;rerun.onclick=handle(()=>runStudyRows([r]));cell.append(rerun);}const remove=document.createElement('button');remove.textContent='×';remove.title='Remove from project';remove.disabled=busy;remove.onclick=()=>{state.studies=state.studies.filter(x=>x!==r);renderStudies();updatePlaneAssessment();};cell.append(remove);tr.append(cell);if(state.selectedStudy===r.id)tr.classList.add('selected');if(r.error)tr.title+=' · '+r.error;$('studyRows').append(tr);
 }
 const pending=rows.filter(r=>r.status!=='complete').length;$('studyCount').textContent=rows.length+' conditions · '+environmentLabel(settings())+' · '+pending+' pending · '+qualityModes[$('studyQuality').value].label+' quality per queued case';drawStudyChart();
}
async function selectStudy(row){
 if(busy)return;setBusy(true);state.loadingStudy=true;
 try{const geometry=solverGeometry(row.settings);let result;try{result=await api.studyLoad({id:row.resultId,settings:row.settings,vertices:geometry.attributes.position.array});}finally{geometry.dispose();}
  applySettings(row.settings);state.settings={...row.settings};rebuildModel();state.selectedStudy=row.id;installRansResult(result,state.settings);$('openCase').disabled=false;selectView(state.selectedView||'iso');
 }catch(e){$('studyStatus').textContent='Cannot load this result: '+e.message+' Keep the .aero.results folder beside the project, or run this condition again.';throw e;}finally{state.loadingStudy=false;setBusy(false);renderStudies();}
}
async function reopenSelectedStudy(){const row=restorableStudy(state.studies,state.selectedStudy,settings());if(row){try{await selectStudy(row);}catch(e){toast(e.message);}}}
function addConditions(conditions){const s={...settings(),qualityMode:$('studyQuality').value};validateSettings(s);if(s.engine!=='openfoam')throw Error('Study sets require OpenFOAM.');for(const angle of conditions){if(state.studies.some(r=>sameCondition(r.settings,s)&&r.settings.pitch===angle.pitch&&r.settings.yaw===angle.yaw))continue;if(state.studies.length>=100)throw Error('This project has 100 studies; create another project.');state.studies.push({id:crypto.randomUUID(),include:true,status:'queued',settings:{...s,...angle}});}renderStudies();updatePlaneAssessment();}
async function runStudyRows(rows){
 if(busy)return;ensureClean();if(!rows.length)throw Error('Add conditions or select Re-run all.');const original={...settings()},baseline=state.result,baselineSettings=state.settings;state.studyRunning=true;state.stopStudySet=false;setBusy(true);let completed=0;
 try{for(const row of rows){if(state.stopStudySet)break;row.settings={...row.settings,qualityMode:$('studyQuality').value,cpuWorkers:original.cpuWorkers,computeBackend:original.computeBackend};validateSettings(row.settings);row.status='queued';state.studyProgressLabel='Condition '+(rows.indexOf(row)+1)+' / '+rows.length+' · pitch '+row.settings.pitch+'°, yaw '+row.settings.yaw+'°';$('studyStatus').textContent=state.studyProgressLabel;const geometry=solverGeometry(row.settings);
   try{const result=await api.foamRun({settings:row.settings,vertices:geometry.attributes.position.array,cleanupReport:state.cleanup});rememberStudy(result,row.settings,row);completed++;}
   catch(e){row.status=state.stopStudySet?'stopped':'failed';row.error=e.message;if(state.stopStudySet)break;}
   finally{geometry.dispose();renderStudies();}
  }
 }finally{state.studyRunning=false;setBusy(false);applySettings(original);state.settings=original;if(baseline&&baselineSettings&&sameCondition(baselineSettings,original)&&baselineSettings.pitch===original.pitch&&baselineSettings.yaw===original.yaw)installRansResult(baseline,baselineSettings);const last=rows.filter(r=>r.status==='complete').at(-1);if(last)await selectStudy(last);renderStudies();updatePlaneAssessment();$('studyStatus').textContent=(state.stopStudySet?'Stopped. ':'Finished. ')+completed+' completed this run. Save project to keep conditions and results.';}
}
$('addStudy').onclick=handle(()=>addConditions(studyPlan($('studyPitch').value,$('studyYaw').value,$('studyGrid').checked)));
$('runStudies').onclick=handle(()=>runStudyRows(state.studies.filter(r=>$('rerunStudies').checked||r.status!=='complete')));
$('autoStudies').onclick=handle(async()=>{$('studyPitch').value='-4,-2,0,2,4,6,8';$('studyYaw').value='-5,0,5';$('studyGrid').checked=false;addConditions(studyPlan($('studyPitch').value,$('studyYaw').value));await runStudyRows(state.studies.filter(r=>r.status!=='complete'));});
$('exportStudies').onclick=handle(()=>save('csv',state.name+'-angles',['pitch_deg,yaw_deg,status,converged,drag_N,lift_N,side_N,Cd,Cy,Cz',...state.studies.map(r=>[r.settings.pitch,r.settings.yaw,r.status,!!r.summary?.converged,...(r.summary?.liftCenter?.force||['','','']),r.summary?.history?.at(-1)?.cd??'',r.summary?.history?.at(-1)?.cy??'',r.summary?.history?.at(-1)?.cz??''].join(','))].join('\n')));

$('openStudies').onclick=()=>{$('studiesDialog').showModal();renderStudies();requestAnimationFrame(drawStudyChart);};
$('saveStudies').onclick=()=>$('saveProject').click();$('studyAssessment').onclick=()=>{$('studiesDialog').close();$('resultsPlane').click();};
$('chartsPanel').ontoggle=()=>{if($('chartsPanel').open){drawChart();if(state.result?.liftCenter?.panels)drawLoadChart(loadBins(state.result.liftCenter.panels));}};
$('studyPlot').onchange=drawStudyChart;
function drawStudyChart(){const canvas=$('studyChart');if(!canvas||!$('studiesDialog').open)return;const rect=canvas.getBoundingClientRect(),w=Math.max(200,rect.width),h=220;canvas.width=w*2;canvas.height=h*2;const c=canvas.getContext('2d');c.scale(2,2);const key=$('studyPlot').value,rows=comparisonRows(state.studies,settings()).map(r=>({r,x:r.settings.pitch,y:key==='lift'?r.summary.liftCenter.force[1]:key==='drag'?r.summary.liftCenter.force[0]:key==='moment'?r.summary.liftCenter.moment[2]:r.summary.liftCenter.force[1]/r.summary.liftCenter.force[0]})).filter(p=>Number.isFinite(p.y));if(!rows.length){c.fillStyle='#657a89';c.fillText('Run matching fluid, ground and flow conditions to compare.',20,35);return;}const minX=Math.min(...rows.map(p=>p.x)),maxX=Math.max(...rows.map(p=>p.x)),minY=Math.min(0,...rows.map(p=>p.y)),maxY=Math.max(...rows.map(p=>p.y)),X=x=>50+(x-minX)/(maxX-minX||1)*(w-90),Y=y=>180-(y-minY)/(maxY-minY||1)*150; c.strokeStyle='#dce6ec';c.strokeRect(50,25,w-90,155);c.font='11px Segoe UI';c.fillStyle='#496478';for(let i=0;i<5;i++){const x=minX+(maxX-minX)*i/4,y=minY+(maxY-minY)*i/4;c.fillText(number(x)+'°',X(x)-8,202);c.fillText(number(y),3,Y(y)+3);}const groups=[...new Set(rows.map(p=>p.r.settings.yaw))].sort((a,b)=>a-b),colors=['#267bb5','#c76a36','#7654b4','#36877b','#b24570'];groups.forEach((yaw,i)=>{const points=rows.filter(p=>p.r.settings.yaw===yaw).sort((a,b)=>a.x-b.x);c.strokeStyle=colors[i%colors.length];c.fillStyle=c.strokeStyle;c.fillText('Yaw '+yaw+'°',60+i*100,15);c.beginPath();points.forEach((p,j)=>j?c.lineTo(X(p.x),Y(p.y)):c.moveTo(X(p.x),Y(p.y)));c.stroke();for(const p of points){c.beginPath();c.arc(X(p.x),Y(p.y),4,0,Math.PI*2);c.fillStyle=p.r.summary.converged&&p.r.summary.forceConvergence?.stable?colors[i%colors.length]:'#fff';c.fill();c.stroke();}});}
// Drag the cube to reveal hidden faces, then click a face to align the camera.
let cubeDrag=null,cubeMoved=false;
$('viewCube').parentElement.onpointerdown=e=>{if(e.button!==0)return;cubeDrag={x:e.clientX,y:e.clientY,face:e.target.closest('[data-view]')?.dataset.view};cubeMoved=false;};
$('viewCube').parentElement.onpointermove=e=>{if(!cubeDrag)return;const dx=e.clientX-cubeDrag.x,dy=e.clientY-cubeDrag.y;if(Math.abs(dx)+Math.abs(dy)<2)return;cubeMoved=true;e.currentTarget.setPointerCapture(e.pointerId);const offset=camera.position.clone().sub(controls.target),right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion);offset.applyAxisAngle(new T.Vector3(0,1,0),-dx*.008).applyAxisAngle(right,-dy*.008);camera.position.copy(controls.target).add(offset);camera.up.set(0,1,0);camera.lookAt(controls.target);controls.update();cubeDrag={x:e.clientX,y:e.clientY};};
$('viewCube').parentElement.onpointerup=e=>{const face=cubeDrag?.face;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);cubeDrag=null;if(!cubeMoved&&face)selectView(face);};$('viewCube').parentElement.onpointercancel=e=>{cubeDrag=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
$('viewCube').addEventListener('click',e=>{if(cubeMoved){e.preventDefault();e.stopImmediatePropagation();cubeMoved=false;}},true);

for(const [i,m] of materialLibrary.materials.entries())$('materialPreset').add(new Option(m.category+' · '+m.name,String(i)));
function showMaterialProperties(m){$('materialProperties').replaceChildren();if(!m){$('materialProperties').textContent='Custom density. Additional material properties are unavailable.';return;}for(const [name,value] of Object.entries(m.properties||{})){const p=document.createElement('p');p.textContent=name+': '+(Number(value).toPrecision(3));$('materialProperties').append(p);}}
$('materialPreset').onchange=handle(()=>{const m=materialLibrary.materials[Number($('materialPreset').value)];if($('materialPreset').value===''||!m)return;applyMaterial({...readMaterial(),name:m.name,density:m.density});showMaterialProperties(m);$('materialSource').textContent='Onshape standard library · density applied';updateAnalysis();});
async function useOnshapeMaterial(silent=false){if(!state.source){if(!silent)throw Error('Import or refresh a model from Onshape first.');return;}const source=state.source,r=await api.onshapeMaterial(source);if(state.source!==source)return;$('materialSource').textContent=r.message;if(r.material){applyMaterial({...readMaterial(),...r.material});const i=materialLibrary.materials.findIndex(m=>m.name===r.material.name);$('materialPreset').value=i<0?'':String(i);showMaterialProperties(materialLibrary.materials[i]||r.material);updateAnalysis();}}
$('getOnshapeMaterial').onclick=handle(()=>useOnshapeMaterial());
window.qaMaterialLibrary=()=>({count:materialLibrary.materials.length,density:materialLibrary.materials.find(m=>m.name.includes('6061'))?.density});
window.qaStudyState=()=>({project:projectData(),selected:state.selectedStudy,loaded:state.result?.resultId,score:state.assessment,rows:state.studies.map(r=>({id:r.id,pitch:r.settings.pitch,yaw:r.settings.yaw,status:r.status,result:r.resultId}))});
window.qaSelectStudy=async id=>{await selectStudy(state.studies.find(r=>r.id===id));return {id:state.result.resultId,force:state.result.liftCenter.force,settings:state.settings};};
window.qaAngleStudy=async()=>{const original=settings();$('studyQuality').value='draft';addConditions([{pitch:0,yaw:0},{pitch:3,yaw:0},{pitch:0,yaw:3}]);await runStudyRows(state.studies.filter(r=>r.status!=='complete'));$('openStudies').click();return {original,...window.qaStudyState()};};

function solverGeometry(s){const g=state.base.clone();g.setAttribute('position',new T.BufferAttribute(new Float64Array(state.base.attributes.position.array),3));return g.applyMatrix4(modelRotation(s));}
function solverVertices(s){const g=solverGeometry(s),v=g.attributes.position.array;g.dispose();return v;}

$('stopStudies').onclick=stopRun;

createBlankProject();


function studyReportHTML(){if(!state.studies.length)return '';return '<h2>Saved angle conditions</h2><p>Current condition loads appear above. Only matched air/open-space conditions that pass numerical checks contribute to the flight score.</p><table><tr><th>Environment</th><th>AoA</th><th>Yaw</th><th>Selected</th><th>Result</th><th>Drag N</th><th>Lift N</th></tr>'+state.studies.map(r=>'<tr><td>'+environmentLabel(r.settings)+'</td><td>'+number(r.settings.pitch)+'°</td><td>'+number(r.settings.yaw)+'°</td><td>'+(r.include!==false?'Selected':'Excluded')+'</td><td>'+(r.status==='complete'?(r.summary?.converged&&r.summary?.forceConvergence?.stable?'Converged':'Unconverged'):r.status)+'</td><td>'+number(r.summary?.liftCenter?.force?.[0])+'</td><td>'+number(r.summary?.liftCenter?.force?.[1])+'</td></tr>').join('')+'</table>';}
window.qaCubeState=()=>{const rect=$('viewCube').parentElement.getBoundingClientRect();const faces=Array.from(document.querySelectorAll('.cube-face')).map(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {name:el.dataset.view,x:Math.round(x),y:Math.round(y),visible:document.elementFromPoint(x,y)===el};});return {direction:camera.position.clone().sub(controls.target).normalize().toArray(),view:state.selectedView,cube:{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)},faces,labelsHidden:Array.from(document.querySelectorAll('.center-label')).every(el=>getComputedStyle(el).display==='none'),chartsClosed:!$('chartsPanel').open,assessmentClosed:!$('planeAssessment').open};};
window.qaReadyCube=()=>{selectMode('pressure');selectView('iso');};

window.qaEnvironment=async()=>{
 const saved=projectData(),r=state.result,s=state.settings,checks=[],check=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name);};
 const change=(id,value)=>{$(id).value=String(value);$(id).dispatchEvent(new Event('change',{bubbles:true}));};
 change('fluidMedium','water');check('Water preset sets density and viscosity',settings().density===998.2&&settings().nu===1.004e-6);check('Preset keeps speed and size',settings().speed===saved.settings.speed&&settings().length===saved.settings.length);check('Changing medium invalidates results',state.result===null);check('Water disables laminar preview',$('engine').value==='openfoam'&&$('engine').querySelector('[value="preview"]').disabled);
 change('groundClearance',.1*settings().length);change('groundMode','moving');check('Physical floor appears',groundSurface.visible&&!$('groundControls').classList.contains('hidden'));const y=state.mesh.geometry.boundingBox.min.y-.1;check('Floor is at actual model clearance',Math.abs(groundSurface.position.y-y)<1e-8);
 change('pitch',17);check('Floor follows rotated lowest point',Math.abs(groundSurface.position.y-(state.mesh.geometry.boundingBox.min.y-.1))<1e-8);
 change('groundClearance',0);check('Zero clearance has no hidden gap',groundSurface.position.y===state.mesh.geometry.boundingBox.min.y);change('groundMode','stationary');
 change('density',1025);change('nu',1.05e-6);const project=JSON.parse(JSON.stringify(projectData()));loadProject(project);check('Water floor and custom properties survive project load',settings().fluidMedium==='water'&&settings().groundMode==='stationary'&&settings().groundClearance===0&&settings().density===1025&&settings().nu===1.05e-6);
 applyAssessmentOptions({kind:'plane'});updatePlaneAssessment();check('No flight score for water or ground',state.assessment.score===null);
 change('fluidMedium','air');check('Air preset restores air properties',settings().density===1.225&&settings().nu===1.5e-5);change('groundMode','none');check('Open space removes physical floor',!groundSurface.visible&&!$('engine').querySelector('[value="preview"]').disabled);
 const legacy=JSON.parse(JSON.stringify(saved));delete legacy.settings.fluidMedium;delete legacy.settings.groundMode;delete legacy.settings.groundClearance;loadProject(legacy);check('Legacy project loads as open air',settings().fluidMedium==='air'&&settings().groundMode==='none');
 loadProject(saved);state.settings=s;if(r)installRansResult(r,s);check('Original result restored',state.result===r);if(r?.engine==='openfoam')check('Export records physical environment',csvData().includes('# Environment: '+environmentLabel(s)));
 document.querySelector('.setup-scroll').scrollTop=570;selectView('iso');await new Promise(resolve=>setTimeout(resolve,250));return {ok:true,checks,environment:environmentLabel(settings())};
};
