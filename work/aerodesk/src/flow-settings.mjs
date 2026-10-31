export function scientificReynolds(value){return Number.isFinite(value)&&value>0?value.toExponential(2):'—';}

export function reynoldsNumber({speed,length,nu}) {
  if (![speed,length,nu].every(v=>Number.isFinite(v)&&v>0)) throw Error('Speed, model length and viscosity must be positive numbers.');
  return speed*length/nu;
}

export function speedForReynolds(re,length,nu) {
  if (!Number.isFinite(re)||re<=0) throw Error('Enter a positive Reynolds number.');
  reynoldsNumber({speed:1,length,nu});
  const speed=re*nu/length;
  if (speed<.1||speed>100) throw Error('This Reynolds number needs '+speed.toPrecision(5)+' m/s. For the current size and viscosity, enter Re between '+(.1*length/nu).toPrecision(6)+' and '+(100*length/nu).toPrecision(6)+' (0.1–100 m/s).');
  return speed;
}
