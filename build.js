// Armiag build script (runs on Netlify on every deploy).
// 1. Copies everything from ./site to ./dist
// 2. Reads the homepage content from Supabase
// 3. Writes it into dist/index.html so the hero shows instantly
// If Supabase cannot be reached, the site is still built (it just loads the hero the normal way).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Website files may be inside a "site" folder, or directly in the project root.
const OUT = path.join(__dirname, 'dist');
const SRC = fs.existsSync(path.join(__dirname, 'site', 'index.html')) ? path.join(__dirname, 'site') : __dirname;
const SKIP = new Set(['build.js', 'netlify.toml', '.gitignore', 'dist', 'node_modules', '.git', 'package.json', 'package-lock.json', 'README.md']);

function fail(message) { console.error('BUILD ERROR: ' + message); process.exit(1); }

if (!fs.existsSync(path.join(SRC, 'index.html'))) fail('index.html was not found. Upload your website files together with build.js.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  if (SRC === __dirname && SKIP.has(entry)) continue;
  fs.cpSync(path.join(SRC, entry), path.join(OUT, entry), { recursive: true });
}

function readConfig() {
  const file = path.join(SRC, 'supabase-config.js');
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  const url = (text.match(/(?:^|[\s{,])url:\s*'([^']+)'/m) || [])[1];
  const key = (text.match(/publishableKey:\s*'([^']+)'/) || [])[1];
  return { url, key };
}

async function fetchHomepage({ url, key }) {
  const columns = 'id,heading,body,button_label,button_url,image_url,is_visible,is_published,eyebrow,sort_order,image_visible,image_published';
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/homepage_content?select=${columns}`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Supabase answered ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected answer from Supabase');
  return rows;
}


// Builds the hero markup exactly as app.js would, using app.js's own functions,
// so the hero is already inside index.html (no waiting for scripts or the database).
function prerenderHero(rows) {
  const appJs = fs.readFileSync(path.join(OUT, 'app.js'), 'utf8');
  const pick = re => (appJs.match(re) || [])[0];
  const htmlEscape = pick(/^function htmlEscape[^\n]*$/m);
  const safeSiteUrl = pick(/^function safeSiteUrl[^\n]*$/m);
  const start = appJs.indexOf('const SAMPLE_HERO_SLIDES=');
  const end = appJs.indexOf('let heroTimer=null;');
  if (!htmlEscape || !safeSiteUrl || start < 0 || end < start) throw new Error('could not find the hero functions in app.js');
  const FAKE = 'https://armiag-build.invalid';
  const code = `var SITE_CONTENT=${JSON.stringify(Object.fromEntries(rows.map(row => [row.id, row])))};var heroReady=true;\n${htmlEscape}\n${safeSiteUrl}\n${appJs.slice(start, end)}\nheroSlider();`;
  const html = vm.runInNewContext(code, { location: { href: FAKE + '/', hostname: 'armiag.netlify.app' }, URL, String, Boolean }, { timeout: 2000 });
  return String(html).split(FAKE).join('');
}

function escapeAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

(async () => {
  const config = readConfig();
  let injection = '';
  let rows = null;
  if (!config.url || !config.key || /127\.0\.0\.1|localhost/.test(config.url)) {
    console.warn('WARNING: supabase-config.js has no real Supabase address, so the hero was not pre-loaded.');
  } else {
    try {
      rows = await fetchHomepage(config);
      const json = JSON.stringify(rows).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      injection += `<script>window.ARMIAG_PRELOAD=${json};</script>\n`;
      const hero = rows.find(row => row.id === 'hero');
      if (hero && hero.is_published && hero.image_url && /^https:\/\//.test(hero.image_url)) {
        injection += `<link rel="preload" as="image" fetchpriority="high" href="${escapeAttr(hero.image_url)}">\n`;
      }
      console.log(`Pre-loaded ${rows.length} homepage section(s) into index.html.`);
    } catch (error) {
      console.warn('WARNING: could not pre-load the hero (' + error.message + '). The site will load it the normal way.');
    }
  }
  const indexPath = path.join(OUT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  if (rows) {
    try {
      const heroHtml = prerenderHero(rows);
      if (heroHtml) {
        const guard = `<script>(function(){var p=location.hash.slice(1).split(/[\/?]/)[0];if(['collection','product','about','cart','checkout','track-order','contact'].indexOf(p)>-1){var a=document.getElementById('app');if(a)a.innerHTML='';document.body.classList.remove('is-home');}})();</script>`;
        const mainTag = '<main id="app" tabindex="-1"></main>';
        if (html.includes(mainTag)) {
          html = html.replace(mainTag, () => `<main id="app" tabindex="-1"><div class="page">${heroHtml}</div></main>\n  ${guard}`);
          html = html.replace('<body>', '<body class="is-home">');
          console.log('Hero written directly into index.html.');
        } else console.warn('WARNING: <main id="app"> not found, hero not written into the page.');
      }
    } catch (error) {
      console.warn('WARNING: could not write the hero into the page (' + error.message + ').');
    }
  }
  if (html.includes('<!--ARMIAG_PRELOAD-->')) html = html.replace('<!--ARMIAG_PRELOAD-->', () => injection);
  else html = html.replace('</head>', () => injection + '</head>');
  fs.writeFileSync(indexPath, html);
  console.log('Build finished. Output folder: dist');
})();
