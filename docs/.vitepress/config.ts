import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

/**
 * Docs for Radiouploader, published to GitHub Pages.
 *
 * `base` is the repository name because the site is served from
 * gmadevs.github.io/Radiouploader rather than from a domain of its own.
 */
export default withMermaid(
  defineConfig({
    title: 'Radiouploader',
    description: 'Desktop uploader for Radiopaedia.org: DICOM ingest, anonymisation and case upload',
    base: '/Radiouploader/',
    lang: 'en',
    cleanUrls: true,
    lastUpdated: true,
    // The app is dark; screenshots of it sit better on a dark page.
    appearance: 'dark',

    head: [['link', { rel: 'icon', href: '/Radiouploader/favicon.png' }]],

    vite: {
      // Mermaid reaches for lodash-es a module at a time. Left to itself the
      // dev server serves each of those raw and the first one without a default
      // export takes the page down, so it is pre-bundled instead. The
      // production build never had the problem.
      optimizeDeps: { include: ['mermaid'] },
      ssr: { noExternal: ['mermaid'] }
    },

    themeConfig: {
      nav: [
        { text: 'Guide', link: '/guide/install' },
        { text: 'How it works', link: '/internals/architecture' },
        { text: 'Develop', link: '/develop/build' },
        { text: 'Limitations', link: '/limitations' }
      ],

      sidebar: [
        {
          text: 'Using it',
          items: [
            { text: 'Install and sign in', link: '/guide/install' },
            { text: 'Import a study', link: '/guide/import' },
            { text: 'Choose what to upload', link: '/guide/choose' },
            { text: 'Erase and set contrast', link: '/guide/review' },
            { text: 'Reformat, MIP and MinIP', link: '/guide/reformat' },
            { text: 'The check before anonymising', link: '/guide/check' },
            { text: 'Case details and upload', link: '/guide/upload' }
          ]
        },
        {
          text: 'How it works',
          items: [
            { text: 'Architecture', link: '/internals/architecture' },
            { text: 'Splitting before anonymisation', link: '/internals/splitting' },
            { text: 'Anonymisation and masks', link: '/internals/anonymisation' },
            { text: 'Why upload goes through S3', link: '/internals/upload' },
            { text: 'Quota and taxonomy', link: '/internals/quota' }
          ]
        },
        {
          text: 'Development',
          items: [
            { text: 'Build and run', link: '/develop/build' },
            { text: 'Packaging and release', link: '/develop/packaging' },
            { text: 'Screenshots', link: '/develop/screenshots' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'Known limitations', link: '/limitations' }
          ]
        }
      ],

      socialLinks: [{ icon: 'github', link: 'https://github.com/gmadevs/Radiouploader' }],

      search: { provider: 'local' },

      editLink: {
        pattern: 'https://github.com/gmadevs/Radiouploader/edit/main/docs/:path',
        text: 'Edit this page on GitHub'
      },

      footer: {
        message:
          'AGPL-3.0-only · Unofficial, not affiliated with or endorsed by Radiopaedia.org',
        copyright: '© Giorgio Maria Agazzi'
      }
    }
  })
)
