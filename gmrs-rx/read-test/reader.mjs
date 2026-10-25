// Read-only diagnostic transport, based on the existing Mini 5 Studio handshake.
// No W command, upload method, arbitrary-address interface, or write self-test.
import {REGIONS,SIZE,validRead,hex} from './memory.mjs';
const enc=new TextEncoder();
const MAGIC=enc.encode('PROGRAMCOLORPROU');
const INIT=Uint8Array.from('53454e4421050d010101041108050d0d01110f091209100400'.match(/../g),x=>parseInt(x,16));
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
// Application deadlines, not protocol delays. The four-second response wait is unchanged.
export const BLUETOOTH_DEADLINES=Object.freeze({chooser:120000,connect:20000,discovery:15000,notifications:15000,send:10000});
export function allowedCommand(b){return same(b,MAGIC)||same(b,INIT)||(b.length===1&&[0x46,0x4d,0x45].includes(b[0]))||(b.length===4&&b[0]===0x52&&validRead((b[1]<<8)|b[2],b[3]));}
export class Reader {
  constructor({deadlines={}}={}){
    this.deadlines=Object.freeze({...BLUETOOTH_DEADLINES,...deadlines});
    if(Object.values(this.deadlines).some(ms=>!Number.isSafeInteger(ms)||ms<1||ms>120000))throw Error('Invalid Bluetooth deadline');
    this.pendingNative=new Set();this.unsettledNative=new Set();
    this.rx=[];this.waiter=null;this.busy=false;this.connecting=false;this.generation=0;this.device=null;this.char=null;this.log=()=>{};this.onDisconnect=()=>{};this.notify=e=>{if(e.target===this.char)this.receive(e.target.value);};
  }
  get connected(){return !!this.device?.gatt?.connected&&!!this.char;}
  native(stage,start,ms,onLate=()=>{}){
    const token=this.generation,record={};this.unsettledNative.add(record);
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value,success=false)=>{if(settled)return;settled=true;clearTimeout(timer);this.pendingNative.delete(cancel);success?resolve(value):reject(error||Error('Bluetooth operation failed'));};
      const cancel=error=>finish(error);
      const timer=setTimeout(()=>{
        const error=Object.assign(Error(`${stage} timed out after ${ms/1000} seconds; the operation stopped. No write will be retried.`),{name:'TimeoutError'});
        finish(error);
        try{this.disconnect();}catch(cleanup){this.log('Browser disconnect failed: '+cleanup.message);}
      },ms);
      this.pendingNative.add(cancel);
      let native;
      try{native=start();}catch(error){this.unsettledNative.delete(record);finish(error);return;}
      // A deadline cannot cancel the underlying browser/OS call. Keep it quarantined
      // until it settles; observe late rejection and never resume the abandoned operation.
      Promise.resolve(native).then(value=>{
        this.unsettledNative.delete(record);
        if(!settled&&token===this.generation)finish(null,value,true);
        else{finish(Error('Radio operation cancelled'));try{onLate(value);}catch(error){this.log('Abandoned Bluetooth cleanup failed: '+error.message);}}
      },error=>{this.unsettledNative.delete(record);finish(error);});
    });
  }
  invalidate(error){this.generation++;for(const cancel of [...this.pendingNative])cancel(error);this.fail(error);this.clearCharacteristic();this.rx=[];}
  pause(ms){return new Promise((resolve,reject)=>{const cancel=error=>{clearTimeout(timer);this.pendingNative.delete(cancel);reject(error);};const timer=setTimeout(()=>{this.pendingNative.delete(cancel);resolve();},ms);this.pendingNative.add(cancel);});}
  async connect({pickAny=false}={}){
    if(this.busy||this.connecting)throw Error('Another radio operation is already running');
    if(this.unsettledNative.size)throw Error('A previous Bluetooth operation is still pending in the browser. Wait for it to settle, or save your work and reload before reconnecting.');
    if(!navigator.bluetooth)throw Error('Use Chrome or Edge on localhost with Bluetooth available');
    if(this.connected)return;
    this.disconnect();this.connecting=true;const token=this.generation;
    const check=()=>{if(token!==this.generation)throw Error('Connection cancelled');};
    let stage='Choosing radio',device;
    try{
      this.log(stage);
      device=await this.native(stage,()=>navigator.bluetooth.requestDevice(pickAny?{acceptAllDevices:true,optionalServices:[0xffe0]}:{filters:[{services:[0xffe0]}],optionalServices:[0xffe0]}),this.deadlines.chooser);check();this.device=device;
      this.disconnected=()=>{if(token!==this.generation||this.device!==device||device.gatt.connected)return;this.invalidate(Error('Bluetooth link ended; the current operation stopped'));this.onDisconnect();};
      device.addEventListener('gattserverdisconnected',this.disconnected);
      for(let attempt=1;attempt<=3;attempt++){
        try{
          check();stage=`Connecting Bluetooth (${attempt}/3)`;this.log(stage);
          const server=await this.native(stage,()=>device.gatt.connect(),this.deadlines.connect,()=>{if(device.gatt.connected)device.gatt.disconnect();});check();
          stage='Finding radio service';this.log(stage);if(!device.gatt.connected)throw Error('Link ended before service discovery');
          const service=await this.native(stage,()=>server.getPrimaryService(0xffe0),this.deadlines.discovery);check();
          stage='Finding data connection';this.log(stage);const characteristic=await this.native(stage,()=>service.getCharacteristic(0xffe1),this.deadlines.discovery);check();
          stage='Enabling radio responses';this.log(stage);await this.native(stage,()=>characteristic.startNotifications(),this.deadlines.notifications);check();
          if(!device.gatt.connected)throw Error('Link ended during notification setup');
          this.char=characteristic;this.notify=e=>{if(token===this.generation&&e.target===characteristic)this.receive(e.target.value);};this.char.addEventListener('characteristicvaluechanged',this.notify);this.rx=[];
          this.log('Bluetooth ready — no programming commands sent');return;
        }catch(e){
          if(token!==this.generation)throw e;this.clearCharacteristic();
          const transient=e.name==='NetworkError'||!device.gatt.connected;
          // Cleanup of a failed setup attempt is intentional, not a new link-loss event.
          if(device.gatt.connected){device.removeEventListener('gattserverdisconnected',this.disconnected);device.gatt.disconnect();device.addEventListener('gattserverdisconnected',this.disconnected);}
          if(!transient||attempt===3)throw e;
          this.log(`${stage} failed: ${e.message}. Retrying connection setup only…`);
          await this.pause(600);check();
        }
      }
    }catch(e){if(token===this.generation){try{this.disconnect();}catch(cleanup){this.log('Browser disconnect failed: '+cleanup.message);}}throw Error(`${stage}: ${e.message}`);}
    finally{this.connecting=false;}
  }
  clearCharacteristic(){this.char?.removeEventListener?.('characteristicvaluechanged',this.notify);this.char=null;}
  disconnect(){this.invalidate(Error('Radio operation cancelled'));if(this.device&&this.disconnected)this.device.removeEventListener?.('gattserverdisconnected',this.disconnected);this.disconnected=null;if(this.device?.gatt?.connected)this.device.gatt.disconnect();}
  fail(e){if(this.waiter){const w=this.waiter;this.waiter=null;clearTimeout(w.timer);w.reject(e);}}
  receive(view){const bytes=new Uint8Array(view.buffer,view.byteOffset,view.byteLength);if(this.rx.length+bytes.length>4096){this.fail(Error('Unexpected excess response data'));return;}this.rx.push(...bytes);this.serve();}
  serve(){if(this.waiter&&this.rx.length>=this.waiter.n){const w=this.waiter;this.waiter=null;clearTimeout(w.timer);w.resolve(Uint8Array.from(this.rx.splice(0,w.n)));}}
  wait(n,ms=4000){if(this.waiter)throw Error('Overlapping response waits');return new Promise((resolve,reject)=>{const w={n,resolve,reject,timer:null};this.waiter=w;w.timer=setTimeout(()=>{if(this.waiter===w){this.waiter=null;reject(Error(`Timeout: expected ${n} response bytes, received ${this.rx.length}`));}},ms);this.serve();});}
  async send(bytes){
    if(!allowedCommand(bytes))throw Error('Blocked: only identification, known-range reads and exit are permitted');
    if(!this.char||!this.connected)throw Error('Radio is not connected');
    const characteristic=this.char;
    // Capture the characteristic once; no automatic resend after failure or deadline.
    if(characteristic.properties.writeWithoutResponse)await this.native('Sending Bluetooth data',()=>characteristic.writeValueWithoutResponse(bytes),this.deadlines.send);
    else if(characteristic.properties.write)await this.native('Sending Bluetooth data',()=>characteristic.writeValueWithResponse(bytes),this.deadlines.send);
    else throw Error('Bluetooth characteristic does not support sending read requests');
  }
  async request(cmd,n){if(this.rx.length)throw Error('Unexpected leftover response bytes; disconnect and retry');const token=this.generation;await this.send(cmd);if(token!==this.generation)throw Error('Radio operation cancelled');return this.wait(n);}
  async identify(){
    this.rx=[];
    if((await this.request(MAGIC,1))[0]!==6)throw Error('Identification not acknowledged');
    const config=await this.request(Uint8Array.of(0x46),16);
    const id=await this.request(Uint8Array.of(0x4d),15);
    const model=new TextDecoder().decode(id.subarray(0,8)).trim();
    if(model!=='5RMINI')throw Error(`Unexpected radio model ${JSON.stringify(model)}; no memory was read`);
    if((await this.request(INIT,1))[0]!==6)throw Error('Read initialization not acknowledged');
    return {model,id:[...id],config:[...config]};
  }
  async block(addr){
    if(!validRead(addr,64))throw Error('Address outside approved read map');
    const response=await this.request(Uint8Array.of(0x52,addr>>8,addr&255,64),68);
    // The supplied real capture has opcode 0x52 on all 521 responses.
    // Reject other variants pending investigation, rather than guessing compatibility.
    if(response[0]!==0x52||((response[1]<<8)|response[2])!==addr||response[3]!==64)
      throw Error(`Unexpected header at ${hex(addr)}: ${[...response.subarray(0,4)].map(x=>x.toString(16).padStart(2,'0')).join(' ')}. Stop; do not relax validation without inspecting the protocol.`);
    return {payload:response.slice(4),header:[...response.subarray(0,4)]};
  }
  async download(progress=()=>{}){
    if(this.busy)throw Error('A download is already running');if(!this.connected)throw Error('Connect the radio first');
    this.busy=true;const raw=new Uint8Array(SIZE);let used=0;const headers=[];
    try{
      const identity=await this.identify();
      for(const r of REGIONS)for(let a=r.start;a<r.start+r.size;a+=64){const b=await this.block(a);headers.push(b.header);raw.set(b.payload,used);used+=64;progress(used/SIZE);}
      if(used!==SIZE||this.rx.length)throw Error('Incomplete capture or unexpected trailing response');
      await this.send(Uint8Array.of(0x45)); // CPS Read sends E when finished.
      return {raw,metadata:{...identity,capturedAt:new Date().toISOString(),bytes:used,blocks:headers.length,headers,scope:'CPS-known clone data only, not firmware',memoryWrites:0}};
    }finally{this.busy=false;this.disconnect();}
  }
}
