// Reuse Ham-Rx's GBK/GB2312-compatible CPS name encoding approach.
// The radio stores byte-limited names, not UTF-8 strings.
const decoder=new TextDecoder('gbk',{fatal:true});
let reverse=null;
function table(){
 if(reverse)return reverse;
 reverse=new Map();
 for(let i=0;i<128;i++)reverse.set(String.fromCharCode(i),[i]);
 for(let a=0x81;a<=0xfe;a++)for(let b=0x40;b<=0xfe;b++){
  if(b===0x7f)continue;
  try{
   const s=decoder.decode(Uint8Array.of(a,b));
   if([...s].length===1&&!reverse.has(s))reverse.set(s,[a,b]);
  }catch{/* invalid encoding pair */}
 }
 return reverse;
}
export function encodeCpsName(name,maxBytes){
 if(typeof name!=='string')throw Error('Name must be text');
 const result=[];
 for(const ch of name){
  const pair=table().get(ch);
  if(!pair)throw Error('Unsupported CPS name character: '+ch);
  result.push(...pair);
  if(result.length>maxBytes)throw Error('Name exceeds '+maxBytes+' CPS bytes');
 }
 return Uint8Array.from(result);
}
