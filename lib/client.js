/**
 * workspace-persona — client half (v2: many personas, each with its own scope).
 *
 * Hand-written `__ModuleLoader__` module (no build step). It mounts the
 * `agentPersona` Remote namespace and registers one `settings.section` page
 * (Settings → Agent人设).
 *
 * Layout contract (the settings dialog hands a section ~556px, so):
 *   - ONE full-width column, `max-width: 860px`; no side rail.
 *   - personas are an accordion of cards: a collapsed card is one 40px row, so a
 *     long list stays scannable, and exactly one card is expanded for editing.
 *   - an expanded card is name + enable + targets editor + body editor + AI
 *     tuning + save/delete footer.
 *   - scope rows pick a workspace or a session from a dropdown (filled by the
 *     host's `listTargets`), so nobody has to type a cwd or a raw session id;
 *     the two kinds are mutually exclusive per row, and "自己输入…" keeps the
 *     advanced match modes reachable.
 *
 * Visual language follows the shipped settings pages: 13px/550 titles, 11-12px
 * muted meta, 8px radii, `--dsw-alias-*` tokens where a surface must match the
 * shell, `rgba(128,128,128,α)` grays that survive both palettes, cursor:pointer,
 * 150ms transitions, visible focus rings, tabular numerals, reduced-motion.
 *
 * Robustness: a slot entry whose component throws is ABDICATED for the page's
 * lifetime (its cell then renders `data-slot-error`), so this page is a CLASS
 * component whose render path cannot throw, and it reads the Remote service from
 * a registration-time capture because slot `inject` props are not guaranteed.
 */

window.__ModuleLoader__.load({
  id: 'dsh-agent-persona',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const {
      Button,
      DisclosureRow,
      Input,
      MarkdownText,
      Menu,
      Modal,
      Toast,
      Pill,
      Tooltip,
      IconCheckOutline14,
      IconChevronDownOutline14,
      IconChevronRightOutline14,
      IconAgentPresetOutline16,
      IconBrowseOutline16,
      IconChevronUpOutline14,
      IconCloseOutline16,
      IconEditOutline16,
      IconEllipsisOutline16,
      IconEnhanceOutline16,
      IconFolderOpen16,
      IconListPenOutline16,
      IconPersonalizationOutline16,
      IconRefreshOutline16,
      IconUserOutline16,
      IconWarningOutline16,
      IconPlusOutline16,
      IconTrashOutline16,
    } = primitives

    const NS = 'agent-persona'
    /** ⌘ on Apple hardware, Ctrl elsewhere — shown next to the save button. */
    const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent ?? '') ? '⌘' : 'Ctrl+'

    /** Static copy: rendered before any host call resolves. */
    const DESCRIPTION = '给不同的工作区、不同的会话用不同的人设。人设会作为系统提示词注入，优先级高于工作区里的 AGENTS.md。'
    /** Style + DOM scope. The package name, so the CSS and the root agree. */
    const SCOPE = 'dsh-agent-persona'

    const KIND_LABEL = { workspace: '工作区', sessionId: '会话' }
    const MATCH_LABEL = { exact: '完全一致', prefix: '开头是', regex: '正则匹配', contains: '包含' }
    const MODES = [
      { value: 'polish', label: '润色' },
      { value: 'expand', label: '补充细节' },
      { value: 'compress', label: '精简' },
      { value: 'draft', label: '按描述生成' },
    ]
    // ── Remote descriptor (strict codecs, hand-written validators) ──────────

    const codec = (typeSymbol, parse) => ({
      mode: 'strict',
      typeSymbol: `dsh-agent-persona#${typeSymbol}`,
      schema: { parse },
    })
    const passthrough = (value) => value
    const asInput = (value) => {
      if (value === undefined || value === null) return {}
      if (typeof value !== 'object' || Array.isArray(value)) throw new Error('input must be an object')
      return value
    }
    const method = (name, parameters) => ({
      id: `dsh-agent-persona#agentPersona/${name}`,
      service: 'agentPersona',
      namespace: 'agentPersona',
      method: name,
      invocation: { kind: 'direct' },
      parameters,
      result: { mode: 'strict', typeSymbol: 'dsh-agent-persona#View', schema: { parse: passthrough } },
    })
    /** The Connection RPC channel this half calls; see the DSH plugin standard. */
    const RPC_CHANNEL = '/agent-persona'

    /**
     * Every host method, reached over Connection RPC: a channel string, an endpoint name
     * and a JSON payload. No typert markers, no hand-written invocations manifest — those
     * depend on both halves loading the same module instance and break for an npm-installed
     * plugin. The envelope is the same shape the gateway used: `{ok, value}` / `{ok, error}`.
     */
    const withInput = () => [{ name: 'input', wire: 'input', source: 'json', codec: codec('Input', asInput) }]

    const TYPERT_REMOTE = {
      package: 'dsh-agent-persona',
      descriptors: [
        method('listPersonas', []),
        method('savePersona', withInput()),
        method('deletePersona', withInput()),
        method('movePersona', withInput()),
        method('duplicatePersona', withInput()),
        method('reorderPersona', withInput()),
        method('listTargets', []),
        method('sessionHistory', withInput()),
        method('sessionPrompt', withInput()),
        method('tunePersona', withInput()),
        method('listModels', []),
      ],
    }
    // ── styles ──────────────────────────────────────────────────────────────

    const CSS = `
[data-plugin="dsh-agent-persona"] {
  --wsp-line: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  --wsp-line-soft: rgba(128, 128, 128, 0.14);
  --wsp-line-strong: var(--dsw-alias-border-l3, rgba(128, 128, 128, 0.4));
  --wsp-text: var(--dsw-alias-label-primary, inherit);
  --wsp-muted: var(--dsw-alias-label-tertiary, rgba(128, 128, 128, 0.85));
  --wsp-muted-2: var(--dsw-alias-label-caption, rgba(128, 128, 128, 0.62));
  --wsp-accent: var(--dsw-alias-brand-primary, #58a6ff);
  --wsp-success: var(--dsw-alias-state-success-primary, #3fb950);
  --wsp-danger: var(--dsw-alias-state-error-primary, #f85149);
  --wsp-warn: var(--dsw-alias-state-warn-primary, #d29922);
  --wsp-surface: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.04));
  --wsp-surface-2: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  --wsp-surface-3: var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.12));
  --wsp-hover: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));
  --wsp-active: var(--dsw-alias-interactive-bg-active, rgba(128, 128, 128, 0.16));
  --wsp-card-shadow: var(--dsw-shadow-lv3, 0 2px 10px rgba(0, 0, 0, 0.10), 0 1px 2px rgba(0, 0, 0, 0.06));
  --wsp-radius: 8px;
  --wsp-radius-sm: 6px;
  --wsp-mono: var(--dsw-font-markdown-code-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  display: flex; flex-direction: column; gap: 14px;
  width: 100%; max-width: 860px; min-width: 0;
  color: var(--wsp-text); -webkit-font-smoothing: antialiased;
}

.wsp-head { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 2px; }
.wsp-title { font-size: 18px; font-weight: 600; letter-spacing: -0.012em; line-height: 1.3; margin: 0; }
.wsp-sub { font-size: 13px; line-height: 1.65; color: var(--wsp-muted); text-wrap: pretty; max-width: 72ch; margin: 0; }
.wsp-meta { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; font-size: 11.5px; color: var(--wsp-muted-2); margin-top: 2px; }
.wsp-meta code { font-family: var(--wsp-mono); font-size: 11px; }
.wsp-sep { opacity: 0.45; }
.wsp-spacer { flex: 1; min-width: 6px; }

.wsp-badge { font-size: 10.5px; line-height: 1.6; padding: 0 7px; border-radius: 999px; border: 1px solid var(--wsp-line); color: var(--wsp-muted); white-space: nowrap; }
.wsp-badge-on { color: var(--wsp-success); border-color: color-mix(in srgb, var(--wsp-success) 40%, transparent); }
.wsp-badge-warn { color: var(--wsp-warn); border-color: color-mix(in srgb, var(--wsp-warn) 40%, transparent); }
.wsp-badge-off { opacity: 0.7; border-style: dashed; }
.wsp-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: rgba(128, 128, 128, 0.4); }
.wsp-dot-on { background: var(--wsp-success); }
.wsp-dot-empty { background: var(--wsp-warn); }
.wsp-idx { font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--wsp-muted-2); min-width: 14px; text-align: right; }

/* ── cards: macOS-ish — soft radii, hairline border, a gentle lift ─────── */
.wsp-cards { display: flex; flex-direction: column; gap: 10px; }
.wsp-card {
  border: 1px solid var(--wsp-line);
  border-radius: 12px;
  background: var(--wsp-surface);
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.03);
  transition: box-shadow 150ms ease, border-color 150ms ease;
}
/* The whole collapsed card is the hover target: background and border follow the
   card's own 12px corners, instead of a second rounded box drawn inside it. */
.wsp-card:not(.wsp-card-open):hover { border-color: var(--wsp-line-strong); background: var(--wsp-surface-2); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06); }
.wsp-card-open { border-color: var(--wsp-line-strong); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.09), 0 1px 2px rgba(0, 0, 0, 0.04); }
.wsp-row-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px 3px; min-height: 44px; box-sizing: border-box; flex-wrap: wrap; border-radius: 12px 12px 0 0; }
.wsp-row-click { cursor: pointer; }
.wsp-row-click:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: -2px; }
.wsp-dragging { opacity: 0.55; }
.wsp-drop-before { box-shadow: 0 -2px 0 0 var(--wsp-accent); }
.wsp-drop-after { box-shadow: 0 2px 0 0 var(--wsp-accent); }
.wsp-chevron {
  flex: none; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px; background: transparent; color: var(--wsp-muted); cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}
.wsp-chevron:hover { background: var(--wsp-surface-2); color: var(--wsp-text); }
.wsp-chevron:active { cursor: grabbing; }
.wsp-chevron[draggable="true"] { cursor: grab; }
.wsp-chevron:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: 1px; }
.wsp-pname { font-size: 13px; font-weight: 600; letter-spacing: -0.005em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.wsp-chip { font-size: 10.5px; line-height: 1.7; padding: 0 7px; border-radius: 999px; background: var(--wsp-surface-3); color: var(--wsp-muted); font-family: var(--wsp-mono); max-width: 210px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsp-card-body { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 14px; border-top: 1px solid var(--wsp-line-soft); background: var(--wsp-surface); border-radius: 0 0 12px 12px; }
.wsp-filter-note { font-size: 11px; color: var(--wsp-muted-2); }
.wsp-search { display: flex; align-items: center; gap: 8px; }
.wsp-search > *:first-child { flex: 1; }
.wsp-conflict-notice { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--wsp-warn); padding: 6px 9px; border: 1px solid color-mix(in srgb, var(--wsp-warn) 35%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--wsp-warn) 8%, transparent); }
.wsp-kbd { font: inherit; font-size: 10.5px; line-height: 1.6; padding: 0 5px; border: 1px solid var(--wsp-line-strong); border-bottom-width: 2px; border-radius: 5px; color: var(--wsp-muted-2); }
.wsp-add-row {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px; border: 1px dashed var(--wsp-line-strong); border-radius: 12px;
  color: var(--wsp-muted); font-size: 12.5px; cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
}
.wsp-add-row:hover { border-color: var(--wsp-accent); color: var(--wsp-text); background: var(--wsp-surface); }
.wsp-add-row:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: 2px; }
.wsp-empty-card { border: 1px dashed var(--wsp-line-strong); border-radius: 12px; padding: 16px; text-align: center; color: var(--wsp-muted); font-size: 12px; display: flex; flex-direction: column; gap: 10px; align-items: center; }

/* ── fields ────────────────────────────────────────────────────────────── */
.wsp-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.wsp-field-row { display: flex; align-items: flex-end; gap: 8px; min-width: 0; }
.wsp-label { font-size: 11px; color: var(--wsp-muted); white-space: nowrap; }
.wsp-hint { font-size: 11px; line-height: 1.55; color: var(--wsp-muted-2); }
.wsp-warn { color: var(--wsp-warn); }
.wsp-sect-title { font-size: 11.5px; font-weight: 550; color: var(--wsp-muted); display: flex; align-items: center; gap: 6px; }
.wsp-group { display: flex; flex-direction: column; gap: 7px; padding: 9px 10px; border: 1px solid var(--wsp-line-soft); border-radius: var(--wsp-radius-sm); }
.wsp-input { width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: var(--wsp-radius-sm); border: 1px solid var(--wsp-line); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; font-size: 12px; }
.wsp-input:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: -1px; }
.wsp-input-mono { font-family: var(--wsp-mono); font-size: 11.5px; }
.wsp-input-invalid { border-color: var(--wsp-danger); }
.wsp-select { padding: 5px 7px; border-radius: var(--wsp-radius-sm); border: 1px solid var(--wsp-line); background: var(--dsw-alias-bg-base, transparent); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.wsp-select:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: -1px; }
/* ── scope rows: a segmented type switch plus a real picker ───────────── */
.wsp-scope-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.wsp-scope-row > span { flex: 1 1 190px; min-width: 0; }
.wsp-kind { display: inline-flex; flex: none; gap: 4px; }
.wsp-picker {
  width: 100%; min-width: 0; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 9px; border: 1px solid var(--wsp-line); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, transparent); color: inherit;
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}
.wsp-picker:hover { border-color: var(--wsp-line-strong); background: var(--wsp-surface-2); }
.wsp-picker:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: -1px; }
.wsp-picker-empty { color: var(--wsp-muted-2); }
.wsp-picker-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsp-scope-value { flex: 1 1 200px; }
.wsp-scope-match { flex: none; width: 96px; }
.wsp-scope-context { flex-basis: 100%; font-size: 10.5px; color: var(--wsp-muted-2); font-family: var(--wsp-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 2px; }
.wsp-icon-btn { border: 1px solid transparent; background: transparent; color: var(--wsp-muted); border-radius: 6px; cursor: pointer; padding: 4px 6px; min-width: 28px; min-height: 28px; justify-content: center; display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 11.5px; line-height: 1.2; }
.wsp-icon-btn:hover { background: var(--wsp-surface-2); color: var(--wsp-text); }
.wsp-icon-btn:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: 1px; }
.wsp-icon-btn:disabled { opacity: 0.4; cursor: default; }
.wsp-icon-btn-danger:hover { color: var(--wsp-danger); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(248, 81, 73, 0.1)); }

/* ── switch ────────────────────────────────────────────────────────────── */
.wsp-switch { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; }
.wsp-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.wsp-switch-track { position: relative; width: 30px; height: 18px; border-radius: 999px; background: rgba(128, 128, 128, 0.3); transition: background 150ms ease; flex: none; }
.wsp-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); transition: transform 150ms ease; }
.wsp-switch input:checked + .wsp-switch-track { background: var(--wsp-success); }
.wsp-switch input:checked + .wsp-switch-track::after { transform: translateX(12px); }
.wsp-switch input:focus-visible + .wsp-switch-track { outline: 2px solid var(--wsp-accent); outline-offset: 2px; }
.wsp-switch-text { font-size: 11.5px; color: var(--wsp-muted); }

/* ── editor / preview ──────────────────────────────────────────────────── */
.wsp-editor { border: 1px solid var(--wsp-line); border-radius: var(--wsp-radius-sm); background: var(--dsw-alias-bg-base, transparent); overflow: hidden; }
.wsp-textarea { display: block; width: 100%; box-sizing: border-box; min-height: 240px; max-height: 46vh; resize: vertical; padding: 11px 12px; border: 0; outline: none; background: transparent; color: inherit; font-family: var(--wsp-mono); font-size: 12.5px; line-height: 1.7; tab-size: 2; }
.wsp-textarea::placeholder { color: var(--wsp-muted-2); }
.wsp-textarea:focus-visible { box-shadow: inset 0 0 0 2px var(--wsp-accent); }
.wsp-preview { min-height: 240px; max-height: 46vh; overflow: auto; padding: 11px 13px; font-size: 13px; line-height: 1.7; }
.wsp-preview-empty { color: var(--wsp-muted-2); font-size: 12px; }

/* ── footer / status / tuning ──────────────────────────────────────────── */
.wsp-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--wsp-line-soft); padding-top: 10px; }
.wsp-caption { font-size: 11px; color: var(--wsp-muted-2); font-variant-numeric: tabular-nums; }
.wsp-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.wsp-tune-fields { display: flex; flex-direction: column; gap: 9px; }
.wsp-proposal { border: 1px dashed var(--wsp-line-strong); border-radius: var(--wsp-radius-sm); padding: 10px 11px; display: flex; flex-direction: column; gap: 8px; }
.wsp-proposal-body { max-height: 32vh; overflow: auto; font-size: 12.5px; line-height: 1.7; border-top: 1px solid var(--wsp-line-soft); padding-top: 8px; }
/* Menus portal to <body>: global on purpose, and widened — the default card is
   far too narrow for "N 次对话 · id · 4 小时前" beside a title. */
.wsp-menu { min-width: 460px !important; max-width: min(600px, 92vw) !important; }
.wsp-opt-turns { color: var(--wsp-muted); }
.wsp-menu-tip { display: inline-block; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.wsp-opt { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.wsp-opt-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsp-opt-owner { flex: none; font-size: 10.5px; color: var(--wsp-warn); }
.wsp-opt-id { flex: none; font-family: var(--wsp-mono); font-size: 10.5px; color: var(--wsp-muted-2); padding-left: 10px; }
.wsp-skeleton { display: inline-block; border-radius: 6px; background: var(--wsp-surface-2); }
.wsp-skeleton-chevron { width: 22px; height: 22px; }
.wsp-skeleton-name { width: 120px; height: 13px; }
.wsp-skeleton-chip { width: 180px; height: 12px; margin-left: auto; }
@keyframes wsp-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
.wsp-skeleton { animation: wsp-pulse 1.4s ease-in-out infinite; }
.wsp-scope-lines { display: flex; flex-direction: column; gap: 4px; padding: 0 12px 10px 40px; }
.wsp-scope-line { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.wsp-scope-label { flex: none; font-size: 10.5px; color: var(--wsp-muted-2); }
/* The dialog portals to <body>, so these rules are global on purpose and carry
   their own copies of the plugin variables (the scoped ones do not reach it). */
.wsp-chat-modal {
  --wsp-line: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  --wsp-line-soft: rgba(128, 128, 128, 0.14);
  --wsp-text: var(--dsw-alias-label-primary, inherit);
  --wsp-muted-2: var(--dsw-alias-label-caption, rgba(128, 128, 128, 0.62));
  --wsp-success: var(--dsw-alias-state-success-primary, #3fb950);
  --wsp-surface-2: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.08));
  --wsp-mono: var(--dsw-font-markdown-code-font-family, ui-monospace, Menlo, monospace);
  width: min(980px, 94vw) !important;
  max-width: min(980px, 94vw) !important;
}
.wsp-chat-content { max-width: none !important; width: 100% !important; }
.wsp-view { display: flex; flex-direction: column; gap: 18px; padding: 24px 28px 32px; overflow: auto; height: 100%; box-sizing: border-box; }
.wsp-view-head { display: flex; align-items: flex-start; gap: 16px; max-width: 1040px; width: 100%; margin: 0 auto; }
.wsp-view-headtext { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wsp-view-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; color: var(--wsp-text); }
.wsp-view-lead { margin: 0; font-size: 13px; line-height: 1.6; color: var(--wsp-muted); max-width: 68ch; }
.wsp-view-headactions { margin-left: auto; display: flex; gap: 8px; }
/* Tabs live on top, and the active one is a colour + underline (ux: Active State). */
.wsp-tabs { display: flex; align-items: flex-end; gap: 4px; max-width: 1040px; width: 100%; margin: 0 auto -1px; }
.wsp-tab { padding: 7px 18px 8px; border: 1px solid var(--wsp-line); border-bottom: 0; border-radius: 10px 10px 0 0; background: var(--wsp-surface-3); font: inherit; font-size: 13px; color: var(--wsp-muted); cursor: pointer; transition: color 150ms ease, background 150ms ease, border-color 150ms ease; }
.wsp-tab:hover { color: var(--wsp-text); background: var(--wsp-hover); }
.wsp-tab:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: -2px; }
/* The selected tab joins the card below it and carries an accent bar across its top. */
.wsp-tab-on { border-color: color-mix(in srgb, var(--wsp-accent) 45%, var(--wsp-line-strong)); background: var(--wsp-surface-2); color: var(--wsp-accent); font-weight: 600; box-shadow: inset 0 3px 0 0 var(--wsp-accent); }
.wsp-panel-area { max-width: 1040px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.wsp-card-panel { display: flex; flex-direction: column; gap: 14px; padding: 0 20px 20px; border: 1px solid color-mix(in srgb, var(--wsp-accent) 32%, var(--wsp-line-strong)); border-radius: 14px; background: var(--wsp-surface-2); box-shadow: 0 6px 22px rgba(0, 0, 0, 0.16); overflow: hidden; transition: box-shadow 200ms ease, border-color 200ms ease; }
.wsp-card-panel:hover { border-color: color-mix(in srgb, var(--wsp-accent) 52%, var(--wsp-line-strong)); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.20); }
.wsp-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 -20px; padding: 12px 20px; border-bottom: 1px solid var(--wsp-line-soft); background: var(--wsp-surface-3); }
.wsp-card-title { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--wsp-text); }
.wsp-card-title::before { content: ''; display: inline-block; width: 3px; height: 13px; margin-right: 8px; border-radius: 2px; background: var(--wsp-accent); vertical-align: -1px; }
.wsp-card-meta { font-size: 11.5px; color: var(--wsp-muted-2); font-variant-numeric: tabular-nums; }
.wsp-card-note { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--wsp-muted); max-width: 74ch; }
.wsp-grow { flex: 1 1 auto; }
.wsp-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wsp-prose { font-size: 13px; line-height: 1.75; color: var(--wsp-text); }
.wsp-prose-scroll { max-height: 58vh; overflow: auto; padding-right: 4px; }
.wsp-source { margin: 0; padding: 14px 16px; border: 1px solid var(--wsp-line-soft); border-radius: 10px; background: var(--wsp-surface-3); font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 12px; line-height: 1.7; color: var(--wsp-text); white-space: pre-wrap; word-break: break-word; max-height: 58vh; overflow: auto; }
.wsp-switch { display: flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--wsp-line); border-radius: 9px; background: var(--wsp-surface); }
.wsp-switch-item { border: 0; border-radius: 7px; background: none; font: inherit; font-size: 12px; padding: 3px 10px; color: var(--wsp-muted); cursor: pointer; transition: background 150ms ease, color 150ms ease; }
.wsp-switch-item:hover { color: var(--wsp-text); }
.wsp-switch-on { background: var(--wsp-surface-3); color: var(--wsp-text); box-shadow: var(--wsp-card-shadow); font-weight: 500; }
.wsp-form { display: flex; flex-direction: column; gap: 14px; }
.wsp-field { display: flex; flex-direction: column; gap: 6px; }
.wsp-field-label { font-size: 12px; font-weight: 500; color: var(--wsp-muted); }
.wsp-field-hint { font-size: 12px; color: var(--wsp-muted-2); }
.wsp-seg { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wsp-form-text { width: 100%; min-height: 280px; resize: vertical; box-sizing: border-box; padding: 12px 14px; border: 1px solid var(--wsp-line); border-radius: 10px; font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace); font-size: 12.5px; line-height: 1.7; color: var(--wsp-text); background: var(--wsp-surface); transition: border-color 150ms ease; }
.wsp-form-text:focus-visible { outline: 2px solid var(--wsp-accent); outline-offset: 1px; }
.wsp-form-actions { display: flex; align-items: center; gap: 8px; }
.wsp-alert { display: flex; align-items: center; gap: 8px; max-width: 1040px; width: 100%; margin: 0 auto; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--wsp-danger, #f85149) 40%, transparent); border-radius: 10px; font-size: 12.5px; color: var(--wsp-text); background: color-mix(in srgb, var(--wsp-danger, #f85149) 8%, transparent); box-sizing: border-box; }
.wsp-skel { display: flex; flex-direction: column; gap: 10px; }
.wsp-skel-line { height: 12px; border-radius: 6px; background: var(--wsp-surface-2); animation: wsp-pulse 1.4s ease-in-out infinite; }
@keyframes wsp-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.wsp-view button, .wsp-view [role="button"] { cursor: pointer; }
.wsp-view textarea, .wsp-view input { cursor: text; }
@media (max-width: 640px) {
  .wsp-view { padding: 16px 14px 24px; gap: 14px; }
  .wsp-view-head { flex-direction: column; gap: 10px; }
  .wsp-view-headactions { margin-left: 0; }
  .wsp-view-lead { font-size: 12.5px; }
  .wsp-tabs { overflow-x: auto; padding-bottom: 0; }
  .wsp-tab { flex: none; padding: 6px 14px 7px; }
  .wsp-card-panel { padding: 0 14px 16px; border-radius: 12px; }
  .wsp-card-head { margin: 0 -14px; padding: 10px 14px; }
  .wsp-card-title { font-size: 14px; }
  .wsp-card-note, .wsp-prose { max-width: none; }
  .wsp-prose-scroll, .wsp-source { max-height: 62vh; }
  .wsp-form-text { min-height: 200px; font-size: 12px; }
  .wsp-form-actions { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { .wsp-skel-line { animation: none; } .wsp-tab, .wsp-card-panel, .wsp-form-text, .wsp-switch-item { transition: none; } }
.wsp-md { display: flex; flex-direction: column; gap: 6px; }
.wsp-md-fallback { display: flex; flex-direction: column; gap: 4px; }
.wsp-md-note { font-size: 10.5px; color: var(--wsp-warn, #d29922); }
.wsp-plain { margin: 0; font-family: var(--wsp-mono, ui-monospace, Menlo, monospace); font-size: 11.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.wsp-link-btn {
  align-self: flex-start; border: 0; background: none; padding: 0 4px; cursor: pointer;
  font: inherit; font-size: 11px; color: var(--wsp-accent, #58a6ff);
  text-decoration: underline; text-underline-offset: 2px;
}
.wsp-link-btn:disabled { opacity: 0.5; cursor: default; }
.wsp-msg-mine .wsp-link-btn { align-self: flex-end; }
.wsp-chat {
  display: flex; flex-direction: column; gap: 16px;
  max-height: 64vh; overflow: auto; padding: 6px 4px;
}
.wsp-msg { display: flex; align-items: flex-start; gap: 10px; }
.wsp-msg-mine { flex-direction: row-reverse; }
.wsp-avatar {
  flex: none; width: 32px; height: 32px; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--wsp-surface-2); color: var(--wsp-muted-2);
}
.wsp-msg-mine .wsp-avatar { background: color-mix(in srgb, var(--wsp-success) 26%, transparent); color: var(--wsp-text); }
.wsp-msg-col { display: flex; flex-direction: column; gap: 3px; max-width: 74%; min-width: 0; }
.wsp-msg-mine .wsp-msg-col { align-items: flex-end; }
.wsp-msg-who { font-size: 10.5px; color: var(--wsp-muted-2); padding: 0 4px; }
.wsp-bubble {
  position: relative; padding: 9px 12px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.06));
  border: 1px solid var(--wsp-line-soft); color: var(--wsp-text);
  font-size: 12.5px; line-height: 1.65; max-width: 100%; overflow-wrap: anywhere;
}
.wsp-bubble::before {
  content: ''; position: absolute; top: 13px; left: -5px; width: 9px; height: 9px;
  background: inherit; border-left: 1px solid var(--wsp-line-soft); border-bottom: 1px solid var(--wsp-line-soft);
  transform: rotate(45deg);
}
.wsp-bubble-mine {
  background: color-mix(in srgb, var(--wsp-success) 20%, var(--dsw-alias-bg-layer-2, #fff));
  border-color: color-mix(in srgb, var(--wsp-success) 34%, transparent);
}
.wsp-msg-mine .wsp-bubble::before {
  left: auto; right: -5px; border-left: 0; border-bottom: 0;
  border-right: 1px solid color-mix(in srgb, var(--wsp-success) 34%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--wsp-success) 34%, transparent);
}
/* Markdown inside a bubble should read like a message, not a document. */
.wsp-bubble > *:first-child { margin-top: 0 !important; }
.wsp-bubble > *:last-child { margin-bottom: 0 !important; }
.wsp-bubble p { margin: 0 0 6px; }
.wsp-bubble h1, .wsp-bubble h2, .wsp-bubble h3, .wsp-bubble h4 { font-size: 13px; font-weight: 600; margin: 8px 0 4px; }
.wsp-bubble ul, .wsp-bubble ol { margin: 0 0 6px; padding-left: 18px; }
.wsp-bubble li { margin: 2px 0; }
.wsp-bubble pre { max-width: 100%; overflow: auto; margin: 6px 0; }
.wsp-bubble code { font-family: var(--wsp-mono); font-size: 11.5px; }
.wsp-bubble blockquote { margin: 6px 0; padding-left: 8px; border-left: 2px solid var(--wsp-line-soft); color: var(--wsp-muted-2); }
.wsp-bubble table { border-collapse: collapse; font-size: 11.5px; }
.wsp-bubble th, .wsp-bubble td { border: 1px solid var(--wsp-line-soft); padding: 2px 6px; }
.wsp-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--wsp-muted); }
.wsp-status-ok { color: var(--wsp-success); }
.wsp-status-err { color: var(--wsp-danger); }
.wsp-status svg { flex: none; }

@media (prefers-reduced-motion: reduce) {
  [data-plugin="dsh-agent-persona"] * { transition: none !important; }
}
`

    let styleElement
    const injectStyles = () => {
      if (styleElement !== undefined) return styleElement
      styleElement = document.createElement('style')
      styleElement.setAttribute('data-dsh-agent-persona', '')
      styleElement.textContent = CSS
      document.head.appendChild(styleElement)
      return styleElement
    }

    /**
     * Renders one message with the conversation's own component, and contains a
     * failure: a render error degrades that message to plain text instead of taking
     * the settings entry down (the slot boundary abdicates the cell on an uncaught
     * error, and one odd message must not cost the page).
     */
    class SafeMarkdown extends React.Component {
      constructor(props) {
        super(props === undefined || props === null ? {} : props)
        this.state = { failed: false, reason: undefined }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        // eslint-disable-next-line no-console
        console.warn('[agent-persona] message markdown failed to render; showing plain text', error)
        // Through state, not an instance field: the fallback was already rendered by the
        // time this runs, so an instance field never reaches the screen (the note said
        // 原因未知 for exactly that reason).
        this.setState({ reason: String((error && error.message) || error).slice(0, 220) })
      }

      render() {
        const text = typeof this.props.text === 'string' ? this.props.text : ''
        if (this.state.failed) {
          return h('div', { className: 'wsp-md-fallback' }, [
            h('div', { className: 'wsp-md-note', key: 'n' }, `这条消息没能按 Markdown 渲染（${this.state.reason ?? '原因未知'}），下面是原文：`),
            h('pre', { className: 'wsp-plain', key: 'p' }, text),
          ])
        }
        // The transcript's component is not exported to plugins, so the
        // dialog uses the kit's document renderer and hands it transcript-safe text:
        // tag-shaped prose is escaped, real HTML and code are left alone.
        // The chrome labels are part of the API: the renderer reads `labels.code` for
        // every code block, and without them it throws ("Cannot read properties of
        // undefined (reading code)") on exactly the messages that contain a fence.
        return h(MarkdownText, { text, labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '' } })
      }
    }

    /**
     * React reports a missing element type only as minified error #130 with no name,
     * and the slot boundary then swallows the whole entry. Checking the elements this
     * file renders turns that into a named error, which our own render guard shows in
     * place of the page.
     */
    const verifyElements = () => {
      const table = {
        Button, DisclosureRow, Input, MarkdownText, Menu, Modal, Pill, Toast, Tooltip,
        Badge, Dot, Switch, SafeMarkdown, WorkspacePersonaSection,
        IconAgentPresetOutline16, IconBrowseOutline16, IconCheckOutline14, IconChevronDownOutline14,
        IconChevronRightOutline14, IconChevronUpOutline14, IconCloseOutline16, IconEditOutline16,
        IconEllipsisOutline16, IconEnhanceOutline16, IconFolderOpen16, IconListPenOutline16,
        IconPersonalizationOutline16, IconPlusOutline16, IconTrashOutline16, IconUserOutline16,
        IconWarningOutline16,
      }
      const missing = Object.entries(table).filter(([, value]) => value === undefined).map(([name]) => name)
      if (missing.length > 0) throw new Error(`UI 组件缺失（宿主组件库没有导出）：${missing.join('、')}`)
    }

    /** Captured while the plugin applies — slot inject props are not guaranteed. */
    let capturedApi

    const apiOf = (props) => (props !== undefined && props !== null && props.api !== undefined ? props.api : capturedApi)

    /** `{ok:true,value}` / `{ok:false,error}`; a host failure arrives as `{error}`. */
    const unwrapEnvelope = (raw) => {
      if (raw !== null && typeof raw === 'object' && 'ok' in raw) {
        if (raw.ok === false) {
          const error = raw.error
          throw new Error(typeof error === 'string' ? error : String((error && (error.message || error.code)) || '远程调用失败'))
        }
        return raw.value
      }
      if (raw !== null && typeof raw === 'object' && 'error' in raw) {
        const error = raw.error
        throw new Error(typeof error === 'string' ? error : String((error && (error.message || error.code)) || '远程调用失败'))
      }
      return raw
    }

    /**
     * The「人设」tab of the conversation page: the persona this session uses, its text as
     * Markdown (editable, saved straight into the store) and the system prompt the session
     * last sent, read from its own log.
     */
    class PersonaView extends React.Component {
      constructor(props) {
        super(props === undefined || props === null ? {} : props)
        this.state = { loading: true, data: null, error: '', busy: '', draft: null, editing: false, copied: false, tab: 'persona', promptView: 'render' }
      }

      componentDidMount() {
        void this.load()
      }

      sessionId() {
        const id = this.props?.sessionId ?? this.props?.session?.id
        return typeof id === 'string' && id !== '' ? id : null
      }

      async load() {
        const api = apiOf(this.props)
        const sessionId = this.sessionId()
        if (api === undefined || typeof api.sessionPrompt !== 'function') {
          this.setState({ loading: false, error: '远程服务还没就绪，稍后重试' })
          return
        }
        if (sessionId === null) {
          this.setState({ loading: false, error: '这个视图没有拿到会话 id' })
          return
        }
        this.setState({ busy: 'load', error: '' })
        try {
          const data = unwrapEnvelope(await api.sessionPrompt({ id: sessionId }))
          this.setState({
            loading: false,
            busy: '',
            data,
            draft: data?.persona === null || data?.persona === undefined
              ? null
              : { name: data.persona.name, text: data.persona.text, mode: data.persona.mode },
          })
        } catch (error) {
          this.setState({ loading: false, busy: '', error: String((error && error.message) || error) })
        }
      }

      async save() {
        const api = apiOf(this.props)
        const { data, draft } = this.state
        if (api === undefined || data?.persona === null || draft === null) return
        this.setState({ busy: 'save', error: '' })
        try {
          unwrapEnvelope(await api.savePersona({
            id: data.persona.id,
            name: draft.name,
            enabled: data.persona.enabled,
            mode: draft.mode,
            text: draft.text,
            targets: data.persona.targets ?? [],
          }))
          await this.load()
          this.setState({ busy: '', error: '' })
        } catch (error) {
          this.setState({ busy: '', error: String((error && error.message) || error) })
        }
      }

      async copyPrompt() {
        const prompt = this.state.data?.prompt ?? ''
        if (prompt === '') return
        try {
          await navigator.clipboard.writeText(prompt)
          this.setState({ copied: true })
          setTimeout(() => this.setState({ copied: false }), 1600)
        } catch (error) {
          this.setState({ error: `复制失败：${String((error && error.message) || error)}` })
        }
      }

      patch(patch) {
        this.setState((previous) => ({ draft: { ...previous.draft, ...patch } }))
      }

      render() {
        const { data, draft, error, busy, loading, editing, copied, tab, promptView } = this.state
        const persona = data?.persona ?? null
        const dirty = persona !== null && draft !== null
          && (draft.text !== persona.text || draft.name !== persona.name || draft.mode !== persona.mode)
        const matched = data?.matchedBy ?? []
        const prompt = data?.prompt ?? null

        const header = h('header', { className: 'wsp-view-head', key: 'head' }, [
          h('div', { className: 'wsp-view-headtext', key: 't' }, [
            h('h2', { className: 'wsp-view-title', key: 'h' }, '人设'),
            h('p', { className: 'wsp-view-lead', key: 'p' }, '这条会话使用的系统提示词人设，以及模型最近一次真正收到的完整 system prompt。'),
          ]),
          h('div', { className: 'wsp-view-headactions', key: 'a' }, [
            h(Button, {
              key: 'reload',
              variant: 'outline',
              size: 'sm',
              icon: h(IconRefreshOutline16, {}),
              disabled: busy === 'load',
              onClick: () => void this.load(),
            }, busy === 'load' ? '刷新中…' : '刷新'),
          ]),
        ])

        const TABS = [
          { id: 'persona', label: '当前人设' },
          { id: 'prompt', label: 'System Prompt' },
        ]
        const tabs = h('div', { className: 'wsp-tabs', key: 'tabs', role: 'tablist' }, TABS.map((item) => h('button', {
          key: item.id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === item.id,
          className: tab === item.id ? 'wsp-tab wsp-tab-on' : 'wsp-tab',
          onClick: () => this.setState({ tab: item.id }),
        }, item.label)))

        const alerts = []
        if (error !== '') {
          alerts.push(h('div', { className: 'wsp-alert', role: 'alert', key: 'err' }, [
            h(IconWarningOutline16, { key: 'i' }),
            h('span', { key: 't' }, error),
            h(Button, { key: 'r', variant: 'outline', size: 'sm', onClick: () => void this.load() }, '重试'),
          ]))
        }

        const card = (opts) => h('section', { className: 'wsp-card-panel', key: opts.key }, [
          h('div', { className: 'wsp-card-head', key: 'h' }, [
            h('h3', { className: 'wsp-card-title', key: 't' }, opts.title),
            opts.meta === undefined ? null : h('span', { className: 'wsp-card-meta', key: 'm' }, opts.meta),
            ...(opts.tags ?? []),
            h('span', { className: 'wsp-grow', key: 'g' }),
            ...(opts.actions ?? []),
          ]),
          ...(opts.extra ?? []),
          opts.note === undefined ? null : h('p', { className: 'wsp-card-note', key: 'n' }, opts.note),
          ...(opts.body ?? []),
        ])

        let panel
        if (loading) {
          panel = h('div', { className: 'wsp-panel-area', key: 'sk' }, h('div', { className: 'wsp-skel' }, [
            h('div', { className: 'wsp-skel-line', key: 'a', style: { width: '38%' } }),
            h('div', { className: 'wsp-skel-line', key: 'b', style: { width: '92%' } }),
            h('div', { className: 'wsp-skel-line', key: 'c', style: { width: '74%' } }),
          ]))
        } else if (persona === null) {
          panel = h('div', { className: 'wsp-panel-area', key: 'empty' }, card({
            key: 'c',
            title: '没有命中任何人设',
            note: '这条会话使用 DSH 原生 system prompt。要给它指定人设，去「设置 → Agent人设」新建一条，并把适用范围指到这条会话或它的工作区。',
          }))
        } else if (tab === 'persona') {
          panel = h('div', { className: 'wsp-panel-area', key: 'persona' }, card({
            key: 'c',
            title: persona.name,
            meta: undefined,
            tags: [
              h('span', { className: 'wsp-card-meta', key: 'n' }, `${persona.text.length} 字`),
              h('span', {
                key: 'e',
                className: persona.enabled ? 'wsp-chip wsp-chip-on' : 'wsp-chip wsp-chip-off',
                title: persona.enabled ? '这条人设已启用，会参与注入' : '这条人设已停用，不参与注入',
              }, persona.enabled ? '在用' : '已停用'),
              h('span', {
                key: 'm',
                className: persona.mode === 'replace' ? 'wsp-chip wsp-chip-mode-strong' : 'wsp-chip wsp-chip-mode',
                title: persona.mode === 'replace'
                  ? '替换：DSH 自带的身份句与部署身份都去掉，只用这条人设'
                  : '追加：DSH 自带的身份说明保留，这条人设接在后面',
              }, persona.mode === 'replace' ? '替换 DSH 身份' : '追加在 DSH 身份之后'),
              dirty
                ? h('span', { key: 'd', className: 'wsp-chip wsp-chip-warn', title: '编辑区的内容与已保存的正文不一致' }, '有未保存的修改')
                : null,
            ],
            actions: [
              h(Button, { key: 'edit', variant: 'outline', size: 'sm', onClick: () => this.setState({ editing: !editing }) },
                editing ? '取消编辑' : '编辑正文'),
            ],
            body: [
              editing && draft !== null
                ? h('div', { className: 'wsp-form', key: 'form' }, [
                  h('label', { className: 'wsp-field', key: 'name' }, [
                    h('span', { className: 'wsp-field-label', key: 'l' }, '名称'),
                    h(Input, { key: 'i', value: draft.name, onChange: (event) => this.patch({ name: event.target.value }) }),
                  ]),
                  h('div', { className: 'wsp-field', key: 'mode' }, [
                    h('span', { className: 'wsp-field-label', key: 'l' }, '注入方式'),
                    h('div', { className: 'wsp-seg', key: 's' }, [
                      h(Pill, { key: 'a', active: draft.mode !== 'replace', onClick: () => this.patch({ mode: 'append' }) }, '追加'),
                      h(Pill, { key: 'r', active: draft.mode === 'replace', onClick: () => this.patch({ mode: 'replace' }) }, '替换'),
                      h('span', { className: 'wsp-field-hint', key: 'h' }, draft.mode === 'replace'
                        ? 'DSH 自带的身份句和部署身份都去掉，只用这条人设。'
                        : 'DSH 自带的身份说明保留，这条人设接在后面。'),
                    ]),
                  ]),
                  h('label', { className: 'wsp-field', key: 'body' }, [
                    h('span', { className: 'wsp-field-label', key: 'l' }, '正文（Markdown）'),
                    h('textarea', {
                      key: 't',
                      className: 'wsp-form-text',
                      value: draft.text,
                      spellCheck: false,
                      onChange: (event) => this.patch({ text: event.target.value }),
                    }),
                  ]),
                  h('div', { className: 'wsp-form-actions', key: 'a' }, [
                    h('span', { className: 'wsp-card-meta', key: 'c' }, `${draft.text.length} 字 · 保存后下一个请求生效`),
                    h('span', { className: 'wsp-grow', key: 'g' }),
                    h(Button, { key: 'cancel', variant: 'outline', size: 'sm', disabled: busy !== '', onClick: () => this.setState({ editing: false }) }, '放弃修改'),
                    h(Button, {
                      key: 'save',
                      variant: 'primary',
                      size: 'sm',
                      disabled: busy !== '' || !dirty,
                      onClick: () => void this.save(),
                    }, busy === 'save' ? '保存中…' : '保存'),
                  ]),
                ])
                : h('div', { className: 'wsp-prose', key: 'body' }, h(SafeMarkdown, { text: draft?.text ?? persona.text })),
            ],
          }))
        } else {
          panel = h('div', { className: 'wsp-panel-area', key: 'prompt' }, card({
            key: 'c',
            title: 'System Prompt',
            meta: prompt === null ? '还没有记录' : `${prompt.length} 字 · 最近一次实际发送`,
            note: prompt === null ? '这条会话还没有发起过请求，因此没有 system prompt 记录。' : undefined,
            actions: prompt === null ? [] : [
              h('div', { className: 'wsp-switch', key: 'sw' }, [
                h('button', { key: 'r', type: 'button', className: promptView === 'render' ? 'wsp-switch-item wsp-switch-on' : 'wsp-switch-item', onClick: () => this.setState({ promptView: 'render' }) }, '渲染'),
                h('button', { key: 's', type: 'button', className: promptView === 'source' ? 'wsp-switch-item wsp-switch-on' : 'wsp-switch-item', onClick: () => this.setState({ promptView: 'source' }) }, '源码'),
              ]),
              h(Button, { key: 'copy', variant: 'outline', size: 'sm', onClick: () => void this.copyPrompt() }, copied ? '已复制' : '复制'),
            ],
            body: prompt === null
              ? []
              : [promptView === 'source'
                ? h('pre', { className: 'wsp-source', key: 'src' }, prompt)
                : h('div', { className: 'wsp-prose wsp-prose-scroll', key: 'md' }, h(SafeMarkdown, { text: prompt }))],
          }))
        }

        return h('div', { className: 'wsp-view', 'data-plugin': NS }, [header, tabs, ...alerts, panel])
      }
    }


    const dotState = (persona) => {
      if (persona === undefined) return 'off'
      if (!persona.enabled) return 'off'
      return (persona.text || '').trim() === '' ? 'empty' : 'on'
    }

    const targetValid = (target) => {
      if ((target.value || '').trim() === '') return false
      if (target.match !== 'regex') return true
      try {
        new RegExp(target.value)
        return true
      } catch {
        return false
      }
    }

    const describeTarget = (target) => `${MATCH_LABEL[target.match] ?? target.match} ${target.value}`

/** "this persona" reads very differently from "someone else's". */
const ownerMark = (owner, personaId) => (owner.id === personaId ? '当前人设' : `已被「${owner.name}」用`)

/** A session id shortened to what a human can compare at a glance. */
const shortSessionId = (id) => {
  const uuid = /^session-([0-9a-f]{8})/i.exec(id)
  if (uuid !== null) return `session-${uuid[1]}`
  return id.length <= 26 ? id : `${id.slice(0, 12)}…${id.slice(-6)}`
}

/** "3 分钟前" style label for a session's creation time. */
const since = (timestamp) => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`
  return `${Math.round(seconds / 86400)} 天前`
}

    const Dot = ({ state }) => h('span', { className: `wsp-dot wsp-dot-${state}`, 'aria-hidden': 'true' })

    const Badge = ({ children, tone }) => h('span', {
      className: tone === undefined ? 'wsp-badge' : `wsp-badge wsp-badge-${tone}`,
    }, children)

    const Switch = ({ checked, disabled, label, onChange }) => h('label', { className: 'wsp-switch', title: label }, [
      h('input', {
        key: 'i',
        type: 'checkbox',
        checked,
        disabled,
        'aria-label': label,
        onChange: (event) => onChange(event.target.checked),
      }),
      h('span', { key: 't', className: 'wsp-switch-track' }),
      h('span', { key: 'l', className: 'wsp-switch-text' }, label),
    ])

    // ── the settings page ───────────────────────────────────────────────────

    class WorkspacePersonaSection extends React.Component {
      constructor(props) {
        super(props === undefined || props === null ? {} : props)
        this.state = {
          view: undefined,
          openId: undefined,
          draft: undefined,
          pane: 'edit',
          confirmDelete: undefined,
          picker: undefined,
          menu: undefined,
          filter: '',
          dragId: undefined,
          dropIndex: undefined,
          history: undefined,
          historyBusy: undefined,
          models: [],
          model: '',
          tuneOpen: false,
          tuneMode: 'polish',
          instruction: '',
          proposal: '',
          targets: { workspaces: [], sessions: [], hidden: { subagents: 0, archived: 0, blank: 0 } },
          busy: '',
          error: '',
          status: '',
        }
        this.mounted = false
        this.rootRef = React.createRef()
        this.onChange = (patch) => {
          if (this.mounted) this.setState(patch)
        }
        this.onKeyDown = (event) => {
          if (!(event.metaKey || event.ctrlKey) || String(event.key).toLowerCase() !== 's') return
          const root = this.rootRef.current
          if (root === null || !root.contains(event.target)) return
          event.preventDefault()
          void this.save()
        }
      }

      componentDidMount() {
        this.mounted = true
        document.addEventListener('keydown', this.onKeyDown)
        void this.loadTargets()
        void this.loadModels()
        void this.load()
      }

      componentWillUnmount() {
        this.mounted = false
        document.removeEventListener('keydown', this.onKeyDown)
      }

      api() {
        return apiOf(this.props)
      }

      /** `{ok:true,value}` / `{ok:false,error}`; a host failure arrives as `{error}`. */
      unwrap(raw) {
        if (raw !== null && typeof raw === 'object' && raw.ok === false) {
          const failure = raw.error
          const code = failure !== null && typeof failure === 'object' && typeof failure.code === 'string'
            ? failure.code
            : typeof failure === 'string' && failure !== '' ? failure : 'gateway'
          const message = failure !== null && typeof failure === 'object' && typeof failure.message === 'string' ? `: ${failure.message}` : ''
          throw new Error(`${code}${message}`)
        }
        const value = raw !== null && typeof raw === 'object' && raw.ok === true ? raw.value : raw
        if (value !== null && typeof value === 'object' && typeof value.error === 'string') throw new Error(value.error)
        return value
      }

      async loadModels() {
        const api = this.api()
        if (api === undefined) return
        try {
          const result = this.unwrap(await api.listModels())
          const models = Array.isArray(result?.models) ? result.models : []
          const first = models[0]
          this.onChange({ models, model: first === undefined ? '' : `${first.provider}/${first.model}` })
        } catch {
          /* the tuning panel then simply offers the default model */
        }
      }

      /** Refresh the list; keeps the expanded card open when it still exists. */
      async load(keepOpen) {
        const api = this.api()
        if (api === undefined) {
          // The remote namespace mounts asynchronously, so a first render can
          // land before it exists. Retry briefly instead of flashing an error.
          this.apiRetries = (this.apiRetries ?? 0) + 1
          if (this.apiRetries <= 12) {
            setTimeout(() => {
              if (this.mounted) void this.load(keepOpen)
            }, 150)
            return
          }
          this.onChange({ error: '插件还没加载好：请重启 dsh web 后再打开这个页面' })
          return
        }
        this.apiRetries = 0
        this.onChange({ busy: 'load', error: '' })
        try {
          const view = this.unwrap(await api.listPersonas())
          const wanted = keepOpen === true ? this.state.openId : undefined
          const persona = wanted === undefined ? undefined : (view.personas || []).find((item) => item.id === wanted)
          this.onChange({
            view,
            busy: '',
            openId: persona === undefined ? undefined : wanted,
            draft: persona === undefined ? undefined : this.draftFrom(persona),
          })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      /** Which row's picker or which card's action menu is open (one at a time). */
      togglePicker(key) {
        this.onChange({ picker: this.state.picker === key ? undefined : key, menu: undefined })
      }

      toggleMenu(key) {
        this.onChange({ menu: this.state.menu === key ? undefined : key, picker: undefined })
      }

      closePopovers() {
        if (this.state.picker !== undefined || this.state.menu !== undefined) {
          this.onChange({ picker: undefined, menu: undefined })
        }
      }

      /** "自定义输入…" is always the last row of a picker menu. */
      customItem() {
        return { id: '__custom__', label: '自己输入…', icon: h(IconEditOutline16, {}) }
      }

      workspaceItems(personaId) {
        const workspaces = this.state.targets.workspaces ?? []
        if (workspaces.length === 0) {
          return [{ type: 'label', id: 'empty', text: '宿主没有返回工作区列表，请用「自己输入…」' }]
        }
        return workspaces.map((workspace) => ({
          id: workspace.path,
          label: h('span', { className: 'wsp-opt' }, [
            h('span', { className: 'wsp-opt-text', key: 't' }, workspace.sessionCount > 0 ? `${workspace.title} · ${workspace.sessionCount} 个会话` : workspace.title),
            workspace.owner === undefined ? null : h('span', { className: 'wsp-opt-owner', key: 'o' }, ownerMark(workspace.owner, personaId)),
            h('span', { className: 'wsp-opt-id', key: 'i' }, workspace.path.replace(/^\/Users\/[^/]+/, '~')),
          ]),
          icon: h(IconFolderOpen16, {}),
        }))
      }

      sessionItems(personaId) {
        const sessions = this.state.targets.sessions ?? []
        if (sessions.length === 0) {
          return [{ type: 'label', id: 'empty', text: '宿主没有返回会话列表，请用「自己输入…」' }]
        }
        // Left: what the session is (its title, or its first prompt). Right: the
        // short id and age, so two sessions with the same title stay tellable apart.
        const optionLabel = (session) => h('span', { className: 'wsp-opt' }, [
          h('span', { className: 'wsp-opt-text', key: 't' }, session.title ?? '（还没有标题）'),
          session.owner === undefined ? null : h('span', { className: 'wsp-opt-owner', key: 'o' }, ownerMark(session.owner, personaId)),
          h('span', { className: 'wsp-opt-id', key: 'i' }, [
            session.turns === undefined ? null : h('span', { className: 'wsp-opt-turns', key: 't' }, `${session.turns} 次对话`),
            session.turns === undefined ? null : ' · ',
            shortSessionId(session.id),
            session.createdAt === null || session.createdAt === undefined ? null : ` · ${since(session.createdAt)}`,
          ]),
        ])
        const items = [{ type: 'label', id: 'recent', text: '最近的会话' }]
        for (const session of sessions.slice(0, 10)) {
          items.push({ id: session.id, label: optionLabel(session), icon: h(IconListPenOutline16, {}) })
        }
        // Everything older is grouped under its working directory: a flat list of
        // hundreds of sessions is unusable, a folder per project is not.
        const groups = new Map()
        for (const session of sessions.slice(10)) {
          const key = session.cwd ?? '(未知目录)'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(session)
        }
        if (groups.size > 0) {
          const titleOf = (cwd) => (this.state.targets.workspaces ?? []).find((workspace) => workspace.path === cwd)?.title ?? cwd
          items.push({ type: 'separator', id: 'sep' })
          items.push({ type: 'label', id: 'older', text: '更早的会话（按目录）' })
          for (const [cwd, group] of groups) {
            items.push({
              id: `dir:${cwd}`,
              label: `${titleOf(cwd)}（${group.length}）`,
              icon: h(IconFolderOpen16, {}),
              submenu: group.slice(0, 40).map((session) => ({ id: session.id, label: optionLabel(session) })),
            })
          }
        }
        return items
      }

      /** Read a session's recent messages so the user can recognise it. */
      async openHistory(sessionId) {
        const api = this.api()
        if (api === undefined || typeof api.sessionHistory !== 'function') {
          this.onChange({ status: '', error: '这个版本还没有会话历史接口：请更新插件后重启 dsh web' })
          return
        }
        this.onChange({ historyBusy: sessionId, history: undefined, error: '' })
        try {
          const result = this.unwrap(await api.sessionHistory({ id: sessionId, offset: 0, events: 2000 }))
          this.onChange({ historyBusy: undefined, history: { ...result, mode: 'head', shown: result?.messages?.length ?? 0 } })
        } catch (error) {
          this.onChange({ historyBusy: undefined, history: { id: sessionId, available: false, messages: [], error: String((error && error.message) || error) } })
        }
      }

      /** Append the next window of the conversation (only when asked). */
      async loadMoreHistory() {
        const current = this.state.history
        const api = this.api()
        if (current === undefined || api === undefined) return
        if (current.nextOffset === null || current.nextOffset === undefined) return
        this.onChange({ historyBusy: current.id, error: '' })
        try {
          const next = this.unwrap(await api.sessionHistory({ id: current.id, offset: current.nextOffset, events: 2000 }))
          this.onChange({
            historyBusy: undefined,
            history: {
              ...next,
              messages: [...(current.messages ?? []), ...(next?.messages ?? [])],
              shown: (current.shown ?? 0) + (next?.messages?.length ?? 0),
            },
          })
        } catch (error) {
          this.onChange({ historyBusy: undefined, error: String((error && error.message) || error) })
        }
      }

      /**
       * Jump to the end: the list is replaced by the last exchange only, so one
       * click answers "what were we just talking about".
       */
      /** Re-read one message in full: one event, one bubble replaced. */
      async expandMessage(index) {
        const api = this.api()
        const current = this.state.history
        const message = current?.messages?.[index]
        if (api === undefined || message === undefined || message.at === undefined) return
        this.onChange({ historyBusy: `msg:${index}`, error: '' })
        try {
          const page = this.unwrap(await api.sessionHistory({ id: current.id, offset: message.at, events: 1, maxChars: 100000 }))
          const full = page?.messages?.[0]?.text
          if (typeof full !== 'string' || full === '') throw new Error('这条消息读不出完整内容')
          const messages = current.messages.map((item, i) => (i === index
            ? { ...item, text: full, expanded: true, shortText: item.text }
            : item))
          this.onChange({ historyBusy: undefined, history: { ...current, messages } })
        } catch (error) {
          this.onChange({ historyBusy: undefined, error: String((error && error.message) || error) })
        }
      }

      /** Put the shortened text back (no re-read: it was kept). */
      collapseMessage(index) {
        const current = this.state.history
        const message = current?.messages?.[index]
        if (message?.shortText === undefined) return
        const messages = current.messages.map((item, i) => (i === index
          ? { ...item, text: item.shortText, expanded: false, shortText: undefined }
          : item))
        this.onChange({ history: { ...current, messages } })
      }

      /**
       * Back to the beginning of the conversation. The dialog stays mounted and only
       * its contents are replaced: clearing `history` would unmount the modal and
       * mount a new one, which reads as a flash.
       */
      async readHeadHistory() {
        const api = this.api()
        const current = this.state.history
        if (api === undefined || current === undefined) return
        this.onChange({ historyBusy: current.id, error: '' })
        try {
          const head = this.unwrap(await api.sessionHistory({ id: current.id, offset: 0, events: 2000 }))
          this.onChange({
            historyBusy: undefined,
            history: { ...head, mode: 'head', shown: head?.messages?.length ?? 0 },
          })
        } catch (error) {
          this.onChange({ historyBusy: undefined, error: String((error && error.message) || error) })
        }
      }

      async readTailHistory() {
        const api = this.api()
        const current = this.state.history
        if (api === undefined || current === undefined) return
        this.onChange({ historyBusy: current.id, error: '' })
        try {
          const tail = this.unwrap(await api.sessionHistory({ id: current.id, tail: true, keep: 4, events: 2000 }))
          this.onChange({
            historyBusy: undefined,
            history: { ...tail, mode: 'tail', shown: tail?.messages?.length ?? 0 },
          })
        } catch (error) {
          this.onChange({ historyBusy: undefined, error: String((error && error.message) || error) })
        }
      }

      draftFrom(persona) {
        return {
          id: persona.id,
          name: persona.name,
          enabled: persona.enabled,
          mode: persona.mode === 'replace' ? 'replace' : 'append',
          text: persona.text,
          targets: (persona.targets || []).map((target) => ({ kind: target.kind, match: target.match, value: target.value })),
        }
      }

      open(persona) {
        const lost = this.isDirty() && persona.id !== this.state.openId
        this.onChange({
          openId: persona.id,
          draft: this.draftFrom(persona),
          pane: 'edit',
          confirmDelete: undefined,
          proposal: '',
          instruction: '',
          error: '',
          status: lost ? '上一条人设的改动没有保存' : '',
        })
      }

      close() {
        const lost = this.isDirty()
        this.onChange({
          openId: undefined,
          draft: undefined,
          proposal: '',
          confirmDelete: undefined,
          status: lost ? '改动没有保存' : this.state.status,
        })
      }

      /**
       * Drop the dragged persona at the boundary the pointer picked. `from < to`
       * means the item leaves a slot behind itself, hence the `- 1`.
       */
      async drop() {
        const id = this.state.dragId
        const boundary = this.state.dropIndex
        const api = this.api()
        this.onChange({ dragId: undefined, dropIndex: undefined })
        if (id === undefined || boundary === undefined || api === undefined) return
        const personas = this.state.view?.personas ?? []
        const from = personas.findIndex((persona) => persona.id === id)
        if (from === -1) return
        const to = from < boundary ? boundary - 1 : boundary
        if (to === from) return
        this.onChange({ busy: 'reorder' })
        try {
          const view = this.unwrap(await api.reorderPersona({ id, toIndex: to }))
          this.onChange({ view, busy: '', status: '顺序已更新' })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      /** Draft vs saved, ignoring UI-only keys (`custom`, `invalid`). */
      isDirty() {
        const draft = this.state.draft
        const saved = (this.state.view?.personas ?? []).find((persona) => persona.id === this.state.openId)
        if (draft === undefined || saved === undefined) return false
        const shape = (value) => JSON.stringify({
          n: value.name,
          e: value.enabled,
          m: value.mode ?? 'append',
          t: value.text,
          g: (value.targets ?? []).map((target) => [target.kind, target.match, target.value]),
        })
        return shape(draft) !== shape(saved)
      }

      patchDraft(patch) {
        const draft = this.state.draft
        if (draft === undefined) return
        this.onChange({ draft: Object.assign({}, draft, patch) })
      }

      patchTarget(index, patch) {
        const draft = this.state.draft
        if (draft === undefined) return
        const targets = draft.targets.map((target, i) => (i === index ? Object.assign({}, target, patch) : target))
        this.patchDraft({ targets })
      }

      addTarget() {
        const draft = this.state.draft
        if (draft === undefined) return
        this.patchDraft({ targets: [...draft.targets, { kind: 'workspace', match: 'exact', value: '' }] })
      }

      removeTarget(index) {
        const draft = this.state.draft
        if (draft === undefined) return
        this.patchDraft({ targets: draft.targets.filter((_target, i) => i !== index) })
      }

      async create() {
        const api = this.api()
        if (api === undefined) return
        const before = (this.state.view?.personas || []).map((persona) => persona.id)
        this.onChange({ busy: 'create', error: '', status: '' })
        try {
          // Created disabled: adding a persona must never change what a session gets.
          const view = this.unwrap(await api.savePersona({ name: '新人设', enabled: false, text: '', targets: [] }))
          const created = (view.personas || []).find((item) => !before.includes(item.id))
          this.onChange({ view, busy: '' })
          if (created !== undefined) {
            this.open(created)
            this.onChange({ status: '已新建（默认停用）：选好位置后打开开关就会生效' })
          }
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      async save() {
        const api = this.api()
        const draft = this.state.draft
        if (api === undefined || draft === undefined) return
        this.onChange({ busy: 'save', error: '', status: '' })
        try {
          const view = this.unwrap(await api.savePersona({
            id: draft.id,
            name: draft.name,
            enabled: draft.enabled,
            mode: draft.mode,
            text: draft.text,
            targets: draft.targets,
          }))
          const persona = (view.personas || []).find((item) => item.id === draft.id)
          this.onChange({
            view,
            busy: '',
            draft: persona === undefined ? undefined : this.draftFrom(persona),
            status: view.notice ?? '已保存，下一条消息就会用上',
          })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      async remove(id) {
        const api = this.api()
        if (api === undefined) return
        this.onChange({ busy: 'remove', error: '', status: '' })
        try {
          const view = this.unwrap(await api.deletePersona({ id }))
          this.onChange({ view, busy: '', openId: undefined, draft: undefined, confirmDelete: undefined, status: '人设已删除' })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      async move(id, delta) {
        const api = this.api()
        if (api === undefined) return
        this.onChange({ busy: 'move', error: '', status: '' })
        try {
          const view = this.unwrap(await api.movePersona({ id, delta }))
          this.onChange({ view, busy: '', status: delta < 0 ? '已上移' : '已下移' })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      async duplicate(id) {
        const api = this.api()
        if (api === undefined) return
        this.onChange({ busy: 'duplicate', error: '', status: '' })
        try {
          const view = this.unwrap(await api.duplicatePersona({ id }))
          this.onChange({ view, busy: '', status: '已复制（副本默认停用）' })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      /** Candidate workspaces and sessions for the dropdowns (never fatal). */
      async loadTargets() {
        const api = this.api()
        if (api === undefined || typeof api.listTargets !== 'function') return
        try {
          const result = this.unwrap(await api.listTargets())
          this.onChange({
            targets: {
              workspaces: Array.isArray(result?.workspaces) ? result.workspaces : [],
              sessions: Array.isArray(result?.sessions) ? result.sessions : [],
              hidden: result?.hidden ?? { subagents: 0, archived: 0, blank: 0 },
            },
          })
        } catch {
          /* the page falls back to typing a value */
        }
      }

      /** Switching a row's kind clears its value: a path is not a session id. */
      setKind(index, kind) {
        this.patchTarget(index, { kind, match: 'exact', value: '', custom: false })
      }

      pickTarget(index, value) {
        if (value === '__custom__') {
          this.patchTarget(index, { value: '', custom: true })
          return
        }
        this.patchTarget(index, { value, custom: false })
      }

      async tune() {
        const api = this.api()
        const draft = this.state.draft
        if (api === undefined || draft === undefined) return
        const parts = this.state.model.split('/')
        this.onChange({ busy: 'tune', error: '', status: '', proposal: '' })
        try {
          const result = this.unwrap(await api.tunePersona({
            mode: this.state.tuneMode,
            instruction: this.state.instruction,
            text: draft.text,
            ...(this.state.model === '' ? {} : { provider: parts[0], model: parts.slice(1).join('/') }),
          }))
          this.onChange({
            busy: '',
            proposal: (result && result.text) || '',
            status: `已生成建议（${(result && result.provider) || ''}/${(result && result.model) || ''}）`,
          })
        } catch (error) {
          this.onChange({ busy: '', error: String((error && error.message) || error) })
        }
      }

      render() {
        try {
          return this.renderBody()
        } catch (error) {
          return h('div', { className: 'wsp-status wsp-status-err', 'data-plugin': SCOPE },
            `Agent人设页渲染异常：${String((error && error.message) || error)}`)
        }
      }

      renderBody() {
        verifyElements()
        const state = this.state
        const view = state.view
        const rootProps = { 'data-plugin': SCOPE, ref: this.rootRef }

        const busy = state.busy !== ''
        const personas = view?.personas ?? []
        /** Session lookup at renderBody scope: the list and the history dialog both need it. */
        const sessionById = (id) => (state.targets.sessions ?? []).find((item) => item.id === id)

        // The title and the description are static, so they paint immediately;
        // only the counts, the store path and the cards wait for the host. Nobody
        // should stare at "加载中…" for content that never changes.
        const header = h('div', { className: 'wsp-head', key: 'head' }, [
          h('h2', { className: 'wsp-title', key: 't' }, 'Agent人设'),
          h('p', { className: 'wsp-sub', key: 's' }, DESCRIPTION),
          h('div', { className: 'wsp-meta', key: 'm' }, view === undefined
            ? ['正在读取人设…']
            : [
              h(Badge, { key: 'total' }, `${view.counts.total} 条人设`),
              h(Badge, { key: 'enabled', tone: view.counts.enabled > 0 ? 'on' : 'off' }, `${view.counts.enabled} 条在用`),
              h('span', { className: 'wsp-spacer', key: 'sp' }),
              '保存在 ',
              h('code', { key: 'c' }, view.storePath),
            ]),
        ])

        if (view === undefined) {
          const status = state.error === ''
            ? h('div', { className: 'wsp-status', key: 'st' }, '正在读取人设…')
            : h('div', { className: 'wsp-status wsp-status-err', key: 'st', 'aria-live': 'polite' }, state.error)
          const skeleton = h('div', { className: 'wsp-cards', key: 'cards', 'aria-hidden': 'true' },
            [0, 1].map((i) => h('div', { className: 'wsp-card', key: `s${i}` },
              h('div', { className: 'wsp-row-head' }, [
                h('span', { className: 'wsp-skeleton wsp-skeleton-chevron', key: 'c' }),
                h('span', { className: 'wsp-skeleton wsp-skeleton-name', key: 'n' }),
                h('span', { className: 'wsp-skeleton wsp-skeleton-chip', key: 'g' }),
              ]))))
          return h('div', rootProps, [header, skeleton, status])
        }
        const modelOptions = state.models.length === 0
          ? [h('option', { key: 'none', value: '' }, '默认模型')]
          : state.models.map((item) => h('option', { key: `${item.provider}/${item.model}`, value: `${item.provider}/${item.model}` }, item.name))

        // ── header
        // ── one collapsed row
        const cardHead = (persona, index) => {
          const isOpen = state.openId === persona.id
          const menuKey = `card:${persona.id}`
          const toggle = () => (isOpen ? this.close() : this.open(persona))
          return h('div', {
            key: `h${persona.id}`,
            className: isOpen ? 'wsp-row-head wsp-row-open wsp-row-click' : 'wsp-row-head wsp-row-click',
            role: isOpen ? undefined : 'button',
            'aria-expanded': isOpen,
            tabIndex: isOpen ? undefined : 0,
            onClick: toggle,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggle()
              }
            },
          }, [
            h('button', {
              key: 'chev',
              type: 'button',
              draggable: true,
              className: 'wsp-chevron',
              title: '点击展开 / 收起；按住拖动可调整这条人设的顺序',
              'aria-label': isOpen ? `收起 ${persona.name}` : `展开 ${persona.name}`,
              'aria-expanded': isOpen,
              onClick: (event) => {
                event.stopPropagation()
                toggle()
              },
              onDragStart: (event) => {
                this.onChange({ dragId: persona.id, dropIndex: undefined })
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = 'move'
                  try {
                    event.dataTransfer.setData('text/plain', persona.id)
                  } catch {
                    /* some engines refuse setData for non-text drags */
                  }
                }
              },
              onDragEnd: () => this.onChange({ dragId: undefined, dropIndex: undefined }),
            }, h(isOpen ? IconChevronDownOutline14 : IconChevronRightOutline14, {})),
            h(Dot, { key: 'd', state: dotState(persona) }),
            h('span', { className: 'wsp-pname', key: 'n', title: persona.name }, persona.name),
            h('span', { className: 'wsp-spacer', key: 'sp' }),
            h('span', { className: 'wsp-idx', key: 'i', title: `优先级第 ${index + 1} 位（越靠上越优先）` }, String(index + 1)),
            h(Badge, {
              key: 'b1',
              tone: persona.enabled ? (persona.text.trim() === '' ? 'warn' : 'on') : 'off',
            }, persona.enabled ? (persona.text.trim() === '' ? '在用·正文空' : '在用') : '已停用'),
            ...(conflicts.has(persona.id) ? [h(Badge, { key: 'conflict', tone: 'warn', title: (conflicts.get(persona.id) ?? []).join('\n') }, '可能被覆盖')] : []),
            ...(state.openId === persona.id && this.isDirty() ? [h(Badge, { key: 'dirty', tone: 'warn' }, '未保存')] : []),
            h('span', { className: 'wsp-caption', key: 'c' }, `${persona.chars} 字`),
            h(Menu, {
              key: 'more',
              open: state.menu === menuKey,
              portal: true,
              align: 'end',
              items: [
                { id: 'up', label: '上移（具体度相同时更优先）', icon: h(IconChevronUpOutline14, {}), disabled: index === 0 },
                { id: 'down', label: '下移（具体度相同时更靠后）', icon: h(IconChevronDownOutline14, {}), disabled: index === personas.length - 1 },
                { type: 'separator', id: 'sep-order' },
                { id: 'duplicate', label: '复制一份（副本默认停用）', icon: h(IconEditOutline16, {}) },
                { type: 'separator', id: 'sep' },
                state.confirmDelete === persona.id
                  ? { id: 'delete', label: '确认删除', icon: h(IconTrashOutline16, {}), danger: true }
                  : { id: 'delete', label: '删除', icon: h(IconTrashOutline16, {}), danger: true },
              ],
              onSelect: (id) => {
                this.onChange({ menu: undefined })
                if (id === 'up') void this.move(persona.id, -1)
                if (id === 'down') void this.move(persona.id, 1)
                if (id === 'duplicate') void this.duplicate(persona.id)
                if (id === 'delete') {
                  if (state.confirmDelete === persona.id) void this.remove(persona.id)
                  else this.onChange({ confirmDelete: persona.id })
                }
              },
              onClose: () => this.onChange({ menu: undefined }),
              anchor: h('button', {
                key: 'a',
                type: 'button',
                className: 'wsp-icon-btn',
                title: '更多操作',
                'aria-label': `更多操作 ${persona.name}`,
                'aria-haspopup': 'menu',
                onClick: (event) => {
                  event.stopPropagation()
                  this.toggleMenu(menuKey)
                },
              }, h(IconEllipsisOutline16, {})),
            }),
          ])
        }

        /** Human-readable name for one scope row (workspace titles, session titles). */
        const targetLabel = (target) => {
          if (target.invalid) return '没填匹配值'
          const exact = target.match === 'exact'
          if (target.kind === 'workspace') {
            const workspace = (state.targets.workspaces ?? []).find((item) => item.path === target.value)
            if (exact && workspace !== undefined) return workspace.title
            return `${MATCH_LABEL[target.match] ?? target.match} ${target.value}`
          }
          const session = (state.targets.sessions ?? []).find((item) => item.id === target.value)
          if (exact && session !== undefined) return `${session.title ?? '（没有标题）'} · ${shortSessionId(target.value)}`
          return `${MATCH_LABEL[target.match] ?? target.match} ${shortSessionId(target.value)}`
        }

        // Scope lives on its own line, split by type: many rows used to push the
        // card's ⋯ menu off the header.
        const scopeLine = (persona, kind, text) => {
          const rows = (persona.targets ?? []).filter((target) => target.kind === kind)
          if (rows.length === 0) return null
          return h('div', { className: 'wsp-scope-line', key: kind }, [
            h('span', { className: 'wsp-scope-label', key: 'l' }, text),
            ...rows.map((target, i) => h('span', {
              key: `t${i}`,
              className: target.invalid ? 'wsp-chip wsp-warn' : 'wsp-chip',
              title: target.invalid ? '这条规则没有匹配值，不会生效' : `${MATCH_LABEL[target.match] ?? target.match} ${target.value}`,
            }, targetLabel(target))),
          ])
        }

        const scopeLines = (persona) => h('div', { className: 'wsp-scope-lines', key: 'sl' }, (persona.targets ?? []).length === 0
          ? [h('div', { className: 'wsp-scope-line', key: 'default' }, [
            h('span', { className: 'wsp-scope-label', key: 'l' }, '范围'),
            h('span', { className: 'wsp-chip', key: 'c' }, '默认：所有没被别的 Agent 人设占用的会话'),
          ])]
          : [scopeLine(persona, 'workspace', '工作区'), scopeLine(persona, 'sessionId', '会话')])

        // ── expanded editor
        const draft = state.draft
        const cardBody = (persona) => {
          if (state.openId !== persona.id || draft === undefined) return null
          const targets = draft.targets || []
          const knownValues = new Set([
            ...(state.targets.workspaces ?? []).map((item) => item.path),
            ...(state.targets.sessions ?? []).map((item) => item.id),
          ])
          const titleOfPath = (path) => (state.targets.workspaces ?? []).find((item) => item.path === path)?.title ?? path
          const sessionOf = (id) => (state.targets.sessions ?? []).find((item) => item.id === id)

          const targetRows = targets.map((target, index) => {
            const key = `${persona.id}:${index}`
            // "自己输入…" is the only mode where a match mode makes sense: a value
            // picked from a list is always compared exactly.
            const isCustom = target.custom === true || (target.value !== '' && !knownValues.has(target.value))
            const picked = target.kind === 'workspace'
              ? (target.value === '' ? undefined : { label: titleOfPath(target.value) })
              : (target.value === '' ? undefined : { label: sessionOf(target.value)?.title ?? target.value })
            const session = target.kind === 'sessionId' && target.value !== '' ? sessionOf(target.value) : undefined
            const context = isCustom || target.value === ''
              ? undefined
              : (target.kind === 'workspace'
                ? target.value
                : [session?.cwd ?? null, session?.createdAt === null || session?.createdAt === undefined ? null : since(session.createdAt), target.value].filter(Boolean).join(' · '))
            return h('div', { className: 'wsp-scope-row', key: `t${index}` }, [
              h('div', { className: 'wsp-kind', key: 'k', role: 'group', 'aria-label': '选择类型' }, [
                h(Pill, { key: 'w', active: target.kind === 'workspace', onClick: () => this.setKind(index, 'workspace') }, '工作区'),
                h(Pill, { key: 's', active: target.kind === 'sessionId', onClick: () => this.setKind(index, 'sessionId') }, '某个会话'),
              ]),
              h(Menu, {
                key: 'p',
                open: state.picker === key,
                portal: true,
                items: target.kind === 'workspace' ? this.workspaceItems(persona.id) : this.sessionItems(persona.id),
                className: 'wsp-menu',
                ...(isCustom || target.value === '' ? {} : { selectedId: target.value }),
                footer: [
                  ...(target.kind === 'sessionId' && target.value !== ''
                    ? [{
                      id: '__history__',
                      icon: h(IconBrowseOutline16, {}),
                      label: h(Tooltip, { label: '打开这个会话最近聊过的内容（只读，不会改动任何东西）' },
                        h('span', { className: 'wsp-menu-tip', title: '打开这个会话最近聊过的内容（只读）' }, '查看这条会话的对话详情')),
                    }]
                    : []),
                  this.customItem(),
                ],
                onSelect: (id) => {
                  this.onChange({ picker: undefined })
                  if (id === '__history__') {
                    void this.openHistory(target.value)
                    return
                  }
                  this.pickTarget(index, id)
                },
                onClose: () => this.onChange({ picker: undefined }),
                anchor: h('button', {
                  type: 'button',
                  className: isCustom || target.value === '' ? 'wsp-picker wsp-picker-empty' : 'wsp-picker',
                  'aria-haspopup': 'menu',
                  'aria-expanded': state.picker === key,
                  onClick: () => this.togglePicker(key),
                }, [
                  h(isCustom ? IconEditOutline16 : target.kind === 'workspace' ? IconFolderOpen16 : IconListPenOutline16, { key: 'i' }),
                  h('span', { className: 'wsp-picker-label', key: 'l', title: isCustom ? undefined : picked?.label },
                    isCustom ? '自己输入…' : (picked?.label ?? (target.kind === 'workspace' ? '选择一个工作区…' : '选择一条会话…'))),
                  h(IconChevronDownOutline14, { key: 'c' }),
                ]),
              }),
              isCustom
                ? h('input', {
                  key: 'v',
                  className: targetValid(target) ? 'wsp-input wsp-input-mono wsp-scope-value' : 'wsp-input wsp-input-mono wsp-scope-value wsp-input-invalid',
                  value: target.value,
                  spellCheck: false,
                  'aria-label': '匹配值',
                  placeholder: target.kind === 'workspace'
                    ? (target.match === 'exact' ? '/Users/you/code/my-project' : target.match === 'regex' ? '^/Users/you/code/' : '/Users/you/code')
                    : (target.match === 'exact' ? 'session-id' : target.match === 'regex' ? '^im-bot-.*-g[0-9]+$' : 'im-bot-'),
                  onChange: (event) => this.patchTarget(index, { value: event.target.value, custom: true }),
                })
                : null,
              isCustom
                ? h('select', {
                  key: 'm',
                  className: 'wsp-select wsp-scope-match',
                  value: target.match,
                  'aria-label': '匹配方式',
                  onChange: (event) => this.patchTarget(index, { match: event.target.value }),
                }, (view.targetMatches || []).map((mode) => h('option', { key: mode, value: mode }, MATCH_LABEL[mode] ?? mode)))
                : null,
              h('button', {
                key: 'x',
                type: 'button',
                className: 'wsp-icon-btn',
                title: '删掉这一行',
                'aria-label': `删掉第 ${index + 1} 行`,
                onClick: () => this.removeTarget(index),
              }, h(IconCloseOutline16, {})),
            ], context === undefined ? null : h('div', { className: 'wsp-scope-context', key: 'c' }, context))
          })

          const tuneBlock = h(DisclosureRow, {
            key: 'tune',
            icon: h(IconEnhanceOutline16, {}),
            title: '用 AI 改一版',
            open: state.tuneOpen,
            expandable: true,
            onToggle: () => this.onChange({ tuneOpen: !state.tuneOpen }),
            expandOnRowClick: true,
            keepContentWhenOpen: true,
          }, state.tuneOpen ? h('div', { className: 'wsp-tune-fields', style: { paddingTop: '10px' } }, [
            h('div', { className: 'wsp-row-head', key: 'r', style: { padding: 0, minHeight: 'auto', gap: '8px' } }, [
              h('span', { className: 'wsp-label', key: 'l1' }, '模式'),
              h('select', {
                key: 'mode',
                className: 'wsp-select',
                value: state.tuneMode,
                'aria-label': '调优模式',
                onChange: (event) => this.onChange({ tuneMode: event.target.value }),
              }, MODES.map((item) => h('option', { key: item.value, value: item.value }, item.label))),
              h('span', { className: 'wsp-label', key: 'l2' }, '模型'),
              h('select', {
                key: 'model',
                className: 'wsp-select',
                value: state.model,
                'aria-label': '调优使用的模型',
                onChange: (event) => this.onChange({ model: event.target.value }),
              }, modelOptions),
              h('span', { className: 'wsp-spacer', key: 'sp' }),
              h(Button, {
                key: 'go',
                variant: 'outline',
                size: 'sm',
                disabled: busy,
                icon: h(IconEnhanceOutline16, {}),
                onClick: () => void this.tune(),
              }, state.busy === 'tune' ? '生成中…' : '生成建议'),
            ]),
            h(Input, {
              key: 'ins',
              value: state.instruction,
              placeholder: '补充要求（可选）：例如「先给结论再给证据」「加入禁止外传内部数据的约束」',
              'aria-label': '对 AI 的补充要求',
              onChange: (event) => this.onChange({ instruction: event.target.value }),
            }),
            h('span', { className: 'wsp-hint', key: 'h' }, `使用当前模型 ${state.model === '' ? '（DSH 默认）' : state.model} 生成一版建议，只显示在下面，不会自动保存。`),
            state.proposal === '' ? null : h('div', { className: 'wsp-proposal', key: 'prop' }, [
              h('div', { className: 'wsp-row-head', key: 'ph', style: { padding: 0, minHeight: 'auto' } }, [
                h('span', { className: 'wsp-label', key: 'l' }, 'AI 建议（还没保存）'),
                h('span', { className: 'wsp-spacer', key: 'sp' }),
                h(Button, { key: 'use', variant: 'primary', size: 'sm', onClick: () => this.onChange({ draft: Object.assign({}, draft, { text: state.proposal }), proposal: '', status: '建议已替换到编辑区' }) }, '采用'),
                h(Button, { key: 'app', variant: 'ghost', size: 'sm', onClick: () => this.onChange({ draft: Object.assign({}, draft, { text: `${draft.text.trim()}\n\n${state.proposal.trim()}\n` }), proposal: '', status: '建议已追加到编辑区' }) }, '追加'),
                h(Button, { key: 'drop', variant: 'ghost', size: 'sm', onClick: () => this.onChange({ proposal: '' }) }, '放弃'),
              ]),
              h('div', { className: 'wsp-proposal-body', key: 'pb' }, h(SafeMarkdown, { text: state.proposal })),
            ]),
          ]) : null)

          return h('div', { className: 'wsp-card-body', key: `b${persona.id}` }, [
            h('div', { className: 'wsp-field-row', key: 'name' }, [
              h('div', { className: 'wsp-field', key: 'f', style: { flex: 1 } }, [
                h('span', { className: 'wsp-label', key: 'l' }, '名称'),
                h(Input, {
                  key: 'i',
                  value: draft.name,
                  'aria-label': '人设名称',
                  placeholder: '例如：前端项目助手 / 安全值班 / 代码审查',
                  onChange: (event) => this.patchDraft({ name: event.target.value }),
                }),
              ]),
              h('div', { className: 'wsp-field', key: 'sw' }, [
                h('span', { className: 'wsp-label', key: 'l' }, '状态'),
                h(Switch, {
                  checked: draft.enabled,
                  label: draft.enabled ? '启用' : '停用',
                  onChange: (next) => this.patchDraft({ enabled: next }),
                }),
              ]),
            ]),
            h('div', { className: 'wsp-field-row', key: 'mode' }, [
              h('div', { className: 'wsp-field', key: 'f' }, [
                h('span', { className: 'wsp-label', key: 'l' }, '注入方式'),
                h('div', { className: 'wsp-kind', key: 'k', role: 'group', 'aria-label': '注入方式' }, [
                  h(Pill, { key: 'a', active: draft.mode !== 'replace', title: '两句都生效：先 DSH 自带身份，再这条人设', onClick: () => this.patchDraft({ mode: 'append' }) }, '追加'),
                  h(Pill, { key: 'r', active: draft.mode === 'replace', title: '只用这条人设：DSH 自带的身份句与部署身份都去掉（Agent 预设自己写的身份不动）', onClick: () => this.patchDraft({ mode: 'replace' }) }, '替换'),
                ]),
              ]),
              h('span', { className: 'wsp-hint', key: 'h', style: { flex: '1 1 200px', minWidth: '160px' } },
                draft.mode === 'replace'
                  ? '替换：DSH 自带的身份句和部署身份说明都去掉，只用这条人设。'
                  : '追加：DSH 自带的身份说明保留，这条人设接在后面。'),
            ]),
            h('div', { className: 'wsp-group', key: 'scope' }, [
              h('div', { className: 'wsp-row-head', key: 'gh', style: { padding: 0, minHeight: 'auto' } }, [
                h('span', { className: 'wsp-sect-title', key: 't' }, '用在哪些地方'),
                h('span', { className: 'wsp-spacer', key: 'sp' }),
                h('span', { className: 'wsp-hint', key: 'h' }, '满足任意一行就生效；越具体越优先（会话 > 工作区，精确 > 前缀/正则），同样具体才看列表顺序'),
              ]),
              ...targetRows,
              h('div', { className: 'wsp-row-head', key: 'add', style: { padding: 0, minHeight: 'auto' } }, [
                h(Button, {
                  key: 'add',
                  variant: 'ghost',
                  size: 'sm',
                  icon: h(IconPlusOutline16, {}),
                  onClick: () => this.addTarget(),
                }, '再加一个位置'),
                h('span', { className: 'wsp-spacer', key: 'sp' }),
                h('span', { className: targets.length === 0 ? 'wsp-hint wsp-warn' : 'wsp-hint', key: 'h' }, targets.length === 0
                  ? '一个位置都没加 → 这条人设会用在所有没被前面人设覆盖的会话上（相当于默认人设）'
                  : `共 ${targets.length} 个位置`),
              ]),
            ]),
            h('div', { className: 'wsp-field', key: 'body' }, [
              h('div', { className: 'wsp-row-head', key: 'bh', style: { padding: 0, minHeight: 'auto' } }, [
                h('span', { className: 'wsp-sect-title', key: 't' }, '人设内容（Markdown）'),
                h('span', { className: 'wsp-spacer', key: 'sp' }),
                h(Button, { key: 'e', variant: state.pane === 'edit' ? 'outline' : 'ghost', size: 'sm', onClick: () => this.onChange({ pane: 'edit' }) }, '编辑'),
                h(Button, { key: 'p', variant: state.pane === 'preview' ? 'outline' : 'ghost', size: 'sm', onClick: () => this.onChange({ pane: 'preview' }) }, '预览'),
              ]),
              h('div', { className: 'wsp-editor', key: 'ed' }, state.pane === 'edit'
                ? h('textarea', {
                  className: 'wsp-textarea',
                  'aria-label': '人设 Markdown 正文',
                  spellCheck: false,
                  placeholder: '在这里写人设。可以用 {{model}} 和 {{cwd}}，发送时会替换成当前的值。\n\n留空表示：这条人设匹配到的会话，不加任何人设。',
                  value: draft.text,
                  onChange: (event) => this.patchDraft({ text: event.target.value }),
                })
                : h('div', { className: 'wsp-preview' }, draft.text.trim() === ''
                  ? h('span', { className: 'wsp-preview-empty' }, '（正文为空 → 这些地方不加人设）')
                  : h(SafeMarkdown, { text: draft.text }))),
            ]),
            tuneBlock,
            h('div', { className: 'wsp-foot', key: 'foot' }, [
              h('span', { className: 'wsp-caption', key: 'c' }, `${draft.text.length} 字 · ⌘/Ctrl+S 保存`),
              h('div', { className: 'wsp-actions', key: 'a' }, [
                h(Button, { key: 'dup', variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void this.duplicate(draft.id) }, '复制'),
                state.confirmDelete === draft.id
                  ? h(Button, { key: 'del2', variant: 'ghost', size: 'sm', className: 'wsp-icon-btn-danger', disabled: busy, onClick: () => void this.remove(draft.id) }, '确认删除')
                  : h(Button, {
                    key: 'del',
                    variant: 'ghost',
                    size: 'sm',
                    className: 'wsp-icon-btn-danger',
                    disabled: busy,
                    icon: h(IconTrashOutline16, {}),
                    onClick: () => this.onChange({ confirmDelete: draft.id }),
                  }, '删除'),
                h('kbd', { className: 'wsp-kbd', key: 'kbd', title: '保存的快捷键' }, `${MOD_KEY}S`),
                h(Button, {
                  key: 'save',
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  title: `保存（${MOD_KEY}S）`,
                  ...(state.busy === 'save' ? {} : { icon: h(IconCheckOutline14, {}) }),
                  onClick: () => void this.save(),
                }, state.busy === 'save' ? '保存中…' : '保存'),
              ]),
            ]),
          ])
        }

        // Overlaps worth warning about: an exact row that an *earlier* persona's
        // pattern row also matches — that earlier row wins, so the exact claim
        // below never fires. Patterns are undecidable in general; this is the
        // detectable and actionable case.
        const conflicts = new Map()
        const patternHits = (row, kind, value) => {
          if (row.kind !== kind || row.value.trim() === '') return false
          const needle = row.value.trim()
          if (row.match === 'exact') return false
          if (row.match === 'prefix') return value.startsWith(needle)
          if (row.match === 'contains') return value.includes(needle)
          if (row.match === 'regex') {
            try {
              return new RegExp(needle).test(value)
            } catch {
              return false
            }
          }
          return false
        }
        const enabled = personas.filter((persona) => persona.enabled)
        for (let i = 0; i < enabled.length; i += 1) {
          for (let j = i + 1; j < enabled.length; j += 1) {
            const winner = enabled[i]
            const loser = enabled[j]
            for (const row of loser.targets ?? []) {
              if (row.match !== 'exact' || row.value.trim() === '') continue
              if (!(winner.targets ?? []).some((candidate) => patternHits(candidate, row.kind, row.value))) continue
              const notes = conflicts.get(loser.id) ?? []
              const note = `这条规则（${row.kind === 'workspace' ? '工作区' : '会话'} ${row.value}）会被上面的「${winner.name}」先命中`
              if (!notes.includes(note)) notes.push(note)
              conflicts.set(loser.id, notes)
            }
          }
        }

        const needle = state.filter.trim().toLowerCase()
        const matches = (persona) => [
          persona.name,
          ...(persona.targets ?? []).map((target) => targetLabel(target)),
          ...(persona.targets ?? []).map((target) => target.value),
        ].join(' ').toLowerCase().includes(needle)
        const visible = needle === '' ? personas : personas.filter(matches)
        const searchRow = personas.length < 4 ? null : h('div', { className: 'wsp-search', key: 'search' }, [
          h(Input, {
            value: state.filter,
            placeholder: '搜索人设：名称、工作区、会话',
            'aria-label': '搜索人设',
            onChange: (event) => this.onChange({ filter: event.target.value }),
          }),
          state.filter === '' ? null : h(Button, {
            key: 'clear',
            variant: 'ghost',
            size: 'sm',
            onClick: () => this.onChange({ filter: '' }),
          }, '清空'),
        ])

        const hidden = state.targets.hidden ?? { subagents: 0, archived: 0, blank: 0 }
        const hiddenTotal = (hidden.subagents ?? 0) + (hidden.archived ?? 0) + (hidden.blank ?? 0)
        const hiddenNote = hiddenTotal === 0 ? null
          : h('div', { className: 'wsp-filter-note', key: 'hidden' },
            `会话下拉里只列可交互的会话（已隐藏 ${hidden.subagents} 个子 agent、${hidden.archived} 个已归档、${hidden.blank} 个空会话）`)

        const conflictNotice = conflicts.size === 0 ? null : h('div', { className: 'wsp-conflict-notice', key: 'conflicts' }, [
          h(IconWarningOutline16, { key: 'i' }),
          `${conflicts.size} 条人设的范围可能被上面的人设先命中（鼠标悬停对应卡片看原因）`,
        ])

        const cards = personas.length === 0
          ? [h('div', { className: 'wsp-empty-card', key: 'empty' }, [
            h('span', { key: 't' }, '还没有人设。新建一条，选好它用在哪些工作区或会话上，再打开开关。'),
            h(Button, { key: 'new', variant: 'primary', size: 'sm', icon: h(IconPlusOutline16, {}), onClick: () => void this.create() }, '新建人设'),
          ])]
          : visible.length === 0
            ? [h('div', { className: 'wsp-empty-card', key: 'nomatch' }, `没有匹配「${state.filter}」的人设`)]
            : [...visible.map((persona, index) => h('div', {
            key: persona.id,
            className: [
              state.openId === persona.id ? 'wsp-card wsp-card-open' : 'wsp-card',
              needle !== '' ? '' : (state.dropIndex === index ? 'wsp-drop-before' : state.dropIndex === index + 1 ? 'wsp-drop-after' : ''),
              state.dragId === persona.id ? 'wsp-dragging' : '',
            ].filter(Boolean).join(' '),
            onDragOver: needle !== '' || state.dragId === undefined ? undefined : (event) => {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              const boundary = event.clientY > rect.top + rect.height / 2 ? index + 1 : index
              if (state.dropIndex !== boundary) this.onChange({ dropIndex: boundary })
            },
            onDrop: needle !== '' || state.dragId === undefined ? undefined : (event) => {
              event.preventDefault()
              void this.drop()
            },
          }, [
            cardHead(persona, index),
            state.openId === persona.id ? null : scopeLines(persona),
            cardBody(persona),
          ])), h('div', {
            className: 'wsp-add-row',
            key: 'add',
            role: 'button',
            tabIndex: 0,
            'aria-label': '新建人设',
            onClick: () => void this.create(),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                void this.create()
              }
            },
          }, [h(IconPlusOutline16, { key: 'i' }), h('span', { key: 't' }, busy ? '正在新建…' : '新建人设')])]

        // ── status
        // Success/failure feedback is a toast: it never reserves layout, so an idle
        // page has no empty bar sitting over the content.
        const status = state.error !== ''
          ? h('div', { className: 'wsp-status wsp-status-err', key: 'st', 'aria-live': 'polite' }, state.error)
          : state.status === ''
            ? null
            : h(Toast, {
              key: 'st',
              text: state.status,
              icon: h(IconCheckOutline14, {}),
              onDone: () => this.onChange({ status: '' }),
            })

        const history = state.history
        const historyModal = h(Modal, {
          key: 'history',
          className: 'wsp-chat-modal',
          contentClassName: 'wsp-chat-content',
          open: history !== undefined,
          onClose: () => this.onChange({ history: undefined }),
          title: history === undefined ? '' : (sessionById(history.id)?.title ?? `会话 ${history.id}`),
          description: history === undefined ? undefined : [
            history.cwd,
            `已显示 ${history.shown ?? 0} 条`,
            (history.skipped ?? 0) > 0 ? `已隐藏 ${history.skipped} 条插件注入内容（工作区指令、skill 目录等）` : null,
          ].filter(Boolean).join(' · '),
          footer: history === undefined || history.unavailable === true ? null : h('div', { className: 'wsp-actions', key: 'f' }, [
            h('span', { className: 'wsp-caption', key: 'c' }, history.mode === 'tail'
              ? `只显示最后一次往来（共 ${history.total ?? 0} 条消息，从结尾定位）`
              : history.done === true
                ? `已读完整条会话 · ${history.shown ?? 0} 条消息`
                : `已读到 ${history.shown ?? 0} 条（从会话开头顺序读）`),
            h(Button, {
              key: 'all',
              variant: 'ghost',
              size: 'sm',
              disabled: state.historyBusy !== undefined,
              onClick: () => void (history.mode === 'tail' ? this.readHeadHistory() : this.readTailHistory()),
            }, history.mode === 'tail' ? '从头看' : '跳到最新'),
            h(Button, {
              key: 'more',
              variant: 'outline',
              size: 'sm',
              disabled: state.historyBusy !== undefined || history.mode === 'tail' || history.done === true,
              onClick: () => void this.loadMoreHistory(),
            }, state.historyBusy === history.id ? '读取中…' : '继续读后面的'),
          ]),
        }, history === undefined ? null : (history.available === false
          ? h('div', { className: 'wsp-hint' }, history.error ?? (history.unavailable
            ? '宿主没有提供读取这条会话的接口（可能是 DSH 版本差异）。'
            : '这条会话里没有可显示的消息。'))
          : h('div', { className: 'wsp-chat' }, (history.messages ?? []).map((message, i) => {
            const mine = message.role === 'user'
            return h('div', { className: mine ? 'wsp-msg wsp-msg-mine' : 'wsp-msg', key: `m${i}` }, [
              h('span', { className: 'wsp-avatar', key: 'a', 'aria-hidden': 'true' },
                h(mine ? IconUserOutline16 : IconAgentPresetOutline16, {})),
              h('div', { className: 'wsp-msg-col', key: 'c' }, [
                h('span', { className: 'wsp-msg-who', key: 'w' }, [
                  mine ? '你' : 'Agent',
                  message.truncated === true ? ' · 太长已截断' : null,
                ]),
                h('div', { className: mine ? 'wsp-bubble wsp-bubble-mine' : 'wsp-bubble', key: 'b' },
                  h(SafeMarkdown, {
                    text: message.text,
                  })),
                message.truncated === true || message.expanded === true
                  ? h('button', {
                    key: 'exp',
                    type: 'button',
                    className: 'wsp-link-btn',
                    disabled: state.historyBusy === `msg:${i}`,
                    title: message.expanded === true ? '只显示前 1000 字' : '读取这条消息的完整内容（只重画这一个气泡）',
                    onClick: () => void (message.expanded === true ? this.collapseMessage(i) : this.expandMessage(i)),
                  }, state.historyBusy === `msg:${i}` ? '展开中…' : message.expanded === true ? '收起全文' : '展开全文')
                  : null,
              ]),
            ])
          }))))

        return h('div', rootProps, [header, searchRow, hiddenNote, conflictNotice, h('div', { className: 'wsp-cards', key: 'cards' }, cards), status, historyModal])
      }
    }

    // ── plugin ──────────────────────────────────────────────────────────────

    const inject = ['slots', 'remote']

    function apply(ctx) {
      const style = injectStyles()
      ctx.effect(() => () => style.remove(), `${NS}: styles`)

      // Register SYNCHRONOUSLY so the entry is live for the renderer's first pass.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'agent-persona',
        order: 30,
        label: () => '人设',
        inject: () => ({ api: capturedApi }),
      }, PersonaView))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: NS,
        order: 22,
        label: () => 'Agent人设',
        inject: () => ({ api: capturedApi }),
      }, WorkspacePersonaSection))

      // Mount the Remote namespace, then expose it to the already-registered pages.
      void (async () => {
        try {
          await ctx.remote.$mount(TYPERT_REMOTE)
          capturedApi = ctx.get('remote.agentPersona')
        } catch (error) {
          ctx.logger?.warn?.(`[${NS}] could not mount remote namespace: ${String(error)}`)
        }
      })()
    }

    module.exports = { name: NS, inject, apply }
    return module.exports
  },
})
