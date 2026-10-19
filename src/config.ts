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
  /** Newsletter name. Domain saastrap.com redirects to /newsletter/. */
  newsletter: 'SaaS Trap of the Week',
  /**
   * Public MailerLite embedded-form endpoint (form "SaaS Trap - kitlibre.com", group "SaaS Trap of the Week", double opt-in).
   * Not a secret: it is the same action URL MailerLite puts in its HTML embed code. No API key is ever used on the site.
   */
  newsletterFormAction: 'https://assets.mailerlite.com/jsonp/2342555/forms/201738245033166731/subscribe',
  /** "Kitlibre feature alerts" (MailerLite group 201749726554489893, embedded form, double opt-in): background remover updates */
  featureFormAction: 'https://assets.mailerlite.com/jsonp/2342555/forms/201749732087825581/subscribe',
  /** Only for preview builds (KIT_NOINDEX=1): <meta name="robots" content="noindex"> + robots.txt disallow. */
  noindex: typeof process !== 'undefined' ? process.env?.KIT_NOINDEX === '1' : false,
} as const;
