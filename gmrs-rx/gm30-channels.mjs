// GM-30 Pro 32-byte channel field adapter; preserves every unmapped byte.
import {GM30_IMAGE_SIZE,GM30_CHANNEL_COUNT,GM30_CHANNEL_BYTES} from './gm30-image.mjs';
import {encodeCpsName} from './gm30-text.mjs';
const decoder=new TextDecoder('gb18030',{fatal:true});
const check=b=>{if(!(b instanceof Uint8Array)||b.length!==GM30_IMAGE_SIZE)throw Error('GM-30 Pro image required');};
function freq(bytes){
 if(bytes[0]===255||bytes.every(x=>x===255))return '';
 const digits=[];for(let i=3;i>=0;i--){const hi=bytes[i]>>4,lo=bytes[i]&15;if(hi>9||lo>9)return null;digits.push(hi,lo);}
 return (Number(digits.join(''))/100000).toFixed(5);
}
function packed(value){
 if(typeof value!=='string'||!/^\d{3}\.\d{5}$/.test(value))throw Error('Frequency must be nnn.nnnnn MHz');
 const whole=Number(value.replace('.',''));
 if(!Number.isSafeInteger(whole)||whole<=0||whole>99999999)throw Error('Frequency outside encoder range');
 const bytes=new Uint8Array(4);let n=whole;
 for(let i=0;i<4;i++){const lo=n%10;n=Math.floor(n/10);const hi=n%10;n=Math.floor(n/10);bytes[i]=(hi<<4)|lo;}
 return bytes;
}
function channelName(bytes){const end=bytes.findIndex(v=>v===0xff||v===0);return decoder.decode(end<0?bytes:bytes.subarray(0,end)).trim();}
export function getChannel(raw,number){
 check(raw);if(!Number.isInteger(number)||number<1||number>GM30_CHANNEL_COUNT)throw Error('Invalid channel');
 const start=(number-1)*GM30_CHANNEL_BYTES,b=raw.subarray(start,start+GM30_CHANNEL_BYTES);
 const rx=freq(b.subarray(0,4));
 return {number,empty:rx==='',rxMHz:rx,txMHz:freq(b.subarray(4,8)),name:channelName(b.subarray(20,32)),power:b[14]&3,
  bandwidth:(b[15]&0x40)?'NFM':'FM',scanIncluded:!!(b[15]&4),txToneRaw:b[10]|(b[11]<<8),rxToneRaw:b[8]|(b[9]<<8)};
}
export function setChannel(raw,number,patch){
 check(raw);const existing=getChannel(raw,number);
 if(!patch||typeof patch!=='object')throw Error('Channel edits missing');
 const offset=(number-1)*GM30_CHANNEL_BYTES,copy=raw.slice();
 if(patch.empty===true){copy.fill(255,offset,offset+GM30_CHANNEL_BYTES);return copy;}
 if(existing.empty){
  if(!patch.rxMHz)throw Error('An RX frequency is required for a new channel.');
  // CHIRP set_memory initializes the first 16 bytes to 0x00 and last 16 to 0xFF.
  copy.fill(0,offset,offset+16);copy.fill(255,offset+16,offset+32);
  copy.set(packed(patch.rxMHz),offset);
  copy.set(packed(patch.txMHz??patch.rxMHz),offset+4);
  copy[offset+15]=0x04; // included in scan, FM modulation, default other flags clear
 }
 const keys=['empty','name','rxMHz','txMHz','scanIncluded','power','bandwidth'];
 for(const key of Object.keys(patch))if(!keys.includes(key))throw Error('Unmapped channel field: '+key);
 if('name' in patch){
  const nameBytes=encodeCpsName(patch.name,12);
  copy.fill(255,offset+20,offset+32);copy.set(nameBytes,offset+20);
 }
 if('rxMHz' in patch)copy.set(packed(patch.rxMHz),offset);
 if('txMHz' in patch){
  if(patch.txMHz==='')copy.fill(255,offset+4,offset+8);
  else copy.set(packed(patch.txMHz),offset+4);
 }
 if('power' in patch){const v=Number(patch.power);if(!Number.isInteger(v)||v<0||v>1)throw Error('Power is High or Low');copy[offset+14]=(copy[offset+14]&~3)|v;}
 if('bandwidth' in patch){if(!['FM','NFM'].includes(patch.bandwidth))throw Error('Bandwidth is FM or NFM');copy[offset+15]=(copy[offset+15]&~0x40)|(patch.bandwidth==='NFM'?0x40:0);}
 if('scanIncluded' in patch)copy[offset+15]=(copy[offset+15]&~4)|(patch.scanIncluded?4:0);
 return copy;
}
export function getBankChannels(raw,bank){
 check(raw);if(!Number.isInteger(bank)||bank<1||bank>10)throw Error('Invalid bank');
 return Array.from({length:100},(_,i)=>getChannel(raw,(bank-1)*100+i+1));
}
