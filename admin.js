const armiagClient = window.armiagSupabase;
const BUCKET = 'armiag-media';
const loginScreen = document.querySelector('#loginScreen');
const adminShell = document.querySelector('#adminShell');
const loginMessage = document.querySelector('#loginMessage');
const notice = document.querySelector('#adminNotice');
const state = { user: null, products: [], orders: [], homepage: [], appearance: { settings: {}, is_published: false }, currentView: 'overview' };
const SECTION_DEFAULTS = [
  { id: 'hero', title: 'Hero section', heading: 'Presence in every moment.', body: 'A considered world of fragrance. Discover the collection and find a scent that feels entirely your own.', button_label: 'Shop now', button_url: '#collection', hasImage: true },
  { id: 'hero_2', title: 'Hero slide 2', heading: 'Your second headline', body: 'A short line about this fragrance or offer.', button_label: 'Shop now', button_url: '#collection', hasImage: true },
  { id: 'collection', title: 'Collection introduction', heading: 'Quietly unforgettable.', body: 'Discover the fragrances of Armiag.', button_label: 'View the collection', button_url: '#collection' },
  { id: 'story', title: 'Brand story', heading: 'Made to leave a feeling.', body: 'Armiag is a study in presence: considered objects, personal rituals and the memories that linger. Our story is still being written, and this is its first chapter.', button_label: 'Discover our story', button_url: '#about', hasImage: true },
  { id: 'quote', title: 'Quote section', heading: 'Fragrance is the art of being remembered without saying a word.', body: 'Armiag · The art of scent', hasImage: true },
  { id: 'banner', title: 'Announcement bar (offers)', heading: 'A considered world of fragrance · Discover Armiag', button_label: '', button_url: '', hasImage: false }
];
const ORDER_STATUSES = ['pending','confirmed','processing','shipped','delivered','cancelled'];
const DELIVERY_STATUSES = ['not_shipped','in_transit','delivered','exception'];
const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(Number(value)||0);
function showNotice(message, isError = false) { notice.textContent = message; notice.className = `notice show${isError ? ' error' : ''}`; clearTimeout(showNotice.timer); showNotice.timer = setTimeout(() => notice.classList.remove('show'), 5000); }
function friendlyError(error) { return error?.message || 'Something went wrong. Please try again.'; }
function setBusy(element, busy) { if (!element) return; element.disabled = busy; element.classList.toggle('loading-overlay',busy); }
function publicUrl(path) { return armiagClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
function fileExtension(file) { return (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg'; }
async function optimizeHeroImage(file) {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch (error) { return file; }
}
async function uploadImage(file, folder) {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('Choose an image file smaller than 10 MB.');
  const isHomepage = folder.startsWith('homepage/');
  if (isHomepage) file = await optimizeHeroImage(file);
  const path = `${folder}/${crypto.randomUUID()}.${fileExtension(file)}`;
  const { error } = await armiagClient.storage.from(BUCKET).upload(path,file,{cacheControl:isHomepage?'31536000':'3600',upsert:false,contentType:file.type});
  if (error) throw error;
  return { path, url: publicUrl(path) };
}
async function requireAdmin(user) {
  if (!user) return false;
  const { data, error } = await armiagClient.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
async function cleararmiagClientSession() {
  try { await armiagClient.auth.signOut(); }
  catch (error) { console.error('Could not clear the armiagClient session cleanly.',error); }
}
async function enterAdmin(user) {
  loginMessage.textContent = 'Signed in. Checking administrator permissions…';
  let allowed;
  try {
    allowed = await requireAdmin(user);
  } catch (error) {
    await cleararmiagClientSession();
    loginScreen.hidden = false;
    adminShell.hidden = true;
    loginMessage.textContent = adminCheckError(error);
    return;
  }
  if (!allowed) {
    await cleararmiagClientSession();
    loginScreen.hidden = false;
    adminShell.hidden = true;
    loginMessage.textContent = 'This account signed in, but it is not listed in Armiag admin_users. Check that the correct Auth account was granted admin access.';
    return;
  }
  state.user = user;
  loginScreen.hidden = true;
  adminShell.hidden = false;
  $('#adminEmail').textContent = user.email || 'Administrator';
  notice.textContent = 'Signed in. Loading dashboard data…';
  notice.className = 'notice show';
  await loadAll();
}
function adminCheckError(error) {
  const code=String(error?.code||'');
  if(code==='PGRST205'||/admin_users.*(not found|does not exist)/i.test(error?.message||''))return 'Could not find the admin_users table. Confirm the Armiag database migration has been run in this armiagClient project.';
  if(code==='42501'||/permission denied|row-level security/i.test(error?.message||''))return 'armiagClient blocked the administrator check. Confirm the admin_users SELECT grant and RLS policy are installed.';
  return `Could not verify administrator access: ${friendlyError(error)} Check the project connection and admin_users RLS setup.`;
}
function authErrorMessage(error) {
  const message=String(error?.message||'');
  if(/invalid login credentials/i.test(message))return 'Email or password was not accepted. Check the armiagClient Auth user and password.';
  if(/email not confirmed/i.test(message))return 'This email is not confirmed yet. Confirm it in armiagClient Authentication, then try again.';
  if(/fetch|network|failed to connect/i.test(message))return 'Could not reach armiagClient Auth. Check your internet connection and project URL.';
  if(/api key|apikey/i.test(message))return 'armiagClient rejected the publishable key. Check armiagClient-config.js and the key in Project Settings.';
  return `Sign-in failed: ${message||'armiagClient returned an unknown error.'}`;
}
window.addEventListener('error',event=>{
  const message=event.message||'A browser JavaScript error occurred.';
  console.error('Armiag admin browser error.',event.error||message);
  if(!state.user)loginMessage.textContent=`The admin page encountered a JavaScript error: ${message}`;
  else showNotice(`Dashboard script error: ${message}`,true);
});
window.addEventListener('unhandledrejection',event=>{
  const message=friendlyError(event.reason);
  console.error('Armiag admin request failed unexpectedly.',event.reason);
  if(!state.user)loginMessage.textContent=`A sign-in request failed: ${message}`;
  else showNotice(`A dashboard request failed unexpectedly: ${message}`,true);
});
if (!armiagClient) {
  loginMessage.textContent = window.ARMIAG_armiagClient_STATUS?.message || 'armiagClient did not load. Check your internet connection and project configuration.';
  $('#loginForm button').disabled = true;
} else {
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); loginMessage.textContent = '';
    const button = $('button[type="submit"]',event.currentTarget);button.dataset.label ||= button.innerHTML;button.textContent='Signing in…';setBusy(button,true);
    const form = new FormData(event.currentTarget);
    loginMessage.textContent = 'Connecting to armiagClient Auth…';
    try {
      const { data, error } = await armiagClient.auth.signInWithPassword({email:form.get('email'),password:form.get('password')});
      if (error) { loginMessage.textContent = authErrorMessage(error); return; }
      await enterAdmin(data.user);
    } catch (error) {
      loginMessage.textContent = authErrorMessage(error);
    } finally { button.innerHTML=button.dataset.label;setBusy(button,false); }
  });
  armiagClient.auth.getSession().then(({data,error}) => {
    if(error){loginMessage.textContent=`Could not restore your armiagClient session: ${friendlyError(error)}`;return;}
    if(data.session)enterAdmin(data.session.user);
  }).catch(error=>{loginMessage.textContent=`Could not check the saved armiagClient session: ${friendlyError(error)}`;});
  armiagClient.auth.onAuthStateChange((event) => {
    if(event === 'SIGNED_OUT'){state.user=null;adminShell.hidden=true;loginScreen.hidden=false;}
  });
}

async function loadAll() {
  const results = await Promise.allSettled([loadProducts(),loadOrders(),loadHomepage(),loadAppearance()]);
  const failures = results.filter(result=>result.status==='rejected');
  const statsResult=await loadStats().then(()=>null).catch(error=>error);
  if(statsResult)failures.push({reason:statsResult});
  if(failures.length)showNotice(`You are signed in as an administrator, but some dashboard data could not be loaded: ${friendlyError(failures[0].reason)} Check that the existing tables, grants and RLS policies are installed.`,true);
  else notice.classList.remove('show','error');
}
async function loadProducts() {
  const {data,error}=await armiagClient.from('products').select('id,name,description,concentration,size_ml,price_inr,stock_quantity,is_active,fragrance_details,product_variants(id,size_ml,price_inr,stock_quantity,is_active),product_images(id,image_url,storage_path,alt_text,sort_order)').order('created_at',{ascending:false});
  if(error)throw error;
  state.products=data||[];renderProducts();
}
async function loadStats() {
  const [all,active,orders,pending]=await Promise.all([
    armiagClient.from('products').select('id',{count:'exact',head:true}),
    armiagClient.from('products').select('id',{count:'exact',head:true}).eq('is_active',true),
    armiagClient.from('customer_orders').select('id',{count:'exact',head:true}),
    armiagClient.from('customer_orders').select('id',{count:'exact',head:true}).in('order_status',['pending','processing'])
  ]);
  for(const result of [all,active,orders,pending])if(result.error)throw result.error;
  $('#statProducts').textContent=all.count??0;$('#statAvailable').textContent=active.count??0;$('#statOrders').textContent=orders.count??0;$('#statPending').textContent=pending.count??0;
}
function renderProducts() {
  const target=$('#productsTable');
  if(!state.products.length){target.innerHTML='<tr><td colspan="5" class="empty-panel">No products yet. Add your first fragrance to get started.</td></tr>';return;}
  target.innerHTML=state.products.map(product=>{
    const image=product.product_images?.slice().sort((a,b)=>a.sort_order-b.sort_order)[0]?.image_url||'';
    const allVariants=product.product_variants||[];
    const variants=allVariants.filter(v=>v.is_active).sort((a,b)=>a.size_ml-b.size_ml);
    const edition=[product.concentration,variants.length?variants.map(v=>`${v.size_ml} ml`).join(' / '):(product.size_ml?`${product.size_ml} ml`:null)].filter(Boolean).join(' · ');
    const priceText=variants.length?variants.map(v=>`${v.size_ml} ml: ${money(v.price_inr)}`).join('<br>'):money(product.price_inr);
    const stock=allVariants.length?variants.reduce((sum,v)=>sum+(Number(v.stock_quantity)||0),0):Number(product.stock_quantity)||0;
    return `<tr><td><div class="product-cell">${image?`<img class="product-thumb" src="${escapeHtml(image)}" alt="">`:'<div class="product-thumb"></div>'}<div><span class="product-title">${escapeHtml(product.name)}</span><span class="product-subtitle">${escapeHtml(edition)}</span></div></div></td><td>${priceText}</td><td class="${stock<5?'stock-low':''}">${stock}</td><td><span class="status-pill${product.is_active?'':' off'}">${product.is_active?'Active':'Hidden'}</span></td><td><div class="row-actions"><button class="small-action" data-edit-product="${product.id}">Edit</button><button class="small-action" data-toggle-product="${product.id}">${product.is_active?'Deactivate':'Activate'}</button><button class="small-action danger" data-delete-product="${product.id}">Delete</button></div></td></tr>`;
  }).join('');
}
async function loadOrders() {
  const {data,error}=await armiagClient.from('customer_orders').select('id,customer_name,customer_email,customer_phone,delivery_address,subtotal_inr,payment_status,order_status,delivery_status,created_at,order_items(product_name,size_ml,quantity,unit_price_inr)').order('created_at',{ascending:false});
  if(error)throw error;
  state.orders=data||[];renderOrders();renderRecentOrders();
}
function renderRecentOrders() {
  const rows=state.orders.slice(0,5);
  $('#recentOrders').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>TOTAL</th><th>STATUS</th><th>DATE</th></tr></thead><tbody>${rows.map(order=>`<tr><td>#${escapeHtml(order.id.slice(0,8).toUpperCase())}</td><td>${escapeHtml(order.customer_name)}</td><td>${money(order.subtotal_inr)}</td><td><span class="status-pill${order.order_status==='cancelled'?' off':''}">${escapeHtml(order.order_status)}</span></td><td>${new Date(order.created_at).toLocaleDateString('en-IN')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-panel">No orders have been recorded yet.</div>';
}
function optionList(values,current){return values.map(value=>`<option value="${value}"${value===current?' selected':''}>${value.replaceAll('_',' ')}</option>`).join('')}
function renderOrders() {
  const target=$('#ordersTable');
  if(!state.orders.length){target.innerHTML='<tr><td colspan="7" class="empty-panel">No orders are in the database yet.</td></tr>';return;}
  target.innerHTML=state.orders.map(order=>`<tr><td>#${escapeHtml(order.id.slice(0,8).toUpperCase())}<span class="product-subtitle">${new Date(order.created_at).toLocaleDateString('en-IN')}</span></td><td>${escapeHtml(order.customer_name)}<span class="product-subtitle">${escapeHtml(order.customer_email)}</span></td><td>${money(order.subtotal_inr)}</td><td><span class="status-pill${order.payment_status==='paid'?'':' off'}">${escapeHtml(order.payment_status)}</span></td><td><select class="select-status" data-order-field="order_status" data-order-id="${order.id}">${optionList(ORDER_STATUSES,order.order_status)}</select></td><td><select class="select-status" data-order-field="delivery_status" data-order-id="${order.id}">${optionList(DELIVERY_STATUSES,order.delivery_status)}</select></td><td><button class="small-action" data-view-order="${order.id}">Details</button></td></tr>`).join('');
}
function renderOrderDetail(order) {
  const addressData = order.delivery_address || {};

const addressHtml = typeof addressData === 'string'
  ? escapeHtml(addressData).replace(/\n/g, '<br>')
  : [
      ['House / Building', addressData.house],
      ['Street / Locality', addressData.street],
      ['City / Town', addressData.city],
      ['District', addressData.district],
      ['State', addressData.state],
      ['PIN Code', addressData.pincode],
      ['Landmark', addressData.landmark]
    ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<strong>${label}:</strong> ${escapeHtml(value)}`)
    .join('<br>') || 'Address not provided';
  $('#orderDetail').hidden=false;
  $('#orderDetail').innerHTML=`<div class="panel-heading"><div><span class="eyebrow">ORDER DETAILS</span><h3>#${escapeHtml(order.id.toUpperCase())}</h3></div><button class="icon-button" id="closeOrderDetail" aria-label="Close details">×</button></div><div class="order-detail-grid"><div><strong>Customer and delivery</strong><p>${escapeHtml(order.customer_name)}<br>${escapeHtml(order.customer_email)}<br>${escapeHtml(order.customer_phone)}<br><br>${addressHtml}</p><strong>Payment status</strong><p>${escapeHtml(order.payment_status)} (read-only until a payment service is connected)</p></div><div><strong>Items</strong><ul class="order-items-list">${(order.order_items||[]).map(item=>`<li>${escapeHtml(item.product_name)} · ${escapeHtml(item.size_ml)} ml × ${escapeHtml(item.quantity)} — ${money(item.unit_price_inr)}</li>`).join('')||'<li>No line items recorded.</li>'}</ul><p>Subtotal: <strong>${money(order.subtotal_inr)}</strong></p></div></div>`;
  $('#orderDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function changeOrderStatus(select) {
  const order=state.orders.find(item=>item.id===select.dataset.orderId);
  const nextStatus=select.value;
  if(order?.order_status==='cancelled'&&nextStatus!=='cancelled'){
    showNotice('Cancelled orders cannot be reopened from the dashboard.',true);
    await loadOrders();
    return;
  }
  if(select.dataset.orderField==='order_status'&&nextStatus==='cancelled'){
    const {data,error}=await armiagClient.rpc('cancel_armiag_order',{p_order_id:select.dataset.orderId});
    if(error){showNotice(`Order was not cancelled: ${friendlyError(error)}`,true);await loadOrders();return;}
    showNotice(data?.already_cancelled
      ?'Order was already cancelled; stock was not restored again.'
      :'Order cancelled and stock restored.');
    await loadOrders();await loadStats();
    return;
  }
  const {error}=await armiagClient.from('customer_orders').update({[select.dataset.orderField]:select.value,updated_at:new Date().toISOString()}).eq('id',select.dataset.orderId);
  if(error){showNotice(friendlyError(error),true);await loadOrders();return;}
  showNotice('Order status saved.');await loadOrders();await loadStats();
}

async function loadHomepage() {
  const {data,error}=await armiagClient.from('homepage_content').select('*').order('id');if(error)throw error;
  state.homepage=(data||[]).map(row=>{const d=SECTION_DEFAULTS.find(section=>section.id===row.id)||{};const merged={...d,...row};if(row.id==='hero'&&!row.is_published){for(const k of ['heading','body','button_label','button_url']){if(!String(row[k]??'').trim()&&d[k])merged[k]=d[k];}}return merged;});
  renderHomepage();
}
function renderHomepage() {
  const sections=SECTION_DEFAULTS.map(def=>state.homepage.find(row=>row.id===def.id)||{...def,is_visible:true,is_published:true,image_url:''});
  $('#homepageEditor').innerHTML=sections.map(section=>{const def=SECTION_DEFAULTS.find(item=>item.id===section.id);return `<form class="content-card homepage-card" data-section-id="${escapeHtml(section.id)}"><span class="eyebrow">HOMEPAGE SECTION</span><h3>${escapeHtml(section.title)}</h3>${section.image_url?`<img class="content-preview" src="${escapeHtml(section.image_url)}" alt="Current section image">`:''}<div class="form-grid"><label>Heading<input name="heading" value="${escapeHtml(section.heading||'')}" maxlength="240"></label>${def.hasImage?`<label>Small label above heading<input name="eyebrow" value="${escapeHtml(section.eyebrow||'')}" maxlength="60" placeholder="Leave empty to hide"></label>`:''}${def.button_label!==undefined?`<label>Button label<input name="button_label" value="${escapeHtml(section.button_label||'')}" maxlength="80"></label>`:''}<label class="full-field">Text<textarea name="body" rows="3" maxlength="2000">${escapeHtml(section.body||'')}</textarea></label>${def.button_url!==undefined?`<label>Button destination<input name="button_url" value="${escapeHtml(section.button_url||'')}" placeholder="#collection"></label>`:''}${def.hasImage?`<label>Section photograph<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><small>Maximum 10 MB. Leave empty to keep the current photo.</small></label>`:''}${def.hasImage?`<label>Mobile photograph (portrait, 1080x1920)<input name="mobile_image" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><small>${section.mobile_image_url?'Mobile photo is set. Choose a file to replace it.':'Optional. Without it, phones show the main photograph.'}</small></label>${section.mobile_image_url?`<label class="publish-toggle"><input type="checkbox" name="remove_mobile_image"> Remove mobile photo</label>`:''}`:''}</div><div class="content-card-actions"><div><label class="publish-toggle"><input type="checkbox" name="is_visible"${section.is_visible?' checked':''}> Visible</label><label class="publish-toggle"><input type="checkbox" name="is_published"${section.is_published?' checked':''}> Published</label></div><button class="button button-dark" type="submit">Save section</button></div></form>`}).join('');
}
function triggerSiteRebuild() {
  const hook=window.ARMIAG_SUPABASE_CONFIG?.buildHookUrl;if(!hook)return;
  fetch(hook,{method:'POST',mode:'no-cors'}).catch(()=>{});
}
async function saveHomepageSection(form) {
  const id=form.dataset.sectionId;const defaults=SECTION_DEFAULTS.find(section=>section.id===id);const existing=state.homepage.find(section=>section.id===id)||{};const data=new FormData(form);
  let imageUrl=existing.image_url||'';let mobileUrl=existing.mobile_image_url||'';
  const image=data.get('image');
  if(image?.size){const uploaded=await uploadImage(image,`homepage/${id}`);imageUrl=uploaded.url;}
  const mobileImage=data.get('mobile_image');
  if(mobileImage?.size){const uploadedMobile=await uploadImage(mobileImage,`homepage/${id}-mobile`);mobileUrl=uploadedMobile.url;}
  if(data.has('remove_mobile_image'))mobileUrl='';
  const row={id,heading:String(data.get('heading')||''),body:String(data.get('body')||''),button_label:String(data.get('button_label')||''),button_url:String(data.get('button_url')||''),image_url:imageUrl,mobile_image_url:mobileUrl,is_visible:data.has('is_visible'),is_published:data.has('is_published'),updated_at:new Date().toISOString()};
  if(id==='hero'&&imageUrl){row.image_visible=true;row.image_published=true;}
  if(data.has('eyebrow'))row.eyebrow=String(data.get('eyebrow')||'').trim();
  if(!defaults)throw new Error('Unknown homepage section.');
  const {error}=await armiagClient.from('homepage_content').upsert(row,{onConflict:'id'});if(error)throw error;
  triggerSiteRebuild();
  showNotice(`${defaults.title} saved to armiagClient.`);await loadHomepage();
}
async function loadAppearance() {
  const {data,error}=await armiagClient.from('appearance_settings').select('settings,is_published').eq('id',true).maybeSingle();if(error)throw error;
  state.appearance=data||{settings:{},is_published:false};fillAppearance();
}
function fillAppearance() {
  const form=$('#appearanceForm'),s=state.appearance.settings||{};
  form.elements.logoText.value=s.logoText||'Armiag';form.elements.headingFont.value=s.headingFont||'Italiana';form.elements.bodyFont.value=s.bodyFont||'DM Sans';
  form.elements.inkColor.value=s.inkColor||'#171715';form.elements.paperColor.value=s.paperColor||'#f5f2eb';form.elements.accentColor.value=s.accentColor||'#b69b68';
  form.elements.inkText.value=form.elements.inkColor.value;form.elements.paperText.value=form.elements.paperColor.value;form.elements.accentText.value=form.elements.accentColor.value;
  form.elements.is_published.checked=Boolean(state.appearance.is_published||Object.keys(s).length===0);
}
async function saveAppearance(form) {
  const data=new FormData(form);const old=state.appearance.settings||{};let logoUrl=old.logoUrl||'';const file=data.get('logoFile');
  if(file?.size){const uploaded=await uploadImage(file,'brand');logoUrl=uploaded.url;}
  const settings={logoText:String(data.get('logoText')||'Armiag').trim()||'Armiag',logoUrl,inkColor:String(data.get('inkColor')),paperColor:String(data.get('paperColor')),accentColor:String(data.get('accentColor')),headingFont:String(data.get('headingFont')),bodyFont:String(data.get('bodyFont'))};
  const {error}=await armiagClient.from('appearance_settings').upsert({id:true,settings,is_published:data.has('is_published'),updated_at:new Date().toISOString()},{onConflict:'id'});if(error)throw error;
  state.appearance={settings,is_published:data.has('is_published')};showNotice('Appearance settings saved to armiagClient.');
}

const SAMPLE_FRAGRANCE_DETAILS = {
  story: 'An expressive composition created for a quietly unforgettable presence. Bright aromatic accents introduce a refined heart before a warm, enveloping base leaves a memorable impression. A considered fragrance for moments that deserve to linger.',
  family: 'Amber · Woody', character: 'Warm, refined, magnetic', top_notes: 'Bergamot, pink pepper, saffron', heart_notes: 'Rose, geranium, cedarwood', base_notes: 'Oud, amber, musk, vanilla',
  intensity: 'Rich and expressive', mood: 'Confident, mysterious, captivating', occasion: 'Evening, special occasions, signature wear', season: 'Autumn, winter, all seasons',
  style: 'Unisex', origin: 'Confirm with supplier before publishing', concentration_detail: 'Eau de parfum', volume_detail: '50 ml', ingredients: 'Add the exact supplier-approved ingredient declaration here.',
  usage: 'Apply to pulse points from a suitable distance. Avoid contact with eyes and irritated skin.', packaging: 'Premium fragrance bottle with presentation box — confirm final packaging.',
  delivery: 'Delivery estimate and charges to be confirmed for the customer’s location.', returns: 'Returns and exchanges are subject to the final Armiag policy.', gift: 'Gift packaging availability to be confirmed.',
  seo_title: 'Armiag | The Art of Scent', seo_description: 'Discover the Armiag fragrance collection. Explore considered compositions and find your personal scent.', is_sample: true
};
const DETAIL_FIELDS = ['collections','story','family','character','top_notes','heart_notes','base_notes','intensity','mood','occasion','season','style','origin','concentration_detail','volume_detail','ingredients','usage','packaging','delivery','returns','gift','seo_title','seo_description'];
function fillFragranceFields(form, details={}) {
  const values={...SAMPLE_FRAGRANCE_DETAILS,...(details||{})};
  for(const name of DETAIL_FIELDS) if(form.elements[name]) form.elements[name].value=values[name]||'';
  form.elements.is_sample.checked=values.is_sample!==false;
}
function readFragranceFields(form) {
  const details={};
  for(const name of DETAIL_FIELDS) details[name]=String(form.elements[name]?.value||'').trim();
  details.is_sample=form.elements.is_sample.checked;
  return details;
}
function ensureVariantEditor() {
  if($('#variantEditor')) return;
  const form=$('#productForm');
  const grid=$('.form-grid',form);
  const legacyNames=['price_inr','size_ml','stock_quantity'];
  legacyNames.forEach(name=>{
    const field=form.elements[name];
    if(field?.closest('label')) field.closest('label').hidden=true;
    if(field) field.disabled=true;
  });
  const editor=document.createElement('section');
  editor.id='variantEditor';
  editor.className='variant-editor full-field';
  editor.innerHTML=`<div class="variant-heading"><div><span class="eyebrow">PRODUCT OPTIONS</span><h3>Volumes, prices & stock</h3><p>Set a separate selling price and available stock for every bottle size.</p></div><button type="button" class="button button-outline" id="addVariantButton">＋ Add volume</button></div><div id="variantRows"></div>`;
  grid.insertAdjacentElement('afterend',editor);
  const style=document.createElement('style');
  style.id='variantEditorStyles';
  style.textContent=`
    #variantEditor{margin:18px 0 22px;padding:18px;border:1px solid rgba(182,155,104,.35);border-radius:12px;background:#faf8f3}
    #variantEditor .variant-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}
    #variantEditor h3{margin:4px 0;font-size:17px}#variantEditor p{margin:4px 0 0;color:#777;font-size:12px}
    #variantEditor .variant-row{display:grid;grid-template-columns:1fr 1.2fr 1fr auto auto;gap:10px;align-items:end;padding:12px 0;border-top:1px solid #e7e0d4}
    #variantEditor label{display:grid;gap:6px;font-size:12px;color:#555}
    #variantEditor input[type=number]{width:100%;min-width:0;padding:10px;border:1px solid #d8d0c3;border-radius:7px;background:#fff;color:#171715}
    #variantEditor .variant-active{display:flex;align-items:center;gap:6px;padding-bottom:10px;white-space:nowrap}
    #variantEditor .variant-remove{border:0;background:transparent;color:#956b58;padding:8px;cursor:pointer}
    @media(max-width:650px){#variantEditor .variant-heading{align-items:flex-start;flex-direction:column}#variantEditor .variant-row{grid-template-columns:1fr 1fr;gap:12px}#variantEditor .variant-active{padding:0}#variantEditor .variant-remove{justify-self:start}}
  `;
  document.head.appendChild(style);
  $('#addVariantButton',editor).addEventListener('click',()=>addVariantRow({size_ml:100,price_inr:'',stock_quantity:0,is_active:true}));
  $('#variantRows',editor).addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-variant]');
    if(!button)return;
    const row=button.closest('.variant-row');
    if(row.dataset.existing==='true'){
      row.querySelector('[name="variant_active"]').checked=false;
      row.querySelector('[name="variant_active"]').disabled=true;
      button.textContent='Inactive';
      button.disabled=true;
    } else row.remove();
  });
}
function addVariantRow(variant={}) {
  const rows=$('#variantRows');
  const row=document.createElement('div');
  row.className='variant-row';
  row.dataset.existing=variant.id?'true':'false';
  row.dataset.id=variant.id||'';
  row.innerHTML=`<label>Volume (ml)<input name="variant_size" type="number" min="1" step="1" required value="${escapeHtml(variant.size_ml??50)}"></label><label>Price (₹)<input name="variant_price" type="number" min="0" step="0.01" required value="${escapeHtml(variant.price_inr??'')}"></label><label>Stock quantity<input name="variant_stock" type="number" min="0" step="1" required value="${escapeHtml(variant.stock_quantity??0)}"></label><label class="variant-active"><input name="variant_active" type="checkbox"${variant.is_active===false?'':' checked'}> Active</label><button type="button" class="variant-remove" data-remove-variant>${variant.id?'Set inactive':'Remove'}</button>`;
  rows.appendChild(row);
}
function readVariantRows() {
  return Array.from($('#variantRows').querySelectorAll('.variant-row')).map(row=>({
    id:row.dataset.id||null,
    size_ml:Number(row.querySelector('[name="variant_size"]').value),
    price_inr:Number(row.querySelector('[name="variant_price"]').value),
    stock_quantity:Number(row.querySelector('[name="variant_stock"]').value),
    is_active:row.querySelector('[name="variant_active"]').checked
  }));
}
function openProductDialog(product=null) {
  const dialog=$('#productDialog'),form=$('#productForm');form.reset();form.elements.id.value=product?.id||'';form.elements.name.value=product?.name||'';form.elements.concentration.value=product?.concentration||'Eau de parfum';form.elements.description.value=product?.description||'A considered expression of modern perfumery, composed to leave a lasting impression.';form.elements.is_active.checked=Boolean(product?.is_active);form.elements.images.value='';
  fillFragranceFields(form,product?.fragrance_details||SAMPLE_FRAGRANCE_DETAILS);
  ensureVariantEditor();
  $('#variantRows').innerHTML='';
  const variants=(product?.product_variants||[]).slice().sort((a,b)=>a.size_ml-b.size_ml);
  if(variants.length)variants.forEach(addVariantRow);
  else addVariantRow({size_ml:product?.size_ml||50,price_inr:product?.price_inr??'',stock_quantity:product?.stock_quantity??0,is_active:true});
  $('#productDialogTitle').textContent=product?'Edit fragrance':'Add a fragrance';renderProductImages(product?.product_images||[]);dialog.showModal();
}
function renderProductImages(images) {
  $('#productImageList').innerHTML=images.length?images.slice().sort((a,b)=>a.sort_order-b.sort_order).map(image=>`<div class="image-chip"><img src="${escapeHtml(image.image_url)}" alt="${escapeHtml(image.alt_text)}"><button type="button" aria-label="Remove image" data-remove-image="${image.id}">×</button></div>`).join(''):'<small>No saved photographs yet.</small>';
}
async function saveProduct(form) {
  const formData=new FormData(form);const id=formData.get('id');
  const variants=readVariantRows();
  if(!variants.length)throw new Error('Add at least one bottle volume.');
  const seen=new Set();
  for(const variant of variants){
    if(!Number.isInteger(variant.size_ml)||variant.size_ml<1||!Number.isFinite(variant.price_inr)||variant.price_inr<0||!Number.isInteger(variant.stock_quantity)||variant.stock_quantity<0)throw new Error('Check every volume, price and stock value.');
    if(seen.has(variant.size_ml))throw new Error(`The ${variant.size_ml} ml volume is listed more than once.`);
    seen.add(variant.size_ml);
  }
  const primary=variants.find(v=>v.is_active)||variants[0];
  const row={name:String(formData.get('name')).trim(),description:String(formData.get('description')||''),concentration:String(formData.get('concentration')||''),size_ml:primary.size_ml,price_inr:primary.price_inr,stock_quantity:primary.stock_quantity,is_active:formData.has('is_active'),fragrance_details:readFragranceFields(form),updated_at:new Date().toISOString()};
  if(!row.name)throw new Error('Enter a product name.');
  let result;
  if(id)result=await armiagClient.from('products').update(row).eq('id',id).select('id').single();
  else result=await armiagClient.from('products').insert(row).select('id').single();
  if(result.error)throw result.error;
  const productId=result.data.id;
  form.elements.id.value=productId;
  const variantRows=variants.map(v=>({product_id:productId,size_ml:v.size_ml,price_inr:v.price_inr,stock_quantity:v.stock_quantity,is_active:v.is_active,updated_at:new Date().toISOString()}));
  const {error:variantError}=await armiagClient.from('product_variants').upsert(variantRows,{onConflict:'product_id,size_ml'});
  if(variantError)throw variantError;
  const files=Array.from(form.elements.images.files||[]);
  for(const [index,file] of files.entries()){
    const uploaded=await uploadImage(file,`products/${productId}`);
    const {error}=await armiagClient.from('product_images').insert({product_id:productId,image_url:uploaded.url,storage_path:uploaded.path,alt_text:row.name,sort_order:Date.now()+index});
    if(error){await armiagClient.storage.from(BUCKET).remove([uploaded.path]);throw error;}
  }
  $('#productDialog').close();showNotice(files.length?'Product, volume options and photographs saved.':'Product and volume options saved.');await loadProducts();await loadStats();
}
async function removeProductImage(imageId) {
  const parent=state.products.find(product=>product.product_images?.some(item=>item.id===imageId));
  const image=parent?.product_images.find(item=>item.id===imageId);if(!image)return;
  if(!confirm('Remove this product photograph?'))return;
  if(image.storage_path){const {error}=await armiagClient.storage.from(BUCKET).remove([image.storage_path]);if(error)throw error;}
  const {error}=await armiagClient.from('product_images').delete().eq('id',image.id);if(error)throw error;
  await loadProducts();
  renderProductImages(state.products.find(product=>product.id===parent.id)?.product_images||[]);
}
async function toggleProduct(id) {
  const product=state.products.find(item=>item.id===id);if(!product)return;
  const {error}=await armiagClient.from('products').update({is_active:!product.is_active,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;
  showNotice(`Product ${product.is_active?'deactivated':'activated'}.`);await loadProducts();await loadStats();
}
async function deleteProduct(id) {
  const product=state.products.find(item=>item.id===id);if(!product||!confirm(`Delete “${product.name}” and its saved product photographs?`))return;
  const paths=(product.product_images||[]).map(image=>image.storage_path).filter(Boolean);
  if(paths.length){const {error}=await armiagClient.storage.from(BUCKET).remove(paths);if(error)throw error;}
  const {error}=await armiagClient.from('products').delete().eq('id',id);if(error)throw error;
  showNotice('Product deleted.');await loadProducts();await loadStats();
}

function showView(name) {
  state.currentView=name;
  document.querySelectorAll('.view').forEach(view=>view.classList.toggle('active',view.id===`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
  $('#viewTitle').textContent={overview:'Overview',products:'Products',homepage:'Homepage',appearance:'Appearance',menu:'Menu',orders:'Orders'}[name]||'Overview';
  $('#sidebar').classList.remove('open');
  if(name==='orders')loadOrders().catch(error=>showNotice(friendlyError(error),true));
  if(name==='homepage')loadHomepage().catch(error=>showNotice(friendlyError(error),true));
  if(name==='menu')loadMenu().catch(error=>showNotice(friendlyError(error),true));
}
document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.go)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#signOutButton').addEventListener('click',async()=>{const {error}=await armiagClient.auth.signOut();if(error)showNotice(friendlyError(error),true);});
$('#addProductButton').addEventListener('click',()=>openProductDialog());
$('#closeProductDialog').addEventListener('click',()=>$('#productDialog').close());$('#cancelProduct').addEventListener('click',()=>$('#productDialog').close());
$('#productForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('#saveProductButton');setBusy(button,true);try{await saveProduct(event.currentTarget)}catch(error){showNotice(friendlyError(error),true)}finally{setBusy(button,false)}});
$('#productImageList').addEventListener('click',async event=>{const button=event.target.closest('[data-remove-image]');if(!button)return;try{await removeProductImage(button.dataset.removeImage)}catch(error){showNotice(friendlyError(error),true)}});
$('#productsTable').addEventListener('click',async event=>{const edit=event.target.closest('[data-edit-product]'),toggle=event.target.closest('[data-toggle-product]'),del=event.target.closest('[data-delete-product]');try{if(edit)openProductDialog(state.products.find(item=>item.id===edit.dataset.editProduct));if(toggle)await toggleProduct(toggle.dataset.toggleProduct);if(del)await deleteProduct(del.dataset.deleteProduct)}catch(error){showNotice(friendlyError(error),true)}});
$('#homepageEditor').addEventListener('submit',async event=>{if(!event.target.matches('.homepage-card'))return;event.preventDefault();const button=$('button[type="submit"]',event.target);setBusy(button,true);try{await saveHomepageSection(event.target)}catch(error){showNotice(friendlyError(error),true)}finally{setBusy(button,false)}});
$('#appearanceForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('button[type="submit"]',event.currentTarget);setBusy(button,true);try{await saveAppearance(event.currentTarget)}catch(error){showNotice(friendlyError(error),true)}finally{setBusy(button,false)}});
for(const [colorName,textName] of [['inkColor','inkText'],['paperColor','paperText'],['accentColor','accentText']]){
  const color=$(`#appearanceForm [name="${colorName}"]`),text=$(`#appearanceForm [name="${textName}"]`);
  color.addEventListener('input',()=>text.value=color.value);
  text.addEventListener('change',()=>{if(/^#[0-9a-f]{6}$/i.test(text.value))color.value=text.value;else text.value=color.value;});
}
$('#ordersTable').addEventListener('change',event=>{const select=event.target.closest('[data-order-field]');if(select)changeOrderStatus(select).catch(error=>showNotice(friendlyError(error),true));});
$('#ordersTable').addEventListener('click',event=>{const button=event.target.closest('[data-view-order]');if(button){const order=state.orders.find(item=>item.id===button.dataset.viewOrder);if(order)renderOrderDetail(order);}});
$('#orderDetail').addEventListener('click',event=>{if(event.target.id==='closeOrderDetail')$('#orderDetail').hidden=true;});
$('#refreshOrders').addEventListener('click',()=>loadOrders().then(loadStats).catch(error=>showNotice(friendlyError(error),true)));


/* ===== Website menu (top navigation of the storefront) ===== */
state.menu=[];
const MENU_STARTER=[
  {label:'The collection',url:'#collection'},
  {label:'Best seller',url:'#collection/best-seller'},
  {label:'New arrivals',url:'#collection/new-arrivals'},
  {label:'Categories',url:'#collection',children:[{label:'Perfumes',url:'#collection/perfumes'},{label:'Attars',url:'#collection/attars'},{label:'Bakhoor',url:'#collection/bakhoor'}]},
  {label:'Our story',url:'#about'},{label:'Track order',url:'#track-order'},{label:'Contact',url:'#contact'}
];
const menuBy=(a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0);
function menuError(error){
  const text=String(error?.message||'');
  if(error?.code==='PGRST205'||error?.code==='42P01'||(/menu_items/i.test(text)&&/not found|does not exist|schema cache/i.test(text)))return 'The menu table is not set up yet. Open Supabase → SQL Editor, run the file menu-setup.sql once, then open this page again.';
  return friendlyError(error);
}
async function loadMenu() {
  const {data,error}=await armiagClient.from('menu_items').select('*').order('sort_order');
  if(error){state.menu=[];$('#menuTable').innerHTML=`<tr><td colspan="4" class="empty-panel">${escapeHtml(menuError(error))}</td></tr>`;return;}
  state.menu=data||[];renderMenu();
}
function orderedMenu() {
  const tops=state.menu.filter(item=>!item.parent_id).sort(menuBy),rows=[];
  for(const top of tops){
    rows.push({item:top,level:0,siblings:tops});
    const kids=state.menu.filter(item=>item.parent_id===top.id).sort(menuBy);
    for(const kid of kids)rows.push({item:kid,level:1,siblings:kids});
  }
  return rows;
}
function renderMenu() {
  const target=$('#menuTable');
  if(!state.menu.length){target.innerHTML='<tr><td colspan="4"><div class="menu-empty"><span>No menu items yet. Your website is showing the menu written in its page file.</span><button class="button button-outline" type="button" id="seedMenuButton">Load the starter menu (including Perfumes, Attars, Bakhoor)</button></div></td></tr>';return;}
  target.innerHTML=orderedMenu().map(({item,level,siblings})=>{
    const index=siblings.findIndex(sibling=>sibling.id===item.id),hasKids=state.menu.some(other=>other.parent_id===item.id);
    return `<tr><td><div style="padding-left:${level*28}px"><span class="product-title">${level?'↳ ':''}${escapeHtml(item.label)}</span>${hasKids?'<span class="product-subtitle">Dropdown ▾</span>':''}</div></td><td><code>${escapeHtml(item.url)}</code></td><td><span class="status-pill${item.is_visible?'':' off'}">${item.is_visible?'Visible':'Hidden'}</span></td><td><div class="row-actions"><button class="small-action" data-menu-up="${item.id}" aria-label="Move up"${index===0?' disabled':''}>↑</button><button class="small-action" data-menu-down="${item.id}" aria-label="Move down"${index===siblings.length-1?' disabled':''}>↓</button><button class="small-action" data-menu-edit="${item.id}">Edit</button><button class="small-action danger" data-menu-delete="${item.id}">Delete</button></div></td></tr>`;
  }).join('');
}
function openMenuDialog(item) {
  const form=$('#menuForm');form.reset();
  form.elements.id.value=item?.id||'';
  $('#menuDialogTitle').textContent=item?'Edit menu item':'Add menu item';
  const select=form.elements.parent_id;
  const tops=state.menu.filter(other=>!other.parent_id&&other.id!==item?.id).sort(menuBy);
  select.innerHTML='<option value="">Top of the menu (main item)</option>'+tops.map(top=>`<option value="${top.id}">Inside the dropdown of: ${escapeHtml(top.label)}</option>`).join('');
  select.disabled=Boolean(item&&state.menu.some(other=>other.parent_id===item.id));
  select.value=item?.parent_id||'';
  form.elements.label.value=item?.label||'';
  form.elements.url.value=item?.url||'';
  form.elements.is_visible.checked=item?item.is_visible!==false:true;
  $('#menuDialog').showModal();
}
function nextMenuOrder(parentId) {
  const group=state.menu.filter(item=>(item.parent_id||null)===(parentId||null));
  return group.reduce((max,item)=>Math.max(max,Number(item.sort_order)||0),0)+10;
}
async function saveMenu(form) {
  const id=form.elements.id.value,label=form.elements.label.value.trim(),url=form.elements.url.value.trim(),parent=form.elements.parent_id.value||null;
  if(!label)throw new Error('Enter the name that should appear on the website.');
  if(!url)throw new Error('Enter where this item should open, for example #collection/attars.');
  const row={label,url,parent_id:parent,is_visible:form.elements.is_visible.checked,updated_at:new Date().toISOString()};
  if(id){
    const current=state.menu.find(item=>item.id===id);
    if((current?.parent_id||null)!==parent)row.sort_order=nextMenuOrder(parent);
    const {error}=await armiagClient.from('menu_items').update(row).eq('id',id);if(error)throw error;
  }else{
    row.sort_order=nextMenuOrder(parent);
    const {error}=await armiagClient.from('menu_items').insert(row);if(error)throw error;
  }
  $('#menuDialog').close();showNotice('Menu saved. Your website shows it on the next page load.');await loadMenu();
}
async function moveMenu(id,direction) {
  const entry=orderedMenu().find(row=>row.item.id===id);if(!entry)return;
  const siblings=entry.siblings.slice(),from=siblings.findIndex(item=>item.id===id),to=from+direction;
  if(to<0||to>=siblings.length)return;
  [siblings[from],siblings[to]]=[siblings[to],siblings[from]];
  for(const [n,item] of siblings.entries()){
    const sortOrder=(n+1)*10;if(Number(item.sort_order)===sortOrder)continue;
    const {error}=await armiagClient.from('menu_items').update({sort_order:sortOrder}).eq('id',item.id);if(error)throw error;
  }
  await loadMenu();
}
async function deleteMenuItem(id) {
  const item=state.menu.find(other=>other.id===id);if(!item)return;
  const kids=state.menu.filter(other=>other.parent_id===id).length;
  if(!confirm(`Delete “${item.label}”${kids?` and its ${kids} dropdown item${kids>1?'s':''}`:''} from the menu?`))return;
  const {error}=await armiagClient.from('menu_items').delete().eq('id',id);if(error)throw error;
  showNotice('Menu item deleted.');await loadMenu();
}
async function seedMenu() {
  let order=0;
  for(const top of MENU_STARTER){
    order+=10;
    const {data,error}=await armiagClient.from('menu_items').insert({label:top.label,url:top.url,sort_order:order,is_visible:true}).select('id').single();if(error)throw error;
    let childOrder=0;
    for(const child of top.children||[]){childOrder+=10;const result=await armiagClient.from('menu_items').insert({label:child.label,url:child.url,parent_id:data.id,sort_order:childOrder,is_visible:true});if(result.error)throw result.error;}
  }
  showNotice('Starter menu added. You can now edit it here.');await loadMenu();
}
$('#addMenuButton').addEventListener('click',()=>openMenuDialog());
$('#closeMenuDialog').addEventListener('click',()=>$('#menuDialog').close());
$('#cancelMenu').addEventListener('click',()=>$('#menuDialog').close());
$('#menuForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('#saveMenuButton');setBusy(button,true);try{await saveMenu(event.currentTarget)}catch(error){showNotice(menuError(error),true)}finally{setBusy(button,false)}});
$('#menuTable').addEventListener('click',async event=>{
  const up=event.target.closest('[data-menu-up]'),down=event.target.closest('[data-menu-down]'),edit=event.target.closest('[data-menu-edit]'),del=event.target.closest('[data-menu-delete]'),seed=event.target.closest('#seedMenuButton');
  try{
    if(up)await moveMenu(up.dataset.menuUp,-1);
    if(down)await moveMenu(down.dataset.menuDown,1);
    if(edit)openMenuDialog(state.menu.find(item=>item.id===edit.dataset.menuEdit));
    if(del)await deleteMenuItem(del.dataset.menuDelete);
    if(seed){seed.disabled=true;await seedMenu();}
  }catch(error){showNotice(menuError(error),true)}
});
