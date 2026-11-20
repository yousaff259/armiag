(() => {
  const supabase = window.armiagSupabase;
  const form = document.querySelector('#resetForm');
  const message = document.querySelector('#resetMessage');
  const intro = document.querySelector('#resetIntro');
  const loginLink = document.querySelector('#adminLoginLink');
  const passwordInput = form.elements.password;
  const confirmInput = form.elements.confirmPassword;

  function showMessage(text, kind = 'error') {
    message.textContent = text;
    message.className = `form-message reset-message ${kind}`;
  }

  function clearCallbackFromAddressBar() {
    // Supabase needs the callback URL while it exchanges the recovery credential.
    // Remove every query/hash value after the SDK has finished handling it.
    history.replaceState(null, document.title, `${location.pathname}`);
  }

  async function initialize() {
    if (!supabase) {
      intro.textContent = 'The password reset could not be started.';
      showMessage(window.ARMIAG_SUPABASE_STATUS?.message || 'Supabase did not load. Check your connection and try again.');
      return;
    }

    const callbackParams = new URLSearchParams(`${location.search.slice(1)}&${location.hash.slice(1)}`);
    const isRecoveryCallback = callbackParams.get('type') === 'recovery' || callbackParams.has('code');
    const callbackFailed = callbackParams.has('error');
    try {
      // getSession waits for the Supabase client to process the URL callback.
      // Do not print or persist callback values; clear them as soon as processed.
      const { data, error } = await supabase.auth.getSession();
      clearCallbackFromAddressBar();
      if (callbackFailed || error || !isRecoveryCallback || !data.session) {
        intro.textContent = 'This recovery link is no longer available.';
        showMessage(callbackFailed || !data.session
          ? 'The link may have expired or already been used. Request a fresh password reset from the administrator sign-in page.'
          : 'Supabase could not verify this recovery link. Request a fresh password reset and try again.');
        return;
      }
      intro.textContent = 'Enter and confirm a new password for your administrator account.';
      form.hidden = false;
    } catch (_) {
      clearCallbackFromAddressBar();
      intro.textContent = 'This recovery link could not be verified.';
      showMessage('The link may have expired, or Supabase could not be reached. Request a fresh password reset and try again.');
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    message.textContent = '';
    if (passwordInput.value.length < 8) {
      showMessage('Choose a password with at least 8 characters.');
      passwordInput.focus();
      return;
    }
    if (passwordInput.value !== confirmInput.value) {
      showMessage('The passwords do not match. Check both entries and try again.');
      confirmInput.focus();
      return;
    }

    const button = document.querySelector('#savePasswordButton');
    button.disabled = true;
    button.textContent = 'Saving securely…';
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordInput.value });
      if (error) throw error;
      passwordInput.value = '';
      confirmInput.value = '';
      form.hidden = true;
      intro.textContent = 'Your administrator password has been updated.';
      showMessage('Password changed successfully. Sign in with your new password to continue.', 'success');
      // End the recovery session so this one-time page does not leave the admin signed in.
      try { await supabase.auth.signOut(); } catch (_) { /* Password update already succeeded. */ }
      loginLink.focus();
    } catch (error) {
      showMessage(/password.*(weak|short|length)|weak.*password/i.test(error?.message || '')
        ? 'Supabase requires a stronger password. Choose a longer password with a mix of characters.'
        : /fetch|network/i.test(error?.message || '')
          ? 'Could not reach Supabase. Check your connection and try again.'
          : 'Supabase could not update the password. The recovery link may have expired; request a new one and try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Save new password';
    }
  });

  initialize();
})();
