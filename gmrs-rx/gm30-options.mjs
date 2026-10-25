// GMRS-Rx GM-30 Pro native bank, radio-option and VFO settings mapping.
// Memory layout reference: CHIRP baofeng_uv17Pro.py (RadioddityGM30Pro).
// Operations edit a copy of an imported GM-30 Pro image, never the original file.
import {GM30_IMAGE_SIZE,GM30_BANK_NAME_OFFSET,GM30_BANK_NAME_BYTES,GM30_BANKS} from './gm30-image.mjs';
import {encodeCpsName} from './gm30-text.mjs';
export const GM30_SETTINGS_OFFSET=0x8040;
export const GM30_VFO_OFFSET=0x8000;
export const GM30_DTMF_OFFSET=0x80a0;
export const GM30_DTMF_GROUPS=20;
const text=new TextDecoder('gb18030',{fatal:true});

const setting=(key,label,offset,choices,section='Basic')=>({key,label,offset,choices,section});
const yn=['Off','On'];
// Direct one-byte settings. Fields with undocumented/overlapping bit meanings
// are deliberately left unchanged; preservation takes priority.
export const GM30_OPTIONS=Object.freeze([
 setting('squelch','Squelch',0,['Off','1','2','3','4','5','6','7','8','9']),
 setting('saveMode','Battery saving',1,yn),
 setting('vox','VOX sensitivity',2,['Off','1','2','3','4','5','6','7','8','9']),
 setting('backlight','Backlight',3,['Always on','5 sec','10 sec','15 sec','20 sec']),
 setting('dualStandby','Dual standby',4,yn),
 setting('tot','Transmit time-out',5,['Off',...Array.from({length:12},(_,i)=>String((i+1)*15)+' sec')]),
 setting('beep','Keypad prompt',6,['Off','Beep','Voice','Both']),
 setting('voice','Language',8,['English','Chinese']),
 setting('sideTone','Side tone',9,['Off','Keypad','ANI','Keypad + ANI']),
 setting('scanMode','Scan resume',10,['Time','Carrier','Search']),
 setting('pttId','PTT ID',11,['Off','Beginning','End','Both']),
 setting('displayA','Display A',13,['Name','Frequency','Channel number']),
 setting('displayB','Display B',14,['Name','Frequency','Channel number']),
 setting('autoLock','Auto keypad lock',16,yn),
 setting('alarmMode','Alarm mode',17,['Local','Send tone','Send code']),
 setting('alarmTone','Alarm sound',18,yn),
 setting('tailClear','Squelch tail elimination',20,yn),
 setting('roger','Roger beep',23,yn),
 setting('disableFM','Disable FM broadcast',25,yn),
 setting('keyLock','Key lock',27,yn),
 setting('powerOnDisplay','Power-on display',28,['Logo','Battery voltage']),
 setting('voxDelay','VOX delay',32,Array.from({length:16},(_,i)=>String(500+i*100)+' ms')),
 setting('menuTimeout','Menu timeout',33,[...Array.from({length:11},(_,i)=>String(5+i*5)+' sec'),'60 sec']),
 setting('bluetooth','Bluetooth',34,yn),
 setting('totAlarm','Transmit timeout warning',40,['Off',...Array.from({length:10},(_,i)=>String(i+1)+' sec')]),
 setting('resetMenu','Reset menu',55,yn),
 setting('singleWatch','Single watch',56,yn),
 setting('voxEnabled','VOX enabled',58,yn)
]);
function rawCheck(raw){if(!(raw instanceof Uint8Array)||raw.length!==GM30_IMAGE_SIZE)throw Error('Expected complete GM-30 Pro memory image');}
function decodeName(raw){const end=raw.findIndex(b=>b===0xff||b===0);return text.decode(end<0?raw:raw.subarray(0,end)).trim();}
export function getBanks(raw){
 rawCheck(raw);
 return Array.from({length:GM30_BANKS},(_,i)=>({
  number:i+1,
  name:decodeName(raw.subarray(GM30_BANK_NAME_OFFSET+i*GM30_BANK_NAME_BYTES,GM30_BANK_NAME_OFFSET+(i+1)*GM30_BANK_NAME_BYTES))
 }));
}
export function setBankName(raw,bankIndex,name){
 rawCheck(raw);
 if(!Number.isInteger(bankIndex)||bankIndex<0||bankIndex>=GM30_BANKS)throw Error('Invalid bank number');
 if(typeof name!=='string')throw Error('Bank name must be text');
 const buf=encodeCpsName(name,GM30_BANK_NAME_BYTES);
 const copy=raw.slice(),start=GM30_BANK_NAME_OFFSET+bankIndex*GM30_BANK_NAME_BYTES;
 copy.fill(0xff,start,start+GM30_BANK_NAME_BYTES);copy.set(buf,start);
 return copy;
}
export function getOptions(raw){
 rawCheck(raw);
 return GM30_OPTIONS.map(def=>({
  ...def,value:raw[GM30_SETTINGS_OFFSET+def.offset],
  stored:raw[GM30_SETTINGS_OFFSET+def.offset],
  recognized:raw[GM30_SETTINGS_OFFSET+def.offset]<def.choices.length
 }));
}
export function setOption(raw,key,value){
 rawCheck(raw);
 const def=GM30_OPTIONS.find(x=>x.key===key);
 if(!def)throw Error('Unknown GM-30 Pro setting');
 const index=Number(value);
 if(!Number.isInteger(index)||index<0||index>=def.choices.length)throw Error('Invalid option value for '+def.label);
 const copy=raw.slice();copy[GM30_SETTINGS_OFFSET+def.offset]=index;
 return copy;
}
function readDigits(bytes) {
 if(bytes.some(b=>b>9))return null;
 return (Number(Array.from(bytes).join(''))/100000).toFixed(5);
}
export function getVFO(raw,which){
 rawCheck(raw);if(!['A','B'].includes(which))throw Error('Invalid VFO');
 const offset=GM30_VFO_OFFSET+(which==='B'?32:0);
 return {which,freqMHz:readDigits(raw.subarray(offset,offset+8)),power:raw[offset+16],step:raw[offset+20]};
}
export function setVFOScalar(raw,which,field,value){
 rawCheck(raw);if(!['A','B'].includes(which))throw Error('Invalid VFO');
 const offset=GM30_VFO_OFFSET+(which==='B'?32:0);
 const def=field==='power'?{at:16,count:2}:field==='step'?{at:20,count:8}:null;
 if(!def)throw Error('Unsupported VFO scalar');
 const index=Number(value);
 if(!Number.isInteger(index)||index<0||index>=def.count)throw Error('Invalid '+field);
 const copy=raw.slice();copy[offset+def.at]=index;return copy;
}
export function getDTMF(raw){
 rawCheck(raw);
 const alpha='0123456789ABCD*#';
 return Array.from({length:GM30_DTMF_GROUPS},(_,i)=>{
  const pos=GM30_DTMF_OFFSET+i*16;
  const bytes=raw.subarray(pos,pos+5);
  const digits=bytes.every(v=>v===255||v<alpha.length)?Array.from(bytes).filter(v=>v!==255).map(v=>alpha[v]).join(''):null;
  return {number:i+1,digits,name:decodeName(raw.subarray(pos+5,pos+15))};
 });
}
export function setDTMF(raw,index,{digits,name}){
 rawCheck(raw);if(!Number.isInteger(index)||index<0||index>=GM30_DTMF_GROUPS)throw Error('Invalid DTMF group');
 const alpha='0123456789ABCD*#';
 if(typeof digits!=='string'||digits.length>5||[...digits].some(c=>!alpha.includes(c)))throw Error('DTMF code must be up to 5 keypad characters');
 const encodedName=encodeCpsName(name,10);
 const copy=raw.slice(),pos=GM30_DTMF_OFFSET+index*16;
 copy.fill(255,pos,pos+5);for(let i=0;i<digits.length;i++)copy[pos+i]=alpha.indexOf(digits[i]);
 copy.fill(255,pos+5,pos+15);copy.set(encodedName,pos+5);
 return copy;
}
export function exportEditedChirpImage(originalFile,editedMemory) {
 rawCheck(editedMemory);
 if(!(originalFile instanceof Uint8Array)||originalFile.length<=GM30_IMAGE_SIZE)throw Error('Original tagged CHIRP image required');
 const result=originalFile.slice();result.set(editedMemory,0);
 return result;
}
