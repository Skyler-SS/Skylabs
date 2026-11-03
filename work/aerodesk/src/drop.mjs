// Large CAD exports are accepted and reduced on import (see decimate.mjs) rather than
// rejected. The ceiling bounds peak memory while parsing, not the solver's mesh size.
export const MAX_MODEL_BYTES=512*1024*1024;
export const MAX_MODEL_LABEL='512 MB';
export function validateModelFile(file){
  if(!file||! /\.(stl|obj|step|stp|3mf)$/i.test(file.name||''))throw Error('Drop an STL or OBJ, STEP, or 3MF file. Folders and other file types are not supported.');
  if(!Number.isFinite(file.size)||file.size<=0)throw Error('That file is empty. Choose a model containing triangle surfaces.');
  if(file.size>MAX_MODEL_BYTES)throw Error('Please choose a model smaller than '+MAX_MODEL_LABEL+'.');
  return file;
}
export function chooseDroppedFile(files,busy=false,dialogOpen=false){
  if(busy)throw Error('Wait for the current import to finish, or stop the simulation, before dropping a new model.');
  if(dialogOpen)throw Error('Close the open dialog, then drop your model into SkyLabs.');
  if(files.length!==1)throw Error('Drop one STL, OBJ, STEP, or 3MF assembly file at a time.');
  return validateModelFile(files[0]);
}
