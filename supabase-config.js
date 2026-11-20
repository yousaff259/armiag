/* Browser-safe Supabase settings. The publishable key is designed for frontend use.
   Never put a service_role key or database password in this file. */

window.ARMIAG_SUPABASE_CONFIG = {
  url: 'https://jbfvvkhhlvthavbnymrf.supabase.co',
  publishableKey: 'sb_publishable_dRhDLMPkY1fPkZoe4BImDw_ojV_Z7Sr',
  passwordRecoveryRedirectUrl: new URL('reset-password.html', window.location.href).href
};