// Remappable controls: keyboard / mouse buttons on PC, controller buttons on Meta Quest.
// One shared, saved set that the input code reads live and both settings menus (the page
// and the in-headset pause menu) edit.
//
// Actions that only apply while paddling ('prone') can share an input with ones that only
// apply while surfing ('standing'), like the defaults do: Ctrl duck dives when you're lying
// down and crouches when you're standing. Anything else that clashes gets swapped.

const STORE = 'lineup.bindings';

// PC: two slots per action (key, alternate). Codes are KeyboardEvent.code values, except
// modifiers (one name for both sides) and mouse buttons ('Mouse0'..'Mouse4').
export const PC_ACTIONS = [
  { id: 'left', label: 'Steer / carve left', when: 'any', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Steer / carve right', when: 'any', keys: ['KeyD', 'ArrowRight'] },
  { id: 'forward', label: 'Lean forward · walk to the nose · lie back down', when: 'any', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Lean back · walk to the tail · sit up and wait', when: 'any', keys: ['KeyS', 'ArrowDown'] },
  { id: 'popup', label: 'Pop up / lie down', when: 'any', keys: ['Space', ''] },
  { id: 'duck', label: 'Duck dive (while paddling)', when: 'prone', keys: ['Control', 'KeyC'] },
  { id: 'crouch', label: 'Crouch (while surfing)', when: 'standing', keys: ['Control', 'KeyC'] },
  { id: 'charge', label: 'Trick: hold, then flick the mouse', when: 'standing', keys: ['Shift', ''] },
  { id: 'lineup', label: 'Back to the lineup', when: 'any', keys: ['KeyR', ''] },
];

// Keys that can't be bound: Esc is the pause key, the rest belong to the browser.
export const RESERVED_KEYS = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu']);

// Quest: one button per action, from one hand or either.
export const QUEST_BUTTON_INDEX = { trigger: 0, grip: 1, stick: 3, primary: 4, secondary: 5 }; // xr-standard gamepad
export const QUEST_ACTIONS = [
  { id: 'pause', label: 'Pause menu', when: 'any', def: 'secondary:left', required: true },
  { id: 'lineup', label: 'Back to the lineup', when: 'any', def: 'secondary:right' },
  { id: 'recalibrate', label: 'Recalibrate paddling height', when: 'any', def: 'trigger:any' },
  { id: 'popup', label: "Pop up / lie down (if you can't stand up)", when: 'any', def: 'primary:any' },
  { id: 'duck', label: 'Duck dive: hold with a hand on the nose', when: 'prone', def: 'grip:any' },
  { id: 'charge', label: 'Trick: hold, then whip your head round', when: 'standing', def: 'grip:any' },
];
const QUEST_BUTTON_NAMES = {
  trigger: { any: 'Either trigger', left: 'Left trigger', right: 'Right trigger' },
  grip: { any: 'Either grip', left: 'Left grip', right: 'Right grip' },
  primary: { any: 'A or X', left: 'X', right: 'A' },
  secondary: { any: 'B or Y', left: 'Y', right: 'B' },
  stick: { any: 'Either stick click', left: 'Left stick click', right: 'Right stick click' },
};
export const QUEST_OPTIONS = ['none', ...Object.keys(QUEST_BUTTON_NAMES).flatMap((b) => ['any', 'right', 'left'].map((h) => `${b}:${h}`))];

const MODIFIERS = { ControlLeft: 'Control', ControlRight: 'Control', ShiftLeft: 'Shift', ShiftRight: 'Shift', AltLeft: 'Alt', AltRight: 'Alt' };
export const normCode = (code) => MODIFIERS[code] || code;

const KEY_NAMES = {
  Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse back', Mouse4: 'Mouse forward',
};
export function keyLabel(code) {
  if (!code) return '';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export function questLabel(value) {
  if (!value || value === 'none') return 'Not set';
  const [b, h] = value.split(':');
  return (QUEST_BUTTON_NAMES[b] && QUEST_BUTTON_NAMES[b][h]) || value;
}

// ---------------------------------------------------------------- state
const defaultsPC = () => Object.fromEntries(PC_ACTIONS.map((a) => [a.id, [...a.keys]]));
const defaultsQuest = () => Object.fromEntries(QUEST_ACTIONS.map((a) => [a.id, a.def]));

function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
  } catch (e) {
    /* storage unavailable */
  }
  const pc = defaultsPC();
  for (const a of PC_ACTIONS) {
    const k = saved.pc && saved.pc[a.id];
    if (Array.isArray(k)) pc[a.id] = [String(k[0] || ''), String(k[1] || '')];
  }
  const quest = defaultsQuest();
  for (const a of QUEST_ACTIONS) {
    const v = saved.quest && saved.quest[a.id];
    if (QUEST_OPTIONS.includes(v) && !(a.required && v === 'none')) quest[a.id] = v;
  }
  return { pc, quest };
}

export const controls = {
  ...load(),
  listeners: new Set(),
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  _changed() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ pc: this.pc, quest: this.quest }));
    } catch (e) {
      /* storage unavailable */
    }
    for (const fn of this.listeners) fn(this);
  },

  // PC: is any key bound to this action?
  pcHas(id, code) {
    return this.pc[id].includes(code);
  },

  // Bind `code` to slot 0/1 of a PC action. Other actions that had the key get this slot's
  // old key instead. Returns those as [{ label, now }].
  setPC(id, slot, code) {
    code = code ? normCode(code) : '';
    const old = this.pc[id][slot];
    if (code === old) return [];
    const moved = [];
    this.pc[id][slot] = code;
    if (code) {
      const me = PC_ACTIONS.find((a) => a.id === id);
      for (const a of PC_ACTIONS) {
        if (a.id === id || !overlaps(a.when, me.when)) continue;
        const i = this.pc[a.id].indexOf(code);
        if (i < 0) continue;
        // take the old key, unless something active at the same time already uses it
        const free = old && !PC_ACTIONS.some((c) => c.id !== a.id && overlaps(c.when, a.when) && this.pc[c.id].includes(old)) && !this.pc[a.id].includes(old);
        this.pc[a.id][i] = free ? old : '';
        moved.push({ label: a.label, now: this.pcText(a.id) });
      }
      // the same key in both of this action's slots is pointless
      if (this.pc[id][1 - slot] === code) this.pc[id][1 - slot] = '';
    }
    this._changed();
    return moved;
  },

  // Quest: bind a button ('grip:left', 'none' ...). Returns { moved: [{ label, now }], refused }.
  setQuest(id, value) {
    const me = QUEST_ACTIONS.find((a) => a.id === id);
    if (!QUEST_OPTIONS.includes(value) || (me.required && value === 'none')) return { moved: [], refused: `${me.label} needs a button` };
    const old = this.quest[id];
    if (value === old) return { moved: [] };
    // actions that lose the button take this one's old button, unless something active at
    // the same time already uses that (then they're left unset)
    const next = { ...this.quest, [id]: value };
    const moved = [];
    for (const a of QUEST_ACTIONS) {
      if (a.id === id || !overlaps(a.when, me.when) || !questClash(next[a.id], value)) continue;
      const free = !QUEST_ACTIONS.some((c) => c.id !== a.id && overlaps(c.when, a.when) && questClash(next[c.id], old));
      next[a.id] = free ? old : 'none';
      if (a.required && next[a.id] === 'none') return { moved: [], refused: `That button opens the ${a.label.toLowerCase()}: give that a different button first` };
      moved.push({ label: a.label, now: questLabel(next[a.id]) });
    }
    this.quest = next;
    this._changed();
    return { moved };
  },

  resetPC() {
    this.pc = defaultsPC();
    this._changed();
  },

  resetQuest() {
    this.quest = defaultsQuest();
    this._changed();
  },

  // 'Space', 'Ctrl or C' ... for hints
  pcText(id) {
    return this.pc[id].filter(Boolean).map(keyLabel).join(' or ') || 'nothing';
  },

  // just the main key, for short hints
  pcKey(id) {
    return keyLabel(this.pc[id].find(Boolean)) || 'unbound';
  },

  questText(id) {
    return questLabel(this.quest[id]);
  },
};

function overlaps(a, b) {
  return a === 'any' || b === 'any' || a === b;
}

// do two Quest bindings share a physical button?
function questClash(a, b) {
  if (!a || !b || a === 'none' || b === 'none') return false;
  const [ba, ha] = a.split(':');
  const [bb, hb] = b.split(':');
  return ba === bb && (ha === 'any' || hb === 'any' || ha === hb);
}

// Keyboard codes to lock in fullscreen (so Ctrl+W etc. reach the game).
export function lockCodes() {
  const out = new Set();
  for (const keys of Object.values(controls.pc)) {
    for (const k of keys) {
      if (!k || k.startsWith('Mouse')) continue;
      if (k === 'Control' || k === 'Shift' || k === 'Alt') out.add(`${k}Left`).add(`${k}Right`);
      else out.add(k);
    }
  }
  return [...out];
}
