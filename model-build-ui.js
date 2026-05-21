console.log('✓ model-build-ui.js loaded');
/* ─── state ─────────────────────────────────────────── */
let rawRows=[], headers=[], colTypes=[], cleanRows=[], decisions={};
let targetCol='', featureCols=[], trainedModel=null;
let currentPage=0; const PAGE=10;

/* ─── tab navigation ────────────────────────────────── */
function goTab(n){
  [1,2,3,4].forEach(i=>{
    document.getElementById('panel-'+i).classList.toggle('active',i===n);
    const t=document.getElementById('tab-'+i);
    t.classList.toggle('active',i===n);
  });
  if(n===2&&rawRows.length) buildClean();
  if(n===3&&cleanRows.length) buildTrain();
  if(n===4&&trainedModel) buildExport();
}

/* ─── utilities ─────────────────────────────────────── */
function isMissing(v){
  if (v===null||v===undefined) return true;
  if (typeof v==='number' && Number.isNaN(v)) return true;
  const normalized=String(v).trim().toLowerCase();
  return normalized===''||normalized==='na'||normalized==='n/a'||normalized==='nan';
}
function detectTypes(hdrs,data){
  return hdrs.map(h=>{
    const vals=data.map(r=>r[h]).filter(v=>!isMissing(v));
    const nc=vals.filter(v=>!isNaN(parseFloat(v))&&isFinite(v)).length;
    return nc/vals.length>0.8?'number':'text';
  });
}
function getOutliers(rows,col){
  const vals=rows.map(r=>parseFloat(r[col])).filter(v=>!isNaN(v));
  if(vals.length<4)return[];
  const s=[...vals].sort((a,b)=>a-b);
  const q1=s[Math.floor(s.length*0.25)],q3=s[Math.floor(s.length*0.75)],iqr=q3-q1;
  return rows.map((r,i)=>({r,i})).filter(({r})=>{const v=parseFloat(r[col]);return !isNaN(v)&&(v<q1-1.5*iqr||v>q3+1.5*iqr);});
}
function download(content,filename,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=filename; a.click(); URL.revokeObjectURL(a.href);
}

/* ─── STEP 1: upload ────────────────────────────────── */
const SAMPLE=`animal,weight_kg,height_cm,diet,label
dog,25,55,omnivore,mammal
cat,4,25,carnivore,mammal
eagle,5,90,carnivore,bird
salmon,4,70,carnivore,fish
parrot,0.5,30,herbivore,bird
wolf,40,80,carnivore,mammal
tuna,150,,carnivore,fish
sparrow,0.03,14,omnivore,bird
bear,200,120,omnivore,mammal
trout,2,50,carnivore,fish
hawk,1,55,carnivore,bird
goldfish,0.1,15,omnivore,fish
lion,190,100,carnivore,mammal
penguin,10,60,carnivore,bird
shark,500,300,carnivore,fish
rabbit,2,20,herbivore,mammal
owl,1.5,45,carnivore,bird
carp,3,60,omnivore,fish
fox,6,40,omnivore,mammal
pigeon,0.3,32,omnivore,bird
dog,25,55,omnivore,mammal
cat,4,25,carnivore,mammal`;

function loadSample(){Papa.parse(SAMPLE,{header:true,skipEmptyLines:true,complete:r=>showData(r,'sample_animals.csv')});}
function handleDrop(e){e.preventDefault();document.getElementById('drop-zone').style.background='';const f=e.dataTransfer.files[0];if(f)handleFile(f);}
function handleFile(f){if(!f)return;Papa.parse(f,{header:true,skipEmptyLines:true,complete:r=>showData(r,f.name)});}
function showData(res,fname){
  headers=res.meta.fields; rawRows=res.data;
  colTypes=detectTypes(headers,rawRows);
  cleanRows=[...rawRows.map(r=>Object.assign({},r))];
  currentPage=0;
  document.getElementById('drop-zone').style.display='none';
  document.getElementById('preview-card').style.display='block';
  document.getElementById('file-name-lbl').textContent=fname;
  document.getElementById('file-meta-lbl').textContent=rawRows.length+' rows · '+headers.length+' columns';
  renderPreviewTable(); renderColBadges();
  document.getElementById('tab-1').classList.add('done');
}
function resetFile(){
  rawRows=[];headers=[];colTypes=[];cleanRows=[];decisions={};targetCol='';featureCols=[];trainedModel=null;
  currentPage=0;
  document.getElementById('drop-zone').style.display='block';
  document.getElementById('preview-card').style.display='none';
  document.getElementById('file-input').value='';
}
function renderPreviewTable(){
  const start=currentPage*PAGE, pageRows=rawRows.slice(start,start+PAGE);
  const total=Math.ceil(rawRows.length/PAGE);
  let h='<thead><tr>'+headers.map((hd,i)=>`<th>${colTypes[i]==='number'?'#':'T'} ${hd}</th>`).join('')+'</tr></thead><tbody>';
  pageRows.forEach(r=>{h+='<tr>'+headers.map(hd=>`<td>${r[hd]??''}</td>`).join('')+'</tr>';});
  document.getElementById('preview-table').innerHTML=h+'</tbody>';
  document.getElementById('pager-info').textContent=`Rows ${start+1}–${Math.min(start+PAGE,rawRows.length)} of ${rawRows.length}`;
  document.getElementById('page-lbl').textContent=`${currentPage+1}/${total}`;
}
function changePage(d){
  const total=Math.ceil(rawRows.length/PAGE);
  currentPage=Math.max(0,Math.min(currentPage+d,total-1));
  renderPreviewTable();
}
function renderColBadges(){
  document.getElementById('col-badges').innerHTML=headers.map((h,i)=>
    `<span class="badge ${colTypes[i]==='number'?'badge-num':'badge-text'}">${h} (${colTypes[i]})</span>`
  ).join('');
}

/* ─── STEP 2: clean ─────────────────────────────────── */
function buildClean(){
  decisions={};
  cleanRows=rawRows.map(r=>Object.assign({},r));
  buildCleanSummary(); buildChecks(); refreshClean();
}
function buildCleanSummary(){
  const mc=rawRows.reduce((a,r)=>a+headers.filter(h=>isMissing(r[h])).length,0);
  const dc=rawRows.length-new Set(rawRows.map(r=>JSON.stringify(r))).size;
  const oc=headers.filter((h,i)=>colTypes[i]==='number').reduce((a,h)=>a+getOutliers(rawRows,h).length,0);
  document.getElementById('clean-summary').innerHTML=[
    {l:'Total rows',v:rawRows.length,s:'',w:false},
    {l:'Columns',v:headers.length,s:'',w:false},
    {l:'Missing values',v:mc,s:'cells',w:mc>0},
    {l:'Duplicate rows',v:dc,s:'',w:dc>0},
    {l:'Possible outliers',v:oc,s:'',w:oc>0},
  ].map(s=>`<div class="stat-card"><div class="stat-label">${s.l}</div><div class="stat-val" style="color:${s.w?'var(--warn)':'var(--text)'}">${s.v}</div><div class="stat-sub">${s.s}</div></div>`).join('');
}
function buildChecks(){
  const c=document.getElementById('checks-container'); c.innerHTML='';
  buildDupCheck(c); buildMissingCheck(c); buildOutlierCheck(c); buildColTypeCheck(c);
}
function makeCheck(container,id,icon,title,statusHtml,bodyHtml){
  const d=document.createElement('div');
  d.className='check-section'; d.id='chk-'+id;
  d.innerHTML=`<div class="check-header" onclick="toggleBody('body-${id}')">
    <span style="font-size:18px;">${icon}</span>
    <span class="check-title">${title}</span>
    ${statusHtml}
    <span style="color:var(--text3);">&#8964;</span>
  </div><div class="check-body" id="body-${id}">${bodyHtml}</div>`;
  container.appendChild(d);
}
function toggleBody(id){const e=document.getElementById(id);if(e)e.style.display=e.style.display==='none'?'block':'none';}
function statusBadge(text,type){return `<span class="badge badge-${type}">${text}</span>`;}

function buildDupCheck(c){
  const seen=new Map(),dupes=[];
  rawRows.forEach((r,i)=>{const k=JSON.stringify(r);if(seen.has(k))dupes.push(i);else seen.set(k,i);});
  const has=dupes.length>0;
  const body=has?`<p>These rows appear more than once. Duplicates can confuse your model by repeating the same example.</p>
    <div style="overflow-x:auto;margin-bottom:12px;"><table>${'<thead><tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr></thead><tbody>'+dupes.map(i=>`<tr style="background:var(--warn-bg)">${headers.map(h=>`<td>${rawRows[i][h]}</td>`).join('')}</tr>`).join('')+'</tbody>'}</table></div>
    <div class="flex-row gap-sm">
      <button class="btn btn-sm" id="db-remove" onclick="setD('duplicates','remove');hlBtn('db-remove','db-keep');">Remove duplicates</button>
      <button class="btn btn-sm" id="db-keep" onclick="setD('duplicates','keep');hlBtn('db-keep','db-remove');">Keep them</button>
    </div>`:
    `<div class="alert alert-ok">&#10003; No duplicate rows found.</div>`;
  makeCheck(c,'dup','&#128260;','Duplicate rows',statusBadge(has?dupes.length+' found':'None found',has?'warn':'ok'),body);
}

function buildMissingCheck(c){
  const mc=headers.map((h,i)=>({h,i,miss:rawRows.filter(r=>isMissing(r[h]))})).filter(x=>x.miss.length>0);
  const total=mc.reduce((s,x)=>s+x.miss.length,0);
  const has=total>0;
  const body=has?`<p>Some cells are empty. Choose what to do for each column.</p>`+
    mc.map(col=>{
      const isNum=colTypes[col.i]==='number';
      const vals=rawRows.map(r=>parseFloat(r[col.h])).filter(v=>!isNaN(v));
      const avg=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2):null;
      return `<div style="margin-bottom:12px;padding:12px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border);">
        <p style="font-size:13px;font-weight:bold;font-family:sans-serif;margin-bottom:8px;">${col.h} — ${col.miss.length} missing</p>
        <div class="flex-row gap-sm">
          <button class="btn btn-sm" id="mb-${col.h}-r" onclick="setD('m_${col.h}','remove');hlBtn('mb-${col.h}-r','mb-${col.h}-a','mb-${col.h}-u','mb-${col.h}-k');">Remove rows</button>
          ${isNum&&avg?`<button class="btn btn-sm" id="mb-${col.h}-a" onclick="setD('m_${col.h}','fill_avg');hlBtn('mb-${col.h}-a','mb-${col.h}-r','mb-${col.h}-u','mb-${col.h}-k');">Fill with average (${avg})</button>`:''}
          <button class="btn btn-sm" id="mb-${col.h}-u" onclick="setD('m_${col.h}','fill_unknown');hlBtn('mb-${col.h}-u','mb-${col.h}-r','mb-${col.h}-a','mb-${col.h}-k');">Fill with "unknown"</button>
          <button class="btn btn-sm" id="mb-${col.h}-k" onclick="setD('m_${col.h}','keep');hlBtn('mb-${col.h}-k','mb-${col.h}-r','mb-${col.h}-a','mb-${col.h}-u');">Leave as is</button>
        </div>
        <p id="mst-${col.h}" style="font-size:12px;color:var(--text3);font-family:sans-serif;margin-top:6px;"></p>
      </div>`;
    }).join('')
    :`<div class="alert alert-ok">&#10003; No missing values found.</div>`;
  makeCheck(c,'missing','&#10060;','Missing values',statusBadge(has?total+' missing':'None found',has?'warn':'ok'),body);
}

function buildOutlierCheck(c){
  const oc=headers.filter((h,i)=>colTypes[i]==='number').map(h=>({h,out:getOutliers(rawRows,h)})).filter(x=>x.out.length>0);
  const total=oc.reduce((s,x)=>s+x.out.length,0);
  const has=total>0;
  const body=has?`<p>Values much higher or lower than the rest. They might be real data, or mistakes — you decide.</p>`+
    oc.map(col=>`<div style="margin-bottom:12px;padding:12px;background:var(--surface2);border-radius:var(--radius-sm);border:1px solid var(--border);">
      <p style="font-size:13px;font-weight:bold;font-family:sans-serif;margin-bottom:8px;">${col.h}</p>
      <div style="overflow-x:auto;margin-bottom:8px;"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${col.out.map(({r})=>`<tr>${headers.map(h=>`<td>${r[h]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="flex-row gap-sm">
        <button class="btn btn-sm" id="ob-${col.h}-r" onclick="setD('o_${col.h}','remove');hlBtn('ob-${col.h}-r','ob-${col.h}-k');">Remove these rows</button>
        <button class="btn btn-sm" id="ob-${col.h}-k" onclick="setD('o_${col.h}','keep');hlBtn('ob-${col.h}-k','ob-${col.h}-r');">Keep them</button>
      </div>
    </div>`).join('')
    :`<div class="alert alert-ok">&#10003; No outliers detected.</div>`;
  makeCheck(c,'outlier','&#9888;','Outliers',statusBadge(has?total+' possible':'None found',has?'warn':'ok'),body);
}

function buildColTypeCheck(c){
  const body=`<p>Check each column was detected correctly. Click to override if needed.</p>
    <div class="flex-row" style="gap:8px;" id="coltype-grid"></div>`;
  makeCheck(c,'coltype','&#128202;','Column types',statusBadge(headers.length+' columns','num'),body);
  renderColTypeGrid();
}
function renderColTypeGrid(){
  const g=document.getElementById('coltype-grid');
  if(!g)return;
  g.innerHTML=headers.map((h,i)=>{
    const isNum=colTypes[i]==='number';
    return `<div style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);">
      <p style="font-size:12px;color:var(--text2);font-family:sans-serif;margin-bottom:4px;">${h}</p>
      <div class="flex-row gap-sm">
        <button onclick="switchType(${i},'number')" style="font-size:11px;padding:2px 8px;border:1px solid ${isNum?'var(--info)':'var(--border2)'};border-radius:4px;cursor:pointer;background:${isNum?'var(--info-bg)':'none'};color:${isNum?'var(--info)':'var(--text3)'};">Number</button>
        <button onclick="switchType(${i},'text')" style="font-size:11px;padding:2px 8px;border:1px solid ${!isNum?'var(--accent)':'var(--border2)'};border-radius:4px;cursor:pointer;background:${!isNum?'var(--accent-bg)':'none'};color:${!isNum?'var(--accent-text)':'var(--text3)'};">Text</button>
      </div>
    </div>`;
  }).join('');
}
function switchType(i,t){colTypes[i]=t;renderColTypeGrid();refreshClean();}
function setD(k,v){
  decisions[k]=v;
  const msgs={remove:'Rows with missing values will be removed.',fill_avg:'Empty cells will be filled with the average.',fill_unknown:'Empty cells will be filled with "unknown".',keep:'Leaving as is.'};
  if(k.startsWith('m_')){const e=document.getElementById('mst-'+k.slice(2));if(e)e.textContent=msgs[v]||'';}
  refreshClean();
}
function hlBtn(active,...rest){
  const a=document.getElementById(active);
  if(a){a.style.background='var(--accent-bg)';a.style.color='var(--accent-text)';a.style.borderColor='var(--accent)';}
  rest.forEach(id=>{const e=document.getElementById(id);if(e){e.style.background='';e.style.color='';e.style.borderColor='';}});
}
function refreshClean(){
  let rows=rawRows.map(r=>Object.assign({},r));
  if(decisions['duplicates']==='remove'){const s=new Set();rows=rows.filter(r=>{const k=JSON.stringify(r);if(s.has(k))return false;s.add(k);return true;});}
  headers.forEach(h=>{
    const d=decisions['m_'+h]; if(!d||d==='keep')return;
    if(d==='remove'){rows=rows.filter(r=>!isMissing(r[h]));return;}
    if(d==='fill_avg'){const v=rows.map(r=>parseFloat(r[h])).filter(v=>!isNaN(v));const avg=v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2):0;rows.forEach(r=>{if(isMissing(r[h]))r[h]=avg;});}
    if(d==='fill_unknown'){rows.forEach(r=>{if(isMissing(r[h]))r[h]='unknown';});}
  });
  headers.forEach(h=>{if(decisions['o_'+h]==='remove'){const idx=new Set(getOutliers(rawRows,h).map(o=>o.i));rows=rows.filter((_,i)=>!idx.has(i));}});
  cleanRows=rows;
  renderCleanPreview();
}
function renderCleanPreview(){
  const card=document.getElementById('clean-preview-card');
  card.style.display='block';
  const preview=cleanRows.slice(0,8);
  let h='<thead><tr>'+headers.map(hd=>`<th>${hd}</th>`).join('')+'</tr></thead><tbody>';
  preview.forEach(r=>{h+='<tr>'+headers.map(hd=>`<td>${r[hd]??''}</td>`).join('')+'</tr>';});
  document.getElementById('clean-table').innerHTML=h+'</tbody>';
  const removed=rawRows.length-cleanRows.length;
  document.getElementById('clean-meta').textContent=`${cleanRows.length} rows remaining${removed>0?` (${removed} removed)`:''} · First 8 shown`;
  document.getElementById('clean-nav').style.display='flex';
  document.getElementById('clean-ready-msg').textContent=`${cleanRows.length} rows ready${removed>0?`, ${removed} removed`:''}.`;
}

/* ─── STEP 3: train ─────────────────────────────────── */
function buildTrain(){
  renderTargetGrid();
  document.getElementById('feature-card').style.display='none';
  document.getElementById('results-card').style.display='none';
}
function renderTargetGrid(){
  document.getElementById('target-grid').innerHTML=headers.map((h,i)=>
    `<span class="col-chip ${h===targetCol?'selected-target':''}" onclick="selectTarget('${h}')">${h} <small style="opacity:0.6;">(${colTypes[i]})</small></span>`
  ).join('');
}
function selectTarget(h){
  targetCol=h; featureCols=headers.filter(x=>x!==h);
  renderTargetGrid(); renderFeatureGrid();
  document.getElementById('feature-card').style.display='block';
  document.getElementById('results-card').style.display='none';
  const isNum=colTypes[headers.indexOf(h)]==='number';
  const uniqueVals=isNum?new Set(cleanRows.map(r=>r[h]).filter(v=>!isMissing(v))).size:0;
  document.getElementById('target-warning').innerHTML=(isNum&&uniqueVals>10)
    ?`<div class="alert alert-warn">This column has ${uniqueVals} different numeric values, so it looks like a measurement rather than a category. This model predicts categories — it will only return exact values it has seen in your data. If you want to predict a number, you may get unexpected results.</div>`
    :'';
}
function renderFeatureGrid(){
  document.getElementById('feature-grid').innerHTML=headers.filter(h=>h!==targetCol).map(h=>
    `<span class="col-chip ${featureCols.includes(h)?'selected-feature':'deselected'}" onclick="toggleFeat('${h}')">${featureCols.includes(h)?'&#10003;':''} ${h}</span>`
  ).join('');
  updateFeatureWarnings();
}
function updateFeatureWarnings(){
  const el=document.getElementById('feature-warnings');
  if(!el)return;
  const warns=featureCols.filter(f=>{
    const i=headers.indexOf(f);
    if(colTypes[i]!=='text')return false;
    return new Set(cleanRows.map(r=>r[f]).filter(v=>!isMissing(v))).size>10;
  }).map(f=>{
    const u=new Set(cleanRows.map(r=>r[f]).filter(v=>!isMissing(v))).size;
    return `<div class="alert alert-warn"><strong>${f}</strong> has ${u} unique text values — too many for the model to learn from reliably. Consider removing it as a feature.</div>`;
  });
  el.innerHTML=warns.join('');
}
function toggleFeat(h){featureCols=featureCols.includes(h)?featureCols.filter(x=>x!==h):[...featureCols,h];renderFeatureGrid();}

function buildEncodings(feats){
  const enc={};
  feats.forEach(f=>{const i=headers.indexOf(f);if(colTypes[i]==='text')enc[f]=[...new Set(cleanRows.map(r=>r[f]).filter(v=>!isMissing(v)))];});
  return enc;
}
function buildStats(feats,data,enc){
  const stats={};
  feats.forEach(f=>{
    const i=headers.indexOf(f);
    if(colTypes[i]==='number'){const v=data.map(r=>parseFloat(r[f])).filter(v=>!isNaN(v));const mn=Math.min(...v),mx=Math.max(...v);stats[f]={mn,mx,range:mx-mn||1};}
  });
  return stats;
}
function encodeRow(row,feats,enc,stats){
  const out=[];
  feats.forEach(f=>{
    const i=headers.indexOf(f);
    if(colTypes[i]==='number'){const v=parseFloat(row[f])||0;const s=stats[f];out.push(s?(v-s.mn)/s.range:v);}
    else{(enc[f]||[]).forEach(v=>out.push(row[f]===v?1:0));}
  });
  return out;
}
function euclidean(a,b){return Math.sqrt(a.reduce((s,v,i)=>s+(v-b[i])**2,0));}
function knnPredict(trainX,trainY,x,k){
  const d=trainX.map((tx,i)=>({d:euclidean(tx,x),label:trainY[i]}));
  d.sort((a,b)=>a.d-b.d);
  const counts={};
  d.slice(0,k).forEach(n=>{counts[n.label]=(counts[n.label]||0)+1;});
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}
function buildFolds(n,k){
  const shuffled=[...Array(n).keys()].sort(()=>Math.random()-0.5);
  const fsz=Math.floor(n/k);
  return Array.from({length:k},(_,f)=>({
    test:shuffled.slice(f*fsz,(f+1)*fsz),
    train:shuffled.filter((_,j)=>j<f*fsz||j>=(f+1)*fsz)
  }));
}
function crossValidate(X,y,k,folds){
  const builtFolds=typeof folds==='number'?buildFolds(X.length,folds):folds;
  let correct=0,total=0;
  builtFolds.forEach(({test,train})=>{
    const tX=train.map(i=>X[i]),tY=train.map(i=>y[i]);
    test.forEach(i=>{if(knnPredict(tX,tY,X[i],k)===y[i])correct++;total++;});
  });
  return correct/total;
}
function loocv(X,y,k){
  let correct=0;
  for(let i=0;i<X.length;i++){
    const tX=X.filter((_,j)=>j!==i),tY=y.filter((_,j)=>j!==i);
    if(knnPredict(tX,tY,X[i],k)===y[i])correct++;
  }
  return correct/X.length;
}
function permImportanceLoocv(X,y,k,feats,enc){
  const base=loocv(X,y,k);
  const REPS=5;
  return feats.map((f,fi)=>{
    const start=feats.slice(0,fi).reduce((s,ff)=>{const i=headers.indexOf(ff);return s+(colTypes[i]==='number'?1:(enc[ff]||[]).length);},0);
    const len=colTypes[headers.indexOf(f)]==='number'?1:(enc[f]||[]).length;
    const vals=X.map(rr=>rr.slice(start,start+len));
    let drop=0;
    for(let r=0;r<REPS;r++){
      const sv=[...vals].sort(()=>Math.random()-0.5);
      const Xp=X.map((row,ri)=>{const rc=[...row];for(let i=0;i<len;i++)rc[start+i]=sv[ri][i];return rc;});
      drop+=Math.max(0,base-loocv(Xp,y,k));
    }
    return drop/REPS;
  });
}
function permImportance(X,y,k,feats,enc){
  const numFolds=Math.min(5,Math.floor(X.length/2));
  const folds=buildFolds(X.length,numFolds);
  const base=crossValidate(X,y,k,folds);
  const REPS=3;
  return feats.map((f,fi)=>{
    const start=feats.slice(0,fi).reduce((s,ff)=>{const i=headers.indexOf(ff);return s+(colTypes[i]==='number'?1:(enc[ff]||[]).length);},0);
    const len=colTypes[headers.indexOf(f)]==='number'?1:(enc[f]||[]).length;
    const vals=X.map(rr=>rr.slice(start,start+len));
    let drop=0;
    for(let r=0;r<REPS;r++){
      const sv=[...vals].sort(()=>Math.random()-0.5);
      const Xp=X.map((row,ri)=>{const rc=[...row];for(let i=0;i<len;i++)rc[start+i]=sv[ri][i];return rc;});
      drop+=Math.max(0,base-crossValidate(Xp,y,k,folds));
    }
    return drop/REPS;
  });
}

function trainModel(){
  if(!targetCol||!featureCols.length)return;
  const enc=buildEncodings(featureCols);
  const stats=buildStats(featureCols,cleanRows,enc);
  const X=cleanRows.map(r=>encodeRow(r,featureCols,enc,stats));
  const y=cleanRows.map(r=>r[targetCol]);
  const candidates=[1,3,5,7].filter(v=>v<cleanRows.length);
  let bestK=candidates[0],bestAcc=-1,acc,imp,methodLabel;
  if(cleanRows.length<=200){
    candidates.forEach(kc=>{const a=loocv(X,y,kc);if(a>bestAcc){bestAcc=a;bestK=kc;}});
    acc=bestAcc;
    imp=permImportanceLoocv(X,y,bestK,featureCols,enc);
    methodLabel='tested on each row';
  } else {
    const numFolds=Math.min(5,Math.floor(cleanRows.length/2));
    candidates.forEach(kc=>{const a=crossValidate(X,y,kc,numFolds);if(a>bestAcc){bestAcc=a;bestK=kc;}});
    acc=(crossValidate(X,y,bestK,numFolds)+crossValidate(X,y,bestK,numFolds)+crossValidate(X,y,bestK,numFolds))/3;
    imp=permImportance(X,y,bestK,featureCols,enc);
    methodLabel='5-fold cross-validation';
  }
  const tot=imp.reduce((s,v)=>s+v,0)||1;
  const featImp=Object.fromEntries(featureCols.map((f,i)=>[f,imp[i]/tot]));
  trainedModel={X,y,k:bestK,enc,stats,featureCols,targetCol,featImp,headers,colTypes,trainingData:cleanRows,accuracy:Math.round(acc*100)};
  showResults(acc,methodLabel,featImp,bestK);
  document.getElementById('tab-3').classList.add('done');
}

function showResults(acc,methodLabel,featImp,k){
  const card=document.getElementById('results-card');
  card.style.display='block';
  card.scrollIntoView({behavior:'smooth',block:'nearest'});
  const accPct=Math.round(acc*100);
  const col=accPct>=80?'var(--accent)':accPct>=60?'var(--warn)':'var(--danger)';
  document.getElementById('result-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Accuracy</div><div class="stat-val" style="color:${col}">${accPct}%</div><div class="stat-sub">${methodLabel}</div></div>
    <div class="stat-card"><div class="stat-label">Training rows</div><div class="stat-val">${cleanRows.length}</div><div class="stat-sub">all rows rotated</div></div>
    <div class="stat-card"><div class="stat-label">Features used</div><div class="stat-val">${featureCols.length}</div><div class="stat-sub">columns</div></div>
    <div class="stat-card"><div class="stat-label">Algorithm</div><div class="stat-val" style="font-size:14px;margin-top:4px;">KNN</div><div class="stat-sub">chose k = ${k}</div></div>`;

  const sorted=Object.entries(featImp).sort((a,b)=>b[1]-a[1]);
  const mx=sorted[0]?sorted[0][1]:1;
  document.getElementById('importance-bars').innerHTML=sorted.map(([f,v])=>{
    const pct=mx>0?Math.round((v/mx)*100):0;
    return `<div class="bar-row"><span class="bar-label">${f}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-pct">${pct}%</span></div>`;
  }).join('');

  renderPredictInputs();
}

function renderPredictInputs(){
  if(!trainedModel)return;
  const {featureCols,enc,stats}=trainedModel;
  document.getElementById('predict-inputs').innerHTML=featureCols.map(f=>{
    const i=headers.indexOf(f),isNum=colTypes[i]==='number';
    const sample=cleanRows.map(r=>r[f]).filter(v=>!isMissing(v));
    if(isNum){
      const nums=sample.map(v=>parseFloat(v)).filter(v=>!isNaN(v));
      const mn=Math.min(...nums),mx=Math.max(...nums),avg=(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(1);
      return `<div><label style="font-size:12px;color:var(--text2);font-family:sans-serif;display:block;margin-bottom:4px;">${f}</label>
        <input type="number" id="inp-${f}" value="${avg}" min="${mn}" max="${mx}" step="any">
        <p style="font-size:11px;color:var(--text3);font-family:sans-serif;margin-top:2px;">${mn} – ${mx}</p></div>`;
    } else {
      const opts=enc[f]||[...new Set(sample)];
      return `<div><label style="font-size:12px;color:var(--text2);font-family:sans-serif;display:block;margin-bottom:4px;">${f}</label>
        <select id="inp-${f}">${opts.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></div>`;
    }
  }).join('');
}

function runPredict(){
  if(!trainedModel)return;
  const {X,y,k,enc,stats,featureCols}=trainedModel;
  const row={};featureCols.forEach(f=>{row[f]=document.getElementById('inp-'+f).value;});
  const x=encodeRow(row,featureCols,enc,stats);
  const pred=knnPredict(X,y,x,k);
  const el=document.getElementById('predict-result');
  el.style.display='block';
  document.getElementById('predict-val').textContent=pred;
}

/* ─── STEP 4: export ────────────────────────────────── */
function buildExport(){
  if(!trainedModel)return;
  const {targetCol,featureCols,k,accuracy}=trainedModel;
  document.getElementById('export-summary').innerHTML=`
    <div class="card-title" style="margin-bottom:12px;">Your model</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
      <div><div class="stat-label">Target</div><div style="font-size:14px;font-weight:bold;font-family:sans-serif;">${targetCol}</div></div>
      <div><div class="stat-label">Features</div><div style="font-size:14px;font-weight:bold;font-family:sans-serif;">${featureCols.join(', ')}</div></div>
      <div><div class="stat-label">Algorithm</div><div style="font-size:14px;font-weight:bold;font-family:sans-serif;">KNN (k=${k})</div></div>
      <div><div class="stat-label">Accuracy</div><div style="font-size:14px;font-weight:bold;font-family:sans-serif;color:var(--accent);">${accuracy}%</div></div>
    </div>`;
}

function buildModelPayload(){
  const {k,enc,stats,featureCols,targetCol,colTypes:ct,trainingData,accuracy}=trainedModel;
  const modelColTypes={};featureCols.forEach(f=>{modelColTypes[f]=ct[headers.indexOf(f)];});
  return {targetCol,featureCols,colTypes:modelColTypes,k,accuracy,encodings:enc,stats,trainingData};
}
function downloadModel(){
  if(!trainedModel)return;
  download(JSON.stringify(buildModelPayload(),null,2),'model.json','application/json');
}
function generateStarterHtml(payload){
  const safeJson=JSON.stringify(payload).replace(/<\/script>/gi,'<\\/script>');
  const fields=payload.featureCols.map(f=>{
    const id='inp_'+f.replace(/\W+/g,'_');
    if(payload.colTypes[f]==='number'){
      const vals=payload.trainingData.map(r=>parseFloat(r[f])).filter(v=>!isNaN(v));
      const mn=Math.min(...vals),mx=Math.max(...vals),avg=(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
      return `<div class="field"><label>${f}</label><input type="number" id="${id}" value="${avg}" step="any"><small>${mn} – ${mx}</small></div>`;
    } else {
      const opts=(payload.encodings[f]||[]).map(v=>`<option value="${v}">${v}</option>`).join('');
      return `<div class="field"><label>${f}</label><select id="${id}">${opts}</select></div>`;
    }
  }).join('\n    ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Predictor</title>
  <style>
    body { font-family: sans-serif; max-width: 480px; margin: 2rem auto; padding: 1rem; background: #f9f9f9; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .sub { font-size: 13px; color: #666; margin-bottom: 1.5rem; }
    .field { margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: bold; margin-bottom: 4px; }
    input[type=number], select { width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    small { font-size: 11px; color: #888; }
    button { padding: 10px 24px; background: #2a6e4e; color: white; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; margin-top: 8px; }
    button:hover { background: #1e5238; }
    #result { display: none; margin-top: 20px; padding: 16px; background: #e8f4ee; border: 1px solid #2a6e4e; border-radius: 8px; }
    #result .lbl { font-size: 12px; color: #4a8a6a; margin-bottom: 4px; }
    #result .val { font-size: 28px; font-weight: bold; color: #1e5238; }
  </style>
</head>
<body>
  <h1>My Predictor</h1>
  <p class="sub">Enter values and click Predict.</p>
  ${fields}
  <button onclick="predict()">Predict</button>
  <div id="result">
    <div class="lbl">Prediction</div>
    <div class="val" id="pred-val"></div>
  </div>
  <script>
  const MODEL = ${safeJson};

  function encodeRow(inputs) {
    const vec = [];
    MODEL.featureCols.forEach(f => {
      if (MODEL.colTypes[f] === 'number') {
        const v = parseFloat(inputs[f]) || 0, s = MODEL.stats[f];
        vec.push(s ? (v - s.mn) / s.range : v);
      } else {
        (MODEL.encodings[f] || []).forEach(v => vec.push(inputs[f] === v ? 1 : 0));
      }
    });
    return vec;
  }

  function predict() {
    const inputs = {};
    MODEL.featureCols.forEach(f => {
      inputs[f] = document.getElementById('inp_' + f.replace(/\\W+/g, '_')).value;
    });
    const x = encodeRow(inputs);
    const distances = MODEL.trainingData.map(row => {
      const ri = {};
      MODEL.featureCols.forEach(f => ri[f] = row[f]);
      const d = Math.sqrt(encodeRow(ri).reduce((s,v,i) => s + (v - x[i]) ** 2, 0));
      return { d, label: row[MODEL.targetCol] };
    });
    distances.sort((a, b) => a.d - b.d);
    const counts = {};
    distances.slice(0, MODEL.k).forEach(n => { counts[n.label] = (counts[n.label] || 0) + 1; });
    const prediction = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    document.getElementById('pred-val').textContent = prediction;
    document.getElementById('result').style.display = 'block';
  }
  <\/script>
</body>
</html>`;
}
function downloadStarterZip(){
  if(!trainedModel)return;
  const payload=buildModelPayload();
  const zip=new JSZip();
  zip.file('model.json',JSON.stringify(payload,null,2));
  zip.file('starter.html',generateStarterHtml(payload));
  zip.generateAsync({type:'blob'}).then(blob=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='my-predictor.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

function downloadServer(){
  if(!trainedModel)return;
  const code=`# server.py — KNN prediction API
# Run: python server.py
# Requires: pip install flask flask-cors

import json, math
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

with open('model.json') as f:
    model = json.load(f)

def encode_row(inputs):
    vec = []
    for feat in model['featureCols']:
        col_type = model['colTypes'][feat]
        if col_type == 'number':
            v = float(inputs.get(feat, 0))
            s = model['stats'][feat]
            vec.append((v - s['mn']) / s['range'] if s['range'] else v)
        else:
            for val in model['encodings'].get(feat, []):
                vec.append(1 if inputs.get(feat) == val else 0)
    return vec

def euclidean(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

def knn_predict(input_vec):
    k = model['k']
    train = model['trainingData']
    target = model['targetCol']
    feats = model['featureCols']
    ct = model['colTypes']
    enc = model.get('encodings', {})
    stats = model.get('stats', {})

    def encode_train_row(row):
        vec = []
        for feat in feats:
            if ct[feat] == 'number':
                v = float(row.get(feat, 0))
                s = stats[feat]
                vec.append((v - s['mn']) / s['range'] if s['range'] else v)
            else:
                for val in enc.get(feat, []):
                    vec.append(1 if row.get(feat) == val else 0)
        return vec

    dists = [(euclidean(encode_train_row(row), input_vec), row[target]) for row in train]
    dists.sort(key=lambda x: x[0])
    counts = {}
    for _, label in dists[:k]:
        counts[label] = counts.get(label, 0) + 1
    return max(counts, key=counts.get)

@app.route('/predict')
def predict():
    inputs = dict(request.args)
    vec = encode_row(inputs)
    result = knn_predict(vec)
    return result

@app.route('/features')
def features():
    return jsonify({'features': model['featureCols'], 'target': model['targetCol']})

@app.route('/')
def index():
    return 'Model API is running. Use /predict?feature1=value1&feature2=value2'

if __name__ == '__main__':
    app.run(debug=True, port=5000)
`;
  download(code,'server.py','text/plain');
}

function downloadReadme(){
  if(!trainedModel)return;
  const {featureCols,targetCol,k,accuracy}=trainedModel;
  const ex=featureCols.map(f=>{const i=headers.indexOf(f);return `${f}=${colTypes[i]==='number'?'25':'omnivore'}`;}).join('&');
  const txt=`HOW TO RUN YOUR MODEL API
=========================

FILES YOU NEED
--------------
  model.json   your trained model
  server.py    the API server

STEP 1 — Install Python
  Download from https://python.org
  Check "Add Python to PATH" during install (Windows).

STEP 2 — Install dependencies
  Open Terminal (Mac) or Command Prompt (Windows):
    pip install flask flask-cors

STEP 3 — Put both files in the same folder

STEP 4 — Start the server
  Navigate to that folder in Terminal:
    cd path/to/your/folder
  Then run:
    python server.py
  You should see: Running on http://127.0.0.1:5000

STEP 5 — Test in your browser
  Open: http://localhost:5000/predict?${ex}
  You should get a plain text prediction back.

STEP 6 — Call from App Inventor
  1. Add a Web component to your app
  2. Set Url to:
       http://YOUR_IP:5000/predict?${ex}
  3. Call Web1.Get
  4. In GotText, use ResponseContent

  Find your IP:
    Mac: System Settings > Wi-Fi > Details > IP Address
    Windows: run ipconfig, look for IPv4 Address
  Note: phone and computer must be on the same Wi-Fi.

DEPLOYING ONLINE
----------------
  For a public URL not tied to your local machine:
  - PythonAnywhere (pythonanywhere.com) — free, no sleeping, easiest
  - Render (render.com) — free, connects to GitHub
  - Replit (replit.com) — paste files, hit Run, share URL

MODEL DETAILS
-------------
  Target column : ${targetCol}
  Features      : ${featureCols.join(', ')}
  Algorithm     : k-nearest neighbors (k=${k})
  Accuracy      : ${accuracy}%

ENDPOINTS
---------
  GET /predict?feature1=val&feature2=val   returns prediction
  GET /features                            lists features and target
  GET /                                    checks server is running
`;
  download(txt,'README.txt','text/plain');
}
