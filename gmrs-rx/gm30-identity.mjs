// Read-only GM-30 Pro model identification on the inherited Ham-Rx BLE link.
// CHIRP baofeng_uv17Pro.py uses PROGRAMCOLORPROU, F (16 bytes), M (7 bytes).
// No memory reads, uploads, writes, firmware operations, or automatic retries.
const enc = new TextEncoder();
const magic=enc.encode('PROGRAMCOLORPROU');
const quit=Uint8Array.of(0x45);
export async function identifyGM30(reader) {
 if(!reader.connected)throw Error('Connect Bluetooth first.');
 if(reader.busy)throw Error('Radio is busy.');
 reader.busy=true;
 let entered=false;
 try {
  // A newly established link should have no buffered response data.
  if(reader.rx.length)throw Error('Unexpected pending radio data. Disconnect before identifying.');
  const ack=await reader.request(magic,1);
  if(ack[0]!==0x06)throw Error('GM-30 Pro programming handshake was not acknowledged.');
  entered=true;
  const config=await reader.request(Uint8Array.of(0x46),16);
  const id=await reader.request(Uint8Array.of(0x4d),7);
  const model=new TextDecoder('ascii',{fatal:true}).decode(id).trimEnd();
  if(model!=='GM-30P')throw Error(`The radio identified as ${JSON.stringify(model)}, not GM-30P. No memory read was attempted.`);
  return {model,rawModel:new TextDecoder('ascii').decode(id),identity:[...id],config:[...config]};
 } finally {
  // Exit programming mode if it was successfully entered. No write opcode.
  if(entered && reader.connected) {try{await reader.send(quit);}catch{/* transport may disconnect */}}
  reader.busy=false;
 }
}
