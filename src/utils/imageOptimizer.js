/**
 * Image Optimizer Utility
 * Resizes and compresses images to prevent localStorage exceeding and improve performance.
 */

/**
 * Compress and resize an image File or Blob.
 * @param {File|Blob} file - Input file/blob
 * @param {number} maxWidth  - Max width in pixels
 * @param {number} maxHeight - Max height in pixels
 * @param {number} quality   - JPEG quality (0.0 - 1.0)
 * @param {boolean} forceJpeg - If true, always output JPEG (strips transparency). Default true for smaller size.
 * @returns {Promise<Blob>} Optimized Blob
 */
export const optimizeImage = (file, maxWidth = 1200, maxHeight = 1200, quality = 0.8, forceJpeg = true) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      // Scale down while preserving aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');

      // Fill white background before drawing (removes transparency, enables JPEG)
      if (forceJpeg) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = forceJpeg ? 'image/jpeg' : 'image/webp';

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas to Blob failed'));
        }
      }, mimeType, quality);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    }
    img.src = objectUrl;
  });
};

/**
 * Optimize a logo image (small, circular shape - higher quality needed)
 * @param {File|Blob} file 
 */
export const optimizeLogo = (file) =>
  optimizeImage(file, 400, 400, 0.85, false);

/**
 * Optimize a city photo (medium size, shown in grid thumbnails)
 * @param {File|Blob} file 
 */
export const optimizeCityPhoto = (file) =>
  optimizeImage(file, 800, 800, 0.75, true);

/**
 * Optimize a template image (full-page template, needs transparency for overlay).
 * Keep PNG/WebP format to preserve transparency. Keep full resolution for accurate rendering.
 * @param {File|Blob} file 
 */
export const optimizeTemplate = (file) =>
  optimizeImage(file, 1080, 1920, 0.92, false);
