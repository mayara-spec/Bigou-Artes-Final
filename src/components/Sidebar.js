import { navigate, subscribe, state } from '../services/state.js';

export const renderSidebar = (container) => {
  const update = (state) => {
    const pages = [
      { id: 'dashboard', label: 'Início', icon: 'grid' },
      { id: 'assets', label: 'Pastas', icon: 'folder' },
    ];

    container.innerHTML = `
      <div class="sidebar-brand" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; padding: 0.5rem;">
        <div style="width: 40px; height: 40px; background: #32ba72; border-radius: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); overflow: hidden;">
          <img src="/logo.png" style="width: 100%; height: 100%; object-fit: contain;">
        </div>
        <div>
           <div style="font-family: 'Outfit'; font-weight: 700; font-size: 1.125rem; color: #0F172A; line-height: 1.1;">Bigou Artes</div>
           <div style="font-size: 0.75rem; color: var(--accent); font-weight: 700; letter-spacing: 0.05em; margin-top: 2px;">MARKETING</div>
        </div>
      </div>
      
      <nav style="display: flex; flex-direction: column; gap: 0.5rem;">
        ${pages.map(page => `
          <button class="nav-item ${state.currentPage === page.id ? 'active' : ''}" data-page="${page.id}" style="
            display: flex; 
            align-items: center; 
            gap: 0.875rem; 
            padding: 0.75rem 1rem; 
            border-radius: 0.5rem; 
            width: 100%;
            color: ${state.currentPage === page.id ? '#166534' : '#64748B'};
            background: ${state.currentPage === page.id ? '#EBFDF5' : 'transparent'};
            border: none;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.875rem;
            transition: all 0.2s;
          ">
            ${page.icon === 'grid' ? `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
            ` : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            `}
            <span>${page.label}</span>
          </button>
        `).join('')}
      </nav>
      
      <div style="flex: 1;"></div>
    `;

    container.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        navigate(btn.dataset.page);
      });
    });
  };

  subscribe(update);
  update({ currentPage: state.currentPage });
};
