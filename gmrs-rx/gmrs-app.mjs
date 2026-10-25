// GMRS-Rx application: inherit Ham-Rx Bluetooth connection; import native
// GM-30 Pro bank and options structure from CHIRP's published driver.
import {GM30Radio} from './gm30-radio.mjs';
import {identifyGM30} from './gm30-identity.mjs';
import {inspectGM30Image,createGM30ChirpImage} from './gm30-image.mjs';
import {getBanks,setBankName,getOptions,setOption,getVFO,setVFOScalar,getDTMF,setDTMF,exportEditedChirpImage} from './gm30-options.mjs';
import {getBankChannels,setChannel} from './gm30-channels.mjs';
const $=id=>document.getElementById(id);
const radio=new GM30Radio();
let originalImage=null,working=null,imageName='',activeTab='channels';
const status=(msg,error=false)=>{$('status').textContent=msg;$('status').dataset.error=error?'true':'false';};
function refreshConnection(){
 $('connect').textContent=radio.connected?'Disconnect':'Connect Bluetooth';
 $('bleState').textContent=radio.connected?'BLE connected':'Not connected';
 $('identify').disabled=!radio.connected;
}
radio.log=s=>status(s);
radio.onDisconnect=()=>{status('Bluetooth connection ended.');refreshConnection();};
$('connect').onclick=async()=>{
 $('connect').disabled=true;
 try {
  if(radio.connected){radio.disconnect();status('Disconnected.');}
  else{await radio.connect();status('Bluetooth connected using the existing Ham-Rx BLE transport.');}
 }catch(e){status(e.message,true);}
 finally{$('connect').disabled=false;refreshConnection();}
};
$('identify').onclick=async()=>{
 $('identify').disabled=true;$('connect').disabled=true;
 try{
  const result=await identifyGM30(radio);
  status('GM-30 Pro identity confirmed: '+result.rawModel);
  $('bleState').textContent='GM-30P verified';
 }catch(e){status(e.message,true);}
 finally{$('identify').disabled=!radio.connected;$('connect').disabled=false;}
};
function field(label,control){
 const wrap=document.createElement('label');wrap.className='option-field';
 const title=document.createElement('span');title.textContent=label;
 wrap.append(title,control);return wrap;
}
function optionSelect(choices,value,onChange){
 const select=document.createElement('select');
 const known=value>=0&&value<choices.length;
 if(!known){const opt=document.createElement('option');opt.value='';opt.textContent='Preserve unknown code '+value;select.append(opt);}
 choices.forEach((label,index)=>{
  const opt=document.createElement('option');opt.value=String(index);opt.textContent=label;select.append(opt);
 });
 select.value=known?String(value):'';
 select.onchange=()=>{if(select.value!=='')onChange(Number(select.value));};
 return select;
}
function edited(message){
 $('saveImage').disabled=false;status(message+' — save .img or write to the radio.');refreshSummary();refreshConnection();
}
function refreshSummary(){
 if(!working)return;
 const parsed=inspectGM30Image(exportEditedChirpImage(originalImage,working));
 $('summary').textContent=parsed.channelCount+' programmed channels; '+parsed.banks.length+' native banks (100 slots each).';
}
function renderChannels(){
 const picker=$('channelBank');
 if(!picker.options.length)for(let i=1;i<=10;i++){const item=document.createElement('option');item.value=String(i);item.textContent='Bank '+i+' (CH '+((i-1)*100+1)+'–'+(i*100)+')';picker.append(item);}
 const bank=Number(picker.value)||1;
 const target=$('channelRows');target.replaceChildren();
 const rows=getBankChannels(working,bank).filter(c=>!c.empty);
 for(const channel of rows){
  const tr=document.createElement('tr'),number=document.createElement('td');number.textContent=String(channel.number);tr.append(number);
  const fields=[
   {name:'name',value:channel.name,kind:'text',max:12},
   {name:'rxMHz',value:channel.rxMHz,kind:'text',max:9},
   {name:'txMHz',value:channel.txMHz||'',kind:'text',max:9}
  ];
  for(const def of fields){
   const td=document.createElement('td'),input=document.createElement('input');input.type=def.kind;input.value=def.value;input.maxLength=def.max;
   input.setAttribute('aria-label',def.name+' for channel '+channel.number);
   input.onchange=()=>{
    try{working=setChannel(working,channel.number,{[def.name]:input.value});edited('Channel '+channel.number+' updated');}
    catch(e){status(e.message,true);input.value=def.value;}
   };
   td.append(input);tr.append(td);
  }
  for(const fieldDef of [
   {key:'power',choices:['High','Low'],value:channel.power},
   {key:'bandwidth',choices:['FM','NFM'],value:channel.bandwidth==='NFM'?1:0},
   {key:'scanIncluded',choices:['Skip','Include'],value:channel.scanIncluded?1:0}
  ]){
   const td=document.createElement('td');
   const select=optionSelect(fieldDef.choices,fieldDef.value,v=>{
    const value=fieldDef.key==='bandwidth'?(v?'NFM':'FM'):fieldDef.key==='scanIncluded'?!!v:v;
    try{working=setChannel(working,channel.number,{[fieldDef.key]:value});edited('Channel '+channel.number+' updated');}
    catch(e){status(e.message,true);}
   });
   td.append(select);tr.append(td);
  }
  const action=document.createElement('td'),remove=document.createElement('button');
  remove.type='button';remove.textContent='Delete';remove.setAttribute('aria-label','Delete channel '+channel.number);
  remove.onclick=()=>{
   if(!confirm('Delete channel '+channel.number+' from this bank?'))return;
   try{working=setChannel(working,channel.number,{empty:true});edited('Deleted channel '+channel.number);renderChannels();renderBanks();}
   catch(e){status(e.message,true);}
  };
  action.append(remove);tr.append(action);
  target.append(tr);
 }
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='No programmed channels in this bank';tr.append(td);target.append(tr);}
}
function renderBanks(){
 const banks=getBanks(working);
 const view=inspectGM30Image(exportEditedChirpImage(originalImage,working));
 const target=$('bankRows');target.replaceChildren();
 for(const bank of banks){
  const tr=document.createElement('tr');
  const number=document.createElement('td');number.textContent=bank.number;
  const name=document.createElement('td');
  const input=document.createElement('input');input.type='text';input.maxLength=16;input.value=bank.name;input.placeholder='Bank '+bank.number;
  input.setAttribute('aria-label','Name for Bank '+bank.number);
  input.onchange=()=>{
   try{working=setBankName(working,bank.number-1,input.value);edited('Bank '+bank.number+' renamed');}
   catch(e){status(e.message,true);input.value=bank.name;}
  };
  name.append(input);
  const count=document.createElement('td');count.textContent=String(view.banks[bank.number-1].count);
  const sample=document.createElement('td');sample.textContent=view.banks[bank.number-1].channels.slice(0,3).map(c=>c.number+': '+(c.name||c.rxMHz)).join(' · ')||'—';
  tr.append(number,name,count,sample);target.append(tr);
 }
}
function renderOptions(){
 const target=$('optionsFields');target.replaceChildren();
 for(const item of getOptions(working)){
  const control=optionSelect(item.choices,item.value,value=>{
   try{working=setOption(working,item.key,value);edited(item.label+' updated');}
   catch(e){status(e.message,true);}
  });
  target.append(field(item.label,control));
 }
}
function renderVFO(){
 const target=$('vfoFields');target.replaceChildren();
 for(const side of ['A','B']){
  const v=getVFO(working,side);
  const info=document.createElement('p');info.textContent='VFO '+side+' frequency: '+(v.freqMHz||'Unknown');target.append(info);
  target.append(field('VFO '+side+' power',
   optionSelect(['High','Low'],v.power,value=>{
    try{working=setVFOScalar(working,side,'power',value);edited('VFO '+side+' power updated');}
    catch(e){status(e.message,true);}
   })));
  target.append(field('VFO '+side+' tuning step',
   optionSelect(['2.5','5','6.25','10','12.5','20','25','50'],v.step,value=>{
    try{working=setVFOScalar(working,side,'step',value);edited('VFO '+side+' step updated');}
    catch(e){status(e.message,true);}
   })));
 }
}
function renderDTMF(){
 const target=$('dtmfRows');target.replaceChildren();
 for(const row of getDTMF(working)){
  const tr=document.createElement('tr');const num=document.createElement('td');num.textContent=String(row.number);
  const codeCell=document.createElement('td'),nameCell=document.createElement('td');
  const code=document.createElement('input');code.value=row.digits??'';code.maxLength=5;code.setAttribute('aria-label','DTMF code '+row.number);
  const name=document.createElement('input');name.value=row.name;name.maxLength=10;name.setAttribute('aria-label','DTMF name '+row.number);
  const commit=()=>{
   try{working=setDTMF(working,row.number-1,{digits:code.value,name:name.value});edited('DTMF '+row.number+' updated');}
   catch(e){status(e.message,true);code.value=row.digits??'';name.value=row.name;}
  };
  code.onchange=commit;name.onchange=commit;
  codeCell.append(code);nameCell.append(name);tr.append(num,codeCell,nameCell);target.append(tr);
 }
}
function render(){
 if(!working)return;
 refreshSummary();renderChannels();renderBanks();renderOptions();renderVFO();renderDTMF();
}
function openTab(tab){
 activeTab=tab;
 for(const [name,button,area] of [['channels','showChannels','channelsTab'],['banks','showBanks','banksTab'],['options','showOptions','optionsTab'],['vfo','showVFO','vfoTab'],['dtmf','showDTMF','dtmfTab']]){
  $(area).hidden=name!==tab;$(button).setAttribute('aria-selected',name===tab?'true':'false');
 }
}
$('showChannels').onclick=()=>openTab('channels');
$('channelBank').onchange=()=>{if(working)renderChannels();};
$('addChannel').onclick=()=>{
 if(!working)return;
 const bank=Number($('channelBank').value)||1;
 const slot=getBankChannels(working,bank).find(c=>c.empty);
 if(!slot){status('No empty slots in Bank '+bank,true);return;}
 const input=prompt('RX frequency in MHz for new channel '+slot.number+' (e.g. 462.56250):');
 if(input===null)return;
 try{
  working=setChannel(working,slot.number,{rxMHz:input.trim()});
  edited('Added channel '+slot.number);renderChannels();renderBanks();
 }catch(e){status(e.message,true);}
};
$('showBanks').onclick=()=>openTab('banks');
$('showOptions').onclick=()=>openTab('options');
$('showVFO').onclick=()=>openTab('vfo');
$('showDTMF').onclick=()=>openTab('dtmf');
$('image').onchange=async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  const parsed=inspectGM30Image(bytes);
  originalImage=bytes.slice();working=parsed.bytes;imageName=file.name;
  $('filename').textContent=file.name;
  $('bankResults').hidden=false;
  $('saveImage').disabled=false;
  render();openTab(activeTab);
  status('GM-30 Pro image opened; native banks and CHIRP radio options available for editing.');
 }catch(e){status(e.message,true);}
 finally{event.target.value='';}
};
$('saveImage').onclick=()=>{
 if(!working||!originalImage)return;
 try {
  const out=exportEditedChirpImage(originalImage,working);
  // Export retains the source's original CHIRP metadata trailer verbatim.
  const blob=new Blob([out],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=imageName.replace(/\.img$/i,'')+'-GMRS-Rx.img';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Edited GM-30 Pro image download requested.');
 }catch(e){status(e.message,true);}
};
function saveFile(bytes,name){
 const blob=new Blob([bytes],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('readRadio').onclick=async()=>{
 if(!radio.connected)return;
 $('readRadio').disabled=true;$('connect').disabled=true;
 try{
  const read=await radio.readRadio((n,total)=>status('Reading GM-30 Pro: '+n+' / '+total+' blocks'));
  const image=createGM30ChirpImage(read.memory);
  const parsed=inspectGM30Image(image);
  originalImage=image;working=parsed.bytes;imageName='GM-30-Pro-radio-read.img';
  $('filename').textContent=imageName;$('bankResults').hidden=false;
  $('saveImage').disabled=false;
  render();openTab(activeTab);
  status('GM-30 Pro read complete: '+read.memory.length+' bytes. Save the original radio backup before writing.');
 }catch(e){status(e.message,true);}
 finally{$('connect').disabled=false;refreshConnection();}
};
$('saveBackup').onclick=()=>{
 if(!radio.lastRead)return;
 try{
  saveFile(createGM30ChirpImage(radio.lastRead.memory),'GM-30-Pro-original-backup.img');
  status('Original radio backup download requested.');
 }catch(e){status(e.message,true);}
};
$('writeRadio').onclick=async()=>{
 if(!working||!radio.lastRead)return;
 if(!confirm('Write the full GM-30 Pro CPS image to this radio? Make sure you downloaded the original radio backup. This GM-30 Pro write adaptation has not yet been verified on hardware.'))return;
 $('writeRadio').disabled=true;$('connect').disabled=true;
 try{
  const report=await radio.writeRadio(working,{confirmed:true,progress:(n,total)=>status('Writing GM-30 Pro: '+n+' / '+total+' blocks acknowledged')});
  status('Write acknowledged: '+report.acknowledged+' / '+report.total+' blocks. Read back and verify before relying on the configuration.');
  radio.disconnect(); // Follow Ham-Rx behavior after all programming acknowledgements.
 }catch(e){status('Write stopped: '+e.message+'. Do not retry automatically.',true);}
 finally{$('connect').disabled=false;refreshConnection();}
};
$('verifyRadio').onclick=async()=>{
 $('verifyRadio').disabled=true;$('connect').disabled=true;
 try{
  const result=await radio.verifyReadback((n,total)=>status('Verifying: '+n+' / '+total+' read blocks'));
  const mismatches=result.comparison.differences;
  status(mismatches?'Readback differs at '+mismatches+' byte(s). Programming NOT verified.':'Verified: GM-30 Pro readback matches all 33,664 planned CPS bytes.',!!mismatches);
 }catch(e){status(e.message,true);}
 finally{$('connect').disabled=false;refreshConnection();}
};
refreshConnection();openTab('channels');
