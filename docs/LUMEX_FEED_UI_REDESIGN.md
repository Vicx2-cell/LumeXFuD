# LumeX Feed UI Redesign

This is the live checklist for the `/feed` redesign. The aim is a polished, commerce-first social feed with a strong desktop shell, a serious mobile experience, and role-aware navigation.

## Checklist

### 1. Shell and framing

- [x] Replace the narrow centered feed container with a responsive application shell.
- [x] Add a sticky desktop left rail.
- [x] Add a sticky desktop discovery rail.
- [x] Keep the main feed column centered and readable.
- [x] Make the shell responsive across desktop, tablet, and mobile.

### 2. Navigation

- [x] Add role-aware LumeX navigation.
- [x] Show only real routes or clearly disabled placeholders.
- [x] Add a compact mobile top bar.
- [x] Add a mobile bottom navigation bar.
- [x] Add a composer shortcut that opens the existing composer.

### 3. Feed header and composer

- [x] Rework the feed header into a sticky, compact surface.
- [x] Preserve tabs, refresh, and role awareness.
- [x] Preserve the existing composer logic, uploads, retry, drafts, and publishing.
- [x] Make the composer feel native to the timeline instead of admin-like.

### 4. Post cards

- [x] Improve post density, hierarchy, and spacing.
- [x] Keep commerce actions obvious.
- [x] Preserve optimistic actions and rollback.
- [x] Keep counts, badges, sponsored labels, and interaction menus visible.
- [x] Remove prototype-like labels from normal user surfaces.

### 5. Discovery column

- [x] Add search entry points.
- [x] Add trending, deals, top vendors, and campus context panels.
- [x] Add Premium and boost upsell cards when enabled.
- [x] Keep empty states honest when live data is missing.

### 6. Mobile immersion

- [x] Make the mobile feed feel full-screen and media-forward.
- [x] Keep the main feed usable on small screens without desktop chrome.
- [x] Avoid horizontal overflow.

### 7. Accessibility and polish

- [x] Preserve keyboard and screen-reader access.
- [x] Maintain focus states and touch target sizing.
- [x] Respect reduced-motion preferences.
- [x] Keep contrast readable in dark and light themes.

### 8. Verification

- [x] Add or update feed UI tests where practical.
- [x] Run targeted lint on the feed surface.
- [x] Run targeted unit/integration tests for the affected feed helpers.
- [x] Run the repository test suite.
- [x] Run the production build.

## Notes

- The redesign keeps the existing feed APIs, ranking, attribution, Premium, and billing logic intact.
- Shell work stayed additive and preserved the existing composer, interactions, and data flow.
- Dead routes are shown only as disabled placeholders.
- The mobile immersive treatment is achieved through dense, edge-to-edge cards rather than a separate full-screen video mode toggle.
