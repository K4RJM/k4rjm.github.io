// CPS-known clone data only. These ranges are not a complete flash/firmware map.
export const REGIONS = Object.freeze([
  Object.freeze({start:0x0000, size:0x8040, offset:0}),
  Object.freeze({start:0x9000, size:0x40, offset:0x8040}),
  Object.freeze({start:0xa000, size:0x1c0, offset:0x8080}),
]);
export const SIZE=0x8240;
export const TRAILER='UV-5R Mini';
export const SECTIONS=Object.freeze([
  {label:'Channel records (1000 CPS slots)',start:0,end:0x7d00},
  {label:'Uninterpreted gap — purpose unknown',start:0x7d00,end:0x8000},
  {label:'A/B frequency-mode data',start:0x8000,end:0x8040},
  {label:'General settings',start:0x9000,end:0x9040},
  {label:'DTMF and remaining bytes',start:0xa000,end:0xa1c0},
]);
export const hex=n=>n.toString(16).toUpperCase().padStart(4,'0');
export function offset(address){for(const r of REGIONS)if(address>=r.start&&address<r.start+r.size)return r.offset+address-r.start;return -1;}
export function address(off){for(const r of REGIONS)if(off>=r.offset&&off<r.offset+r.size)return r.start+off-r.offset;throw Error('Offset outside captured ranges');}
export function validRead(addr,len){return Number.isInteger(addr)&&len===64&&addr%64===0&&REGIONS.some(r=>addr>=r.start&&addr+len<=r.start+r.size);}
export function crypt(b,o){const k=[67,79,32,55][o%4];return k!==32&&![0,255,k,k^255].includes(b)?b^k:b;}
export function plain(raw){if(raw.length!==SIZE)throw Error('Incomplete capture');return Uint8Array.from(raw,crypt);}
export function parseImage(bytes){
  if(!(bytes instanceof Uint8Array))throw Error('Expected bytes');
  if(bytes.length!==SIZE+10||new TextDecoder().decode(bytes.subarray(SIZE))!==TRAILER)
    throw Error('Expected a Mini 5 Studio raw .img (33,354 bytes with UV-5R Mini trailer). CPS .dat and CHIRP images are not interchangeable with this format.');
  return bytes.slice(0,SIZE);
}
export function imageFile(raw){if(raw.length!==SIZE)throw Error('Incomplete capture');const b=new Uint8Array(SIZE+10);b.set(raw);b.set(new TextEncoder().encode(TRAILER),SIZE);return b;}
export function summarize(raw){
  const p=plain(raw);
  return SECTIONS.map(s=>{const b=p.subarray(offset(s.start),offset(s.end-1)+1);return {...s,bytes:b.length,ff:b.filter(x=>x===255).length,zero:b.filter(x=>x===0).length,distinct:new Set(b).size};});
}
export function compare(a,b){
  if(a.length!==SIZE||b.length!==SIZE)throw Error('Both captures must be complete');
  const changes=[];for(let i=0;i<SIZE;i++)if(a[i]!==b[i])changes.push({address:hex(address(i)),offset:i,rawBefore:a[i],rawAfter:b[i],decodedBefore:crypt(a[i],i),decodedAfter:crypt(b[i],i)});
  return {total:changes.length,sections:SECTIONS.map(s=>({label:s.label,start:hex(s.start),end:hex(s.end-1),changed:changes.filter(c=>parseInt(c.address,16)>=s.start&&parseInt(c.address,16)<s.end).length})),changes};
}
export function dump(raw,section,decoded=true){const b=decoded?plain(raw):raw;let lines=[];for(let a=section.start;a<section.end;a+=16){const row=b.subarray(offset(a),offset(a)+Math.min(16,section.end-a));lines.push(`${hex(a)}  ${[...row].map(x=>x.toString(16).padStart(2,'0')).join(' ').padEnd(47)}  ${[...row].map(x=>x>=32&&x<=126?String.fromCharCode(x):'.').join('')}`);}return lines.join('\n');}
