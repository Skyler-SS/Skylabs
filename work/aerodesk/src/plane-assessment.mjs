import {freeFlight} from '../environment.cjs';
import {shiftedMoment} from './analysis.mjs';
import {projectedArea} from './reference-area.mjs';

const clamp=x=>Math.max(0,Math.min(1,x));
const fmt=x=>Number.isFinite(x)?Number(x.toPrecision(3)).toString():'—';
export const assessmentDefaults={kind:'auto',targetLD:10,mass:null};
export function assessmentOptions(input={}){
  const o={...assessmentDefaults,...input};
  if(!['auto','plane','other'].includes(o.kind)||!Number.isFinite(o.targetLD)||o.targetLD<1||o.targetLD>100||!(o.mass===null||(Number.isFinite(o.mass)&&o.mass>0&&o.mass<=1000000)))throw Error('Plane assessment: choose a model type, L/D target from 1–100, and a positive flying mass or leave it blank.');
  return o;
}
// A shape screen, not a semantic CAD classifier. Work in the unpitched model frame.
// Projection union avoids counting overlapping triangles or both wing skins twice.
export function planeShape(vertices){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i++){const k=i%3;min[k]=Math.min(min[k],vertices[i]);max[k]=Math.max(max[k],vertices[i]);}
  const extent=max.map((v,k)=>v-min[k]),[length,height,span]=extent;
  const area=projectedArea(vertices,1,128),fill=area/(length*span);
  const candidate=span>0&&length>0&&height/span<.45&&span/length>.65&&fill>.08&&fill<.72;
  return {candidate,extent,area,fill,spanCenter:(min[2]+max[2])/2};
}
export function assessPlane({shape,options={},result=null,settings={},cg=null,measuredCG=false}){
  const o=assessmentOptions(options),active=o.kind==='plane'||(o.kind==='auto'&&shape?.candidate);
  const a={active,score:null,coverage:0,confidence:'No CFD result',detection:o.kind==='plane'?'Plane selected manually':o.kind==='other'?'Other model selected':shape?.candidate?'Wing-like shape detected · confirm orientation':'No clear wing-like shape detected',checks:[],tips:[],metrics:{},stability:'Not assessed: requires angle-of-attack and sideslip sweeps about the measured CG. Dynamic stability also needs inertia and time-dependent analysis.'};
  const tip=(id,title,evidence,action)=>a.tips.push({id,title,evidence,action});
  if(!active){tip('identify','Check the model type','Automatic recognition only screens proportions and top-view outline. It can miss aircraft or mistake other thin shapes for planes.','For an aircraft, orient the nose toward −X, top toward +Y and span along Z, then select “This is a plane” if needed.');return a;}
  if(!freeFlight(settings)){a.confidence='Flight score unavailable for this environment';tip('environment','Use the force results for this study','Water and ground effects are outside the free-flight aircraft scoring model.','Inspect drag, flow lift, pressure and friction; use air in open space for a plane score. Water loads exclude hydrostatic buoyancy.');return a;}
  const l=result?.liftCenter,valid=result?.engine==='openfoam'&&l?.panels?.length&&[...(l.force||[]),...(l.moment||[])].length===6&&[...l.force,...l.moment].every(Number.isFinite);
  const level=Math.abs(settings.yaw||0)<.1&&Math.abs(settings.roll||0)<.1;
  if(!valid){tip('run','Run a 3D OpenFOAM study','A geometry preview does not provide trustworthy aircraft forces.','Set the real size, flight speed and pitch, then run OpenFOAM. The score will use native surface loads.');return a;}
  if(!result.converged||!result.forceConvergence?.stable||!result.reliability?.acceptable){a.confidence=!result.converged||!result.forceConvergence?.stable?'Low · convergence not established':'Numerical quality checks need attention';tip('quality','Resolve the numerical checks before scoring',result.reliability?.blocking?.join(' ')||'Converged, resolved results are needed for a meaningful score.', 'Open Quality, address wall-layer and convergence issues, then compare finer meshes.');return a;}
  const [drag,lift]=l.force,positive=drag>1e-8&&lift>1e-8,ld=positive?lift/drag:0;
  const supportedMass=Math.max(0,lift)/9.80665;
  a.metrics={lift,drag,ld:positive?ld:null,supportedMass,span:shape.extent[2]*settings.length};
  const stable=result.forceConvergence?.stable===true&&result.converged===true&&result.reliability?.acceptable;
  a.confidence=result.reliability?.meshComparison?.passed?'Preliminary · three-mesh check passed; experimental accuracy unverified':'Preliminary · mesh sensitivity unverified';
  const check=(id,label,weight,value,detail)=>a.checks.push({id,label,weight,value:value===null?null:clamp(value),detail});
  check('efficiency','Lift / drag',50,positive?ld/o.targetLD:0,positive?'L/D '+fmt(ld)+' / target '+fmt(o.targetLD):'Positive lift and drag are required for this upright flight target.');
  check('weight','Level-flight lift match',25,o.mass!==null&&level?1-Math.abs(lift/(o.mass*9.80665)-1):null,o.mass===null?'Enter actual flying mass; solid CAD mass is not used.':!level?'Requires zero yaw and roll.':'Lift / weight = '+fmt(lift/(o.mass*9.80665))+' at this condition.');
  const moment=measuredCG&&cg?shiftedMoment(l.moment,l.force,cg):null;
  const trim=moment&&lift>1e-8&&settings.length>0?Math.abs(moment[2])/(lift*settings.length):null;
  a.metrics.pitchMoment=moment?.[2]??null;
  check('trim','Pitch trim demand',15,trim!==null&&level?1-trim/.1:null,trim===null?'Enter a measured CG; uniform solid estimate is excluded.':!level?'Requires zero yaw and roll.':'|M pitch| / (lift × longest dimension) = '+fmt(trim)+'. Aerodynamic moment only; excludes thrust.');
  let left=0,right=0;const center=(shape.spanCenter||0)*settings.length;
  for(const p of l.panels){if(p.center[2]<center)left+=p.force[1];else right+=p.force[1];}
  const imbalance=left>0&&right>0?Math.abs(left-right)/(Math.abs(left)+Math.abs(right)):null;
  a.metrics.imbalance=level?imbalance:null;
  check('balance','Left / right lift balance',10,level&&imbalance!==null?1-imbalance/.2:null,!level?'Requires zero yaw and roll.':imbalance===null?'Positive lift on both halves required.':'Lift imbalance '+fmt(100*imbalance)+'%. Split at model span midpoint.');
  const known=a.checks.filter(c=>c.value!==null);a.coverage=known.reduce((s,c)=>s+c.weight,0);
  a.score=a.coverage?Math.round(100*known.reduce((s,c)=>s+c.weight*c.value,0)/a.coverage):null;
  tip('quality','Verify the result before changing CAD',(stable?'Residual and force targets passed.':'Residual or force targets have not passed.')+' '+(l.faces||l.panels.length)+' CFD wall faces.','Run a finer mesh at identical conditions and compare lift, drag and moments. A converged solution can still be mesh-sensitive; SST does not model laminar transition.');
  if(!positive)tip('direction','Check orientation and flight condition','Lift '+fmt(lift)+' N; drag '+fmt(drag)+' N.','Confirm nose toward −X and top toward +Y. Test a small positive pitch change, with sufficient convergence; do not infer stall speed from this result.');
  if(positive&&ld<o.targetLD)tip('efficiency','Improve lift for the drag produced','L/D is '+fmt(ld)+' against your target '+fmt(o.targetLD)+'. The default target is a scoring choice, not an aircraft standard.','Compare wing incidence or airfoil variants at the same required lift. A longer span at fixed wing area may reduce induced drag, but rerun CFD and check structural weight and stiffness.');
  const pd=l.pressureForce?.[0],vd=l.viscousForce?.[0];
  if(Number.isFinite(pd)&&Number.isFinite(vd))tip('drag','Investigate '+(pd>=vd?'pressure drag':'skin friction'),'Pressure drag '+fmt(pd)+' N; friction drag '+fmt(vd)+' N. Pressure drag includes induced drag; this does not isolate separation. ',pd>=vd?'Inspect pressure and streamlines around wing/body joins, pods and abrupt rear-body changes. Try smoother junctions and tapered fairings one at a time; confirm lower total drag at matched lift.':'Review wetted area and surface roughness. Try smoother surfaces or streamlined fittings, preserving wing lift and control authority; compare total drag at matched lift.');
  if(o.mass===null)tip('mass','Enter the ready-to-fly mass','This condition produces '+fmt(lift)+' N of lift, equal to the weight of '+fmt(supportedMass)+' kg in unbanked level flight. This is not a payload limit.','Weigh the assembled plane including battery, motors and payload, then enter Flying mass here. The app will check whether this condition balances its weight.');
  else if(level)tip('weight',Math.abs(lift/(o.mass*9.80665)-1)<.1?'Lift is near the entered weight':'Adjust the level-flight operating point','Lift '+fmt(lift)+' N versus weight '+fmt(o.mass*9.80665)+' N.',lift<o.mass*9.80665?'Explore more wing area, modest incidence changes or a higher flight speed. Recompute each variant and check stall behavior separately; a steady result does not establish stall margin.':'Explore a lower incidence or another flight speed until lift matches weight. Compare drag after matching lift; excess lift alone does not make a design better.');
  if(imbalance!==null&&level&&imbalance>.03)tip('balance','Check unequal wing loading','Left / right lift differs by '+fmt(100*imbalance)+'% of their combined magnitude.','Check wing symmetry, incidence and model alignment, then refine the mesh. Only change wing geometry if the imbalance persists; it may be numerical.');
  if(!measuredCG)tip('cg','Measure the assembled center of gravity','The current CG is a uniform-solid estimate, so pitch trim is unscored.','In Material & center of gravity, choose a manual CG and enter its measured position from the model center. Include battery and component placement; do not move the CG to the lift marker as a stability rule.');
  else if(moment)tip('trim','Check pitch trim at your CG','Aerodynamic pitching moment is '+fmt(moment[2])+' N·m (right-hand +Z; nose toward −X).','Test small tail-incidence or elevator changes to reduce the net pitching moment at the intended lift. Include propulsion moments separately. A near-zero moment is trim, not proof of stability.');
  tip('stability','Test stability before sizing the tail',a.stability,'Compare moments at several nearby pitch angles and both sideslip directions with the same measured CG. If restoring response is insufficient, test tail area/arm or CG-placement variants. No stable/unstable verdict or neutral point is inferred from a single lift line.');
  return a;
}
export const scoreMethod='Heuristic comparison, not a validated aircraft rating. Weights: L/D 50, level-flight lift match 25, pitch trim demand 15, left/right balance 10. Missing checks are excluded and remaining weights renormalized to 100; compare designs only with the same inputs and coverage. L/D saturates at your target. Lift match falls linearly from 100% at L/W=1 to 0% at L/W=0 or 2. Trim falls from 100% at zero moment to 0% at |Mz|/(L × longest dimension)=0.10. Balance falls from 100% at equal lift to 0% at 20% imbalance. These thresholds are scoring conventions, not flight limits. Static/dynamic stability, stall, control authority, structures and propulsion are not scored. No score certifies flight readiness.';
export function assessmentHTML(a){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return '<p class="plane-detection">'+esc(a.detection)+'</p><div class="plane-score"><strong>'+ (a.score===null?'—':a.score)+'</strong><span>/ 100<br><b>Provisional plane score</b></span></div><p class="plane-confidence">'+esc(a.confidence)+' · '+a.coverage+'% rubric coverage</p><p class="plane-scope">'+(a.method?'A comparison across the selected flight conditions. ':'A design comparison at this flight condition. ')+ ''+(a.stability.startsWith('Not assessed')?'Stability is unassessed. ':'')+esc(a.stability)+'</p>'+(a.checks.length?'<details><summary>Score breakdown &amp; method</summary>'+a.checks.map(c=>'<div class="plane-check"><b>'+esc(c.label)+' · '+(c.value===null?'Not assessed':Math.round(c.value*100)+'/100')+'</b><p>'+esc(c.detail)+' Weight '+c.weight+'%.</p></div>').join('')+'<p>'+esc(a.method||scoreMethod)+'</p></details>':'')+'<h4>What to try next</h4><ol class="plane-tips">'+a.tips.map(t=>'<li><details><summary>'+esc(t.title)+'</summary><p>'+esc(t.evidence)+'</p><p>'+esc(t.action)+'</p></details></li>').join('')+'<details><summary>Physics references</summary><p>NASA: <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/">Induced drag</a>, <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/center-of-pressure/">Center of pressure</a>, <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/aircraft-center-of-gravity/">Center of gravity</a>. References explain physics; the scoring rubric is SkyLabs’s own heuristic.</p></details>';
}

