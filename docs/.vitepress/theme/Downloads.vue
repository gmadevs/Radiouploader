<script setup lang="ts">
import { ref } from 'vue'
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

/**
 * The two Homebrew lines, each with a button that copies it.
 *
 * Both, not just the install: the second one is what makes the app open at all,
 * and a command somebody retypes from a screen is a command they retype wrong.
 */
const brewLines: string[] = [downloads.brew, downloads.brewUnquarantine]

const copied = ref(-1)
const failed = ref(-1)
let clearing: ReturnType<typeof setTimeout> | undefined

async function copy(line: string, index: number): Promise<void> {
  clearTimeout(clearing)
  try {
    await navigator.clipboard.writeText(line)
    copied.value = index
    failed.value = -1
  } catch {
    // A browser can refuse the clipboard outright — an insecure context, or a
    // permission that was never granted. Saying so is better than a button that
    // looks like it worked and left the pasteboard alone.
    copied.value = -1
    failed.value = index
  }
  clearing = setTimeout(() => {
    copied.value = -1
    failed.value = -1
  }, 2400)
}
</script>

<template>
  <div class="downloads">
    <div class="container">
      <div class="downloads-head">
        <h2>Download</h2>
        <span class="version">v{{ downloads.version }}</span>
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

      <!-- The second line is not optional: Homebrew quarantines what it
           downloads and no longer offers a way not to, and this app is not
           signed. Both lines are offered the same way for that reason. -->
      <div class="brew">
        <span class="brew-label">🍺 macOS, with Homebrew</span>
        <div class="brew-lines">
          <div v-for="(line, i) in brewLines" :key="line" class="brew-line">
            <code>{{ line }}</code>
            <button
              class="copy"
              :class="{ done: copied === i, failed: failed === i }"
              :aria-label="`Copy: ${line}`"
              @click="copy(line, i)"
            >
              {{ copied === i ? 'Copied' : failed === i ? 'Copy it by hand' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>

      <p class="note">
        Nothing is signed, so the first launch needs one extra step per platform —
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

.brew {
  display: grid;
  gap: 10px;
  margin: 18px 0 0;
  font-size: 15px;
  color: var(--vp-c-text-2);
}
.brew-label {
  font-weight: 500;
}
.brew-lines {
  display: grid;
  gap: 8px;
}
.brew-line {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px 9px 13px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}
.brew-line code {
  flex: 1;
  min-width: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--vp-c-text-1);
  /* The command is long and the pane is not: it wraps rather than pushing the
     cards' column wider on a phone. */
  overflow-wrap: anywhere;
}
.copy {
  flex: none;
  font-size: 12.5px;
  line-height: 1.4;
  padding: 4px 11px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.copy:hover,
.copy.done {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.copy.failed {
  color: var(--vp-c-danger-1);
  border-color: var(--vp-c-danger-1);
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
