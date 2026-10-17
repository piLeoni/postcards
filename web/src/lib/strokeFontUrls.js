/**
 * Catalog stroke-font URLs embedded in graphs (from drawland-core) → files in
 * `public/fonts/`. The browser cannot fetch GitLab raw URLs (CORS); the CLI can.
 */
export const STROKE_FONT_FETCH_URL = {
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadability.svg': '/fonts/EMSReadability.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSReadabilityItalic.svg': '/fonts/EMSReadabilityItalic.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSSwiss.svg': '/fonts/EMSSwiss.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSTech.svg': '/fonts/EMSTech.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSCasualHand.svg': '/fonts/EMSCasualHand.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSAllure.svg': '/fonts/EMSAllure.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSOsmotron.svg': '/fonts/EMSOsmotron.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSNixish.svg': '/fonts/EMSNixish.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSBird.svg': '/fonts/EMSBird.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/EMSCapitol.svg': '/fonts/EMSCapitol.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheySerifMed.svg': '/fonts/HersheySerifMed.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheyScript1.svg': '/fonts/HersheyScript1.svg',
  'https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/Hershey/HersheyGothEnglish.svg': '/fonts/HersheyGothEnglish.svg',
}

/** Where to `fetch` bytes; `catalogUrl` stays the WASM map key. */
export function strokeFontFetchUrl(catalogUrl) {
  return STROKE_FONT_FETCH_URL[catalogUrl] ?? catalogUrl
}
