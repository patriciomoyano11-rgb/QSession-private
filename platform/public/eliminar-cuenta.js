'use strict';

const loginStep = document.querySelector('#loginStep');
const deleteStep = document.querySelector('#deleteStep');
const doneStep = document.querySelector('#doneStep');
const status = document.querySelector('#deletionStatus');
let verifiedEmail = '';

function setStatus(message, error = false) {
  status.textContent = message || '';
  status.classList.toggle('error', error);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No pudimos completar la solicitud.');
  return payload;
}

document.querySelector('#deletionLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  verifiedEmail = document.querySelector('#deletionEmail').value.trim();
  button.disabled = true;
  setStatus('Verificando tu cuenta…');
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({email: verifiedEmail, password: document.querySelector('#deletionLoginPassword').value, remember: false}),
    });
    loginStep.hidden = true;
    deleteStep.hidden = false;
    document.querySelector('#deletionPassword').focus();
    setStatus(`Cuenta verificada: ${verifiedEmail}`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#downloadDeletionData').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  setStatus('Preparando la copia de tus datos…');
  try {
    const response = await fetch('/api/account/export', {credentials: 'same-origin'});
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No pudimos preparar la descarga.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `qsession-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('La copia de tus datos fue descargada.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.querySelector('#deletionConfirmForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  if (document.querySelector('#deletionConfirmation').value.trim().toUpperCase() !== 'ELIMINAR') {
    setStatus('Escribe ELIMINAR para confirmar.', true);
    return;
  }
  button.disabled = true;
  setStatus('Eliminando tu cuenta y tus archivos personales…');
  try {
    await api('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({password: document.querySelector('#deletionPassword').value, confirmation: 'ELIMINAR'}),
    });
    deleteStep.hidden = true;
    doneStep.hidden = false;
    setStatus('Proceso terminado correctamente.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});
