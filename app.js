/* Replace these clearly labeled sample entries with approved Armiag product details and photography. */
function functionUrl(name){const c=window.ARMIAG_SUPABASE_CONFIG||{};return `${String(c.functionsUrl||c.url||'').replace(/\/$/,'')}/functions/v1/${name}`}
let PRODUCTS = [];
let catalogState = 'loading';
let SITE_CONTENT={};
let SITE_APPEARANCE=null;
let TRACKED_ORDER=null;
let TRACKING_LOOKUP=null;
let TRACKING_LAST_UPDATED=null;
let TRACKING_REFRESH_WARNING='';
let trackingPollTimer=null;
let trackingRequest=null;
let trackingGeneration=0;
let trackingPollingEnabled=false;
let trackingResumeAfterRequest=false;
let lastRenderedPage=null;
let lastRenderedTrackingReference=null;
function htmlEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function parseHashRoute(){const [path='',query='']=location.hash.slice(1).split('?');let segments;try{segments=decodeURIComponent(path||'home').split('/')}catch{segments=['home']}return {segments,query:new URLSearchParams(query)}}
let heroReady=false;
const HOME_CACHE_KEY='armiag_home_cache';
try{const cached=JSON.parse(localStorage.getItem(HOME_CACHE_KEY)||'null');if(Array.isArray(cached)&&cached.length){SITE_CONTENT=Object.fromEntries(cached.map(row=>[row.id,row]));heroReady=true;}}catch(error){}
try{if(Array.isArray(window.ARMIAG_PRELOAD)&&window.ARMIAG_PRELOAD.length){SITE_CONTENT=Object.fromEntries(window.ARMIAG_PRELOAD.map(row=>[row.id,row]));heroReady=true;}}catch(error){}
async function loadSupabaseProducts(){
  if(!window.armiagSupabase){catalogState='error';heroReady=true;render();return;}
  const contentPromise=window.armiagSupabase.from('homepage_content').select('id,heading,body,button_label,button_url,image_url,is_visible,is_published,eyebrow,sort_order,image_visible,image_published');
  contentPromise.then(result=>{
    const wasReady=heroReady;let changed=true;
    if(!result.error){
      const rows=result.data||[];const json=JSON.stringify(rows);
      try{changed=localStorage.getItem(HOME_CACHE_KEY)!==json;localStorage.setItem(HOME_CACHE_KEY,json);}catch(error){}
      SITE_CONTENT=Object.fromEntries(rows.map(row=>[row.id,row]));
    }
    heroReady=true;
    if(!wasReady||changed)render();
  },()=>{if(!heroReady){heroReady=true;render();}});
  const {data,error}=await window.armiagSupabase.from('products')
    .select('id,name,description,price_inr,size_ml,concentration,stock_quantity,is_active,fragrance_details,product_images(image_url,sort_order)')
    .eq('is_active',true).order('name');
  if(error){catalogState='error';PRODUCTS=[];console.warn('Armiag products could not be loaded from Supabase.',error.message)}
  else {
    catalogState='ready';
    const {data:variantRows,error:variantError}=await window.armiagSupabase.from('product_variants')
      .select('id,product_id,size_ml,price_inr,stock_quantity,is_active').eq('is_active',true).order('size_ml');
    if(variantError) console.warn('Armiag volume options could not be loaded; using each product’s original volume.',variantError.message);
    PRODUCTS=(data||[]).map(p=>{
      const images=(p.product_images||[]).sort((a,b)=>a.sort_order-b.sort_order);
      const savedVariants=(variantRows||[]).filter(v=>v.product_id===p.id).map(v=>({id:v.id,size_ml:Number(v.size_ml),price:Number(v.price_inr),stock_quantity:Number(v.stock_quantity)}));
      const variants=variantError?[{id:`legacy-${p.id}`,size_ml:Number(p.size_ml)||50,price:Number(p.price_inr)||0,stock_quantity:Number(p.stock_quantity)||0}]:savedVariants;
      return {id:p.id,name:p.name,description:p.description||'',price:Number(p.price_inr)||0,size_ml:Number(p.size_ml)||50,stock_quantity:Number(p.stock_quantity)||0,variants,images:images.map(image=>image.image_url),image:images[0]?.image_url||'',edition:[p.concentration].filter(Boolean).join(' · '),badge:'The collection',details:p.fragrance_details||{}};
    });
    // Migrate old product-only cart entries to their matching volume without losing quantities.
    let cartChanged=false;
    for(const id of Object.keys(cart)){
      const current=PRODUCTS.find(item=>item.id===id);
      if(current){const chosen=current.variants[0];if(chosen){cart[chosen.id]=(cart[chosen.id]||0)+cart[id];delete cart[id];cartChanged=true;}else{delete cart[id];cartChanged=true;}}
      else if(!PRODUCTS.some(item=>item.variants.some(v=>v.id===id))){delete cart[id];cartChanged=true;}
    }
    for(const item of PRODUCTS) for(const variant of item.variants){
      if(cart[variant.id]>variant.stock_quantity){cart[variant.id]=variant.stock_quantity;if(!cart[variant.id])delete cart[variant.id];cartChanged=true;}
    }
    if(cartChanged)try{localStorage.setItem(cartKey,JSON.stringify(cart))}catch(error){console.warn('Armiag could not update the saved bag.',error)}
  }
  const [contentResult,appearanceResult]=await Promise.all([
    contentPromise,
    window.armiagSupabase.from('appearance_settings').select('settings,is_published').eq('id',true).maybeSingle()
  ]);
  if(contentResult.error)console.warn('Armiag homepage content could not be loaded.',contentResult.error.message);
  else SITE_CONTENT=Object.fromEntries((contentResult.data||[]).map(row=>[row.id,row]));
  if(appearanceResult.error)console.warn('Armiag appearance could not be loaded.',appearanceResult.error.message);
  else SITE_APPEARANCE=appearanceResult.data;
  render();
}
window.addEventListener('armiag:supabase-ready',()=>loadSupabaseProducts().catch(error=>{catalogState='error';heroReady=true;PRODUCTS=[];console.error('Armiag storefront data could not be loaded.',error);render()}));
const app=document.querySelector('#app');
const cartKey='armiag-demo-cart';
const checkoutTokenKey='armiag-checkout-token';
let checkoutToken=null;
let cart=readCart();
function readCart(){try{const value=JSON.parse(localStorage.getItem(cartKey)||'{}');if(!value||typeof value!=='object'||Array.isArray(value))return {};return Object.fromEntries(Object.entries(value).filter(([id,q])=>typeof id==='string'&&Number.isSafeInteger(Number(q))&&Number(q)>0).map(([id,q])=>[id,Number(q)]))}catch{return {}}}
function getCheckoutToken(){if(checkoutToken)return checkoutToken;try{checkoutToken=localStorage.getItem(checkoutTokenKey)}catch{}if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutToken||'')){checkoutToken=crypto.randomUUID();try{localStorage.setItem(checkoutTokenKey,checkoutToken)}catch{}}return checkoutToken}
function saveCart(preserveCheckoutToken=false){if(!preserveCheckoutToken){checkoutToken=null;try{localStorage.removeItem(checkoutTokenKey)}catch{}}try{localStorage.setItem(cartKey,JSON.stringify(cart));updateBag();return true}catch{showToast('Your bag could not be saved on this device');return false}}
let checkoutSubmissionInProgress=false;
function showPaymentConfirmationPending(orderId,msg,form,button,wasDismissed=false){msg.className='form-message error';msg.innerHTML=`<strong>${wasDismissed?'Checkout was closed. Payment is not confirmed.':'Payment confirmation is pending.'}</strong><br>Armiag order ID: ${htmlEscape(orderId)}<br>If you completed payment, please contact Armiag before retrying.`;form.reset();button.disabled=true;button.textContent='Order submitted';}
function openRazorpayCheckout(paymentOrder,orderId,checkoutToken,customerName,customerEmail,customerPhone,msg,form,button){
  if(typeof window.Razorpay!=='function')throw new Error('Razorpay Checkout could not be loaded.');
  let verificationStarted=false;
  const checkout=new window.Razorpay({
    key:paymentOrder.key_id,
    order_id:paymentOrder.razorpay_order_id,
    amount:paymentOrder.amount_paise,
    currency:paymentOrder.currency,
    name:'Armiag',
    prefill:{name:customerName,email:customerEmail,contact:customerPhone},
    handler:async checkoutResult=>{
      if(verificationStarted)return;
      verificationStarted=true;
      const paymentId=checkoutResult?.razorpay_payment_id;
      const razorpayOrderId=checkoutResult?.razorpay_order_id;
      const signature=checkoutResult?.razorpay_signature;
      if(typeof paymentId!=='string'||!/^pay_[A-Za-z0-9]+$/.test(paymentId)||razorpayOrderId!==paymentOrder.razorpay_order_id||typeof signature!=='string'||!/^[0-9a-f]{64}$/i.test(signature)){
        showPaymentConfirmationPending(orderId,msg,form,button);
        return;
      }
      msg.className='form-message';
      msg.textContent='Payment received. Armiag is confirming it securely…';
      try{
        const config=window.ARMIAG_SUPABASE_CONFIG;
        const response=await fetch(`${functionUrl('armiag-verify-razorpay-payment')}`,{
          method:'POST',
          headers:{'Content-Type':'application/json','apikey':config.publishableKey},
          body:JSON.stringify({order_id:orderId,checkout_token:checkoutToken,razorpay_order_id:razorpayOrderId,razorpay_payment_id:paymentId,razorpay_signature:signature})
        });
        let result={};
        try{result=await response.json()}catch{}
        if(!response.ok||result.success!==true||result.payment_status!=='paid'||result.order_id!==orderId){
          showPaymentConfirmationPending(orderId,msg,form,button);
          return;
        }
        msg.className='form-message success';
        msg.innerHTML=`<strong>Payment confirmed.</strong><br>Armiag order ID: ${htmlEscape(orderId)}<br>Status: Paid`;
        form.reset();
        button.disabled=true;
        button.textContent='Payment confirmed';
      }catch{
        showPaymentConfirmationPending(orderId,msg,form,button);
      }
    },
    modal:{ondismiss:()=>{
      if(verificationStarted)return;
      button.disabled=true;button.textContent='Order submitted';
      msg.className='form-message error';
      msg.innerHTML=`<strong>Checkout was closed. Payment is not confirmed.</strong><br>Armiag order ID: ${htmlEscape(orderId)}<br><button type="button" class="button" data-reopen-payment>Reopen payment</button>`;
      const reopen=msg.querySelector('[data-reopen-payment]');
      if(reopen)reopen.addEventListener('click',()=>openRazorpayCheckout(paymentOrder,orderId,checkoutToken,customerName,customerEmail,customerPhone,msg,form,button));
    }}
  });
  checkout.open();
}
function product(id){return PRODUCTS.find(p=>p.id===id)||null}
function variantsOf(p){if(Array.isArray(p?.variants)&&p.variants.length)return p.variants;return p?[{id:`legacy-${p.id}`,size_ml:Number(p.size_ml)||50,price:Number(p.price_inr??p.price)||0,stock_quantity:Number(p.stock_quantity)||0}]:[]}
function variantById(id){for(const p of PRODUCTS){const v=variantsOf(p).find(item=>item.id===id);if(v)return {...v,product:p,edition:`${v.size_ml} ml`};}return null}
function firstVariant(p){return variantsOf(p)[0]||{id:`legacy-${p?.id}`,size_ml:50,price:Number(p?.price)||0,stock_quantity:Number(p?.stock_quantity)||0}}
function money(value){return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value)}
function cartCount(){return Object.values(cart).reduce((n,q)=>n+q,0)}
function cartTotal(){return Object.entries(cart).reduce((sum,[id,q])=>{const v=variantById(id);return sum+(v?v.price*q:0)},0)}
function updateBag(){document.querySelectorAll('.bag-count').forEach(el=>el.textContent=cartCount())}
function showToast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2300)}
function productCards(){if(!PRODUCTS.length){const message=catalogState==='loading'?'Loading the collection…':catalogState==='error'?'The collection is temporarily unavailable. Please refresh in a moment.':'The collection is being prepared. Please check back soon.';return `<p class="empty-state">${message}</p>`}return PRODUCTS.map(p=>{const variants=variantsOf(p);const minPrice=variants.length?Math.min(...variants.map(x=>Number(x.price)||0)):Number(p.price)||0;const inStock=variants.some(x=>Number(x.stock_quantity)>0);return `<article class="product-card"><a class="product-visual" href="#product/${htmlEscape(p.id)}" aria-label="View ${htmlEscape(p.name)}"><img src="${htmlEscape(p.image||'')}" alt="Fragrance photograph for ${htmlEscape(p.name)}" loading="lazy"><span class="product-label">${htmlEscape(inStock?p.badge||'The collection':'Out of stock')}</span></a><div class="product-info"><div><h3><a href="#product/${htmlEscape(p.id)}">${htmlEscape(p.name)}</a></h3><p>${variants.map(x=>`${x.size_ml} ml`).join(' / ')}</p></div><strong>${money(minPrice)}</strong></div><a class="text-link" href="#product/${htmlEscape(p.id)}">Discover the fragrance</a></article>`}).join('')}
const HERO_BODY='A considered world of fragrance. Discover the collection and find a scent that feels entirely your own.';
const SAMPLE_HERO_SLIDES=[
  {id:'hero_2',eyebrow:'New launch',heading:'Crush',body:'A bold, velvety signature for evenings that deserve to be remembered.',button_label:'Shop now',button_url:'#collection',image_url:'assets/samples/hero-ruby.jpg'}
];
function isLocalPreview(){return ['localhost','127.0.0.1'].includes(location.hostname)}
function heroSlides(){
  const c=SITE_CONTENT||{},list=[],first=c.hero;
  const img=r=>(r.image_published!==false&&r.image_visible!==false)?(r.image_url||''):'';
  if(!first?.is_published)list.push({o:first?.sort_order??0,s:{id:'hero',isDefault:true,eyebrow:'The art of scent · Armiag'}});
  else if(first.is_visible)list.push({o:first.sort_order??0,s:{id:'hero',eyebrow:first.eyebrow||'The art of scent · Armiag',heading:first.heading??'',body:first.body??'',button_label:first.button_label??'',button_url:first.button_url||'#collection',image_url:first.image_url||''}});
  for(const sample of SAMPLE_HERO_SLIDES){
    const row=c[sample.id];
    if(row?.is_published){if(row.is_visible)list.push({o:row.sort_order??1,s:{id:sample.id,eyebrow:row.eyebrow||'Armiag',heading:row.heading||'',body:row.body||'',button_label:row.button_label||'',button_url:row.button_url||'',image_url:img(row)}});}
    else if(!row&&isLocalPreview())list.push({o:1,s:{...sample,isSample:true}});
  }
  return list.sort((a,b)=>a.o-b.o).map(x=>x.s);
}
function heroSlideHtml(slide,index){
  const image=safeSiteUrl(slide.image_url).replace(/["'\\]/g,'');
  const style=image?` style="background-image:linear-gradient(90deg,rgba(13,13,12,.72),rgba(13,13,12,.12) 62%),url('${htmlEscape(image)}')"`:'';
  const title=slide.isDefault?'Presence<br><em>in every</em><br>moment.':htmlEscape(slide.heading);
  const body=slide.isDefault?HERO_BODY:slide.body;
  const label=slide.isDefault?'Explore the collection':slide.button_label;
  const url=slide.isDefault?'#collection':safeSiteUrl(slide.button_url);
  const tag=index===0?'h1':'h2';
  return `<article class="hero-slide${index===0?' is-active':''}"${index===0?'':' aria-hidden="true"'}><div class="hero-image"${style}></div><div class="hero-copy"><span class="eyebrow">${htmlEscape(slide.eyebrow)}</span>${title?`<${tag} class="hero-title">${title}</${tag}>`:''}${body?`<p>${htmlEscape(body)}</p>`:''}${label&&url?`<a class="button button-light" href="${htmlEscape(url)}">${htmlEscape(label)} <span>↗</span></a>`:''}</div>${slide.isSample?'<span class="hero-sample-tag">Sample slide · not shown on the live site</span>':''}</article>`;
}
function heroSlider(){
  if(!heroReady)return `<section class="hero hero-slider" data-hero-slider><div class="hero-slides"><article class="hero-slide is-active"><div class="hero-image"></div></article></div></section>`;
  const slides=heroSlides();if(!slides.length)return '';
  return `<section class="hero hero-slider" data-hero-slider aria-roledescription="carousel" aria-label="Featured fragrances"><div class="hero-slides">${slides.map(heroSlideHtml).join('')}</div>${slides.length>1?`<div class="hero-dots">${slides.map((slide,i)=>`<button type="button" class="hero-dot${i===0?' is-active':''}" data-slide="${i}" aria-label="Show slide ${i+1}"></button>`).join('')}</div>`:''}</section>`;
}
let heroTimer=null;
function initHeroSlider(){
  clearInterval(heroTimer);heroTimer=null;
  const slider=document.querySelector('[data-hero-slider]');if(!slider)return;
  const slides=[...slider.querySelectorAll('.hero-slide')],dots=[...slider.querySelectorAll('.hero-dot')];
  if(slides.length<2)return;
  let index=0,paused=false;
  const show=i=>{index=(i+slides.length)%slides.length;slides.forEach((slide,n)=>{const on=n===index;slide.classList.toggle('is-active',on);slide.setAttribute('aria-hidden',on?'false':'true');slide.querySelectorAll('a').forEach(a=>{a.tabIndex=on?0:-1})});dots.forEach((dot,n)=>{dot.classList.toggle('is-active',n===index);dot.setAttribute('aria-current',n===index?'true':'false')})};
  const start=()=>{clearInterval(heroTimer);heroTimer=null;heroTimer=setInterval(()=>{if(!paused&&!document.hidden)show(index+1)},6000)};
  dots.forEach((dot,n)=>dot.addEventListener('click',()=>{show(n);start()}));
    slider.addEventListener('focusin',()=>{paused=true});slider.addEventListener('focusout',()=>{paused=false});
  let startX=null;
  slider.addEventListener('touchstart',e=>{startX=e.touches[0].clientX},{passive:true});
  slider.addEventListener('touchend',e=>{if(startX===null)return;const dx=e.changedTouches[0].clientX-startX;startX=null;if(Math.abs(dx)>50){show(index+(dx<0?1:-1));start()}});
  show(0);start();
}
function home(){return `<div class="page">${heroSlider()}<section class="section"><div class="section-heading"><span class="eyebrow">The collection</span><h2>Quietly unforgettable.</h2><p>Discover the fragrances of Armiag.</p></div><div class="product-grid">${productCards()}</div><div class="center" style="margin-top:45px"><a class="button button-outline" href="#collection">View the collection <span>↗</span></a></div></section><section class="story-band"><div class="story-image" role="img" aria-label="Artful fragrance and botanical still life"></div><div class="story-copy"><span class="eyebrow">A point of view</span><h2>Made to leave<br>a feeling.</h2><p>Armiag is a study in presence: considered objects, personal rituals and the memories that linger. Our story is still being written, and this is its first chapter.</p><a class="text-link" href="#about">Discover our story</a></div></section><section class="quote-section"><span class="eyebrow">The Armiag perspective</span><blockquote>“Fragrance is the art of being remembered without saying a word.”</blockquote><p>Armiag · The art of scent</p></section></div>`}
function collection(){return `<div class="page"><section class="page-intro"><span class="eyebrow">Armiag · fragrances</span><h1>The collection</h1><p>Discover the fragrances in the Armiag collection.</p></section><section class="section collection-section"><div class="product-grid">${productCards()}</div></section></div>`}
function detail(id){
  const p=product(id);if(!p||!variantsOf(p).length)return `<div class="page"><section class="page-intro"><h1>Fragrance unavailable</h1><p>This product may no longer be available.</p><a class="button" href="#collection">Return to the collection</a></section></div>`;
  const images=p.images?.length?p.images:[p.image],d=p.details||{},v=firstVariant(p);
  const notes=(label,value)=>value?`<div class="fragrance-note"><span class="eyebrow">${label}</span><p>${htmlEscape(value)}</p></div>`:'';
  const specs=[['Style',d.style],['Concentration',d.concentration_detail||p.edition],['Origin',d.origin],['Packaging',d.packaging]].filter(([,x])=>x);
  return `<div class="page"><section class="detail-layout"><div><div class="detail-image"><img id="detailImage" src="${htmlEscape(images[0]||'')}" alt="Fragrance photograph for ${htmlEscape(p.name)}"></div>${images.length>1?`<div class="detail-thumbnails">${images.map((image,index)=>`<button type="button" data-product-image="${htmlEscape(image)}" aria-label="View product photograph ${index+1}"><img src="${htmlEscape(image)}" alt=""></button>`).join('')}</div>`:''}</div><div class="detail-copy"><span class="eyebrow">${htmlEscape(p.edition)}</span><h1>${htmlEscape(p.name)}</h1><div class="detail-price" id="selectedPrice">${money(v.price)}</div><p>${htmlEscape(p.description)}</p>${d.story?`<p class="fragrance-story">${htmlEscape(d.story)}</p>`:''}<div class="volume-picker" style="margin:24px 0"><span class="eyebrow" style="display:block;margin-bottom:10px">SELECT YOUR SIZE</span><div style="display:flex;gap:10px;flex-wrap:wrap">${variantsOf(p).map((item,index)=>`<button type="button" class="button ${index===0?'button-dark':'button-outline'}" data-volume-id="${htmlEscape(item.id)}" aria-pressed="${index===0?'true':'false'}" ${item.stock_quantity<=0?'disabled':''}>${item.size_ml} ml</button>`).join('')}</div><p id="variantAvailability" class="checkout-note">${v.stock_quantity>0?'Available':'Out of stock'}</p></div><div class="detail-actions"><div class="quantity"><button type="button" data-qty="-1" aria-label="Decrease quantity">−</button><span id="detailQty">1</span><button type="button" data-qty="1" aria-label="Increase quantity">+</button></div><button class="button" id="addToCart" data-id="${htmlEscape(p.id)}" data-variant-id="${htmlEscape(v.id)}" ${v.stock_quantity<=0?'disabled':''}>Add to bag <span>↗</span></button><button class="button button-outline" id="buyNow" data-id="${htmlEscape(p.id)}" data-variant-id="${htmlEscape(v.id)}" ${v.stock_quantity<=0?'disabled':''}>Buy now</button></div><a class="text-link" href="#collection">Back to the collection</a>${d.family||d.character?`<section class="fragrance-profile"><span class="eyebrow">THE SCENT PROFILE</span><h2>${htmlEscape(d.family||'The fragrance')}</h2>${d.character?`<p>${htmlEscape(d.character)}</p>`:''}<div class="fragrance-notes">${notes('Top notes',d.top_notes)}${notes('Heart notes',d.heart_notes)}${notes('Base notes',d.base_notes)}</div></section>`:''}${d.intensity||d.mood||d.occasion||d.season?`<section class="fragrance-profile"><span class="eyebrow">A CLOSER IMPRESSION</span><div class="fragrance-spec-grid">${[['Intensity',d.intensity],['Mood',d.mood],['Occasion',d.occasion],['Season',d.season]].filter(([,x])=>x).map(([k,x])=>`<div><span class="eyebrow">${k}</span><p>${htmlEscape(x)}</p></div>`).join('')}</div></section>`:''}${specs.length?`<section class="fragrance-profile"><span class="eyebrow">PRODUCT DETAILS</span><dl class="fragrance-spec-list">${specs.map(([k,x])=>`<div><dt>${k}</dt><dd>${htmlEscape(x)}</dd></div>`).join('')}</dl></section>`:''}${d.usage||d.ingredients?`<section class="fragrance-profile"><span class="eyebrow">USAGE & COMPOSITION</span>${d.usage?`<h3>How to use</h3><p>${htmlEscape(d.usage)}</p>`:''}${d.ingredients?`<h3>Ingredients / composition</h3><p>${htmlEscape(d.ingredients)}</p>`:''}</section>`:''}${d.delivery||d.returns||d.gift?`<section class="fragrance-profile"><span class="eyebrow">DELIVERY & SERVICE</span>${[['Delivery',d.delivery],['Returns & exchange',d.returns],['Gift options',d.gift]].filter(([,x])=>x).map(([k,x])=>`<div class="fragrance-service"><strong>${k}</strong><p>${htmlEscape(x)}</p></div>`).join('')}</section>`:''}${d.is_sample?`<p class="sample-disclaimer">Illustrative sample content for editing. Confirm fragrance notes, composition, origin, performance and all service policies before publishing.</p>`:''}</div></section></div>`;
}
function about(){return `<div class="page"><section class="page-intro"><span class="eyebrow">A point of view</span><h1>Our story</h1><p>Armiag is a new name in fragrance. This first expression is an invitation to define the world of the brand together.</p></section><section class="about-layout"><div class="about-photo" role="img" aria-label="Editorial still life in warm light"></div><div class="about-copy"><span class="eyebrow">The beginning</span><h2>A quieter kind<br>of statement.</h2><p>We believe a fragrance can become a private signature: something personal, evocative and entirely your own. Armiag is being built around that feeling, with care for the details that turn a daily ritual into a lasting memory.</p><p>Our collection and story will grow as the brand takes shape. For now, consider this the opening note.</p><a class="text-link" href="#collection">Explore the collection</a></div></section><section class="values"><article class="value"><span class="eyebrow">01 · Intention</span><h3>Considered by design</h3><p>Every detail has a place. We are building a brand where restraint lets the meaningful things speak.</p></article><article class="value"><span class="eyebrow">02 · Presence</span><h3>Quiet confidence</h3><p>A personal expression of style, made for the moments that stay with you.</p></article><article class="value"><span class="eyebrow">03 · Becoming</span><h3>A story in progress</h3><p>Armiag is at the beginning. We look forward to sharing what comes next.</p></article></section></div>`}
function cartPage(){const rows=Object.entries(cart).filter(([,q])=>q>0).map(([id,q])=>({id,q,v:variantById(id)})).filter(x=>x.v);if(!rows.length)return `<div class="page"><section class="page-intro"><span class="eyebrow">Your selection</span><h1>The bag</h1></section><div class="empty-state"><h2>Your bag is waiting.</h2><p>Explore the collection and discover a fragrance.</p><a class="button" href="#collection">Explore the collection <span>↗</span></a></div></div>`;return `<div class="page"><section class="page-intro"><span class="eyebrow">Your selection</span><h1>The bag</h1></section><section class="cart-layout"><div>${rows.map(({id,q,v})=>`<article class="cart-row"><img src="${htmlEscape(v.product.image)}" alt="Fragrance image of ${htmlEscape(v.product.name)}"><div><h3>${htmlEscape(v.product.name)}</h3><p>${v.size_ml} ml</p><div class="quantity"><button data-cart-qty="-1" data-id="${htmlEscape(id)}" aria-label="Decrease quantity">−</button><span>${q}</span><button data-cart-qty="1" data-id="${htmlEscape(id)}" aria-label="Increase quantity">+</button></div><br><button class="remove" data-remove="${htmlEscape(id)}">Remove</button></div><strong>${money(v.price*q)}</strong></article>`).join('')}</div><aside class="cart-summary"><h2>Order summary</h2><div class="summary-line"><span>Subtotal</span><span>${money(cartTotal())}</span></div><div class="summary-line"><span>Delivery</span><span>Calculated later</span></div><div class="summary-line total"><span>Total</span><strong>${money(cartTotal())}</strong></div><p class="checkout-note">Delivery costs are not included.</p><a class="button" href="#checkout">Continue to checkout <span>↗</span></a><a class="text-link" href="#collection">Continue shopping</a></aside></section></div>`}
function checkout(){const rows=Object.entries(cart).filter(([,q])=>q>0).map(([id,q])=>({id,q,v:variantById(id)})).filter(x=>x.v);if(!rows.length)return `<div class="page"><section class="page-intro"><span class="eyebrow">Almost there</span><h1>Checkout</h1><p>Your bag is empty. Discover the collection before continuing.</p><a class="button" style="margin-top:25px" href="#collection">Explore the collection</a></section></div>`;return `<div class="page"><section class="page-intro"><span class="eyebrow">Your details</span><h1>Checkout</h1><p>Enter your delivery details, then pay securely with Razorpay.</p></section><section class="checkout-layout"><form id="checkoutForm" class="form-section"><h2>Delivery information</h2><div class="field-grid"><div class="field"><label for="name">Full name</label><input required autocomplete="name" id="name" name="name" minlength="2" maxlength="120"></div><div class="field"><label for="phone">Phone number</label><input required autocomplete="tel" type="tel" id="phone" name="phone" minlength="7" maxlength="20"></div><div class="field full"><label for="email">Email address</label><input required autocomplete="email" type="email" id="email" name="email" maxlength="254"></div><div class="field full">
  <label for="house">House / Building name</label>
  <input required id="house" name="house" maxlength="160">
</div>

<div class="field full">
  <label for="street">Street / Locality</label>
  <input required id="street" name="street" maxlength="160">
</div>

<div class="field">
  <label for="city">City / Town</label>
  <input required id="city" name="city" maxlength="100">
</div>

<div class="field">
  <label for="district">District</label>
  <input required id="district" name="district" maxlength="100">
</div>

<div class="field">
  <label for="state">State</label>
  <input required id="state" name="state" value="Kerala" maxlength="100">
</div>

<div class="field">
  <label for="pincode">PIN Code</label>
  <input required id="pincode" name="pincode" inputmode="numeric"
         pattern="[0-9]{6}" minlength="6" maxlength="6">
</div>

<div class="field full">
  <label for="landmark">Landmark (optional)</label>
  <input id="landmark" name="landmark" maxlength="160">
</div></div><button class="button" type="submit">Pay now <span>↗</span></button><div id="checkoutMessage" aria-live="polite"></div></form><aside class="checkout-aside"><h2>Your selection</h2>${rows.map(({q,v})=>`<div class="checkout-item"><span>${htmlEscape(v.product.name)} · ${v.size_ml} ml × ${q}</span><strong>${money(v.price*q)}</strong></div>`).join('')}<div class="summary-line total"><span>Subtotal</span><strong>${money(cartTotal())}</strong></div><p class="checkout-note">Payments are processed securely by Razorpay. Your order is confirmed once payment succeeds.</p></aside></section></div>`}
function trackingProgress(order){
  const status=String(order.order_status||'').toLowerCase();
  const delivery=String(order.delivery_status||'').toLowerCase();
  const delivered=status==='delivered'||delivery==='delivered';
  const shipped=status==='shipped'||delivered||delivery==='in_transit';
  const processing=['processing','shipped','delivered'].includes(status)||['in_transit','delivered'].includes(delivery);
  const confirmed=['confirmed','processing','shipped','delivered'].includes(status)||['in_transit','delivered'].includes(delivery);
  const cancelled=status==='cancelled';
  const exception=delivery==='exception';
  let current=cancelled||exception?-1:status==='delivered'||delivery==='delivered'?4:status==='shipped'||delivery==='in_transit'?3:status==='processing'?2:status==='confirmed'?1:0;
  const steps=[
    {label:'Order Placed',complete:true},
    {label:'Order Confirmed',complete:confirmed},
    {label:'Processing',complete:processing},
    {label:'Shipped',complete:shipped},
    {label:'Delivered',complete:delivered}
  ];
  const currentLabel=cancelled?'Order Cancelled':exception?'Delivery Exception':steps[current]?.label||'Order Placed';
  return {steps,current,currentLabel,cancelled,exception};
}
function trackingResultMarkup(){
  if(!TRACKED_ORDER)return 'Your order status and item summary will appear here after a successful lookup.';
  const order=TRACKED_ORDER,progress=trackingProgress(order);
  const updated=TRACKING_LAST_UPDATED?new Date(TRACKING_LAST_UPDATED):null;
  const updatedIso=updated&&!Number.isNaN(updated.getTime())?updated.toISOString():'';
  const updatedText=updatedIso?updated.toLocaleString('en-IN'):'—';
  return `<div class="tracking-current-state" role="status"><span class="eyebrow">CURRENT STATUS</span><strong>${htmlEscape(progress.currentLabel)}</strong></div>${progress.cancelled?'<p class="tracking-state tracking-state-cancelled">This order has been cancelled.</p>':''}${progress.exception?'<p class="tracking-state tracking-state-exception">There is a delivery exception. Armiag will update you when more information is available.</p>':''}<ol class="tracking-timeline" aria-label="Order progress">${progress.steps.map((step,index)=>{const current=index===progress.current;const state=current?'Current stage':step.complete?'Complete':'Pending';const classes=['tracking-step',step.complete?'is-complete':'',current?'is-current':''].filter(Boolean).join(' ');return `<li class="${classes}"${current?' aria-current="step"':''}><span class="tracking-step-marker" aria-hidden="true">${step.complete?'✓':index+1}</span><div><strong>${step.label}</strong><span>${state}</span></div></li>`}).join('')}</ol><p class="tracking-last-updated">Last updated <time datetime="${htmlEscape(updatedIso)}">${htmlEscape(updatedText)}</time></p>${TRACKING_REFRESH_WARNING?`<p class="tracking-refresh-warning" role="status">${htmlEscape(TRACKING_REFRESH_WARNING)}</p>`:''}<p><strong>Reference</strong><br>${htmlEscape(order.id)}</p><p><strong>Placed</strong><br>${htmlEscape(new Date(order.created_at).toLocaleString('en-IN'))}</p><p><strong>Payment</strong><br>${htmlEscape(String(order.payment_status??'unknown').replaceAll('_',' '))}</p><div class="summary-line total"><span>Subtotal</span><strong>${money(order.subtotal_inr)}</strong></div><h3>Items</h3><ul>${(order.order_items||[]).map(item=>`<li>${htmlEscape(item.product_name)} · ${htmlEscape(item.size_ml)} ml × ${htmlEscape(item.quantity)}</li>`).join('')}</ul>`;
}
function renderTrackingResult(){const panel=document.querySelector('#trackingResult');if(panel)panel.innerHTML=trackingResultMarkup();}
function trackingPageIsActive(){return decodeURIComponent(location.hash.slice(1)||'home').split('?')[0].split('/')[0]==='track-order';}
function clearTrackingPollTimer(){if(trackingPollTimer){clearTimeout(trackingPollTimer);trackingPollTimer=null;}}
function scheduleTrackingRefresh(delay=30000){
  clearTrackingPollTimer();
  if(!trackingPollingEnabled||!TRACKING_LOOKUP||!TRACKED_ORDER||!trackingPageIsActive()||document.hidden)return;
  trackingPollTimer=setTimeout(()=>{trackingPollTimer=null;refreshTrackedOrder();},delay);
}
async function requestTrackedOrder(lookup,isPolling,generation){
  if(trackingRequest)throw new Error('A tracking request is already in progress.');
  const config=window.ARMIAG_SUPABASE_CONFIG;
  if(!config?.url||!config?.publishableKey)throw new Error('The order lookup service is not configured.');
  const active={controller:new AbortController(),isPolling,generation,promise:null,timedOut:false,timeoutTimer:null};
  const operation=(async()=>{
    active.timeoutTimer=setTimeout(()=>{active.timedOut=true;active.controller.abort();},15000);
    try{
      const response=await fetch(`${functionUrl('armiag-track-order')}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey},signal:active.controller.signal,body:JSON.stringify(lookup)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.success)throw new Error(result.error||'No matching order was found. Check the reference and contact details.');
      return result.order;
    }catch(error){if(active.timedOut)throw new Error('The order lookup timed out. Please try again.');throw error;}
  })();
  active.promise=operation;trackingRequest=active;
  try{return await operation;}
  finally{
    if(active.timeoutTimer)clearTimeout(active.timeoutTimer);
    if(trackingRequest===active)trackingRequest=null;
    if(active.isPolling&&active.generation!==trackingGeneration&&trackingResumeAfterRequest&&trackingPollingEnabled&&TRACKED_ORDER&&trackingPageIsActive()&&!document.hidden){trackingResumeAfterRequest=false;scheduleTrackingRefresh(0);}
  }
}
async function refreshTrackedOrder(){
  if(!trackingPollingEnabled||!TRACKING_LOOKUP||!TRACKED_ORDER||!trackingPageIsActive()||document.hidden)return;
  if(trackingRequest){trackingResumeAfterRequest=true;return;}
  const generation=trackingGeneration;
  try{
    const order=await requestTrackedOrder(TRACKING_LOOKUP,true,generation);
    if(generation!==trackingGeneration||!trackingPageIsActive()||document.hidden)return;
    TRACKED_ORDER=order;TRACKING_LAST_UPDATED=Date.now();TRACKING_REFRESH_WARNING='';renderTrackingResult();
  }catch(error){
    if(generation!==trackingGeneration||error?.name==='AbortError')return;
    TRACKING_REFRESH_WARNING='We could not refresh your order just now. Showing the last update.';renderTrackingResult();
  }finally{
    if(generation===trackingGeneration){const resumeNow=trackingResumeAfterRequest&&!document.hidden;trackingResumeAfterRequest=false;scheduleTrackingRefresh(resumeNow?0:30000);}
  }
}
function trackOrderPage(){const reference=parseHashRoute().query.get('order')||'';return `<div class="page"><section class="page-intro"><span class="eyebrow">CUSTOMER CARE</span><h1>Track your order</h1><p>Enter the order reference from your confirmation with the email address and phone number used at checkout.</p></section><section class="checkout-layout tracking-layout"><form id="trackOrderForm" class="form-section"><h2>Order lookup</h2><div class="field-grid"><div class="field full"><label for="trackingId">Order reference</label><input required id="trackingId" name="order_id" inputmode="text" autocomplete="off" placeholder="Order reference" value="${htmlEscape(reference)}"></div><div class="field full"><label for="trackingEmail">Email address</label><input required id="trackingEmail" name="email" type="email" autocomplete="email" maxlength="254"></div><div class="field full"><label for="trackingPhone">Phone number</label><input required id="trackingPhone" name="phone" type="tel" autocomplete="tel" minlength="7" maxlength="20"></div></div><button class="button" type="submit">Find order</button><div id="trackingMessage" aria-live="polite"></div></form><aside class="checkout-aside tracking-card"><h2>Order status</h2><div id="trackingResult">${trackingResultMarkup()}</div></aside></section></div>`}
function contact(){return `<div class="page"><section class="page-intro"><span class="eyebrow">We would love to hear from you</span><h1>Contact</h1><p>Questions about Armiag? Send us a note or start a WhatsApp conversation.</p></section><section class="contact-layout"><div><span class="eyebrow">Get in touch</span><h2>Let's begin<br>a conversation.</h2><p>Reach out with questions, feedback or enquiries about the collection. We look forward to hearing from you.</p><div class="contact-details">
  <div>
    Email<br>
    <a href="mailto:armiagofficial@gmail.com">armiagofficial@gmail.com</a>
  </div>
  <div>
    Phone / WhatsApp<br>
    <a href="tel:+918921014214">+91 89210 14214</a>
    <br>
    <a class="text-link" href="https://wa.me/918921014214" target="_blank" rel="noopener">Chat on WhatsApp ↗</a>
  </div>
</div><div>Email<br><a href="mailto:armiagofficial@gmail.com">armiagofficial@gmail.com</a></div><div>WhatsApp<br><a class="text-link" href="https://wa.me/918921014214?text=Hello%20Armiag%2C%20I%20have%20a%20question%20about%20your%20collection." target="_blank" rel="noopener">Start a conversation ↗</a></div></div></div><form id="contactForm" class="contact-form"><div class="field"><label for="contactName">Your name</label><input id="contactName" required></div><div class="field"><label for="contactEmail">Email address</label><input type="email" id="contactEmail" required></div><div class="field"><label for="contactText">Your message</label><textarea id="contactText" required></textarea></div><button class="button" type="submit">Prepare email <span>↗</span></button><p class="checkout-note">Your email app will open with a prepared message. No form data is sent to a server.</p></form></section></div>`}
function safeSiteUrl(value){if(!value)return '';try{const url=new URL(value,location.href);return ['https:','http:'].includes(url.protocol)||value.startsWith('/')||value.startsWith('#')?url.href:''}catch{return ''}}
function updateMegaPanel(){
  const panel=document.querySelector('#megaPanel');if(!panel)return;
  const items=(PRODUCTS||[]).slice(0,5);
  if(!items.length){panel.innerHTML='';panel.dataset.empty='true';return}
  delete panel.dataset.empty;
  panel.innerHTML=`<div class="mega-inner">${items.map(p=>`<a class="mega-tile" href="#product/${htmlEscape(p.id)}"><span class="mega-photo">${p.image?`<img src="${htmlEscape(p.image)}" alt="" loading="lazy">`:''}</span><span class="mega-name">${htmlEscape(p.name)}</span></a>`).join('')}</div><a class="mega-all" href="#collection">View the full collection <span>↗</span></a>`;
}
(function initHeaderBehaviour(){
  const header=document.querySelector('.site-header'),panel=document.querySelector('#megaPanel'),trigger=document.querySelector('.main-nav a[href="#collection"]');
  if(!header)return;
  const syncScroll=()=>header.classList.toggle('is-scrolled',window.scrollY>40);
  window.addEventListener('scroll',syncScroll,{passive:true});syncScroll();
  if(!panel||!trigger)return;
  const canHover=()=>window.matchMedia('(hover:hover) and (min-width:901px)').matches;
  let timer=null;
  const open=()=>{if(!canHover()||panel.dataset.empty)return;clearTimeout(timer);panel.hidden=false;header.classList.add('menu-open')};
  const closeNow=()=>{clearTimeout(timer);panel.hidden=true;header.classList.remove('menu-open')};
  const closeSoon=()=>{clearTimeout(timer);timer=setTimeout(closeNow,160)};
  trigger.addEventListener('mouseenter',open);trigger.addEventListener('focus',open);
  document.querySelectorAll('.main-nav a').forEach(a=>{if(a!==trigger)a.addEventListener('mouseenter',closeNow)});
  header.addEventListener('mouseleave',closeSoon);
  panel.addEventListener('mouseenter',()=>clearTimeout(timer));
  header.addEventListener('keydown',e=>{if(e.key==='Escape')closeNow()});
  header.addEventListener('focusout',e=>{if(!header.contains(e.relatedTarget))closeNow()});
  window.addEventListener('hashchange',closeNow);
})();
function applySiteContent(){
  const c=SITE_CONTENT||{};
  const update=(id,selector,{heading='h2',body='p',button='a',image=null}={})=>{
    const row=c[id],section=document.querySelector(selector);if(!section)return;
    if(row?.is_published)section.hidden=!row.is_visible;
    if(!row?.is_published)return;
    const h=section.querySelector(heading);if(h&&row.heading)h.textContent=row.heading;const eb=section.querySelector('.eyebrow');if(eb&&row.eyebrow)eb.textContent=row.eyebrow;
    const p=body&&section.querySelector(body);if(p&&row.body)p.textContent=row.body;
    const a=button&&section.querySelector(button);if(a){if(row.button_label)a.textContent=row.button_label;const url=safeSiteUrl(row.button_url);if(url)a.href=url;}
    const photo=image==='@self'?section:image&&section.querySelector(image);const imageUrl=(row.image_published!==false&&row.image_visible!==false)?safeSiteUrl(row.image_url):'';if(photo&&imageUrl)photo.style.backgroundImage=`${id==='hero'?'linear-gradient(90deg,rgba(13,13,12,.76),rgba(13,13,12,.15)),':id==='quote'?'linear-gradient(90deg,rgba(20,19,16,.80),rgba(20,19,16,.80)),':''}url("${imageUrl.replace(/["\\]/g,'')}")`;
  };
  update('collection','.section',{heading:'h2',body:'p',button:'.center > .button',image:null});
  update('story','.story-band',{heading:'h2',body:'p',button:'.story-copy .text-link',image:'.story-image'});
  if(isLocalPreview()&&!(c.story?.is_published&&safeSiteUrl(c.story?.image_url))){const sampleStory=document.querySelector('.story-image');if(sampleStory)sampleStory.style.backgroundImage='url("assets/samples/story.jpg")';}
  update('quote','.quote-section',{heading:'blockquote',body:'p',button:null,image:'@self'});
  const banner=c.banner,announcement=document.querySelector('.announcement');
  if(announcement&&banner?.is_published){announcement.hidden=!banner.is_visible;if(banner.is_visible&&banner.heading){announcement.textContent=banner.heading;const bannerLink=safeSiteUrl(banner.button_url);if(bannerLink){const bannerAnchor=document.createElement('a');bannerAnchor.href=bannerLink;bannerAnchor.textContent=banner.button_label||'Shop now';announcement.append(bannerAnchor);}}const bannerImage=safeSiteUrl(banner.image_url);if(bannerImage){announcement.style.backgroundImage=`linear-gradient(90deg,rgba(23,23,21,.84),rgba(23,23,21,.84)),url("${bannerImage.replace(/["\\]/g,'')}")`;announcement.style.backgroundSize='cover';announcement.style.backgroundPosition='center';}}
  const appearance=SITE_APPEARANCE;
  if(!appearance?.is_published)return;
  const s=appearance.settings||{},root=document.documentElement;
  const validColor=value=>/^#[0-9a-f]{6}$/i.test(value||'');
  if(validColor(s.inkColor))root.style.setProperty('--ink',s.inkColor);
  if(validColor(s.paperColor))root.style.setProperty('--paper',s.paperColor);
  if(validColor(s.accentColor))root.style.setProperty('--gold',s.accentColor);
  const fonts={Italiana:"'Italiana', Georgia, serif",Georgia:'Georgia, serif','DM Sans':"'DM Sans', Arial, sans-serif",Arial:'Arial, sans-serif',Jost:"'Jost', 'DM Sans', Arial, sans-serif",'Cormorant Garamond':"'Cormorant Garamond', Georgia, serif",'Playfair Display':"'Playfair Display', Georgia, serif"};
  if(fonts[s.headingFont])root.style.setProperty('--serif',fonts[s.headingFont]);
  if(fonts[s.bodyFont])root.style.setProperty('--sans',fonts[s.bodyFont]);
  document.querySelectorAll('.wordmark').forEach(mark=>{
    const imageUrl=safeSiteUrl(s.logoUrl);
    if(imageUrl){mark.replaceChildren();const img=document.createElement('img');img.src=imageUrl;img.alt=s.logoText||'Armiag';img.style.cssText='max-width:150px;max-height:42px;object-fit:contain';mark.append(img);}
    else if(s.logoText){mark.textContent=/^armiag$/i.test(String(s.logoText).trim())?'Armiag':s.logoText;}
  });
}
function updateSeo(page,id){const meta=document.querySelector('meta[name="description"]');let title='Armiag — The Art of Scent',description='Armiag — a considered world of fragrance. Discover the collection and the art of scent.';if(page==='product'){const item=product(id);if(item){title=item.details?.seo_title||`${item.name} | Armiag`;description=item.details?.seo_description||item.description||description}else{title='Fragrance unavailable | Armiag';description='This Armiag fragrance is no longer available.'}}else if(page==='collection'){title='The Collection | Armiag'}else if(page==='about'){title='Our Story | Armiag'}else if(page==='cart'){title='Your Bag | Armiag'}else if(page==='checkout'){title='Checkout | Armiag'}else if(page==='track-order'){title='Track Your Order | Armiag'}else if(page==='contact'){title='Contact Armiag'}document.title=title;if(meta)meta.content=description}
function render(){const parsed=parseHashRoute(),route=parsed.segments,page=route[0],trackingReference=page==='track-order'?(parsed.query.get('order')||''):null;const newTrackingRoute=page==='track-order'&&(lastRenderedPage!=='track-order'||trackingReference!==lastRenderedTrackingReference);if(newTrackingRoute){clearTrackingPollTimer();trackingPollingEnabled=false;trackingResumeAfterRequest=false;TRACKED_ORDER=null;TRACKING_LOOKUP=null;TRACKING_LAST_UPDATED=null;TRACKING_REFRESH_WARNING='';if(trackingRequest){trackingGeneration++;trackingRequest.controller.abort();}}lastRenderedPage=page;lastRenderedTrackingReference=trackingReference;app.innerHTML=page==='collection'?collection():page==='product'?detail(route[1]):page==='about'?about():page==='cart'?cartPage():page==='checkout'?checkout():page==='track-order'?trackOrderPage():page==='contact'?contact():home();updateSeo(page,route[1]);applySiteContent();document.body.classList.toggle('is-home',!['collection','product','about','cart','checkout','track-order','contact'].includes(page)&&Boolean(document.querySelector('[data-hero-slider]')));initHeroSlider();updateMegaPanel();updateBag();document.querySelector('.main-nav').classList.remove('open');document.querySelector('.menu-toggle').setAttribute('aria-expanded','false');if(page==='track-order'&&trackingPollingEnabled){if(document.hidden)clearTrackingPollTimer();else if(trackingRequest)trackingResumeAfterRequest=true;else scheduleTrackingRefresh(0);}else if(page!=='track-order'){clearTrackingPollTimer();if(trackingRequest){trackingGeneration++;trackingRequest.controller.abort();trackingResumeAfterRequest=false;}}window.scrollTo(0,0)}
let detailQuantity=1;
window.addEventListener('hashchange',()=>{detailQuantity=1;render()});
document.addEventListener('click',e=>{
  const productImage=e.target.closest('[data-product-image]');if(productImage){document.querySelector('#detailImage').src=productImage.dataset.productImage;}
  const volume=e.target.closest('[data-volume-id]');if(volume){const selected=variantById(volume.dataset.volumeId);if(!selected)return;document.querySelectorAll('[data-volume-id]').forEach(button=>{const active=button===volume;button.setAttribute('aria-pressed',String(active));button.classList.toggle('button-dark',active);button.classList.toggle('button-outline',!active);});document.querySelector('#selectedPrice').textContent=money(selected.price);document.querySelector('#variantAvailability').textContent=selected.stock_quantity>0?'Available':'Out of stock';const add=document.querySelector('#addToCart'),buy=document.querySelector('#buyNow');[add,buy].forEach(button=>{button.dataset.variantId=selected.id;button.disabled=selected.stock_quantity<=0;});}
  const qty=e.target.closest('[data-qty]');if(qty){detailQuantity=Math.max(1,detailQuantity+Number(qty.dataset.qty));document.querySelector('#detailQty').textContent=detailQuantity;}
  const add=e.target.closest('#addToCart,#buyNow');if(add){const v=variantById(add.dataset.variantId);if(!v)return;const newCount=(cart[v.id]||0)+detailQuantity;if(newCount>v.stock_quantity){showToast('Only the available stock can be added');return;}cart[v.id]=newCount;saveCart();if(add.id==='buyNow')location.hash='#checkout';else showToast('Added to your bag');}
  const cartQty=e.target.closest('[data-cart-qty]');if(cartQty){const id=cartQty.dataset.id,next=Math.max(0,(cart[id]||0)+Number(cartQty.dataset.cartQty)),v=variantById(id);if(v&&next>v.stock_quantity){showToast('Only the available stock can be added');return;}cart[id]=next;if(!cart[id])delete cart[id];saveCart();render();}
  const remove=e.target.closest('[data-remove]');if(remove){delete cart[remove.dataset.remove];saveCart();render();}
});
document.querySelector('.menu-toggle').addEventListener('click',e=>{const nav=document.querySelector('.main-nav');const open=nav.classList.toggle('open');e.currentTarget.setAttribute('aria-expanded',String(open))});
document.addEventListener('submit',async e=>{if(e.target.id==='checkoutForm'){if(checkoutSubmissionInProgress)return;e.preventDefault();const form=e.target,msg=document.querySelector('#checkoutMessage'),button=form.querySelector('button[type="submit"]');if(!window.armiagSupabase){msg.className='form-message error';msg.textContent='The store connection is not ready. Please refresh the page and try again.';return;}const config=window.ARMIAG_SUPABASE_CONFIG;if(!config?.url||!config?.publishableKey){msg.className='form-message error';msg.textContent='The store configuration is incomplete. Please contact Armiag.';return;}const rows=Object.entries(cart).filter(([,q])=>Number(q)>0).map(([id,q])=>({variant_id:id,quantity:Number(q)}));if(!rows.length){msg.className='form-message error';msg.textContent='Your bag is empty. Please add a fragrance before placing an order.';return;}if(rows.some(item=>item.variant_id.startsWith('legacy-'))){msg.className='form-message error';msg.textContent='Secure checkout is not ready for this catalogue yet. Please contact Armiag for assistance.';return;}const customerName=form.elements.name.value.trim();
const customerPhone=form.elements.phone.value.trim();
const customerEmail=form.elements.email.value.trim();

const deliveryAddress = {
  house: form.elements.house.value.trim(),
  street: form.elements.street.value.trim(),
  city: form.elements.city.value.trim(),
  district: form.elements.district.value.trim(),
  state: form.elements.state.value.trim(),
  pincode: form.elements.pincode.value.trim(),
  landmark: form.elements.landmark.value.trim()
};

deliveryAddress.address = [
  deliveryAddress.house,
  deliveryAddress.street,
  deliveryAddress.city,
  deliveryAddress.district,
  deliveryAddress.state,
  deliveryAddress.pincode,
  deliveryAddress.landmark
].filter(Boolean).join(", ");checkoutSubmissionInProgress=true;button.disabled=true;button.textContent='Submitting order…';msg.className='form-message';msg.textContent='Submitting your order securely…';let localOrderCreated=false;try{const checkoutTokenForPayment=getCheckoutToken();const response=await fetch(`${functionUrl('armiag-create-order')}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey},body:JSON.stringify({customer_name:customerName,customer_email:customerEmail,customer_phone:customerPhone,delivery_address:deliveryAddress,checkout_token:checkoutTokenForPayment,items:rows})});let result={};try{result=await response.json()}catch{}if(!response.ok||!result.success){throw new Error(result.error||`Order could not be submitted (HTTP ${response.status}).`);}const orderId=result.order?.id;if(typeof orderId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)){throw new Error('The order was submitted, but its tracking reference could not be read. Please contact Armiag before retrying.');}localOrderCreated=true;cart={};saveCart(true);const paymentResponse=await fetch(`${functionUrl('armiag-create-razorpay-order')}`,{method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey},body:JSON.stringify({order_id:orderId,checkout_token:checkoutTokenForPayment})});let paymentResult={};try{paymentResult=await paymentResponse.json()}catch{}if(!paymentResponse.ok){throw new Error(typeof paymentResult.error==='string'?paymentResult.error:'Your order was created, but payment setup could not be started. Please contact Armiag.')}if(typeof paymentResult.key_id!=='string'||!paymentResult.key_id.trim()||typeof paymentResult.razorpay_order_id!=='string'||!/^order_[A-Za-z0-9]+$/.test(paymentResult.razorpay_order_id)||!Number.isSafeInteger(paymentResult.amount_paise)||paymentResult.amount_paise<100||paymentResult.currency!=='INR'||typeof paymentResult.payment_attempt_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentResult.payment_attempt_id)){throw new Error('Your order was created, but payment setup returned invalid details. Please contact Armiag.')}openRazorpayCheckout(paymentResult,orderId,checkoutTokenForPayment,customerName,customerEmail,customerPhone,msg,form,button);}catch(error){console.error('Armiag checkout error:',error);msg.className='form-message error';if(localOrderCreated){msg.textContent='Your order was created, but payment setup could not be completed. Please contact Armiag before retrying.';button.disabled=true;button.textContent='Order submitted';return;}checkoutSubmissionInProgress=false;msg.textContent=error.message||'We could not submit your order. Your bag has been kept; please try again.';button.disabled=false;button.innerHTML='Pay now <span>↗</span>';}}if(e.target.id==='contactForm'){e.preventDefault();const name=document.querySelector('#contactName').value;const email=document.querySelector('#contactEmail').value;const message=document.querySelector('#contactText').value;location.href=`mailto:armiagofficial@gmail.com?subject=${encodeURIComponent('Armiag enquiry')}&body=${encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`)}`}});
document.querySelector('#year').textContent=new Date().getFullYear();render();
document.addEventListener('submit',async event=>{
  if(event.target.id!=='trackOrderForm')return;
  event.preventDefault();
  const form=event.target,button=form.querySelector('button[type="submit"]'),message=document.querySelector('#trackingMessage');
  const generation=++trackingGeneration;
  clearTrackingPollTimer();trackingPollingEnabled=false;trackingResumeAfterRequest=false;
  TRACKED_ORDER=null;TRACKING_LOOKUP=null;TRACKING_LAST_UPDATED=null;TRACKING_REFRESH_WARNING='';renderTrackingResult();
  message.textContent='';message.className='';
  const lookup={order_id:form.elements.order_id.value.trim(),email:form.elements.email.value.trim(),phone:form.elements.phone.value.trim()};
  TRACKING_LOOKUP=lookup;
  button.disabled=true;button.setAttribute('aria-busy','true');message.textContent='Checking your order…';
  try{
    if(trackingRequest){const previous=trackingRequest;previous.controller.abort();await previous.promise.catch(()=>{});}
    if(generation!==trackingGeneration||!trackingPageIsActive())return;
    const order=await requestTrackedOrder(lookup,false,generation);
    if(generation!==trackingGeneration||!trackingPageIsActive())return;
    TRACKED_ORDER=order;TRACKING_LAST_UPDATED=Date.now();TRACKING_REFRESH_WARNING='';trackingPollingEnabled=true;message.textContent='';renderTrackingResult();scheduleTrackingRefresh(30000);
  }catch(error){
    if(generation!==trackingGeneration)return;
    TRACKED_ORDER=null;TRACKING_LOOKUP=null;TRACKING_LAST_UPDATED=null;TRACKING_REFRESH_WARNING='';trackingPollingEnabled=false;renderTrackingResult();
    message.className='form-message error';message.textContent=error.message||'Order lookup failed. Please try again.';
  }finally{if(generation===trackingGeneration){button.disabled=false;button.removeAttribute('aria-busy');}}
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){clearTrackingPollTimer();if(trackingRequest?.isPolling){trackingResumeAfterRequest=true;trackingRequest.controller.abort();}}
  else if(trackingPollingEnabled&&trackingPageIsActive()){if(trackingRequest)trackingResumeAfterRequest=true;else{trackingResumeAfterRequest=false;refreshTrackedOrder();}}
});
window.addEventListener('pagehide',()=>{clearTrackingPollTimer();if(trackingRequest?.isPolling)trackingRequest.controller.abort();});
window.addEventListener('pageshow',()=>{if(trackingPollingEnabled&&trackingPageIsActive()&&!document.hidden){if(trackingRequest)trackingResumeAfterRequest=true;else refreshTrackedOrder();}});
if(window.armiagSupabase)loadSupabaseProducts().catch(error=>{catalogState='error';PRODUCTS=[];console.error('Armiag storefront data could not be loaded.',error);render()});
