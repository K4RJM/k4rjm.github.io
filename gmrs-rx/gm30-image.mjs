// GMRS-Rx: read-only GM-30 Pro CHIRP image inspection.
// Layout reference: CHIRP drivers/baofeng_uv17Pro.py, RadioddityGM30Pro.
// This module does not construct radio write frames.
export const GM30_IMAGE_SIZE = 0x8380; // 33,664 CPS bytes
export const GM30_CHANNEL_COUNT = 1000;
export const GM30_CHANNEL_BYTES = 32;
export const GM30_BANKS = 10;
export const GM30_SLOTS_PER_BANK = 100;
export const GM30_BANK_NAME_OFFSET = 0x8280;
export const GM30_BANK_NAME_BYTES = 16;
export const CHIRP_MAGIC = Uint8Array.of(0, 255, 99, 104, 105, 114, 112, 238, 105, 109, 103, 0, 1);
const decoder = new TextDecoder('gb18030', {fatal: true});
const ascii = new TextDecoder('utf-8', {fatal: true});
function equal(a,b) { return a.length===b.length && a.every((v,i)=>v===b[i]); }
function name(bytes) {
  const end = bytes.findIndex(v => v === 0xff || v === 0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0,end)).trim();
}
function frequency(bytes) {
  if (bytes.every(v => v === 255) || bytes.every(v => v === 0)) return null;
  const parts = [];
  for (let i=3; i>=0; i--) {
    const hi=bytes[i]>>4, lo=bytes[i]&15;
    if (hi>9 || lo>9) return null;
    parts.push(String(hi), String(lo));
  }
  const hz = Number(parts.join(''));
  if (!hz) return null;
  return (hz/100000).toFixed(5);
}
function metadataFor(bytes) {
  if (bytes.length <= GM30_IMAGE_SIZE + CHIRP_MAGIC.length ||
      !equal(bytes.subarray(GM30_IMAGE_SIZE, GM30_IMAGE_SIZE+CHIRP_MAGIC.length),CHIRP_MAGIC)) {
    throw Error('Open a CHIRP GM-30 Pro .img with its identifying metadata; unlabelled/raw images are not accepted.');
  }
  let meta;
  try {
    const encoded = ascii.decode(bytes.subarray(GM30_IMAGE_SIZE+CHIRP_MAGIC.length)).trim();
    if (!encoded || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) throw Error('Invalid base64');
    const decoded = Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
    meta=JSON.parse(ascii.decode(decoded));
  } catch { throw Error('Invalid CHIRP metadata in the image.'); }
  if (!meta || typeof meta!=='object' || Array.isArray(meta) ||
      (meta.vendor!=='Radioddity' || meta.model!=='GM-30 Pro') &&
      meta.rclass!=='RadioddityGM30Pro') {
    throw Error('This image does not identify as Radioddity GM-30 Pro.');
  }
  return meta;
}
export function inspectGM30Image(bytes) {
  if (!(bytes instanceof Uint8Array)) throw TypeError('Expected Uint8Array');
  if (bytes.length > GM30_IMAGE_SIZE+CHIRP_MAGIC.length+65536) throw Error('Image is unexpectedly large.');
  const metadata=metadataFor(bytes);
  const body=bytes.slice(0,GM30_IMAGE_SIZE); // independent copy, never modified
  const banks=[];
  for(let index=0;index<GM30_BANKS;index++) {
    const bankOffset=GM30_BANK_NAME_OFFSET+index*GM30_BANK_NAME_BYTES;
    const storedName=name(body.subarray(bankOffset,bankOffset+GM30_BANK_NAME_BYTES));
    const channels=[];
    for(let slot=0;slot<GM30_SLOTS_PER_BANK;slot++) {
      const channelNumber=index*GM30_SLOTS_PER_BANK+slot+1;
      const offset=(channelNumber-1)*GM30_CHANNEL_BYTES;
      const rx=frequency(body.subarray(offset,offset+4));
      if(rx===null) continue;
      channels.push({
        number:channelNumber,
        rxMHz:rx,
        name:name(body.subarray(offset+20,offset+32))
      });
    }
    banks.push({number:index+1,storedName,name:storedName||`Bank ${index+1}`,channels,count:channels.length});
  }
  return {metadata,banks,channelCount:banks.reduce((total,b)=>total+b.count,0),bytes:body};
}

/** Wrap a decoded GM-30 Pro radio read in a CHIRP model-tagged image. */
export function createGM30ChirpImage(memory){
 if(!(memory instanceof Uint8Array)||memory.length!==GM30_IMAGE_SIZE)throw Error('Complete GM-30 Pro capture required');
 const metadata={vendor:'Radioddity',model:'GM-30 Pro',variant:'',rclass:'RadioddityGM30Pro'};
 const encoded=new TextEncoder().encode(btoa(JSON.stringify(metadata)));
 const output=new Uint8Array(GM30_IMAGE_SIZE+CHIRP_MAGIC.length+encoded.length);
 output.set(memory);
 output.set(CHIRP_MAGIC,GM30_IMAGE_SIZE);
 output.set(encoded,GM30_IMAGE_SIZE+CHIRP_MAGIC.length);
 return output;
}
