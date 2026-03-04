import { state, navigate } from '../services/state.js';
import { Renderer } from '../services/Renderer.js';
import { downloadPendingLogos, getPendingDownloadGroups } from '../services/dataSync.js';
import JSZip from 'jszip';

export const renderGeneration = (container) => {
  const config = state.currentCampaignConfig;
  const slots = state.finalBuilderSlots;

  if (!config || !slots) { navigate('dashboard'); return; }

  let progress = 0;
  let statusText = 'Gerando artes para as cidades...';
  let isDone = false;
  let zipBlob = null;
  let downloadUrl = null;
  const rawCampaignName = config.name || 'Campanha';
  const campaignName = rawCampaignName.trim();
  const campaignFileName = campaignName.replace(/[^\w\s\-áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ]/g, '').replace(/\s+/g, '_');

  const allCities = state.cities || [];
  const citiesStatus = allCities.map(c => ({ name: c.name, status: 'AGUARDANDO' }));

  if (allCities.length === 0) {
    container.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F7F9;flex-direction:column;gap:1rem;">
      <p style="font-size:1.25rem;font-weight:700;color:#1E293B;">Nenhuma cidade encontrada.</p>
      <button onclick="window.navDash()" style="padding:0.875rem 2rem;background:#10B981;border:none;border-radius:0.75rem;color:white;font-weight:800;cursor:pointer;">IR AO DASHBOARD</button>
    </div>`;
    window.navDash = () => navigate('dashboard');
    return;
  }

  const processCampaign = async () => {
    const zip = new JSZip();
    const campaignFolder = zip.folder(campaignFileName);
    const allLogos = state.logos || [];
    const allPhotos = state.cityPhotos || [];
    const allTop20 = state.top20Folders || [];
    const allSegmentLogos = state.segmentLogos || [];
    const allSegmentCities = state.segmentCities || [];
    const cities = allCities;

    const isSegmentMode = slots.type === 'segment';
    const segmentMap = isSegmentMode ? (slots.segments || {}) : null;
    const activeSegmentIds = isSegmentMode ? Object.keys(segmentMap) : [];
    const configSegments = config.segments || {};
    const segmentNames = {};
    if (isSegmentMode) {
      (state.segments || []).forEach(s => { segmentNames[s.id] = s.name; });
    }

    const imagesPerCity = isSegmentMode ? activeSegmentIds.length * 2 : 2;
    const total = cities.length * imagesPerCity;
    let current = 0;
    let successCount = 0;

    // Check for pending downloads (Phase 2 Lazy Loading)
    const stats = getPendingDownloadGroups();
    if (stats.totalUniqueUrlsToDownload > 0) {
      statusText = `Baixando ${stats.totalUniqueUrlsToDownload} logos pendentes...`;
      updateUI();
      await downloadPendingLogos(stats.groups, (msg) => {
        statusText = msg;
        updateUI();
      });
      statusText = 'Gerando artes para as cidades...';
      updateUI();
    }

    const canvas = document.createElement('canvas');

    // Load custom fonts
    for (const typo of (state.typographies || [])) {
      try {
        const ff = new FontFace(typo.name, `url(${typo.data})`);
        const loaded = await ff.load();
        document.fonts.add(loaded);
      } catch (_) { }
    }

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      const cityName = city.name.trim();
      const top20Folder = allTop20.find(f => f.name.trim().toLowerCase() === cityName.toLowerCase());

      citiesStatus[i].status = 'PROCESSANDO';
      updateUI();

      try {
        let cityLogos = []; // Top 20 logos for single mode
        if (!isSegmentMode && top20Folder) {
          cityLogos = allLogos.filter(l => String(l.cityId) === String(top20Folder.id)).map(l => l.data);
        }

        const cityPhotoData = allPhotos.find(p => String(p.cityId) === String(city.id))?.data;
        const cityImgToPass = config.dynamicOptions?.cityImage ? cityPhotoData : null;

        let shortCityText = cityName;
        if (shortCityText.includes('Bom Jesus do Itabapoana')) {
          shortCityText = 'Bom Jesus';
        } else if (shortCityText.includes('São José do Vale do Rio Preto')) {
          shortCityText = 'São José';
        }

        const cityTextToPass = config.dynamicOptions?.useCityText ? shortCityText : null;
        const partnerCountToPass = config.dynamicOptions?.usePartnerCount ? (city.partnerCount || 0) : undefined;

        const cityFolderName = cityName.replace(/[\/\\]/g, '-');
        let cityHasContent = false;
        let cityFolder = null;

        if (isSegmentMode) {
          // ─── Segment mode: iterate segments ───────────────────
          const normalize = (s) => (s || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const normalizedCityName = normalize(cityName);
          const matchingSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedCityName);
          const segCityId = matchingSegCity ? matchingSegCity.id : null;

          const normalizedGeral = normalize('geral');
          const geralSegCity = allSegmentCities.find(sc => normalize(sc.name) === normalizedGeral);
          const geralSegCityId = geralSegCity ? geralSegCity.id : null;

          for (const segId of activeSegmentIds) {
            const segSlots = segmentMap[segId];
            if (!segSlots) { continue; }

            // Fetch segment-specific logos: City -> Segment
            let currentSegLogos = segCityId ? allSegmentLogos.filter(l => String(l.cityId) === String(segCityId) && String(l.segmentId) === String(segId)).map(l => l.data) : [];

            // Fallback to "Geral" folder
            if (currentSegLogos.length === 0 && geralSegCityId) {
              currentSegLogos = allSegmentLogos.filter(l => String(l.cityId) === String(geralSegCityId) && String(l.segmentId) === String(segId)).map(l => l.data);
            }

            // Skip if no logos (per requirement) - NO FALLBACKS to anything else
            if (currentSegLogos.length === 0) {
              console.log(`⚠️ Pulando segmento ${segId} para ${cityName} (0 logos encontrado na pasta específica nem na Geral)`);
              continue;
            }

            if (!cityFolder) cityFolder = campaignFolder.folder(cityFolderName);
            const segTemplate = configSegments[segId] || {};
            const segName = (segmentNames[segId] || segId).replace(/[\/\\]/g, '-');
            const segFolder = cityFolder.folder(segName);

            // Feed
            if (segTemplate.feedTemplate) {
              await Renderer.renderToCanvas(
                canvas, segTemplate.feedTemplate, cityImgToPass,
                { slots: segSlots.feed?.logos || [], data: currentSegLogos },
                { area: segSlots.feed?.cityText, imageArea: segSlots.feed?.cityImage, font: segSlots.feed?.cityText?.font, color: segSlots.feed?.cityText?.color },
                cityTextToPass, 'feed',
                { area: segSlots.feed?.partnerCount, font: segSlots.feed?.partnerCount?.font, color: segSlots.feed?.partnerCount?.color },
                partnerCountToPass
              );
              const feedBlob = await Renderer.canvasToBlob(canvas);
              if (feedBlob.size > 100) {
                segFolder.file('feed.png', feedBlob);
                cityHasContent = true;
              }
            }

            // Story
            if (segTemplate.storyTemplate) {
              await Renderer.renderToCanvas(
                canvas, segTemplate.storyTemplate, cityImgToPass,
                { slots: segSlots.story?.logos || [], data: currentSegLogos },
                { area: segSlots.story?.cityText, imageArea: segSlots.story?.cityImage, font: segSlots.story?.cityText?.font, color: segSlots.story?.cityText?.color },
                cityTextToPass, 'story',
                { area: segSlots.story?.partnerCount, font: segSlots.story?.partnerCount?.font, color: segSlots.story?.partnerCount?.color },
                partnerCountToPass
              );
              const storyBlob = await Renderer.canvasToBlob(canvas);
              if (storyBlob.size > 100) {
                segFolder.file('story.png', storyBlob);
                cityHasContent = true;
              }
            }

            progress = Math.round((current / total) * 100);
            updateUI();

            // Yield to keep UI responsive
            await new Promise(r => setTimeout(r, 0));
          }
        } else {
          // ─── Single mode (original) ───────────────────────────
          await Renderer.renderToCanvas(
            canvas, config.feedTemplate, cityImgToPass,
            { slots: slots.feed?.logos || [], data: cityLogos },
            { area: slots.feed?.cityText, imageArea: slots.feed?.cityImage, font: slots.feed?.cityText?.font, color: slots.feed?.cityText?.color },
            cityTextToPass, 'feed',
            { area: slots.feed?.partnerCount, font: slots.feed?.partnerCount?.font, color: slots.feed?.partnerCount?.color },
            partnerCountToPass
          );
          const feedBlob = await Renderer.canvasToBlob(canvas);

          await Renderer.renderToCanvas(
            canvas, config.storyTemplate, cityImgToPass,
            { slots: slots.story?.logos || [], data: cityLogos },
            { area: slots.story?.cityText, imageArea: slots.story?.cityImage, font: slots.story?.cityText?.font, color: slots.story?.cityText?.color },
            cityTextToPass, 'story',
            { area: slots.story?.partnerCount, font: slots.story?.partnerCount?.font, color: slots.story?.partnerCount?.color },
            partnerCountToPass
          );
          const storyBlob = await Renderer.canvasToBlob(canvas);

          if (feedBlob.size < 100 || storyBlob.size < 100) {
            throw new Error(`Blobs too small: feed=${feedBlob.size}, story=${storyBlob.size}`);
          }

          cityFolder = campaignFolder.folder(cityFolderName);
          cityFolder.file('feed.png', feedBlob);
          cityFolder.file('story.png', storyBlob);
          cityHasContent = true;
          current += 2;
        }

        if (cityHasContent) {
          citiesStatus[i].status = 'CONCLUÍDO';
          successCount++;
          console.log(`✅ ${cityName} processado`);
        } else {
          citiesStatus[i].status = 'PULADO';
          console.log(`⚠️ ${cityName} pulado (sem conteúdo)`);
        }
      } catch (err) {
        console.error(`❌ Erro ao processar ${cityName}:`, err);
        citiesStatus[i].status = 'ERRO';
        current += (isSegmentMode ? imagesPerCity : 2);
      }

      progress = Math.round(((i + 1) / cities.length) * 100);
      updateUI();
    }

    // Only generate ZIP if at least one city succeeded
    if (successCount === 0) {
      statusText = 'Nenhuma cidade foi processada com sucesso.';
      isDone = true;
      updateUI();
      return;
    }

    try {
      const content = await zip.generateAsync({
        type: 'blob',
        compression: "STORE"
      });

      console.log(`📦 ZIP gerado: ${(content.size / 1024).toFixed(1)}KB, tipo: ${content.type}`);

      if (content.size < 500) {
        console.error('❌ ZIP muito pequeno, provavelmente vazio');
        statusText = 'Erro: ZIP gerado está vazio.';
        isDone = true;
        updateUI();
        return;
      }

      // Validate PK header immediately
      const header = new Uint8Array(await content.slice(0, 4).arrayBuffer());
      const isPK = header[0] === 0x50 && header[1] === 0x4B;
      console.log(`🔍 ZIP PK=${isPK}, header=${Array.from(header).map(b => b.toString(16)).join(' ')}`);
      if (!isPK) {
        statusText = 'Erro: ZIP corrompido.';
        isDone = true;
        updateUI();
        return;
      }

      zipBlob = content;
      // Pre-create the blob URL so the click handler is 100% synchronous
      // (Chrome only respects `a.download` attribute within a synchronous user gesture)
      downloadUrl = URL.createObjectURL(content);

      const newCampaign = {
        id: Date.now(),
        name: campaignName,
        type: config.type === 'single' ? 'Arte Única' : 'Por Segmento',
        date: new Date().toLocaleDateString('pt-BR'),
        cities: successCount,
        url: downloadUrl
      };
      state.campaigns = [newCampaign, ...state.campaigns].slice(0, 5);

      isDone = true;
      updateUI();
    } catch (zipErr) {
      console.error('❌ Erro ao gerar ZIP:', zipErr);
      statusText = 'Erro ao gerar o arquivo ZIP.';
      isDone = true;
      updateUI();
    }
  };

  let uiInitialized = false;

  const updateUI = () => {
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (progress / 100) * circumference;

    // ── First call: build the full HTML ──────────────────────────────────────
    if (!uiInitialized) {
      uiInitialized = true;
      container.innerHTML = `
        <div style="min-height: 100vh; background: #F4F7F9; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; animation: fadeIn 0.4s ease-out;">
          <div style="width: 100%; max-width: 480px; background: white; border-radius: 2.5rem; padding: 4rem 3rem; text-align: center; box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.08); position: relative; overflow: hidden;">
            <!-- Circular Progress -->
            <div style="position: relative; width: 170px; height: 170px; margin: 0 auto 3rem;">
              <svg style="transform: rotate(-90deg);" width="170" height="170" viewBox="0 0 170 170">
                <circle stroke="#E2E8F0" stroke-width="12" fill="transparent" r="${radius}" cx="85" cy="85"/>
                <circle id="gen-progress-arc" stroke="#10B981" stroke-width="12" stroke-linecap="round" fill="transparent" r="${radius}" cx="85" cy="85"
                  style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.5s cubic-bezier(0.4, 0, 0.2, 1);"/>
              </svg>
              <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                  <div id="gen-progress-pct" style="font-size: 2.75rem; font-weight: 900; color: #0F172A; line-height: 1;">${progress}%</div>
                  <div id="gen-progress-label" style="font-size: 0.7rem; font-weight: 800; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.15em; margin-top: 6px;">${isDone ? 'CONCLUÍDO' : 'PROCESSANDO'}</div>
              </div>
            </div>

            <h2 id="gen-title" style="font-size: 1.5rem; font-weight: 800; color: #1E293B; margin-bottom: 0.75rem;">${statusText}</h2>
            <p id="gen-subtitle" style="color: #64748B; font-size: 0.9375rem; line-height: 1.6; margin-bottom: 3rem;">
              Faltam apenas alguns instantes para processar todos os ativos.
            </p>

            <!-- City Status List -->
            <div id="gen-city-list" style="background: #F8FAFC; border: 1px solid #F1F5F9; border-radius: 1.5rem; overflow: hidden; margin-bottom: 3rem; max-height: 300px; overflow-y: auto; scrollbar-width: none;">
              ${renderCityList()}
            </div>

            <div id="gen-actions"></div>
          </div>

          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          </style>
        </div>
      `;
      attachActions();
      return;
    }

    // ── Subsequent calls: patch only the dynamic parts ───────────────────────
    const arcEl = document.getElementById('gen-progress-arc');
    if (arcEl) arcEl.style.strokeDashoffset = offset;

    const pctEl = document.getElementById('gen-progress-pct');
    if (pctEl) pctEl.textContent = `${progress}%`;

    const labelEl = document.getElementById('gen-progress-label');
    if (labelEl) labelEl.textContent = isDone ? 'CONCLUÍDO' : 'PROCESSANDO';

    const titleEl = document.getElementById('gen-title');
    if (titleEl) titleEl.textContent = isDone ? (zipBlob ? 'Concluído com sucesso!' : statusText) : statusText;

    const subtitleEl = document.getElementById('gen-subtitle');
    if (subtitleEl) {
      subtitleEl.innerHTML = isDone
        ? (zipBlob ? `Suas artes foram geradas. Arquivo: <strong>${campaignFileName}.zip</strong> (${(zipBlob.size / 1024 / 1024).toFixed(2)} MB)` : '')
        : 'Faltam apenas alguns instantes para processar todos os ativos.';
    }

    const cityListEl = document.getElementById('gen-city-list');
    if (cityListEl) cityListEl.innerHTML = renderCityList();

    if (isDone && downloadUrl) {
      const actionsEl = document.getElementById('gen-actions');
      if (actionsEl && !actionsEl.hasChildNodes()) {
        actionsEl.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 1.25rem;">
            <button id="btn-download-zip" style="width: 100%; padding: 1.25rem; border-radius: 1rem; font-weight: 800; font-size: 1rem; background: #10B981; color: white; display: flex; align-items: center; justify-content: center; gap: 0.75rem; box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4); text-decoration: none; cursor: pointer; border: none;">
              Baixar ${campaignFileName}.zip <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button id="btn-back-dash" style="font-size: 0.8125rem; font-weight: 800; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.1em; background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.625rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m15 18-6-6 6-6"/></svg> VOLTAR PARA DASHBOARD
            </button>
          </div>
        `;
        attachActions();
      }
    }
  };

  const renderCityList = () => {
    return citiesStatus.map((c, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; ${idx < citiesStatus.length - 1 ? 'border-bottom: 1px solid #F1F5F9;' : ''}">
        <div style="display: flex; align-items: center; gap: 1rem;">
           <div style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${c.status === 'CONCLUÍDO' ? '#EBFDF5' : c.status === 'ERRO' ? '#FEF2F2' : c.status === 'PROCESSANDO' ? '#F1F5F9' : 'white'}; border: 1px solid ${c.status === 'CONCLUÍDO' ? 'transparent' : c.status === 'ERRO' ? '#FECACA' : '#E2E8F0'}; color: ${c.status === 'CONCLUÍDO' ? '#10B981' : c.status === 'ERRO' ? '#EF4444' : '#CBD5E1'};">
               ${c.status === 'CONCLUÍDO' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"/></svg>' :
        c.status === 'ERRO' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg>' :
          c.status === 'PROCESSANDO' ? '<div style="width: 14px; height: 14px; border: 2px solid #64748B; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>' :
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/></svg>'}
           </div>
           <span style="font-size: 0.9375rem; font-weight: 700; color: #1E293B;">${c.name}</span>
        </div>
        <div style="background: ${c.status === 'CONCLUÍDO' ? '#EBFDF5' : c.status === 'ERRO' ? '#FEF2F2' : '#F1F5F9'}; color: ${c.status === 'CONCLUÍDO' ? '#10B981' : c.status === 'ERRO' ? '#EF4444' : '#94A3B8'}; padding: 0.25rem 0.75rem; border-radius: 2rem; font-size: 0.65rem; font-weight: 800; letter-spacing: 0.05em;">
          ${c.status}
        </div>
      </div>
    `).join('');
  };

  const attachActions = () => {
    const downloadBtn = container.querySelector('#btn-download-zip');
    if (downloadBtn) {
      downloadBtn.onclick = async () => {
        if (!downloadUrl || !zipBlob) return;

        const filename = `${campaignFileName}.zip`;

        // Strategy 1: Modern File System Access API
        if (window.showSaveFilePicker) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: filename,
              types: [{
                description: 'Arquivo ZIP',
                accept: { 'application/zip': ['.zip'] },
              }],
            });
            const writable = await handle.createWritable();
            await writable.write(zipBlob);
            await writable.close();
            return; // Success!
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.warn('showSaveFilePicker failed, trying fallback anchor logic:', err);
            } else {
              return; // User intentionally cancelled in the native dialog
            }
          }
        }

        // Strategy 2: Robust Fallback with blank target
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = filename;
        a.target = '_blank'; // Required to sometimes bypass Safari restrictions
        document.body.appendChild(a);

        try {
          a.click();
        } catch (e) {
          console.error('Fallback anchor click failed:', e);
          window.location.assign(downloadUrl);
        } finally {
          setTimeout(() => {
            if (document.body.contains(a)) document.body.removeChild(a);
          }, 500);
        }
      };
    }

    const dashBtn = container.querySelector('#btn-back-dash');
    if (dashBtn) {
      dashBtn.onclick = () => {
        navigate('dashboard');
      };
    }
  };

  updateUI();
  processCampaign();
};
