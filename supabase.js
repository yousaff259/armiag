const config = window.ARMIAG_SUPABASE_CONFIG;
const key = config?.publishableKey?.trim();

if (config?.url && key && key.startsWith('sb_publishable_') && window.supabase?.createClient) {
  try {
    window.armiagSupabase = window.supabase.createClient(config.url, key);
    window.ARMIAG_SUPABASE_STATUS = { ready: true };
    window.dispatchEvent(new CustomEvent('armiag:supabase-ready'));
  } catch (error) {
    window.ARMIAG_SUPABASE_STATUS = { ready: false, message: error.message || 'Supabase client initialization failed.' };
    console.error('ARMIAG Supabase client initialization failed.', error);
  }
} else {
  const message = !window.supabase?.createClient
    ? 'The Supabase JavaScript client did not load. Check the network connection or CDN request.'
    : !config?.url
      ? 'The Supabase project URL is missing from supabase-config.js.'
      : !key || !key.startsWith('sb_publishable_')
        ? 'The Supabase publishable key is missing or has the wrong format in supabase-config.js.'
        : 'Supabase is not configured.';
  window.ARMIAG_SUPABASE_STATUS = { ready: false, message };
  console.error(message);
}
