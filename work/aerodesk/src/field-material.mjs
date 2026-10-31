import * as T from 'three';
import {ramps} from './analysis.mjs';
// Interpolate measured values before applying the palette; interpolating RGB
// across a large grid triangle can erase narrow bands and shift their meaning.
export function sliceMaterial(scale){
 const palette=ramps[scale.palette].map(v=>new T.Color(v));
 return new T.ShaderMaterial({side:T.DoubleSide,toneMapped:false,
  uniforms:{limits:{value:new T.Vector2(scale.min,scale.max)},palette:{value:palette}},
  vertexShader:'attribute float scalar; varying float value; void main(){value=scalar;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`uniform vec2 limits; uniform vec3 palette[${palette.length}]; varying float value;
  void main(){float x=clamp((value-limits.x)/(limits.y-limits.x),0.0,1.0)*${(palette.length-1).toFixed(1)};
  vec3 color=palette[0]; ${palette.slice(0,-1).map((_,i)=>`if(x>=${i.toFixed(1)})color=mix(palette[${i}],palette[${i+1}],clamp(x-${i.toFixed(1)},0.0,1.0));`).join('\n')}
  gl_FragColor=vec4(color,1.0);
  #include <colorspace_fragment>
  }`});
}
