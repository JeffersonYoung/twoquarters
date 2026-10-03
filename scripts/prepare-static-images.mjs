import sharp from 'sharp';
import { IMAGE_WIDTHS } from '../server/images.mjs';
for (const file of ['public/images/automotive/hero-mclaren.jpg', 'public/images/bts/francesco-ungaro-P45gR9kH0SM-unsplash.jpg']) {
 for (const width of IMAGE_WIDTHS) {
  await sharp(file).autoOrient().resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(file.replace(/\.jpg$/, `-${width}.webp`));
 }
}
