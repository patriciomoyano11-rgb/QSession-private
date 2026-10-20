'use strict';

async function submitJson(path, body) {
  const response = await fetch(path, {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible enviar la información');
  return payload;
}

function status(id, message, error = false) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.classList.toggle('error', error);
}

document.getElementById('contentReportForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; status('contentReportStatus', 'Enviando de forma segura…');
  try {
    const result = await submitJson('/api/content-reports', {
      reporterName: document.getElementById('reporterName').value, reporterEmail: document.getElementById('reporterEmail').value,
      claimantRole: document.getElementById('claimantRole').value, roomCode: document.getElementById('reportedRoomCode').value,
      contentUrl: document.getElementById('reportedContentUrl').value, protectedWork: document.getElementById('protectedWork').value,
      explanation: document.getElementById('reportExplanation').value, goodFaith: document.getElementById('reportGoodFaith').checked,
      accuracy: document.getElementById('reportAccuracy').checked, signature: document.getElementById('reportSignature').value,
    });
    event.target.reset(); status('contentReportStatus', `Reporte recibido. Conserva esta referencia: ${result.report.id}`);
  } catch (error) { status('contentReportStatus', error.message, true); } finally { button.disabled = false; }
});

document.getElementById('contentAppealForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; status('contentAppealStatus', 'Enviando apelación…');
  try {
    const reportId = document.getElementById('appealReportId').value.trim();
    const result = await submitJson(`/api/content-reports/${encodeURIComponent(reportId)}/appeals`, {
      explanation: document.getElementById('appealExplanation').value, evidenceUrl: document.getElementById('appealEvidenceUrl').value,
      goodFaith: document.getElementById('appealGoodFaith').checked, signature: document.getElementById('appealSignature').value,
    });
    event.target.reset(); status('contentAppealStatus', `Apelación recibida: ${result.appeal.id}`);
  } catch (error) { status('contentAppealStatus', error.message, true); } finally { button.disabled = false; }
});
