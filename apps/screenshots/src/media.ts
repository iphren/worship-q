// Draws the sermon deck's slides as the JPEG images an imported deck is made of, at render
// time, so no picture is kept in git.

import sharp from 'sharp';
import type { SermonSlide } from './content';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** One slide: a title slide when `first`, otherwise a point with its verse. */
function slideSvg(slide: SermonSlide, first: boolean): string {
  const font = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;
  const text = first
    ? `<text x="960" y="500" text-anchor="middle" font-size="128" font-weight="700" fill="#ffffff" ${font}>${escapeXml(slide.heading)}</text>
       <rect x="880" y="560" width="160" height="6" rx="3" fill="#fcbb00"/>
       ${slide.lines
         .map(
           (line, i) =>
             `<text x="960" y="${680 + i * 90}" text-anchor="middle" font-size="72" fill="#cbd5e1" ${font}>${escapeXml(line)}</text>`,
         )
         .join('')}`
    : `<rect x="140" y="270" width="14" height="140" rx="7" fill="#fcbb00"/>
       <text x="200" y="390" font-size="128" font-weight="700" fill="#ffffff" ${font}>${escapeXml(slide.heading)}</text>
       ${slide.lines
         .map(
           (line, i) =>
             `<text x="200" y="${580 + i * 110}" font-size="${i === 0 ? 76 : 60}" fill="${i === 0 ? '#e2e8f0' : '#94a3b8'}" ${font}>${escapeXml(line)}</text>`,
         )
         .join('')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b2540"/>
        <stop offset="1" stop-color="#14532d"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    ${text}
  </svg>`;
}

/** The slides as JPEG images, in order. */
export function slideImages(slides: SermonSlide[]): Promise<Buffer[]> {
  return Promise.all(
    slides.map((slide, i) =>
      sharp(Buffer.from(slideSvg(slide, i === 0)))
        .jpeg({ quality: 88 })
        .toBuffer(),
    ),
  );
}
