import { expect, type CDPSession, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

/** Playwright omits native extension widgets from context.pages(); attach via public CDP. */
export class ExtensionTarget {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private onMessage = (event: { sessionId: string; message: string }): void => {
    if (event.sessionId !== this.sessionId) return;
    const message = JSON.parse(event.message) as { id?: number; result?: unknown; error?: { message: string } };
    if (!message.id) return;
    const call = this.pending.get(message.id); if (!call) return;
    clearTimeout(call.timer); this.pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message)); else call.resolve(message.result);
  };
  private constructor(private connection: CDPSession, private sessionId: string) { connection.on('Target.receivedMessageFromTarget', this.onMessage); }

  static async attach(control: Page, suffix: string): Promise<ExtensionTarget> {
    const connection = await control.context().newCDPSession(control);
    const own = (await connection.send('Target.getTargetInfo')).targetInfo.targetId;
    let id: string | undefined;
    await expect.poll(async () => {
      id = (await connection.send('Target.getTargets')).targetInfos.find(target => target.targetId !== own && target.url.endsWith(suffix))?.targetId;
      return !!id;
    }).toBe(true);
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId: id!, flatten: false });
    return new ExtensionTarget(connection, sessionId);
  }
  async send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.sequence;
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Extension target timed out: ${method}`)); }, 15_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    });
    try { await this.connection.send('Target.sendMessageToTarget', { sessionId: this.sessionId, message: JSON.stringify({ id, method, params }) }); }
    catch (error) { const call = this.pending.get(id); if (call) { clearTimeout(call.timer); this.pending.delete(id); call.reject(error instanceof Error ? error : new Error(String(error))); } }
    return result;
  }
  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  async click(selector: string): Promise<void> {
    type ClickLayout = { ready: boolean; x: number; y: number; width: number; height: number; rect: number[]; hit: string; reason: string; };
    let point = { x: 0, y: 0 }; let previous = ''; let stableSince = 0;
    await this.evaluate(`(() => {
      globalThis.__handsfreePointerProbe?.cleanup();
      const selector = ${JSON.stringify(selector)}; const events = []; const layouts = [];
      const geometry = () => {
        const element = document.querySelector(selector); const r = element?.getBoundingClientRect();
        const viewport = visualViewport;
        return { width: innerWidth, height: innerHeight, scrollX, scrollY, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
          viewport: viewport && { width: viewport.width, height: viewport.height, offsetLeft: viewport.offsetLeft, offsetTop: viewport.offsetTop, scale: viewport.scale },
          rect: r && [r.left, r.top, r.right, r.bottom], disabled: element?.matches(':disabled'), visibility: document.visibilityState, focused: document.hasFocus() };
      };
      const record = event => {
        const element = document.querySelector(selector); const target = event.target;
        events.push({ type: event.type, trusted: event.isTrusted, inside: !!element && event.composedPath().includes(element),
          target: target instanceof Element ? target.tagName + (target.id ? '#' + target.id : '') : String(target),
          x: event.clientX, y: event.clientY, button: event.button, geometry: geometry() });
        if (events.length > 20) events.shift();
      };
      const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
      types.forEach(type => document.addEventListener(type, record, { capture: true, passive: true }));
      globalThis.__handsfreePointerProbe = { layouts, cleanup: () => types.forEach(type => document.removeEventListener(type, record, true)),
        snapshot: () => ({ selector, events, layouts, geometry: geometry(), error: document.querySelector('#error')?.textContent,
          delivered: events.some(event => event.type === 'click' && event.trusted && event.inside) }) };
    })()`);
    // Settle the actual pointer together with the widget. Hover/native hit-test
    // changes must happen before the one press/release, not after the last poll.
    await expect.poll(async () => {
      const layout = await this.evaluate<ClickLayout>(`(async () => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return { ready: false, x: 0, y: 0, width: innerWidth, height: innerHeight, rect: [], hit: '', reason: 'Element is missing' };
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const r = element.getBoundingClientRect();
        const left = Math.max(0, r.left); const right = Math.min(innerWidth, r.right);
        const top = Math.max(0, r.top); const bottom = Math.min(innerHeight, r.bottom);
        const x = (left + right) / 2; const y = (top + bottom) / 2;
        const hit = document.elementFromPoint(x, y); const style = getComputedStyle(element);
        const visible = document.visibilityState === 'visible' && right > left && bottom > top && style.visibility === 'visible' && style.display !== 'none';
        const enabled = !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true';
        const receivesPointer = hit === element || !!hit && element.contains(hit);
        const layout = { ready: visible && enabled && receivesPointer, x, y, width: innerWidth, height: innerHeight, rect: [r.left, r.top, r.right, r.bottom], hit: hit ? hit.tagName + (hit.id ? '#' + hit.id : '') : '', reason: !visible ? 'Element is outside the visible viewport' : !enabled ? 'Element is disabled' : !receivesPointer ? 'Another element covers the click point' : '' };
        const layouts = globalThis.__handsfreePointerProbe.layouts; layouts.push(layout); if (layouts.length > 12) layouts.shift();
        return layout;
      })()`);
      const key = JSON.stringify([layout.width, layout.height, layout.rect, layout.x, layout.y]);
      if (!layout.ready || key !== previous) { previous = key; stableSince = performance.now(); }
      point = { x: layout.x, y: layout.y };
      const stable = layout.ready && performance.now() - stableSince >= 500;
      if (layout.ready) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'none', buttons: 0, ...point });
      return { ...layout, stable };
    }, { timeout: 10_000, intervals: [50, 100, 100], message: `Wait for native extension target ${selector} to be ready for a pointer click` }).toMatchObject({ ready: true, stable: true });
    const hitStillCurrent = await this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)}); const hit = document.elementFromPoint(${point.x}, ${point.y});
      return !!element && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true' && (hit === element || !!hit && element.contains(hit));
    })()`);
    if (!hitStillCurrent) throw new Error(`Native pointer target changed before pressing: ${JSON.stringify(await this.pointerDiagnostics())}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point });
    const diagnostics = await this.pointerDiagnostics();
    expect(diagnostics, 'A single real pointer sequence must deliver a trusted click to the requested native control').toMatchObject({ delivered: true });
  }
  async pointerDiagnostics(): Promise<unknown> {
    return this.evaluate('globalThis.__handsfreePointerProbe?.snapshot() ?? null');
  }
  async screenshot(path: string): Promise<void> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(data, 'base64'));
  }
  async detach(): Promise<void> {
    this.connection.off('Target.receivedMessageFromTarget', this.onMessage);
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error('Extension target detached')); }
    this.pending.clear(); await this.connection.detach();
  }
}
