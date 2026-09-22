import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Stack and manifest. The connect-src list
// below makes the browser itself enforce invariant 3 (the Salesforce session
// cookie only ever goes to My-Domain Tooling hosts) and the promise that
// nothing leaves the browser except calls to your org and your chosen
// provider.
const SALESFORCE_HOSTS = [
  'https://*.my.salesforce.com/*',
  'https://*.my.salesforce-setup.com/*',
  'https://*.lightning.force.com/*',
];
const PROVIDER_HOSTS = [
  'https://api.anthropic.com/*',
  'https://api.openai.com/*',
  'https://generativelanguage.googleapis.com/*',
];

/**
 * The page may load nothing from anywhere but itself, apart from the network
 * calls the product exists for. `default-src 'self'` covers images, fonts,
 * frames, media, and workers, so a model-drawn diagram (a Mermaid image shape,
 * a CSS `url`) cannot make the panel fetch from a third host: "nothing goes
 * anywhere else" is then a browser rule, not a promise (security review). Inline styles stay allowed: React, Shiki, and Mermaid all set
 * `style` attributes, and Mermaid writes a <style> into its SVG. In
 * development builds the dev server's origin and reload socket are allowed.
 */
function extensionPagesCsp(development: boolean): string {
  const devHttp = development ? ' http://localhost:*' : '';
  const devSockets = development ? ' http://localhost:* ws://localhost:*' : '';
  return [
    `default-src 'self'${devHttp}`,
    "script-src 'self'",
    "object-src 'self'",
    `style-src 'self' 'unsafe-inline'${devHttp}`,
    `img-src 'self' data:${devHttp}`,
    // Tooling API hosts and the three providers; never *.force.com.
    `connect-src 'self' https://*.my.salesforce.com https://*.my.salesforce-setup.com https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com${devSockets}`,
  ].join('; ');
}

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Explicit imports only; no auto-import magic to learn.
  imports: false,
  // The gallery (every screen on one page, for review and the contact sheets)
  // is a development page. It is built only when asked for, so the package a
  // user installs holds the panel and its background script and nothing else
  // (security review). `npm run screenshots` sets the variable.
  filterEntrypoints: process.env.WXT_GALLERY ? undefined : ['background', 'sidepanel'],
  manifest: (env) => ({
    name: 'Flow Companion for Salesforce',
    // The store shows this as the listing's summary and the dashboard cannot
    // edit it, so the approved store line lives here (132-character limit).
    description:
      'Chat with your Salesforce flows using the AI model of your choice.',
    minimum_chrome_version: '114',
    // Exactly these three. No `tabs`: tab URLs are readable through the
    // Salesforce host permissions alone, so the install prompt never says
    // "read your browsing history".
    permissions: ['cookies', 'sidePanel', 'storage'],
    host_permissions: [...SALESFORCE_HOSTS, ...PROVIDER_HOSTS],
    action: {
      default_title: 'Open Flow Companion',
    },
    content_security_policy: {
      extension_pages: extensionPagesCsp(env.mode === 'development'),
    },
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
