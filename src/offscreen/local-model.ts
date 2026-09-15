import { env, pipeline, type TextGenerationPipeline, InterruptableStoppingCriteria } from '@huggingface/transformers';
import type { ChromeAction } from '../common/schema';
import { parseModelPlan } from './json-plan';
import { validateGrounding } from './grounding';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');
env.useBrowserCache = false; // Packaged weights already live on disk; avoid a second persistent copy.
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.wasmPaths = chrome.runtime.getURL('ort/');
  wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  wasm.proxy = false;
}

const SYSTEM_PROMPT = `Translate a browser command to a JSON array. Output JSON only. No prose. No code. Use only the following actions and parameters:
browser_page: {"page":"downloads|history|bookmarks|settings|extensions"}
organize_tabs: {"operation":"ungroup|sort_title|sort_site"}
wait_for_page: {}
wait_for_field: {"query":"exact field label"}
create_tab: {"url":"https://...","active":true}
close_tab: {"target":"current|all_others|left|right|all|matching","query":"name only for matching"}
find_tab: {"query":"words","auto_switch":true}
select_tab: {"position":"next|previous|first|last|index","index":3,"activate":true}. Optional offset counts next/previous tabs; optional from_end:true counts an index from the right.
move_tab: {"position":"left|right|first|last|index","index":3}. Optional steps counts places when moving left/right.
reopen_tab: {}
create_window: {"with_current_tab":false}
duplicate_tab: {}
reload_tab: {"bypass_cache":false}
mute_tab: {"mute":true} or {"toggle":true}
pin_tab: {"pin":true} or {"toggle":true}
window_state: {"state":"maximized|minimized|fullscreen|normal"}
zoom: {"mode":"in|out|reset|set","factor":1.25}
bookmark_page: {"title":"optional title","folder":"optional folder"}
open_bookmark: {"query":"words"} or {"index":1}
navigate_history: {"direction":"back|forward"}
open_site: {"site":"spoken site or nickname","new_tab":false}
search_site: {"site":"Wikipedia","query":"spoken search terms"}
reference_tabs: {"reference":"it|them|these|other|previous","activate":false}. Use activate:true only to switch to a referenced tab.
select_tabs: {"queries":["Gmail","YouTube"],"all_matches":false}
move_beside: {"query":"Gmail","side":"before|after"}
undo_action: {"kind":"move|pin|mute|zoom"}
site_alias: {"name":"nickname"}
macro_add_site: {"name":"routine name"}
page_action: {"operation":"scroll|find|find_next|find_previous|show_links|activate|hide_links|focus|type|fill|clear|select_all|delete_selection|next_field|previous_field|show_fields|select_option|check|uncheck|dictate_start|dictate_stop|media_play|media_pause|media_seek|media_volume|help","query":"optional exact label or search","text":"optional literal text","index":5,"direction":"up|down|left|right|top|bottom","amount":"little|half|page|repeat","value":10,"relative":true}
group_action: {"operation":"create|add|collapse|expand|rename|move_window|color|ungroup","name":"group name","new_name":"optional new name","color":"optional grey|blue|red|yellow|green|pink|purple|cyan|orange"}
workspace_action: {"operation":"save|restore|list","name":"optional workspace name"}
reading_action: {"operation":"save|list|open_unread|mark_read|mark_unread"}
audio_action: {"operation":"list|focus|mute_others","query":"optional tab name"}
duplicates_action: {"operation":"show|close"}
tab_set: {"operation":"target|list","filter":"all|pinned|unpinned|muted|unmuted|audible","scope":"window|all","exclude_query":"optional spoken tab name","indices":[2,3,4]}
help: {}
fill replaces entire field text; type inserts text. select_option uses text for the full option label and query for the dropdown label. check/uncheck set checkbox states. Omit search_site.query when the user has not given search words; the extension asks locally. Use wait_for_page only for a requested page-load wait. Every array item has exactly {"action":"name","params":{...}}. Choose one enum value, never a list with pipes. Omit optional fields if unnecessary. Never invent URLs. Use Google https://www.google.com/search?q=QUERY, YouTube https://www.youtube.com/results?search_query=QUERY, GitHub https://github.com/search?q=QUERY with percent-encoded QUERY. A compound search is one create_tab. Named tab actions require find_tab with auto_switch:false BEFORE the requested mutation. Never close the current tab if the user named a different tab. Tab indexes start at 1. Unsupported commands return [].`;

export class LocalIntentModel {
  private generator: TextGenerationPipeline | null = null;
  private loading: Promise<TextGenerationPipeline> | null = null;
  private stop = new InterruptableStoppingCriteria();
  private disposed = false;
  private generating = false;

  private async initialize(status: (message: string) => void): Promise<TextGenerationPipeline> {
    if (this.generator) return this.generator;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      let gpu = false;
      try { gpu = !!(await navigator.gpu?.requestAdapter()); } catch { /* Use WASM. */ }
      const load = async (device: 'webgpu' | 'wasm', dtype: 'q4' | 'q8'): Promise<TextGenerationPipeline> => {
        status(device === 'webgpu' ? 'Warming up local AI on your GPU…' : 'Warming up local AI on your CPU…');
        const generator = await pipeline('text-generation', 'smollm2-135m-quant', { device, dtype, local_files_only: true });
        this.generator = generator;
        // One-token generation precompiles shaders; no cache is carried into user commands.
        await generator('Hello', { max_new_tokens: 1, do_sample: false, return_full_text: false, return_dict_in_generate: false });
        if (this.disposed) { await generator.dispose(); this.generator = null; throw new Error('Command cancelled.'); }
        return generator;
      };
      if (gpu) {
        try { return await load('webgpu', 'q4'); }
        catch (error) {
          await this.generator?.dispose().catch(() => undefined); this.generator = null;
          if (this.disposed) throw error;
          status('GPU unavailable. Switching to local CPU inference…');
        }
      }
      return load('wasm', 'q8');
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }
  async parse(transcript: string, status: (message: string) => void): Promise<{ actions: ChromeAction[]; source: 'grammar' | 'model' }> {
    if (this.disposed) throw new Error('Command cancelled.');
    const generator = await this.initialize(status);
    this.stop.reset();
    status('Interpreting your command locally…');
    this.generating = true;
    try {
      const options = { max_new_tokens: 192, do_sample: false, return_full_text: false, return_dict_in_generate: false, stopping_criteria: [this.stop] };
      const output = await generator([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Make this tab quiet' },
        { role: 'assistant', content: '[{"action":"mute_tab","params":{"mute":true}}]' },
        { role: 'user', content: 'Take me to the tab with design notes' },
        { role: 'assistant', content: '[{"action":"find_tab","params":{"query":"design notes","auto_switch":true}}]' },
        { role: 'user', content: transcript },
      ], options);
      if (this.disposed || this.stop.interrupted) throw new Error('Command cancelled.');
      const first = output[0];
      const generated = first && !Array.isArray(first) ? first.generated_text : undefined;
      const text = typeof generated === 'string' ? generated : generated?.at(-1)?.content;
      if (typeof text !== 'string') throw new Error('The model returned no command.');
      return { actions: validateGrounding(parseModelPlan(text), transcript), source: 'model' };
    } catch (error) {
      // Failed inference may leave internal tensors. Release the entire session.
      await this.generator?.dispose().catch(() => undefined); this.generator = null;
      throw error;
    } finally { this.generating = false; }
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.stop.interrupt();
    // Document closure is the hard-stop fallback for a loading or busy session.
    if (!this.loading && !this.generating && this.generator) { await this.generator.dispose(); this.generator = null; }
  }
}
