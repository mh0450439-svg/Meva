(() => {
  'use strict';
  const D = window.RESULTS_DATA;
  const CURRENT_USER = window.CURRENT_USER;
  if (!D || !Array.isArray(D.students) || !CURRENT_USER) {
    document.body.innerHTML = '<main style="padding:40px;font-family:Arial">تعذر تحميل جلسة المستخدم. أعيدي تشغيل التطبيق وسجّلي الدخول مجددًا.</main>';
    return;
  }
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, size=20, className='') => window.APP_ICON(name, size, className);
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, 18); });
  const nfmt = (n, d=1) => Number(n).toLocaleString('ar-EG',{maximumFractionDigits:d,minimumFractionDigits:0});
  const pct = n => typeof n === 'number' && Number.isFinite(n) ? `${nfmt(n,1)}٪` : '—';
  const genderWord = gender => gender === 'male' ? 'تلميذ' : 'تلميذة';
  function pluralGender(){const kinds=new Set(students.map(s=>s.gender==='male'?'male':'female'));return kinds.size>1?'التلاميذ والتلميذات':kinds.has('male')?'التلاميذ':'التلميذات';}
  function genderPronoun(){return new Set(students.map(s=>s.gender==='male'?'male':'female')).has('male')?'هم':'هن';}
  function syncAddGenderCopy(){const word=genderWord($('#newGender').value);$('#addTitle').textContent=`إضافة ${word}`;$('#newNameLabel').firstChild.textContent=`اسم ${word}`;$('#addStudentText').textContent=`إضافة ${word}`;}
  function defaultGender(){const boys=students.filter(s=>s.gender==='male').length,girls=students.length-boys;return boys>girls?'male':'female';}
  const canManageStudents = ['admin','supervisor'].includes(CURRENT_USER.role);
  const isSystemAdmin = CURRENT_USER.role === 'admin';
  let allStudents = D.students;
  let students = [];
  let gradeModels = D.grades || [{id:'grade-1',name:'الصف الحالي',subjects:D.subjects,criteria:D.criteria}];
  let selectedGradeId = gradeModels[0]?.id || '';
  let gradeModel = gradeModels[0] || {subjects:[],criteria:{subjects:{},minStrengthSubjects:3,minSupportSubjects:2}};
  let criteria = gradeModel.criteria;
  let subjects = [];
  let categories = [];
  let summary = {};
  let avg = 0;
  let currentView = 'overview';
  let detailReturnView = 'overview';
  let cumulativeRecords = [];
  let cumulativeLoaded = false;
  let selectedCumulativeId = '';

  function classifyStudent(s) {
    const male=s.gender==='male';
    const weak=[], strengths=[]; let absences=0, total=0, availableMax=0, passPoints=0, incomplete=false;
    const model=gradeModels.find(g=>g.id===(s.gradeId||selectedGradeId))||gradeModel;
    for(const sub of model.subjects){
      const value=s.grades[sub.name], rule=model.criteria.subjects[sub.name];
      if(value==='غ'){absences++;continue;}
      if(typeof value!=='number'){incomplete=true;continue;}
      total+=value;availableMax+=rule.max;passPoints+=rule.pass;
      if(value<rule.pass)weak.push(sub.name);
      else if(value<rule.weak)weak.push(sub.name);
      if(value>=rule.excellent)strengths.push(sub.name);
    }
    s.total=total; s.percent=!incomplete&&availableMax?total/availableMax*100:null;s.passBenchmark=availableMax?passPoints/availableMax*100:null;
    s.absences=absences; s.weaknesses=weak; s.strengths=strengths;
    if(incomplete)s.category='بيانات ناقصة';
    else if(!model.subjects.length)s.category='غير مصنفة';
    else if(weak.length>=model.criteria.minSupportSubjects)s.category=male?'يحتاج خطة دعم شاملة':'تحتاج خطة دعم شاملة';
    else if(weak.length>=1&&strengths.length>=1)s.category=male?'متفاوت الأداء':'متفاوتة الأداء';
    else if(weak.length>=1)s.category=male?'يحتاج دعماً في مادة محددة':'تحتاج دعماً في مادة محددة';
    else if(strengths.length>=model.criteria.minStrengthSubjects)s.category=male?'متفوق شامل':'متفوقة شاملة';
    else if(strengths.length>=1)s.category=male?'متميز في مادة/مواد':'متميزة في مادة/مواد';
    else s.category='أداء مستقر';
    return s;
  }
  function updateMetrics() {
    gradeModel=gradeModels.find(g=>g.id===selectedGradeId)||gradeModels[0]||{subjects:[],criteria:{subjects:{},minStrengthSubjects:3,minSupportSubjects:2}};
    criteria=gradeModel.criteria;
    for(const model of gradeModels)for(const sub of model.subjects){
      const rule=model.criteria.subjects[sub.name],maximum=rule.max;
      rule.passRate=Number.isFinite(rule.passRate)?rule.passRate:(Number.isFinite(rule.pass)?rule.pass/maximum*100:50);
      rule.weakRate=Number.isFinite(rule.weakRate)?rule.weakRate:(Number.isFinite(rule.weak)?rule.weak/maximum*100:60);
      rule.excellentRate=Number.isFinite(rule.excellentRate)?rule.excellentRate:(Number.isFinite(rule.excellent)?rule.excellent/maximum*100:90);
      rule.pass=maximum*rule.passRate/100;rule.weak=maximum*rule.weakRate/100;rule.excellent=maximum*rule.excellentRate/100;
    }
    students=allStudents.filter(s=>(s.gradeId||gradeModels[0]?.id)===selectedGradeId).map(s=>classifyStudent({...s,gender:s.gender==='male'?'male':'female'}));
    const group=pluralGender();$('#studentsNavLabel').textContent=group;$('#directoryTitle').textContent=`دليل ${group}`;$('#distributionCaption').textContent=`توزيع ${group} حسب مستوى الأداء`;$('#supportTitle').textContent=group==='التلميذات'?'التلميذات اللاتي يحتجن إلى دعم':group==='التلاميذ'?'التلاميذ الذين يحتاجون إلى دعم':'التلاميذ والتلميذات الذين يحتاجون إلى دعم';$('#footerNoun').textContent=group==='التلميذات'?'تلميذة':group==='التلاميذ'?'تلميذ':'تلميذ/تلميذة';document.title=`نتائج ${group} | لوحة الأداء`;$('#newGender').value=defaultGender();syncAddGenderCopy();
    const n=students.length, totals=students.map(s=>s.percent).filter(v=>Number.isFinite(v));
    avg=totals.length?totals.reduce((a,b)=>a+b,0)/totals.length:0;
    let absent=0, present=0, attempted=0;
    subjects=gradeModel.subjects.map(sub=>{
      const rule=criteria.subjects[sub.name];
      const grades=students.map(s=>s.grades[sub.name]).filter(v=>typeof v==='number');
      const scores=students.map(s=>s.grades[sub.name]);
      const subjectAbsences=scores.filter(v=>v==='غ').length;
      absent+=subjectAbsences;present+=grades.length;attempted+=grades.length+subjectAbsences;
      const mean=grades.length?grades.reduce((a,b)=>a+b,0)/grades.length:0;
      const passed=grades.filter(v=>v>=rule.pass).length;
      return {...sub,average:mean,averageRate:rule.max?mean/rule.max*100:0,passRate:grades.length?passed/grades.length*100:0,failed:grades.filter(v=>v<rule.pass).length,weak:grades.filter(v=>v>=rule.pass&&v<rule.weak).length,excellent:grades.filter(v=>v>=rule.excellent).length};
    });
    const categoryNames=[];
    for(const s of students)if(!categoryNames.includes(s.category))categoryNames.push(s.category);
    categories=categoryNames.map(name=>({name,count:students.filter(s=>s.category===name).length}));
    summary={count:n,averagePercent:avg,attendance:attempted?present/attempted*100:0,absences:absent,supportStudents:students.filter(s=>s.weaknesses?.length).length};
  }
  function refreshDashboard() {
    updateMetrics();
    $('#pageSub').textContent=`ملخص نتائج ${pluralGender()} في ${gradeModel.name} ومؤشرات التحصيل في مكان واحد.`;
    const weakness=[...subjects].sort((a,b)=>a.passRate-b.passRate)[0]||{name:'—',passRate:0,failed:0};
    const strength=[...subjects].sort((a,b)=>b.averageRate-a.averageRate)[0]||{name:'—',averageRate:0,passRate:0};
    $('#kpis').innerHTML = [
      [`عدد ${pluralGender()}`, nfmt(summary.count,0), 'سجلًا نشطًا في النتيجة الحالية', 'students'],
      ['متوسط التحصيل', pct(avg), 'متوسط نسب السجلات المكتملة', 'trend'],
      ['نسبة الحضور', pct(summary.attendance), `${nfmt(summary.absences,0)} حالات غياب في المواد`, 'calendarCheck'],
      ['تحتاج إلى متابعة', nfmt(summary.supportStudents,0), 'سجل لديه ضعف في مادة أو أكثر', 'alert'],
    ].map(([label,value,foot,iconName])=>`<article class="kpi"><div class="kpi-icon">${icon(iconName,19)}</div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></article>`).join('');
    $('#insights').innerHTML = `<div class="insight alert"><span class="insight-icon">${icon('alert',19)}</span><span><strong>أولوية المتابعة: ${esc(weakness.name)}</strong><small>أقل نسبة نجاح بين المواد · ${pct(weakness.passRate)} · ${nfmt(weakness.failed,0)} حالة رسوب</small></span></div><div class="insight"><span class="insight-icon">${icon('trophy',19)}</span><span><strong>أعلى تحصيل نسبي: ${esc(strength.name)}</strong><small>متوسط التحصيل ${pct(strength.averageRate)} · نسبة النجاح ${pct(strength.passRate)}</small></span></div>`;
    $('.subject-panel .tiny-badge').textContent=`${nfmt(subjects.length,0)} مواد`;
    $('#subjectChart').innerHTML=subjects.map(s=>`<div class="subject-line"><span class="subject-label" title="${esc(s.name)}">${esc(s.name)}</span><div class="track" title="نسبة النجاح ${pct(s.passRate)}"><div class="track-fill" style="width:${Math.max(0,Math.min(100,s.passRate))}%"></div></div><span class="subject-value">${pct(s.passRate)}</span></div>`).join('')||'<div class="empty-state">أضيفي مواد لهذا الصف من الإعدادات.</div>';
    $('#distribution').innerHTML=categories.map(c=>`<div class="distribution-line"><span class="distribution-name" title="${esc(c.name)}">${esc(c.name)}</span><div class="dist-track"><div class="dist-fill" style="width:${summary.count?c.count/summary.count*100:0}%"></div></div><span class="dist-count">${nfmt(c.count,0)}</span></div>`).join('');
    $('#topStudents').innerHTML=[...students].filter(s=>Number.isFinite(s.percent)).sort((a,b)=>b.percent-a.percent).slice(0,5).map(s=>row(s,false)).join('');
    const supported=students.filter(s=>s.weaknesses?.length).sort((a,b)=>b.weaknesses.length-a.weaknesses.length||a.percent-b.percent);
    const comprehensive=supported.filter(s=>s.weaknesses.length>=gradeModel.criteria.minSupportSubjects);
    const subjectSupport=supported.filter(s=>s.weaknesses.length<gradeModel.criteria.minSupportSubjects);
    const overallWeak=students.filter(s=>Number.isFinite(s.percent)&&Number.isFinite(s.passBenchmark)&&s.percent<s.passBenchmark);
    $('#supportSummary').textContent=`${nfmt(supported.length,0)} سجلًا`;
    $('#supportLists').innerHTML=supported.length?`<div class="support-metrics"><div><span class="support-metric-icon">${icon('alert',17)}</span><span><small>أداء عام دون حد النجاح</small><strong>${nfmt(overallWeak.length,0)}</strong></span></div><div><span class="support-metric-icon subject">${icon('chart',17)}</span><span><small>دعم في مادة أو مواد محددة</small><strong>${nfmt(subjectSupport.length,0)}</strong></span></div><div><span class="support-metric-icon full">${icon('students',17)}</span><span><small>دعم شامل</small><strong>${nfmt(comprehensive.length,0)}</strong></span></div></div><div class="support-roster">${supported.map(s=>`<div class="support-student"><div><button type="button" class="student-link" data-student="${esc(s.id)}">${esc(s.name)}</button><small>${genderWord(s.gender)} · ${esc(s.weaknesses.join('، '))}</small></div><span class="support-kind ${s.weaknesses.length>=gradeModel.criteria.minSupportSubjects?'full':''}">${s.weaknesses.length>=gradeModel.criteria.minSupportSubjects?'دعم شامل':'دعم مادة'}</span><strong class="percent-cell">${pct(s.percent)}</strong></div>`).join('')}</div>`:'<div class="empty-state">لا توجد سجلات مصنفة ضمن الضعف أو الدعم في هذا الصف.</div>';
    $('#footerCount').textContent=nfmt(students.length,0);
    $('#subjectDetails').innerHTML=subjects.map(s=>`<div class="subject-detail"><b>${esc(s.name)}</b><div class="track" title="متوسط التحصيل ${pct(s.averageRate)}"><div class="track-fill" style="width:${Math.min(100,s.averageRate)}%;background:${s.passRate<80?'linear-gradient(90deg,#f7bb69,#e99835)':'linear-gradient(90deg,#72b8ff,#1677f9)'}"></div></div><span class="metric-small"><strong>${pct(s.passRate)}</strong>نسبة النجاح</span><span class="metric-small"><strong>${nfmt(s.average,1)}</strong>متوسط الدرجة</span><span class="metric-small"><strong>${nfmt(s.failed,0)}</strong>راسبات</span></div>`).join('')||'<div class="empty-state">لا توجد مواد في هذا الصف.</div>';
  }

  async function readXlsxZip(file) {
    const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
    let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
    if(eocd<0)throw new Error('الملف لا يبدو مصنف Excel صالحًا.');
    const count=view.getUint16(eocd+10,true),centralStart=view.getUint32(eocd+16,true),files=new Map(),decoder=new TextDecoder();let pos=centralStart;
    for(let i=0;i<count;i++){
      if(view.getUint32(pos,true)!==0x02014b50)throw new Error('تعذر قراءة بنية ملف Excel.');
      const method=view.getUint16(pos+10,true),compressedSize=view.getUint32(pos+20,true),nameLength=view.getUint16(pos+28,true),extraLength=view.getUint16(pos+30,true),commentLength=view.getUint16(pos+32,true),localOffset=view.getUint32(pos+42,true);
      const path=decoder.decode(bytes.subarray(pos+46,pos+46+nameLength));pos+=46+nameLength+extraLength+commentLength;
      if(!path.endsWith('.xml')||path.endsWith('/'))continue;
      const localNameLength=view.getUint16(localOffset+26,true),localExtraLength=view.getUint16(localOffset+28,true),start=localOffset+30+localNameLength+localExtraLength,chunk=bytes.slice(start,start+compressedSize);
      let data;
      if(method===0)data=chunk;
      else if(method===8){if(typeof DecompressionStream==='undefined')throw new Error('متصفحك لا يدعم قراءة ملفات Excel محليًا. استخدمي إصدارًا حديثًا من Chrome أو Edge.');data=new Uint8Array(await new Response(new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());}
      else continue;
      files.set(path,decoder.decode(data));
    }
    return files;
  }
  function xmlDoc(text){const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw new Error('تعذر تحليل أحد أجزاء ملف Excel.');return xml;}
  function nodeText(node){return [...node.getElementsByTagNameNS('*','t')].map(t=>t.textContent||'').join('');}
  function columnNumber(ref){let n=0;for(const ch of ref.match(/^[A-Z]+/i)?.[0]||''){n=n*26+ch.toUpperCase().charCodeAt(0)-64;}return n;}
  async function parseExcelStudents(file){
    if(!gradeModel.subjects.length)throw new Error('أضيفي مواد للصف من الإعدادات قبل استيراد السجلات.');
    const files=await readXlsxZip(file),workbookXml=files.get('xl/workbook.xml'),relsXml=files.get('xl/_rels/workbook.xml.rels');
    if(!workbookXml||!relsXml)throw new Error('لم أجد بنية مصنف Excel داخل الملف.');
    const wbDoc=xmlDoc(workbookXml),relDoc=xmlDoc(relsXml),relationship=new Map([...relDoc.getElementsByTagNameNS('*','Relationship')].map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
    const sheet=[...wbDoc.getElementsByTagNameNS('*','sheet')].find(s=>s.getAttribute('name')==='الجدول');
    if(!sheet)throw new Error('لم أجد ورقة «الجدول» في المصنف.');
    const target=relationship.get(sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
    if(!target)throw new Error('تعذر تحديد ورقة بيانات التلاميذ.');
    const sheetPath=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`;
    const sheetXml=files.get(sheetPath);if(!sheetXml)throw new Error('تعذر فتح ورقة «الجدول».');
    const shared=files.get('xl/sharedStrings.xml');
    const strings=shared?[...xmlDoc(shared).getElementsByTagNameNS('*','si')].map(nodeText):[];
    const doc=xmlDoc(sheetXml),rows=[...doc.getElementsByTagNameNS('*','row')];
    const valueOf=cell=>{
      if(!cell)return '';
      const type=cell.getAttribute('t');
      if(type==='inlineStr'){const inline=cell.getElementsByTagNameNS('*','is')[0];return inline?nodeText(inline):'';}
      const v=cell.getElementsByTagNameNS('*','v')[0]?.textContent??'';
      if(type==='s')return strings[Number(v)]??'';
      if(type==='str'||type==='e')return v;
      if(v==='')return '';
      const num=Number(v);return Number.isFinite(num)?num:v;
    };
    const rowMap=new Map();for(const r of rows){const num=Number(r.getAttribute('r')),cells=new Map();for(const c of [...r.children].filter(x=>x.localName==='c'))cells.set(columnNumber(c.getAttribute('r')),valueOf(c));rowMap.set(num,cells);}
    const header=rowMap.get(2)||new Map(),columns=new Map([...header].map(([col,val])=>[String(val).trim(),col]));
    const nameCol=columns.get('اسم التلميذ')||columns.get('اسم التلميذة')||columns.get('اسم الطالب')||columns.get('اسم الطالبة')||2,idCol=columns.get('معرّف التلميذ')||columns.get('معرّف الطالبة')||columns.get('المعرّف الفريد')||14;
    const genderCol=columns.get('النوع')||columns.get('الجنس')||columns.get('نوع التلميذ')||columns.get('نوع الطالب')||columns.get('النوع الاجتماعي');
    const subjectCols=gradeModel.subjects.map((s,i)=>columns.get(s.name)||3+i);
    const missingSubjects=gradeModel.subjects.filter((s,i)=>!header.has(subjectCols[i]));
    if(missingSubjects.length)throw new Error(`أعمدة مواد مفقودة: ${missingSubjects.map(s=>s.name).join('، ')}.`);
    const parsed=[],seenIds=new Set(),errors=[];
    for(const [rowNum,cells] of rowMap){if(rowNum<4)continue;const rawName=cells.get(nameCol);if(rawName===undefined||String(rawName).trim()==='')continue;
      const studentName=String(rawName).trim(),rawId=cells.get(idCol),id=rawId==null?'':String(rawId).trim();
      const rawGender=genderCol?String(cells.get(genderCol)??'').trim().toLocaleLowerCase('ar'):'';
      let gender;
      if(rawGender){if(['male','m','ذكر','تلميذ','طالب','ولد'].includes(rawGender))gender='male';else if(['female','f','أنثى','انثى','تلميذة','طالبة','بنت'].includes(rawGender))gender='female';else{errors.push(`نوع غير معروف للتلميذ «${studentName}»`);continue;}}
      if(id&&seenIds.has(id)){errors.push(`المعرّف ${id} مكرر في الملف`);continue;}if(id)seenIds.add(id);
      const grades={};let valid=true;
      for(let i=0;i<gradeModel.subjects.length;i++){
        const sub=gradeModel.subjects[i],raw=cells.get(subjectCols[i]),rule=criteria.subjects[sub.name];
        if(raw==='غ'||String(raw).trim()==='غ'){grades[sub.name]='غ';continue;}
        const number=typeof raw==='number'?raw:(String(raw??'').trim()===''?NaN:Number(String(raw).trim().replace(',','.')));
        if(!Number.isFinite(number)||number<0||number>rule.max){errors.push(`درجة غير صالحة لـ${genderWord(gender)} «${studentName}» في ${sub.name}`);valid=false;break;}
        grades[sub.name]=number;
      }
      if(valid)parsed.push({name:studentName,id,gender,gradeId:selectedGradeId,grades});
    }
    if(errors.length)throw new Error(`${errors.slice(0,4).join('؛ ')}${errors.length>4?`، وأخطاء أخرى (${errors.length-4})`:''}. لم تُطبّق أي تغييرات.`);
    if(!parsed.length)throw new Error('لم أجد سجلات تلاميذ قابلة للاستيراد في ورقة «الجدول».');
    return parsed;
  }

  function pill(category) {
    const kind = category.includes('متفوق') || category.includes('متميز في') || category.includes('متفوقة') || category.includes('متميزة في') ? 'top' : category.includes('دعم') ? 'support' : 'good';
    return `<span class="category-pill ${kind}">${esc(category || 'غير مصنفة')}</span>`;
  }
  function personCell(s, detailed=false) {
    return `<div class="student-cell"><span class="mini-avatar">${esc((s.name||'ت').trim().slice(0,1))}</span><span><button type="button" class="student-link" data-student="${esc(s.id)}">${esc(s.name)}</button>${detailed?'':`<span class="student-id">${genderWord(s.gender)} · ${esc(s.id)}</span>`}</span></div>`;
  }
  function row(s, detailed=false) {
    return `<tr><td>${personCell(s,detailed)}</td>${detailed?`<td>${genderWord(s.gender)}</td><td dir="ltr">${esc(s.id)}</td>`:''}<td>${pill(s.category)}</td>${detailed?`<td>${s.weaknesses.length?nfmt(s.weaknesses.length,0):'—'}</td>`:''}<td>${nfmt(s.total,1)}</td><td class="percent-cell">${pct(s.percent)}</td><td class="action-cell"><button class="row-open" data-student="${esc(s.id)}" aria-label="عرض نتائج ${genderWord(s.gender)} ${esc(s.name)}">${icon('chevronLeft',17)}</button>${detailed&&canManageStudents?`<button class="delete-button" data-delete-student="${esc(s.id)}" aria-label="حذف ${esc(s.name)}">${icon('trash',15)} حذف</button>`:''}</td></tr>`;
  }
  function fillGradeSelectors(){
    const options=gradeModels.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
    $('#gradeFilter').innerHTML=options;$('#gradeFilter').value=selectedGradeId;
    $('#gradeAdminSelect').innerHTML=options;$('#gradeAdminSelect').value=selectedGradeId;
  }
  function fillCategoryFilter(){
    const selected=$('#categoryFilter').value;
    const categoryNames=[...new Set(students.map(s=>s.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
    $('#categoryFilter').innerHTML='<option value="">كل التصنيفات</option>'+categoryNames.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if(categoryNames.includes(selected))$('#categoryFilter').value=selected;
  }
  fillGradeSelectors();refreshDashboard();fillCategoryFilter();
  function renderStudents() {
    const q=$('#searchInput').value.trim().toLocaleLowerCase('ar');
    const cat=$('#categoryFilter').value;
    const filtered=students.filter(s=>(!cat||s.category===cat)&&(!q||s.name.toLocaleLowerCase('ar').includes(q)||s.id.toLowerCase().includes(q))).sort((a,b)=>a.index-b.index);
    $('#studentCount').textContent = `عرض ${nfmt(filtered.length,0)} من ${nfmt(students.length,0)} سجلًا`;
    $('#studentRows').innerHTML=filtered.map(s=>row(s,true)).join('');
    $('#emptyState').classList.toggle('hidden',filtered.length!==0);
  }
  $('#searchInput').addEventListener('input',renderStudents);
  $('#categoryFilter').addEventListener('change',renderStudents);
  $('#gradeFilter').addEventListener('change',()=>{selectedGradeId=$('#gradeFilter').value;$('#gradeAdminSelect').value=selectedGradeId;$('#categoryFilter').value='';refreshDashboard();fillCategoryFilter();renderStudents();renderGradeSettings();});
  $('#gradeAdminSelect').addEventListener('change',()=>{selectedGradeId=$('#gradeAdminSelect').value;$('#gradeFilter').value=selectedGradeId;$('#categoryFilter').value='';refreshDashboard();fillCategoryFilter();renderStudents();renderGradeSettings();});
  renderStudents();
  $('#userBadge').innerHTML=`<strong>${esc(CURRENT_USER.displayName)}</strong> · ${esc(CURRENT_USER.roleLabel)}`;
  $('#settingsNav').classList.toggle('hidden',!isSystemAdmin);
  $('#addStudentBtn').classList.toggle('hidden',!canManageStudents);
  $('#importStudentBtn').classList.toggle('hidden',!canManageStudents);
  async function reloadRoster(){const state=await window.APP_API('/api/session');allStudents=state.students;gradeModels=state.grades;D.nextStudentId=state.nextStudentId;if(!gradeModels.some(g=>g.id===selectedGradeId))selectedGradeId=gradeModels[0]?.id||'';fillGradeSelectors();refreshDashboard();fillCategoryFilter();renderStudents();renderGradeSettings();}

  function prepareGradeInputs() {
    $('#gradeInputs').innerHTML=gradeModel.subjects.map((sub,i)=>{
      const max=criteria.subjects[sub.name].max;
      return `<div class="grade-input"><label for="grade-${i}">${esc(sub.name)} <small>/${nfmt(max,0)}</small></label><input id="grade-${i}" type="number" min="0" max="${max}" step="0.5" required aria-label="درجة ${esc(sub.name)}"><label class="absence-label"><input type="checkbox" data-absence="${i}"> غائبة</label></div>`;
    }).join('');
    $('#gradeInputs').querySelectorAll('[data-absence]').forEach(check=>check.addEventListener('change',()=>{
      const input=$(`#grade-${check.dataset.absence}`);input.disabled=check.checked;input.required=!check.checked;if(check.checked)input.value='';
    }));
  }
  function nextStudentId() {
    let max=students.reduce((m,s)=>Math.max(m,Number(String(s.id).match(/(\d+)$/)?.[1]||0)),0)+1;
    let id; do{id=`STU-${String(max++).padStart(4,'0')}`;}while(students.some(s=>s.id===id));
    return id;
  }
  function openAddModal() {
    $('#addForm').reset();$('#formError').textContent='';
    $('#newGender').value=defaultGender();syncAddGenderCopy();
    prepareGradeInputs();$('#newId').value=D.nextStudentId||nextStudentId();
    $('#addModal').classList.remove('hidden');document.body.style.overflow='hidden';$('#newName').focus();
  }
  function closeAddModal(){ $('#addModal').classList.add('hidden');document.body.style.overflow=''; }
  $('#addStudentBtn').addEventListener('click',openAddModal);
  $('#newGender').addEventListener('change',syncAddGenderCopy);
  $('#addForm').addEventListener('submit',async e=>{
    e.preventDefault();$('#formError').textContent='';
    const name=$('#newName').value.trim(),gender=$('#newGender').value;
    if(!name){$('#formError').textContent='أدخلي الاسم.';return;}
    const grades={};
    for(let i=0;i<gradeModel.subjects.length;i++){
      const sub=gradeModel.subjects[i],input=$(`#grade-${i}`),absent=$(`[data-absence="${i}"]`).checked;
      if(absent){grades[sub.name]='غ';continue;}
      const value=Number(input.value),max=criteria.subjects[sub.name].max;
      if(input.value===''||!Number.isFinite(value)||value<0||value>max){$('#formError').textContent=`تحققي من درجة ${sub.name} (من 0 إلى ${nfmt(max,0)}) أو حددي «غائبة».`;input.focus();return;}
      grades[sub.name]=value;
    }
    if(!gradeModel.subjects.length){$('#formError').textContent='أضيفي مواد للصف من الإعدادات قبل إضافة سجل.';return;}
    const student=classifyStudent({index:Math.max(0,...allStudents.map(s=>Number(s.index)||0))+1,name,gender,id:$('#newId').value,gradeId:selectedGradeId,grades});
    try{
      await window.APP_API('/api/students',{method:'POST',body:JSON.stringify(student)});
      await reloadRoster();$('#searchInput').value=name;$('#categoryFilter').value='';renderStudents();
      closeAddModal();view('students');
    }catch(err){$('#formError').textContent=err.message||'تعذر حفظ السجل.';}
  });

  let pendingImport=null;
  $('#importStudentBtn').addEventListener('click',()=>$('#excelFile').click());
  $('#excelFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    pendingImport=null;$('#importError').textContent='';$('#importSummary').textContent='جارٍ قراءة الملف محليًا…';$('#applyImportBtn').disabled=true;$('#importFileName').textContent=file.name;
    $('#importModal').classList.remove('hidden');document.body.style.overflow='hidden';
    try{
      const records=await parseExcelStudents(file),known=new Set(allStudents.filter(s=>s.gradeId===selectedGradeId).map(s=>s.id));
      const updates=records.filter(s=>s.id&&known.has(s.id)).length,adds=records.length-updates;
      pendingImport=records;
      $('#importSummary').innerHTML=`عُثر على <strong>${nfmt(records.length,0)} سجل</strong><ul><li>تحديث سجلات مطابقة بالمعرّف: ${nfmt(updates,0)}</li><li>إضافة سجلات جديدة: ${nfmt(adds,0)}</li><li>لا تُحذف السجلات غير الموجودة في الملف</li></ul>`;
      $('#applyImportBtn').disabled=false;
    }catch(err){$('#importSummary').textContent='لم تُطبّق أي تغييرات.';$('#importError').textContent=err.message||'تعذر قراءة الملف.';}
  });
  $('#applyImportBtn').addEventListener('click',()=>{
    if(!pendingImport)return;
    $('#applyImportBtn').disabled=true;
    window.APP_API('/api/import',{method:'POST',body:JSON.stringify({records:pendingImport})}).then(async result=>{
      await reloadRoster();$('#importSummary').innerHTML=`تم الاستيراد بنجاح<ul><li>سجلات جديدة: ${nfmt(result.added,0)}</li><li>سجلات محدّثة: ${nfmt(result.updated,0)}</li></ul>`;
      setTimeout(closeImportModal,900);
    }).catch(err=>{$('#importError').textContent=err.message||'تعذر تطبيق الاستيراد.';$('#applyImportBtn').disabled=false;});
  });
  function closeImportModal(){ $('#importModal').classList.add('hidden');document.body.style.overflow='';pendingImport=null;$('#excelFile').value=''; }

  async function renderUsers(){
    const data=await window.APP_API('/api/users'),roleLabels={admin:'مشرف النظام',supervisor:'مشرف',viewer:'مستخدم للعرض'};
    $('#userRows').innerHTML=data.users.map(u=>`<tr><td>${esc(u.display_name)}</td><td dir="ltr">${esc(u.username)}</td><td>${esc(roleLabels[u.role]||u.role)}</td><td><span class="user-state ${u.active?'active':'inactive'}">${u.active?'نشط':'معطّل'}</span></td><td><button class="user-action" data-user-active="${u.id}" data-next-active="${u.active?0:1}" ${u.id===data.currentUserId?'disabled':''}>${icon(u.active?'close':'check',15)} ${u.active?'تعطيل':'تفعيل'}</button></td></tr>`).join('');
  }
  function renderGradeSettings(){
    const grade=gradeModels.find(g=>g.id===selectedGradeId);
    if(!grade)return;
    $('#gradeAdminSelect').value=grade.id;$('#gradeFilter').value=grade.id;
    $('#subjectAdminTitle').textContent=`مواد ${grade.name}`;
    $('#subjectAdminCount').textContent=`${nfmt(grade.subjects.length,0)} مواد`;
    $('#subjectAdminRows').innerHTML=grade.subjects.map((subject,index)=>{
      const rule=grade.criteria.subjects[subject.name];
      return `<article class="subject-admin-row"><div><strong>${esc(subject.name)}</strong><small>النهاية ${nfmt(rule.max,1)} درجة · النجاح ${nfmt(rule.passRate,1)}٪ · الضعف ${nfmt(rule.weakRate,1)}٪ · التميز ${nfmt(rule.excellentRate,1)}٪</small></div><button type="button" class="delete-button" data-remove-subject="${index}" aria-label="حذف مادة ${esc(subject.name)}">${icon('trash',15)} حذف</button></article>`;
    }).join('')||'<div class="empty-state">لا توجد مواد في هذا الصف. أضيفي المواد المناسبة له.</div>';
    $('#gradeAdminError').textContent='';
  }
  async function saveGradeSubjects(nextSubjects){
    const grade=gradeModels.find(g=>g.id===selectedGradeId);if(!grade)return;
    const subjectsPayload=nextSubjects.map(subject=>({name:subject.name,...grade.criteria.subjects[subject.name]}));
    await window.APP_API(`/api/grades/${encodeURIComponent(grade.id)}`,{method:'PUT',body:JSON.stringify({name:grade.name,subjects:subjectsPayload})});
    await reloadRoster();
  }
  $('#gradeCreateForm').addEventListener('submit',async e=>{
    e.preventDefault();const name=$('#newGradeName').value.trim();
    try{const result=await window.APP_API('/api/grades',{method:'POST',body:JSON.stringify({name})});selectedGradeId=result.grade.id;$('#newGradeName').value='';await reloadRoster();$('#gradeAdminSelect').value=selectedGradeId;}
    catch(err){$('#gradeAdminError').textContent=err.message||'تعذر إضافة الصف.';}
  });
  $('#subjectCreateForm').addEventListener('submit',async e=>{
    e.preventDefault();const name=$('#newSubjectName').value.trim(),grade=gradeModels.find(g=>g.id===selectedGradeId);
    if(!grade)return;
    if(grade.subjects.some(subject=>subject.name.toLocaleLowerCase('ar')===name.toLocaleLowerCase('ar'))){$('#gradeAdminError').textContent='هذه المادة موجودة بالفعل في الصف.';return;}
    const next=[...grade.subjects.map(s=>({name:s.name})),{name}];
    const subject=next[next.length-1];
    grade.criteria.subjects[name]={max:Number($('#newSubjectMax').value),passRate:Number($('#newSubjectPass').value),weakRate:Number($('#newSubjectWeak').value),excellentRate:Number($('#newSubjectExcellent').value)};
    try{await saveGradeSubjects(next);$('#subjectCreateForm').reset();$('#newSubjectMax').value=100;$('#newSubjectPass').value=50;$('#newSubjectWeak').value=60;$('#newSubjectExcellent').value=90;}
    catch(err){delete grade.criteria.subjects[name];$('#gradeAdminError').textContent=err.message||'تعذرت إضافة المادة.';}
  });
  $('#subjectAdminRows').addEventListener('click',async e=>{
    const button=e.target.closest('[data-remove-subject]');if(!button)return;
    const grade=gradeModels.find(g=>g.id===selectedGradeId);if(!grade)return;
    const index=Number(button.dataset.removeSubject),subject=grade.subjects[index];
    if(!subject||!window.confirm(`ستُخفى مادة ${subject.name} عن هذا الصف. تبقى درجاتها محفوظة ويمكن استعادتها بإضافة المادة بالاسم نفسه. هل تتابعين؟`))return;
    try{await saveGradeSubjects(grade.subjects.filter((_,i)=>i!==index));}
    catch(err){$('#gradeAdminError').textContent=err.message||'تعذر حذف المادة.';}
  });
  function openUserModal(){ $('#userForm').reset();$('#userError').textContent='';$('#userModal').classList.remove('hidden');document.body.style.overflow='hidden';$('#userDisplayName').focus(); }
  function closeUserModal(){ $('#userModal').classList.add('hidden');document.body.style.overflow=''; }
  $('#addUserBtn').addEventListener('click',openUserModal);
  $('#userForm').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.currentTarget,f=new FormData(form),button=form.querySelector('button[type=submit]');button.disabled=true;$('#userError').textContent='';
    try{await window.APP_API('/api/users',{method:'POST',body:JSON.stringify({displayName:String(f.get('displayName')||'').trim(),username:String(f.get('username')||'').trim(),role:f.get('role'),password:f.get('password')})});form.reset();closeUserModal();await renderUsers();}
    catch(err){$('#userError').textContent=err.message||'تعذر إنشاء الحساب.';}
    finally{button.disabled=false;}
  });
  $('#userRows').addEventListener('click',async e=>{
    const button=e.target.closest('[data-user-active]');if(!button)return;
    const active=button.dataset.nextActive==='1';if(!active&&!window.confirm('سيُمنع هذا الحساب من تسجيل الدخول. هل تريدين المتابعة؟'))return;
    button.disabled=true;
    try{await window.APP_API(`/api/users/${button.dataset.userActive}/active`,{method:'PATCH',body:JSON.stringify({active})});await renderUsers();}
    catch(err){button.disabled=false;window.alert(err.message||'تعذر تحديث الحساب.');}
  });
  $('#logoutBtn').addEventListener('click',async()=>{try{await window.APP_API('/api/logout',{method:'POST',body:'{}'});}finally{location.reload();}});

  function showStudent(id) {
    const s=students.find(x=>x.id===id); if(!s)return;
    detailReturnView=currentView==='studentDetail'?detailReturnView:currentView;
    const studentGrade=gradeModels.find(g=>g.id===(s.gradeId||selectedGradeId))||gradeModel;
    $('#detailName').textContent=s.name; $('#detailAvatar').textContent=s.name.trim().slice(0,1); $('#detailId').textContent=s.id; $('#detailGrade').textContent=studentGrade.name;$('#detailGender').textContent=genderWord(s.gender);$('#detailProfileKicker').textContent=`نتائج ${genderWord(s.gender)} والمواد الدراسية`;
    $('#detailCategory').innerHTML=pill(s.category);
    $('#detailStats').innerHTML=`<div class="profile-stat"><small>المجموع</small><strong>${nfmt(s.total,1)}</strong></div><div class="profile-stat"><small>النسبة العامة</small><strong>${pct(s.percent)}</strong></div><div class="profile-stat"><small>حالات الغياب</small><strong>${nfmt(s.absences,0)}</strong></div>`;
    const detailSupport=$('#detailSupport');
    if(s.weaknesses.length){detailSupport.classList.remove('hidden');detailSupport.innerHTML=`<strong>${genderWord(s.gender)==='تلميذ'?'يحتاج':'تحتاج'} إلى ${s.weaknesses.length>=studentGrade.criteria.minSupportSubjects?'دعم شامل':'دعم في مادة محددة'}</strong><span>مواد تحتاج إلى متابعة: ${esc(s.weaknesses.join('، '))}</span>${s.strengths.length?`<span>مواد التميز: ${esc(s.strengths.join('، '))}</span>`:''}`;}else{detailSupport.classList.add('hidden');detailSupport.textContent='';}
    $('#detailResults').innerHTML=studentGrade.subjects.map(sub=>{const value=s.grades[sub.name],rule=studentGrade.criteria.subjects[sub.name];let result,kind='';if(value==='غ'){result='غائبة';kind='absent';}else if(value==null){result='لم تسجل';}else if(value<rule.pass){result='دون حد النجاح';kind='fail';}else if(value<rule.weak){result='تحتاج متابعة';kind='support';}else if(value>=rule.excellent){result='متميزة';kind='good';}else{result='مستقرة';kind='good';}const rate=typeof value==='number'&&rule.max?value/rule.max*100:null;return `<tr><td>${esc(sub.name)}</td><td class="percent-cell">${value==='غ'?'غ':value==null?'—':nfmt(value,1)}</td><td>${nfmt(rule.max,1)}</td><td class="percent-cell">${pct(rate)}</td><td><span class="result-pill ${kind}">${result}</span></td></tr>`;}).join('')||'<tr><td colspan="5" class="empty-state">لا توجد مواد معرفة لهذا الصف.</td></tr>';
    view('studentDetail');
  }
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-student]');if(btn)showStudent(btn.dataset.student);if(e.target.closest('[data-close-add]'))closeAddModal();if(e.target.closest('[data-close-import]'))closeImportModal();if(e.target.closest('[data-close-user]'))closeUserModal();});
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-delete-student]');if(!button)return;
    const label=button.getAttribute('aria-label').replace(/^حذف\s*/, '');
    if(!window.confirm(`سيُحذف سجل ${label} من العرض. هل تريدين المتابعة؟`))return;
    button.disabled=true;
    try{await window.APP_API(`/api/students/${encodeURIComponent(button.dataset.deleteStudent)}`,{method:'DELETE'});await reloadRoster();}
    catch(err){button.disabled=false;window.alert(err.message||'تعذر حذف السجل.');}
  });
  const cumulativeColumns=[['studentIndex','الرقم'],['name','الاسم'],['gender','النوع'],['phone','رقم الاتصال'],['whatsapp','رقم واتساب'],['previousTotal','المجموع السابق'],['previousSchool','المدرسة السابقة'],['fatherOccupation','مهنة الأب'],['motherName','اسم الأم'],['motherOccupation','مهنة الأم'],['address','العنوان'],['transport','وسيلة النقل'],['term1','الفصل الأول'],['term2','الفصل الثاني'],['term3','الفصل الثالث'],['term4','الفصل الرابع']];
  const cumulativeFieldIds={studentIndex:'cumStudentIndex',name:'cumName',gender:'cumGender',grade:'cumGrade',phone:'cumPhone',whatsapp:'cumWhatsapp',previousTotal:'cumPreviousTotal',previousSchool:'cumPreviousSchool',fatherOccupation:'cumFatherOccupation',motherName:'cumMotherName',motherOccupation:'cumMotherOccupation',address:'cumAddress',transport:'cumTransport',term1:'cumTerm1',term2:'cumTerm2',term3:'cumTerm3',term4:'cumTerm4'};
  const cumulativeCanEdit=canManageStudents;
  function setCumulativeForm(record=null){
    selectedCumulativeId=record?.id||'';$('#cumulativeId').value=selectedCumulativeId;
    const defaultGender=$('#cumulativeGenderFilter').value||'female';
    for(const [key,id] of Object.entries(cumulativeFieldIds)){$(`#${id}`).value=record?.[key]??(key==='gender'?defaultGender:key==='grade'?'الصف السادس':'');$(`#${id}`).disabled=!cumulativeCanEdit;}
    if(!record){const kind=$('#cumGender').value;$('#cumStudentIndex').value=Math.max(0,...cumulativeRecords.filter(r=>r.gender===kind&&r.grade===$('#cumGrade').value).map(r=>Number(r.studentIndex)||0))+1;}
    $('#cumulativeFormTitle').textContent=record?`${genderWord(record.gender)} · ${record.name}`:cumulativeCanEdit?'سجل تراكمي جديد':'اختاري سجلًا لعرض بياناته';
    $('#cumulativeSource').textContent=record?.sourceFile?`المصدر: ${record.sourceFile}`:'';
    $('#cumulativeDelete').classList.toggle('hidden',!record||!cumulativeCanEdit);$('#cumulativeSave').classList.toggle('hidden',!cumulativeCanEdit);
    $('#cumulativeNew').classList.toggle('hidden',!cumulativeCanEdit);$('#cumulativeMessage').textContent='';renderCumulativeRows();
  }
  function renderCumulativeRows(){
    const query=$('#cumulativeSearch').value.trim().toLocaleLowerCase('ar'),gender=$('#cumulativeGenderFilter').value;
    const found=cumulativeRecords.filter(r=>(!gender||r.gender===gender)&&(!query||[r.name,r.phone,r.whatsapp,r.previousSchool,r.address].some(v=>String(v||'').toLocaleLowerCase('ar').includes(query))));
    $('#cumulativeCount').textContent=`${nfmt(found.length,0)} من ${nfmt(cumulativeRecords.length,0)} سجل · الصف السادس`;
    $('#cumulativeRows').innerHTML=found.map(r=>`<tr data-cumulative-id="${esc(r.id)}" class="${r.id===selectedCumulativeId?'selected':''}" tabindex="0"><td class="cumulative-index">${nfmt(r.studentIndex,0)}</td><td><button type="button" class="student-link" data-cumulative-open="${esc(r.id)}">${esc(r.name)}</button></td><td>${genderWord(r.gender)}</td><td dir="ltr">${esc(r.phone||'—')}</td><td>${esc(r.previousTotal||'—')}</td><td>${esc(r.previousSchool||'—')}</td></tr>`).join('');
    $('#cumulativeEmpty').classList.toggle('hidden',found.length>0);
  }
  async function loadCumulative(force=false){
    if(cumulativeLoaded&&!force){renderCumulativeRows();return;}
    try{const data=await window.APP_API('/api/cumulative');cumulativeRecords=Array.isArray(data.records)?data.records:[];}
    catch(err){if(Array.isArray(D.cumulativeRecords)){cumulativeRecords=D.cumulativeRecords;}else{$('#cumulativeMessage').textContent=err.message||'تعذر تحميل السجل التراكمي.';return;}}
    cumulativeLoaded=true;renderCumulativeRows();
  }
  $('#cumulativeSearch').addEventListener('input',renderCumulativeRows);$('#cumulativeGenderFilter').addEventListener('change',renderCumulativeRows);
  $('#cumulativeRows').addEventListener('click',e=>{const row=e.target.closest('[data-cumulative-id]');if(!row)return;const record=cumulativeRecords.find(r=>r.id===row.dataset.cumulativeId);if(record)setCumulativeForm(record);});
  $('#cumulativeRows').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-cumulative-id]')){e.preventDefault();e.target.closest('[data-cumulative-id]').click();}});
  $('#cumulativeNew').addEventListener('click',()=>setCumulativeForm());
  $('#cumGender').addEventListener('change',()=>{if(!selectedCumulativeId){const kind=$('#cumGender').value;$('#cumStudentIndex').value=Math.max(0,...cumulativeRecords.filter(r=>r.gender===kind&&r.grade===$('#cumGrade').value).map(r=>Number(r.studentIndex)||0))+1;}});
  $('#cumulativeForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!cumulativeCanEdit)return;const payload={id:$('#cumulativeId').value||undefined,studentIndex:Number(cumulativeRecords.find(r=>r.id===selectedCumulativeId)?.studentIndex)||0};
    for(const [key,id] of Object.entries(cumulativeFieldIds))payload[key]=$(`#${id}`).value.trim();
    const save=$('#cumulativeSave');save.disabled=true;$('#cumulativeMessage').textContent='';
    try{const result=await window.APP_API('/api/cumulative',{method:'POST',body:JSON.stringify(payload)});await loadCumulative(true);const record=cumulativeRecords.find(r=>r.id===result.id);setCumulativeForm(record);$('#cumulativeMessage').textContent='تم حفظ السجل بنجاح.';}
    catch(err){$('#cumulativeMessage').textContent=err.message||'تعذر حفظ السجل.';}finally{save.disabled=false;}
  });
  $('#cumulativeDelete').addEventListener('click',async()=>{
    const record=cumulativeRecords.find(r=>r.id===selectedCumulativeId);if(!record||!cumulativeCanEdit)return;
    if(!window.confirm(`سيُحذف سجل ${record.name} من السجل التراكمي. هل تريد المتابعة؟`))return;
    try{await window.APP_API(`/api/cumulative/${encodeURIComponent(record.id)}`,{method:'DELETE'});cumulativeRecords=cumulativeRecords.filter(r=>r.id!==record.id);setCumulativeForm();$('#cumulativeMessage').textContent='تم حذف السجل.';}
    catch(err){$('#cumulativeMessage').textContent=err.message||'تعذر حذف السجل.';}
  });
  $('#cumulativeExport').addEventListener('click',()=>{
    const rows=cumulativeRecords.filter(r=>{const g=$('#cumulativeGenderFilter').value,q=$('#cumulativeSearch').value.trim().toLocaleLowerCase('ar');return(!g||r.gender===g)&&(!q||[r.name,r.phone,r.whatsapp,r.previousSchool,r.address].some(v=>String(v||'').toLocaleLowerCase('ar').includes(q)));});
    const headers=cumulativeColumns.map(([,label])=>label),csvValue=v=>{let text=String(v??'');if(/^[=+@\-]/.test(text))text="'"+text;return `"${text.replaceAll('"','""')}"`;};
    const csv='\ufeff'+[headers,...rows.map(r=>cumulativeColumns.map(([key])=>key==='gender'?genderWord(r[key]):r[key]??''))].map(row=>row.map(csvValue).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='السجل_التراكمي_الصف_السادس.csv';a.click();URL.revokeObjectURL(a.href);
  });
  setCumulativeForm();
  function closeModal(){ }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAddModal();closeImportModal();closeUserModal();if(currentView==='studentDetail')view(detailReturnView);}});

  function view(which) {
    const group=pluralGender(),pronoun=genderPronoun();
    const names={overview:'نظرة عامة',students:group,cumulative:'السجل التراكمي',subjects:'تحليل المواد',settings:'الإعدادات',studentDetail:`نتائج ${genderWord($('#detailGender').textContent==='تلميذ'?'male':'female')}`};
    ['overview','students','cumulative','subjects','settings','studentDetail'].forEach(v=>document.getElementById(`${v}View`).classList.toggle('hidden',v!==which));
    currentView=which;
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===which));
    $('#crumb').textContent=names[which];
    $('#pageTitle').textContent=which==='overview'?'صورة واضحة عن الأداء.':which==='students'?`دليل ${group} ونتائج${pronoun} في لمحة.`:which==='cumulative'?'بيانات الطالب عبر السجل السابق والفصول الدراسية.':which==='subjects'?'مقارنة تساعد على تحديد الأولويات.':which==='studentDetail'?$('#detailName').textContent:'إدارة الوصول إلى التطبيق.';
    $('#pageSub').textContent=which==='overview'?`ملخص نتائج ${group} ومؤشرات التحصيل في مكان واحد.`:which==='students'?'ابحث بالاسم أو المعرّف، واختر الاسم لعرض النتائج التفصيلية.':which==='cumulative'?'ابحث في سجل الصف السادس، واستعرض بيانات الأسرة والمدرسة والفصول.':which==='subjects'?'نسب النجاح ومتوسطات الدرجات لكل مادة.':which==='studentDetail'?'النتيجة العامة والدرجات والتقدير في كل مادة.':'إنشاء حسابات المشرفين والمستخدمين وتفعيلها أو تعطيلها.';
    if(which==='cumulative')loadCumulative().catch(err=>{$('#cumulativeMessage').textContent=err.message||'تعذر تحميل السجل التراكمي.';});
    if(which==='settings'&&isSystemAdmin){renderGradeSettings();renderUsers().catch(err=>{$('#userRows').innerHTML=`<tr><td colspan="5">${esc(err.message)}</td></tr>`});}
    window.scrollTo({top:0,behavior:'smooth'});
  }
  document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
  document.querySelectorAll('[data-go="students"]').forEach(b=>b.addEventListener('click',()=>view('students')));
  $('#detailBackBtn').addEventListener('click',()=>view(detailReturnView));
  $('#exportBtn').addEventListener('click',()=>{
    const header=['م','الاسم','النوع','المعرّف','التصنيف الشامل',...subjects.map(s=>s.name),'المجموع','النسبة %','مواد الضعف'];
    const rows=students.map(s=>[s.index,s.name,genderWord(s.gender),s.id,s.category,...subjects.map(x=>s.grades[x.name]??''),s.total,Number.isFinite(s.percent)?s.percent.toFixed(2):'',s.weaknesses.join('، ')]);
    const csv='\ufeff'+[header,...rows].map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`نتائج_${pluralGender()}.csv`;a.click();URL.revokeObjectURL(a.href);
  });
  function syncThemeIcon(){ $('#themeBtn').innerHTML=icon(document.body.classList.contains('dark')?'sun':'moon',18); }
  syncThemeIcon();
  $('#themeBtn').addEventListener('click',()=>{document.body.classList.toggle('dark');syncThemeIcon();});
})();

