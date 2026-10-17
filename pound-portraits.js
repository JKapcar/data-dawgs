/* Private portraits: only memory/blob URLs; signed-session fetch, never public image URLs. */
(()=>{'use strict';
 const base='https://toto.jkapcar4.workers.dev/pound-portraits/v1/',objects=new Set(),controllers=new Set();let generation=0;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const blobURL=blob=>{const url=URL.createObjectURL(blob);objects.add(url);return url;};
 const revoke=url=>{if(url){URL.revokeObjectURL(url);objects.delete(url);}};
 const clear=()=>{generation++;for(const c of controllers)c.abort();controllers.clear();for(const url of objects)URL.revokeObjectURL(url);objects.clear();};
 function mount(kind,id,name,{session,changed}){
  const root=el('section');root.className='portrait-panel';root.setAttribute('aria-label','Private portrait for '+name);
  const status=el('p','Checking private portrait availability.');status.setAttribute('role','status');root.append(status);
  const epoch=generation,token=session(),controller=new AbortController();controllers.add(controller);let manifest,pending,previewURL,imageURL,attempted=false;
  const valid=()=>{if(epoch!==generation||session()!==token||document.hidden)throw new DOMException('Account changed','AbortError');};
  const request=async(suffix='',body)=>{valid();const r=await fetch(base+kind+'/'+id+suffix,{method:body?'POST':'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});valid();if(!r.ok){const data=await r.json();throw Object.assign(Error(data.error||'Portrait unavailable'),{status:r.status});}return r;};
  const load=async()=>{manifest=await(await request()).json();valid();status.textContent='Private portrait · '+manifest.portraits.length+' / 8 attachment versions. Text versions stay unchanged.';
   const current=manifest.portraits.find(r=>r.request_id===manifest.active);if(current){const blob=await(await request('/image/'+current.request_id)).blob();valid();revoke(imageURL);imageURL=blobURL(blob);image.src=imageURL;image.alt=current.alt;caption.textContent=current.alt;image.hidden=false;}else image.hidden=true;
   const unfinished=manifest.portraits.find(r=>r.status==='pending');if(unfinished)status.textContent='An upload is pending. Select the same image and description to resume it.';
  };
  const image=el('img'),caption=el('p');image.className='portrait-thumbnail';image.hidden=true;root.prepend(image,caption);
  const details=el('details'),summary=el('summary','Attach or replace portrait');details.append(summary);root.append(details);details.hidden=true;
  const label=el('label','Choose PNG, JPEG or WebP (up to 8 MiB)'),file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';label.append(file);
  const altLabel=el('label','Image description'),alt=el('input');alt.type='text';alt.maxLength=200;alt.placeholder='Describe the portrait for someone who cannot see it';altLabel.append(alt);
  const preview=el('img');preview.hidden=true;preview.className='portrait-thumbnail';preview.alt='Unsaved portrait preview';
  const prepare=el('button','Preview portrait'),confirm=el('button','Confirm private upload'),cancel=el('button','Cancel');for(const b of [prepare,confirm,cancel])b.type='button';confirm.hidden=cancel.hidden=true;
  const hint=el('p','Uploads are resized to at most 1024 × 1024 and saved as PNG. No authored text is replaced. Attachment history is retained; deletion is not available in this version.');
  details.append(label,altLabel,hint,preview,prepare,confirm,cancel);
  const reset=()=>{pending=null;revoke(previewURL);previewURL=null;preview.hidden=true;confirm.hidden=cancel.hidden=true;prepare.hidden=false;file.disabled=alt.disabled=false;};
  cancel.onclick=()=>{reset();status.textContent=attempted?'Preview cleared. An attempted upload may still be pending or saved; refresh to check.':'Preview canceled. Nothing uploaded.';};
  prepare.onclick=async()=>{let bitmap;try{valid();const f=file.files[0];if(!f||!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>8388608)throw Error('Choose a PNG, JPEG or WebP no larger than 8 MiB.');if(!alt.value.trim())throw Error('Add an image description.');prepare.disabled=true;
    bitmap=await createImageBitmap(f);valid();if(bitmap.width*bitmap.height>16777216)throw Error('Choose an image with at most 16 million pixels.');const scale=Math.min(1,1024/bitmap.width,1024/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>524288)throw Error('The normalized image exceeds 512 KiB. Choose a smaller or simpler portrait.');const bytes=new Uint8Array(await blob.arrayBuffer());valid();let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');valid();
    const reserved=manifest.portraits.find(r=>r.status==='pending');if(reserved&&(reserved.sha256!==sha||reserved.alt!==alt.value.trim()))throw Error('Resume the pending upload with its original image and description.');
    pending={expected_revision:reserved?.expected_revision??manifest.revision,request_id:reserved?.request_id??crypto.randomUUID(),alt:alt.value.trim(),png_base64:btoa(binary)};
    revoke(previewURL);previewURL=blobURL(blob);preview.src=previewURL;preview.hidden=false;confirm.hidden=cancel.hidden=false;prepare.hidden=true;file.disabled=alt.disabled=true;status.textContent='Preview only. Confirm to save privately.';
   }catch(e){if(e.name!=='AbortError')status.textContent=e.message;}finally{bitmap?.close();prepare.disabled=false;}};
  confirm.onclick=async()=>{if(!pending)return;confirm.disabled=cancel.disabled=true;try{attempted=true;status.textContent='Uploading and verifying private portrait.';const result=await(await request('',pending)).json();await load();valid();if(!manifest.portraits.some(r=>r.status==='ready'&&r.request_id===pending.request_id&&r.sha256===result.portrait.sha256))throw Error('Readback did not confirm this upload. Retry the same request.');reset();status.textContent='Portrait saved and read back.';await changed();}
   catch(e){if(e.name!=='AbortError'){status.textContent=e.status===409?'Workspace changed. Refresh before preparing a new upload; a pending upload must use the original image.':e.message+' Retry Confirm to check the same upload.';}}
   finally{confirm.disabled=cancel.disabled=false;}};
  load().then(()=>{valid();details.hidden=false;}).catch(e=>{if(e.name!=='AbortError')status.textContent=e.status===503?'Private portraits are not enabled.':e.message;});return root;
 }
 globalThis.DDPortraits={mount,clear};
})();
