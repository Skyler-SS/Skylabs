const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
  studyLoad:input=>ipcRenderer.invoke('study-load',input),onshapeMaterial:link=>ipcRenderer.invoke('onshape-material',link),
  aiStatus:()=>ipcRenderer.invoke('ai-status'),aiConnect:key=>ipcRenderer.invoke('ai-connect',key),aiModels:()=>ipcRenderer.invoke('ai-models'),aiDisconnect:()=>ipcRenderer.invoke('ai-disconnect'),aiReview:evidence=>ipcRenderer.invoke('ai-review',evidence),apiKeys:()=>ipcRenderer.invoke('open-api-keys'),
  fusionInstall:()=>ipcRenderer.invoke('fusion-install'),fusionStatus:()=>ipcRenderer.invoke('fusion-status'),fusionImport:()=>ipcRenderer.invoke('fusion-import'),
  modelConvert:values=>ipcRenderer.invoke('model-convert',values),
  modelClean:values=>ipcRenderer.invoke('model-clean',values),
  foamInfo:()=>ipcRenderer.invoke('foam-info'),
  foamPlan:values=>ipcRenderer.invoke('foam-plan',values),
  foamRun:values=>ipcRenderer.invoke('foam-run',values),
  foamRestore:values=>ipcRenderer.invoke('foam-restore',values),
  foamCancel:()=>ipcRenderer.invoke('foam-cancel'),
  foamCase:folder=>ipcRenderer.invoke('foam-case',folder),
  foamProgress:callback=>{ipcRenderer.on('foam-progress',(_event,data)=>callback(data));},
  open:kind=>ipcRenderer.invoke('open-file',kind),
  save:payload=>ipcRenderer.invoke('save-file',payload),
  onshapeStatus:()=>ipcRenderer.invoke('onshape-status'),
  onshapeBrowse:input=>ipcRenderer.invoke('onshape-browse',input),
  onshapeConnect:values=>ipcRenderer.invoke('onshape-connect',values),
  onshapeDisconnect:()=>ipcRenderer.invoke('onshape-disconnect'),
  onshapeImport:link=>ipcRenderer.invoke('onshape-import',link),
  onshapeAssembly:link=>ipcRenderer.invoke('onshape-assembly',link),
  onAssemblyProgress:fn=>ipcRenderer.on('assembly-progress',(_e,d)=>fn(d)),
  onshapeHelp:()=>ipcRenderer.invoke('onshape-help')
});

