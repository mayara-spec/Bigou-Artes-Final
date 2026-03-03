export class Renderer {
    /**
     * Render art to canvas. Call canvas.toBlob() after this to get the final image.
     * Returns the canvas for chaining.
     */
    static async renderToCanvas(canvas, templateImg, cityImg, logos, cityText, cityName, format) {
        const ctx = canvas.getContext('2d');
        const { w, h } = format === 'feed' ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
        canvas.width = w;
        canvas.height = h;

        // Clear canvas to prevent residue from previous renders
        ctx.clearRect(0, 0, w, h);



        // 2. Render Template (Overlay)
        if (templateImg) {
            try {
                const tImg = await this.loadImage(templateImg);
                this.drawCover(ctx, tImg, 0, 0, w, h);
            } catch (e) {
                console.warn('Renderer: failed to load template', e.message);
                ctx.fillStyle = '#1E293B';
                ctx.fillRect(0, 0, w, h);
            }
        } else {
            ctx.fillStyle = '#1E293B';
            ctx.fillRect(0, 0, w, h);
        }

        // 1.5 Render City Image
        if (cityImg && cityText && cityText.imageArea) {
            try {
                const cImg = await this.loadImage(cityImg);
                const a = cityText.imageArea;
                this.drawCover(ctx, cImg, a.x * w, a.y * h, a.w * w, a.h * h);
            } catch (e) {
                console.warn('Renderer: failed load city image', e.message);
            }
        }

        // 3. Render Logos
        if (logos && logos.slots && logos.data) {
            // --- Slot Packing Logic ---
            let renderSlots = logos.slots;
            let renderData = logos.data.filter(l => l); // Ensure no null/empty data

            if (renderData.length > 0 && renderData.length < logos.slots.length) {
                // 1. Sort slots by Visual Priority (Top-Left)
                const allSlots = [...logos.slots].map((s, i) => ({ ...s, originalIndex: i }));
                allSlots.sort((a, b) => {
                    const yDiff = Math.abs(a.y - b.y);
                    if (yDiff > 0.05) { // 5% of height tolerance for rows
                        return a.y - b.y;
                    }
                    return a.x - b.x;
                });

                // 2. Slice to the number of available logos
                const usedSlots = allSlots.slice(0, renderData.length);

                // 3. Compacting / Alignment Logic
                const xs = usedSlots.map(s => s.x);
                const ys = usedSlots.map(s => s.y);
                const xRange = Math.max(...xs) - Math.min(...xs);
                const yRange = Math.max(...ys) - Math.min(...ys);

                const allXs = allSlots.map(s => s.x);
                const allYs = allSlots.map(s => s.y);
                const allMinX = Math.min(...allXs);
                const allMaxX = Math.max(...allXs) + allSlots[allSlots.length - 1].w; // Approx max width point
                const allMinY = Math.min(...allYs);
                const allMaxY = Math.max(...allYs) + allSlots[allSlots.length - 1].h; // Approx max height point

                const THRESHOLD = 0.05; // 5% tolerance to determine if it's a straight line

                if (yRange < THRESHOLD) {
                    // ROW - Distribute Horizontally
                    const usedTotalWidth = Math.max(...xs) + usedSlots[usedSlots.length - 1].w - Math.min(...xs);
                    const availableSpace = allMaxX - allMinX;
                    const startX = allMinX + (availableSpace - usedTotalWidth) / 2;

                    const shiftX = startX - Math.min(...xs);
                    usedSlots.forEach(s => s.x += shiftX);

                } else if (xRange < THRESHOLD) {
                    // COLUMN - Distribute Vertically
                    const usedTotalHeight = Math.max(...ys) + usedSlots[usedSlots.length - 1].h - Math.min(...ys);
                    const availableSpace = allMaxY - allMinY;
                    const startY = allMinY + (availableSpace - usedTotalHeight) / 2;

                    const shiftY = startY - Math.min(...ys);
                    usedSlots.forEach(s => s.y += shiftY);
                }

                renderSlots = usedSlots;
            }
            // --- End Slot Packing Logic ---

            for (let i = 0; i < renderSlots.length; i++) {
                const slot = renderSlots[i];
                const logoData = renderData[i];
                if (!logoData) continue;

                try {
                    const lImg = await this.loadImage(logoData);
                    const sw = slot.w * w;
                    const sh = slot.h * h;
                    const sx = slot.x * w;
                    const sy = slot.y * h;
                    const radius = Math.min(sw, sh) / 2;
                    const cx = sx + sw / 2;
                    const cy = sy + sh / 2;

                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                    ctx.clip();
                    this.drawCover(ctx, lImg, sx, sy, sw, sh);
                    ctx.restore();
                } catch (e) {
                    console.warn(`Renderer: failed to load logo ${i}`, e.message);
                }
            }
        }

        // 4. Render City Text
        if (cityText && cityText.area && cityName) {
            const area = cityText.area;
            ctx.fillStyle = cityText.color || '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const tx = (area.x + area.w / 2) * w;
            const ty = (area.y + area.h / 2) * h;
            const maxW = area.w * w;
            const maxH = area.h * h;

            let fontSize = maxH * 0.8;
            ctx.font = `900 ${fontSize}px "${cityText.font || 'Manrope'}"`;

            while (ctx.measureText(cityName).width > maxW && fontSize > 10) {
                fontSize -= 2;
                ctx.font = `900 ${fontSize}px "${cityText.font || 'Manrope'}"`;
            }

            ctx.fillText(cityName, tx, ty);
        }

        return canvas;
    }

    /**
     * Get a PNG blob from the canvas. Use AFTER renderToCanvas.
     */
    static canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('canvas.toBlob returned null'));
            }, 'image/png');
        });
    }

    static loadImage(src) {
        return new Promise((resolve, reject) => {
            if (!src) { reject(new Error('No image source')); return; }
            const img = new Image();
            // Only set crossOrigin for non-data URLs
            if (!src.startsWith('data:') && !src.startsWith('blob:')) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load: ${String(src).substring(0, 60)}`));
            img.src = src;
        });
    }

    static drawCover(ctx, img, x, y, w, h) {
        const imgRatio = img.width / img.height;
        const areaRatio = w / h;
        let sx, sy, sw, sh;

        if (imgRatio > areaRatio) {
            sh = img.height;
            sw = sh * areaRatio;
            sx = (img.width - sw) / 2;
            sy = 0;
        } else {
            sw = img.width;
            sh = sw / areaRatio;
            sx = 0;
            sy = (img.height - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    }


}
