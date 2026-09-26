import type { ChromeAction } from './schema';
export function describeAction(action: ChromeAction): string {
  switch (action.action) {
    case 'browser_page': return `Open Chrome ${action.params.page}`;
    case 'organize_tabs': return action.params.operation === 'ungroup' ? 'Remove selected tabs from groups' : `Sort ungrouped tabs by ${action.params.operation === 'sort_title' ? 'title' : 'site'} after existing groups; keep pinned tabs first`;
    case 'wait_for_field': return `Wait up to 15 seconds for the “${action.params.query}” field`;
    case 'wait_for_page': return 'Wait up to 15 seconds for this page to finish loading';
    case 'tab_set': return `${action.params.operation === 'list' ? 'List' : 'Target'} ${action.params.indices ? 'tabs ' + action.params.indices.join(', ') : action.params.filter + ' tabs'} in ${action.params.scope === 'all' ? 'all windows' : 'this window'}${action.params.exclude_query ? ' except ' + action.params.exclude_query : ''}`;
    case 'create_tab': return `Open ${action.params.url === 'chrome://newtab/' ? 'a new tab' : action.params.url}`;
    case 'find_tab': return `${action.params.auto_switch === false ? 'Target' : 'Switch to'} the tab matching “${action.params.query}”`;
    case 'close_tab': return `Close ${action.params.target === 'matching' ? `all tabs matching “${action.params.query}” in this window` : action.params.target === 'all' ? 'all tabs in this window' : action.params.target === 'all_others' ? 'all other tabs in this window' : action.params.target === 'left' || action.params.target === 'right' ? `tabs to the ${action.params.target} in this window` : 'the current tab'}`;
    case 'window_state': return `Set window to ${action.params.state}`;
    case 'zoom': return `Zoom ${action.params.mode === 'set' ? `${Math.round((action.params.factor ?? 1) * 100)}%` : action.params.mode}`;
    case 'open_bookmark': return `Open bookmark ${action.params.query ?? `number ${action.params.index ?? 1}`}`;
    case 'bookmark_page': return `Bookmark page${action.params.folder ? ` in ${action.params.folder}` : ''}`;
    case 'navigate_history': return `Go ${action.params.direction}`;
    case 'mute_tab': return action.params.toggle ? 'Toggle tab audio' : action.params.mute === false ? 'Unmute tab' : 'Mute tab';
    case 'pin_tab': return action.params.toggle ? 'Toggle tab pin' : action.params.pin === false ? 'Unpin tab' : 'Pin tab';
    case 'reload_tab': return action.params.bypass_cache ? 'Reload without cache' : 'Reload tab';
    case 'duplicate_tab': return 'Duplicate tab';
    case 'select_tab': return `${action.params.activate === false ? 'Target' : 'Switch to'} ${action.params.position === 'index' ? `tab ${action.params.index}${action.params.from_end ? ' from the right' : ''}` : action.params.offset ? `${action.params.offset} tabs ${action.params.position === 'next' ? 'forward' : 'back'}` : `the ${action.params.position} tab`} in this window`;
    case 'move_tab': return `Move tab ${action.params.position === 'index' ? `to position ${action.params.index}` : action.params.position === 'first' ? 'to the beginning' : action.params.position === 'last' ? 'to the end' : `${action.params.steps ?? 1} place${action.params.steps === 1 ? '' : 's'} to the ${action.params.position}`}`;
    case 'reopen_tab': return 'Reopen the last closed tab';
    case 'open_site': return `${action.params.new_tab ? 'Open another tab for' : 'Open or switch to'} ${action.params.site}`;
    case 'search_site': return `Search ${action.params.site} ${action.params.query ? `for “${action.params.query}”` : '· ask for search words'}`;
    case 'site_alias': return `Name this site “${action.params.name}”`;
    case 'macro_add_site': return `Add this site to ${action.params.name}`;
    case 'reference_tabs': return `Use ${action.params.reference === 'it' ? 'the referenced tab' : 'the referenced tabs'}`;
    case 'select_tabs': return `Select ${action.params.queries.join(', ')}`;
    case 'move_beside': return `Move next to ${action.params.query}`;
    case 'undo_action': return `Undo ${action.params.kind ?? 'the last supported change'}`;
    case 'page_action': {
      const p = action.params;
      if (p.operation === 'show_headings') return 'Choose a heading from the page outline';
      if (p.operation === 'show_landmarks') return 'Choose a page region';
      if (['next_heading', 'previous_heading', 'next_landmark', 'previous_landmark'].includes(p.operation)) return `Go to the ${p.operation.replace('_', ' ').replace('landmark', 'page region')}`;
      if (p.operation === 'go_heading' || p.operation === 'go_landmark') return `Go to ${p.operation === 'go_heading' ? 'heading' : 'page region'} ${p.index ?? `“${p.query}”`}`;
      if (p.operation === 'select_text') return `Select “${p.query}” in the focused field`;
      if (p.operation === 'replace_text') return `Replace “${p.query}” with “${p.text}” in the focused field`;
      if (p.operation === 'cursor_start' || p.operation === 'cursor_end') return `Move the cursor to the ${p.operation === 'cursor_start' ? 'start' : 'end'} of the focused field`;
      if (p.operation === 'cursor_before' || p.operation === 'cursor_after') return `Move the cursor ${p.operation === 'cursor_before' ? 'before' : 'after'} “${p.query}” in the focused field`;
      return p.operation.replaceAll('_', ' ') + (p.query ? ` “${p.query}”` : '') + (p.index !== undefined ? ` number ${p.index}` : '') + (p.text !== undefined ? ` with “${p.text}”` : '') + (p.value !== undefined ? ` ${p.relative ? 'by ' : 'to '}${p.value}${p.operation === 'media_volume' ? ' percent' : ' seconds'}` : '') + (p.direction ? ` ${p.direction}` : '');
    }
    case 'group_action': return `${action.params.operation.replaceAll('_', ' ')} group ${action.params.name}${action.params.color ? ` · ${action.params.color}` : action.params.new_name ? ` to ${action.params.new_name}` : ''}`;
    case 'workspace_action': return action.params.operation === 'discard_previous' ? `Review discarding the previous saved version of ${action.params.name ?? 'a workspace'}` : `${action.params.operation} workspace ${action.params.name ?? ''}${action.params.new_name ? ` to ${action.params.new_name}` : ''}`;
    case 'reading_action': return `${action.params.operation.replaceAll('_', ' ')} in the reading list`;
    case 'audio_action': return action.params.operation === 'mute_others' ? 'Mute other tabs' : 'Find audible tabs';
    case 'duplicates_action': return `${action.params.operation === 'close' ? 'Review and close' : 'Show'} duplicate tabs`;
    case 'help': return 'Show available commands';
    case 'create_window': return action.params.with_current_tab ? 'Move tab to a new window' : 'Open a new window';
  }
}
