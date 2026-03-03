import './src/styles/main.css';
import { renderSidebar } from './src/components/Sidebar.js';
import { subscribe, state, loadState, navigate } from './src/services/state.js';
import { renderAssetManager } from './src/pages/AssetManager.js';
import { renderCreateCampaign } from './src/pages/CreateCampaign.js';
import { renderTemplateBuilder } from './src/pages/TemplateBuilder.js';
import { renderGeneration } from './src/pages/Generation.js';
import { renderGlobalPreview } from './src/pages/GlobalPreview.js';

// Page Renderers (stubs for now)
const pages = {
  dashboard: (container) => {
    container.innerHTML = `
      <div style="margin-bottom: 2rem; animation: fadeIn 0.4s ease-out;">
        <div class="alert-info" style="margin-bottom: 2rem;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          O sistema mantém apenas as últimas 5 campanhas geradas para otimização de performance.
        </div>

        <h1 style="font-size: 2.5rem; font-weight: 800; color: #0F172A; margin-bottom: 0.5rem;">Bigou Artes</h1>
        <p style="color: #64748B; font-size: 1.125rem; margin-bottom: 3rem;">Bem-vindo ao seu painel de criação automatizada de ativos para redes sociais.</p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 3rem;">
          <div class="card" id="btn-new-campaign" style="cursor: pointer; display: flex; align-items: center; gap: 1.5rem; padding: 2.5rem;">
            <div style="width: 56px; height: 56px; background: #EBFDF5; color: var(--accent); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            </div>
            <div>
              <h3 style="font-size: 1.375rem; font-weight: 700; color: #1E293B; margin-bottom: 0.5rem;">Criar nova campanha</h3>
              <p style="color: #64748B; font-size: 0.9375rem; line-height: 1.5;">Inicie uma nova automação de assets para redes sociais em poucos cliques.</p>
            </div>
          </div>
          
          <div class="card nav-btn" data-page="assets" style="cursor: pointer; display: flex; align-items: center; gap: 1.5rem; padding: 2.5rem;">
            <div style="width: 56px; height: 56px; background: #EBFDF5; color: var(--accent); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            </div>
            <div>
              <h3 style="font-size: 1.375rem; font-weight: 700; color: #1E293B; margin-bottom: 0.5rem;">Gerenciar pastas</h3>
              <p style="color: #64748B; font-size: 0.9375rem; line-height: 1.5;">Organize seus templates, logos, fontes e arquivos de mídia em pastas.</p>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden; border-radius: 1rem;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead style="background: #FFFFFF; border-bottom: 1px solid var(--border);">
              <tr>
                <th style="padding: 1.25rem 2rem; font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em;">Nome da Campanha</th>
                <th style="padding: 1.25rem 2rem; font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em;">Tipo</th>
                <th style="padding: 1.25rem 2rem; font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em;">Data de Criação</th>
                <th style="padding: 1.25rem 2rem; font-size: 0.75rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; text-align: right;">Ação</th>
              </tr>
            </thead>
            <tbody>
              ${state.campaigns.length === 0 ? `
                <tr>
                  <td colspan="4" style="padding: 4rem; text-align: center; color: var(--text-muted);">
                    Nenhuma campanha gerada ainda.
                  </td>
                </tr>
              ` : state.campaigns.map(c => `
                <tr style="border-bottom: 1px solid var(--border); transition: background 0.2s;">
                  <td style="padding: 1.25rem 2rem;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                      <div style="width: 40px; height: 40px; background: #F1F5F9; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                      </div>
                      <span style="font-weight: 600; color: #1E293B;">${c.name}</span>
                    </div>
                  </td>
                  <td style="padding: 1.25rem 2rem;">
                    <span class="pill ${c.type === 'Arte Única' ? 'pill-lilac' : 'pill-green'}">${c.type}</span>
                  </td>
                  <td style="padding: 1.25rem 2rem; color: #64748B;">${c.date}</td>
                  <td style="padding: 1.25rem 2rem; text-align: right;">
                    <button class="btn btn-primary btn-download" data-url="${c.url}" data-name="${c.name}" style="font-size: 0.8125rem; font-weight: 700; padding: 0.625rem 1.25rem; gap: 0.5rem; display: inline-flex; border: none; cursor: pointer;">
                       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><path d="m16 12-4 4-4-4"/><path d="M12 8v8"/></svg>
                       Baixar ZIP
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-new-campaign').onclick = () => {
      // Reset campaign creation state before starting new flow
      state.builderSlots = null;
      state.finalBuilderSlots = null;
      state.assetManager = {
        ...state.assetManager,
        createCampaign: {
          step: 1,
          type: 'single',
          name: '',
          feedTemplate: null,
          storyTemplate: null,
          dynamicOptions: {
            cityImage: true,
            useTop20: true,
            useCityText: true
          }
        }
      };
      navigate('create-campaign');
    };

    container.querySelectorAll('.nav-btn').forEach(btn => {
      btn.onclick = () => navigate(btn.dataset.page);
    });

    container.querySelectorAll('.btn-download').forEach(btn => {
      btn.onclick = async () => {
        const url = btn.dataset.url;
        const name = `${btn.dataset.name}.zip`;

        if (!url || url === 'undefined' || url === 'null') {
          alert('Este arquivo ZIP expirou ou não está mais disponível nesta sessão. Por favor, gere a campanha novamente criando uma nova.');
          return;
        }

        // Since main.js only has a URL, we need to fetch the blob to use the Save API
        try {
          const response = await fetch(url);
          const blob = await response.blob();

          // Strategy 1: Modern API
          if (window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }],
              });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              return; // Success!
            } catch (err) {
              if (err.name === 'AbortError') return;
              console.warn('showSaveFilePicker failed:', err);
            }
          }
        } catch (fetchErr) {
          console.warn('Could not fetch blob for Save Picker. Falling back.', fetchErr);
        }

        // Strategy 2: Robust Anchor Fallback
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = name;
        a.target = '_blank';
        document.body.appendChild(a);

        try {
          a.click();
        } catch (e) {
          console.error('Fallback anchor click failed:', e);
          window.location.assign(url);
        } finally {
          setTimeout(() => {
            if (document.body.contains(a)) document.body.removeChild(a);
          }, 500);
        }
      };
    });
  },

  assets: (container) => {
    renderAssetManager(container);
  },
  'create-campaign': (container) => {
    renderCreateCampaign(container);
  },
  'template-builder': (container) => {
    renderTemplateBuilder(container);
  },
  'generation': (container) => {
    renderGeneration(container);
  },
  'global-preview': (container) => {
    renderGlobalPreview(container);
  }
};

const appInit = () => {
  const sidebarContainer = document.getElementById('sidebar');
  const mainView = document.getElementById('main-view');
  const pageTitle = document.getElementById('page-title');

  renderSidebar(sidebarContainer);

  // Track last rendered page to avoid unnecessary re-renders.
  // Full-screen pages (TemplateBuilder, Generation) maintain local state
  // (zoom, pan, selected slots, drag) that would be destroyed on re-render.
  let lastRenderedPage = null;

  const renderPage = (currentPage) => {
    const renderer = pages[currentPage] || pages.dashboard;

    const isFullScreen = ['template-builder', 'generation', 'global-preview'].includes(currentPage);
    const sidebarEl = document.getElementById('sidebar');
    const headerEl = document.getElementById('header');
    const mainContent = document.querySelector('.main-content');
    const contentArea = document.querySelector('.content-area');
    if (sidebarEl) sidebarEl.style.display = isFullScreen ? 'none' : '';
    if (headerEl) headerEl.style.display = isFullScreen ? 'none' : '';
    if (mainContent) {
      mainContent.style.marginLeft = isFullScreen ? '0' : '';
      mainContent.style.height = isFullScreen ? '100vh' : '';
      mainContent.style.overflow = (isFullScreen && currentPage !== 'global-preview') ? 'hidden' : '';
    }
    if (contentArea) {
      contentArea.style.cssText = isFullScreen
        ? `padding:0;max-width:none;width:100%;height:100%;margin:0;${currentPage !== 'global-preview' ? 'overflow:hidden;' : 'overflow:auto;'}`
        : '';
    }

    renderer(mainView);

    if (!isFullScreen) {
      const titles = {
        dashboard: 'Dashboard',
        assets: 'Gerenciar Pastas',
        campaigns: 'Minhas Campanhas',
        'create-campaign': 'Nova Campanha'
      };
      pageTitle.innerText = titles[currentPage] || 'Dashboard';
    }

    lastRenderedPage = currentPage;
  };

  subscribe((st) => {
    const pageChanged = st.currentPage !== lastRenderedPage;
    const isFullScreenNow = ['template-builder', 'generation', 'global-preview'].includes(st.currentPage);

    // Full-screen pages manage their own local state (zoom, pan, slots, drag).
    // Re-rendering them from the global subscriber would destroy that state.
    // Only re-render them when navigating TO them (page change).
    if (!pageChanged && isFullScreenNow) return;

    renderPage(st.currentPage);
  });

  // Render initial page
  renderPage(state.currentPage);
};

const init = async () => {
  // Wait for IndexedDB to load state before rendering anything
  try {
    await loadState();
    appInit();

    window.addEventListener('db-quota-exceeded', () => {
      alert("ALERTA DE ARMAZENAMENTO CHEIO!\n\nSeu navegador não possui espaço suficiente para armazenar mais fotos ou logos. Por favor, remova cidades e imagens antigas usando o botão 'Limpar Todos os Dados' ou exclusões manuais no Gerenciador.");
    });
  } catch (err) {
    console.error('Failed to initialize app state:', err);
    document.body.innerHTML = '<div style="padding:2rem;text-align:center;color:red;">Error loading application state. Check console.</div>';
  }
};

document.addEventListener('DOMContentLoaded', init);
