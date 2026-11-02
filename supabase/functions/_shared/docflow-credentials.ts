/** AES-GCM with a server-only key and company-specific authenticated context. */
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function sealToken(token:string,secret:string,scope:string){
 const key=await crypto.subtle.importKey('raw',decode(secret),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},key,new TextEncoder().encode(token));
 return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function openToken(ciphertext:string,secret:string,scope:string){
 const [iv,data]=ciphertext.split('.');
 const key=await crypto.subtle.importKey('raw',decode(secret),'AES-GCM',false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:new TextEncoder().encode(scope)},key,decode(data));
 return new TextDecoder().decode(plain);
}
