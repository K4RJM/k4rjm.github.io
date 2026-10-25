// GM-30 Pro Bluetooth CPS transport adapted from Ham-Rx Reader/Writer.
// Retains the proven Ham-Rx FFE0/FFE1 BLE connection, notification, retry,
// timeout and write-ack handling. Adjusts only GM-30 Pro identity/memory map.
// No firmware/flash erase/read/write operations.
import {Reader,allowedCommand} from './read-test/reader.mjs';
import {GM30_IMAGE_SIZE} from './gm30-image.mjs';
const e=new TextEncoder(),d=new TextDecoder('ascii');
const MAGIC=e.encode('PROGRAMCOLORPROU');
const INIT=Uint8Array.from('53454e4421050d010101041108050d0d01110f091209100400'.match(/../g),n=>parseInt(n,16));
export const GM30_REGIONS=Object.freeze([
 Object.freeze({start:0x0000,size:0x8040,offset:0}),
 Object.freeze({start:0x9000,size:0x0040,offset:0x8040}),
 Object.freeze({start:0xa000,size:0x02c0,offset:0x8080}),
 Object.freeze({start:0xd000,size:0x0040,offset:0x8340})
]);
export const GM30_READ_ADDRESSES=Object.freeze(GM30_REGIONS.flatMap(r=>Array.from({length:r.size/64},(_,i)=>r.start+i*64)));
export const GM30_WRITE_ADDRESSES=Object.freeze(GM30_REGIONS.flatMap(r=>Array.from({length:Math.ceil(r.size/128)},(_,i)=>r.start+i*128)));
function same(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function region(address,size){return GM30_REGIONS.find(r=>address>=r.start && address+size<=r.start+r.size);}
function fromAddress(address){const r=GM30_REGIONS.find(x=>address>=x.start&&address<x.start+x.size);if(!r)throw Error('Address outside GM-30 Pro memory map');return r.offset+address-r.start;}
function crypt(bytes){
 const key=[67,79,32,55];
 return Uint8Array.from(bytes,(v,i)=>{
  const k=key[i%4];return k!==32 && ![0,255,k,k^255].includes(v)?v^k:v;
 });
}
function validReadFrame(b){return b.length===4&&b[0]===0x52&&b[3]===64&&((b[1]<<8)|b[2])%64===0&&!!region((b[1]<<8)|b[2],64);}
function validWriteFrame(b) {
 if(!(b instanceof Uint8Array)||b.length!==132||b[0]!==0x57||b[3]!==128)return false;
 const addr=(b[1]<<8)|b[2];
 const r=GM30_REGIONS.find(x=>addr>=x.start&&addr<x.start+x.size);
 if(!r||(addr-r.start)%128)return false;
 const n=Math.min(128,r.start+r.size-addr);
 return b.subarray(4+n).every(v=>v===255);
}
export function makeGM30WritePlan(decodedMemory,{preserveBluetooth=true}={}){
 if(!(decodedMemory instanceof Uint8Array)||decodedMemory.length!==GM30_IMAGE_SIZE)throw Error('Complete GM-30 Pro image required.');
 const desired=decodedMemory.slice();
 // Equivalent to Ham-Rx's preservation of Wireless CPS ON at radio address 9022.
 if(preserveBluetooth)desired[0x8040+34]=1;
 const frames=GM30_REGIONS.flatMap(r=>Array.from({length:Math.ceil(r.size/128)},(_,i)=>{
  const addr=r.start+i*128,offset=r.offset+i*128,n=Math.min(128,r.size-i*128);
  const frame=new Uint8Array(132).fill(255);frame.set([0x57,addr>>8,addr&255,128]);
  frame.set(crypt(desired.subarray(offset,offset+n)),4);
  return frame;
 }));
 if(frames.length!==GM30_WRITE_ADDRESSES.length||frames.some((f,i)=>!validWriteFrame(f)||((f[1]<<8)|f[2])!==GM30_WRITE_ADDRESSES[i]))throw Error('Invalid GM-30 Pro write plan');
 return {target:desired,frames};
}
export function compareGM30Bytes(a,b){
 if(!(a instanceof Uint8Array)||!(b instanceof Uint8Array)||a.length!==GM30_IMAGE_SIZE||b.length!==GM30_IMAGE_SIZE)throw Error('Complete GM-30 Pro images required');
 let differences=0;const samples=[];
 for(let i=0;i<a.length;i++)if(a[i]!==b[i]){differences++;if(samples.length<24)samples.push({offset:i,expected:a[i],actual:b[i]});}
 return {differences,samples};
}
export class GM30Radio extends Reader {
 #permit=null;
 constructor(...args){super(...args);this.lastRead=null;this.report={phase:'idle',attempted:0,acknowledged:0};}
 async send(bytes){
  if(allowedCommand(bytes))return super.send(bytes);
  if(validReadFrame(bytes)){/* Model-approved read addresses not present in MINI-5 */ }
  else if(this.#permit&&same(bytes,this.#permit)&&validWriteFrame(bytes)){this.#permit=null;}
  else throw Error('Unapproved GM-30 Pro programming command');
  if(!this.connected||!this.char)throw Error('Bluetooth link ended');
  const chr=this.char;
  if(chr.properties.writeWithoutResponse)await this.native('Sending BLE data',()=>chr.writeValueWithoutResponse(bytes),this.deadlines.send);
  else if(chr.properties.write)await this.native('Sending BLE data',()=>chr.writeValueWithResponse(bytes),this.deadlines.send);
  else throw Error('Bluetooth characteristic cannot send data');
 }
 async identify(){
  if(!this.connected)throw Error('Connect the GM-30 Pro first');
  if(this.rx.length)throw Error('Stale BLE response data; reconnect before identifying');
  if((await this.request(MAGIC,1))[0]!==6)throw Error('GM-30 Pro programming handshake not acknowledged');
  const config=await this.request(Uint8Array.of(0x46),16);
  const id=await this.request(Uint8Array.of(0x4d),7);
  const model=d.decode(id).trimEnd();
  if(model!=='GM-30P')throw Error('Unexpected model '+JSON.stringify(model)+'; expected GM-30P');
  if((await this.request(INIT,1))[0]!==6)throw Error('GM-30 Pro read/write initialization not acknowledged');
  return {model,id:[...id],config:[...config]};
 }
 async capture(progress=()=>{}){
  const data=new Uint8Array(GM30_IMAGE_SIZE);
  for(let i=0;i<GM30_READ_ADDRESSES.length;i++){
   const addr=GM30_READ_ADDRESSES[i];
   const frame=Uint8Array.of(0x52,addr>>8,addr&255,64);
   const response=await this.request(frame,68);
   if(response[0]!==0x52||response[1]!==frame[1]||response[2]!==frame[2]||response[3]!==64)throw Error('Invalid read header at 0x'+addr.toString(16));
   data.set(crypt(response.subarray(4)),fromAddress(addr));
   progress(i+1,GM30_READ_ADDRESSES.length);
  }
  if(this.rx.length)throw Error('Unexpected trailing BLE response data');
  return data;
 }
 async readRadio(progress=()=>{}){
  if(this.busy)throw Error('Radio busy');
  if(!this.connected)throw Error('Connect radio before reading');
  this.busy=true;
  try{
   const identity=await this.identify();
   const memory=await this.capture(progress);
   this.lastRead={memory:memory.slice(),deviceId:this.device.id,identity};
   return {memory,identity};
  }catch(error){this.disconnect();throw error;}
  finally{this.busy=false;}
 }
 async writeRadio(memory,{confirmed=false,progress=()=>{}}={}){
  if(this.busy)throw Error('Radio busy');
  if(!confirmed)throw Error('Confirm full CPS programming first');
  if(!this.connected)throw Error('Connect radio before writing');
  if(!this.lastRead||this.lastRead.deviceId!==this.device?.id)throw Error('Read and save a GM-30 Pro backup from this radio before writing');
  const plan=makeGM30WritePlan(memory);
  const session={device:this.device,deviceId:this.device.id,char:this.char,generation:this.generation};
  const sameSession=()=>{if(!this.connected||this.device!==session.device||this.device.id!==session.deviceId||this.char!==session.char||this.generation!==session.generation)throw Error('Bluetooth session changed');};
  this.busy=true;
  this.report={phase:'initializing',attempted:0,acknowledged:0,total:plan.frames.length,verified:false};
  try{
   sameSession();await this.identify();sameSession();
   this.report.phase='writing';
   for(let i=0;i<plan.frames.length;i++){
    sameSession();const frame=plan.frames[i];this.#permit=frame;this.report.attempted++;
    const reply=await this.request(frame,1);
    if(reply[0]!==6||this.rx.length)throw Error('Unexpected GM-30 Pro write acknowledgement at block '+(i+1));
    this.report.acknowledged++;progress(i+1,plan.frames.length);
   }
   this.report.phase='written-pending-readback';
   this.lastWrite={target:plan.target.slice(),deviceId:session.deviceId};
   return {...this.report};
  }catch(error){this.report.phase='write-incomplete-or-uncertain';this.report.error=error.message;this.disconnect();throw error;}
  finally{this.#permit=null;this.busy=false;}
 }
 async verifyReadback(progress=()=>{}){
  if(!this.lastWrite||this.lastWrite.deviceId!==this.device?.id)throw Error('Reconnect to the programmed radio before verification');
  const result=await this.readRadio(progress);
  const comparison=compareGM30Bytes(this.lastWrite.target,result.memory);
  this.report.phase=comparison.differences?'mismatch':'verified';
  this.report.verified=comparison.differences===0;
  return {comparison,memory:result.memory};
 }
}
