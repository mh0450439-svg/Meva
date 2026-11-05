(() => {
  'use strict';
  const root=document.getElementById('authRoot'),shell=document.getElementById('appShell');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request=async(path,options={})=>{
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
    let data={};try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data.error||'تعذر إكمال الطلب.')
    return data;
  };
  window.APP_API=request;
  async function boot(){
    try{
      const data=await request('/api/session');
      window.RESULTS_DATA=data;window.CURRENT_USER=data.user;
      root.classList.add('hidden');shell.classList.remove('hidden');
      const app=document.createElement('script');app.src='/app.js';app.onerror=()=>{root.classList.remove('hidden');root.innerHTML='<div class="auth-card"><h1>تعذر تحميل الواجهة</h1><p>أعيدي تشغيل التطبيق ثم حاولي مرة أخرى.</p></div>';shell.classList.add('hidden')};document.body.appendChild(app);
    }catch{
      try{const status=await request('/api/setup-status');showAuth(status.needsSetup)}
      catch{showServerError()}
    }
  }
  function showServerError(){
    root.classList.remove('hidden');root.innerHTML=`<section class="auth-card"><div class="auth-mark" aria-hidden="true">${window.APP_ICON('brand',30)}</div><p class="auth-eyebrow">القياس والتقويم</p><h1>تعذر الاتصال بالتطبيق</h1><p class="auth-subtitle">شغّلي التطبيق من ملف <b>start_app.ps1</b> ثم افتحي الصفحة التي تظهر.</p></section>`;
  }
  function showAuth(needsSetup){
    const form=needsSetup?`<p class="auth-eyebrow">إعداد أول مرة</p><h1>أنشئي حساب مشرف النظام.</h1><p class="auth-subtitle">سيكون هذا الحساب مسؤولًا عن إضافة المشرفين وإدارة صلاحياتهم.</p><p class="demo-warning">نسخة تجريبية عامة: لا تدخلي بيانات طلاب حقيقية.</p><form id="authForm"><label class="form-field">اسمك الظاهر<input name="displayName" required maxlength="100" autocomplete="name"></label><label class="form-field">اسم المستخدم<input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.-]+" autocomplete="username"></label><label class="form-field">كلمة المرور<input name="password" type="password" required minlength="12" autocomplete="new-password"><small>12 حرفًا على الأقل</small></label><div id="authError" class="form-error" role="alert"></div><button class="primary-button auth-submit" type="submit">إنشاء حساب المشرف</button></form>`:`<p class="auth-eyebrow">مساحة العمل الآمنة</p><h1>مرحبًا بعودتك.</h1><p class="auth-subtitle">سجّلي الدخول لمتابعة النتائج وإدارة السجلات وفق صلاحيتك.</p><p class="demo-warning">نسخة تجريبية عامة: لا تدخلي بيانات طلاب حقيقية.</p><form id="authForm"><label class="form-field">اسم المستخدم<input name="username" required autocomplete="username"></label><label class="form-field">كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label><div id="authError" class="form-error" role="alert"></div><button class="primary-button auth-submit" type="submit">تسجيل الدخول</button></form>`;
    root.classList.remove('hidden');root.innerHTML=`<section class="auth-card"><div class="auth-mark" aria-hidden="true">${window.APP_ICON('brand',30)}</div><div class="auth-brand">منظومة النتائج <span>• القياس والتقويم</span></div>${form}<div class="auth-foot"><span class="live-dot"></span> الدخول محمي • البيانات محفوظة على هذا الجهاز</div></section>`;
    document.getElementById('authForm').addEventListener('submit',async e=>{
      e.preventDefault();const form=e.currentTarget,f=new FormData(form),error=document.getElementById('authError'),button=form.querySelector('button[type=submit]');button.disabled=true;error.textContent='';
      try{
        await request(needsSetup?'/api/setup':'/api/login',{method:'POST',body:JSON.stringify({displayName:f.get('displayName'),username:f.get('username'),password:f.get('password')})});
        form.reset();
        await boot();
      }catch(err){error.textContent=err.message;button.disabled=false;}
    });
  }
  boot();
})();
