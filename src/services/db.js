/**
 * Database Layer for Heavy Assets (Blobs)
 * Handles storage of City Photos, Logos, Fonts, and Templates in IndexedDB.
 */

const DB_NAME = 'bigou-assets-db';
const DB_VERSION = 2; // Upgraded for establishments

let dbInstance = null;

export const initDB = () => {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('[DB] IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('cities')) {
                db.createObjectStore('cities', { keyPath: 'cityName' });
            }
            if (!db.objectStoreNames.contains('top20Logos')) {
                db.createObjectStore('top20Logos', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('segmentLogos')) {
                db.createObjectStore('segmentLogos', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('fonts')) {
                db.createObjectStore('fonts', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('templates')) {
                db.createObjectStore('templates', { keyPath: 'id' });
            }

            // Phase 2: Establishments Store
            if (!db.objectStoreNames.contains('establishments')) {
                const store = db.createObjectStore('establishments', { keyPath: 'estabelecimento_id' });
                // Index for easy querying by city during curation
                store.createIndex('cidade', 'cidade', { unique: false });
            }
        };
    });
};

const _runTransaction = async (storeName, mode, callback) => {
    if (!dbInstance) await initDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction([storeName], mode);
        const store = tx.objectStore(storeName);

        // Catch quota errors gracefully
        tx.onabort = (event) => {
            if (tx.error && tx.error.name === 'QuotaExceededError') {
                console.error('[DB] Local storage quota limit reached.');
                document.dispatchEvent(new CustomEvent('db-quota-exceeded'));
            }
            reject(tx.error);
        };
        tx.onerror = (event) => reject(tx.error);
        tx.oncomplete = () => { /* wait for callback to resolve manually if needed, or just let transaction succeed */ };

        callback(store, resolve, reject);
    });
};

// --- Cities ---
export const saveCityPhoto = async (cityName, photoBlob) => {
    return _runTransaction('cities', 'readwrite', (store, resolve, reject) => {
        const data = {
            cityName,
            photoBlob,
            updatedAt: Date.now()
        };
        const req = store.put(data);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const getCityPhoto = async (cityName) => {
    return _runTransaction('cities', 'readonly', (store, resolve, reject) => {
        const req = store.get(cityName);
        req.onsuccess = () => resolve(req.result ? req.result.photoBlob : null);
        req.onerror = () => reject(req.error);
    });
};

export const deleteCityPhoto = async (cityName) => {
    return _runTransaction('cities', 'readwrite', (store, resolve, reject) => {
        const req = store.delete(cityName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- Top 20 Logos ---
export const saveTop20Logo = async (cityName, fileName, logoBlob, eTag = null, lastModified = null, customId = null) => {
    return _runTransaction('top20Logos', 'readwrite', (store, resolve, reject) => {
        const id = customId || `${cityName}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const data = {
            id,
            cityName,
            fileName,
            logoBlob,
            eTag,
            lastModified,
            updatedAt: Date.now()
        };
        const req = store.put(data);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
    });
};

export const deleteTop20Logo = async (id) => {
    return _runTransaction('top20Logos', 'readwrite', (store, resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const deleteTop20LogosByCity = async (cityName) => {
    return _runTransaction('top20Logos', 'readwrite', (store, resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.value.cityName === cityName) {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });
};

export const getTop20LogoBlob = async (id) => {
    return _runTransaction('top20Logos', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result.logoBlob : null);
        req.onerror = () => reject(req.error);
    });
};

export const getTop20LogoFull = async (id) => {
    return _runTransaction('top20Logos', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result : null);
        req.onerror = () => reject(req.error);
    });
};

// --- Segment Logos ---
export const saveSegmentLogo = async (segmentId, cityName, fileName, logoBlob, eTag = null, lastModified = null, customId = null) => {
    return _runTransaction('segmentLogos', 'readwrite', (store, resolve, reject) => {
        const id = customId || `${segmentId}-${cityName}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const data = {
            id,
            segmentId,
            cityName,
            fileName,
            logoBlob,
            eTag,
            lastModified,
            updatedAt: Date.now()
        };
        const req = store.put(data);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
    });
};

export const deleteSegmentLogo = async (id) => {
    return _runTransaction('segmentLogos', 'readwrite', (store, resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const deleteSegmentLogosByCity = async (cityName) => {
    return _runTransaction('segmentLogos', 'readwrite', (store, resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.value.cityName === cityName) {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });
};

export const getSegmentLogoBlob = async (id) => {
    return _runTransaction('segmentLogos', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result.logoBlob : null);
        req.onerror = () => reject(req.error);
    });
};

export const getSegmentLogoFull = async (id) => {
    return _runTransaction('segmentLogos', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result : null);
        req.onerror = () => reject(req.error);
    });
};

// --- Fonts ---
export const saveFont = async (fontName, fontFormat, fontBlob) => {
    return _runTransaction('fonts', 'readwrite', (store, resolve, reject) => {
        const id = `${fontName}-${Date.now()}`;
        const data = {
            id,
            fontName,
            fontFormat,
            fontBlob,
            updatedAt: Date.now()
        };
        const req = store.put(data);
        req.onsuccess = () => resolve(id);
        req.onerror = () => reject(req.error);
    });
};

export const getFontBlob = async (id) => {
    return _runTransaction('fonts', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result.fontBlob : null);
        req.onerror = () => reject(req.error);
    });
};

export const deleteFont = async (id) => {
    return _runTransaction('fonts', 'readwrite', (store, resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- Establishments ---
export const saveEstablishment = async (data) => {
    return _runTransaction('establishments', 'readwrite', (store, resolve, reject) => {
        // data should contain { estabelecimento_id, nome_loja, cidade, segmentos, pedidos_ultimos_28_dias, logotipo, logoBlob, updatedAt }
        const req = store.put(data);
        req.onsuccess = () => resolve(data.estabelecimento_id);
        req.onerror = () => reject(req.error);
    });
};

export const getEstablishment = async (id) => {
    return _runTransaction('establishments', 'readonly', (store, resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const getEstablishmentsByCity = async (cityName) => {
    return _runTransaction('establishments', 'readonly', (store, resolve, reject) => {
        const index = store.index('cidade');
        const range = IDBKeyRange.only(cityName);
        const req = index.getAll(range);

        req.onsuccess = () => {
            // If getAll is supported on the index (modern browsers), this returns all matching records.
            resolve(req.result || []);
        };
        req.onerror = () => reject(req.error);
    });
};

export const deleteEstablishment = async (id) => {
    return _runTransaction('establishments', 'readwrite', (store, resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- Utilities ---
export const clearDB = async () => {
    if (!dbInstance) await initDB();
    const stores = ['cities', 'top20Logos', 'segmentLogos', 'fonts', 'templates', 'establishments'];
    const p = stores.map(storeName => {
        return new Promise((resolve, reject) => {
            const tx = dbInstance.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = resolve;
            req.onerror = reject;
        });
    });
    return Promise.all(p);
};

export const clearStore = async (storeName) => {
    if (!dbInstance) await initDB();
    return new Promise((resolve, reject) => {
        const tx = dbInstance.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = resolve;
        req.onerror = reject;
    });
};

/**
 * Selective Clear: Only data derived from SQL spreadsheet
 */
export const clearSpreadsheetData = async () => {
    if (!dbInstance) await initDB();
    const stores = ['top20Logos', 'segmentLogos', 'establishments'];
    const p = stores.map(storeName => {
        return new Promise((resolve, reject) => {
            const tx = dbInstance.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = resolve;
            req.onerror = reject;
        });
    });
    return Promise.all(p);
};
