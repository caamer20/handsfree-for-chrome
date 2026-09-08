import styles from './hud.css?inline';
import type { HudState } from '../common/schema';
export class FloatingHud {
  private host = document.createElement('div');
  private pill = document.createElement('div');
  private symbol = document.createElement('span');
  private copy = document.createElement('span');
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    this.host.id = 'handsfree-chrome-hud-root';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style'); style.textContent = styles;
    this.pill.className = 'pill'; this.pill.setAttribute('role', 'status'); this.pill.setAttribute('aria-live', 'polite');
    this.symbol.className = 'symbol'; this.symbol.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    const label = document.createElement('span'); label.className = 'label'; label.textContent = 'HandsFree';
    this.copy.className = 'copy';
    text.append(label, this.copy); this.pill.append(this.symbol, text); shadow.append(style, this.pill);
    document.documentElement.append(this.host);
  }
  update(state: HudState): void {
    clearTimeout(this.timer);
    this.copy.textContent = state.text;
    this.symbol.replaceChildren();
    if (state.phase === 'listening') {
      for (let i = 0; i < 3; i++) { const bar = document.createElement('span'); bar.className = 'bar'; this.symbol.append(bar); }
    } else this.symbol.textContent = state.phase === 'success' ? '✓' : state.phase === 'error' ? '!' : state.phase === 'review' ? '?' : '•••';
    this.pill.className = `pill visible ${state.phase}`;
    if (!['listening', 'thinking'].includes(state.phase)) this.timer = setTimeout(() => { this.pill.classList.remove('visible'); }, state.phase === 'success' || state.phase === 'idle' ? 2000 : 5000);
  }
  destroy(): void { clearTimeout(this.timer); this.host.remove(); }
}
