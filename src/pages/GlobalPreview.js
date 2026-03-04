import { state, navigate } from '../services/state.js';
import { Renderer } from '../services/Renderer.js';
import { downloadPendingLogos, getPendingDownloadGroups } from '../services/dataSync.js';

export const renderGlobalPreview = async (container) => {
  const config = state.currentCampaignConfig;
  const slots = state.finalBuilderSlots;

  if (!config || !slots) { navigate('dashboard'); return; }

  const isSegmentMode = slots.type === 'segment';
  const segmentMap = isSegmentMode ? (slots.segments || {}) : null;
  const activeSegmentIds = isSegmentMode ? Object.keys(segmentMap) : [];
  const segmentNames = {};
  if (isSegmentMode) {
    (state.segments || []).forEach(s => { segmentNames[s.id] = s.name; });
  }
  const configSegments = config.segments || {};

  const cities = state.cities || [];

  if (cities.length === 0) {
    container.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F7F9;flex-direction:column;gap:1.5rem;">
      <p style="font-size:1.25rem;font-weight:700;color:#1E293B;">Nenhuma cidade encontrada na pasta "Cidades".</p>
      <button id="btn-empty" style="padding:0.875rem 2rem;background:#10B981;border:none;border-radius:0.75rem;color:white;font-weight:800;cursor:pointer;">IR AO DASHBOARD</button>
    </div>`;
    document.getElementById('btn-empty').onclick = () => navigate('dashboard');
    return;
  }

  container.innerHTML = `
      <div style="min-height:100vh;background:#F4F7F9;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="width: 50px; height: 50px; border: 5px solid #E2E8F0; border-top-color: #10B981; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <p id="preview-loading-text" style="margin-top:20px;font-weight:800;color:#1E293B;font-size:1.125rem;">Preparando Previews Globais...</p>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
      </div>
    `;

  const loadingTextEl = container.querySelector('#preview-loading-text');

  // Phase 2 Lazy Load - Fetch missing images before building previews
  const stats = getPendingDownloadGroups();
  if (stats.totalUniqueUrlsToDownload > 0 && loadingTextEl) {
    loadingTextEl.innerText = `Baixando ${stats.totalUniqueUrlsToDownload} logos pendentes...`;
    await downloadPendingLogos(stats.groups, (msg) => {
      loadingTextEl.innerText = msg;
    });
    loadingTextEl.innerText = 'Construindo Layouts...';
  }

  // Load custom fonts
  for (const typo of (state.typographies || [])) {
    try {
      const ff = new FontFace(typo.name, `url(${typo.data})`);
      const loaded = await ff.load();
      document.fonts.add(loaded);
    } catch (_) { }
  }

  const allLogos = state.logos || [];
  const allPhotos = state.cityPhotos || [];
  const allTop20 = state.top20Folders || [];
  const allSegmentLogos = state.segmentLogos || [];
  const allSegmentCities = state.segmentCities || [];

  // ─── Build city data ───────────────────────────────────────────────────
  const cityDataList = cities.map(city => {
    const cityName = city.name.trim();
    const top20Folder = allTop20.find(f => f.name.trim().toLowerCase() === cityName.toLowerCase());

    let cityLogos = [];
    let hasTop20Folder = !!top20Folder;
    if (top20Folder) {
      cityLogos = allLogos.filter(l => String(l.cityId) === String(top20Folder.id)).map(l => l.data);
    }

    const cityPhotoData = allPhotos.find(p => String(p.cityId) === String(city.id))?.data;
    const warnings = [];

    const normalize = (s) => (s || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    if (isSegmentMode) {
      // Segment mode: check each segment
      const normalizedCity = normalize(cityName);
      const matchingSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedCity);
      const segCityId = matchingSegCity ? matchingSegCity.id : null;

      const normalizedGeral = normalize('geral');
      const geralSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedGeral);
      const geralSegCityId = geralSegCity ? geralSegCity.id : null;

      for (const segId of activeSegmentIds) {
        let segLogos = segCityId ? allSegmentLogos.filter(l => String(l.cityId) === String(segCityId) && String(l.segmentId) === String(segId)) : [];

        // Fallback to "Geral" folder if city folder is empty or non-existent
        if (segLogos.length === 0 && geralSegCityId) {
          segLogos = allSegmentLogos.filter(l => String(l.cityId) === String(geralSegCityId) && String(l.segmentId) === String(segId));
        }

        if (segLogos.length === 0) {
          const segName = segmentNames[segId] || segId;
          warnings.push(`Sem logos para segmento "${segName}" (nem na pasta da cidade nem na "Geral")`);
        }
      }

      if (config.dynamicOptions?.cityImage && !cityPhotoData) {
        warnings.push('Sem imagem da cidade');
      }
    } else {
      // Single mode
      if (config.dynamicOptions?.useTop20) {
        if (!hasTop20Folder) {
          warnings.push('Sem pasta top20');
        }
        const feedSlots = slots.feed?.logos?.length || 0;
        const storySlots = slots.story?.logos?.length || 0;
        const maxSlotsReq = Math.max(feedSlots, storySlots);
        if (hasTop20Folder && cityLogos.length < maxSlotsReq) {
          warnings.push(`Faltam logos (tem ${cityLogos.length}, precisa de ${maxSlotsReq})`);
        }
      }
      if (config.dynamicOptions?.cityImage && !cityPhotoData) {
        warnings.push('Sem imagem da cidade');
      }
    }

    return {
      cityId: city.id,
      cityName,
      cityLogos,
      cityPhotoData,
      partnerCount: city.partnerCount || 0,
      warnings,
      status: warnings.length === 0 ? 'OK' : 'ALERTA',
      rendered: false
    };
  });

  let filterAlerts = false;
  let currentZoom = 1;
  let isPanning = false;

  // Destroy object URLs gracefully on exit
  const createdURLs = [];
  const pushURL = (url) => typeof url === 'string' && createdURLs.push(url);
  const navAndClean = (page) => {
    createdURLs.forEach(u => URL.revokeObjectURL(u));
    navigate(page);
  };

  // ─── Render UI ─────────────────────────────────────────────────────────
  const renderUI = () => {
    const filteredList = filterAlerts ? cityDataList.filter(c => c.warnings.length > 0) : cityDataList;
    const totalAlerts = cityDataList.filter(c => c.warnings.length > 0).length;
    const totalOk = cityDataList.length - totalAlerts;
    const totalImages = isSegmentMode
      ? cities.length * activeSegmentIds.length * 2
      : cities.length * 2;

    container.innerHTML = `
          <div style="min-height: 100vh; background: #F4F7F9; display: flex; flex-direction: column; box-sizing:border-box;">
            
            <!-- STICKY HEADER -->
            <div style="position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); border-bottom: 1px solid #E2E8F0; padding: 1.5rem 2.5rem; display:flex; justify-content:space-between; align-items:center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div>
                  <h1 style="font-size:1.75rem; font-weight:900; color:#0F172A; margin:0 0 0.25rem 0; letter-spacing:-0.02em;">Preview Global ${isSegmentMode ? '— Por Segmento' : ''}</h1>
                  <div style="display:flex; gap: 1rem; align-items:center;">
                      <span style="color:#64748B; font-weight:600; font-size:0.875rem;">${cities.length} Cidades</span>
                      ${isSegmentMode ? `<span style="color:#6366F1;font-weight:700;font-size:0.875rem;">${activeSegmentIds.length} Segmentos</span>` : ''}
                      <span style="color:#10B981; font-weight:700; font-size:0.875rem;">OK: ${totalOk}</span>
                      <span style="color:#D97706; font-weight:700; font-size:0.875rem;">Alertas: ${totalAlerts}</span>
                      <span style="color:#94A3B8; font-weight:600; font-size:0.8rem;">≈ ${totalImages} imagens</span>
                  </div>
                </div>
                <div style="display:flex; gap:1.25rem; align-items:center;">
                   <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; font-weight:600; color:#475569; cursor:pointer;" title="Inverter para ver apenas quem falhou a validação">
                      <input type="checkbox" id="toggle-alerts" ${filterAlerts ? 'checked' : ''} style="width:16px; height:16px;"> Mostrar apenas Alertas
                   </label>
                   <button id="btn-back-edit" style="padding:0.75rem 1.5rem; background:white; border:1px solid #CBD5E1; border-radius:0.75rem; color:#475569; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg> Voltar
                   </button>
                   <button id="btn-gen-zip" style="padding:0.75rem 2rem; background:#10B981; border:none; border-radius:0.75rem; color:white; font-weight:800; cursor:pointer;box-shadow:0 10px 25px -5px rgba(16,185,129,0.3); display:flex; align-items:center; gap:10px;">
                     Gerar ZIP Final <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                   </button>
                </div>
            </div>

            <!-- CITY LIST -->
            <div style="padding: 2.5rem; max-width: 1500px; margin: 0 auto; width: 100%;">
              <div style="display:flex; flex-direction:column; gap:2rem;" id="preview-grid">
                ${filteredList.map(c => renderCityCard(c)).join('')}
                ${filteredList.length === 0 ? '<div style="text-align:center; padding: 4rem; color:#64748B; font-weight:700;">Nenhuma cidade listada com este filtro.</div>' : ''}
              </div>
            </div>
          </div>

          <!-- MODAL Detalhado (Zoom & Pan) -->
          <div id="image-modal" style="display:none; position:fixed; inset:0; z-index:1000; background:rgba(15,23,42,0.95); flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(8px);">
              <div style="position:absolute; top: 1.5rem; right: 2rem; display:flex; gap:1rem; z-index:1010;">
                 <a id="modal-download" download="preview_completa.jpg" style="padding:0.75rem 1.5rem; background:#10B981; color:white; border-radius:0.5rem; text-decoration:none; font-weight:700; cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.3); display:flex; align-items:center; gap:8px;">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar Arte
                 </a>
                 <button id="modal-close" style="padding:0.75rem 1.5rem; background:white; color:#0F172A; border:none; border-radius:0.5rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:8px;">
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Fechar
                 </button>
              </div>
              
              <!-- Container Panorâmico -->
              <div id="modal-pan-container" style="width: 100vw; height: 100vh; overflow:hidden; display:flex; justify-content:center; align-items:center; position:relative;">
                  <img id="modal-img" src="" style="width: auto; height: 85vh; max-width:none; object-fit:contain; border-radius:8px; box-shadow:0 10px 40px rgba(0,0,0,0.5); transition: transform 0.1s; transform-origin: center center;" />
              </div>

              <!-- Controles Zoom -->
              <div style="position:absolute; bottom: 2rem; display:flex; gap: 0.5rem; background:rgba(255,255,255,0.1); padding:0.5rem 1rem; border-radius:2rem; backdrop-filter:blur(4px); box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                  <button id="modal-zoom-out" style="width:40px; height:40px; border-radius:50%; background:white; cursor:pointer; font-weight:bold; font-size:1.2rem; border:none; color:#0F172A; display:flex; align-items:center; justify-content:center;" title="Afastar">-</button>
                  <div style="display:flex; align-items:center; justify-content:center; font-weight:800; color:white; min-width:60px; font-size:0.9rem;" id="modal-zoom-text">100%</div>
                  <button id="modal-zoom-in" style="width:40px; height:40px; border-radius:50%; background:white; cursor:pointer; font-weight:bold; font-size:1.2rem; border:none; color:#0F172A; display:flex; align-items:center; justify-content:center;" title="Aproximar">+</button>
                  <div style="width:1px; background:rgba(255,255,255,0.3); margin:0 8px;"></div>
                  <button id="modal-pan" style="padding: 0 1.25rem; border-radius:1rem; background:white; cursor:pointer; font-weight:800; font-size:0.875rem; border:none; color:#0F172A; display:flex; align-items:center; gap:8px;">
                     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9c0-2.8 2.2-5 5-5s5 2.2 5 5v6"/><path d="M15 15c0 2.8-2.2 5-5 5s-5-2.2-5-5v-6"/><path d="M9 15v-6"/><path d="M15 15v-6"/><path d="M3 9h2M19 9h2"/></svg>
                     <span id="pan-label">Ativar Mover</span>
                  </button>
              </div>
          </div>
        `;

    attachEvents();
    initIntersectionObserver(filteredList);
  };

  // ─── Render a single city card ─────────────────────────────────────────
  const renderCityCard = (c) => {
    return `
      <div class="city-preview-card" data-city="${c.cityName}" style="background:white; border-radius:1.25rem; padding:1.5rem; box-shadow:0 4px 15px rgba(0,0,0,0.05); border:1px solid #E2E8F0; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; border-bottom:1px solid #F1F5F9; padding-bottom:0.75rem;">
           <h3 style="font-size:1.15rem; font-weight:800; color:#1E293B; margin:0;" title="${c.cityName}">${c.cityName}</h3>
           ${c.warnings.length === 0
        ? '<div style="background:#EBFDF5; color:#10B981; padding:4px 8px; border-radius:6px; font-size:0.7rem; font-weight:800; display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> OK</div>'
        : '<div style="background:#FFFBEB; color:#D97706; padding:4px 8px; border-radius:6px; font-size:0.7rem; font-weight:800; display:flex; align-items:center; gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> ALERTA</div>'
      }
        </div>
        ${c.warnings.length > 0 ? `
            <div style="margin-bottom:1rem; display:flex; flex-direction:column; gap:6px;">
                ${c.warnings.map(w => `<div style="font-size:0.75rem; font-weight:600; color:#D97706; background:#FFFBEB; border:1px solid #FDE68A; padding:6px 10px; border-radius:6px;">⚠️ ${w}</div>`).join('')}
            </div>
        ` : ''}

        <div id="container-${c.cityId}" style="display:flex; flex-direction:column; gap:1.25rem; flex:1;">
            <!-- Placeholders -->
            <div style="width: 100%; height: 180px; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:0.5rem; color:#94A3B8; font-size:0.875rem;">
              <div style="width: 24px; height: 24px; border: 3px solid #E2E8F0; border-top-color: #94A3B8; border-radius: 50%; animation: spin 1s linear infinite;"></div>
              Aguardando scroll...
            </div>
        </div>
      </div>
    `;
  };

  let observer = null;

  const attachEvents = () => {
    const toggle = document.getElementById('toggle-alerts');
    if (toggle) {
      toggle.onchange = (e) => {
        filterAlerts = e.target.checked;
        if (observer) observer.disconnect();
        renderUI();
      };
    }

    document.getElementById('btn-back-edit').onclick = () => navAndClean('template-builder');
    document.getElementById('btn-gen-zip').onclick = () => navAndClean('generation');

    // Modal Events
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const zoomText = document.getElementById('modal-zoom-text');
    const containerOverlay = document.getElementById('modal-pan-container');

    const updateZoomUI = () => {
      modalImg.style.transform = `scale(${currentZoom})`;
      zoomText.textContent = `${Math.round(currentZoom * 100)}%`;
    };

    document.getElementById('modal-close').onclick = () => {
      modal.style.display = 'none';
      currentZoom = 1;
      isPanning = false;
      updateZoomUI();
      modalImg.style.cursor = 'default';
      containerOverlay.style.overflow = 'hidden';
      modalImg.style.transform = `scale(1) translate(0px, 0px)`;
    };

    document.getElementById('modal-zoom-in').onclick = () => { currentZoom = Math.min(currentZoom + 0.5, 4); updateZoomUI(); };
    document.getElementById('modal-zoom-out').onclick = () => { currentZoom = Math.max(currentZoom - 0.5, 0.5); updateZoomUI(); };

    const panBtn = document.getElementById('modal-pan');
    const panLabel = document.getElementById('pan-label');

    panBtn.onclick = () => {
      isPanning = !isPanning;
      panLabel.textContent = isPanning ? 'Arrastando...' : 'Ativar Mover';
      modalImg.style.cursor = isPanning ? 'grab' : 'default';
      if (isPanning && currentZoom <= 1.5) {
        currentZoom = 2;
        updateZoomUI();
      }
    };

    // Custom Pan Logic purely with Mouse Events on wrapper
    let startX, startY, scrollLeft, scrollTop;

    modalImg.onmousedown = (e) => {
      if (!isPanning) return;
      e.preventDefault();
      modalImg.style.cursor = 'grabbing';
      containerOverlay.style.overflow = 'auto';

      startX = e.pageX - containerOverlay.offsetLeft;
      startY = e.pageY - containerOverlay.offsetTop;
      scrollLeft = containerOverlay.scrollLeft;
      scrollTop = containerOverlay.scrollTop;

      const onMouseMove = (ev) => {
        if (!isPanning) return;
        ev.preventDefault();
        const x = ev.pageX - containerOverlay.offsetLeft;
        const y = ev.pageY - containerOverlay.offsetTop;
        const walkX = (x - startX) * 2;
        const walkY = (y - startY) * 2;
        containerOverlay.scrollLeft = scrollLeft - walkX;
        containerOverlay.scrollTop = scrollTop - walkY;
      };

      const onMouseUp = () => {
        modalImg.style.cursor = isPanning ? 'grab' : 'default';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
  };

  window.openModal = (url) => {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const modalDown = document.getElementById('modal-download');
    modalImg.src = url;
    modalDown.href = url;
    modal.style.display = 'flex';
  };

  // ─── Renderização condicional using Renderer ───────────────────────────
  const renderCityPreview = async (cityData) => {
    const cId = `container-${cityData.cityId}`;
    const containerDiv = document.getElementById(cId);
    if (!containerDiv) return;

    const cityImgToPass = config.dynamicOptions?.cityImage ? cityData.cityPhotoData : null;

    let shortCityText = cityData.cityName;
    if (shortCityText.includes('Bom Jesus do Itabapoana')) {
      shortCityText = 'Bom Jesus';
    } else if (shortCityText.includes('São José do Vale do Rio Preto')) {
      shortCityText = 'São José';
    }

    const cityTextToPass = config.dynamicOptions?.useCityText ? shortCityText : null;
    const partnerCountToPass = config.dynamicOptions?.usePartnerCount ? (cityData.partnerCount || 0) : undefined;

    containerDiv.innerHTML = `
           <div style="width: 100%; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:0.5rem; color:#10B981; font-size:0.875rem; font-weight:700; padding:2rem;">
              <div style="width: 24px; height: 24px; border: 3px solid transparent; border-top-color: #10B981; border-radius: 50%; animation: spin 0.6s linear infinite;"></div>
              Renderizando ${isSegmentMode ? 'segmentos' : 'arte'}...
           </div>
        `;

    try {
      if (isSegmentMode) {
        // ─── Segment mode: render each segment section ─────────────
        const allSegmentLogos = state.segmentLogos || [];
        const allSegmentCities = state.segmentCities || [];
        const normalize = (s) => (s || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const normalizedCityName = normalize(cityData.cityName);
        const matchingSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedCityName);
        const segCityId = matchingSegCity ? matchingSegCity.id : null;

        const normalizedGeral = normalize('geral');
        const geralSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedGeral);
        const geralSegCityId = geralSegCity ? geralSegCity.id : null;

        const segHtml = [];
        for (const segId of activeSegmentIds) {
          const segSlots = segmentMap[segId];
          if (!segSlots) continue;

          // Fetch segment-specific logos: City -> Segment
          let cityLogos = segCityId ? allSegmentLogos.filter(l => String(l.cityId) === String(segCityId) && String(l.segmentId) === String(segId)).map(l => l.data) : [];

          // Fallback to "Geral" folder if city folder is empty or non-existent
          if (cityLogos.length === 0 && geralSegCityId) {
            cityLogos = allSegmentLogos.filter(l => String(l.cityId) === String(geralSegCityId) && String(l.segmentId) === String(segId)).map(l => l.data);
          }

          // Skip if no logos (per requirement) - NO FALLBACKS to anything else
          if (cityLogos.length === 0) continue;

          const segName = segmentNames[segId] || segId;
          const segTemplate = configSegments[segId] || {};

          let feedUrl = null;
          let storyUrl = null;

          if (segTemplate.feedTemplate) {
            const canvas = document.createElement('canvas');
            await Renderer.renderToCanvas(
              canvas, segTemplate.feedTemplate, cityImgToPass,
              { slots: segSlots.feed?.logos || [], data: cityLogos },
              { area: segSlots.feed?.cityText, imageArea: segSlots.feed?.cityImage, font: segSlots.feed?.cityText?.font, color: segSlots.feed?.cityText?.color },
              cityTextToPass, 'feed',
              { area: segSlots.feed?.partnerCount, font: segSlots.feed?.partnerCount?.font, color: segSlots.feed?.partnerCount?.color },
              partnerCountToPass
            );
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            feedUrl = URL.createObjectURL(blob);
            pushURL(feedUrl);
          }

          if (segTemplate.storyTemplate) {
            const sCanvas = document.createElement('canvas');
            await Renderer.renderToCanvas(
              sCanvas, segTemplate.storyTemplate, cityImgToPass,
              { slots: segSlots.story?.logos || [], data: cityLogos },
              { area: segSlots.story?.cityText, imageArea: segSlots.story?.cityImage, font: segSlots.story?.cityText?.font, color: segSlots.story?.cityText?.color },
              cityTextToPass, 'story',
              { area: segSlots.story?.partnerCount, font: segSlots.story?.partnerCount?.font, color: segSlots.story?.partnerCount?.color },
              partnerCountToPass
            );
            const blob = await new Promise(resolve => sCanvas.toBlob(resolve, 'image/jpeg', 0.85));
            storyUrl = URL.createObjectURL(blob);
            pushURL(storyUrl);
          }

          const commonStyle = "height:200px; border-radius:0.75rem; border:1px solid #E2E8F0; background:#F8FAFC; position:relative; cursor:zoom-in; box-shadow:0 4px 8px -2px rgba(0,0,0,0.08); overflow:hidden; transition: transform 0.2s; flex:1;";

          segHtml.push(`
            <div style="border:1px solid #E2E8F0; border-radius:0.875rem; padding:1rem; background:#FAFBFC;">
              <div style="font-size:0.8rem; font-weight:800; color:#1E293B; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem;">
                <div style="width:8px;height:8px;border-radius:50%;background:#10B981;"></div>
                ${segName}
              </div>
              <div style="display:flex; gap:1rem;">
                ${storyUrl ? `
                  <div style="${commonStyle}" onclick="window.openModal('${storyUrl}')" title="Story (9:16)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                     <img src="${storyUrl}" style="width:100%; height:100%; object-fit:contain; display:block;">
                     <div style="position:absolute; bottom:0; padding:4px; background:rgba(15,23,42,0.8); color:white; font-size:0.6rem; width:100%; text-align:center; font-weight:800;">STORY</div>
                  </div>
                ` : '<div style="flex:1;height:200px;display:flex;align-items:center;justify-content:center;background:#F1F5F9;border-radius:0.75rem;color:#94A3B8;font-size:0.7rem;font-weight:700;">Sem Story</div>'}
                ${feedUrl ? `
                  <div style="${commonStyle}" onclick="window.openModal('${feedUrl}')" title="Feed (4:5)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                     <img src="${feedUrl}" style="width:100%; height:100%; object-fit:contain; display:block;">
                     <div style="position:absolute; bottom:0; padding:4px; background:rgba(15,23,42,0.8); color:white; font-size:0.6rem; width:100%; text-align:center; font-weight:800;">FEED</div>
                  </div>
                ` : '<div style="flex:1;height:200px;display:flex;align-items:center;justify-content:center;background:#F1F5F9;border-radius:0.75rem;color:#94A3B8;font-size:0.7rem;font-weight:700;">Sem Feed</div>'}
              </div>
            </div>
          `);
        }

        containerDiv.innerHTML = segHtml.length > 0 ? segHtml.join('') : '<div style="color:#94A3B8; font-weight:600; text-align:center; padding:2rem;">Nenhum segmento configurado</div>';
        cityData.rendered = true;

      } else {
        // ─── Single mode (original behavior) ──────────────────────
        let feedDataUrl = null;
        let storyDataUrl = null;

        if (config.feedTemplate) {
          const canvas = document.createElement('canvas');
          await Renderer.renderToCanvas(
            canvas, config.feedTemplate, cityImgToPass,
            { slots: slots.feed?.logos || [], data: cityData.cityLogos },
            { area: slots.feed?.cityText, imageArea: slots.feed?.cityImage, font: slots.feed?.cityText?.font, color: slots.feed?.cityText?.color },
            cityTextToPass, 'feed',
            { area: slots.feed?.partnerCount, font: slots.feed?.partnerCount?.font, color: slots.feed?.partnerCount?.color },
            partnerCountToPass
          );
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          feedDataUrl = URL.createObjectURL(blob);
          pushURL(feedDataUrl);
        }

        if (config.storyTemplate) {
          const sCanvas = document.createElement('canvas');
          await Renderer.renderToCanvas(
            sCanvas, config.storyTemplate, cityImgToPass,
            { slots: slots.story?.logos || [], data: cityData.cityLogos },
            { area: slots.story?.cityText, imageArea: slots.story?.cityImage, font: slots.story?.cityText?.font, color: slots.story?.cityText?.color },
            cityTextToPass, 'story',
            { area: slots.story?.partnerCount, font: slots.story?.partnerCount?.font, color: slots.story?.partnerCount?.color },
            partnerCountToPass
          );
          const blob = await new Promise(resolve => sCanvas.toBlob(resolve, 'image/jpeg', 0.85));
          storyDataUrl = URL.createObjectURL(blob);
          pushURL(storyDataUrl);
        }

        const html = [];
        const commonStyle = "height:340px; border-radius:0.75rem; border:1px solid #E2E8F0; background:#F8FAFC; position:relative; cursor:zoom-in; box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); overflow:hidden; transition: transform 0.2s; flex:1;";

        if (storyDataUrl) {
          html.push(`
                  <div style="${commonStyle}" onclick="window.openModal('${storyDataUrl}')" title="Story (9:16) - Clique para Visualizar Inteira" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='translateY(0)'">
                     <img src="${storyDataUrl}" style="width:100%; height:100%; object-fit:contain; display:block;">
                     <div style="position:absolute; bottom:0; padding:6px; background:rgba(15,23,42,0.8); backdrop-filter:blur(4px); color:white; font-size:0.7rem; width:100%; text-align:center; font-weight:800; letter-spacing:0.05em; border-top:1px solid rgba(255,255,255,0.1);">STORY</div>
                  </div>
                `);
        }
        if (feedDataUrl) {
          html.push(`
                  <div style="${commonStyle}" onclick="window.openModal('${feedDataUrl}')" title="Feed (4:5) - Clique para Visualizar Inteira" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='translateY(0)'">
                     <img src="${feedDataUrl}" style="width:100%; height:100%; object-fit:contain; display:block;">
                     <div style="position:absolute; bottom:0; padding:6px; background:rgba(15,23,42,0.8); backdrop-filter:blur(4px); color:white; font-size:0.7rem; width:100%; text-align:center; font-weight:800; letter-spacing:0.05em; border-top:1px solid rgba(255,255,255,0.1);">FEED</div>
                  </div>
                `);
        }

        if (html.length === 0) {
          containerDiv.innerHTML = '<div style="color:#94A3B8; font-weight:600;">Nenhum formato selecionado</div>';
        } else {
          containerDiv.style.display = 'flex';
          containerDiv.style.flexDirection = 'row';
          containerDiv.style.gap = '1.5rem';
          containerDiv.innerHTML = html.join('');
          cityData.rendered = true;
        }
      }
    } catch (err) {
      console.error('Preview error for', cityData.cityName, err);
      containerDiv.innerHTML = '<div style="color:#EF4444; font-weight:700;">Erro na renderização. Cheque o Console.</div>';
    }
  };

  // Virtualização customizada por IntersectionObserver
  const initIntersectionObserver = (list) => {
    if (!window.IntersectionObserver) {
      list.forEach(c => renderCityPreview(c));
      return;
    }

    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const cityName = entry.target.dataset.city;
          const cData = list.find(c => c.cityName === cityName);
          if (cData && !cData.rendered) {
            cData.rendered = 'pending';
            renderCityPreview(cData);
          }
        }
      });
    }, {
      rootMargin: '800px 0px'
    });

    document.querySelectorAll('.city-preview-card').forEach(card => {
      observer.observe(card);
    });
  };

  renderUI();
};
