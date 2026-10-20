'use strict';

function html(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createAccountMailer({
  apiKey = process.env.QSESSION_RESEND_API_KEY || '',
  from = process.env.QSESSION_RECOVERY_FROM_EMAIL || '',
  publicUrl = process.env.QSESSION_PUBLIC_URL || '',
  fetchImpl = fetch,
} = {}) {
  const safeApiKey = String(apiKey || '').trim();
  const safeFrom = String(from || '').trim();
  const safePublicUrl = String(publicUrl || '').trim().replace(/\/$/, '');
  const configured = Boolean(safeApiKey && safeFrom && safePublicUrl);

  async function deliver({to, subject, text, htmlBody}) {
    if (!configured) throw new Error('El correo de recuperación todavía no está configurado');
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${safeApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({from: safeFrom, to: [to], subject, text, html: htmlBody}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`El proveedor de correo respondió ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }
    return response.json().catch(() => ({}));
  }

  async function sendPasswordRecovery({recipient, code, expiresAt}) {
    const expiration = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
    }).format(new Date(expiresAt));
    const safeCode = html(code);
    return deliver({
      to: recipient,
      subject: 'Código para recuperar tu cuenta Q Session',
      text: `Tu código de recuperación Q Session es ${code}. Vence el ${expiration}. Si no solicitaste este cambio, ignora este mensaje.`,
      htmlBody: `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f6;color:#102746;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:36px 20px"><div style="background:#fff;border:1px solid #cbe1e1;border-radius:24px;padding:32px"><p style="margin:0 0 12px;color:#328493;font-size:12px;font-weight:800;letter-spacing:2px">Q SESSION · RECUPERAR ACCESO</p><h1 style="margin:0 0 16px;font-size:28px">Crea una nueva contraseña</h1><p style="color:#577487;line-height:1.6">Escribe este código en Q Session. Por seguridad sólo puede usarse una vez.</p><div style="margin:24px 0;padding:18px;border-radius:16px;background:#102746;color:#fff;font-size:30px;font-weight:900;letter-spacing:8px;text-align:center">${safeCode}</div><p style="color:#577487;font-size:13px">Vence el ${html(expiration)}. Si no pediste recuperar tu cuenta, no necesitas hacer nada.</p><a href="${html(`${safePublicUrl}/#profile`)}" style="display:inline-block;margin-top:12px;padding:13px 18px;border-radius:12px;background:#68d0d5;color:#102746;font-weight:800;text-decoration:none">Abrir Q Session</a></div></div></body></html>`,
    });
  }

  async function sendPasswordChanged({recipient}) {
    return deliver({
      to: recipient,
      subject: 'Tu contraseña de Q Session fue actualizada',
      text: 'La contraseña de tu cuenta Q Session fue actualizada. Si no fuiste tú, solicita una nueva recuperación inmediatamente.',
      htmlBody: `<!doctype html><html lang="es"><body style="margin:0;background:#f4f7f6;color:#102746;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:36px 20px"><div style="background:#fff;border:1px solid #cbe1e1;border-radius:24px;padding:32px"><p style="margin:0 0 12px;color:#328493;font-size:12px;font-weight:800;letter-spacing:2px">Q SESSION · SEGURIDAD</p><h1 style="margin:0 0 16px;font-size:28px">Contraseña actualizada</h1><p style="color:#577487;line-height:1.6">La contraseña de tu cuenta cambió correctamente. Si no fuiste tú, recupera el acceso de inmediato desde Q Session.</p><a href="${html(`${safePublicUrl}/#profile`)}" style="display:inline-block;margin-top:12px;padding:13px 18px;border-radius:12px;background:#68d0d5;color:#102746;font-weight:800;text-decoration:none">Abrir Q Session</a></div></div></body></html>`,
    });
  }

  return {configured, provider: configured ? 'resend' : 'none', sendPasswordRecovery, sendPasswordChanged};
}

module.exports = {createAccountMailer};
