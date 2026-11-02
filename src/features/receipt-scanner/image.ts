// Decode once, preserve orientation, and extract from a larger image before archiving.
export async function prepareReceipt(file: File) {
 const url=URL.createObjectURL(file);
 try {
  const image=new Image(); image.src=url; await image.decode();
  if(!image.naturalWidth || !image.naturalHeight) throw new Error('The photo could not be read. Try a JPEG or PNG image.');
  const encode=async(maxEdge:number,quality:number)=>{
   const scale=Math.min(1,maxEdge/Math.max(image.naturalWidth,image.naturalHeight));
   const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo processing is unavailable in this browser.');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not compress photo.')),'image/jpeg',quality));
  };
  let extraction=await encode(3000,.88);
  if(extraction.size>5*1024*1024) extraction=await encode(2400,.8);
  // Keep text readable: reduce JPEG quality before reducing the dimensions.
  let archive=await encode(2000,.76);
  for(const quality of [.65,.55]) { if(archive.size<=300*1024)break;archive=await encode(2000,quality); }
  return {extraction,archive};
 } finally {URL.revokeObjectURL(url);}
}
