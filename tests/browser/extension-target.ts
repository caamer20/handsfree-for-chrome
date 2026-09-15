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
    const point = await this.evaluate<{ x: number; y: number }>(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({ block: 'center' }); const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
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
