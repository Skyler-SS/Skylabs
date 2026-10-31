import {cleanMesh} from './clean-mesh.mjs';
self.onmessage=({data})=>{try{const result=cleanMesh(data);self.postMessage(result,[result.vertices.buffer]);}catch(e){self.postMessage({error:e.message});}};
