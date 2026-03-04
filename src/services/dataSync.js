import { state } from './state.js';
import {
    saveEstablishment,
    getEstablishmentsByCity,
    deleteEstablishment,
    saveTop20Logo,
    saveSegmentLogo,
    clearStore,
    getTop20LogoBlob,
    getSegmentLogoBlob
} from './db.js';
import { optimizeLogo } from '../utils/imageOptimizer.js';

// Parses CSV text, handling basic quotes and separators
export const parseCSV = (csvText) => {
    const lines = csvText.trim().split(/\r?\n/);
    if (!lines.length) return [];

    const separator = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''));

    const results = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        let cols = [];
        let cur = '';
        let inQuote = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"' && (j === 0 || line[j - 1] !== '\\')) {
                inQuote = !inQuote;
            } else if (char === separator && !inQuote) {
                cols.push(cur.trim());
                cur = '';
            } else {
                cur += char;
            }
        }
        cols.push(cur.trim());

        // fallback if wrong separator
        if (cols.length < headers.length && separator === ',' && line.includes(';')) {
            cols = line.split(';').map(c => c.trim());
        }

        if (cols.length >= headers.length || cols.length > 2) {
            const rowObj = {};
            headers.forEach((header, index) => {
                let val = cols[index] ? cols[index] : '';
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.substring(1, val.length - 1).replace(/""/g, '"');
                }
                rowObj[header] = val;
            });

            // Prevent Primary Key collisions if CSV is missing the ID column
            if (!rowObj.estabelecimento_id || rowObj.estabelecimento_id.trim() === '') {
                // We use name + city to deterministically identify if no ID is provided, preventing redundant downloads
                const safeName = (rowObj.nome_loja || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                const safeCity = (rowObj.cidade || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                rowObj.estabelecimento_id = `gen_${safeName}_${safeCity}`;
            }

            results.push(rowObj);
        }
    }
    return results;
};

// Vanilla JavaScript Promise Pool for concurrent downloads
const asyncPool = async (poolLimit, array, iteratorFn) => {
    const ret = [];
    const executing = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item, array));
        ret.push(p);
        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const fetchWithRetry = async (url, options = {}, retries = 5, backoff = 1000) => {
    try {
        await sleep(250); // Base throttle to prevent bursts (4 req/sec max per thread)
        const response = await fetch(url, options);
        if (response.status === 429 || response.status >= 500) {
            if (retries > 0) {
                let waitTime = backoff;
                const retryAfter = response.headers.get('Retry-After');
                if (retryAfter) {
                    const parsed = parseInt(retryAfter, 10);
                    if (!isNaN(parsed)) waitTime = parsed * 1000;
                }
                console.warn(`[DataSync] Rate limit ${response.status} on ${url}. Retrying in ${waitTime}ms... (${retries} left)`);
                await sleep(waitTime);
                return fetchWithRetry(url, options, retries - 1, Math.min(waitTime * 2, 60000));
            }
        }
        return response;
    } catch (err) {
        if (retries > 0) {
            console.warn(`[DataSync] Fetch error on ${url}. Retrying in ${backoff}ms... (${retries} left)`);
            await sleep(backoff);
            return fetchWithRetry(url, options, retries - 1, Math.min(backoff * 2, 60000));
        }
        throw err;
    }
};

// Main Synchronization Workflow
export const syncSQLData = async (csvText, onProgress) => {
    const report = {
        success: true,
        parsed: 0,
        logosOk: 0,
        logosFailed: 0,
        errors: [],
        failedTasks: []
    };

    try {
        onProgress('Lendo planilha CSV...');

        // Let UI paint
        await new Promise(resolve => setTimeout(resolve, 50));

        const rows = parseCSV(csvText);
        report.parsed = rows.length;

        if (!rows.length) throw new Error("O arquivo CSV parece estar vazio ou tem um formato inválido.");

        const validSegments = ['Hambúrguer', 'Pizza', 'Açaí', 'Sobremesa', 'Almoço', 'Porção', 'Cachorro Quente', 'Salgado'];

        const segmentAliases = {
            'burger': 'Hambúrguer', 'lanches': 'Hambúrguer', 'hamburguer': 'Hambúrguer',
            'burger e lanches': 'Hambúrguer',
            'pizza': 'Pizza',
            'acai': 'Açaí',
            'doces': 'Sobremesa', 'doces e sobremesa': 'Sobremesa', 'doces e sobremesas': 'Sobremesa', 'sobremesa': 'Sobremesa', 'sobremesas': 'Sobremesa', 'sorvete': 'Sobremesa', 'sorvetes': 'Sobremesa',
            'almoco': 'Almoço', 'restaurante': 'Almoço', 'refeicao': 'Almoço',
            'porcao': 'Porção', 'porcoes': 'Porção',
            'hot dog': 'Cachorro Quente', 'cachorro quente': 'Cachorro Quente',
            'salgado': 'Salgado', 'salgados': 'Salgado',
        };

        const normalizeSegment = (raw) => {
            if (!raw) return '';
            // Remove accents and lowercase for robust matching
            const val = raw.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return segmentAliases[val] || raw; // fallback to original if not mapped
        };

        const normalizeName = (str) => {
            if (!str) return '';
            return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        };

        // Cache existing cities to preserve exact accent/case from UI
        const existingCityMap = {};
        for (const c of state.cities) {
            existingCityMap[normalizeName(c.name)] = c.name;
        }

        onProgress(`Organizando ${rows.length} parceiros por cidade...`);
        await new Promise(resolve => setTimeout(resolve, 0));

        // Group by city for processing
        const citiesMap = {};
        onProgress(`Deduplicando ${rows.length} registros...`);
        const deduplicatedRows = [];
        const seenIds = new Set();
        for (const row of rows) {
            const id = String(row.estabelecimento_id);
            if (!seenIds.has(id)) {
                seenIds.add(id);
                deduplicatedRows.push(row);
            }
        }

        for (const row of deduplicatedRows) {
            let city = row.cidade;
            if (!city) continue;

            // Snap to existing UI city if it matches ignoring accents (e.g. Abaete -> Abaeté)
            const normCity = normalizeName(city);
            if (existingCityMap[normCity]) {
                city = existingCityMap[normCity];
                row.cidade = city;
            }

            if (!citiesMap[city]) citiesMap[city] = [];

            // Multi-segment support: Store normalized list (deduplicated)
            if (row.segmentos) {
                const segs = row.segmentos.split(',').map(s => s.trim());
                const normalized = segs
                    .map(s => normalizeSegment(s))
                    .filter(s => validSegments.includes(s));
                row.normalizedSegments = [...new Set(normalized)];
            } else {
                row.normalizedSegments = [];
            }
            citiesMap[city].push(row);
        }

        // State accumulators to prevent Vue/React thrashing
        let nextCities = [...state.cities];
        let nextTop20Folders = [...state.top20Folders];
        let nextSegmentCities = [...state.segmentCities];

        // Replace entirely from scratch on every run to prevent ghost icons since clearStore wipes IDB
        let nextLogos = [];
        let nextSegmentLogos = [];

        // 0. Drop Missing Cities
        const citiesInCSV = Object.keys(citiesMap);
        const existingCities = nextCities.map(c => c.name);

        onProgress(`Limpando cache de curadoria antigo...`);
        await clearStore('top20Logos');
        await clearStore('segmentLogos');

        for (const cityName of existingCities) {
            if (!citiesInCSV.includes(cityName)) {
                onProgress(`Removendo cidade excluída da nova planilha: ${cityName}...`);
                const ests = await getEstablishmentsByCity(cityName);
                for (const e of ests) {
                    await deleteEstablishment(e.estabelecimento_id);
                }
                // Cleanup arrays
                nextCities = nextCities.filter(c => c.name !== cityName);
                nextTop20Folders = nextTop20Folders.filter(c => c.name !== cityName);
                nextSegmentCities = nextSegmentCities.filter(c => c.name !== cityName);
            }
        }

        // Prepare lists for concurrent download
        const pendingLogoDownloads = [];

        // 1. Process Raw Establishments per City
        let citiesProcessedCount = 0;
        for (const cityName of citiesInCSV) {
            if (citiesProcessedCount % 5 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            citiesProcessedCount++;

            onProgress(`Processando cidade: ${cityName}...`);
            const currentCityRows = citiesMap[cityName];
            const activeIds = new Set(currentCityRows.map(r => r.estabelecimento_id));

            // Merge / DB Save / Delete
            const existingEstabs = await getEstablishmentsByCity(cityName);
            for (const est of existingEstabs) {
                if (!activeIds.has(est.estabelecimento_id)) {
                    await deleteEstablishment(est.estabelecimento_id);
                }
            }

            for (const row of currentCityRows) {
                const existing = existingEstabs.find(e => e.estabelecimento_id === String(row.estabelecimento_id));
                let logoBlob = existing ? existing.logoBlob : null;

                if (existing && existing.logotipo !== row.logotipo) {
                    logoBlob = null;
                }

                const estData = {
                    estabelecimento_id: String(row.estabelecimento_id),
                    nome_loja: row.nome_loja || 'Loja Desconhecida',
                    cidade: cityName,
                    segmentos: row.segmentos || '',
                    normalizedSegment: row.normalizedSegments ? row.normalizedSegments[0] : '', // keep first as primary for legacy
                    normalizedSegments: row.normalizedSegments || [], // full list
                    pedidos_ultimos_28_dias: parseInt(row.pedidos_ultimos_28_dias) || 0,
                    logotipo: row.logotipo,
                    logoBlob: logoBlob,
                    updatedAt: Date.now()
                };
                await saveEstablishment(estData);
            }

            await new Promise(resolve => setTimeout(resolve, 0));

            // 2. Curadoria: Repopulate Top 20 & Segments
            onProgress(`Organizando Top 20 e Segmentos: ${cityName}...`);

            let stateCity = nextCities.find(c => c.name === cityName);
            if (!stateCity) {
                const id = `${cityName.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`;
                stateCity = { id, name: cityName, createdAt: Date.now(), partnerCount: 0 };
                nextCities.push(stateCity);
            }
            stateCity.partnerCount = currentCityRows.length;

            const updatedEstabs = await getEstablishmentsByCity(cityName);

            // TOP 20
            const sortedForTop20 = [...updatedEstabs].sort((a, b) => {
                if (b.pedidos_ultimos_28_dias !== a.pedidos_ultimos_28_dias) {
                    return b.pedidos_ultimos_28_dias - a.pedidos_ultimos_28_dias;
                }
                return a.nome_loja.localeCompare(b.nome_loja);
            }).slice(0, 20);

            if (!nextTop20Folders.find(f => f.name === cityName)) {
                nextTop20Folders.push({ id: stateCity.id, name: cityName });
            }

            for (const est of sortedForTop20) {
                pendingLogoDownloads.push({
                    type: 'top20',
                    est,
                    cityName,
                    cityId: stateCity.id
                });
            }

            // SEGMENTS
            const segmentGroups = {};
            validSegments.forEach(seg => segmentGroups[seg] = []);

            for (const est of updatedEstabs) {
                if (!est.normalizedSegments || est.normalizedSegments.length === 0) continue;
                est.normalizedSegments.forEach(normalizedName => {
                    if (segmentGroups[normalizedName]) {
                        segmentGroups[normalizedName].push(est);
                    }
                });
            }

            // Ensure all cities have segment folders
            if (!nextSegmentCities.find(c => c.name === cityName)) {
                nextSegmentCities.push({ id: stateCity.id, name: cityName });
            }

            for (const seg of validSegments) {
                const group = segmentGroups[seg];
                // Sort by orders DESC, then by name for deterministic results
                const sortedCandidates = group.sort((a, b) => {
                    if (b.pedidos_ultimos_28_dias !== a.pedidos_ultimos_28_dias) {
                        return b.pedidos_ultimos_28_dias - a.pedidos_ultimos_28_dias;
                    }
                    return a.nome_loja.localeCompare(b.nome_loja);
                });

                // Pick top 10 that HAVE a valid logo URL (non-empty, starts with http)
                const selectedForCuration = [];
                const seenInSegment = new Set();
                let logosOk = 0;
                let logosInvalid = 0;

                for (const candidate of sortedCandidates) {
                    if (selectedForCuration.length >= 10) break;
                    if (seenInSegment.has(candidate.estabelecimento_id)) continue;

                    const hasUrl = candidate.logotipo && typeof candidate.logotipo === 'string' && candidate.logotipo.trim().startsWith('http');
                    if (hasUrl) {
                        selectedForCuration.push(candidate);
                        seenInSegment.add(candidate.estabelecimento_id);
                        logosOk++;
                    } else {
                        logosInvalid++;
                    }
                }

                console.log(`[CURADORIA][${cityName}][${seg}] Candidatos=${group.length} Selecionados=${selectedForCuration.length} (LogosValid=${logosOk}, LogosInvalid=${logosInvalid})`);

                // CRITICAL FIX: To map to state.segments (e.g., "Cachorro Quente" -> "cachorro_quente")
                const segmentId = seg.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

                for (const est of selectedForCuration) {
                    pendingLogoDownloads.push({
                        type: 'segment',
                        est,
                        cityName,
                        cityId: stateCity.id,
                        segmentId
                    });
                }
            }

            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // 3. Fast Metadata Commit (Phase 1)
        onProgress(`Salvando metadados de ${pendingLogoDownloads.length} parceiros selecionados...`);
        for (const task of pendingLogoDownloads) {
            const { type, est, cityName, cityId, segmentId } = task;

            // We just store the Original iFood link or a Proxy wrapper as a placeholder. No blobs.
            const rawUrl = est.logotipo;
            const proxyUrl = rawUrl ? `/logo-proxy?url=${encodeURIComponent(rawUrl)}` : null;
            const imageUrl = proxyUrl || rawUrl;

            const deterministicId = `${type === 'top20' ? 'top20' : segmentId}-${cityName}-${est.estabelecimento_id}`;

            if (type === 'top20') {
                const id = await saveTop20Logo(cityName, `${est.nome_loja}.png`, null, null, null, deterministicId);
                // Try and locate cached eTags from the old state
                const oldLogo = state.logos.find(l => l.rawS3Url === rawUrl && (!l.memoryUrl || l.eTag));
                const eTag = oldLogo ? oldLogo.eTag : null;
                const lastMod = oldLogo ? oldLogo.lastModified : null;

                nextLogos.push({ id, cityId, name: `${est.nome_loja}.png`, fallbackUrl: proxyUrl, data: imageUrl, memoryUrl: false, rawS3Url: rawUrl, estId: est.estabelecimento_id, eTag, lastModified: lastMod });
            } else if (type === 'segment') {
                const id = await saveSegmentLogo(segmentId, cityName, `${est.nome_loja}.png`, null, null, null, deterministicId);
                // Try and locate cached eTags from the old state
                const oldLogo = state.segmentLogos.find(l => l.rawS3Url === rawUrl && (!l.memoryUrl || l.eTag));
                const eTag = oldLogo ? oldLogo.eTag : null;
                const lastMod = oldLogo ? oldLogo.lastModified : null;

                nextSegmentLogos.push({ id, cityId, segmentId, name: `${est.nome_loja}.png`, fallbackUrl: proxyUrl, data: imageUrl, memoryUrl: false, rawS3Url: rawUrl, estId: est.estabelecimento_id, eTag, lastModified: lastMod });
            }
        }

        // 4. Commit batched state changes ONCE
        state.cities = nextCities;
        state.top20Folders = nextTop20Folders;
        state.segmentCities = nextSegmentCities;
        state.logos = nextLogos;
        state.segmentLogos = nextSegmentLogos;

        onProgress('Importação de dados concluída!');
        return report;
    } catch (error) {
        console.error("Sync error:", error);
        report.success = false;
        report.error = error.message;
        return report;
    }
};

export const getPendingDownloadGroups = async () => {
    let top20Total = 0;
    let segmentTotal = 0;
    let noLogoSkipped = 0;
    const urlMap = new Map(); // rawUrl -> { proxyUrl, rawUrl, isTop20, tasks[] }

    const isValidUrl = (url) => url && typeof url === 'string' && url.trim().startsWith('http');

    // Check Top 20
    for (const logo of state.logos) {
        if (logo.rawS3Url) {
            if (!isValidUrl(logo.rawS3Url)) {
                noLogoSkipped++;
                continue;
            }

            // Check if we already have a valid blob
            const blob = await getTop20LogoBlob(logo.id);
            if (blob && blob.size >= 200) {
                continue; // Skip already downloaded
            }

            top20Total++;
            const raw = logo.rawS3Url.trim();
            if (!urlMap.has(raw)) {
                urlMap.set(raw, {
                    rawUrl: raw,
                    proxyUrl: `/logo-proxy?url=${encodeURIComponent(raw)}`,
                    isTop20: true,
                    tasks: []
                });
            }
            urlMap.get(raw).isTop20 = true;
            urlMap.get(raw).tasks.push({ type: 'top20', logoRef: logo });
        }
    }

    // Check Segments
    for (const logo of state.segmentLogos) {
        if (logo.rawS3Url) {
            if (!isValidUrl(logo.rawS3Url)) {
                noLogoSkipped++;
                continue;
            }

            // Check if we already have a valid blob
            const blob = await getSegmentLogoBlob(logo.id);
            if (blob && blob.size >= 200) {
                continue; // Skip already downloaded
            }

            segmentTotal++;
            const raw = logo.rawS3Url.trim();
            if (!urlMap.has(raw)) {
                urlMap.set(raw, {
                    rawUrl: raw,
                    proxyUrl: `/logo-proxy?url=${encodeURIComponent(raw)}`,
                    isTop20: false,
                    tasks: []
                });
            }
            urlMap.get(raw).tasks.push({ type: 'segment', logoRef: logo });
        }
    }

    const groups = Array.from(urlMap.values());

    // Prioritize Top20 URLs first
    groups.sort((a, b) => {
        if (a.isTop20 && !b.isTop20) return -1;
        if (!a.isTop20 && b.isTop20) return 1;
        return 0;
    });

    const totalUniqueUrlsToDownload = groups.length;
    const duplicatesRemoved = (top20Total + segmentTotal) - totalUniqueUrlsToDownload;

    return {
        top20Total,
        segmentTotal,
        totalUniqueUrlsToDownload,
        total: totalUniqueUrlsToDownload, // backcompat
        duplicatesRemoved,
        noLogoSkipped,
        groups
    };
};

export const downloadPendingLogos = async (groups, onProgress) => {
    const report = { success: true, requested: groups.length, logosOk: 0, logosFailed: 0, errors: [], failedTasks: [] };

    if (groups.length === 0) {
        onProgress('Todos os logos necessários já foram baixados e cacheados.');
        return report;
    }

    // ─── TELEMETRY ───
    const telemetry = {
        startTime: Date.now(),
        fetchTimes: [],       // ms per successful fetch
        idbTimes: [],         // ms per IndexedDB write
        blobSizes: [],        // KB per blob
        errors429: 0,
        errorsTimeout: 0,
        errors404: 0,
        errors5xx: 0,
        errorsCORS: 0,
        errorsOther: 0,
        errors304Skip: 0,
        totalRetries: 0,
        activeConcurrency: 0,
    };

    const telemetryStr = () => {
        const elapsed = (Date.now() - telemetry.startTime) / 1000;
        const done = report.logosOk + report.logosFailed;
        const rate = done / Math.max(elapsed, 1);
        const remaining = report.requested - done;
        const eta = rate > 0 ? Math.round(remaining / rate) : '?';

        const avgFetch = telemetry.fetchTimes.length > 0
            ? Math.round(telemetry.fetchTimes.reduce((a, b) => a + b, 0) / telemetry.fetchTimes.length)
            : 0;
        const p95Fetch = telemetry.fetchTimes.length > 0
            ? Math.round(telemetry.fetchTimes.sort((a, b) => a - b)[Math.floor(telemetry.fetchTimes.length * 0.95)] || 0)
            : 0;
        const avgIdb = telemetry.idbTimes.length > 0
            ? Math.round(telemetry.idbTimes.reduce((a, b) => a + b, 0) / telemetry.idbTimes.length)
            : 0;
        const avgBlob = telemetry.blobSizes.length > 0
            ? Math.round(telemetry.blobSizes.reduce((a, b) => a + b, 0) / telemetry.blobSizes.length)
            : 0;

        return `📊 ${done}/${report.requested} | ${rate.toFixed(1)}/s | ETA ${eta}s
⚡ C:${telemetry.activeConcurrency}/${concurrency} T:${throttleMs}ms
⏱ Fetch avg:${avgFetch}ms p95:${p95Fetch}ms | IDB:${avgIdb}ms | Blob:${avgBlob}KB
❌ 429:${telemetry.errors429} TO:${telemetry.errorsTimeout} 404:${telemetry.errors404} 5xx:${telemetry.errors5xx} CORS:${telemetry.errorsCORS} 304:${telemetry.errors304Skip}
✅ OK:${report.logosOk} FAIL:${report.logosFailed}`;
    };

    let dlCount = 0;
    const nextLogos = [...state.logos];
    const nextSegmentLogos = [...state.segmentLogos];

    // ─── ADAPTIVE QUEUE ───
    let concurrency = 15;
    let throttleMs = 30;
    const queue = [...groups];
    const activePromises = new Set();
    let consecutiveSuccessMs = Date.now();
    const MAX_CONCURRENCY = 24;
    const MIN_CONCURRENCY = 3;

    // Batch IDB write buffer
    const idbBatch = [];
    const BATCH_SIZE = 30;
    const flushIDB = async () => {
        if (idbBatch.length === 0) return;
        const toFlush = idbBatch.splice(0, idbBatch.length);
        const t0 = Date.now();
        for (const op of toFlush) {
            try {
                if (op.type === 'top20') {
                    await saveTop20Logo(op.cityName, op.fileName, op.blob, op.eTag, op.lastModified);
                } else {
                    await saveSegmentLogo(op.segmentId, op.cityName, op.fileName, op.blob, op.eTag, op.lastModified);
                }
            } catch (e) { console.warn('[IDB] batch write error', e); }
        }
        const idbMs = (Date.now() - t0) / toFlush.length;
        toFlush.forEach(() => telemetry.idbTimes.push(idbMs));
    };

    // Single-shot fetch (NO base sleep, NO multi-retry — just 1 attempt + abort)
    const quickFetch = async (url, extraHeaders = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000); // 10s hard timeout
        try {
            const res = await fetch(url, { signal: controller.signal, headers: extraHeaders });
            clearTimeout(timer);
            return res;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    };

    const classifyError = (err, response) => {
        if (err && (err.name === 'AbortError' || /abort/i.test(err.message))) {
            telemetry.errorsTimeout++;
            return 'timeout';
        }
        if (response) {
            if (response.status === 429) { telemetry.errors429++; return '429'; }
            if (response.status === 404) { telemetry.errors404++; return '404'; }
            if (response.status >= 500) { telemetry.errors5xx++; return '5xx'; }
        }
        if (err && /cors|network|failed to fetch/i.test(err.message)) {
            telemetry.errorsCORS++;
            return 'cors';
        }
        telemetry.errorsOther++;
        return 'other';
    };

    const processGroup = async (group) => {
        const logoRef = group.tasks[0]?.logoRef || {};
        const estId = logoRef.estId || '?';
        const logoName = logoRef.name || '?';
        const cachedETag = logoRef.eTag;
        const cachedLastModified = logoRef.lastModified;

        let blob = null;
        let newETag = null;
        let newLastModified = null;
        let isNotModified = false;

        if (throttleMs > 0) await new Promise(r => setTimeout(r, throttleMs));

        const fetchStart = Date.now();

        // ONLY use proxy — never try rawUrl directly (browser CORS blocks it)
        const urlsToTry = [group.proxyUrl];

        for (const targetUrl of urlsToTry) {
            if (blob || isNotModified) break;

            let response = null;
            try {
                const hdrs = {};
                if (cachedETag) hdrs['If-None-Match'] = cachedETag;
                if (cachedLastModified) hdrs['If-Modified-Since'] = cachedLastModified;

                response = await quickFetch(targetUrl, hdrs);

                if (response.status === 304) {
                    isNotModified = true;
                    telemetry.errors304Skip++;
                    break;
                }
                if (response.status === 404 || response.status === 403 || response.status === 422) {
                    // No retry for 404/403/422 — file doesn't exist, is blocked, or is invalid content
                    classifyError(null, response);
                    break; // stop trying this URL group
                }
                if (response.status === 429) {
                    classifyError(null, response);
                    concurrency = Math.max(MIN_CONCURRENCY, concurrency - 2);
                    throttleMs = Math.min(500, throttleMs + 50);
                    consecutiveSuccessMs = Date.now();
                    await sleep(1000);
                    continue; // try next URL variant
                }
                if (!response.ok) {
                    classifyError(null, response);
                    continue;
                }

                // Success!
                newETag = response.headers.get('ETag');
                newLastModified = response.headers.get('Last-Modified');
                const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
                let rawBlob = await response.blob();

                // Validate it's actually an image and not a 0KB/tiny error fragment
                const isImage = contentType.includes('image') || rawBlob.type.toLowerCase().includes('image');
                if (rawBlob.size < 200 || !isImage) {
                    telemetry.errorsOther++;
                    console.warn(`[Downloader] Invalid blob for ${estId}: size=${rawBlob.size}, type=${rawBlob.type}, headerType=${contentType}`);
                    continue; // try next URL variant
                }

                telemetry.blobSizes.push(Math.round(rawBlob.size / 1024));
                let file = new File([rawBlob], `${estId}.img`, { type: rawBlob.type || 'image/png' });
                blob = await optimizeLogo(file);
                telemetry.fetchTimes.push(Date.now() - fetchStart);

            } catch (err) {
                classifyError(err, response);
                telemetry.totalRetries++;
                // Continue to try next URL variant
            }
        }

        // Score results
        if (blob || isNotModified) {
            report.logosOk++;

            let memoryObjectURL = blob ? URL.createObjectURL(blob) : null;

            for (const task of group.tasks) {
                if (task.type === 'top20') {
                    if (blob) {
                        idbBatch.push({ type: 'top20', cityName: state.cities.find(c => c.id === task.logoRef.cityId)?.name, fileName: task.logoRef.name, blob, eTag: newETag, lastModified: newLastModified });
                    } else if (isNotModified) {
                        const existingBlob = await getTop20LogoBlob(task.logoRef.id);
                        if (existingBlob) memoryObjectURL = URL.createObjectURL(existingBlob);
                    }
                    const exIdx = nextLogos.findIndex(l => String(l.id) === String(task.logoRef.id));
                    if (exIdx !== -1) {
                        if (memoryObjectURL) nextLogos[exIdx].data = memoryObjectURL;
                        nextLogos[exIdx].memoryUrl = true;
                        if (newETag) nextLogos[exIdx].eTag = newETag;
                        if (newLastModified) nextLogos[exIdx].lastModified = newLastModified;
                    }
                } else if (task.type === 'segment') {
                    if (blob) {
                        idbBatch.push({ type: 'segment', segmentId: task.logoRef.segmentId, cityName: state.cities.find(c => c.id === task.logoRef.cityId)?.name, fileName: task.logoRef.name, blob, eTag: newETag, lastModified: newLastModified });
                    } else if (isNotModified) {
                        const existingBlob = await getSegmentLogoBlob(task.logoRef.id);
                        if (existingBlob && !memoryObjectURL) memoryObjectURL = URL.createObjectURL(existingBlob);
                    }
                    const exIdx = nextSegmentLogos.findIndex(l => String(l.id) === String(task.logoRef.id));
                    if (exIdx !== -1) {
                        if (memoryObjectURL) nextSegmentLogos[exIdx].data = memoryObjectURL;
                        nextSegmentLogos[exIdx].memoryUrl = true;
                        if (newETag) nextSegmentLogos[exIdx].eTag = newETag;
                        if (newLastModified) nextSegmentLogos[exIdx].lastModified = newLastModified;
                    }
                }
            }

            // Flush IDB batch when buffer is full
            if (idbBatch.length >= BATCH_SIZE) await flushIDB();

            // Ramp up concurrency on sustained success
            if (Date.now() - consecutiveSuccessMs > 10000) {
                concurrency = Math.min(MAX_CONCURRENCY, concurrency + 1);
                throttleMs = Math.max(0, throttleMs - 10);
                consecutiveSuccessMs = Date.now();
            }
        } else {
            report.logosFailed++;
            // Detailed error: log actual URL tried, estId, not just name
            const errDetail = report.errors.length < 20
                ? `❌ [${estId}] ${logoName} | RAW: ${group.rawUrl} | PROXY: ${group.proxyUrl}`
                : null;
            if (errDetail) report.errors.push(errDetail);
            group.tasks.forEach(t => report.failedTasks.push(t));
        }

        dlCount++;
        telemetry.activeConcurrency = activePromises.size;
        if (dlCount % 3 === 0) {
            onProgress(telemetryStr());
        }
    };

    // ─── MAIN LOOP ───
    onProgress(telemetryStr());
    while (queue.length > 0 || activePromises.size > 0) {
        while (activePromises.size < concurrency && queue.length > 0) {
            const group = queue.shift();
            const promise = processGroup(group).then(() => {
                activePromises.delete(promise);
            });
            activePromises.add(promise);
        }
        if (activePromises.size > 0) {
            await Promise.race(activePromises);
        }
    }

    // Flush remaining IDB batch
    await flushIDB();

    state.logos = nextLogos;
    state.segmentLogos = nextSegmentLogos;
    onProgress(`✅ Concluído! ${telemetryStr()}`);
    return report;
};

export const retryFailedDownloads = async (failedTasks, onProgress) => {
    const report = { success: true, logosOk: 0, logosFailed: 0, errors: [], failedTasks: [] };
    let dlCount = 0;

    const nextLogos = [...state.logos];
    const nextSegmentLogos = [...state.segmentLogos];

    onProgress(`Retentando ${failedTasks.length} falhas...`);

    await asyncPool(6, failedTasks, async (task) => {
        const { type, est, cityName, cityId, segmentId } = task;
        let blob = est.logoBlob;
        let useFallbackUrl = null;

        if (!blob && est.logotipo && est.logotipo.trim() !== '') {
            try {
                let response = await fetchWithRetry(est.logotipo);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                let rawBlob = await response.blob();
                let file = new File([rawBlob], `${est.estabelecimento_id}.png`, { type: rawBlob.type });
                blob = await optimizeLogo(file);
                est.logoBlob = blob;
                await saveEstablishment(est);
                report.logosOk++;
            } catch (err) {
                try {
                    const proxyUrl = `/logo-proxy?url=${encodeURIComponent(est.logotipo)}`;
                    let proxyFallback = await fetchWithRetry(proxyUrl);
                    if (!proxyFallback.ok) throw new Error(`Proxy HTTP ${proxyFallback.status}`);
                    let rawBlob = await proxyFallback.blob();
                    let file = new File([rawBlob], `${est.estabelecimento_id}.png`, { type: rawBlob.type });
                    blob = await optimizeLogo(file);
                    est.logoBlob = blob;
                    await saveEstablishment(est);
                    report.logosOk++;
                } catch (proxyErr) {
                    report.logosFailed++;
                    report.errors.push(`Falha ao baixar logo para ${est.nome_loja} via Proxy: ${proxyErr.message}`);
                    useFallbackUrl = est.logotipo;
                    report.failedTasks.push(task);
                }
            }
        } else if (!blob && est.logotipo) {
            useFallbackUrl = est.logotipo;
        }

        if (blob || useFallbackUrl) {
            const proxyUrl = useFallbackUrl ? `/logo-proxy?url=${encodeURIComponent(useFallbackUrl)}` : null;
            const imageUrl = blob ? URL.createObjectURL(blob) : proxyUrl;

            if (type === 'top20') {
                const id = await saveTop20Logo(cityName, `${est.nome_loja}.png`, blob);
                const exIdx = nextLogos.findIndex(l => String(l.cityId) === String(cityId) && l.name === `${est.nome_loja}.png`);
                if (exIdx !== -1) nextLogos.splice(exIdx, 1);
                nextLogos.push({ id, cityId, name: `${est.nome_loja}.png`, fallbackUrl: proxyUrl, data: imageUrl, memoryUrl: !!blob });
            } else if (type === 'segment') {
                const id = await saveSegmentLogo(segmentId, cityName, `${est.nome_loja}.png`, blob);
                const exIdx = nextSegmentLogos.findIndex(l => String(l.cityId) === String(cityId) && String(l.segmentId) === String(segmentId) && l.name === `${est.nome_loja}.png`);
                if (exIdx !== -1) nextSegmentLogos.splice(exIdx, 1);
                nextSegmentLogos.push({ id, cityId, segmentId, name: `${est.nome_loja}.png`, fallbackUrl: proxyUrl, data: imageUrl, memoryUrl: !!blob });
            }
        }

        dlCount++;
        onProgress(`Retentando Logos (${dlCount}/${failedTasks.length})...`);
    });

    state.logos = nextLogos;
    state.segmentLogos = nextSegmentLogos;
    onProgress('Retentativas concluídas!');
    return report;
};
