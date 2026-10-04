import { describe, expect, it } from 'vitest';
import { commandRows, NOT_SET, SORT_COMMAND_LABEL } from './command-rows';

describe('commandRows', () => {
  it('names the built-in icon-click command, which Chrome leaves without a description', () => {
    expect(commandRows([{ name: '_execute_action', description: '', shortcut: '' }])).toEqual([
      { name: SORT_COMMAND_LABEL, shortcut: NOT_SET },
    ]);
  });

  it('lists sorting first and keeps the others in the order Chrome gave them', () => {
    const rows = commandRows([
      { name: 'save-session', description: 'Save the current window as a session', shortcut: '' },
      { name: 'assemble-tabs', description: 'Move the tabs', shortcut: 'Alt+A' },
      { name: '_execute_action', description: '', shortcut: 'Alt+Shift+S' },
    ]);
    expect(rows).toEqual([
      { name: SORT_COMMAND_LABEL, shortcut: 'Alt+Shift+S' },
      { name: 'Save the current window as a session', shortcut: NOT_SET },
      { name: 'Move the tabs', shortcut: 'Alt+A' },
    ]);
  });

  it('falls back to the command name when there is no description', () => {
    expect(commandRows([{ name: 'mystery' }])).toEqual([{ name: 'mystery', shortcut: NOT_SET }]);
  });
});
