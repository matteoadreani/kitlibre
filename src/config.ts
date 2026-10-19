/**
 * Single source of truth for branding & site settings.
 * Rename the product by changing BRAND_NAME (and SITE.url).
 */
export const BRAND_NAME = 'Kitlibre';

export const SITE = {
  brand: BRAND_NAME,
  /** Product name of the QR tool, e.g. "Kitlibre QR". */
  product: `${BRAND_NAME} QR`,
  /** Absolute origin used for canonical URLs, OG tags and the sitemap. No trailing slash. */
  url: (typeof process !== 'undefined' && process.env?.KIT_SITE_URL) || 'https://kitlibre.com',
  /** Public source repository, linked from the footer, the hub ("Open source" principle) and the privacy page. Empty = "coming soon". */
  repoUrl: 'https://github.com/matteoadreani/kitlibre',
  /** Newsletter name (placeholder signup, see src/newsletter.ts). Domain saastrap.com redirects to /newsletter/. */
  newsletter: 'SaaS Trap of the Week',
  /** Only for preview builds (KIT_NOINDEX=1): <meta name="robots" content="noindex"> + robots.txt disallow. */
  noindex: typeof process !== 'undefined' ? process.env?.KIT_NOINDEX === '1' : false,
} as const;
