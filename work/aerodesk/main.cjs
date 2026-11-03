const {app,BrowserWindow,ipcMain,dialog,Menu,safeStorage,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
require('./connections.cjs').register({app,ipcMain,safeStorage,shell});
let win;
const {Worker}=require('node:worker_threads');
function modelJob(data){return new Promise((resolve,reject)=>{const worker=new Worker(path.join(__dirname,'dist/model-worker.cjs'),{workerData:data});const timer=setTimeout(()=>{worker.terminate();reject(Error('Model processing exceeded two minutes. Simplify the assembly and try again.'));},120000);worker.once('message',m=>{clearTimeout(timer);worker.terminate();m.error?reject(Error(m.error)):resolve(m.result);});worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Model processor stopped.'));});});}
ipcMain.handle('model-convert',async(_event,d)=>{if(!['step','3mf'].includes(d?.type)||!d.bytes?.length||d.bytes.length>512*1024*1024)throw Error('Choose a STEP or 3MF file under 512 MB.');return modelJob({type:d.type,bytes:d.bytes});});
ipcMain.handle('model-clean',async(_event,d)=>{if(!d?.vertices?.length||d.vertices.length>1800000||d.vertices.length%9||d.parts?.reduce((s,p)=>s+p.length,0)>1800000)throw Error('Unsupported model size.');return require('./model-service.cjs').cleanModel(d,modelJob);});
const foam=require('./openfoam.cjs');
let foamJob=null,lastCase=null;
const studyStore=()=>require('./study-store.cjs').store(path.join(app.getPath('userData'),'saved-studies'));
ipcMain.handle('study-load',async(_e,{id,settings,vertices})=>studyStore().get(id,settings,vertices));
function projectIds(project){if(!Array.isArray(project.studies))return [];if(project.studies.length>100)throw Error('Too many saved studies.');return project.studies.map(r=>r.resultId).filter(Boolean);}
async function readProject(file){const project=JSON.parse(await fs.readFile(file,'utf8'));project.missingResults=await studyStore().import(projectIds(project),file);return project;}
async function writeProject(file,text){const project=JSON.parse(text);await studyStore().export(projectIds(project),file);await fs.writeFile(file+'.tmp',text);await fs.rename(file+'.tmp',file);}

const calibrationPath=()=>path.join(app.getPath('userData'),'openfoam-calibration-v2.json');
const readCalibration=()=>fs.readFile(calibrationPath(),'utf8').then(JSON.parse,()=>fs.readFile(path.join(app.getPath('userData'),'openfoam-calibration.json'),'utf8').then(JSON.parse,()=>null));
ipcMain.handle('foam-info',async()=>({hardware:foam.hardware(),available:!!(await foam.runtime().catch(()=>null)),calibration:await readCalibration(),gpu:await fs.readFile(path.join(app.getPath('userData'),'gpu-setup.json'),'utf8').then(JSON.parse,()=>({ready:false,message:'GPU solver is not installed.'}))}));
ipcMain.handle('foam-plan',async(_event,{settings,vertices})=>foam.plan(settings,vertices,await foam.availableHardware(settings),await readCalibration()));
ipcMain.handle('foam-run',async(_event,{settings,vertices,cleanupReport})=>{
  if(foamJob)throw Error('A simulation is already running.');
  foam.validate(settings,vertices);
  lastCase=path.join(settings.computeBackend==='gpu'?path.join(app.getPath('home'),'AeroDeskGPU'):app.getPath('userData'),'cases','study-'+Date.now());
  const job=new foam.Job(lastCase,d=>{if(win&&!win.isDestroyed())win.webContents.send('foam-progress',d);});foamJob=job;
  try{
  if(cleanupReport){const json=JSON.stringify(cleanupReport);if(json.length>16384)throw Error('Invalid cleanup report.');await fs.mkdir(lastCase,{recursive:true});await fs.writeFile(path.join(lastCase,'cleanup-report.json'),json);}
const result=await job.run(vertices,settings,await readCalibration());
  if(cleanupReport){result.geometryCleanup=cleanupReport;if(cleanupReport.automaticRebuild||cleanupReport.rebuiltExterior){result.reliability.warnings.push('The CAD exterior was rebuilt approximately. Check thin edges and gaps against the original; mesh refinement cannot restore lost geometry.');}await job.writeSummary(result);}
  result.resultId=await studyStore().put(result,settings,vertices);
    if(result.solveSeconds>3&&result.iteration>20){const old=await readCalibration(),workers=result.execution?.workers||1,row={workers,cellIterationsPerSecond:result.cells*result.iteration/result.solveSeconds,cpu:foam.hardware().cpu,date:new Date().toISOString()};await fs.writeFile(calibrationPath(),JSON.stringify(result.execution?.backend==='gpu'?{...old,gpu:row}:{...old,byWorkers:{...old?.byWorkers,[workers]:row}}));}
    return result;
  }finally{if(foamJob===job)foamJob=null;}
});
ipcMain.handle('foam-cancel',()=>{foamJob?.cancel();return true;});
ipcMain.handle('foam-case',async(_e,folder)=>{const root=path.resolve(app.getPath('userData'),'cases'),target=path.resolve(folder||lastCase||root);const gpuRoot=path.resolve(app.getPath('home'),'AeroDeskGPU','cases');if(target!==root&&!target.startsWith(root+path.sep)&&target!==gpuRoot&&!target.startsWith(gpuRoot+path.sep))throw Error('Choose an AeroDesk case folder.');return shell.openPath(target);});
ipcMain.handle('foam-restore',async(_event,{settings,vertices})=>{const option=process.argv.find(x=>x.startsWith('--restore-case='));if(!option)throw Error('No saved result was selected.');lastCase=path.resolve(option.slice('--restore-case='.length));const result=await foam.restoreCase(lastCase,vertices,settings);result.resultId=await studyStore().put(result,settings,vertices);return result;});
app.on('before-quit',()=>foamJob?.cancel());
const onshape=require('./onshape.cjs');
let cachedKeys=null;
const keyPath=()=>path.join(app.getPath('userData'),'onshape-keys.bin');
async function readKeys(){
  if(cachedKeys)return cachedKeys;
  try{cachedKeys=JSON.parse(safeStorage.decryptString(await fs.readFile(keyPath())));return cachedKeys;}catch{return null;}
}
ipcMain.handle('onshape-status',async()=>{const keys=await readKeys();return {connected:!!keys,origin:keys?.origin};});
ipcMain.handle('onshape-material',async(_event,link)=>{const keys=await readKeys();if(!keys)throw Error('Connect Onshape first.');return onshape.assignedMaterial(keys,link);});
ipcMain.handle('onshape-browse',async(_event,input)=>{const keys=await readKeys();if(!keys)throw Error('Connect Onshape first.');return onshape.browse(keys,input);});
async function connectOnshape(values){
  const origin=onshape.trustedUrl(values.origin).origin;
  if(typeof values.access!=='string'||typeof values.secret!=='string'||!values.access.trim()||!values.secret.trim()||values.access.length>256||values.secret.length>256)throw Error('Enter both API keys.');
  if(!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable.');
  const keys={origin,access:values.access.trim(),secret:values.secret.trim()};
  if(keys.access.includes('@'))throw Error('Use your API access key, not your Onshape email or password.');
  // Verify read access before persisting credentials. No document metadata is logged.
  await onshape.request(origin+'/api/v16/documents?limit=1',keys);
  await fs.mkdir(app.getPath('userData'),{recursive:true});
  await fs.writeFile(keyPath(),safeStorage.encryptString(JSON.stringify(keys)));cachedKeys=keys;
  return {connected:true,origin};
}
ipcMain.handle('onshape-connect',async(_event,values)=>connectOnshape(values));
ipcMain.handle('onshape-disconnect',async()=>{await fs.rm(keyPath(),{force:true});cachedKeys=null;return true;});
ipcMain.handle('onshape-import',async(_event,link)=>{
  const target=onshape.parseLink(link),keys=await readKeys();
  if(!keys)throw Error('Connect Onshape first.');
  if(keys.origin!==target.origin)throw Error('This document uses a different Onshape server. Reconnect using a key from '+target.origin+'.');
  const bytes=await onshape.request(target.url,keys);
  let parts=null;
  const linkURL=new URL(target.link),match=linkURL.pathname.match(/\/documents\/([^/]+)\/w\/([^/]+)\/e\/([^/]+)/);
  if(!linkURL.searchParams.has('aerodeskPart')&&match){const listed=await onshape.browse(keys,{kind:'parts',document:match[1],workspace:match[2],element:match[3]});if(listed.items.length>1){if(listed.items.length>64)throw Error('Choose a smaller exterior assembly (up to 64 solids).');parts=[];let total=0;for(const part of listed.items){const partLink=new URL(target.link);partLink.searchParams.set('aerodeskPart',part.id);const data=await onshape.request(onshape.parseLink(partLink.href).url,keys);total+=data.length;if(total>512*1024*1024)throw Error('The selected assembly exceeds 512 MB. Import fewer solids.');parts.push({name:part.name,bytes:new Uint8Array(data)});}}}
  if(process.argv.includes('--onshape-browse-test')){const dir=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'onshape-current.stl'),bytes);}
  return {name:'Onshape-'+target.element.slice(0,6)+'.stl',bytes:new Uint8Array(bytes),parts,link:target.link,workspace:target.workspace};
});
ipcMain.handle('onshape-help',async()=>shell.openExternal('https://cad.onshape.com/help/Content/Plans/my_account_developer.htm'));
app.setName('AeroDesk');
app.whenReady().then(async()=>{
  const pipeOption=process.argv.find(a=>a.startsWith('--connect-onshape-pipe='));
  if(pipeOption){
    // Windows GUI executables do not reliably expose stdin. Use a short-lived local pipe.
    try{
      const id=pipeOption.split('=')[1];if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid connection channel.');
      const socket=require('node:net').connect('\\\\.\\pipe\\aerodesk-'+id);
      socket.setTimeout(15000,()=>socket.destroy(new Error('Connection setup timed out.')));
      let input='';for await(const chunk of socket){input+=chunk;if(input.length>4096){socket.destroy();throw Error('Connection input is too large.');}}
      const result=await connectOnshape(JSON.parse(input));console.log(JSON.stringify(result));app.exit(0);
    }catch(e){console.error(e.message);app.exit(1);}return;
  }
  const importTest=process.argv.find(a=>a.startsWith('--cleanup-file-test='));
  const captureMode=process.argv.includes('--restore-qa')||process.argv.includes('--onshape-browse-test')||process.argv.includes('--reynolds-smoke-test')||!!importTest||process.argv.includes('--cleanup-smoke-test')||process.argv.includes('--smoke-test')||process.argv.includes('--rans-smoke-test')||process.argv.includes('--connection-proof');
  win=new BrowserWindow({width:1480,height:940,minWidth:1100,minHeight:740,backgroundColor:'#101822',title:'AeroDesk 0.14.0 — OpenFOAM wind tunnel',show:!captureMode,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:captureMode,partition:captureMode?'qa-'+Date.now():undefined}});
  Menu.setApplicationMenu(null);
  if(captureMode)win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer: '+event.message);});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{event.preventDefault();if(['induced-drag-coefficient','center-of-pressure','aircraft-center-of-gravity'].some(slug=>url==='https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/'+slug+'/'))shell.openExternal(url);});
  win.webContents.session.setPermissionRequestHandler((_wc,_p,callback)=>callback(false));
  await win.loadFile('dist/index.html');
  if(process.argv.includes('--astra-onshape-test')){try{const r=await win.webContents.executeJavaScript('window.testOnshapeImport('+JSON.stringify(process.env.AERODESK_TEST_ONSHAPE_URL||'')+')');await fs.mkdir(process.env.AERODESK_TEST_OUTPUT,{recursive:true});await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'astraplane-onshape.json'),JSON.stringify(r,null,2));await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'astraplane-import.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(r));app.exit(0);}catch(e){console.error(e);app.exit(1);}return;}
  if(process.argv.includes('--onshape-browse-test')){try{const report=await win.webContents.executeJavaScript('window.testOnshapeBrowse()');const dir=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'onshape-browse-test.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(dir,'onshape-import.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));app.exit(0);}catch(e){console.error(e.message);app.exit(1);}return;}

  if(importTest){try{const filename=importTest.slice('--cleanup-file-test='.length);if(!/\.(stl|obj|step|stp|3mf)$/i.test(filename)||(await fs.stat(filename)).size>512*1024*1024)throw Error('Invalid model test file.');
    const bytes=await fs.readFile(filename),report=await win.webContents.executeJavaScript('window.testModelImport('+JSON.stringify({name:path.basename(filename),bytes:Array.from(bytes)})+')');
    const target=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'model-import-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
  }catch(e){console.error(e);app.exit(1);}return;}
  if(process.argv.includes('--reynolds-smoke-test')){try{const report=await win.webContents.executeJavaScript('window.runReynoldsChecks()');const folder=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'reynolds-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);}catch(e){console.error(e);app.exit(1);}return;}
  const startup=process.argv.find(a=>a.startsWith('--open-project='));
  if(startup){try{const filename=startup.slice('--open-project='.length);if(!filename.toLowerCase().endsWith('.aero')||(await fs.stat(filename)).size>256*1024*1024)throw Error('Choose an AeroDesk project smaller than 256 MB.');const project=JSON.stringify(await readProject(filename));await win.webContents.executeJavaScript('window.openStartupProject('+JSON.stringify(project)+')');
    if(process.argv.includes('--run-startup-project')||process.argv.some(x=>x.startsWith('--restore-case='))){const report=await win.webContents.executeJavaScript('window.runStartupProject('+process.argv.includes('--viewer-qa')+','+process.argv.some(x=>x.startsWith('--restore-case='))+')');const target=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('userData'));await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'user-plane-app-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(target,'user-plane-app.png'),(await win.webContents.capturePage()).toPNG());if(process.argv.includes('--viewer-qa')){for(const mode of ['pressure','friction','section','vortex','cloud']){await win.webContents.executeJavaScript('window.qaAnalysisView('+JSON.stringify(mode)+')');await fs.writeFile(path.join(target,mode+'.png'),(await win.webContents.capturePage()).toPNG());}await win.webContents.executeJavaScript('window.qaAnalysisView("pressure")');const html=await win.webContents.executeJavaScript('window.qaAnalysisReport()');await fs.writeFile(path.join(target,'AeroDesk-analysis.html'),html);await fs.writeFile(path.join(target,'AeroDesk-analysis.pdf'),await renderReportPDF(html));}console.log(JSON.stringify({ok:report.ok,cells:report.cells,analysis:report.analysis?.checks}));}
  }catch(e){console.error(e);if(process.env.AERODESK_TEST_OUTPUT){await fs.mkdir(process.env.AERODESK_TEST_OUTPUT,{recursive:true});await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'failure.txt'),e.stack||e.message);}if(captureMode){app.exit(1);return;}await dialog.showMessageBox(win,{type:'error',message:'Could not finish this project',detail:e.message});}}

  if(process.argv.includes('--slice-color-qa')){const target=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('userData')),checks=[];for(const mode of ['auto','fixed']){checks.push(await win.webContents.executeJavaScript('window.qaVelocitySliceScale('+JSON.stringify(mode)+')'));await fs.writeFile(path.join(target,'slice-'+mode+'.png'),(await win.webContents.capturePage()).toPNG());}if(checks[1].scale.min!==0||checks[1].scale.max!==checks[1].inlet*1.6||checks[0].scale.actualMax!==checks[1].scale.actualMax)throw Error('Slice reference scale regression');await fs.writeFile(path.join(target,'slice-scale-check.json'),JSON.stringify(checks,null,2));}
  if(process.argv.includes('--view-slices'))await win.webContents.executeJavaScript('window.qaVelocitySliceScale("fixed")');
  if(process.argv.includes('--refinement-qa')){const target=path.resolve(process.env.AERODESK_TEST_OUTPUT),checks=[];for(const view of ['slice','vortex','advice']){checks.push(await win.webContents.executeJavaScript('window.qaRefinements('+JSON.stringify(view)+')'));await fs.writeFile(path.join(target,'refined-'+view+'.png'),(await win.webContents.capturePage()).toPNG());}if(checks.some(c=>c.shaderErrors))throw Error('Display shader compilation failed');await fs.writeFile(path.join(target,'refinement-checks.json'),JSON.stringify(checks,null,2));}
  if(process.argv.includes('--view-pressure'))await win.webContents.executeJavaScript('document.getElementById("viewPressure").click()');
  if(process.argv.includes('--view-vortices'))await win.webContents.executeJavaScript('window.qaAnalysisView("vortex")');
  if(process.argv.includes('--plane-qa')){const assessment=await win.webContents.executeJavaScript('window.qaPlaneView()');if(process.argv.includes('--plane-qa')){const target=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('userData'));await fs.writeFile(path.join(target,'plane-assessment.json'),JSON.stringify(assessment,null,2));await fs.writeFile(path.join(target,'plane-assessment.png'),(await win.webContents.capturePage()).toPNG());}}
  if(process.argv.includes('--stability-qa')){try{const r=await win.webContents.executeJavaScript('window.qaStabilityStudy()');await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'stability-workflow.json'),JSON.stringify(r,null,2));console.log('Four-study stability workflow passed');}catch(e){console.error(e);app.exit(1);return;}}
  if(process.argv.includes('--angle-study-qa')){try{const r=await win.webContents.executeJavaScript('window.qaAngleStudy()'),dir=path.resolve(process.env.AERODESK_TEST_OUTPUT);await writeProject(path.join(dir,'Angle-study.aero'),JSON.stringify(r.project));await fs.writeFile(path.join(dir,'angle-study.json'),JSON.stringify({...r,project:undefined},null,2));await fs.writeFile(path.join(dir,'angle-study.png'),(await win.webContents.capturePage()).toPNG());console.log('Angle study saved');}catch(e){console.error(e);app.exit(1);return;}}
  if(process.argv.includes('--study-reopen-qa')){const r=await win.webContents.executeJavaScript('window.qaStudyState()');const checks=[];for(const row of r.rows.filter(x=>x.result))checks.push(await win.webContents.executeJavaScript('window.qaSelectStudy('+JSON.stringify(row.id)+')'));await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'reopened-studies.json'),JSON.stringify({rows:r.rows,checks,score:r.score},null,2));}
  if(process.argv.includes('--cube-qa')){await win.webContents.executeJavaScript('window.qaReadyCube()');await new Promise(r=>setTimeout(r,300));const before=await win.webContents.executeJavaScript('window.qaCubeState()'),c=before.cube;win.webContents.sendInputEvent({type:'mouseDown',x:c.x,y:c.y,button:'left',clickCount:1});for(let i=1;i<=8;i++){win.webContents.sendInputEvent({type:'mouseMove',x:c.x+i*7,y:c.y+i*2,button:'left'});await new Promise(r=>setTimeout(r,20));}win.webContents.sendInputEvent({type:'mouseUp',x:c.x+56,y:c.y+16,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,200));const dragged=await win.webContents.executeJavaScript('window.qaCubeState()');const face=dragged.faces.find(f=>f.visible);if(!face)throw Error('No selectable cube face');win.webContents.sendInputEvent({type:'mouseMove',x:face.x,y:face.y});await new Promise(r=>setTimeout(r,100));win.webContents.sendInputEvent({type:'mouseDown',x:face.x,y:face.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:face.x,y:face.y,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,250));const clicked=await win.webContents.executeJavaScript('window.qaCubeState()');await fs.writeFile(path.join(process.env.AERODESK_TEST_OUTPUT,'cube-debug.json'),JSON.stringify({before,dragged,clicked,face},null,2));if(before.direction.every((v,i)=>Math.abs(v-dragged.direction[i])<.001)||clicked.view!==face.name)throw Error('Cube drag/click interaction failed');const dir=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.writeFile(path.join(dir,'cube-interaction.json'),JSON.stringify({before,dragged,clicked},null,2));await fs.writeFile(path.join(dir,'viewer-clean.png'),(await win.webContents.capturePage()).toPNG());}
  if(process.argv.includes('--streamline-qa')){const checks=[],target=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.mkdir(target,{recursive:true});for(const plane of ['vertical','horizontal']){const before=await win.webContents.executeJavaScript('window.qaPrepareStreamline('+JSON.stringify(plane)+')'),b=before.slider,y=Math.round(b.y+b.height/2);if(!before.visible||b.width<20)throw Error('Streamline slider is not visible');win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(b.x+b.width*.5),y,button:'left',clickCount:1});const frames=[];for(const fraction of [.2,.8,.35]){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(b.x+b.width*fraction),y,button:'left',modifiers:['leftButtonDown']});await new Promise(r=>setTimeout(r,250));frames.push(await win.webContents.executeJavaScript('window.qaStreamlineState()'));}win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(b.x+b.width*.35),y,button:'left',clickCount:1});await fs.writeFile(path.join(target,'streamline-'+plane+'-debug.json'),JSON.stringify({before,frames},null,2));if(frames.some((r,i)=>!r.count||r.version<=(i?frames[i-1].version:before.version)||r.plane.position===(i?frames[i-1].plane.position:before.plane.position)||JSON.stringify(r.geometrySample)===JSON.stringify(i?frames[i-1].geometrySample:before.geometrySample)))throw Error('Streamline geometry failed to update while mouse was held');checks.push({plane,before,frames});await fs.writeFile(path.join(target,'streamlines-'+plane+'.png'),(await win.webContents.capturePage()).toPNG());}await fs.writeFile(path.join(target,'streamline-drag-check.json'),JSON.stringify({ok:true,checks},null,2));}
  if(process.argv.includes('--lift-center-qa')){const report=await win.webContents.executeJavaScript('window.qaLiftLocation()'),target=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'lift-center-check.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(target,'lift-center-top.png'),(await win.webContents.capturePage()).toPNG());}
  if(process.argv.includes('--environment-qa')){const report=await win.webContents.executeJavaScript('window.qaEnvironment()'),target=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'environment-ui-check.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(target,'environment-ui.png'),(await win.webContents.capturePage()).toPNG());}
  if(process.argv.includes('--quality-qa')){const report=await win.webContents.executeJavaScript('window.qaQualityModes()'),target=path.resolve(process.env.AERODESK_TEST_OUTPUT);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'quality-ui-check.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(target,'quality-ui.png'),(await win.webContents.capturePage()).toPNG());}
  if(process.argv.includes('--restore-qa')){app.exit(0);return;}
  if(process.argv.includes('--cleanup-smoke-test')){try{const report=await win.webContents.executeJavaScript('window.runCleanupSmokeTest()');const folder=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'cleanup-smoke-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(folder,'cleanup-screenshot.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));app.exit(0);}catch(e){console.error(e);app.exit(1);}return;}
  if(process.argv.includes('--rans-smoke-test')){
    try{const report=await win.webContents.executeJavaScript('window.runRansSmokeTest()');const folder=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'rans-smoke-report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(folder,'rans-screenshot.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));app.exit(0);}catch(e){console.error(e);app.exit(1);}return;
  }
  if(process.argv.includes('--open-onshape'))await win.webContents.executeJavaScript("document.getElementById('onshape').click()");
  if(process.argv.includes('--connection-proof')){
    try{const result=await win.webContents.executeJavaScript('window.connectionProof()');const folder=path.resolve(process.env.AERODESK_TEST_OUTPUT||app.getPath('temp'));await fs.mkdir(folder,{recursive:true});await new Promise(resolve=>setTimeout(resolve,300));await fs.writeFile(path.join(folder,'Onshape-connected.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(result));app.exit(result.connected?0:1);}catch(e){console.error(e.message);app.exit(1);}return;
  }
  if(process.argv.includes('--smoke-test')){
    try {
      const report=await win.webContents.executeJavaScript('window.runSmokeTest()');
      const target=path.resolve(process.env.AERODESK_TEST_OUTPUT||path.join(app.getPath('temp'),'aerodesk-smoke'));
      await fs.mkdir(target,{recursive:true});
      await fs.writeFile(path.join(target,'smoke-report.json'),JSON.stringify(report,null,2));
      await fs.writeFile(path.join(target,'app-screenshot.png'),(await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify(report)); app.exit(report.ok?0:1);
    }catch(e){console.error(e);app.exit(1);}
  }
});
app.on('window-all-closed',()=>app.quit());
ipcMain.handle('open-file',async(_event,kind)=>{
  if(!['model','project'].includes(kind))throw Error('Unknown file type');
  const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:kind==='model'?[{name:'CAD and mesh models',extensions:['stl','obj','step','stp','3mf']}]:[{name:'AeroDesk project',extensions:['aero']} ]});
  if(result.canceled)return null;
  const file=result.filePaths[0],stat=await fs.stat(file);
  if(stat.size>512*1024*1024)throw Error('Please choose a file smaller than 512 MB.');
  const bytes=kind==='project'?Buffer.from(JSON.stringify(await readProject(file))):await fs.readFile(file);
  return {name:path.basename(file),bytes:new Uint8Array(bytes)};
});
ipcMain.handle('save-file',async(_event,{kind,name,data})=>{
  const types={pdf:['pdf','PDF analysis report'],html:['html','Printable analysis report'],stl:['stl','Cleaned STL (meters)'],project:['aero','AeroDesk project'],csv:['csv','CSV results'],vtk:['vtk','VTK flow field'],image:['png','PNG image']};
  if(!types[kind]||typeof data!=='string'||data.length>100*1024*1024)throw Error('Invalid export');
  const [ext,label]=types[kind];
  const result=await dialog.showSaveDialog(win,{defaultPath:path.basename(name||'AeroDesk')+'.'+ext,filters:[{name:label,extensions:[ext]}]});
  if(result.canceled)return false;
  if(kind==='project'){await writeProject(result.filePath,data);return true;}
  if(kind==='pdf'){const pdf=await renderReportPDF(data);await fs.writeFile(result.filePath,pdf);return true;}
  await fs.writeFile(result.filePath,kind==='image'?Buffer.from(data.replace(/^data:image\/png;base64,/,''),'base64'):data);
  return true;
});

async function renderReportPDF(html){
 const report=new BrowserWindow({show:false,webPreferences:{partition:'aerodesk-report',sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
 try{report.webContents.setWindowOpenHandler(()=>({action:'deny'}));report.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 await report.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html.replace('<meta charset="utf-8">',`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`)));return await report.webContents.printToPDF({printBackground:true,pageSize:'A4',margins:{top:.4,bottom:.4,left:.4,right:.4}});
 }finally{report.destroy();}
}






