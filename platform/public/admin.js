(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const labels = {
    activeNow: 'Activos ahora',
    visitors: 'Usuarios únicos',
    sessions: 'Visitas',
    pageViews: 'Pantallas vistas',
    featureUses: 'Funciones utilizadas',
    clientErrors: 'Errores detectados',
    accounts: 'Cuentas',
    visibleProfiles: 'Perfiles visibles',
    rooms: 'Salas creadas',
    liveRooms: 'Salas en vivo',
    archivedRooms: 'Salas finalizadas',
    roomJoins: 'Ingresos a salas',
    peakListeners: 'Mayor audiencia',
    roomMessages: 'Mensajes de sala',
    privateMessages: 'Mensajes privados',
    profileInteractions: 'Interacciones',
  };
  const featureLabels = {
    'view:live': 'En vivo',
    'view:people': 'Personas',
    'view:chat': 'Chat',
    'view:global': 'Rave global',
    'view:profile': 'Perfil',
    'view:create': 'Crear sesión',
    'form:joinRoomForm': 'Entrar a una sala',
    'form:createRoomForm': 'Crear una sala',
    'control:startBroadcast': 'Iniciar transmisión',
    'control:stopBroadcast': 'Cerrar transmisión',
    'control:toggleListenerSound': 'Control de sonido',
    'control:toggleListenerCamera': 'Cámara del oyente',
    'control:copyRoomInvitation': 'Copiar invitación',
    'control:shareRoomInvitation': 'Compartir invitación',
    'control:downloadAndroidButton': 'Descargar Android',
    'control:installAppButton': 'Instalar aplicación',
  };
  const musicFamilyLabels = {
    electronic: 'Electrónica', latin: 'Latina', afro: 'Afro y global', urban: 'Urbana',
    pop: 'Pop y celebración', ambient: 'Chill y ambiental', wellness: 'Bienestar',
    instrumental: 'Instrumental', rock: 'Rock y metal',
  };
  let adminMusicTracks = [];
  let adminMusicDeleteTarget = null;

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {'content-type': 'application/json', ...(options.headers || {})},
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'No fue posible completar la solicitud');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showLogin(message = '', isError = false) {
    byId('adminDashboard').hidden = true;
    byId('adminRecoveryForm').hidden = true;
    byId('adminLogin').hidden = false;
    byId('adminLoginStatus').textContent = message;
    byId('adminLoginStatus').classList.toggle('error', isError);
    if (!message) byId('adminUsername').focus();
  }

  function showRecovery(message = '', isError = false) {
    byId('adminDashboard').hidden = true;
    byId('adminLoginForm').hidden = true;
    byId('adminRecoveryForm').hidden = false;
    byId('adminRecoveryUsername').value = byId('adminUsername').value;
    byId('adminRecoveryStatus').textContent = message;
    byId('adminRecoveryStatus').classList.toggle('error', isError);
    byId('adminRecoveryUsername').focus();
  }

  function showDashboard() {
    byId('adminLoginStatus').textContent = '';
    byId('adminLoginStatus').classList.remove('error');
    byId('adminLogin').hidden = true;
    byId('adminDashboard').hidden = false;
  }

  function number(value, fallback = '—') {
    return Number.isFinite(Number(value)) ? new Intl.NumberFormat('es').format(Number(value)) : fallback;
  }

  function money(cents) {
    return new Intl.NumberFormat('es-CO', {style: 'currency', currency: 'COP', maximumFractionDigits: 0}).format((Number(cents) || 0) / 100);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function metricCard(value, label) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    const strong = document.createElement('strong');
    strong.textContent = number(value, '0');
    const span = document.createElement('span');
    span.textContent = label;
    card.append(strong, span);
    return card;
  }

  function musicTime(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  function musicOption(select, value, label) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }

  function syncAdminMusicFilters() {
    const genreSelect = byId('adminMusicGenre');
    const subgenreSelect = byId('adminMusicSubgenre');
    const selectedGenre = genreSelect.value;
    const selectedSubgenre = subgenreSelect.value;
    const genres = [...new Set(adminMusicTracks.map(track => track.genre || musicFamilyLabels[track.family] || 'Sin clasificar'))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    genreSelect.replaceChildren(); musicOption(genreSelect, '', 'Todos los géneros');
    genres.forEach(genre => musicOption(genreSelect, genre, genre));
    if (genres.includes(selectedGenre)) genreSelect.value = selectedGenre;
    const subgenres = [...new Set(adminMusicTracks
      .filter(track => !genreSelect.value || (track.genre || musicFamilyLabels[track.family] || 'Sin clasificar') === genreSelect.value)
      .map(track => track.subgenre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    subgenreSelect.replaceChildren(); musicOption(subgenreSelect, '', 'Todos los subgéneros');
    subgenres.forEach(subgenre => musicOption(subgenreSelect, subgenre, subgenre));
    if (subgenres.includes(selectedSubgenre)) subgenreSelect.value = selectedSubgenre;
  }

  function renderAdminMusic() {
    const tracks = adminMusicTracks.slice();
    const genres = new Set(tracks.map(track => track.genre || musicFamilyLabels[track.family] || 'Sin clasificar'));
    byId('adminMusicTrackCount').textContent = number(tracks.length, '0');
    byId('adminMusicGenreCount').textContent = number(genres.size, '0');
    byId('adminMusicPendingCount').textContent = number(tracks.filter(track => !track.classification?.reviewed).length, '0');
    syncAdminMusicFilters();
    const query = byId('adminMusicSearch').value.trim().toLocaleLowerCase('es');
    const wantedGenre = byId('adminMusicGenre').value;
    const wantedSubgenre = byId('adminMusicSubgenre').value;
    const normalized = value => String(value || '').toLocaleLowerCase('es');
    const visible = tracks.filter(track => {
      const genre = track.genre || musicFamilyLabels[track.family] || 'Sin clasificar';
      const haystack = [track.title, track.artist, genre, track.subgenre, track.mood, track.rhythm].map(normalized).join(' ');
      return (!query || haystack.includes(query)) && (!wantedGenre || genre === wantedGenre) && (!wantedSubgenre || track.subgenre === wantedSubgenre);
    });
    const sort = byId('adminMusicSort').value;
    visible.sort((a, b) => sort === 'recent'
      ? String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      : sort === 'title' ? String(a.title).localeCompare(String(b.title), 'es')
        : sort === 'bpm' ? Number(a.bpm || 0) - Number(b.bpm || 0) || String(a.title).localeCompare(String(b.title), 'es')
          : String(a.genre || '').localeCompare(String(b.genre || ''), 'es') || String(a.subgenre || '').localeCompare(String(b.subgenre || ''), 'es') || String(a.title).localeCompare(String(b.title), 'es'));
    const container = byId('adminMusicGroups'); container.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'music-manager-empty';
      empty.textContent = tracks.length ? 'No hay canciones que coincidan con estos filtros.' : 'La biblioteca todavía está vacía. Usa “Agregar música” para incorporar tu primera carpeta.';
      container.append(empty); return;
    }
    const grouped = new Map();
    visible.forEach(track => {
      const genre = track.genre || musicFamilyLabels[track.family] || 'Sin clasificar';
      if (!grouped.has(genre)) grouped.set(genre, []); grouped.get(genre).push(track);
    });
    grouped.forEach((items, genre) => {
      const group = document.createElement('details'); group.className = 'music-genre-group'; group.open = grouped.size === 1 || Boolean(wantedGenre || query);
      const summary = document.createElement('summary');
      const heading = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = genre;
      const subgenres = [...new Set(items.map(track => track.subgenre).filter(Boolean))];
      const subtitle = document.createElement('small'); subtitle.textContent = subgenres.length ? subgenres.join(' · ') : 'Sin subgénero';
      const count = document.createElement('span'); count.textContent = `${items.length} ${items.length === 1 ? 'canción' : 'canciones'}`;
      heading.append(title, subtitle); summary.append(heading, count); group.append(summary);
      const list = document.createElement('div'); list.className = 'music-track-admin-list';
      items.forEach(track => {
        const row = document.createElement('article'); row.className = 'music-track-admin-row'; row.dataset.trackId = track.id;
        const main = document.createElement('div'); main.className = 'music-track-admin-main';
        const name = document.createElement('strong'); name.textContent = track.title || 'Pista sin título';
        const artist = document.createElement('span'); artist.textContent = track.artist || 'Autor sin identificar'; main.append(name, artist);
        const classification = document.createElement('div'); classification.className = 'music-track-admin-classification';
        const subgenre = document.createElement('strong'); subgenre.textContent = track.subgenre || 'Sin subgénero';
        const character = document.createElement('span'); character.textContent = [track.mood, track.rhythm, `energía ${track.energy || '—'}/5`].filter(Boolean).join(' · '); classification.append(subgenre, character);
        const meta = document.createElement('span'); meta.className = 'music-track-admin-meta'; meta.textContent = `${track.bpm || '—'} BPM · ${musicTime(track.duration)}`;
        const review = document.createElement('span'); review.className = `music-track-review${track.classification?.reviewed ? ' is-reviewed' : ''}`; review.textContent = track.classification?.reviewed ? 'Revisada' : 'Por revisar';
        const actions = document.createElement('div'); actions.className = 'music-track-admin-actions';
        const edit = document.createElement('button'); edit.type = 'button'; edit.dataset.editTrack = track.id; edit.textContent = '✎ Editar'; edit.setAttribute('aria-label', `Editar ${track.title}`);
        const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.deleteTrack = track.id; remove.textContent = '− Retirar'; remove.setAttribute('aria-label', `Retirar ${track.title}`);
        actions.append(edit, remove); row.append(main, classification, meta, review, actions); list.append(row);
      });
      group.append(list); container.append(group);
    });
  }

  async function loadAdminMusic() {
    const result = await api('/api/admin/music/tracks');
    adminMusicTracks = Array.isArray(result.tracks) ? result.tracks : [];
    renderAdminMusic();
  }

  function openAdminMusicEditor(track) {
    byId('adminMusicEditId').value = track.id;
    byId('adminMusicEditTitle').value = track.title || '';
    byId('adminMusicEditArtist').value = track.artist || '';
    byId('adminMusicEditFamily').value = musicFamilyLabels[track.family] ? track.family : 'electronic';
    byId('adminMusicEditGenre').value = track.genre || musicFamilyLabels[track.family] || '';
    byId('adminMusicEditSubgenre').value = track.subgenre || '';
    byId('adminMusicEditBpm').value = track.bpm || 124;
    byId('adminMusicEditEnergy').value = track.energy || 3;
    byId('adminMusicEditMood').value = track.mood || '';
    byId('adminMusicEditRhythm').value = track.rhythm || '';
    byId('adminMusicEditStatus').textContent = '';
    byId('adminMusicEditor').showModal();
  }

  function renderOverview(overview) {
    const container = byId('overviewCards');
    container.replaceChildren();
    ['activeNow', 'visitors', 'sessions', 'pageViews', 'featureUses', 'clientErrors']
      .forEach(key => container.append(metricCard(overview[key], labels[key])));
  }

  function renderEdgeStatus(status) {
    const panel = byId('edgeStatusPanel');
    const broadcast = status?.scale?.broadcast || {};
    const economical = broadcast.configured && broadcast.deliveryMode === 'object-storage';
    const fallback = broadcast.configured && broadcast.deliveryMode === 'local-origin';
    panel.dataset.state = economical ? 'ready' : fallback ? 'warning' : 'error';
    byId('edgeStatusBadge').textContent = economical ? 'R2 activo' : fallback ? 'Respaldo local' : 'Sin borde';
    const details = [
      broadcast.provider ? `Proveedor: ${broadcast.provider}` : null,
      broadcast.segmentDuration ? `segmentos de ${number(broadcast.segmentDuration)} s` : null,
      broadcast.estimatedViewerGigabytesPerHour != null
        ? `${number(broadcast.estimatedViewerGigabytesPerHour)} GB por espectador-hora`
        : null,
    ].filter(Boolean).join(' · ');
    byId('edgeStatusCopy').textContent = economical
      ? `La audiencia usa almacenamiento de objetos con egreso económico. ${details}`
      : fallback
        ? `Atención: la señal aún sale del servidor y puede generar ancho de banda costoso. ${details}`
        : 'La audiencia depende de WebRTC. Configura R2 antes de vender eventos masivos.';
  }

  function renderSurfaces(surfaces) {
    const container = byId('surfaceCards');
    container.replaceChildren();
    surfaces.forEach(surface => {
      const card = document.createElement('section');
      card.className = 'surface-card';
      const title = document.createElement('h3');
      title.textContent = surface.name === 'web' ? 'Página web' : surface.name === 'android' ? 'Android' : 'Windows';
      const values = document.createElement('div');
      values.className = 'surface-values';
      [['visitors', 'Usuarios'], ['sessions', 'Visitas'], ['events', 'Acciones']].forEach(([key, label]) => {
        const item = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = number(surface[key], '0');
        const span = document.createElement('span');
        span.textContent = label;
        item.append(strong, span);
        values.append(item);
      });
      const detail = document.createElement('p');
      detail.className = 'surface-detail';
      const network = surface.network || {};
      const parts = [];
      if (network.averageRttMs != null) parts.push(`Latencia ${number(network.averageRttMs)} ms`);
      if (network.averagePacketLossPercent != null) parts.push(`Pérdida ${number(network.averagePacketLossPercent)}%`);
      if (surface.features?.[0]) parts.push(`Principal: ${featureLabels[surface.features[0].name] || surface.features[0].name.replace(/^control:/, '')}`);
      detail.textContent = parts.join(' · ') || 'Recopilando uso y calidad de conexión.';
      card.append(title, values, detail);
      container.append(card);
    });
  }

  function renderNetwork(network) {
    const entries = [
      [network.samples, 'Muestras'],
      [network.onlinePercent == null ? null : `${number(network.onlinePercent)}%`, 'Tiempo conectado'],
      [network.averageRttMs == null ? null : `${number(network.averageRttMs)} ms`, 'Latencia media'],
      [network.averagePacketLossPercent == null ? null : `${number(network.averagePacketLossPercent)}%`, 'Pérdida media'],
      [network.averageDownlinkMbps == null ? null : `${number(network.averageDownlinkMbps)} Mbps`, 'Capacidad estimada'],
      [network.averageDownloadKbps == null ? null : `${number(network.averageDownloadKbps)} kbps`, 'Audio recibido'],
    ];
    const container = byId('networkMetrics');
    container.replaceChildren();
    entries.forEach(([value, label]) => {
      const item = document.createElement('div');
      item.className = 'network-item';
      const strong = document.createElement('strong');
      strong.textContent = value == null ? '—' : String(value);
      const span = document.createElement('span');
      span.textContent = label;
      item.append(strong, span);
      container.append(item);
    });
  }

  function renderDaily(points) {
    const container = byId('dailyChart');
    container.replaceChildren();
    if (!points.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Todavía no hay actividad suficiente para mostrar una tendencia.';
      container.append(empty);
      return;
    }
    const maximum = Math.max(1, ...points.map(point => point.events));
    points.forEach(point => {
      const column = document.createElement('div');
      column.className = 'daily-column';
      column.title = `${point.date}: ${number(point.events)} acciones, ${number(point.visitors)} usuarios`;
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(3, Math.round(point.events / maximum * 170))}px`;
      const label = document.createElement('span');
      label.textContent = point.date.slice(5);
      column.append(bar, label);
      container.append(column);
    });
  }

  function renderRanking(containerId, entries, labeler = value => value, countLabeler = value => number(value)) {
    const container = byId(containerId);
    container.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Todavía no hay datos para este periodo.';
      container.append(empty);
      return;
    }
    const maximum = Math.max(1, ...entries.map(entry => entry.count));
    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'ranking-row';
      const name = document.createElement('strong');
      name.textContent = labeler(entry.name);
      const count = document.createElement('b');
      count.textContent = countLabeler(entry.count);
      const bar = document.createElement('i');
      bar.style.setProperty('--width', `${Math.max(2, Math.round(entry.count / maximum * 100))}%`);
      row.append(name, count, bar);
      container.append(row);
    });
  }

  function renderProduct(product) {
    const container = byId('productMetrics');
    container.replaceChildren();
    Object.entries(product).forEach(([key, value]) => {
      const item = document.createElement('div');
      item.className = 'product-item';
      const strong = document.createElement('strong');
      strong.textContent = number(value, '0');
      const span = document.createElement('span');
      span.textContent = labels[key] || key;
      item.append(strong, span);
      container.append(item);
    });
  }

  function renderBilling(result) {
    const billing = result.billing;
    const stars = result.stars || {};
    const configuration = result.configuration;
    byId('billingConfiguration').textContent = configuration.checkoutConfigured && configuration.eventsConfigured
      ? `${configuration.environment === 'prod' ? 'Producción' : 'Sandbox'} · Checkout y confirmaciones conectados · ${configuration.store}`
      : 'Configuración incompleta: los precios pueden editarse, pero todavía no se recibirá dinero real.';

    const cards = byId('billingCards');
    cards.replaceChildren();
    [
      [money(billing.revenueCents), 'Ventas aprobadas'],
      [number(billing.orders.approved, '0'), 'Pagos aprobados'],
      [number(billing.orders.pending, '0'), 'Pagos pendientes'],
      [number(billing.credits.available, '0'), 'Bonos disponibles'],
      [number(billing.credits.reserved, '0'), 'Bonos reservados'],
      [number(billing.credits.consumed, '0'), 'Salas consumidas'],
    ].forEach(([value, label]) => {
      const card = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = value;
      const span = document.createElement('span'); span.textContent = label;
      card.append(strong, span); cards.append(card);
    });

    if (stars.settings) {
      byId('starCopValue').value = stars.settings.copPerStar;
      byId('starArtistShare').value = stars.settings.artistSharePercent;
      byId('starSponsorReward').value = stars.settings.sponsorRewardStars;
      byId('starSponsorDailyLimit').value = stars.settings.sponsorDailyLimit;
      byId('starSponsorSeconds').value = stars.settings.sponsorMinimumViewSeconds;
      const starMetrics = byId('starAdminMetrics');
      starMetrics.replaceChildren();
      [
        [number(stars.totals?.purchased, '0'), 'Estrellas compradas'],
        [number(stars.totals?.tipped, '0'), 'Estrellas enviadas'],
        [number(stars.totals?.rewarded, '0'), 'Premios de sponsors'],
        [number(stars.totals?.approvedOrders, '0'), 'Compras aprobadas'],
      ].forEach(([value, label]) => {
        const card = document.createElement('div');
        const strong = document.createElement('strong'); strong.textContent = value;
        const span = document.createElement('span'); span.textContent = label;
        card.append(strong, span); starMetrics.append(card);
      });
    }

    const plans = byId('billingPlanList');
    plans.replaceChildren();
    const editablePlans = billing.plans.filter(plan => !String(plan.id).startsWith('custom-quote-'));
    editablePlans.forEach(plan => {
      const form = document.createElement('form');
      form.className = 'billing-plan-form';
      form.dataset.planId = plan.id;
      form.innerHTML = `
        <header><div><small>${escapeHtml(plan.id)}</small><strong>${escapeHtml(plan.name)}</strong></div><span>v${number(plan.revision, 1)}</span></header>
        <div class="billing-plan-fields">
          <label>Nombre<input name="name" maxlength="100" required /></label>
          <label>Público<select name="segment"><option value="event">Evento único</option><option value="professional">Profesionales</option><option value="business">Comercios</option><option value="enterprise">Gran escala</option><option value="membership">Mensualidades</option></select></label>
          <label>Precio COP<input name="pricePesos" type="number" min="0" step="100" required /></label>
          <label>Personas<input name="maxParticipants" type="number" min="1" max="50000" required /></label>
          <label>Duración (min)<input name="durationMinutes" type="number" min="15" max="1440" required /></label>
          <label>Bonos por compra<input name="creditsPerPurchase" type="number" min="1" max="100" required /></label>
          <label>Orden<input name="sortOrder" type="number" min="-10000" max="10000" required /></label>
          <label>Modalidad<select name="billingInterval"><option value="one_time">Pago individual</option><option value="monthly">Mensual (renovación manual)</option></select></label>
          <label class="billing-plan-description">Descripción<input name="description" maxlength="300" /></label>
          <label class="billing-plan-active"><input name="highlighted" type="checkbox" /> Recomendado</label>
          <label class="billing-plan-active"><input name="active" type="checkbox" /> Disponible para comprar</label>
        </div>
        <footer><span class="status" role="status"></span><button type="submit">Guardar cambios</button></footer>`;
      form.elements.name.value = plan.name;
      form.elements.segment.value = plan.segment || 'event';
      form.elements.pricePesos.value = Math.round(plan.priceCents / 100);
      form.elements.maxParticipants.value = plan.maxParticipants;
      form.elements.durationMinutes.value = plan.durationMinutes;
      form.elements.creditsPerPurchase.value = plan.creditsPerPurchase;
      form.elements.sortOrder.value = plan.sortOrder;
      form.elements.billingInterval.value = plan.billingInterval;
      form.elements.description.value = plan.description;
      form.elements.highlighted.checked = Boolean(plan.highlighted);
      form.elements.active.checked = plan.active;
      plans.append(form);
    });

    const creditPlan = byId('creditPlan');
    const selectedPlan = creditPlan.value;
    creditPlan.replaceChildren(...editablePlans.map(plan => {
      const option = document.createElement('option');
      option.value = plan.id; option.textContent = `${plan.name} · ${money(plan.priceCents)}`;
      return option;
    }));
    if (editablePlans.some(plan => plan.id === selectedPlan)) creditPlan.value = selectedPlan;

    const orders = byId('billingOrderList');
    orders.replaceChildren();
    if (!billing.recentOrders.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Todavía no se registraron pagos.'; orders.append(empty);
    }
    billing.recentOrders.forEach(order => {
      const row = document.createElement('div'); row.className = 'billing-order-row';
      const main = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = order.planSnapshot?.name || order.planId;
      const small = document.createElement('small'); small.textContent = `${order.customerEmail || order.accountId} · ${order.reference}`;
      main.append(strong, small);
      const amount = document.createElement('b'); amount.textContent = money(order.amountCents);
      const status = document.createElement('span'); status.dataset.status = order.status; status.textContent = order.status;
      row.append(main, amount, status); orders.append(row);
    });
  }

  function renderContentReports(reports = []) {
    const container = byId('contentReportList');
    container.replaceChildren();
    if (!reports.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No hay reportes de propiedad intelectual.'; container.append(empty); return;
    }
    reports.forEach(report => {
      const form = document.createElement('form'); form.className = 'content-report-row'; form.dataset.reportId = report.id;
      const heading = document.createElement('div'); heading.className = 'content-report-heading';
      const title = document.createElement('strong'); title.textContent = report.protectedWork || 'Contenido reportado';
      const meta = document.createElement('small'); meta.textContent = `${report.id} · sala ${report.roomCode || 'sin código'} · ${new Date(report.createdAt).toLocaleString('es')}`;
      const badge = document.createElement('span'); badge.dataset.status = report.status; badge.textContent = report.status;
      heading.append(title, meta, badge);
      const explanation = document.createElement('p'); explanation.textContent = report.explanation;
      const contact = document.createElement('small'); contact.textContent = `${report.reporterName} · ${report.reporterEmail}`;
      const appeal = report.appeals?.at(-1);
      const appealText = document.createElement('p'); appealText.className = 'content-report-appeal'; appealText.textContent = appeal ? `Apelación: ${appeal.explanation}` : 'Sin apelación.';
      const controls = document.createElement('div'); controls.className = 'content-report-controls';
      const select = document.createElement('select'); select.name = 'decision';
      [['reviewing','En revisión'],['dismissed','Desestimar'],['upheld','Confirmar y suspender'],['restored','Revertir medida']].forEach(([value,label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; if (report.status === value) option.selected = true; select.append(option); });
      const note = document.createElement('input'); note.name = 'note'; note.maxLength = 1200; note.placeholder = 'Motivo de la decisión'; note.value = report.resolutionNote || '';
      const button = document.createElement('button'); button.type = 'submit'; button.textContent = 'Guardar decisión';
      const state = document.createElement('span'); state.className = 'status';
      controls.append(select, note, button); form.append(heading, explanation, contact, appealText, controls, state); container.append(form);
    });
  }

  async function loadDashboard() {
    byId('adminStatus').textContent = 'Actualizando métricas…';
    byId('adminStatus').classList.remove('error');
    try {
      const [result, billingResult, platformStatus, moderationResult, musicResult] = await Promise.all([
        api(`/api/admin/analytics?days=${encodeURIComponent(byId('adminPeriod').value)}`),
        api('/api/admin/billing'),
        api('/api/status'),
        api('/api/admin/content-reports'),
        api('/api/admin/music/tracks'),
      ]);
      const analytics = result.analytics;
      showDashboard();
      renderOverview(analytics.overview);
      renderSurfaces(analytics.surfaces);
      renderNetwork(analytics.network);
      renderDaily(analytics.daily);
      renderRanking('featureList', analytics.features, value => featureLabels[value] || value.replace(/^control:/, '').replace(/^route:/, 'Sección: '));
      renderRanking('versionList', analytics.versions, value => value, value => `${number(value)} eventos`);
      renderProduct(analytics.product);
      renderBilling(billingResult);
      renderEdgeStatus(platformStatus);
      renderContentReports(moderationResult.reports);
      adminMusicTracks = Array.isArray(musicResult.tracks) ? musicResult.tracks : [];
      renderAdminMusic();
      byId('adminGeneratedAt').textContent = `Actualizado ${new Intl.DateTimeFormat('es', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(analytics.generatedAt))}`;
      byId('adminStatus').textContent = '';
    } catch (error) {
      if (error.status === 401) return showLogin('Tu sesión administrativa terminó. Ingresa nuevamente.', true);
      byId('adminStatus').textContent = error.message;
      byId('adminStatus').classList.add('error');
    }
  }

  byId('adminLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    byId('adminLoginStatus').textContent = 'Verificando…';
    byId('adminLoginStatus').classList.remove('error');
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({username: byId('adminUsername').value, password: byId('adminPassword').value}),
      });
      byId('adminPassword').value = '';
      await loadDashboard();
    } catch (error) {
      showLogin(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  byId('adminRecoveryOpen').addEventListener('click', () => showRecovery());
  byId('adminRecoveryCancel').addEventListener('click', () => {
    byId('adminRecoveryForm').reset();
    byId('adminLoginForm').hidden = false;
    showLogin();
  });
  byId('adminRecoveryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    const nextPassword = byId('adminRecoveryPassword').value;
    if (nextPassword !== byId('adminRecoveryConfirm').value) {
      byId('adminRecoveryStatus').textContent = 'Las contraseñas nuevas no coinciden.';
      byId('adminRecoveryStatus').classList.add('error');
      return;
    }
    button.disabled = true;
    byId('adminRecoveryStatus').textContent = 'Actualizando acceso…';
    byId('adminRecoveryStatus').classList.remove('error');
    try {
      const username = byId('adminRecoveryUsername').value;
      await api('/api/admin/recover', {
        method: 'POST',
        body: JSON.stringify({
          username,
          recoveryCode: byId('adminRecoveryCode').value,
          newPassword: nextPassword,
        }),
      });
      byId('adminRecoveryForm').reset();
      byId('adminUsername').value = username;
      byId('adminLoginForm').hidden = false;
      showLogin('Contraseña actualizada. Ya puedes ingresar con la nueva contraseña.');
    } catch (error) {
      showRecovery(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  byId('adminRefresh').addEventListener('click', loadDashboard);
  byId('adminBillingRefresh').addEventListener('click', loadDashboard);
  byId('adminPeriod').addEventListener('change', loadDashboard);
  const adminSections = [...document.querySelectorAll('.admin-section')];
  const adminSectionButtons = [...document.querySelectorAll('[data-admin-section-target]')];

  function syncAdminSectionNavigation() {
    adminSectionButtons.forEach(button => {
      const active = Boolean(byId(button.dataset.adminSectionTarget)?.open);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  adminSections.forEach(section => section.addEventListener('toggle', () => {
    if (section.open) adminSections.forEach(other => { if (other !== section) other.open = false; });
    syncAdminSectionNavigation();
  }));
  adminSectionButtons.forEach(button => button.addEventListener('click', () => {
    const section = byId(button.dataset.adminSectionTarget);
    section.open = true;
    syncAdminSectionNavigation();
    section.scrollIntoView({behavior:'smooth', block:'start'});
  }));
  syncAdminSectionNavigation();
  byId('adminMusicSearch').addEventListener('input', renderAdminMusic);
  byId('adminMusicGenre').addEventListener('change', () => { byId('adminMusicSubgenre').value = ''; renderAdminMusic(); });
  byId('adminMusicSubgenre').addEventListener('change', renderAdminMusic);
  byId('adminMusicSort').addEventListener('change', renderAdminMusic);
  byId('adminMusicGroups').addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-track]');
    if (edit) { const track = adminMusicTracks.find(item => item.id === edit.dataset.editTrack); if (track) openAdminMusicEditor(track); return; }
    const remove = event.target.closest('[data-delete-track]');
    if (!remove) return;
    adminMusicDeleteTarget = adminMusicTracks.find(item => item.id === remove.dataset.deleteTrack) || null;
    if (!adminMusicDeleteTarget) return;
    byId('adminMusicDeleteCopy').textContent = `¿Quieres retirar “${adminMusicDeleteTarget.title}” de la biblioteca?`;
    byId('adminMusicDeleteStatus').textContent = '';
    byId('adminMusicDeleteDialog').showModal();
  });
  document.querySelectorAll('[data-close-admin-music]').forEach(button => button.addEventListener('click', () => byId('adminMusicEditor').close()));
  byId('adminMusicEditorForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]'); const status = byId('adminMusicEditStatus');
    button.disabled = true; status.textContent = 'Guardando clasificación…'; status.classList.remove('error');
    try {
      await api(`/api/admin/music/tracks/${encodeURIComponent(byId('adminMusicEditId').value)}`, {method:'PATCH', body:JSON.stringify({
        title:byId('adminMusicEditTitle').value, artist:byId('adminMusicEditArtist').value,
        family:byId('adminMusicEditFamily').value, genre:byId('adminMusicEditGenre').value,
        subgenre:byId('adminMusicEditSubgenre').value, bpm:Number(byId('adminMusicEditBpm').value),
        energy:Number(byId('adminMusicEditEnergy').value), mood:byId('adminMusicEditMood').value,
        rhythm:byId('adminMusicEditRhythm').value,
      })});
      await loadAdminMusic(); byId('adminMusicEditor').close();
      byId('adminMusicStatus').textContent = 'Clasificación guardada. El qDJ ya usará estos datos.';
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { button.disabled = false; }
  });
  byId('adminMusicDeleteCancel').addEventListener('click', () => { adminMusicDeleteTarget = null; byId('adminMusicDeleteDialog').close(); });
  byId('adminMusicDeleteConfirm').addEventListener('click', async event => {
    if (!adminMusicDeleteTarget) return; const button = event.currentTarget; const status = byId('adminMusicDeleteStatus');
    button.disabled = true; status.textContent = 'Retirando canción…'; status.classList.remove('error');
    try {
      const title = adminMusicDeleteTarget.title;
      await api(`/api/admin/music/tracks/${encodeURIComponent(adminMusicDeleteTarget.id)}`, {method:'DELETE'});
      adminMusicDeleteTarget = null; await loadAdminMusic(); byId('adminMusicDeleteDialog').close();
      byId('adminMusicStatus').textContent = `“${title}” fue retirada de la biblioteca y movida a la papelera técnica.`;
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { button.disabled = false; }
  });
  window.addEventListener('qsession:music-imported', () => void loadAdminMusic().catch(error => { byId('adminMusicStatus').textContent = error.message; byId('adminMusicStatus').classList.add('error'); }));
  byId('starSettingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    const status = byId('starSettingsStatus');
    button.disabled = true; status.textContent = 'Guardando…'; status.classList.remove('error');
    try {
      await api('/api/admin/stars/settings', {method: 'PATCH', body: JSON.stringify({
        copPerStar: Number(byId('starCopValue').value),
        artistSharePercent: Number(byId('starArtistShare').value),
        sponsorRewardStars: Number(byId('starSponsorReward').value),
        sponsorDailyLimit: Number(byId('starSponsorDailyLimit').value),
        sponsorMinimumViewSeconds: Number(byId('starSponsorSeconds').value),
      })});
      status.textContent = 'Economía de estrellas actualizada.';
      await loadDashboard();
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { button.disabled = false; }
  });
  byId('contentReportList').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target.closest('.content-report-row'); if (!form) return;
    const button = event.submitter; const state = form.querySelector('.status'); button.disabled = true; state.textContent = 'Guardando…'; state.classList.remove('error');
    try {
      const result = await api(`/api/admin/content-reports/${encodeURIComponent(form.dataset.reportId)}`, {method: 'PATCH', body: JSON.stringify({decision: form.elements.decision.value, note: form.elements.note.value})});
      state.textContent = result.activeStrikes >= 3 ? 'Medida aplicada y cuenta suspendida.' : `Decisión guardada · ${result.activeStrikes} advertencias activas.`;
      await loadDashboard();
    } catch (error) { state.textContent = error.message; state.classList.add('error'); } finally { button.disabled = false; }
  });
  byId('billingPlanList').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target.closest('.billing-plan-form');
    if (!form) return;
    const button = event.submitter;
    const status = form.querySelector('.status');
    button.disabled = true; status.textContent = 'Guardando…'; status.classList.remove('error');
    try {
      await api(`/api/admin/billing/plans/${encodeURIComponent(form.dataset.planId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.elements.name.value,
          segment: form.elements.segment.value,
          description: form.elements.description.value,
          priceCents: Math.round(Number(form.elements.pricePesos.value) * 100),
          maxParticipants: Number(form.elements.maxParticipants.value),
          durationMinutes: Number(form.elements.durationMinutes.value),
          creditsPerPurchase: Number(form.elements.creditsPerPurchase.value),
          sortOrder: Number(form.elements.sortOrder.value),
          billingInterval: form.elements.billingInterval.value,
          highlighted: form.elements.highlighted.checked,
          active: form.elements.active.checked,
        }),
      });
      status.textContent = 'Precio y condiciones actualizados.';
      await loadDashboard();
    } catch (error) {
      status.textContent = error.message; status.classList.add('error');
    } finally { button.disabled = false; }
  });
  byId('adminCreditForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    const status = byId('creditStatus');
    button.disabled = true; status.textContent = 'Registrando bono…'; status.classList.remove('error');
    try {
      await api('/api/admin/billing/credits', {method: 'POST', body: JSON.stringify({
        accountId: byId('creditAccount').value,
        planId: byId('creditPlan').value,
        units: Number(byId('creditUnits').value),
        reason: byId('creditReason').value,
      })});
      event.target.reset(); byId('creditUnits').value = '1'; status.textContent = 'Bono entregado y registrado.';
      await loadDashboard();
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { button.disabled = false; }
  });
  byId('adminLogout').addEventListener('click', async () => {
    await api('/api/admin/logout', {method: 'POST', body: '{}'}).catch(() => undefined);
    showLogin('Sesión administrativa cerrada.');
  });

  api('/api/admin/session')
    .then(loadDashboard)
    .catch(() => showLogin());
  window.setInterval(() => {
    if (!byId('adminDashboard').hidden && !document.hidden) void loadDashboard();
  }, 60_000);
})();
