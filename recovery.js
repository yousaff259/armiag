(() => {
  const supabase = window.armiagSupabase;
  const button = document.querySelector('#forgotPasswordButton');
  const emailInput = document.querySelector('#loginForm [name="email"]');
  const message = document.querySelector('#recoveryMessage');
  if (!button || !emailInput || !message) return;

  const showStatus = (text, state) => {
    message.textContent = text;
    message.dataset.state = state;
  };

  button.addEventListener('click', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      showStatus('Enter a valid administrator email address above.', 'error');
      emailInput.reportValidity();
      emailInput.focus();
      return;
    }
    if (!supabase) {
      showStatus(window.ARMIAG_SUPABASE_STATUS?.message || 'The Supabase client is not initialized. Check the Supabase scripts and configuration.', 'error');
      return;
    }
    const redirectTo = window.ARMIAG_SUPABASE_CONFIG?.passwordRecoveryRedirectUrl;
    const expectedRedirect = new URL('reset-password.html', window.location.href).href;
    if (!redirectTo || redirectTo !== expectedRedirect) {
      showStatus('The recovery redirect URL does not match this site’s reset page.', 'error');
      return;
    }

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    showStatus('Sending your password recovery request to Supabase…', 'loading');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        const detail = error.message || 'Supabase returned an unspecified error.';
        const code = error.code ? ` (${error.code})` : '';
        showStatus(`Supabase error${code}: ${detail}`, 'error');
        return;
      }
      showStatus('Supabase accepted the recovery request. If an account exists for this address, check its inbox for the reset link.', 'success');
    } catch (error) {
      const detail = error?.message || 'An unexpected request error occurred.';
      showStatus(`Supabase request error: ${detail}`, 'error');
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
})();
