# MUMS Settings Panel — Developer Guide
## Format Specification v1.0 (Mockup C "Precision Dark")

**Purpose:** This document defines the exact pattern for adding, modifying, or extending
the Main Settings modal. Any AI or developer MUST follow this spec — do NOT invent new
patterns or the layout will break.

---

## Architecture Overview

```
settingsModal (modal shell)
└── .ms-shell
    ├── .ms-topbar          ← header bar (fixed)
    └── .ms-body            ← two-column
        ├── .ms-sidenav     ← LEFT: list of settings (fixed width 224px)
        │   ├── .ms-search-bar
        │   └── .ms-nav-scroll
        │       ├── .ms-grp-label  (section header)
        │       └── button.ms-nav-item[data-panel="xxx"]  (nav row)
        └── .ms-content     ← RIGHT: parameter panel (flex 1)
            └── .ms-panel[id="msp_xxx"]  (one per nav item)
                ├── .ms-panel-hero    (icon + title + description)
                └── .ms-panel-body    (controls live here)
```

---

## How to Add a New Setting

### Step 1 — Add a nav row in LEFT SIDENAV (index.html)

Find the correct `<div class="ms-grp-label">` group and insert inside `.ms-nav-scroll`:

```html
<button class="ms-nav-item" id="msNav_YOURKEY" data-panel="YOURKEY" type="button">
  <span class="ms-ni-box">
    <!-- SVG icon 12×12 -->
  </span>
  <span class="ms-ni-text">
    <span class="ms-ni-name">Setting Name</span>
    <span class="ms-ni-sub">Short description</span>
  </span>
  <!-- Optional: live value badge (e.g. current state) -->
  <!-- <span class="ms-ni-kv" id="msYOURKEYTag">value</span> -->
</button>
```

**Rules:**
- `data-panel` MUST match the panel id: `msp_YOURKEY`
- `id="msNav_YOURKEY"` is optional but useful for JS access
- Icon: always `width="12" height="12"`, stroke-linecap="round"
- Sub text: max 4 words, no punctuation

---

### Step 2 — Add a panel in RIGHT CONTENT (index.html)

Inside `<div class="ms-content" id="msContent">`:

```html
<div class="ms-panel" id="msp_YOURKEY" data-panel="YOURKEY" style="display:none">

  <!-- HERO BAR — always required -->
  <div class="ms-panel-hero">
    <div class="ms-hero-icon">
      <!-- SVG icon 18×18 -->
    </div>
    <div class="ms-hero-text">
      <div class="ms-hero-title">Setting Name</div>
      <div class="ms-hero-desc">One sentence description of what this controls.</div>
    </div>
  </div>

  <!-- PANEL BODY — put controls here -->
  <div class="ms-panel-body">

    <!-- Option A: Opens a sub-modal (use for complex settings) -->
    <button class="ms-action-btn" id="openYOURKEYBtn" type="button">
      <span>Open Settings</span>
      <svg width="12" height="12" ...chevron right svg...</svg>
    </button>

    <!-- Option B: Inline controls (use for simple toggles/sliders) -->
    <div class="ms-ctrl-group">
      <div class="ms-ctrl-group-label">Group Label</div>

      <!-- Toggle row -->
      <div class="ms-ctrl-row">
        <div class="ms-ctrl-label">
          <div class="ms-ctrl-name">Option label</div>
          <div class="ms-ctrl-hint">Helper text explaining the option.</div>
        </div>
        <div class="ms-ctrl-control">
          <label class="ms-toggle-wrap">
            <input type="checkbox" id="myToggleId" class="ms-toggle-input" />
            <span class="ms-toggle-track"><span class="ms-toggle-thumb"></span></span>
          </label>
        </div>
      </div>

      <!-- Slider row -->
      <div class="ms-ctrl-row">
        <div class="ms-ctrl-label">
          <div class="ms-ctrl-name">Slider label</div>
          <div class="ms-ctrl-hint">Range and behavior description.</div>
        </div>
        <div class="ms-ctrl-control ms-ctrl-slider-wrap">
          <span class="ms-slider-dim"><!-- dim SVG --></span>
          <input type="range" id="myRangeId" class="ms-slider" min="0" max="100" value="50" />
          <span class="ms-slider-bright"><!-- bright SVG --></span>
          <span class="ms-slider-val" id="myRangeValId">50%</span>
        </div>
      </div>

    </div><!-- /ms-ctrl-group -->

    <!-- Optional: status bar at bottom -->
    <div class="ms-status-bar">
      <span class="ms-status-dot"></span>
      <span class="ms-status-text">Status message here</span>
    </div>

  </div><!-- /ms-panel-body -->
</div><!-- /ms-panel -->
```

---

### Step 3 — Wire the JS (public/js/app.js)

Inside `window.initMainSettings` → `_bindMsNav()` → `subModal` object, add if panel opens sub-modal:

```js
YOURKEY: function(){
  try{
    UI.closeModal('settingsModal');
    UI.openModal('yourModalId');
    // any init call
  }catch(_){}
},
```

If it's an **inline control** (no sub-modal), wire it separately using `wire()`:

```js
wire('openYOURKEYBtn', function(){
  try{ /* your action */ }catch(_){}
});
```

For **live badge** updates (showing current value in nav), update `_syncMsBrightnessBadge`
pattern — add a sync call inside `window.initMainSettings`.

---

## Admin-only Settings

Add `class="ms-admin-section"` to BOTH the nav item AND the panel.

Admin items are automatically shown/hidden based on `user.role` in `initMainSettings`.

Roles that see admin: `SUPER_ADMIN`, `SUPER_USER`, `ADMIN`

```html
<!-- Nav -->
<button class="ms-nav-item ms-admin-section" data-panel="YOURKEY" ...>

<!-- Panel -->
<div class="ms-panel ms-admin-section" id="msp_YOURKEY" ...>
  <div class="ms-panel-hero">
    <!-- Use admin icon style -->
    <div class="ms-hero-icon ms-hero-icon--admin">...</div>
```

---

## CSS Classes Reference

| Class | Purpose |
|---|---|
| `.ms-shell` | Modal root — 2-col layout container |
| `.ms-topbar` | Fixed top bar |
| `.ms-sidenav` | Left nav column (224px fixed) |
| `.ms-grp-label` | Section header with auto divider line |
| `.ms-nav-item` | Nav button row — add `ms-active` to select |
| `.ms-nav-item.ms-active` | Selected state (set by JS, never hardcode) |
| `.ms-ni-box` | Small icon container in nav row |
| `.ms-ni-name` | Nav item primary label |
| `.ms-ni-sub` | Nav item secondary label |
| `.ms-ni-kv` | Live value badge (accent chip) |
| `.ms-content` | Right panel host |
| `.ms-panel` | Individual setting panel — start with `display:none` |
| `.ms-panel-hero` | Top bar with icon + title + desc |
| `.ms-hero-icon` | Panel icon (blue accent) |
| `.ms-hero-icon--admin` | Admin panel icon (amber accent) |
| `.ms-panel-body` | Scrollable content area |
| `.ms-ctrl-group` | Bordered card grouping controls |
| `.ms-ctrl-group-label` | Label inside ctrl-group header |
| `.ms-ctrl-row` | Single control row (label + control) |
| `.ms-ctrl-label` | Left side: name + hint |
| `.ms-ctrl-name` | Primary label text |
| `.ms-ctrl-hint` | Muted helper text below name |
| `.ms-ctrl-control` | Right side: the actual input |
| `.ms-ctrl-slider-wrap` | Flex container for slider + icons + value |
| `.ms-slider` | Range input with branded thumb |
| `.ms-slider-dim` | Left icon (dim state) |
| `.ms-slider-bright` | Right icon (bright state) |
| `.ms-slider-val` | Live value display |
| `.ms-toggle-wrap` | Label wrapper for toggle |
| `.ms-toggle-input` | Hidden checkbox input |
| `.ms-toggle-track` | Toggle visual track |
| `.ms-toggle-thumb` | Toggle knob |
| `.ms-action-btn` | Blue CTA button (full width) |
| `.ms-action-btn--secondary` | Gray secondary button |
| `.ms-status-bar` | Status strip at panel bottom |
| `.ms-status-dot` | Green dot indicator |
| `.ms-admin-section` | Marks element as admin-only |

---

## DO NOT

- Do NOT add `stngs-tile`, `stngs-row`, `stngs-panel` elements — those are deprecated
- Do NOT add more columns — layout is strictly 2-column (nav + panel)
- Do NOT add panels without hero bars — every panel needs `.ms-panel-hero`
- Do NOT hardcode `display:block` on panels — JS controls visibility via `.ms-active`
- Do NOT duplicate `data-panel` values — each must be unique
- Do NOT skip the `id="msp_YOURKEY"` — JS uses it to show/hide panels
- Do NOT add settings directly inside nav groups without a matching panel

---

## Section Groups (Current)

```
Personal      → profile, notifications, theme, cursor
Workspace     → sidebar, links, clocks, data, bottombars
Display       → brightness
Admin Controls → mailboxtime, systemcheck, globalqb, calendar, loginmode
```

To add a new section group, add a `<div class="ms-grp-label">New Group</div>` in `.ms-nav-scroll`.
