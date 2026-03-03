import { getCityPhoto, getTop20LogoBlob, getSegmentLogoBlob, getFontBlob } from '../services/db.js';

// Basic reactive state management

// ─── IndexedDB Setup ─────────────────────────────────────────────────────────
const DB_NAME = 'BigouArtesDB';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';

let dbInstance = null;

const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('[State] IndexedDB error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

const readPersistedDB = async (key, defaultVal) => {
  if (!dbInstance) await initDB();
  return new Promise((resolve) => {
    const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      resolve(request.result !== undefined ? request.result : defaultVal);
    };

    request.onerror = () => {
      resolve(defaultVal);
    };
  });
};

const persistDB = async (key, value) => {
  if (!dbInstance) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

// ─── Initial State ─────────────────────────────────────────────────────────
const defaultAM = {
  activeTab: 'cities',
  selectedFolderCityId: null,
  folderViewType: 'photos',
  showCityModal: false,
  modalType: 'cities',
  showDeleteConfirm: false,
  deleteId: null,
  deleteType: null,
  selectedSegmentId: null,
  createCampaign: {
    step: 1,
    type: 'single',
    name: '',
    feedTemplate: null,
    storyTemplate: null,
    segments: {},
    dynamicOptions: {
      cityImage: true,
      useTop20: true,
      useCityText: true
    }
  },
  builderSlots: {
    logoSource: 'top20',
    syncMode: 'off',
    logosFeed: [],
    logosStory: [],
    cityImageFeed: null,
    cityImageStory: null,
    cityTextFeed: null,
    cityTextStory: null
  }
};

// ─── Async Initialization ────────────────────────────────────────────────────
// We need to export a way to initialize the state asynchronously before the app runs
export let state = null;
const listeners = new Set();

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const navigate = (page) => {
  if (state) state.currentPage = page;
};

export const loadState = async () => {
  await initDB();

  const hasAnyData = await readPersistedDB('bigou_cities', null);

  // se o IDB está limpo, recuperamos as últimas imagens gigantes do localStorage salvando-as de volta (somente rodado na 1ª vez da migração DB)
  let savedAM = await readPersistedDB('bigou_assetManager', null);
  let cities = await readPersistedDB('bigou_cities', null);
  let top20Folders = await readPersistedDB('bigou_top20Folders', null);
  let logos = await readPersistedDB('bigou_logos', null);
  let cityPhotos = await readPersistedDB('bigou_cityPhotos', null);
  let typographies = await readPersistedDB('bigou_typographies', null);
  let campaigns = await readPersistedDB('bigou_campaigns', null);
  let segments = await readPersistedDB('bigou_segments', null);
  let segmentCities = await readPersistedDB('bigou_segmentCities', null);
  let segmentLogos = await readPersistedDB('bigou_segmentLogos', null);

  // Fallback para LS se IDB estiver limpo
  if (hasAnyData === null) {
    console.log("[State] IndexedDB vazio. Tentando migrar dados do localStorage...");
    const readLS = (key, defaultVal) => {
      try {
        const ls = localStorage.getItem(key);
        if (ls !== null) return JSON.parse(ls);
        const ss = sessionStorage.getItem(key);
        if (ss !== null) return JSON.parse(ss);
      } catch (_) { }
      return defaultVal;
    };

    savedAM = readLS('bigou_assetManager', {});
    cities = readLS('bigou_cities', []);
    top20Folders = readLS('bigou_top20Folders', []);
    logos = readLS('bigou_logos', []);
    cityPhotos = readLS('bigou_cityPhotos', []);
    typographies = readLS('bigou_typographies', []);
    campaigns = readLS('bigou_campaigns', []);
    segments = readLS('bigou_segments', [
      { id: 'hamburguer', name: 'Hambúrguer', logos: [] },
      { id: 'pizza', name: 'Pizza', logos: [] },
      { id: 'acai', name: 'Açaí', logos: [] },
      { id: 'sobremesa', name: 'Sobremesa', logos: [] },
      { id: 'almoco', name: 'Almoço', logos: [] },
      { id: 'porcao', name: 'Porção', logos: [] },
      { id: 'cachorro_quente', name: 'Cachorro Quente', logos: [] },
      { id: 'salgado', name: 'Salgado', logos: [] },
    ]);
    segmentCities = readLS('bigou_segmentCities', []);
    segmentLogos = readLS('bigou_segmentLogos', []);

    // Migrar para o IDB
    await persistDB('bigou_assetManager', savedAM);
    await persistDB('bigou_cities', cities);
    await persistDB('bigou_top20Folders', top20Folders);
    await persistDB('bigou_logos', logos);
    await persistDB('bigou_cityPhotos', cityPhotos);
    await persistDB('bigou_typographies', typographies);
    await persistDB('bigou_campaigns', campaigns);
    await persistDB('bigou_segments', segments);
    await persistDB('bigou_segmentCities', segmentCities);
    await persistDB('bigou_segmentLogos', segmentLogos);
    console.log("[State] Migração LS -> IDB concluída.");
  } else {
    // defaults fallback if reading null from existing IDB
    savedAM = savedAM || {};
    cities = cities || [];
    top20Folders = top20Folders || [];
    logos = logos || [];
    cityPhotos = cityPhotos || [];
    typographies = typographies || [];
    campaigns = campaigns || [];
    segments = segments || [
      { id: 'hamburguer', name: 'Hambúrguer', logos: [] },
      { id: 'pizza', name: 'Pizza', logos: [] },
      { id: 'acai', name: 'Açaí', logos: [] },
      { id: 'sobremesa', name: 'Sobremesa', logos: [] },
      { id: 'almoco', name: 'Almoço', logos: [] },
      { id: 'porcao', name: 'Porção', logos: [] },
      { id: 'cachorro_quente', name: 'Cachorro Quente', logos: [] },
      { id: 'salgado', name: 'Salgado', logos: [] },
    ];
    segmentCities = segmentCities || [];
    segmentLogos = segmentLogos || [];
  }

  const initialState = {
    cities,
    top20Folders,
    logos,
    cityPhotos,
    typographies,
    campaigns,
    assetManager: { ...defaultAM, ...savedAM, createCampaign: { ...defaultAM.createCampaign, ...(savedAM.createCampaign || {}) } },
    segments,
    segmentCities,
    segmentLogos,
    activeSegmentId: await readPersistedDB('bigou_activeSegmentId', null),
    currentPage: await readPersistedDB('bigou_currentPage', 'dashboard'),
    currentCampaignConfig: await readPersistedDB('bigou_currentCampaignConfig', null),
    builderSlots: await readPersistedDB('bigou_builderSlots', null),
    finalBuilderSlots: await readPersistedDB('bigou_finalBuilderSlots', null),
  };

  // ─── Migration Logic for Segments ──────────────────────────────────────────
  const GENERAL_CITY_ID = 'geral';
  let stateChanged = false;

  const existingGeral = initialState.segmentCities.find(c => c.name.toLowerCase() === 'geral' && c.id !== GENERAL_CITY_ID);
  if (existingGeral) {
    initialState.segmentLogos.forEach(l => {
      if (String(l.cityId) === String(existingGeral.id)) l.cityId = GENERAL_CITY_ID;
    });
    initialState.segmentCities = initialState.segmentCities.filter(c => c.id !== existingGeral.id);
    stateChanged = true;
  }

  if (!initialState.segmentCities.some(c => c.id === GENERAL_CITY_ID)) {
    initialState.segmentCities = [{ id: GENERAL_CITY_ID, name: 'Geral' }, ...initialState.segmentCities];
    stateChanged = true;
  }

  const oldSegments = initialState.segments || [];
  const migLogos = [];
  oldSegments.forEach(seg => {
    if (seg.logos && seg.logos.length > 0) {
      seg.logos.forEach((logoData, index) => {
        const exists = initialState.segmentLogos.some(l => l.data === logoData);
        if (!exists) {
          migLogos.push({
            id: `mig_${seg.id}_${index}_${Date.now()}`,
            cityId: GENERAL_CITY_ID,
            segmentId: seg.id,
            data: logoData,
            name: `Migrado ${seg.name} ${index + 1}`
          });
        }
      });
      seg.logos = [];
      stateChanged = true;
    }
  });

  if (migLogos.length > 0) initialState.segmentLogos = [...initialState.segmentLogos, ...migLogos];

  if (stateChanged || migLogos.length > 0) {
    persistDB('bigou_segments', initialState.segments);
    persistDB('bigou_segmentLogos', initialState.segmentLogos);
    persistDB('bigou_segmentCities', initialState.segmentCities);
  }

  // ─── Hydrate Object URLs for Session (Lazy load memory reference) ───────

  if (initialState.cities) {
    for (let i = 0; i < initialState.cities.length; i++) {
      const city = initialState.cities[i];
      if (typeof city.image === 'string' && city.image.startsWith('blob:')) city.image = null;

      if (city.hasPhoto || city.image) {
        try {
          const blob = await getCityPhoto(city.id);
          if (blob) {
            city.image = URL.createObjectURL(blob);
            city.memoryUrl = true;
            city.hasPhoto = true;
          } else {
            city.image = null;
            city.memoryUrl = false;
            city.hasPhoto = false;
          }
        } catch (err) {
          console.error("Failed to load city image blob for", city.name);
          city.image = null;
        }
      }
    }
  }

  if (initialState.cityPhotos) {
    for (let i = 0; i < initialState.cityPhotos.length; i++) {
      const photo = initialState.cityPhotos[i];
      if (typeof photo.data === 'string' && photo.data.startsWith('blob:')) photo.data = null;
      try {
        const blob = await getCityPhoto(photo.cityId);
        if (blob) {
          photo.data = URL.createObjectURL(blob);
          photo.memoryUrl = true;
        } else {
          photo.data = null;
          photo.memoryUrl = false;
        }
      } catch (err) { }
    }
  }

  if (initialState.logos) {
    for (let i = 0; i < initialState.logos.length; i++) {
      const logo = initialState.logos[i];
      try {
        const blob = await getTop20LogoBlob(logo.id);
        if (blob) {
          logo.data = URL.createObjectURL(blob);
          logo.memoryUrl = true;
        }
      } catch (err) { }
    }
  }

  if (initialState.segmentLogos) {
    for (let i = 0; i < initialState.segmentLogos.length; i++) {
      const logo = initialState.segmentLogos[i];
      try {
        // In migration, "data" could theoretically be a base64 string, but id should exist.
        const blob = await getSegmentLogoBlob(logo.id);
        if (blob) {
          logo.data = URL.createObjectURL(blob);
          logo.memoryUrl = true;
        }
      } catch (err) { }
    }
  }

  if (initialState.typographies) {
    for (let i = 0; i < initialState.typographies.length; i++) {
      const font = initialState.typographies[i];
      try {
        const blob = await getFontBlob(font.id);
        if (blob) {
          font.data = URL.createObjectURL(blob);
          font.memoryUrl = true;
        }
      } catch (err) { }
    }
  }

  // ─── Reset full-screen pages on app start ──────────────────────────────────
  const FULL_SCREEN_PAGES = ['template-builder', 'generation', 'global-preview'];
  if (FULL_SCREEN_PAGES.includes(initialState.currentPage)) {
    initialState.currentPage = 'dashboard';
    persistDB('bigou_currentPage', 'dashboard');
  }

  // ─── Keys to auto-persist ──────────────────────────────────────────────────
  const PERSIST_KEYS = [
    'cities', 'top20Folders', 'logos', 'cityPhotos', 'typographies',
    'campaigns', 'assetManager', 'segments', 'activeSegmentId',
    'currentPage', 'segmentCities', 'segmentLogos', 'builderSlots',
    'currentCampaignConfig', 'finalBuilderSlots'
  ];

  // ─── Reactive Proxy ─────────────────────────────────────────────────────────
  state = new Proxy(initialState, {
    set(target, property, value) {
      target[property] = value;
      if (PERSIST_KEYS.includes(property)) {
        // Strip large binary data from config to optimize
        if (property === 'currentCampaignConfig' && value) {
          const { feedTemplate, storyTemplate, ...rest } = value;
          persistDB(`bigou_${property}`, rest).catch(console.error);
        } else {
          persistDB(`bigou_${property}`, value).catch(console.error);
        }
      }
      listeners.forEach(listener => listener(target));
      return true;
    }
  });

  return state;
};
