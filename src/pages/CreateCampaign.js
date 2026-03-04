import { state, navigate } from '../services/state.js';
import { optimizeTemplate } from '../utils/imageOptimizer.js';


export const renderCreateCampaign = (container) => {
  const update = () => {
    const cc = state.assetManager.createCampaign;
    container.innerHTML = `
      <div style="min-height: 100vh; background: #F8FAFC; display: flex; flex-direction: column; animation: fadeIn 0.4s ease-out; font-family: 'Inter', sans-serif;">
        <!-- Header Stepper -->
        <div style="background: white; border-bottom: 1px solid #E2E8F0; padding: 1.5rem 0;">
          <div style="max-width: 900px; margin: 0 auto; display: flex; justify-content: center; align-items: center; gap: 3rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem; color: ${cc.step === 1 ? 'var(--accent)' : '#94A3B8'}; font-weight: 700; font-size: 0.875rem;">
               <div style="width: 24px; height: 24px; border-radius: 50%; background: ${cc.step === 1 ? 'var(--accent)' : '#F1F5F9'}; color: ${cc.step === 1 ? 'white' : '#94A3B8'}; display: flex; align-items: center; justify-content: center; font-size: 0.75rem;">1</div>
               <span>Tipo</span>
            </div>
            <div style="width: 40px; height: 1px; background: #E2E8F0;"></div>
            <div style="display: flex; align-items: center; gap: 0.75rem; color: ${cc.step === 2 ? '#10B981' : '#94A3B8'}; font-weight: 700; font-size: 0.875rem;">
               <div style="width: 24px; height: 24px; border-radius: 50%; background: ${cc.step === 2 ? '#10B981' : '#F1F5F9'}; color: ${cc.step === 2 ? 'white' : '#94A3B8'}; display: flex; align-items: center; justify-content: center; font-size: 0.75rem;">2</div>
               <span style="${cc.step === 2 ? 'border-bottom: 2px solid #10B981; padding-bottom: 4px;' : ''}">Templates</span>
            </div>
            <div style="width: 40px; height: 1px; background: #E2E8F0;"></div>
            <div style="display: flex; align-items: center; gap: 0.75rem; color: #94A3B8; font-weight: 700; font-size: 0.875rem;">
               <div style="width: 24px; height: 24px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; font-size: 0.75rem;">3</div>
               <span>Preview</span>
            </div>
          </div>
        </div>

        <div style="flex: 1; padding: 3rem 2rem; overflow-y: auto;">
          <div style="max-width: 1000px; margin: 0 auto; width: 100%;">
            <div id="step-content">
              ${cc.step === 1 ? renderTypeSelection() : cc.step === 2 ? renderConfiguration() : ''}
            </div>
          </div>
        </div>

        ${renderFooter()}
      </div>
    `;
    attachEvents();
  };

  const renderTypeSelection = () => {
    const cc = state.assetManager.createCampaign;
    return `
    <div style="margin-bottom: 3rem;">
      <h1 style="font-size: 1.75rem; font-weight: 800; color: #1E293B; margin-bottom: 0.5rem;">Escolha o tipo de campanha</h1>
      <p style="color: #64748B; font-size: 1rem;">Selecione como deseja gerar suas artes automáticas.</p>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
      <div class="card type-card ${cc.type === 'single' ? 'active' : ''}" data-type="single" style="cursor: pointer; padding: 3rem; text-align: center; border: 2px solid ${cc.type === 'single' ? 'var(--accent)' : 'white'}; background: white; border-radius: 1.5rem; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="width: 64px; height: 64px; margin: 0 auto 1.5rem; background: #F1F5F9; border-radius: 1rem; display: flex; align-items: center; justify-content: center; color: var(--accent);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #1E293B; margin-bottom: 1rem;">Arte única</h3>
        <p style="color: #64748B; font-size: 0.9375rem; line-height: 1.6;">Gere artes pontuais para uma única unidade ou cidade específica.</p>
      </div>

      <div class="card type-card ${cc.type === 'segment' ? 'active' : ''}" data-type="segment" style="cursor: pointer; padding: 3rem; text-align: center; border: 2px solid ${cc.type === 'segment' ? 'var(--accent)' : 'white'}; background: white; border-radius: 1.5rem; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="width: 64px; height: 64px; margin: 0 auto 1.5rem; background: #F1F5F9; border-radius: 1rem; display: flex; align-items: center; justify-content: center; color: var(--accent);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M12 7v10"/><path d="M7 12h10"/></svg>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 800; color: #1E293B; margin-bottom: 1rem;">Por segmento</h3>
        <p style="color: #64748B; font-size: 0.9375rem; line-height: 1.6;">Gere artes em massa para todas as unidades de um segmento.</p>
      </div>
    </div>
  `;
  };

  const renderConfiguration = () => {
    const cc = state.assetManager.createCampaign;
    return `
    <div style="margin-bottom: 2.5rem;">
      <h1 style="font-size: 1.75rem; font-weight: 800; color: #1E293B; margin-bottom: 0.5rem;">Configuração da Campanha - ${cc.type === 'single' ? 'Arte única' : 'Por segmento'}</h1>
      <p style="color: #64748B; font-size: 1rem;">Configure os templates e as regras de geração para sua ${cc.type === 'single' ? 'arte única' : 'campanha por segmento'}.</p>
    </div>

    <!-- Campaign Name Block -->
    <div style="background: white; border: 1px solid #E2E8F0; border-radius: 1.25rem; padding: 1.5rem 2rem; margin-bottom: 2.5rem; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);">
      <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; color: #64748B; font-size: 0.8125rem; font-weight: 700;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M7 7h10M7 12h10M7 17h10"/></svg>
        Nome da Campanha
      </div>
      <input type="text" id="campaign-name-input" value="${cc.name}" placeholder="Ex: Promoção de Verão 2024" style="width: 100%; border: 1px solid #E2E8F0; border-radius: 0.5rem; padding: 1rem; font-size: 1rem; color: #1E293B; outline: none; transition: border-color 0.2s;">
    </div>

    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: #94A3B8; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">
       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
       IMPORTAR TEMPLATES
    </div>

    ${cc.type === 'single' ? renderDropzones() : renderSegmentTemplates()}

    <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 3rem; margin-bottom: 1.5rem; color: #94A3B8; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">
       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18.1H3"/></svg>
       REGRAS DE GERAÇÃO
    </div>

    <div style="background: #F0F9F4; border-radius: 1rem; padding: 1.5rem 2rem; display: flex; align-items: center; gap: 1.5rem; margin-bottom: 2.5rem;">
       <div style="width: 36px; height: 36px; background: #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
       </div>
       <div>
          <div style="font-weight: 800; color: #065F46; font-size: 0.9375rem; margin-bottom: 2px;">Resumo da automação</div>
          <p style="color: #065F46; font-size: 0.8125rem; margin: 0; line-height: 1.5; opacity: 0.8;">Para cada cidade selecionada, o sistema irá gerar automaticamente 1 imagem de Feed e 1 imagem de Story seguindo as configurações dinâmicas abaixo.</p>
       </div>
    </div>

    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; color: #94A3B8; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">
       <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
       OPÇÕES DINÂMICAS
    </div>

    <div style="background: white; border: 1px solid #E2E8F0; border-radius: 1.25rem; overflow: hidden; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);">
       ${renderDynamicOption('Usar imagem da cidade', 'Substitui o fundo pela foto principal da cidade.', 'cityImage', cc.dynamicOptions.cityImage)}
       ${renderDynamicOption(cc.type === 'segment' ? 'Usar Segmentos' : 'Usar Top 20', cc.type === 'segment' ? 'Inclui os logos dos segmentos ativos na arte.' : 'Inclui os logos dos estabelecimentos mais populares.', 'useTop20', cc.dynamicOptions.useTop20)}
       ${renderDynamicOption('Usar texto da cidade', 'Insere o nome da cidade dinamicamente na arte.', 'useCityText', cc.dynamicOptions.useCityText)}
       ${renderDynamicOption('Quantidade de parceiros ativos', 'Imprime o número total de lojas na cidade.', 'usePartnerCount', cc.dynamicOptions.usePartnerCount, true)}
    </div>
    <div style="height: 60px;"></div>
    `;
  };

  const renderDropzones = () => {
    const cc = state.assetManager.createCampaign;
    return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
      ${renderDropzoneCard('Feed', '1080x1350 px (4:5)', 'dropzone-feed', 'feed-input', cc.feedTemplate)}
      ${renderDropzoneCard('Story', '1080x1920 px (9:16)', 'dropzone-story', 'story-input', cc.storyTemplate)}
    </div>
  `;
  };

  const renderDropzoneCard = (label, dims, dzId, inputId, isLoaded) => {
    return `
      <div id="${dzId}" style="cursor: pointer; background: white; border: 2px dashed ${isLoaded ? '#10B981' : '#E2E8F0'}; border-radius: 1.25rem; padding: 3rem 2rem; text-align: center; transition: all 0.2s; position: relative;">
        <div style="width: 44px; height: 44px; background: #F8FAFC; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #94A3B8; margin: 0 auto 1.5rem;">
          ${label === 'Feed' ?
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>' :
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>'}
        </div>
        <div style="color: #1E293B; font-weight: 800; font-size: 1rem; margin-bottom: 4px;">Template ${label}</div>
        <div style="color: #94A3B8; font-size: 0.8125rem;">${dims}</div>
        <div style="margin-top: 1rem; color: #CBD5E1; font-size: 0.625rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">
          ${isLoaded ? '✓ Template Carregado' : 'Arraste ou clique para upload'}
        </div>
        ${isLoaded ? `<div style="position: absolute; inset: 0; background: rgba(16, 185, 129, 0.05); border-radius: 1.15rem; pointer-events: none;"></div>` : ''}
        <input type="file" id="${inputId}" style="display: none;" accept="image/*">
      </div>
    `;
  };

  const renderSegmentTemplates = () => {
    const segmentsData = state.assetManager.createCampaign.segments || {};
    return `
    <div style="background: white; border: 1px solid #E2E8F0; border-radius: 1.25rem; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
      ${state.segments.map(seg => {
      const segData = segmentsData[seg.id] || {};
      const hasFeed = !!segData.feedTemplate;
      const hasStory = !!segData.storyTemplate;
      const bothDone = hasFeed && hasStory;
      return `
        <div style="background: ${bothDone ? '#F0FDF4' : '#F8FAFC'}; border: 1px solid ${bothDone ? '#BBF7D0' : '#E2E8F0'}; border-radius: 1rem; padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 40px; height: 40px; background: ${bothDone ? '#10B981' : 'white'}; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: ${bothDone ? 'white' : 'var(--accent)'}; border: 1px solid ${bothDone ? '#10B981' : '#E2E8F0'};">
               ${bothDone
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'}
            </div>
            <div>
              <span style="color: #1E293B; font-weight: 800; font-size: 1rem; display:block;">${seg.name}</span>
              <span style="color: ${bothDone ? '#10B981' : '#94A3B8'}; font-size: 0.7rem; font-weight: 700;">${bothDone ? '✓ Feed e Story carregados' : hasFeed ? '✓ Feed · Story pendente' : hasStory ? 'Feed pendente · ✓ Story' : 'Nenhum template carregado'}</span>
            </div>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <label style="background: ${hasFeed ? '#10B981' : '#E2E8F0'}; color: ${hasFeed ? 'white' : '#64748B'}; font-size: 0.75rem; font-weight: 800; padding: 0.6rem 1.25rem; border-radius: 0.5rem; cursor: pointer; display:inline-flex; align-items:center; gap:4px; transition: all 0.2s;">
              ${hasFeed ? '✓' : ''} FEED
              <input type="file" data-seg-id="${seg.id}" data-seg-format="feedTemplate" style="display:none" accept="image/*">
            </label>
            <label style="background: ${hasStory ? '#10B981' : '#E2E8F0'}; color: ${hasStory ? 'white' : '#64748B'}; font-size: 0.75rem; font-weight: 800; padding: 0.6rem 1.25rem; border-radius: 0.5rem; cursor: pointer; display:inline-flex; align-items:center; gap:4px; transition: all 0.2s;">
              ${hasStory ? '✓' : ''} STORY
              <input type="file" data-seg-id="${seg.id}" data-seg-format="storyTemplate" style="display:none" accept="image/*">
            </label>
          </div>
        </div>
      `}).join('')}
    </div>
    `;
  };

  const renderDynamicOption = (title, desc, key, isActive, isLast = false) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.5rem 2rem; ${isLast ? '' : 'border-bottom: 1px solid #F1F5F9;'}">
      <div style="display: flex; align-items: center; gap: 1.5rem;">
        <div style="width: 44px; height: 44px; background: #F8FAFC; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #94A3B8;">
           ${key === 'cityImage' ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' :
      key === 'useTop20' ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>' :
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><rect width="18" height="13" x="3" y="7" rx="2"/></svg>'}
        </div>
        <div>
          <div style="font-weight: 800; color: #1E293B; font-size: 0.9375rem; margin-bottom: 2px;">${title}</div>
          <div style="font-size: 0.8125rem; color: #94A3B8;">${desc}</div>
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" data-option="${key}" ${isActive ? 'checked' : ''}>
        <span class="slider" style="background-color: ${isActive ? '#10B981 !important' : '#E2E8F0'}"></span>
      </label>
    </div>
  `;

  const renderFooter = () => {
    const cc = state.assetManager.createCampaign;
    return `
      <div style="background: white; border-top: 1px solid #E2E8F0; padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; position: sticky; bottom: 0; z-index: 10;">
        <button class="btn" id="btn-back" style="background: transparent; color: #64748B; font-weight: 700; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; border: none; cursor: pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m15 18-6-6 6-6"/></svg>
          Voltar
        </button>
        <div style="display: flex; gap: 1.5rem; align-items: center;">
          <button class="btn" id="btn-cancel" style="background: transparent; border: none; font-weight: 700; font-size: 0.875rem; color: #64748B; cursor: pointer;">Cancelar</button>
          <button class="btn" id="btn-next" style="background: #10B981; color: white; padding: 0.875rem 2rem; border-radius: 0.75rem; font-weight: 700; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; border: none; cursor: pointer; transition: transform 0.2s;">
            ${cc.step === 1 ? 'Próximo Passo' : 'Gerar Prévia'}
            ${cc.step === 1 ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5z"/></svg>'}
          </button>
        </div>
      </div>
    `;
  };

  const attachEvents = () => {
    const cc = state.assetManager.createCampaign;

    if (cc.step === 1) {
      container.querySelectorAll('.type-card').forEach(card => {
        card.onclick = () => {
          state.assetManager = {
            ...state.assetManager,
            createCampaign: {
              ...cc,
              type: card.dataset.type,
              step: 2
            }
          };
          update();
        };
      });
    }

    const nameInput = container.querySelector('#campaign-name-input');
    if (nameInput) {
      nameInput.oninput = (e) => {
        state.assetManager.createCampaign.name = e.target.value;
      };
    }

    container.querySelectorAll('input[type="checkbox"][data-option]').forEach(checkbox => {
      checkbox.onchange = (e) => {
        const optionKey = e.target.dataset.option;
        state.assetManager.createCampaign.dynamicOptions[optionKey] = e.target.checked;
        update(); // Re-render to update switch color
      };
    });

    container.querySelector('#btn-back').onclick = () => {
      const currentCC = state.assetManager.createCampaign;
      if (currentCC.step === 1) navigate('dashboard');
      else {
        state.assetManager = {
          ...state.assetManager,
          createCampaign: { ...currentCC, step: currentCC.step - 1 }
        };
        update();
      }
    };

    container.querySelector('#btn-cancel').onclick = () => {
      state.assetManager = {
        ...state.assetManager,
        createCampaign: {
          step: 1, type: 'single', name: '', feedTemplate: null, storyTemplate: null, segments: {},
          dynamicOptions: { cityImage: true, useTop20: true, useCityText: true }
        }
      };
      navigate('dashboard');
    };

    container.querySelector('#btn-next').onclick = () => {
      const currentCC = state.assetManager.createCampaign;
      if (currentCC.step === 1) {
        state.assetManager = {
          ...state.assetManager,
          createCampaign: { ...currentCC, step: 2 }
        };
        update();
      } else if (currentCC.step === 2) {
        state.currentCampaignConfig = {
          name: currentCC.name || 'Campanha Sem Nome',
          type: currentCC.type,
          feedTemplate: currentCC.feedTemplate || '',
          storyTemplate: currentCC.storyTemplate || '',
          segments: currentCC.segments || {},
          dynamicOptions: currentCC.dynamicOptions
        };
        navigate('template-builder');
      }
    };

    const setupDropzone = (dzId, inputId, key) => {
      const dz = container.querySelector(`#${dzId}`);
      const input = container.querySelector(`#${inputId}`);
      if (dz && input) {
        dz.onclick = () => input.click();
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = async (re) => {
              try {
                // Optimize templates aggressively to avoid localStorage limits
                const optimizedData = await optimizeTemplate(re.target.result);

                state.assetManager = {
                  ...state.assetManager,
                  createCampaign: {
                    ...state.assetManager.createCampaign,
                    [key]: optimizedData
                  }
                };
                update();
              } catch (err) {
                console.error("Error optimizing template:", err);
                // Fallback to original if optimization fails
                state.assetManager = {
                  ...state.assetManager,
                  createCampaign: {
                    ...state.assetManager.createCampaign,
                    [key]: re.target.result
                  }
                };
                update();
              }
            };
            reader.readAsDataURL(file);
          }
        };
      }
    };

    setupDropzone('dropzone-feed', 'feed-input', 'feedTemplate');
    setupDropzone('dropzone-story', 'story-input', 'storyTemplate');

    if (cc.step === 2 && cc.type === 'segment') {
      container.querySelectorAll('input[data-seg-id]').forEach(input => {
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const segId = input.dataset.segId;
          const formatKey = input.dataset.segFormat;
          const reader = new FileReader();
          reader.onload = async (re) => {
            try {
              const optimizedData = await optimizeTemplate(re.target.result);
              const ccOpts = state.assetManager.createCampaign;
              const segs = ccOpts.segments || {};
              state.assetManager.createCampaign = {
                ...ccOpts,
                segments: {
                  ...segs,
                  [segId]: { ...(segs[segId] || {}), [formatKey]: optimizedData }
                }
              };
              update();
            } catch (err) {
              console.error("Error optimizing segment template:", err);
              // Fallback: use raw data
              const ccOpts = state.assetManager.createCampaign;
              const segs = ccOpts.segments || {};
              state.assetManager.createCampaign = {
                ...ccOpts,
                segments: {
                  ...segs,
                  [segId]: { ...(segs[segId] || {}), [formatKey]: re.target.result }
                }
              };
              update();
            }
          };
          reader.readAsDataURL(file);
        };
      });
    }
  };

  update();
};
