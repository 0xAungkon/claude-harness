/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        harness: {
          sidebar: 'var(--bg-sidebar)',
          body: 'var(--bg-body)',
          panel: 'var(--bg-panel)',
          hover: 'var(--bg-hover)',
          active: 'var(--bg-active)',
          border: 'var(--border)',
          primary: 'var(--text-primary)',
          muted: 'var(--text-muted)',
          accent: 'var(--accent)',
          accentSoft: 'var(--accent-soft)',
          user: 'var(--user-bubble)',
          code: 'var(--code-bg)'
        }
      },
      boxShadow: {
        composer: '0 16px 42px var(--shadow-composer)',
        popover: '0 18px 50px var(--shadow-popover)'
      }
    }
  },
  plugins: []
};
