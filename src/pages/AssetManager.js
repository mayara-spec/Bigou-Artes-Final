import { state, loadState, subscribe, clearStateDB } from '../services/state.js';
import { optimizeLogo, optimizeCityPhoto } from '../utils/imageOptimizer.js';
import { saveCityPhoto, getCityPhoto, deleteCityPhoto, saveTop20Logo, deleteTop20Logo, deleteTop20LogosByCity, getTop20LogoBlob, saveSegmentLogo, deleteSegmentLogo, deleteSegmentLogosByCity, getSegmentLogoBlob, saveFont, getFontBlob, deleteFont, clearDB, clearSpreadsheetData } from '../services/db.js';
import { syncSQLData, retryFailedDownloads, downloadPendingLogos, getPendingDownloadGroups } from '../services/dataSync.js';

let storageInfo = { usage: 0, quota: 0, percent: 0, loaded: false };

export const renderAssetManager = (container) => {
  const am = state.assetManager;

  // Global handlers for inline onclicks
  window.selectCity = (id, type) => {
    state.assetManager = { ...state.assetManager, selectedFolderCityId: id, folderViewType: type || 'photos' };
  };

  window.deleteCity = (id, type) => {
    state.assetManager = {
      ...state.assetManager,
      showDeleteConfirm: true,
      deleteId: id,
      deleteType: type
    };
  };

  window.confirmDelete = () => {
    const { deleteId: id, deleteType: type } = state.assetManager;
    console.log(`[AssetManager] Deleting ${type} with id: ${id}`);

    if (type === 'top20') {
      deleteTop20LogosByCity(id).catch(console.error);
      state.top20Folders = state.top20Folders.filter(c => String(c.id) !== String(id));

      const relatedLogos = state.logos.filter(l => String(l.cityId) === String(id));
      relatedLogos.forEach(logo => { if (logo.memoryUrl) URL.revokeObjectURL(logo.data) });
      state.logos = state.logos.filter(l => String(l.cityId) !== String(id));
    } else if (type === 'segments') {
      deleteSegmentLogosByCity(id).catch(console.error);
      state.segmentCities = state.segmentCities.filter(c => String(c.id) !== String(id));

      const relatedLogos = state.segmentLogos.filter(l => String(l.cityId) === String(id));
      relatedLogos.forEach(logo => { if (logo.memoryUrl) URL.revokeObjectURL(logo.data) });
      state.segmentLogos = state.segmentLogos.filter(l => String(l.cityId) !== String(id));
    } else {
      deleteCityPhoto(id).catch(console.error);
      state.cities = state.cities.filter(c => String(c.id) !== String(id));

      const relatedPhotos = state.cityPhotos.filter(p => String(p.cityId) === String(id));
      relatedPhotos.forEach(p => { if (p.memoryUrl) URL.revokeObjectURL(p.data) });
      state.cityPhotos = state.cityPhotos.filter(p => String(p.cityId) !== String(id));
    }

    // Reset selection if deleted
    if (String(state.assetManager.selectedFolderCityId) === String(id)) {
      state.assetManager = {
        ...state.assetManager,
        selectedFolderCityId: null,
        selectedSegmentId: null,
        showDeleteConfirm: false,
        deleteId: null,
        deleteType: null
      };
    } else {
      state.assetManager = {
        ...state.assetManager,
        showDeleteConfirm: false,
        deleteId: null,
        deleteType: null
      };
    }
  };

  window.cancelDelete = () => {
    state.assetManager = {
      ...state.assetManager,
      showDeleteConfirm: false,
      deleteId: null,
      deleteType: null
    };
  };

  window.clearAllData = () => {
    state.assetManager = { ...state.assetManager, showClearAllConfirm: true };
  };

  window.closeClearAll = () => {
    state.assetManager = { ...state.assetManager, showClearAllConfirm: false };
  };

  window.confirmClearAllData = async () => {
    try {
      // Show loading
      const btn = document.getElementById('confirm-reset-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loader-inline"></span> Apagando...';
      }

      // 1. Clear Asset DB (Cities, Logos, Fonts, etc)
      await clearDB();

      // 2. Clear State DB (app_state)
      await clearStateDB();

      // 3. Clear memory URLs
      [...state.cityPhotos, ...state.segmentLogos, ...state.logos, ...state.typographies]
        .forEach(f => { if (f.memoryUrl && f.data) { try { URL.revokeObjectURL(f.data); } catch (e) { } } });

      // 4. Clear all storages
      localStorage.clear();
      sessionStorage.clear();

      // 5. Reload to fresh state
      window.location.reload();
    } catch (err) {
      console.error("[AssetManager] Failed to clear data:", err);
      alert("Erro ao apagar dados: " + err.message);
      window.closeClearAll();
    }
  };

  window.clearSpreadsheetData = () => {
    state.assetManager = { ...state.assetManager, showClearSpreadsheetConfirm: true };
  };

  window.closeClearSpreadsheet = () => {
    state.assetManager = { ...state.assetManager, showClearSpreadsheetConfirm: false };
  };

  window.confirmClearSpreadsheetData = async () => {
    try {
      const btn = document.getElementById('confirm-spreadsheet-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loader-inline"></span> Limpando...';
      }

      await clearSpreadsheetData();

      // Clean memory URLs
      [...state.logos, ...state.segmentLogos].forEach(l => {
        if (l.memoryUrl && l.data) { try { URL.revokeObjectURL(l.data); } catch (e) { } }
      });

      // Reset state variables derived from spreadsheet
      state.logos = [];
      state.segmentLogos = [];
      state.top20Folders = [];
      state.segmentCities = state.segmentCities.filter(c => c.id === 'geral'); // Keep 'Geral'
      state.cities = state.cities.map(c => ({ ...c, partnerCount: 0 }));

      // Setting flag to false will trigger update via Proxy, but we call update() to be sure
      state.assetManager = { ...state.assetManager, showClearSpreadsheetConfirm: false };
    } catch (err) {
      console.error("[AssetManager] Selective clear error:", err);
      alert("Erro ao limpar dados: " + err.message);
      window.closeClearSpreadsheet();
    }
  };

  const loadStorageInfo = () => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(est => {
        const usageMB = (est.usage / (1024 * 1024)).toFixed(1);
        const quotaMB = (est.quota / (1024 * 1024)).toFixed(0);
        const percent = ((est.usage / est.quota) * 100).toFixed(1);
        storageInfo = { usage: usageMB, quota: quotaMB, percent, loaded: true };
        const el = container.querySelector('#storage-info-label');
        if (el) el.innerHTML = `Armazenamento: <b>${percent}%</b> (${usageMB} / ${quotaMB} MB)`;
      });
    }
  };

  const renderTabs = () => {
    const tabs = [
      { id: 'cities', label: 'Cidades' },
      { id: 'top20', label: 'Top 20' },
      { id: 'segments', label: 'Segmentos' },
      { id: 'partners', label: 'Parceiros' },
      { id: 'typography', label: 'Tipografias' },
    ];

    return `
      <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); margin-bottom: 2rem;">
        <div style="display: flex;">
          ${tabs.map(tab => `
            <button class="tab-item" data-tab="${tab.id}" style="
              padding: 1rem 1.5rem;
              color: ${am.activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)'};
              border-bottom: 2px solid ${am.activeTab === tab.id ? 'var(--accent)' : 'transparent'};
              font-weight: 500;
              cursor: pointer;
              background: none;
              position: relative;
            ">
              ${tab.label}
            </button>
          `).join('')}
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem; padding-bottom: 0.5rem;">
           <span id="storage-info-label" style="font-size: 0.75rem; color: #64748B; margin-right: 0.5rem;">
             ${storageInfo.loaded ? `Armazenamento: <b>${storageInfo.percent}%</b> (${storageInfo.usage} / ${storageInfo.quota} MB)` : 'Calculando armazenamento...'}
           </span>
           <button class="btn btn-secondary" id="btn-import-sql" style="padding: 0.5rem 1rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
             Importar SQL
           </button>

           <button class="btn btn-secondary" onclick="window.clearSpreadsheetData()" style="padding: 0.5rem 1rem; color: #EF4444; background: #FEF2F2; font-size: 0.75rem; border: 1px solid #FECACA;">🧹 Limpar Planilha</button>
           <button class="btn btn-secondary" onclick="window.clearAllData()" style="padding: 0.5rem 1rem; border-color: #FECACA; color: #EF4444; background: #FEF2F2; font-size: 0.75rem;">Limpar Tudo</button>
           <input type="file" id="sql-import-input" style="display: none;" accept=".csv,.txt,.sql">
        </div>
      </div>
    `;
  };

  const renderCities = () => {
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1.25rem;">Minhas Cidades</h3>
        <button class="btn btn-primary" id="btn-add-city">Nova Cidade</button>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.5rem;">
        ${state.cities.length === 0 ? '<div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-muted); border: 1px dashed var(--border); border-radius: 0.75rem;">Nenhuma cidade cadastrada.</div>' :
        state.cities.map(city => `
          <div class="card city-card" style="padding: 0; overflow: hidden; cursor: pointer;" data-id="${city.id}">
            <div style="height: 140px; background: var(--bg-tertiary); position: relative;" class="city-card-header">
               ${city.image ? `<img src="${city.image}" style="width: 100%; height: 100%; object-fit: cover;">` : `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted);">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7m4 0h6m-3-3v6M9 11l3 3L22 4"/></svg>
                  <span style="font-size: 0.75rem; margin-top: 8px;">Clique para Ver Pasta</span>
                </div>
               `}
              <div style="position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; z-index: 10;">
                <button class="delete-city-btn btn-icon" style="background: rgba(239, 68, 68, 0.9); padding: 4px; border-radius: 4px; color: white; border: none; cursor: pointer;" onclick="event.stopPropagation(); window.deleteCity('${city.id}', 'cities')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
            <div style="padding: 1rem;">
              <h4 style="margin-bottom: 4px;">${city.name}</h4>
              <p style="font-size: 0.8125rem; color: var(--text-secondary);">Fotos da cidade</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };

  const renderTop20 = () => {
    return `
      <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 2rem; margin-bottom: 2rem; background: #F8FAFC; border: none;">
        <div>
            <h3 style="font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 0.25rem;">Top 20 por Cidade</h3>
            <p style="color: #64748B; font-size: 0.875rem;">Organize as logos dos parceiros Top 20 de cada localidade.</p>
        </div>
        <button class="btn" id="btn-add-city-top20" style="color: var(--accent); font-weight: 700; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Nova Pasta de Cidade
        </button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1.5rem;">
        ${state.top20Folders.map(city => `
          <div class="folder-card top20-folder" data-id="${city.id}" style="cursor: pointer; position: relative;">
            <div class="folder-icon-box" style="position: relative;">
               <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
               <div class="folder-overlay" style="position: absolute; inset: 0; background: rgba(16, 185, 129, 0.05); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; border-radius: 12px;">
                 <span style="font-size: 0.625rem; font-weight: 700; color: var(--accent); text-transform: uppercase;">Clique para Ver Pasta</span>
               </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="flex: 1;">
                <h4 style="font-size: 0.875rem; color: #0F172A; margin-bottom: 2px;">${city.name}</h4>
                <p style="font-size: 0.75rem; color: #94A3B8;">${state.logos.filter(l => String(l.cityId) === String(city.id)).length} Logos</p>
              </div>
              ${city.id === 'geral' ? '' : `
              <button class="delete-city-folder-btn" style="color: #EF4444; background: none; border: none; padding: 4px; z-index: 20; cursor: pointer;" onclick="event.stopPropagation(); window.deleteCity('${city.id}', 'top20')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
              `}
            </div>
          </div>
        `).join('')}
        
        <div class="folder-card" id="btn-add-city-card" style="border: 2px dashed #E2E8F0; background: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; min-height: 140px;">
           <div style="width: 32px; height: 32px; border-radius: 50%; background: #F8FAFC; border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
           </div>
           <span style="font-size: 0.75rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em;">Adicionar Nova Cidade</span>
        </div>
      </div>
    `;
  };

  const renderSegments = () => {
    return `
      <div class="card" style="display: flex; justify-content: space-between; align-items: center; padding: 2rem; margin-bottom: 2rem; background: #F8FAFC; border: none;">
        <div>
            <h3 style="font-size: 1.125rem; font-weight: 700; color: #0F172A; margin-bottom: 0.25rem;">Segmentos por Cidade</h3>
            <p style="color: #64748B; font-size: 0.875rem;">Organize as logos dos parceiros por segmento de cada localidade.</p>
        </div>
        <button class="btn" id="btn-add-segment-city" style="color: var(--accent); font-weight: 700; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Nova Pasta de Cidade
        </button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1.5rem;">
        ${state.segmentCities.map(city => `
          <div class="folder-card segment-city-folder" data-id="${city.id}" style="cursor: pointer; position: relative;">
            <div class="folder-icon-box" style="position: relative;">
               <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
               <div class="folder-overlay" style="position: absolute; inset: 0; background: rgba(16, 185, 129, 0.05); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; border-radius: 12px;">
                 <span style="font-size: 0.625rem; font-weight: 700; color: var(--accent); text-transform: uppercase;">Clique para Ver Segmentos</span>
               </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="flex: 1;">
                <h4 style="font-size: 0.875rem; color: #0F172A; margin-bottom: 2px;">${city.name}</h4>
                <p style="font-size: 0.75rem; color: #94A3B8;">${state.segments.length} Segmentos</p>
              </div>
              ${city.id === 'geral' ? '' : `
              <button class="delete-city-folder-btn" style="color: #EF4444; background: none; border: none; padding: 4px; z-index: 20; cursor: pointer;" onclick="event.stopPropagation(); window.deleteCity('${city.id}', 'segments')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
              `}
            </div>
          </div>
        `).join('')}
        
        <div class="folder-card" id="btn-add-segment-city-card" style="border: 2px dashed #E2E8F0; background: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem; min-height: 140px;">
           <div style="width: 32px; height: 32px; border-radius: 50%; background: #F8FAFC; border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
           </div>
           <span style="font-size: 0.75rem; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em;">Adicionar Nova Cidade</span>
        </div>
      </div>
    `;
  };

  const renderFolderView = () => {
    let list, city, assets, segment;
    if (am.activeTab === 'cities') {
      list = state.cities;
      city = list.find(c => String(c.id) === String(am.selectedFolderCityId));
      assets = state.cityPhotos.filter(p => String(p.cityId) === String(am.selectedFolderCityId));
    } else if (am.activeTab === 'top20') {
      list = state.top20Folders;
      city = list.find(c => String(c.id) === String(am.selectedFolderCityId));
      assets = state.logos.filter(l => String(l.cityId) === String(am.selectedFolderCityId));
    } else if (am.activeTab === 'segments') {
      list = state.segmentCities;
      city = list.find(c => String(c.id) === String(am.selectedFolderCityId));
      if (am.selectedSegmentId) {
        segment = state.segments.find(s => s.id === am.selectedSegmentId);
        assets = state.segmentLogos.filter(l => String(l.cityId) === String(am.selectedFolderCityId) && l.segmentId === am.selectedSegmentId);
      }
    }

    // Level 2 for segments: Categories
    if (am.activeTab === 'segments' && !am.selectedSegmentId) {
      return `
        <div style="animation: fadeIn 0.3s ease-out;">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2.5rem;">
               <button class="btn-icon" id="btn-back-folder" style="background: white; border: 1px solid #E2E8F0; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
               </button>
               <div style="display: flex; align-items: center;">
                 <span class="breadcrumb-item">Gerenciar Pastas</span>
                 <span class="breadcrumb-separator">/</span>
                 <span class="breadcrumb-item">Segmentos</span>
                 <span class="breadcrumb-separator">/</span>
                 <span class="breadcrumb-active">${city.name}</span>
               </div>
            </div>

            <div style="margin-bottom: 2rem;">
                <h3 style="font-size: 1.25rem; font-weight: 700; color: #0F172A; margin-bottom: 0.25rem;">Pastas de Categorias</h3>
                <p style="color: #64748B; font-size: 0.875rem;">Selecione um segmento para gerenciar os logos correspondentes nesta cidade.</p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.5rem;">
                ${state.segments.map(s => `
                    <div class="folder-card segment-category-card" data-id="${s.id}" style="padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; text-align: center;">
                        <div style="width: 56px; height: 56px; background: #F0FDF4; color: #10B981; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                           <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div>
                            <h4 style="font-size: 1rem; color: #0F172A; margin-bottom: 4px;">${s.name}</h4>
                            <span style="font-size: 0.625rem; font-weight: 800; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em;">Ver Logos</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
      `;
    }

    return `
          <div style="animation: fadeIn 0.3s ease-out;">
            <!-- Breadcrumbs -->
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2.5rem;">
               <button class="btn-icon" id="btn-back-folder" style="background: white; border: 1px solid #E2E8F0; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
               </button>
               <div style="display: flex; align-items: center;">
                 <span class="breadcrumb-item">Gerenciar Pastas</span>
                 <span class="breadcrumb-separator">/</span>
                 ${am.activeTab === 'top20' ? '<span class="breadcrumb-item">Top 20</span><span class="breadcrumb-separator">/</span>' : ''}
                 ${am.activeTab === 'segments' ? '<span class="breadcrumb-item">Segmentos</span><span class="breadcrumb-separator">/</span>' : ''}
                 <span class="${segment ? 'breadcrumb-item' : 'breadcrumb-active'}" id="breadcrumb-city" style="${segment ? 'cursor:pointer' : ''}">${city.name}</span>
                 ${segment ? `<span class="breadcrumb-separator">/</span><span class="breadcrumb-active">${segment.name}</span>` : ''}
               </div>
            </div>

            <!-- Upload Zone -->
            <div class="upload-dropzone" id="folder-dropzone">
               <div class="upload-icon-circle">
                 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
               </div>
               <h3 style="font-size: 1rem; font-weight: 700; color: #0F172A; margin-bottom: 0.5rem;">Arraste logos para a pasta ${segment ? segment.name : city.name}</h3>
               <p style="color: #94A3B8; font-size: 0.8125rem;">Ou clique para selecionar arquivos do seu computador</p>
               <p style="color: #CBD5E1; font-size: 0.6875rem; font-weight: 700; margin-top: 1rem; text-transform: uppercase; letter-spacing: 0.05em;">JPG, PNG OU WEBP • MÁX 10MB</p>
               <input type="file" id="folder-file-input" style="display: none;" multiple accept="image/*">
            </div>

            <!-- Asset List -->
            <div style="margin-top: 4rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                  <h4 style="font-size: 0.75rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.1em;">${am.activeTab === 'cities' ? 'FOTOS' : 'LOGOS'} NA PASTA (${assets.length})</h4>
                 <div style="display: flex; gap: 0.5rem;">
                    <button class="btn-icon active" style="padding: 6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg></button>
                 </div>
               </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1.5rem;">
                  ${assets.map(asset => `
                    <div class="file-card" style="position: relative;">
                       <div class="file-card-preview" style="background: white; display: flex; align-items: center; justify-content: center; min-height: 120px;">
                         <div id="spinner-${asset.id}" class="loader-inline"></div>
                         <img class="lazy-blob-img" data-id="${asset.id}" data-type="${am.activeTab === 'cities' ? 'city' : (am.activeTab === 'top20' ? 'top20' : 'segment')}" style="display: none; border-radius: ${am.activeTab === 'cities' ? '12px' : '50%'}; max-width: 100%; max-height: 100%;">
                       </div>
                       <div style="padding: 1rem; border-top: 1px solid #F1F5F9; text-align: center;">
                         <h5 style="font-size: 0.75rem; font-weight: 700; color: #1E293B; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${asset.name || 'Ativo'}</h5>
                         <p style="font-size: 0.625rem; color: #94A3B8;">Ativo</p>
                       </div>
                       <button class="btn-icon delete-folder-asset" data-id="${asset.id}" style="position: absolute; top: 0.5rem; right: 0.5rem; background: rgba(255,255,255,0.9); color: #EF4444; border-radius: 4px; padding: 4px; border: 1px solid #F1F5F9; z-index: 10;">
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                       </button>
                    </div>
                  `).join('')}
                </div>
            </div>
          </div>
        `;
  };

  const renderDeleteConfirmModal = () => {
    if (!am.showDeleteConfirm) return '';
    const name = am.deleteType === 'top20'
      ? state.top20Folders.find(f => String(f.id) === String(am.deleteId))?.name
      : am.deleteType === 'segments'
        ? state.segmentCities.find(c => String(c.id) === String(am.deleteId))?.name
        : state.cities.find(c => String(c.id) === String(am.deleteId))?.name;

    return `
      <div id="delete-modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1100; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s;">
        <div class="card" style="width: 400px; padding: 2rem; animation: scaleIn 0.2s; text-align: center;">
          <div style="width: 64px; height: 64px; background: #FEF2F2; color: #EF4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </div>
          <h3 style="margin-bottom: 0.5rem; color: #0F172A;">Excluir Pasta?</h3>
          <p style="color: #64748B; margin-bottom: 2rem; font-size: 0.875rem;">Deseja realmente excluir a pasta <strong>"${name || ''}"</strong>? Esta ação não pode ser desfeita.</p>
          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button class="btn btn-secondary" style="flex: 1;" onclick="window.cancelDelete()">Não, Cancelar</button>
            <button class="btn" style="flex: 1; background: #EF4444; color: white;" onclick="window.confirmDelete()">Sim, Excluir</button>
          </div>
        </div>
      </div>
    `;
  };

  const renderClearAllConfirmModal = () => {
    if (!am.showClearAllConfirm) return '';
    return `
      <div id="clear-all-modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s;">
        <div class="card" style="width: 450px; padding: 2.5rem; animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); text-align: center; border: 2px solid #FEE2E2; box-shadow: 0 25px 50px -12px rgba(239, 68, 68, 0.25);">
          <div style="width: 80px; height: 80px; background: #FEF2F2; color: #EF4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2.5rem; box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);">
            ⚠️
          </div>
          <h2 style="margin-bottom: 0.75rem; color: #991B1B; font-weight: 800; letter-spacing: -0.025em;">ZONA DE PERIGO</h2>
          <p style="color: #4B5563; margin-bottom: 2rem; font-size: 1rem; line-height: 1.6;">
            Esta ação apagará <strong>DEFINITIVAMENTE</strong> todos os dados da aplicação, incluindo cidades, logos, campanhas e configurações. 
            <br><span style="color: #6B7280; font-size: 0.8125rem; display: block; margin-top: 0.5rem;">Não há como desfazer esta operação.</span>
          </p>
          
          <div style="background: #FFFBEB; border: 1px solid #FEF3C7; padding: 1rem; border-radius: 0.75rem; margin-bottom: 2rem; text-align: left; display: flex; gap: 0.75rem; align-items: flex-start;">
            <span style="font-size: 1.25rem;">💡</span>
            <span style="color: #92400E; font-size: 0.8125rem; font-weight: 500; line-height: 1.4;">O sistema será reiniciado automaticamente após a limpeza para garantir um estado limpo.</span>
          </div>

          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button class="btn btn-secondary" style="flex: 1; padding: 0.75rem;" onclick="window.closeClearAll()">Cancelar</button>
            <button id="confirm-reset-btn" class="btn" style="flex: 1.5; background: #EF4444; color: white; font-weight: 700; padding: 0.75rem; box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.2);" onclick="window.confirmClearAllData()">EXCLUIR TUDO</button>
          </div>
        </div>
      </div>
    `;
  };

  const renderClearSpreadsheetConfirmModal = () => {
    if (!am.showClearSpreadsheetConfirm) return '';
    return `
      <div id="clear-spreadsheet-modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 2000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s;">
        <div class="card" style="width: 450px; padding: 2.5rem; animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); text-align: center; border: 1px solid var(--border); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.15);">
          <div style="width: 80px; height: 80px; background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 2.5rem;">
            🧹
          </div>
          <h2 style="margin-bottom: 0.75rem; color: var(--text-primary); font-weight: 800; letter-spacing: -0.025em;">LIMPAR PLANILHA</h2>
          <p style="color: #4B5563; margin-bottom: 2rem; font-size: 1rem; line-height: 1.6;">
            Isso vai apagar <strong>Top 20, Segmentos e Quantidade de Parceiros</strong> importados da planilha SQL.
            <br><span style="color: #6B7280; font-size: 0.8125rem; display: block; margin-top: 0.5rem; text-align: left;">
              ✅ <b>Mantém:</b> templates, fotos de cidades, tipografias e configurações de campanha.
            </span>
          </p>
          
          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button class="btn btn-secondary" style="flex: 1; padding: 0.75rem;" onclick="window.closeClearSpreadsheet()">Cancelar</button>
            <button id="confirm-spreadsheet-btn" class="btn btn-primary" style="flex: 1.5; font-weight: 700; padding: 0.75rem;" onclick="window.confirmClearSpreadsheetData()">LIMPAR DADOS</button>
          </div>
        </div>
      </div>
    `;
  };

  const renderModal = () => {
    if (!am.showCityModal) return '';
    return `
      <div id="city-modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s;">
        <div class="card" style="width: 400px; padding: 2rem; animation: scaleIn 0.2s;">
          <h3 style="margin-bottom: 1.5rem; color: #0F172A;">
            ${am.modalType === 'cities' ? 'Adicionar Nova Cidade' : am.modalType === 'segments' ? 'Nova Cidade (Segmentos)' : 'Nova Pasta Top 20'}
          </h3>
          <input type="text" id="new-city-name" placeholder="Nome da cidade/pasta" style="width: 100%; padding: 0.75rem; border-radius: 0.5rem; background: #F8FAFC; border: 1px solid #E2E8F0; color: #0F172A; margin-bottom: 1.5rem; font-weight: 500;">
          <div style="display: flex; gap: 1rem; justify-content: flex-end;">
            <button class="btn btn-secondary" id="btn-close-modal">Cancelar</button>
            <button class="btn btn-primary" id="btn-save-city">Salvar</button>
          </div>
        </div>
      </div>
    `;
  };


  const renderTypography = () => {
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
        <h3>Tipografias</h3>
        <button class="btn btn-primary" id="btn-add-font">Upload Font (TTF/OTF)</button>
        <input type="file" id="font-input" style="display: none;" multiple accept=".ttf,.otf">
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
        ${state.typographies.length === 0 ? '<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 4rem;">Nenhuma fonte personalizada.</p>' :
        state.typographies.map(font => `
          <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h4 style="font-family: '${font.name}';">${font.name}</h4>
              <p style="font-size: 0.75rem; color: var(--text-secondary);">${font.format}</p>
            </div>
            <button class="delete-font" data-id="${font.id}" style="color: var(--error); cursor: pointer;">Excluir</button>
          </div>
        `).join('')}
      </div>
    `;
  };

  const renderPartners = () => {
    const activeCities = state.cities.filter(c => c.partnerCount > 0);
    return `
      <div style="margin-bottom: 1.5rem;">
        <h3>Quantidade de Parceiros Ativos</h3>
        <p style="color: var(--text-secondary); font-size: 0.875rem;">Estes dados são sincronizados automaticamente via importação SQL.</p>
      </div>
      ${activeCities.length === 0 ? '<p style="text-align: center; color: var(--text-muted); padding: 4rem;">Nenhum dado de parceiro encontrado. Importe a planilha SQL.</p>' : `
        <div style="background: white; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead style="background: #F8FAFC; border-bottom: 1px solid var(--border);">
              <tr>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.75rem; text-transform: uppercase;">Cidade</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.75rem; text-transform: uppercase;">Quantidade Ativa</th>
              </tr>
            </thead>
            <tbody>
              ${activeCities.map(c => `
                <tr style="border-bottom: 1px solid var(--border);">
                  <td style="padding: 1rem 1.5rem; font-weight: 500;">${c.name}</td>
                  <td style="padding: 1rem 1.5rem;">
                    <span style="background: #E0E7FF; color: #4338CA; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.875rem; font-weight: 600;">
                      ${c.partnerCount} parceiros
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  };

  const hydrateFolderImages = async () => {
    const imgs = container.querySelectorAll('.lazy-blob-img');
    for (const img of imgs) {
      if (img.getAttribute('src')) continue;

      const id = img.dataset.id;
      const type = img.dataset.type;

      try {
        let blob = null;
        if (type === 'top20') blob = await getTop20LogoBlob(id);
        if (type === 'segment') blob = await getSegmentLogoBlob(id);
        if (type === 'city') blob = await getCityPhoto(id);

        // ── If no blob in DB, try to download via fallbackUrl and cache it ──
        if (!blob) {
          let downloadUrl = null;
          let logoRef = null;
          if (type === 'top20') {
            logoRef = state.logos.find(l => String(l.id) === String(id));
          } else if (type === 'segment') {
            logoRef = state.segmentLogos.find(l => String(l.id) === String(id));
          }

          if (logoRef) {
            // Try multiple sources for the download URL
            downloadUrl = logoRef.fallbackUrl || logoRef.rawS3Url || logoRef.data;
            // If data was already a proxy URL (from old imports), use it
            if (!downloadUrl && logoRef.data && typeof logoRef.data === 'string' && logoRef.data.startsWith('/logo-proxy')) {
              downloadUrl = logoRef.data;
            }
          }

          console.log(`[hydrate] ${id}: blob=null, downloadUrl=${downloadUrl ? downloadUrl.substring(0, 60) + '...' : 'NONE'}, keys=${logoRef ? Object.keys(logoRef).join(',') : 'NO_REF'}`);

          if (downloadUrl) {
            try {
              // Ensure the URL goes through the proxy
              let proxyUrl;
              if (downloadUrl.startsWith('/logo-proxy')) {
                proxyUrl = downloadUrl;
              } else if (downloadUrl.startsWith('http')) {
                proxyUrl = `/logo-proxy?url=${encodeURIComponent(downloadUrl)}`;
              } else {
                proxyUrl = null; // Can't use this URL
              }

              if (proxyUrl) {
                const resp = await fetch(proxyUrl);
                console.log(`[hydrate] ${id}: fetch status=${resp.status}, ok=${resp.ok}`);
                if (resp.ok) {
                  const ct = (resp.headers.get('content-type') || '').toLowerCase();
                  const fetchedBlob = await resp.blob();
                  if ((ct.startsWith('image/') || fetchedBlob.size > 512) && fetchedBlob.size > 200) {
                    blob = fetchedBlob;
                    // Cache blob in IndexedDB for next reload
                    if (type === 'top20' && logoRef) {
                      await saveTop20Logo(logoRef.cityId || logoRef.name, logoRef.name, blob, null, null, id);
                    } else if (type === 'segment' && logoRef) {
                      await saveSegmentLogo(logoRef.segmentId, logoRef.cityId || logoRef.name, logoRef.name, blob, null, null, id);
                    }
                    console.log(`[hydrate] ${id}: ✅ saved blob ${fetchedBlob.size} bytes`);
                  } else {
                    console.warn(`[hydrate] ${id}: invalid image ct=${ct} size=${fetchedBlob.size}`);
                  }
                }
              }
            } catch (fetchErr) {
              console.warn(`[hydrate] ${id}: fetch failed:`, fetchErr.message);
            }
          }
        }

        if (blob) {
          const url = URL.createObjectURL(blob);
          img.src = url;
          img.style.display = 'block';

          const spinner = document.getElementById(`spinner-${id}`);
          if (spinner) spinner.style.display = 'none';

          if (type === 'top20') {
            const logo = state.logos.find(l => String(l.id) === String(id));
            if (logo) { logo.data = url; logo.memoryUrl = true; }
          } else if (type === 'segment') {
            const logo = state.segmentLogos.find(l => String(l.id) === String(id));
            if (logo) { logo.data = url; logo.memoryUrl = true; }
          } else if (type === 'city') {
            const photo = state.cityPhotos.find(p => String(p.cityId) === String(id));
            if (photo) { photo.data = url; photo.memoryUrl = true; }
            // Mutate in-place to avoid triggering state proxy → infinite update loop
            const cityObj = state.cities.find(c => String(c.id) === String(id));
            if (cityObj) { cityObj.image = url; cityObj.hasPhoto = true; }
          }
        } else {
          const spinner = document.getElementById(`spinner-${id}`);
          if (spinner) spinner.innerHTML = '<span style="color:#EF4444; font-size:10px;">Falhou</span>';
        }
      } catch (e) {
        console.error("Erro ao hidratar imagem", id, e);
      }
    }
  };

  const update = () => {
    const am = state.assetManager; // Refresh reference to avoid stale closures
    if (am.selectedFolderCityId) {
      container.innerHTML = `<div style="padding: 2rem;">${renderFolderView()}</div>`;
      attachFolderEvents();
      hydrateFolderImages();
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom: 2rem;">
        <h1 style="font-size: 2rem; margin-bottom: 0.5rem;">Gerenciar Pastas</h1>
        <p style="color: var(--text-secondary);">Estrutura completa para geração dinâmica.</p>
      </div>
      ${renderTabs()}
      <div id="active-tab-content">
        ${am.activeTab === 'cities' ? renderCities() :
        am.activeTab === 'top20' ? renderTop20() :
          am.activeTab === 'segments' ? renderSegments() :
            am.activeTab === 'partners' ? renderPartners() :
              renderTypography()}
      </div>
      ${renderModal()}
      ${renderDeleteConfirmModal()}
      ${renderClearAllConfirmModal()}
      ${renderClearSpreadsheetConfirmModal()}
    `;

    attachEvents();
    hydrateFolderImages();
    if (!storageInfo.loaded) loadStorageInfo();
  };

  const attachEvents = () => {
    container.querySelectorAll('.tab-item').forEach(btn => btn.onclick = () => {
      state.assetManager = {
        ...state.assetManager,
        activeTab: btn.dataset.tab,
        selectedFolderCityId: null,
        selectedSegmentId: null
      };
    });

    if (am.activeTab === 'cities') {
      container.querySelectorAll('.city-card').forEach(card => {
        card.onclick = (e) => {
          if (e.target.closest('.delete-city')) return;
          state.assetManager = { ...state.assetManager, selectedFolderCityId: card.dataset.id, folderViewType: 'photos' };
        };
      });
      const btnAddCity = container.querySelector('#btn-add-city');
      if (btnAddCity) btnAddCity.onclick = () => {
        state.assetManager = { ...state.assetManager, showCityModal: true, modalType: 'cities' };
      };
    }

    if (am.activeTab === 'top20') {
      container.querySelectorAll('.folder-card').forEach(card => {
        card.onclick = (e) => {
          if (e.target.closest('.delete-city-folder')) return;
          if (card.id === 'btn-add-city-card') {
            state.assetManager = { ...state.assetManager, showCityModal: true, modalType: 'top20' };
          } else {
            state.assetManager = { ...state.assetManager, selectedFolderCityId: card.dataset.id, folderViewType: 'logos' };
          }
        };
      });
      const btnAdd = container.querySelector('#btn-add-city-top20');
      if (btnAdd) btnAdd.onclick = () => {
        state.assetManager = { ...state.assetManager, showCityModal: true, modalType: 'top20' };
      };
    }

    // Modal events
    const btnSave = container.querySelector('#btn-save-city');
    if (btnSave) btnSave.onclick = () => {
      const name = container.querySelector('#new-city-name').value.trim();
      if (name) {
        if (am.modalType === 'top20') {
          state.top20Folders = [...state.top20Folders, { id: Date.now(), name }];
        } else if (am.modalType === 'segments') {
          state.segmentCities = [...state.segmentCities, { id: Date.now(), name }];
        } else {
          state.cities = [...state.cities, { id: Date.now(), name, image: null }];
        }
        state.assetManager = { ...state.assetManager, showCityModal: false };
      }
    };
    const btnClose = container.querySelector('#btn-close-modal');
    if (btnClose) btnClose.onclick = () => {
      state.assetManager = { ...state.assetManager, showCityModal: false };
    };

    if (am.activeTab === 'segments') {
      container.querySelectorAll('.segment-city-folder').forEach(folder => {
        folder.onclick = () => {
          state.assetManager = { ...state.assetManager, selectedFolderCityId: folder.dataset.id, selectedSegmentId: null };
        };
      });

      const btnAddSegmentCity = container.querySelector('#btn-add-segment-city') || container.querySelector('#btn-add-segment-city-card');
      if (btnAddSegmentCity) btnAddSegmentCity.onclick = () => {
        state.assetManager = { ...state.assetManager, showCityModal: true, modalType: 'segments' };
      };
    }

    if (am.activeTab === 'typography') {
      const btnF = container.querySelector('#btn-add-font');
      if (btnF) btnF.onclick = () => container.querySelector('#font-input').click();
      const fontInp = container.querySelector('#font-input');
      if (fontInp) fontInp.onchange = async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          const name = file.name.split('.')[0];
          const format = file.name.split('.').pop();

          try {
            const savedId = await saveFont(name, format, file);
            const url = URL.createObjectURL(file);
            state.typographies = [...state.typographies, { id: savedId, name, format, data: url, memoryUrl: true }];
          } catch (err) {
            console.error("Erro ao salvar tipografia no IndexedDB", err);
          }
        }
      };

      container.querySelectorAll('.delete-font').forEach(btn => btn.onclick = async () => {
        const id = btn.dataset.id;
        try {
          const font = state.typographies.find(f => String(f.id) === String(id));
          if (font && font.memoryUrl) URL.revokeObjectURL(font.data);
          await deleteFont(id);
          state.typographies = state.typographies.filter(f => String(f.id) !== String(id));
        } catch (e) {
          console.error(e);
        }
      });
    }

    // Removal of btnDownload logic as requested since Import SQL handles everything


    // Import SQL Logic
    const importBtn = container.querySelector('#btn-import-sql');
    const importInput = container.querySelector('#sql-import-input');
    if (importBtn && importInput) {
      importBtn.onclick = () => importInput.click();
      importInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.style = "position:fixed; inset:0; background:rgba(15,23,42,0.9); z-index:10000; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white;";
        const statusMsg = document.createElement('p');
        statusMsg.innerText = 'Importando Planilha...';
        overlay.appendChild(statusMsg);
        document.body.appendChild(overlay);

        const reader = new FileReader();
        reader.onload = async (ev) => {
          const result = await syncSQLData(ev.target.result, (msg) => {
            statusMsg.innerText = msg;
          });
          overlay.remove();
          if (result && result.success) {
            alert(`Importação concluída! ${result.parsed} linhas processadas.`);
            update();
          } else {
            alert("Erro na importação: " + (result?.error || "Desconhecido"));
          }
        };
        reader.readAsText(file);
      };
    }
  };

  const attachFolderEvents = () => {
    container.querySelector('#btn-back-folder').onclick = () => {
      if (am.activeTab === 'segments' && am.selectedSegmentId) {
        state.assetManager = { ...state.assetManager, selectedSegmentId: null };
      } else {
        state.assetManager = { ...state.assetManager, selectedFolderCityId: null, selectedSegmentId: null };
      }
    };

    if (am.activeTab === 'segments') {
      container.querySelectorAll('.segment-category-card').forEach(card => {
        card.onclick = () => {
          state.assetManager = { ...state.assetManager, selectedSegmentId: card.dataset.id };
        };
      });

      const breadcrumbCity = container.querySelector('#breadcrumb-city');
      if (breadcrumbCity) breadcrumbCity.onclick = () => {
        state.assetManager = { ...state.assetManager, selectedSegmentId: null };
      };
    }

    const dropzone = container.querySelector('#folder-dropzone');
    const fileInput = container.querySelector('#folder-file-input');

    if (dropzone) dropzone.onclick = () => fileInput.click();

    if (fileInput) fileInput.onchange = async (e) => {
      const files = Array.from(e.target.files);

      for (const file of files) {
        try {
          if (am.folderViewType === 'photos' && am.activeTab === 'cities') {
            const photoBlob = await optimizeCityPhoto(file);
            await saveCityPhoto(am.selectedFolderCityId, photoBlob);

            const oldPhoto = state.cityPhotos.find(p => String(p.cityId) === String(am.selectedFolderCityId));
            if (oldPhoto && oldPhoto.memoryUrl) URL.revokeObjectURL(oldPhoto.data);

            // Generate visual URL for current session only
            const url = URL.createObjectURL(photoBlob);
            const newPhoto = { id: am.selectedFolderCityId, cityId: am.selectedFolderCityId, data: url, memoryUrl: true, name: file.name };

            // Delete old photo if exists in array
            state.cityPhotos = [...state.cityPhotos.filter(p => String(p.cityId) !== String(am.selectedFolderCityId)), newPhoto];
            state.cities = state.cities.map(c =>
              String(c.id) === String(am.selectedFolderCityId) ? { ...c, image: url, hasPhoto: true } : c
            );
            update();
          } else if (am.activeTab === 'segments') {
            const logoBlob = await optimizeLogo(file);
            const savedId = await saveSegmentLogo(am.selectedSegmentId, am.selectedFolderCityId, file.name, logoBlob);
            const url = URL.createObjectURL(logoBlob);

            const newLogo = { id: savedId, cityId: am.selectedFolderCityId, segmentId: am.selectedSegmentId, data: url, memoryUrl: true, name: file.name };
            state.segmentLogos = [...state.segmentLogos, newLogo];
          } else {
            const logoBlob = await optimizeLogo(file);
            const savedId = await saveTop20Logo(am.selectedFolderCityId, file.name, logoBlob);
            const url = URL.createObjectURL(logoBlob);

            const newLogo = { id: savedId, cityId: am.selectedFolderCityId, data: url, memoryUrl: true, name: file.name };
            state.logos = [...state.logos, newLogo];
          }
        } catch (err) {
          console.error("Erro ao salvar imagem:", err);
          alert("Ocorreu um erro ao otimizar e salvar a imagem.");
        }
      }

      // Cleanup
      fileInput.value = '';
    };

    container.querySelectorAll('.delete-folder-asset').forEach(btn => btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;

      try {
        if (am.activeTab === 'cities') {
          const photo = state.cityPhotos.find(p => String(p.id) === String(id));
          if (photo && photo.memoryUrl) URL.revokeObjectURL(photo.data);
          await deleteCityPhoto(am.selectedFolderCityId);
          state.cityPhotos = state.cityPhotos.filter(p => String(p.id) !== String(id));
          state.cities = state.cities.map(c =>
            String(c.id) === String(am.selectedFolderCityId) ? { ...c, image: null, hasPhoto: false } : c
          );
        } else if (am.activeTab === 'segments') {
          const logo = state.segmentLogos.find(l => String(l.id) === String(id));
          if (logo && logo.memoryUrl) URL.revokeObjectURL(logo.data);
          await deleteSegmentLogo(id);
          state.segmentLogos = state.segmentLogos.filter(l => String(l.id) !== String(id));
        } else {
          const logo = state.logos.find(l => String(l.id) === String(id));
          if (logo && logo.memoryUrl) URL.revokeObjectURL(logo.data);
          await deleteTop20Logo(id);
          state.logos = state.logos.filter(l => String(l.id) !== String(id));
        }
      } catch (err) {
        console.error("Erro ao deletar imagem:", err);
      }
    });
  };

  update();
};
