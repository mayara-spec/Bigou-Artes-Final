import { state, navigate } from '../services/state.js';

export const renderTemplateBuilder = (container) => {
  const config = state.currentCampaignConfig;
  if (!config) { navigate('dashboard'); return; }

  const allPotentialSteps = [
    { id: 'logos', key: 'useTop20', label: 'Mapeamento de Logos', icon: '<circle cx="12" cy="12" r="10"/>', accent: '#10B981', desc: 'LOGOS' },
    { id: 'cityImage', key: 'cityImage', label: 'Definir Imagem da Cidade', icon: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>', accent: '#3B82F6', desc: 'IMAGEM' },
    { id: 'cityText', key: 'useCityText', label: 'Definir Texto da Cidade', icon: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18.1H3"/><path d="M17 6.1v12"/><path d="m21 18.1-4 4-4-4"/>', accent: '#FBBF24', desc: 'TEXTO' }
  ];

  const activeSteps = allPotentialSteps.filter(s => config?.dynamicOptions?.[s.key]);

  // ─── Segment awareness ────────────────────────────────────────────────────
  const isSegmentMode = config.type === 'segment';
  const configSegments = config.segments || {};
  const activeSegments = isSegmentMode
    ? (state.segments || []).filter(s => configSegments[s.id]?.feedTemplate || configSegments[s.id]?.storyTemplate)
    : [];
  let activeSegmentId = isSegmentMode && activeSegments.length > 0 ? activeSegments[0].id : null;

  // Default flat slot shape
  const makeDefaultSlots = () => ({
    logosFeed: [], logosStory: [], logoSource: 'top20', syncMode: 'feed-to-story',
    cityImageFeed: null, cityImageStory: null, cityTextFeed: null, cityTextStory: null
  });

  // ─── State ────────────────────────────────────────────────────────────────
  let currentStepIdx = 0;

  // For segment mode, builderSlots is a dict { segId: flatSlots }.
  // For single mode, builderSlots is flatSlots directly.
  let allSegmentSlots = {};
  if (isSegmentMode) {
    const saved = state.builderSlots && typeof state.builderSlots === 'object' ? state.builderSlots : {};
    activeSegments.forEach(seg => {
      allSegmentSlots[seg.id] = saved[seg.id]
        ? JSON.parse(JSON.stringify(saved[seg.id]))
        : makeDefaultSlots();
    });
  }

  // `slots` always points to the ACTIVE flat slots (either single or current segment)
  let slots = isSegmentMode
    ? (allSegmentSlots[activeSegmentId] || makeDefaultSlots())
    : (state.builderSlots ? JSON.parse(JSON.stringify(state.builderSlots)) : makeDefaultSlots());

  // Helper: persist slots back to state
  const persistSlots = () => {
    if (isSegmentMode) {
      allSegmentSlots[activeSegmentId] = slots;
      state.builderSlots = allSegmentSlots;
    } else {
      state.builderSlots = slots;
    }
  };

  // Helper: switch active segment
  const switchSegment = (segId) => {
    if (!isSegmentMode) return;
    // Save current slots
    allSegmentSlots[activeSegmentId] = JSON.parse(JSON.stringify(slots));
    state.builderSlots = allSegmentSlots;
    // Switch
    activeSegmentId = segId;
    slots = allSegmentSlots[segId] || makeDefaultSlots();
    allSegmentSlots[segId] = slots;
    selectedSlotIds.clear();
    history = []; historyIdx = -1;
    pushHistory();
    update();
  };

  // Helper: apply current segment's slots to ALL other segments
  const applyToAllSegments = (scope) => {
    if (!isSegmentMode) return;
    const source = JSON.parse(JSON.stringify(slots));
    activeSegments.forEach(seg => {
      if (seg.id === activeSegmentId) return;
      const target = allSegmentSlots[seg.id] || makeDefaultSlots();
      if (!scope || scope === 'logos') {
        target.logosFeed = JSON.parse(JSON.stringify(source.logosFeed));
        target.logosStory = JSON.parse(JSON.stringify(source.logosStory));
      }
      if (!scope || scope === 'image') {
        target.cityImageFeed = source.cityImageFeed ? { ...source.cityImageFeed } : null;
        target.cityImageStory = source.cityImageStory ? { ...source.cityImageStory } : null;
      }
      if (!scope || scope === 'text') {
        target.cityTextFeed = source.cityTextFeed ? { ...source.cityTextFeed } : null;
        target.cityTextStory = source.cityTextStory ? { ...source.cityTextStory } : null;
      }
      allSegmentSlots[seg.id] = target;
    });
    state.builderSlots = allSegmentSlots;
  };

  let selectedSlotIds = new Set();
  let selectedFormat = 'story';
  let toolMode = 'create';

  // Clipboard
  let clipboard = [];

  // Undo / Redo history (max 100)
  const MAX_HISTORY = 100;
  let history = [];
  let historyIdx = -1;
  const cloneSlots = () => JSON.parse(JSON.stringify({ lf: slots.logosFeed, ls: slots.logosStory, cif: slots.cityImageFeed, cis: slots.cityImageStory, ctf: slots.cityTextFeed, cts: slots.cityTextStory }));
  const pushHistory = () => {
    history = history.slice(0, historyIdx + 1);
    history.push(cloneSlots());
    if (history.length > MAX_HISTORY) history.shift();
    historyIdx = history.length - 1;
  };
  const restoreSnapshot = (snap) => {
    slots.logosFeed = snap.lf; slots.logosStory = snap.ls;
    slots.cityImageFeed = snap.cif; slots.cityImageStory = snap.cis;
    slots.cityTextFeed = snap.ctf; slots.cityTextStory = snap.cts;
    selectedSlotIds.clear(); persistSlots();
  };
  // Push initial state
  pushHistory();

  // Drag state
  let isDrawing = false;
  let dragMode = null; // 'create' | 'move' | 'resize' | 'pan' | 'marquee'
  let dragTargetId = null;
  let dragHandle = null;
  let dragOffset = { x: 0, y: 0 };
  let startX, startY, startW, startH;
  let marqueeStart = { x: 0, y: 0 };

  // Canvas geometry
  let baseScale = 1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let isSpaceDown = false;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const getGroupBBox = (list) => {
    if (!list.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of list) { x1 = Math.min(x1, s.x); y1 = Math.min(y1, s.y); x2 = Math.max(x2, s.x + s.w); y2 = Math.max(y2, s.y + s.h); }
    return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
  };
  const getSelectedLogos = () => {
    const k = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
    return slots[k].filter(s => selectedSlotIds.has(s.id));
  };

  // Canvas native dimensions
  const STORY_W = 1080, STORY_H = 1920;
  const FEED_W = 1080, FEED_H = 1350;
  const GAP = 80;   // gap between story and feed
  const GROUP_W = STORY_W + GAP + FEED_W; // 2240
  const GROUP_H = Math.max(STORY_H, FEED_H); // 1920

  // ─── Scale helpers ────────────────────────────────────────────────────────
  const computeAutoFit = () => {
    const ws = container.querySelector('#canvas-workspace');
    if (!ws || ws.clientWidth === 0) return;
    const aw = ws.clientWidth - 60;
    const ah = ws.clientHeight - 60;
    baseScale = Math.min(aw / GROUP_W, ah / GROUP_H);
    zoom = 1; // reset manual zoom
    panX = 0;
    panY = 0;
  };

  const applyScale = () => {
    const scaler = container.querySelector('#canvas-scaler');
    const label = container.querySelector('#zoom-label');
    const ws = container.querySelector('#canvas-workspace');
    if (!scaler || !ws) return;

    const s = baseScale * zoom;
    const scaledWidth = GROUP_W * s;
    const scaledHeight = GROUP_H * s;

    const offsetX = (ws.clientWidth - scaledWidth) / 2 + panX;
    const offsetY = (ws.clientHeight - scaledHeight) / 2 + panY;

    scaler.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${s})`;
    if (label) label.innerText = `${Math.round(s * 100)}%`;
  };

  const resetFit = () => {
    computeAutoFit();
    applyScale();
  };

  // Canvas native aspect ratios for circle recalculation on sync
  const RATIO = {
    story: STORY_W / STORY_H, // 0.5625
    feed: FEED_W / FEED_H   // 0.8
  };

  // ─── Sync ─────────────────────────────────────────────────────────────────
  const syncSlots = (sourceFmt, scope) => {
    if (slots.syncMode === 'off') return;
    const targetFmt = sourceFmt === 'story' ? 'feed' : 'story';
    const srcR = RATIO[sourceFmt];
    const dstR = RATIO[targetFmt];

    const mirrorLogos = (srcKey, dstKey) => {
      slots[dstKey] = slots[srcKey].map(s => ({
        ...s,
        id: Date.now() + Math.random(),
        h: s.w * dstR
      }));
    };

    const mirrorText = (srcKey, dstKey) => {
      if (slots[srcKey] && slots[dstKey]) {
        slots[dstKey] = { ...slots[dstKey], font: slots[srcKey].font, color: slots[srcKey].color };
      }
    };

    // scope: 'logos' | 'text' | 'image' | undefined (= all)
    if (slots.syncMode === 'feed-to-story' && sourceFmt === 'feed') {
      if (!scope || scope === 'logos') mirrorLogos('logosFeed', 'logosStory');
      if (!scope || scope === 'text') mirrorText('cityTextFeed', 'cityTextStory');
      if (!scope || scope === 'image') mirrorText('cityImageFeed', 'cityImageStory');
    }
    if (slots.syncMode === 'story-to-feed' && sourceFmt === 'story') {
      if (!scope || scope === 'logos') mirrorLogos('logosStory', 'logosFeed');
      if (!scope || scope === 'text') mirrorText('cityTextStory', 'cityTextFeed');
      if (!scope || scope === 'image') mirrorText('cityImageStory', 'cityImageFeed');
    }
  };

  // Determine scope from active step to avoid cross-contamination
  const getSyncScope = () => {
    const step = activeSteps[currentStepIdx];
    if (!step) return undefined;
    if (step.id === 'logos') return 'logos';
    if (step.id === 'cityText') return 'text';
    if (step.id === 'cityImage') return 'image';
    return undefined;
  };

  // ─── Render helpers ───────────────────────────────────────────────────────
  const renderHeader = () => {
    const step = activeSteps[currentStepIdx];
    if (!step) return '';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;background:#0F172A;padding:0 2rem;border-bottom:1px solid #1E293B;height:60px;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="width:36px;height:36px;background:${step.accent};border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${step.icon}</svg>
          </div>
          <div>
            <div style="font-size:0.875rem;font-weight:800;color:white;">Passo ${currentStepIdx + 1}: ${step.label}</div>
            <div style="font-size:0.65rem;color:#475569;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${isSegmentMode ? 'FLUXO: POR SEGMENTO' : 'Bigou Campaign Builder'}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <div style="display:flex;gap:6px;align-items:center;background:#1E293B;padding:6px 12px;border-radius:2rem;">
            ${activeSteps.map((_, i) => `<div style="width:7px;height:7px;border-radius:50%;background:${i === currentStepIdx ? step.accent : i < currentStepIdx ? '#10B981' : '#334155'};"></div>`).join('')}
            <span style="font-size:0.65rem;color:#94A3B8;font-weight:800;margin-left:4px;">${currentStepIdx + 1}/${activeSteps.length}</span>
          </div>
          <div style="width:7px;height:7px;background:${step.accent};border-radius:50%;box-shadow:0 0 8px ${step.accent};"></div>
          <span style="font-size:0.75rem;font-weight:800;color:white;text-transform:uppercase;">Definindo ${step.desc}</span>
        </div>
      </div>
      ${isSegmentMode ? `
      <div style="background:#0F172A;border-bottom:1px solid #1E293B;padding:0 2rem;display:flex;align-items:center;gap:0;flex-shrink:0;height:42px;overflow-x:auto;">
        ${activeSegments.map(seg => `
          <button onclick="window.switchSegmentTab('${seg.id}')" style="
            padding:0 1.25rem;height:100%;border:none;cursor:pointer;font-size:0.75rem;font-weight:800;
            letter-spacing:0.04em;text-transform:uppercase;white-space:nowrap;
            background:${seg.id === activeSegmentId ? '#1E293B' : 'transparent'};
            color:${seg.id === activeSegmentId ? '#10B981' : '#64748B'};
            border-bottom:${seg.id === activeSegmentId ? '3px solid #10B981' : '3px solid transparent'};
            transition:all 0.15s;
          ">${seg.name}</button>
        `).join('')}
      </div>
      ` : ''}
    `;
  };

  const renderRightPanel = () => {
    const step = activeSteps[currentStepIdx];
    if (!step) return '';
    if (step.id === 'logos') return renderLogosPanel();
    if (step.id === 'cityImage') return renderImagePanel();
    return renderTextPanel();
  };

  const renderLogosPanel = () => {
    const storyCount = slots.logosStory.length;
    const feedCount = slots.logosFeed.length;
    const storyFull = storyCount >= 20;
    const feedFull = feedCount >= 20;
    const hasSel = selectedSlotIds.size > 0;
    const selCount = selectedSlotIds.size;
    const abStyle = (en) => `width:100%;background:${en ? '#1E293B' : '#0F172A'};color:${en ? '#94A3B8' : '#334155'};padding:8px;border-radius:8px;border:1px solid #1E293B;cursor:${en ? 'pointer' : 'not-allowed'};font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;gap:4px;`;

    return `
      <div style="display:flex;flex-direction:column;gap:1rem;padding:1.25rem;overflow-y:auto;height:100%;">
        ${isSegmentMode ? `
        <button onclick="window.applyToAllSegs()" style="width:100%;padding:1rem;background:#10B981;color:white;border:none;border-radius:0.875rem;font-weight:800;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(16,185,129,0.3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          APLICAR POSICIONAMENTO EM TODOS OS SEGMENTOS
        </button>
        <div style="font-size:0.6rem;color:#64748B;text-align:center;margin-top:-0.5rem;">Isso irá replicar os slots do segmento atual para as outras ${activeSegments.length - 1} categorias.</div>
        ` : ''}
        <div style="font-size:0.65rem;font-weight:800;color:#475569;letter-spacing:0.12em;">SLOTS CRIADOS</div>
        <div style="display:flex;gap:0.75rem;">
          <div style="flex:1;background:#0F172A;border:1px solid ${storyFull ? '#EF4444' : '#1E293B'};border-radius:0.75rem;padding:0.75rem;text-align:center;">
            <div style="font-size:1.25rem;font-weight:900;color:${storyFull ? '#EF4444' : '#10B981'};">${storyCount}</div>
            <div style="font-size:0.6rem;font-weight:700;color:#475569;">STORY /20</div>
          </div>
          <div style="flex:1;background:#0F172A;border:1px solid ${feedFull ? '#EF4444' : '#1E293B'};border-radius:0.75rem;padding:0.75rem;text-align:center;">
            <div style="font-size:1.25rem;font-weight:900;color:${feedFull ? '#EF4444' : '#10B981'};">${feedCount}</div>
            <div style="font-size:0.6rem;font-weight:700;color:#475569;">FEED /20</div>
          </div>
        </div>

        ${selCount > 0 ? `<div style="background:#10B98118;border:1px solid #10B98140;border-radius:8px;padding:8px 12px;text-align:center;font-size:0.7rem;font-weight:800;color:#10B981;">${selCount} selecionado${selCount > 1 ? 's' : ''}</div>` : ''}

        <button onclick="window.duplicateSlot()" style="${abStyle(hasSel)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          DUPLICAR${selCount > 1 ? ' (' + selCount + ')' : ''}
        </button>
        <button onclick="window.deleteSelectedSlot()" style="width:100%;background:${hasSel ? '#2D1B1B' : '#0F172A'};color:${hasSel ? '#EF4444' : '#475569'};padding:8px;border-radius:8px;font-weight:700;border:1px solid ${hasSel ? '#451A1A' : '#1E293B'};cursor:${hasSel ? 'pointer' : 'not-allowed'};font-size:0.65rem;display:flex;align-items:center;justify-content:center;gap:4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"/></svg>
          EXCLUIR${selCount > 1 ? ' (' + selCount + ')' : ''}
        </button>

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">ALINHAR NO CANVAS</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
            <button onclick="window.alignSlots('left')" title="Esquerda no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg></button>
            <button onclick="window.alignSlots('centerH')" title="Centro H no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="22"/><rect x="4" y="6" width="16" height="4" rx="1"/><rect x="6" y="14" width="12" height="4" rx="1"/></svg></button>
            <button onclick="window.alignSlots('right')" title="Direita no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg></button>
            <button onclick="window.alignSlots('top')" title="Topo no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="4" x2="22" y2="4"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg></button>
            <button onclick="window.alignSlots('centerV')" title="Centro V no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="6" width="4" height="12" rx="1"/></svg></button>
            <button onclick="window.alignSlots('bottom')" title="Base no canvas" style="${abStyle(hasSel)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="20" x2="22" y2="20"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg></button>
          </div>
        </div>

        ${selCount > 1 ? `<div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#3B82F6;letter-spacing:0.12em;margin-bottom:0.5rem;">ALINHAR ENTRE OBJETOS</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
            <button onclick="window.alignLocal('left')" title="Alinhar esquerda" style="${abStyle(true)}">⇤ Esq</button>
            <button onclick="window.alignLocal('centerH')" title="Centro H" style="${abStyle(true)}">⬌ CH</button>
            <button onclick="window.alignLocal('right')" title="Alinhar direita" style="${abStyle(true)}">⇥ Dir</button>
            <button onclick="window.alignLocal('top')" title="Alinhar topo" style="${abStyle(true)}">⬆ Top</button>
            <button onclick="window.alignLocal('centerV')" title="Centro V" style="${abStyle(true)}">⬍ CV</button>
            <button onclick="window.alignLocal('bottom')" title="Alinhar base" style="${abStyle(true)}">⬇ Bas</button>
          </div>
        </div>` : ''}

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">DISTRIBUIÇÃO</div>
          <div style="display:flex;gap:4px;">
            <button onclick="window.distributeSlots('horizontal')" style="${abStyle(selCount >= 3)}">↔ Horizontal</button>
            <button onclick="window.distributeSlots('vertical')" style="${abStyle(selCount >= 3)}">↕ Vertical</button>
          </div>
        </div>

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">LIMPAR TUDO</div>
          <div style="display:flex;gap:4px;">
            <button onclick="window.clearSlots('logosStory')" style="flex:1;background:#0F172A;color:#94A3B8;padding:8px;border-radius:8px;font-weight:700;border:1px solid #1E293B;cursor:pointer;font-size:0.65rem;">STORY</button>
            <button onclick="window.clearSlots('logosFeed')" style="flex:1;background:#0F172A;color:#94A3B8;padding:8px;border-radius:8px;font-weight:700;border:1px solid #1E293B;cursor:pointer;font-size:0.65rem;">FEED</button>
          </div>
        </div>

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">SINCRONIZAÇÃO</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${[{ mode: 'off', label: 'Desligada' }, { mode: 'feed-to-story', label: 'Feed → Story' }, { mode: 'story-to-feed', label: 'Story → Feed' }].map(o => `
              <button onclick="window.setSyncMode('${o.mode}')" style="text-align:left;padding:8px 12px;border-radius:8px;border:1px solid ${slots.syncMode === o.mode ? '#10B981' : '#1E293B'};background:${slots.syncMode === o.mode ? '#10B98115' : 'transparent'};color:${slots.syncMode === o.mode ? 'white' : '#64748B'};cursor:pointer;font-size:0.65rem;font-weight:700;">${o.label}</button>
            `).join('')}
          </div>
        </div>

        <div style="flex:1;"></div>
        <div style="background:#1E293B30;border-radius:0.75rem;padding:0.75rem;border:1px solid #1E293B20;">
          <div style="font-size:0.65rem;font-weight:800;color:#475569;margin-bottom:6px;">ATALHOS</div>
          <div style="color:#64748B;font-size:0.6rem;font-weight:600;line-height:1.8;">
            <div>Shift+Click = multi-seleção</div>
            <div>Arraste no canvas = seleção por área</div>
            <div>⌘C / ⌘V = copiar / colar</div>
            <div>⌘D = duplicar</div>
            <div>⌘Z = desfazer</div>
            <div>⌘⇧Z = refazer</div>
            <div>Delete = excluir</div>
            <div>Esc = limpar seleção</div>
          </div>
        </div>
      </div>
    `;
  };

  const renderImagePanel = () => {
    const fmtSuffix = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
    return `
      <div style="padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem;">
        ${isSegmentMode ? `
        <button onclick="window.applyToAllSegs()" style="width:100%;padding:1rem;background:#10B981;color:white;border:none;border-radius:0.875rem;font-weight:800;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(16,185,129,0.3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          APLICAR POSICIONAMENTO EM TODOS OS SEGMENTOS
        </button>
        ` : ''}
        <div style="background:#3B82F610;border:1px solid #3B82F630;padding:1.5rem;border-radius:1rem;display:flex;align-items:center;gap:1rem;color:#3B82F6;">
          <div style="width:44px;height:44px;background:#3B82F6;border-radius:12px;display:flex;align-items:center;justify-content:center;color:white;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </div>
          <div style="flex:1;">
            <div style="font-weight:800;color:white;font-size:0.9375rem;">Foto da Cidade</div>
            <div style="font-size:0.7rem;color:#64748B;">IMAGEM DE FUNDO DINÂMICA</div>
          </div>
          ${slots[`cityImage${fmtSuffix}`] ? '<div style="font-size:0.65rem;font-weight:900;color:#10B981;">✓ DEFINIDO</div>' : ''}
        </div>

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">ALINHAR NO CANVAS</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
            <button onclick="window.alignTextSlot('left')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⇤ Esq</button>
            <button onclick="window.alignTextSlot('centerH')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⬌ CH</button>
            <button onclick="window.alignTextSlot('right')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⇥ Dir</button>
            <button onclick="window.alignTextSlot('top')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⬆ Top</button>
            <button onclick="window.alignTextSlot('centerV')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⬍ CV</button>
            <button onclick="window.alignTextSlot('bottom')" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${slots[`cityImage${fmtSuffix}`] ? '#1E293B' : '#0F172A'};color:${slots[`cityImage${fmtSuffix}`] ? '#94A3B8' : '#334155'};cursor:${slots[`cityImage${fmtSuffix}`] ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;">⬇ Bas</button>
          </div>
        </div>

        <button onclick="window.clearActiveSlot()" style="width:100%;padding:1rem;background:#2D1B1B;color:#EF4444;border:1px solid #451A1A;border-radius:0.875rem;font-weight:800;font-size:0.75rem;cursor:pointer;">LIMPAR ÁREA DE IMAGEM</button>
      </div>
    `;
  };

  const renderTextPanel = () => {
    const fmtSuffix = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
    const ct = slots[`cityText${fmtSuffix}`];
    // Dynamic font list from state.typographies + system defaults
    const systemFonts = [
      { name: 'Manrope Bold (Padrão)', value: 'Manrope' },
      { name: 'Arial', value: 'Arial' },
      { name: 'Georgia', value: 'Georgia' }
    ];
    const customFonts = (state.typographies || []).map(t => ({ name: t.name, value: t.name }));
    const allFonts = [...systemFonts, ...customFonts];
    return `
      <div style="padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem;">
        ${isSegmentMode ? `
        <button onclick="window.applyToAllSegs()" style="width:100%;padding:1rem;background:#10B981;color:white;border:none;border-radius:0.875rem;font-weight:800;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 12px rgba(16,185,129,0.3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          APLICAR POSICIONAMENTO EM TODOS OS SEGMENTOS
        </button>
        ` : ''}
        <div style="background:#FBBF2410;border:1px solid #FBBF2430;padding:1.5rem;border-radius:1rem;display:flex;align-items:center;gap:1rem;color:#FBBF24;">
          <div style="width:44px;height:44px;background:#FBBF24;border-radius:12px;display:flex;align-items:center;justify-content:center;color:black;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 7V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><rect width="18" height="13" x="3" y="7" rx="2"/></svg>
          </div>
          <div style="flex:1;">
            <div style="font-weight:800;color:white;font-size:0.9375rem;">Texto da Cidade</div>
            <div style="font-size:0.7rem;color:#64748B;">NOME DA PASTA / CIDADE</div>
          </div>
          ${ct ? '<div style="font-size:0.65rem;font-weight:900;color:#10B981;">✓ DEFINIDO</div>' : ''}
        </div>

        <div style="background:#FBBF2408;border:1px solid #FBBF2420;border-radius:0.75rem;padding:0.875rem;">
          <div style="font-size:0.65rem;font-weight:800;color:#FBBF24;margin-bottom:4px;">💡 USO DO TEXTO</div>
          <div style="font-size:0.65rem;color:#94A3B8;line-height:1.6;">O texto usará o <b style="color:white;">nome da pasta</b> (ex: Abaeté). Posicione a área onde o nome da cidade aparecerá.</div>
        </div>

        <div>
          <label style="font-size:0.65rem;font-weight:800;color:#475569;display:block;margin-bottom:0.5rem;letter-spacing:0.08em;">TIPOGRAFIA</label>
          <select id="text-font" onchange="window.updateTextFont(this.value)" style="width:100%;background:#020617;color:white;border:1px solid #1E293B;padding:0.875rem;border-radius:0.875rem;font-weight:700;">
            ${allFonts.map(f => `<option value="${f.value}" ${ct?.font === f.value ? 'selected' : ''}>${f.name}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="font-size:0.65rem;font-weight:800;color:#475569;display:block;margin-bottom:0.5rem;letter-spacing:0.08em;">COR DO TEXTO</label>
          <div style="display:flex;gap:0.75rem;align-items:center;background:#020617;padding:0.875rem;border-radius:0.875rem;border:1px solid #1E293B;">
            <input type="color" id="text-color-picker" value="${ct?.color || '#FFFFFF'}" oninput="window.handleColorChange(this.value)" style="width:32px;height:32px;border:none;background:none;cursor:pointer;padding:0;border-radius:6px;" />
            <input type="text"  id="text-color-input"  value="${ct?.color || '#FFFFFF'}" onchange="window.handleColorChange(this.value)" style="background:transparent;border:none;color:white;font-weight:800;flex:1;outline:none;font-size:0.875rem;">
          </div>
        </div>

        <div style="border-top:1px solid #1E293B;padding-top:1.25rem;">
          <div style="font-size:0.65rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.75rem;">SINCRONIZAÇÃO</div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            ${[{ mode: 'off', label: 'Desligada' }, { mode: 'feed-to-story', label: 'Feed → Story' }, { mode: 'story-to-feed', label: 'Story → Feed' }].map(o => `
              <button onclick="window.setSyncMode('${o.mode}')" style="text-align:left;padding:0.75rem 1rem;border-radius:0.75rem;border:1px solid ${slots.syncMode === o.mode ? '#FBBF24' : '#1E293B'};background:${slots.syncMode === o.mode ? '#FBBF2415' : 'transparent'};color:${slots.syncMode === o.mode ? 'white' : '#64748B'};cursor:pointer;font-size:0.7rem;font-weight:700;">${o.label}</button>
            `).join('')}
          </div>
        </div>

        <div style="border-top:1px solid #1E293B;padding-top:1rem;">
          <div style="font-size:0.6rem;font-weight:800;color:#475569;letter-spacing:0.12em;margin-bottom:0.5rem;">ALINHAR NO CANVAS</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
            <button onclick="window.alignTextSlot('left')" title="Esquerda" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg></button>
            <button onclick="window.alignTextSlot('centerH')" title="Centro H" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="2" x2="12" y2="22"/><rect x="4" y="6" width="16" height="4" rx="1"/><rect x="6" y="14" width="12" height="4" rx="1"/></svg></button>
            <button onclick="window.alignTextSlot('right')" title="Direita" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg></button>
            <button onclick="window.alignTextSlot('top')" title="Topo" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="4" x2="22" y2="4"/><rect x="6" y="8" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg></button>
            <button onclick="window.alignTextSlot('centerV')" title="Centro V" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="6" width="4" height="12" rx="1"/></svg></button>
            <button onclick="window.alignTextSlot('bottom')" title="Base" style="padding:8px;border-radius:8px;border:1px solid #1E293B;background:${ct ? '#1E293B' : '#0F172A'};color:${ct ? '#94A3B8' : '#334155'};cursor:${ct ? 'pointer' : 'not-allowed'};font-size:0.6rem;font-weight:700;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="20" x2="22" y2="20"/><rect x="6" y="4" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg></button>
          </div>
        </div>

        <button onclick="window.clearActiveSlot()" style="width:100%;padding:1rem;background:#2D1B1B;color:#EF4444;border:1px solid #451A1A;border-radius:0.875rem;font-weight:800;font-size:0.75rem;cursor:pointer;">LIMPAR ÁREA DE TEXTO</button>
      </div>
    `;
  };

  // ─── Layers ───────────────────────────────────────────────────────────────
  const updateLayers = () => {
    ['story', 'feed'].forEach(fmt => {
      const layer = container.querySelector(`#slots-layer-${fmt}`);
      if (!layer) return;
      layer.innerHTML = '';
      const step = activeSteps[currentStepIdx];
      const formatLogos = fmt === 'story' ? slots.logosStory : slots.logosFeed;

      formatLogos.forEach((s, idx) => {
        const isSelected = selectedSlotIds.has(s.id) && selectedFormat === fmt;
        const el = document.createElement('div');
        el.className = 'slot-logo';
        el.dataset.id = s.id;
        el.dataset.fmt = fmt;
        Object.assign(el.style, {
          position: 'absolute',
          left: `${s.x * 100}%`,
          top: `${s.y * 100}%`,
          width: `${s.w * 100}%`,
          height: `${s.h * 100}%`,
          border: isSelected ? '3px solid white' : '3px solid #10B981',
          background: isSelected ? '#10B98130' : '#10B98115',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: '900',
          cursor: 'move',
          pointerEvents: 'auto',
          boxSizing: 'border-box',
          zIndex: isSelected ? '100' : '10',
          userSelect: 'none'
        });

        el.innerHTML = `<span style="font-size:clamp(10px, 4cqw, 60px);pointer-events:none;">${idx + 1}</span>`;

        if (isSelected) {
          [
            { pos: 'top:-10px;left:-10px;cursor:nw-resize;', type: 'tl' },
            { pos: 'top:-10px;right:-10px;cursor:ne-resize;', type: 'tr' },
            { pos: 'bottom:-10px;left:-10px;cursor:sw-resize;', type: 'bl' },
            { pos: 'bottom:-10px;right:-10px;cursor:se-resize;', type: 'br' }
          ].forEach(h => {
            el.innerHTML += `<div class="resize-handle" data-id="${s.id}" data-type="${h.type}" data-fmt="${fmt}" data-slottype="logo"
              style="position:absolute;${h.pos}width:20px;height:20px;background:white;border-radius:50%;border:3px solid #10B981;z-index:200;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`;
          });
        }

        layer.appendChild(el);
      });

      // ── Group Bounding Box ──────────────────────────────────────────
      if (selectedSlotIds.size > 1 && selectedFormat === fmt) {
        const sel = formatLogos.filter(s => selectedSlotIds.has(s.id));
        if (sel.length > 1) {
          const bb = getGroupBBox(sel);
          const bbEl = document.createElement('div');
          Object.assign(bbEl.style, {
            position: 'absolute',
            left: `${bb.x1 * 100}%`, top: `${bb.y1 * 100}%`,
            width: `${bb.w * 100}%`, height: `${bb.h * 100}%`,
            border: '2px dashed rgba(255,255,255,0.4)',
            borderRadius: '4px',
            pointerEvents: 'none',
            zIndex: '5',
            boxSizing: 'border-box'
          });
          layer.appendChild(bbEl);
        }
      }

      // ── City Image Slot (rectangle) ────────────────────────────────
      const fmtSuf = fmt.charAt(0).toUpperCase() + fmt.slice(1);
      const ciKey = `cityImage${fmtSuf}`;
      const ci = slots[ciKey];
      if (ci) {
        const isSelCI = selectedSlotIds.has(ciKey) && selectedFormat === fmt;
        const el = document.createElement('div');
        el.className = 'slot-logo';
        el.dataset.id = ciKey;
        el.dataset.fmt = fmt;
        el.dataset.slottype = 'cityImage';
        Object.assign(el.style, {
          position: 'absolute', left: `${ci.x * 100}%`, top: `${ci.y * 100}%`,
          width: `${ci.w * 100}%`, height: `${ci.h * 100}%`,
          border: isSelCI ? '3px solid #60A5FA' : '3px dashed #3B82F6',
          background: isSelCI ? '#3B82F625' : '#3B82F610',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'move', pointerEvents: 'auto', boxSizing: 'border-box',
          zIndex: isSelCI ? '100' : '10', userSelect: 'none'
        });
        el.innerHTML = `<div style="background:#3B82F6;color:white;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:800;pointer-events:none;">&#128247; FOTO DA CIDADE</div>`;
        if (isSelCI) {
          [{ pos: 'top:-10px;left:-10px;cursor:nw-resize;', type: 'tl' }, { pos: 'top:-10px;right:-10px;cursor:ne-resize;', type: 'tr' },
          { pos: 'bottom:-10px;left:-10px;cursor:sw-resize;', type: 'bl' }, { pos: 'bottom:-10px;right:-10px;cursor:se-resize;', type: 'br' }].forEach(h => {
            el.innerHTML += `<div class="resize-handle" data-id="${ciKey}" data-type="${h.type}" data-fmt="${fmt}" data-slottype="cityImage"
              style="position:absolute;${h.pos}width:20px;height:20px;background:white;border-radius:4px;border:3px solid #3B82F6;z-index:200;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`;
          });
        }
        layer.appendChild(el);
      }

      // ── City Text Slot (rectangle) ─────────────────────────────────
      const ctKey = `cityText${fmtSuf}`;
      const ct = slots[ctKey];
      if (ct) {
        const isSelCT = selectedSlotIds.has(ctKey) && selectedFormat === fmt;
        const el = document.createElement('div');
        el.className = 'slot-logo';
        el.dataset.id = ctKey;
        el.dataset.fmt = fmt;
        el.dataset.slottype = 'cityText';
        Object.assign(el.style, {
          position: 'absolute', left: `${ct.x * 100}%`, top: `${ct.y * 100}%`,
          width: `${ct.w * 100}%`, height: `${ct.h * 100}%`,
          border: isSelCT ? '3px solid #FDE68A' : '3px solid #FBBF24',
          background: isSelCT ? '#FBBF2425' : '#FBBF2410',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'move', pointerEvents: 'auto', boxSizing: 'border-box',
          zIndex: isSelCT ? '100' : '10', userSelect: 'none'
        });
        el.innerHTML = `<span style="color:${ct.color};font-weight:900;font-family:'${ct.font}', sans-serif;font-size:clamp(12px, 5cqw, 80px);white-space:nowrap;user-select:none;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">CIDADE</span>`;
        if (isSelCT) {
          [{ pos: 'top:-10px;left:-10px;cursor:nw-resize;', type: 'tl' }, { pos: 'top:-10px;right:-10px;cursor:ne-resize;', type: 'tr' },
          { pos: 'bottom:-10px;left:-10px;cursor:sw-resize;', type: 'bl' }, { pos: 'bottom:-10px;right:-10px;cursor:se-resize;', type: 'br' }].forEach(h => {
            el.innerHTML += `<div class="resize-handle" data-id="${ctKey}" data-type="${h.type}" data-fmt="${fmt}" data-slottype="cityText"
              style="position:absolute;${h.pos}width:20px;height:20px;background:white;border-radius:4px;border:3px solid #FBBF24;z-index:200;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`;
          });
        }
        layer.appendChild(el);
      }
    });
  };

  // ─── Full render ──────────────────────────────────────────────────────────
  const update = () => {
    try {
      const step = activeSteps[currentStepIdx];
      if (!step) {
        container.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;background:#020617;color:white;flex-direction:column;gap:1rem;"><p style="font-size:1.25rem;font-weight:700;">Nenhum passo de mapeamento ativo.</p><button onclick="window.nav('create-campaign')" style="padding:0.75rem 2rem;background:#10B981;border:none;border-radius:0.5rem;color:white;font-weight:800;cursor:pointer;">VOLTAR</button></div>`;
        return;
      }

      const storyFull = slots.logosStory.length >= 20;
      const feedFull = slots.logosFeed.length >= 20;
      const isCreating = toolMode === 'create';

      container.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#020617;">

          ${renderHeader()}

          <div style="display:grid;grid-template-columns:60px 1fr 310px;flex:1;min-height:0;overflow:hidden;">

            <!-- Left Toolbar -->
            <div style="background:#0F172A;border-right:1px solid #1E293B;display:flex;flex-direction:column;align-items:center;padding:1rem 0;gap:0.5rem;">
              ${activeSteps.map((s, i) => `
                <button onclick="window.setStep(${i})" title="${s.label}" style="width:44px;height:44px;border-radius:10px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;color:${currentStepIdx === i ? 'white' : '#475569'};background:${currentStepIdx === i ? s.accent : 'transparent'};transition:all 0.15s;">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${s.icon}</svg>
                </button>
              `).join('')}

              <div style="width:32px;height:1px;background:#1E293B;margin:0.5rem 0;"></div>

              <!-- Tool: Create -->
              <button onclick="window.setToolMode('create')" title="Criar círculo" style="width:44px;height:44px;border-radius:10px;border:2px solid ${isCreating ? '#10B981' : 'transparent'};display:flex;align-items:center;justify-content:center;cursor:pointer;color:${isCreating ? '#10B981' : '#475569'};background:${isCreating ? '#10B98115' : 'transparent'};">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              </button>

              <!-- Tool: Select/Navigate -->
              <button onclick="window.setToolMode('select')" title="Selecionar / Navegar" style="width:44px;height:44px;border-radius:10px;border:2px solid ${!isCreating ? '#10B981' : 'transparent'};display:flex;align-items:center;justify-content:center;cursor:pointer;color:${!isCreating ? '#10B981' : '#475569'};background:${!isCreating ? '#10B98115' : 'transparent'};">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 3l14 9-7 1-4 7z"/></svg>
              </button>

              <div style="flex:1;"></div>

              <!-- Zoom in -->
              <button onclick="window.zoomIn()" style="width:36px;height:36px;border-radius:8px;border:1px solid #1E293B;background:#0F172A;color:#94A3B8;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>

              <span id="zoom-label" style="font-size:0.6rem;font-weight:800;color:#475569;">50%</span>

              <!-- Zoom out -->
              <button onclick="window.zoomOut()" style="width:36px;height:36px;border-radius:8px;border:1px solid #1E293B;background:#0F172A;color:#94A3B8;cursor:pointer;display:flex;align-items:center;justify-content:center;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>

              <!-- Fit -->
              <button onclick="window.fitCanvas()" title="Ajustar à tela" style="width:36px;height:36px;border-radius:8px;border:1px solid #1E293B;background:#0F172A;color:#94A3B8;cursor:pointer;display:flex;align-items:center;justify-content:center;margin-bottom:1rem;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
              </button>
            </div>

            <!-- Canvas Workspace -->
            <div id="canvas-workspace"
              style="position:relative;overflow:hidden;background:#0A1628;background-image:radial-gradient(#1E293B 1px,transparent 1px);background-size:32px 32px;cursor:${isSpaceDown ? 'grab' : 'default'};">
              <div id="canvas-scaler"
                style="display:flex;gap:${GAP}px;align-items:flex-start;transform-origin:0 0;position:absolute;top:0;left:0;">

                <!-- Story -->
                <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
                  <div style="display:flex;width:100%;justify-content:space-between;color:#334155;font-size:14px;font-weight:800;white-space:nowrap;">
                    <span>STORY (9:16)</span><span>1080 × 1920 px</span>
                  </div>
                  <div class="canvas-box" data-format="story"
                    style="width:${STORY_W}px;height:${STORY_H}px;background:#000 url('${isSegmentMode ? (configSegments[activeSegmentId]?.storyTemplate || '') : config.storyTemplate}') center/cover;position:relative;border:2px solid ${selectedFormat === 'story' && selectedSlotIds.size === 0 ? step.accent : '#1E293B'};cursor:${isCreating ? 'crosshair' : 'default'};box-shadow:0 40px 80px -20px rgba(0,0,0,0.9);">
                    <div id="slots-layer-story" style="position:absolute;inset:0;pointer-events:none;"></div>
                    <div id="draw-story" class="drawing-preview" style="position:absolute;border:3px dashed ${step.accent};background:${step.accent}20;display:none;pointer-events:none;border-radius:50%;box-sizing:border-box;"></div>
                    <div id="marquee-story" style="position:absolute;border:2px dashed #60A5FA;background:rgba(96,165,250,0.12);display:none;pointer-events:none;box-sizing:border-box;z-index:300;"></div>
                    ${storyFull ? `<div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#EF4444;color:white;padding:6px 16px;border-radius:2rem;font-size:11px;font-weight:800;pointer-events:none;">✕ LIMITE 20 SLOTS ATINGIDO</div>` : ''}
                  </div>
                </div>

                <!-- Feed -->
                <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
                  <div style="display:flex;width:100%;justify-content:space-between;color:#334155;font-size:14px;font-weight:800;white-space:nowrap;">
                    <span>FEED (4:5)</span><span>1080 × 1350 px</span>
                  </div>
                  <div class="canvas-box" data-format="feed"
                    style="width:${FEED_W}px;height:${FEED_H}px;background:#000 url('${isSegmentMode ? (configSegments[activeSegmentId]?.feedTemplate || '') : config.feedTemplate}') center/cover;position:relative;border:2px solid ${selectedFormat === 'feed' && selectedSlotIds.size === 0 ? step.accent : '#1E293B'};cursor:${isCreating ? 'crosshair' : 'default'};box-shadow:0 40px 80px -20px rgba(0,0,0,0.9);">
                    <div id="slots-layer-feed"  style="position:absolute;inset:0;pointer-events:none;"></div>
                    <div id="draw-feed"  class="drawing-preview" style="position:absolute;border:3px dashed ${step.accent};background:${step.accent}20;display:none;pointer-events:none;border-radius:50%;box-sizing:border-box;"></div>
                    <div id="marquee-feed" style="position:absolute;border:2px dashed #60A5FA;background:rgba(96,165,250,0.12);display:none;pointer-events:none;box-sizing:border-box;z-index:300;"></div>
                    ${feedFull ? `<div style="position:absolute;top:16px;left:50%;transform:translateX(-50%);background:#EF4444;color:white;padding:6px 16px;border-radius:2rem;font-size:11px;font-weight:800;pointer-events:none;">✕ LIMITE 20 SLOTS ATINGIDO</div>` : ''}
                  </div>
                </div>

              </div>

              <!-- Status Bar (inside canvas) -->
              <div style="position:absolute;bottom:1rem;left:50%;transform:translateX(-50%);background:#0F172A;border:1px solid #334155;padding:0.6rem 1.5rem;border-radius:3rem;color:#94A3B8;font-size:0.7rem;font-weight:800;display:flex;align-items:center;gap:10px;pointer-events:none;white-space:nowrap;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${step.accent}" stroke-width="3"><circle cx="12" cy="12" r="10"/></svg>
                ${isCreating
          ? 'MODO CRIAR: clique e arraste para criar círculo'
          : (selectedSlotIds.size > 0
            ? `${selectedSlotIds.size} selecionado${selectedSlotIds.size > 1 ? 's' : ''} — arraste para mover${selectedSlotIds.size > 1 ? ', Shift+click para toggle' : ''}`
            : (isSpaceDown ? 'PAN: arraste para mover' : 'SELECIONAR: clique ou arraste área, Shift=multi'))}
              </div>
            </div>

            <!-- Right Panel -->
            <div style="background:#0F172A;border-left:1px solid #1E293B;display:flex;flex-direction:column;overflow:hidden;">
              <div style="padding:1rem 1.5rem 0;font-size:0.65rem;font-weight:800;color:#475569;letter-spacing:0.12em;border-bottom:1px solid #1E293B;padding-bottom:1rem;">
                MAPEAMENTO DE ${step.desc}
              </div>
              <div style="flex:1;overflow-y:auto;">
                ${renderRightPanel()}
              </div>
            </div>

          </div>

          <!-- Footer -->
          <div style="background:#0F172A;border-top:1px solid #1E293B;height:72px;padding:0 2rem;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;z-index:10;">
            <button onclick="window.nav('create-campaign')" style="background:transparent;border:none;font-weight:800;color:#475569;font-size:0.8rem;display:flex;align-items:center;gap:8px;cursor:pointer;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m15 18-6-6 6-6"/></svg> VOLTAR
            </button>
            <div style="display:flex;align-items:center;gap:2rem;">
              ${currentStepIdx < activeSteps.length - 1 ? `
                <div style="text-align:right;">
                  <div style="font-size:0.6rem;color:#475569;font-weight:700;">PRÓXIMO PASSO</div>
                  <div style="font-size:0.75rem;color:#94A3B8;font-weight:800;">${activeSteps[currentStepIdx + 1]?.label}</div>
                </div>
                <button id="btn-next-step-builder" style="background:#10B981;color:white;padding:0.875rem 2.5rem;border-radius:0.875rem;font-weight:800;font-size:0.875rem;border:none;display:flex;align-items:center;gap:10px;cursor:pointer;box-shadow:0 4px 20px rgba(16,185,129,0.35);">
                  Próxima Etapa: ${activeSteps[currentStepIdx + 1]?.desc} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              ` : `
                <button id="btn-next-step-builder" style="background:#10B981;color:white;padding:0.875rem 2.5rem;border-radius:0.875rem;font-weight:800;font-size:0.875rem;border:none;display:flex;align-items:center;gap:10px;cursor:pointer;box-shadow:0 4px 20px rgba(16,185,129,0.35);">
                  FINALIZAR E GERAR CAMPANHA <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5L20 7"/></svg>
                </button>
              `}
            </div>
          </div>

        </div>
      `;

      attachEvents();
      updateLayers();
      // Compute auto-fit then apply
      requestAnimationFrame(() => {
        computeAutoFit();
        applyScale();
      });

    } catch (err) {
      console.error('[TemplateBuilder] crash:', err);
      container.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#020617;color:white;text-align:center;padding:2rem;">
          <h2 style="color:#EF4444;margin-bottom:1rem;">Erro ao carregar o editor</h2>
          <div style="background:#1E293B;color:#EF4444;padding:1rem;border-radius:0.75rem;margin-bottom:2rem;max-width:700px;width:100%;text-align:left;font-family:monospace;font-size:0.7rem;white-space:pre-wrap;border:1px solid #334155;">${err.message}\n\n${err.stack?.split('\n').slice(0, 4).join('\n')}</div>
          <div style="display:flex;gap:1rem;">
            <button onclick="window.nav('create-campaign')" style="padding:0.875rem 2rem;background:#1E293B;border:none;border-radius:0.75rem;color:white;font-weight:800;cursor:pointer;">VOLTAR</button>
            <button onclick="window.nav('dashboard')" style="padding:0.875rem 2rem;background:#3B82F6;border:none;border-radius:0.75rem;color:white;font-weight:800;cursor:pointer;">DASHBOARD</button>
          </div>
        </div>
      `;
    }
  };

  // ─── Events ───────────────────────────────────────────────────────────────
  const attachEvents = () => {
    window.nav = (p) => navigate(p);
    window.setStep = (i) => { currentStepIdx = i; update(); };
    window.setToolMode = (m) => { toolMode = m; selectedSlotIds.clear(); update(); };
    window.fitCanvas = () => { resetFit(); };
    window.zoomIn = () => { zoom = Math.min(3 / baseScale, zoom * 1.25); applyScale(); };
    window.zoomOut = () => { zoom = Math.max(0.1 / baseScale, zoom * 0.8); applyScale(); };
    window.switchSegmentTab = (segId) => { switchSegment(segId); };
    window.applyToAllSegs = () => {
      const step = activeSteps[currentStepIdx];
      const scope = step?.id === 'logos' ? 'logos' : step?.id === 'cityImage' ? 'image' : step?.id === 'cityText' ? 'text' : undefined;
      applyToAllSegments(scope);
      update();
    };
    window.setSyncMode = (mode) => {
      slots.syncMode = mode;
      if (mode === 'feed-to-story') syncSlots('feed', getSyncScope());
      if (mode === 'story-to-feed') syncSlots('story', getSyncScope());
      persistSlots();
      update();
    };
    window.clearSlots = (key) => { pushHistory(); slots[key] = []; selectedSlotIds.clear(); persistSlots(); update(); };
    window.clearActiveSlot = () => {
      const step = activeSteps[currentStepIdx];
      const fmtSuf = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
      pushHistory();
      if (step.id === 'cityImage') slots[`cityImage${fmtSuf}`] = null;
      if (step.id === 'cityText') slots[`cityText${fmtSuf}`] = null;
      selectedSlotIds.clear();
      persistSlots();
      update();
    };

    // ── Multi-select duplicate ──────────────────────────────────────────
    window.duplicateSlot = () => {
      if (selectedSlotIds.size === 0) return;
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      const selected = slots[fmtKey].filter(s => selectedSlotIds.has(s.id));
      if (!selected.length || slots[fmtKey].length + selected.length > 20) return;
      pushHistory();
      const newIds = new Set();
      selected.forEach(slot => {
        const ns = { ...slot, id: Date.now() + Math.random(), x: Math.min(0.95, slot.x + 0.03), y: Math.min(0.95, slot.y + 0.03) };
        slots[fmtKey].push(ns);
        newIds.add(ns.id);
      });
      selectedSlotIds = newIds;
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Multi-select delete ─────────────────────────────────────────────
    window.deleteSelectedSlot = () => {
      if (selectedSlotIds.size === 0) return;
      pushHistory();
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      // Also handle cityImage/cityText single-slot deletions
      for (const id of selectedSlotIds) {
        if (typeof id === 'string') { slots[id] = null; }
      }
      slots[fmtKey] = slots[fmtKey].filter(s => !selectedSlotIds.has(s.id));
      selectedSlotIds.clear();
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Copy / Paste ────────────────────────────────────────────────────
    window.copySlots = () => {
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      clipboard = slots[fmtKey].filter(s => selectedSlotIds.has(s.id)).map(s => ({ ...s }));
    };
    window.pasteSlots = () => {
      if (!clipboard.length) return;
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      if (slots[fmtKey].length + clipboard.length > 20) return;
      pushHistory();
      const OFF = 0.02;
      const newIds = new Set();
      clipboard.forEach(s => {
        const ns = { ...s, id: Date.now() + Math.random(), x: s.x + OFF, y: s.y + OFF };
        slots[fmtKey].push(ns);
        newIds.add(ns.id);
      });
      clipboard = clipboard.map(s => ({ ...s, x: s.x + OFF, y: s.y + OFF }));
      selectedSlotIds = newIds;
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Alignment (as block) ────────────────────────────────────────────
    window.alignSlots = (dir) => {
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      const sel = slots[fmtKey].filter(s => selectedSlotIds.has(s.id));
      if (!sel.length) return;
      pushHistory();
      const bb = getGroupBBox(sel);
      let dx = 0, dy = 0;
      if (dir === 'left') dx = -bb.x1;
      if (dir === 'right') dx = 1 - bb.x2;
      if (dir === 'top') dy = -bb.y1;
      if (dir === 'bottom') dy = 1 - bb.y2;
      if (dir === 'centerH') dx = 0.5 - (bb.x1 + bb.w / 2);
      if (dir === 'centerV') dy = 0.5 - (bb.y1 + bb.h / 2);
      sel.forEach(s => { s.x += dx; s.y += dy; });
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Align within selection (between objects) ─────────────────────────
    window.alignLocal = (dir) => {
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      const sel = slots[fmtKey].filter(s => selectedSlotIds.has(s.id));
      if (sel.length < 2) return;
      pushHistory();
      const bb = getGroupBBox(sel);
      if (dir === 'left') sel.forEach(s => { s.x = bb.x1; });
      if (dir === 'right') sel.forEach(s => { s.x = bb.x2 - s.w; });
      if (dir === 'top') sel.forEach(s => { s.y = bb.y1; });
      if (dir === 'bottom') sel.forEach(s => { s.y = bb.y2 - s.h; });
      if (dir === 'centerH') { const cx = bb.x1 + bb.w / 2; sel.forEach(s => { s.x = cx - s.w / 2; }); }
      if (dir === 'centerV') { const cy = bb.y1 + bb.h / 2; sel.forEach(s => { s.y = cy - s.h / 2; }); }
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Align single slot (cityText / cityImage) to canvas ──────────────
    window.alignTextSlot = (dir) => {
      const step = activeSteps[currentStepIdx];
      const fmtSuf = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
      const key = step.id === 'cityText' ? `cityText${fmtSuf}` : `cityImage${fmtSuf}`;
      const slot = slots[key];
      if (!slot) return;
      pushHistory();
      if (dir === 'left') slot.x = 0;
      if (dir === 'right') slot.x = 1 - slot.w;
      if (dir === 'top') slot.y = 0;
      if (dir === 'bottom') slot.y = 1 - slot.h;
      if (dir === 'centerH') slot.x = (1 - slot.w) / 2;
      if (dir === 'centerV') slot.y = (1 - slot.h) / 2;
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Distribution ────────────────────────────────────────────────────
    window.distributeSlots = (dir) => {
      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      const sel = slots[fmtKey].filter(s => selectedSlotIds.has(s.id));
      if (sel.length < 3) return;
      pushHistory();
      if (dir === 'horizontal') {
        sel.sort((a, b) => a.x - b.x);
        const first = sel[0].x, last = sel[sel.length - 1].x;
        const step = (last - first) / (sel.length - 1);
        sel.forEach((s, i) => { s.x = first + step * i; });
      } else {
        sel.sort((a, b) => a.y - b.y);
        const first = sel[0].y, last = sel[sel.length - 1].y;
        const step = (last - first) / (sel.length - 1);
        sel.forEach((s, i) => { s.y = first + step * i; });
      }
      syncSlots(selectedFormat, getSyncScope());
      persistSlots();
      update();
    };

    // ── Undo / Redo ─────────────────────────────────────────────────────
    window.undoAction = () => {
      if (historyIdx > 0) {
        historyIdx--;
        restoreSnapshot(JSON.parse(JSON.stringify(history[historyIdx])));
        update();
      }
    };
    window.redoAction = () => {
      if (historyIdx < history.length - 1) {
        historyIdx++;
        restoreSnapshot(JSON.parse(JSON.stringify(history[historyIdx])));
        update();
      }
    };

    // ── Keyboard ────────────────────────────────────────────────────────
    window.onkeydown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        isSpaceDown = true;
        const ws = container.querySelector('#canvas-workspace');
        if (ws) ws.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') { selectedSlotIds.clear(); update(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSlotIds.size > 0) {
        e.preventDefault(); window.deleteSelectedSlot(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); window.copySlots(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); window.pasteSlots(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); window.duplicateSlot(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); window.undoAction(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); window.redoAction(); return; }
    };
    window.onkeyup = (e) => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        const ws = container.querySelector('#canvas-workspace');
        if (ws) ws.style.cursor = 'default';
      }
    };
    window.onresize = () => { computeAutoFit(); applyScale(); };

    // Next / Finish button
    const nextBtn = container.querySelector('#btn-next-step-builder');
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (currentStepIdx < activeSteps.length - 1) {
          currentStepIdx++;
          update();
        } else {
          // Save current segment before serializing
          if (isSegmentMode) {
            allSegmentSlots[activeSegmentId] = JSON.parse(JSON.stringify(slots));
          }

          if (isSegmentMode) {
            // Per-segment serialization
            const segData = {};
            activeSegments.forEach(seg => {
              const s = allSegmentSlots[seg.id] || makeDefaultSlots();
              segData[seg.id] = {
                feed: { logos: s.logosFeed || [], cityText: s.cityTextFeed || null, cityImage: s.cityImageFeed || null },
                story: { logos: s.logosStory || [], cityText: s.cityTextStory || null, cityImage: s.cityImageStory || null }
              };
            });
            state.finalBuilderSlots = {
              type: 'segment',
              segments: segData
            };
          } else {
            state.finalBuilderSlots = {
              type: 'single',
              logoSource: slots.logoSource || 'top20',
              syncMode: slots.syncMode || 'off',
              feed: { logos: slots.logosFeed || [], cityText: slots.cityTextFeed || null, cityImage: slots.cityImageFeed || null },
              story: { logos: slots.logosStory || [], cityText: slots.cityTextStory || null, cityImage: slots.cityImageStory || null }
            };
          }
          navigate('global-preview');
        }
      };
    }

    // Text panel: font and color handlers
    window.updateTextFont = (fontValue) => {
      const fmtSuf = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
      const key = `cityText${fmtSuf}`;
      if (slots[key]) {
        slots[key] = { ...slots[key], font: fontValue };
        syncSlots(selectedFormat, getSyncScope());
        persistSlots();
        update();
      }
    };
    window.handleColorChange = (colorValue) => {
      let val = colorValue.trim();
      if (!val.startsWith('#') && val.length > 0) val = '#' + val;
      // Optional uppercase normalization
      val = val.toUpperCase();
      // Basic fallback if invalid
      if (!/^#[0-9A-F]{3,8}$/i.test(val)) {
        if (val.length > 1) return; // Wait typing
        val = '#FFFFFF';
      }

      const fmtSuf = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
      const key = `cityText${fmtSuf}`;
      if (slots[key]) {
        slots[key] = { ...slots[key], color: val };
        syncSlots(selectedFormat, getSyncScope());
        persistSlots();
        update();
      }
    };

    // Workspace wheel
    const workspace = container.querySelector('#canvas-workspace');
    workspace.onwheel = (e) => {
      e.preventDefault();
      if (toolMode === 'create' && !isSpaceDown) return;
      const s0 = baseScale * zoom;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(0.1 / baseScale, zoom * factor), 3 / baseScale);
      const s1 = baseScale * newZoom;
      const rect = workspace.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const scaledW0 = GROUP_W * s0, scaledH0 = GROUP_H * s0;
      const contentX0 = (rect.width - scaledW0) / 2 + panX;
      const contentY0 = (rect.height - scaledH0) / 2 + panY;
      panX = curX - (curX - contentX0) * (s1 / s0) - (rect.width - GROUP_W * s1) / 2;
      panY = curY - (curY - contentY0) * (s1 / s0) - (rect.height - GROUP_H * s1) / 2;
      zoom = newZoom;
      applyScale();
    };

    // Pan on workspace (space + drag)
    let panStartX, panStartY;
    workspace.onmousedown = (e) => {
      if (isSpaceDown) {
        dragMode = 'pan'; panStartX = e.clientX; panStartY = e.clientY;
        workspace.style.cursor = 'grabbing'; isDrawing = true; e.preventDefault();
      }
    };

    // ── Canvas box events (per format) ──────────────────────────────────
    container.querySelectorAll('.canvas-box').forEach(box => {
      const fmt = box.dataset.format;
      const draw = box.querySelector('.drawing-preview');
      const marqueeDiv = box.querySelector(`#marquee-${fmt}`);

      box.onmousedown = (e) => {
        if (isSpaceDown) return;
        const rect = box.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width;
        const my = (e.clientY - rect.top) / rect.height;

        const handle = e.target.closest('.resize-handle');
        const slotEl = e.target.closest('.slot-logo');

        // ── Resize handle ─────────────────────────────────────────────
        if (handle) {
          dragMode = 'resize';
          dragHandle = handle.dataset.type;
          const rawId = handle.dataset.id;
          const slottype = handle.dataset.slottype || 'logo';
          dragTargetId = slottype === 'logo' ? Number(rawId) : rawId;
          selectedFormat = fmt;
          // Ensure it's in selectedSlotIds
          if (!selectedSlotIds.has(dragTargetId)) { selectedSlotIds.clear(); selectedSlotIds.add(dragTargetId); }
          let slot;
          if (slottype === 'logo') {
            const fmtKey = fmt === 'story' ? 'logosStory' : 'logosFeed';
            slot = slots[fmtKey].find(s => s.id === dragTargetId);
          } else {
            slot = slots[rawId];
          }
          if (!slot) { e.stopPropagation(); return; }
          pushHistory();
          startX = mx; startY = my; startW = slot.w; startH = slot.h;
          e.stopPropagation();

          // ── Click on a slot element ───────────────────────────────────
        } else if (slotEl && (toolMode === 'select' || selectedSlotIds.size > 0)) {
          const fmtKey = fmt === 'story' ? 'logosStory' : 'logosFeed';
          const slottype = slotEl.dataset.slottype || 'logo';
          let slot, slotId;
          if (slottype === 'logo') {
            slot = slots[fmtKey].find(s => mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h);
            slotId = slot?.id;
          } else {
            const key = slotEl.dataset.id;
            slot = slots[key]; slotId = key;
          }
          if (!slot) { e.stopPropagation(); return; }

          selectedFormat = fmt;
          if (e.shiftKey && typeof slotId === 'number') {
            // Shift+click: toggle in multi-selection
            if (selectedSlotIds.has(slotId)) selectedSlotIds.delete(slotId);
            else selectedSlotIds.add(slotId);
            updateLayers();
            e.stopPropagation();
            isDrawing = false;
            update();
            return;
          }

          // Normal click or click on non-logo
          if (typeof slotId !== 'number') {
            // cityImage/cityText: single-select behavior
            selectedSlotIds.clear();
            selectedSlotIds.add(slotId);
          } else if (!selectedSlotIds.has(slotId)) {
            selectedSlotIds.clear();
            selectedSlotIds.add(slotId);
          }
          // Start move (group if multi-selected)
          pushHistory();
          dragMode = 'move';
          dragTargetId = slotId;
          dragOffset.x = mx - slot.x;
          dragOffset.y = my - slot.y;
          e.stopPropagation();

          // ── Create mode ───────────────────────────────────────────────
        } else if (toolMode === 'create') {
          const step = activeSteps[currentStepIdx];
          if (step.id === 'logos') {
            const fmtKey = fmt === 'story' ? 'logosStory' : 'logosFeed';
            if (slots[fmtKey].length >= 20) return;
          }
          dragMode = 'create';
          selectedFormat = fmt;
          selectedSlotIds.clear();
          startX = mx; startY = my;
          if (draw) draw.style.display = 'block';
          e.stopPropagation();

          // ── Select mode: empty area → marquee ─────────────────────────
        } else if (toolMode === 'select') {
          dragMode = 'marquee';
          selectedFormat = fmt;
          if (!e.shiftKey) selectedSlotIds.clear();
          marqueeStart = { x: mx, y: my };
          if (marqueeDiv) { marqueeDiv.style.display = 'block'; marqueeDiv.style.width = '0'; marqueeDiv.style.height = '0'; }
          e.stopPropagation();
        } else {
          selectedSlotIds.clear();
          update();
          return;
        }

        isDrawing = true;
        update();
      };
    });

    // ── Mouse Move ──────────────────────────────────────────────────────
    window.onmousemove = (e) => {
      if (!isDrawing) return;

      if (dragMode === 'pan') {
        panX += e.clientX - panStartX; panY += e.clientY - panStartY;
        panStartX = e.clientX; panStartY = e.clientY;
        applyScale(); return;
      }

      const box = container.querySelector(`.canvas-box[data-format="${selectedFormat}"]`);
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      // ── Marquee ─────────────────────────────────────────────────────
      if (dragMode === 'marquee') {
        const mDiv = box.querySelector(`#marquee-${selectedFormat}`);
        const left = Math.min(marqueeStart.x, mx), top = Math.min(marqueeStart.y, my);
        const w = Math.abs(mx - marqueeStart.x), h = Math.abs(my - marqueeStart.y);
        if (mDiv) Object.assign(mDiv.style, { display: 'block', left: `${left * 100}%`, top: `${top * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
        // Live select circles overlapping marquee
        const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
        const right = Math.max(marqueeStart.x, mx), bottom = Math.max(marqueeStart.y, my);
        selectedSlotIds.clear();
        slots[fmtKey].forEach(s => {
          if (s.x + s.w > left && s.x < right && s.y + s.h > top && s.y < bottom) selectedSlotIds.add(s.id);
        });
        updateLayers();
        return;
      }

      const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
      const draw = box.querySelector('.drawing-preview');

      // ── Create ──────────────────────────────────────────────────────
      if (dragMode === 'create' && draw) {
        const step = activeSteps[currentStepIdx];
        const dX = mx - startX, dY = my - startY, w = Math.abs(dX);
        if (step.id === 'logos') {
          const h = w * rect.width / rect.height;
          const x = dX >= 0 ? startX : startX - w;
          const y = my >= startY ? startY : startY - h;
          Object.assign(draw.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, borderRadius: '50%' });
        } else {
          const h = Math.abs(dY), x = dX >= 0 ? startX : startX - w, y = dY >= 0 ? startY : startY - h;
          Object.assign(draw.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, borderRadius: '0' });
        }

        // ── Move (group-aware) ──────────────────────────────────────────
      } else if (dragMode === 'move') {
        if (typeof dragTargetId === 'string') {
          // cityImage/cityText single move
          const slot = slots[dragTargetId];
          if (slot) { slot.x = Math.max(0, Math.min(1 - slot.w, mx - dragOffset.x)); slot.y = Math.max(0, Math.min(1 - slot.h, my - dragOffset.y)); }
        } else if (selectedSlotIds.size > 1 && selectedSlotIds.has(dragTargetId)) {
          // Group move — maintain relative positions
          const baseSlot = slots[fmtKey].find(s => s.id === dragTargetId);
          if (baseSlot) {
            const newX = mx - dragOffset.x, newY = my - dragOffset.y;
            const dx = newX - baseSlot.x, dy = newY - baseSlot.y;
            slots[fmtKey].filter(s => selectedSlotIds.has(s.id)).forEach(s => { s.x += dx; s.y += dy; });
          }
          syncSlots(selectedFormat, getSyncScope());
        } else {
          // Single move
          const slot = slots[fmtKey].find(s => s.id === dragTargetId);
          if (slot) { slot.x = Math.max(0, Math.min(1 - slot.w, mx - dragOffset.x)); slot.y = Math.max(0, Math.min(1 - slot.h, my - dragOffset.y)); syncSlots(selectedFormat, getSyncScope()); }
        }
        updateLayers();

        // ── Resize ──────────────────────────────────────────────────────
      } else if (dragMode === 'resize') {
        let slot;
        const isStringId = typeof dragTargetId === 'string';
        if (isStringId) slot = slots[dragTargetId];
        else slot = slots[fmtKey]?.find(s => s.id === dragTargetId);
        if (!slot) { updateLayers(); return; }
        const deltaX = mx - startX, deltaY = my - startY;
        if (isStringId) {
          if (dragHandle === 'br') { slot.w = Math.max(0.02, startW + deltaX); slot.h = Math.max(0.02, startH + deltaY); }
          else if (dragHandle === 'tr') { slot.w = Math.max(0.02, startW + deltaX); slot.y = startY + deltaY; slot.h = Math.max(0.02, startH - deltaY); }
          else if (dragHandle === 'bl') { slot.x = startX + deltaX; slot.w = Math.max(0.02, startW - deltaX); slot.h = Math.max(0.02, startH + deltaY); }
          else if (dragHandle === 'tl') { slot.x = startX + deltaX; slot.w = Math.max(0.02, startW - deltaX); slot.y = startY + deltaY; slot.h = Math.max(0.02, startH - deltaY); }
        } else {
          const canvasRatio = rect.height / rect.width;
          const applySizeFromW = (nw) => { slot.w = Math.max(0.02, nw); slot.h = slot.w * rect.width / rect.height; };
          if (dragHandle === 'br') { applySizeFromW(startW + deltaX); }
          else if (dragHandle === 'tr') { const ow = slot.w; applySizeFromW(startW + deltaX); slot.y -= (slot.w - ow) * canvasRatio; }
          else if (dragHandle === 'bl') { const dx2 = startX - mx; applySizeFromW(startW + dx2); slot.x = startX - dx2 - (startW + dx2) + (startW - slot.w); }
          else if (dragHandle === 'tl') { const dx2 = startX - mx, ow = slot.w; applySizeFromW(startW + dx2); slot.x += (ow - slot.w); slot.y += (ow - slot.w) * canvasRatio; }
        }
        syncSlots(selectedFormat, getSyncScope());
        updateLayers();
      }
    };

    // ── Mouse Up ────────────────────────────────────────────────────────
    window.onmouseup = (e) => {
      if (!isDrawing) return;

      if (dragMode === 'marquee') {
        const box = container.querySelector(`.canvas-box[data-format="${selectedFormat}"]`);
        const mDiv = box?.querySelector(`#marquee-${selectedFormat}`);
        if (mDiv) mDiv.style.display = 'none';
      }

      if (dragMode === 'create') {
        const box = container.querySelector(`.canvas-box[data-format="${selectedFormat}"]`);
        const draw = box?.querySelector('.drawing-preview');
        if (draw) draw.style.display = 'none';
        if (box) {
          const rect = box.getBoundingClientRect();
          const ex = (e.clientX - rect.left) / rect.width, ey = (e.clientY - rect.top) / rect.height;
          const dX = ex - startX, dY = ey - startY;
          const step = activeSteps[currentStepIdx];
          const fmtSuf = selectedFormat.charAt(0).toUpperCase() + selectedFormat.slice(1);
          if (step.id === 'logos') {
            const w = Math.abs(dX), h = w * rect.width / rect.height;
            if (w > 0.01) {
              const x = dX >= 0 ? startX : startX - w, y = ey >= startY ? startY : startY - h;
              const fmtKey = selectedFormat === 'story' ? 'logosStory' : 'logosFeed';
              if (slots[fmtKey].length < 20) {
                pushHistory();
                const ns = { id: Date.now(), x, y, w, h };
                slots[fmtKey].push(ns);
                selectedSlotIds.clear(); selectedSlotIds.add(ns.id);
                syncSlots(selectedFormat, getSyncScope());
              }
            }
          } else if (step.id === 'cityImage' || step.id === 'cityText') {
            const w = Math.abs(dX), h = Math.abs(dY);
            if (w > 0.01 && h > 0.005) {
              pushHistory();
              const x = dX >= 0 ? startX : startX - w, y = dY >= 0 ? startY : startY - h;
              const key = step.id === 'cityImage' ? `cityImage${fmtSuf}` : `cityText${fmtSuf}`;
              const prevFont = slots[key]?.font || 'Manrope';
              const prevColor = slots[key]?.color || '#FFFFFF';
              const prevMode = slots[key]?.mode || 'cover';
              slots[key] = step.id === 'cityText' ? { x, y, w, h, font: prevFont, color: prevColor } : { x, y, w, h, mode: prevMode };
              selectedSlotIds.clear(); selectedSlotIds.add(key);
            }
          }
        }
      }

      if (dragMode === 'pan') { workspace.style.cursor = isSpaceDown ? 'grab' : 'default'; }

      persistSlots();
      isDrawing = false;
      dragMode = null;
      dragTargetId = null;
      update();
    };
  };

  update();
};
