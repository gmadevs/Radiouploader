<script setup lang="ts">
import { useData, withBase } from 'vitepress'

/**
 * The installers, on the home page under the hero.
 *
 * The version and the filenames are not written here: they come from
 * `scripts/downloads.mjs` through `themeConfig.downloads`, which is the same
 * source the README's buttons are generated from. Typing a version into a
 * template is how a front page ends up offering a release that no longer
 * exists.
 */
const { theme } = useData()
const downloads = theme.value.downloads
</script>

<template>
  <div class="downloads">
    <div class="container">
      <div class="downloads-head">
        <h2>Download</h2>
        <span class="version">v{{ downloads.version }}</span>
        <span class="pre">pre-release</span>
      </div>

      <div class="cards">
        <a
          v-for="p in downloads.platforms"
          :key="p.id"
          class="card"
          :class="p.id"
          :href="p.primary.url"
        >
          <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
            <template v-if="p.id === 'mac'">
              <rect x="3" y="6" width="26" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M3 12h26" stroke="currentColor" stroke-width="2" />
              <circle cx="7.5" cy="9" r="1.1" fill="currentColor" />
              <circle cx="11.5" cy="9" r="1.1" fill="currentColor" />
              <circle cx="15.5" cy="9" r="1.1" fill="currentColor" />
            </template>
            <template v-else-if="p.id === 'windows'">
              <rect x="4" y="5" width="11" height="11" rx="1.5" fill="currentColor" />
              <rect x="17" y="5" width="11" height="11" rx="1.5" fill="currentColor" />
              <rect x="4" y="18" width="11" height="11" rx="1.5" fill="currentColor" />
              <rect x="17" y="18" width="11" height="11" rx="1.5" fill="currentColor" />
            </template>
            <template v-else>
              <ellipse cx="10.8" cy="28.4" rx="4.2" ry="2.2" fill="currentColor" />
              <ellipse cx="21.2" cy="28.4" rx="4.2" ry="2.2" fill="currentColor" />
              <ellipse cx="16" cy="19" rx="7.6" ry="8.2" fill="currentColor" />
              <circle cx="16" cy="8.6" r="5.8" fill="currentColor" />
              <ellipse cx="16" cy="21" rx="4.4" ry="5.6" fill="var(--card-bg)" />
              <circle cx="13.7" cy="8" r="1.5" fill="var(--card-bg)" />
              <circle cx="18.3" cy="8" r="1.5" fill="var(--card-bg)" />
              <path d="M16 10.2l2.3 2.1-2.3 1.7-2.3-1.7z" fill="var(--card-bg)" />
            </template>
          </svg>

          <div class="name">{{ p.name }}</div>
          <div class="primary">{{ p.primary.label }} <span class="kind">{{ p.primary.kind }}</span></div>
          <div class="first">{{ p.first }}</div>
        </a>
      </div>

      <p class="others">
        <template v-for="p in downloads.platforms.filter((x) => x.others.length)" :key="p.id">
          <span class="group">
            <strong>{{ p.name }}</strong>
            <template v-for="(o, i) in p.others" :key="o.url">
              <span v-if="i"> · </span>
              <a :href="o.url">{{ o.label }}</a>
            </template>
          </span>
        </template>
      </p>

      <p class="note">
        Nothing is signed yet, so the first launch needs one extra step per platform —
        <a :href="withBase('/guide/install')">install and sign in</a> has all three, and what
        to read before pointing it at a study you care about. Older versions are on the
        <a :href="downloads.releases">releases page</a>.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* The hero's own padding, so the cards line up with the tagline above them
   rather than sitting inset from it. */
.downloads {
  padding: 0 24px 32px;
}

.downloads .container {
  max-width: 1152px;
  margin: 0 auto;
}

@media (min-width: 640px) {
  .downloads {
    padding: 0 48px 48px;
  }
}

@media (min-width: 960px) {
  .downloads {
    padding: 0 64px 64px;
  }
}

.downloads-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 20px;
}

.downloads-head h2 {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0;
  border: 0;
  padding: 0;
}

.version {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-brand-1);
}

.pre {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 1px 8px;
}

.cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 640px) {
  .cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

.card {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  /* The penguin's belly and eyes are painted with this, so it is a variable
     rather than a colour: they are holes in the mark, not white shapes. */
  --card-bg: var(--vp-c-bg-soft);
  background: var(--card-bg);
  padding: 18px 20px;
  transition: border-color 0.25s, background-color 0.25s;
}

.card:hover {
  border-color: var(--vp-c-brand-1);
  --card-bg: var(--vp-c-bg-elv);
}

.mark {
  width: 28px;
  height: 28px;
  display: block;
  margin-bottom: 10px;
}

.card.mac .mark {
  color: var(--vp-c-text-1);
}
.card.windows .mark {
  color: #3aa0ea;
}
.card.linux .mark {
  color: #f0b429;
}

.name {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.primary {
  font-size: 14px;
  color: var(--vp-c-brand-1);
  margin-top: 2px;
}

.kind {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.first {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  margin-top: 8px;
}

.others {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin: 14px 0 0;
}

.others strong {
  font-weight: 500;
  color: var(--vp-c-text-3);
  margin-right: 6px;
}

.others a,
.note a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.others a:hover,
.note a:hover {
  text-decoration: underline;
}

.note {
  font-size: 13px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 10px 0 0;
  max-width: 62ch;
}
</style>
