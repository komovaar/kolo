// Native forms retain server redirects and validation, with pending feedback.
export function initializeAuthForms() {
  const forms = [...document.querySelectorAll<HTMLFormElement>('.auth form')];
  for (const form of forms) {
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const label = submit.textContent;
    form.addEventListener('submit', (event) => {
      if (submit.disabled) { event.preventDefault(); return; }
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
      submit.textContent = form.action.endsWith('/join') ? 'Joining…' : 'Signing in…';
    });
    addEventListener('pageshow', () => {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.textContent = label;
    });
  }
}
