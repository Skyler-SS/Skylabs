// Generates app.ico and the header mark from one shared path definition.
// Run once with: npx electron scripts/make-icon.cjs
// Not part of the app or the package: rasterization needs Electron, so this borrows the
// same offscreen capturePage path main.cjs already uses for report rendering.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');

// --- Geometry -------------------------------------------------------------------
// The mark is an S built from two circular arcs that meet at the centre, given an
// aerofoil thickness distribution: full thickness at the waist where the two noses
// meet back to back, tapering along a NACA aft section to sharp terminals. That is
// also classic type anatomy for an S - thick middle, thin terminals - so the shape
// reads as a letter and as a wing at the same time.
// The two lobe circles must be tangent at the waist, so the centre offset equals the
// radius. SWEEP is how far each lobe travels before its terminal; TAPER sharpens the
// aerofoil aft section so the tips read as trailing edges rather than cut-off stubs.
const R=44,CX=128,CY=128,OFF=44;
const SWEEP=205,TAPER=1.6;

// NACA 4-digit symmetric half-thickness, chord-normalised.
function naca(x){return .2969*Math.sqrt(x)-.126*x-.3516*x*x+.2843*x**3-.1015*x**4;}
const NOSE=.3;                              // chord station of maximum thickness
const PEAK=naca(NOSE);

// Half width at parameter t, t=0 at the waist and t=1 at the terminal tip.
function halfWidth(t,maxW){
 const x=NOSE+(1-NOSE)*t;
 return maxW*Math.pow(Math.max(0,naca(x))/PEAK,TAPER);
}

// One lobe's centreline point and its offset direction at parameter t.
// `sign` is +1 for the upper lobe, -1 for the lower (a 180 deg rotation about CX,CY).
// The upper lobe starts at the waist - the bottom of its circle, 90 deg - and sweeps
// SWEEP degrees through left and top out to the terminal.
function lobePoint(t,sign){
 const a=(90+SWEEP*t)*Math.PI/180;
 const c=Math.cos(a),s=Math.sin(a);
 return {
  x:CX+sign*R*c, y:(CY-sign*OFF)+sign*R*s,
  // Radial direction, rotated with the lobe. Both lobes end up offsetting to the
  // same side at the waist, so the two halves join without a step.
  nx:sign*c, ny:sign*s,
 };
}

function outline(maxW,steps=220){
 const side=sign=>{
  const outer=[],inner=[];
  for(let i=0;i<=steps;i++){
   const t=i/steps,{x,y,nx,ny}=lobePoint(t,sign),w=halfWidth(t,maxW);
   outer.push([x+nx*w,y+ny*w]);
   inner.push([x-nx*w,y-ny*w]);
  }
  return {outer,inner};
 };
 const up=side(1),lo=side(-1);
 // Trace one closed loop: up the upper lobe's outer edge from its tip to the waist,
 // straight on along the lower lobe's outer edge to its tip, then back along the
 // inner edges. Each tip has near-zero width, so the loop closes to a point there.
 return [
  ...up.outer.slice().reverse(),
  ...lo.outer,
  ...lo.inner.slice().reverse(),
  ...up.inner,
 ];
}

const fmt=n=>Math.round(n*100)/100;
function pathData(maxW){
 const pts=outline(maxW);
 return 'M'+pts.map(p=>fmt(p[0])+' '+fmt(p[1])).join('L')+'Z';
}

// --- SVG ------------------------------------------------------------------------
function svg(size,{badge=true,maxW=19}={}){
 const d=pathData(maxW);
 const ring=badge?`<rect x="3" y="3" width="250" height="250" rx="56" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="6"/>`:'';
 const back=badge?`<rect x="0" y="0" width="256" height="256" rx="58" fill="url(#bg)"/>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16304a"/><stop offset="1" stop-color="#0d1620"/></linearGradient>
<linearGradient id="foil" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#eaf6fd"/><stop offset=".5" stop-color="#9fd8f2"/><stop offset="1" stop-color="#3d9fd0"/></linearGradient>
</defs>
${back}${ring}
<path d="${d}" fill="${badge?'url(#foil)':'currentColor'}"/>
</svg>`;
}

// --- ICO packing ----------------------------------------------------------------
function ico(images){
 const head=Buffer.alloc(6);head.writeUInt16LE(0,0);head.writeUInt16LE(1,2);head.writeUInt16LE(images.length,4);
 const dir=Buffer.alloc(16*images.length);
 let offset=6+dir.length;
 images.forEach((im,i)=>{
  const o=i*16;
  dir[o]=im.size>=256?0:im.size;dir[o+1]=im.size>=256?0:im.size;
  dir[o+2]=0;dir[o+3]=0;
  dir.writeUInt16LE(1,o+4);dir.writeUInt16LE(32,o+6);
  dir.writeUInt32LE(im.png.length,o+8);dir.writeUInt32LE(offset,o+12);
  offset+=im.png.length;
 });
 return Buffer.concat([head,dir,...images.map(i=>i.png)]);
}

const SIZES=[16,24,32,48,64,128,256];

// A transparent window cannot be captured here, so the badge is rendered opaque and the
// rounded corners are cut afterwards by writing alpha straight into the BGRA bitmap.
// Coverage is sampled 4x4 per pixel so the corner stays smooth.
function roundCorners(image,radius){
 const {width,height}=image.getSize();
 const buf=image.toBitmap();
 const inside=(x,y)=>{
  const dx=Math.max(radius-x,x-(width-radius),0),dy=Math.max(radius-y,y-(height-radius),0);
  return dx*dx+dy*dy<=radius*radius;
 };
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let hit=0;
  for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++)if(inside(x+(sx+.5)/4,y+(sy+.5)/4))hit++;
  if(hit===16)continue;
  const i=(y*width+x)*4,a=hit/16;
  buf[i]=Math.round(buf[i]*a);buf[i+1]=Math.round(buf[i+1]*a);
  buf[i+2]=Math.round(buf[i+2]*a);buf[i+3]=Math.round(255*a);
 }
 return nativeImage.createFromBitmap(buf,{width,height});
}

async function render(win,markup){
 const page=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block;width:256px;height:256px}</style></head><body>${markup}</body></html>`;
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(page));
 await new Promise(r=>setTimeout(r,150));
 return win.webContents.capturePage();
}

async function main(){
 const dir=path.join(__dirname,'..');
 const win=new BrowserWindow({width:256,height:256,show:false,frame:false,useContentSize:true,
  webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});

 // Two masters: the normal weight, and a fuller one whose taper survives being shrunk
 // to 16 and 24 px.
 const normal=roundCorners(await render(win,svg(256,{maxW:16})),58);
 const bold=roundCorners(await render(win,svg(256,{maxW:21})),58);

 const images=SIZES.map(size=>{
  const master=size<=32?bold:normal;
  const im=size===256?master:master.resize({width:size,height:size,quality:'best'});
  const png=im.toPNG();
  console.log('  '+String(size).padStart(3)+'px  '+png.length+' bytes');
  return {size,png};
 });

 await fs.writeFile(path.join(dir,'app.ico'),ico(images));
 console.log('wrote app.ico with '+images.length+' sizes');

 // The header mark is the badge itself, so the title bar, the taskbar icon and the
 // header all show one identical mark.
 await fs.writeFile(path.join(dir,'src','mark.svg'),svg(256,{maxW:16}));
 await fs.writeFile(path.join(dir,'src','icon-256.png'),images[images.length-1].png);
 console.log('wrote src/mark.svg and src/icon-256.png');

 win.destroy();
 app.quit();
}

app.whenReady().then(main).catch(e=>{console.error(e);process.exit(1);});
