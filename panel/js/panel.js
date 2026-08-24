import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  orderBy,
  setDoc,
  writeBatch,
  enableNetwork
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "../../js/firebase-config.js";
import { contentApiConfig } from "../../js/content-api-config.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const authView=document.querySelector('#auth-view');
const appView=document.querySelector('#app');
const authForm=document.querySelector('#auth-form');
const authEmail=document.querySelector('#auth-email');
const authPassword=document.querySelector('#auth-password');
const authError=document.querySelector('#auth-error');
const worksList=document.querySelector('#works-list');
const tpl=document.querySelector('#work-template');
const connectionBanner=document.querySelector('#connection-banner');
let content={site:{artistName:'Eduardo Wolffel',email:'hello@drkprty.uk',availableLabel:'Available',soldLabel:'Sold'},works:[]};
let dragged=null;
let loadedForUid=null;
const deletedWorks=[];

function toast(msg){const el=document.querySelector('#toast');el.textContent=msg;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2200)}
function showConnectionBanner(message,type='warning'){connectionBanner.dataset.type=type;connectionBanner.innerHTML='';const text=document.createElement('span');text.textContent=message;connectionBanner.appendChild(text);if(type!=='ok'){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.addEventListener('click',async()=>{retry.disabled=true;try{await enableNetwork(db);await loadContent();hideConnectionBanner();}catch(error){showFirestoreError(error)}finally{retry.disabled=false}});connectionBanner.appendChild(retry)}connectionBanner.hidden=false}
function hideConnectionBanner(){connectionBanner.hidden=true;connectionBanner.innerHTML='';delete connectionBanner.dataset.type}
function showFirestoreError(error){loadedForUid=null;console.error('Firestore load failed:',error);const code=error?.code||'';if(code==='unavailable'||String(error?.message||'').toLowerCase().includes('offline')){showConnectionBanner('Firestore is not available yet. Check Firestore Database and its rules, then press Retry.');return}showConnectionBanner(friendlyError(error))}
function friendlyError(error){const code=error?.code||'';if(code.includes('invalid-credential')||code.includes('wrong-password')||code.includes('user-not-found'))return 'Incorrect email or password.';if(code.includes('too-many-requests'))return 'Too many attempts. Try again later.';return error?.message||'Something went wrong.'}
function localStarterWorks(){return[
{id:'work-01',title:'Untitled I',year:'2026',dimensions:'100 × 80 cm',medium:'Acrylic on canvas',status:'available',image:'assets/work-01.svg',contentPath:'',order:0},
{id:'work-02',title:'Untitled II',year:'2026',dimensions:'120 × 100 cm',medium:'Mixed media on canvas',status:'available',image:'assets/work-02.svg',contentPath:'',order:1},
{id:'work-03',title:'Untitled III',year:'2026',dimensions:'90 × 120 cm',medium:'Acrylic on canvas',status:'sold',image:'assets/work-03.svg',contentPath:'',order:2}
]}

function contentApiReady(){
  const url=(contentApiConfig.baseUrl||'').trim();
  return /^https:\/\//i.test(url) && !url.includes('REPLACE-WITH-YOUR-WORKER');
}

async function contentApiRequest(path,{method='GET',body=null,headers={}}={}){
  if(!contentApiReady()) throw new Error('GitHub upload Worker is not configured yet. Set its URL in js/content-api-config.js.');
  const user=auth.currentUser;
  if(!user) throw new Error('You must be signed in.');
  const idToken=await user.getIdToken();
  const base=contentApiConfig.baseUrl.replace(/\/+$/,'');
  const response=await fetch(base+path,{
    method,
    body,
    headers:{Authorization:`Bearer ${idToken}`,...headers}
  });
  const type=response.headers.get('content-type')||'';
  const payload=type.includes('application/json')?await response.json():{error:await response.text()};
  if(!response.ok) throw new Error(payload.error||payload.message||`Content API error (${response.status})`);
  return payload;
}

async function uploadArtworkImage(work,file){
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-').toLowerCase();
  const params=new URLSearchParams({workId:work.id,filename:safeName});
  return contentApiRequest(`/upload?${params}`,{
    method:'POST',
    body:file,
    headers:{'Content-Type':file.type||'application/octet-stream'}
  });
}

async function deleteArtworkImage(contentPath){
  if(!contentPath) return;
  const params=new URLSearchParams({path:contentPath});
  await contentApiRequest(`/file?${params}`,{method:'DELETE'});
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    loadedForUid=null;
    authView.hidden=false;
    appView.hidden=true;
    return;
  }
  authView.hidden=true;
  appView.hidden=false;
  if(!contentApiReady()) showConnectionBanner('GitHub image uploads are not configured yet. Deploy the included Cloudflare Worker and set its URL in js/content-api-config.js.');
  if (loadedForUid===user.uid) return;
  loadedForUid=user.uid;
  try { await enableNetwork(db); await loadContent(); if(contentApiReady())hideConnectionBanner(); } catch (error) { showFirestoreError(error); fillSite(); renderWorks(); }
});

authForm.addEventListener('submit',async e=>{
  e.preventDefault();
  authError.hidden=true;
  try{await signInWithEmailAndPassword(auth,authEmail.value.trim(),authPassword.value)}catch(error){authError.textContent=friendlyError(error);authError.hidden=false}
});

document.querySelector('#logout-btn').addEventListener('click',()=>signOut(auth));

async function loadContent(){
  const siteSnap=await getDocFromServer(doc(db,'siteContent','main'));
  if(siteSnap.exists()) content.site={...content.site,...siteSnap.data()};
  const worksSnap=await getDocsFromServer(query(collection(db,'works'),orderBy('order','asc')));
  content.works=worksSnap.empty?localStarterWorks():worksSnap.docs.map(d=>({id:d.id,...d.data(),contentPath:d.data().contentPath||''}));
  fillSite();
  renderWorks();
}

function fillSite(){
  document.querySelector('#artist-name').value=content.site.artistName||'';
  document.querySelector('#contact-email').value=content.site.email||'';
  document.querySelector('#available-label').value=content.site.availableLabel||'Available';
  document.querySelector('#sold-label').value=content.site.soldLabel||'Sold';
}

function siteFromForm(){return{
  artistName:document.querySelector('#artist-name').value.trim(),
  email:document.querySelector('#contact-email').value.trim(),
  availableLabel:document.querySelector('#available-label').value.trim(),
  soldLabel:document.querySelector('#sold-label').value.trim(),
  updatedAt:new Date().toISOString()
}}

function renderWorks(){worksList.innerHTML='';content.works.forEach(work=>worksList.appendChild(makeEditor(work)))}

function resolvePreview(image){if(!image)return '../assets/work-01.svg';if(/^https?:\/\//i.test(image))return image;return '../'+image}

function makeEditor(work){
  const node=tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id=work.id;
  const img=node.querySelector('.thumb');
  img.src=resolvePreview(work.image);img.alt=work.title||'Artwork';
  node.querySelector('.field-title').value=work.title||'';
  node.querySelector('.field-year').value=work.year||'';
  node.querySelector('.field-dimensions').value=work.dimensions||'';
  node.querySelector('.field-medium').value=work.medium||'';
  node.querySelector('.field-status').value=work.status==='sold'?'sold':'available';

  node.querySelector('.delete-work-btn').addEventListener('click',()=>{
    if(!confirm('Delete this artwork?'))return;
    deletedWorks.push({...work});
    content.works=content.works.filter(x=>x.id!==work.id);
    node.remove();
  });

  node.querySelector('.image-input').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){alert('Use JPG, PNG or WebP.');e.target.value='';return}
    if(file.size>20*1024*1024){alert('Maximum image size is 20 MB.');e.target.value='';return}
    const oldContentPath=work.contentPath||'';
    const uploadButton=node.querySelector('.upload-btn');
    try{
      uploadButton.classList.add('is-uploading');
      toast('Uploading image to GitHub…');
      const result=await uploadArtworkImage(work,file);
      work.image=result.url;
      work.contentPath=result.path;
      img.src=result.url+`?v=${Date.now()}`;
      if(oldContentPath && oldContentPath!==result.path){
        deleteArtworkImage(oldContentPath).catch(error=>console.warn('Could not delete previous GitHub image:',error));
      }
      toast('Image uploaded');
    }catch(error){alert(friendlyError(error))}finally{uploadButton.classList.remove('is-uploading');e.target.value=''}
  });

  node.addEventListener('dragstart',()=>{dragged=node;node.classList.add('dragging')});
  node.addEventListener('dragend',()=>{dragged=null;node.classList.remove('dragging');document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'));syncOrder()});
  node.addEventListener('dragover',e=>{e.preventDefault();if(dragged&&dragged!==node)node.classList.add('drag-over')});
  node.addEventListener('dragleave',()=>node.classList.remove('drag-over'));
  node.addEventListener('drop',e=>{e.preventDefault();node.classList.remove('drag-over');if(!dragged||dragged===node)return;const box=node.getBoundingClientRect();const after=e.clientY>box.top+box.height/2;node.parentNode.insertBefore(dragged,after?node.nextSibling:node);syncOrder()});
  return node;
}

function readEditors(){
  const byId=new Map(content.works.map(w=>[w.id,w]));
  return[...worksList.children].map((node,index)=>{
    const old=byId.get(node.dataset.id)||{id:node.dataset.id,image:'',contentPath:''};
    return{...old,
      title:node.querySelector('.field-title').value.trim(),
      year:node.querySelector('.field-year').value.trim(),
      dimensions:node.querySelector('.field-dimensions').value.trim(),
      medium:node.querySelector('.field-medium').value.trim(),
      status:node.querySelector('.field-status').value,
      order:index,
      updatedAt:new Date().toISOString()
    }
  })
}
function syncOrder(){content.works=readEditors()}

document.querySelector('#add-work-btn').addEventListener('click',()=>{
  syncOrder();
  const id='work-'+crypto.randomUUID();
  const work={id,title:'Untitled',year:new Date().getFullYear().toString(),dimensions:'',medium:'',status:'available',image:'assets/work-01.svg',contentPath:'',order:content.works.length};
  content.works.push(work);
  worksList.appendChild(makeEditor(work));
  worksList.lastElementChild.scrollIntoView({behavior:'smooth',block:'center'});
});

document.querySelector('#save-btn').addEventListener('click',async()=>{
  const btn=document.querySelector('#save-btn');btn.disabled=true;
  try{
    content.site=siteFromForm();
    content.works=readEditors();
    await setDoc(doc(db,'siteContent','main'),content.site,{merge:true});
    const batch=writeBatch(db);
    content.works.forEach((work,index)=>{
      const clean={...work,order:index};
      delete clean.storagePath;
      batch.set(doc(db,'works',work.id),clean,{merge:true});
    });
    deletedWorks.forEach(work=>batch.delete(doc(db,'works',work.id)));
    await batch.commit();
    for(const work of deletedWorks.splice(0)){
      if(work.contentPath){deleteArtworkImage(work.contentPath).catch(error=>console.warn('Could not delete GitHub image:',error));}
    }
    if(contentApiReady())hideConnectionBanner();
    toast('Changes saved');
  }catch(error){showFirestoreError(error)}finally{btn.disabled=false}
});
