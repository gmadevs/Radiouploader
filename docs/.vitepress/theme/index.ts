import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import Downloads from './Downloads.vue'
import './downloads.css'

/**
 * The default theme with the installers added to the home page.
 *
 * `home-hero-after` is the slot immediately below the hero — under the
 * screenshot on the right, and under the buttons on the left — which is where
 * somebody who has just read the tagline is looking for a download.
 */
export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'home-hero-after': () => h(Downloads) })
}
