import type { SlashCommandExecution } from '../server/commands/slash-command-parser';
import type { AppElements } from './app-elements';
import { CommandHistory } from './command-history';

type ShellElements = Pick<
  AppElements,
  'commandShell' | 'commandLog' | 'commandForm' | 'commandInput' | 'commandStatus'
>;

type DebugCommandShellOptions = {
  elements: ShellElements;
  execute: (input: string) => Promise<SlashCommandExecution>;
  onOpen: () => void;
};

type HistoryEntry = { input: string; state: 'success' | 'error'; summary: string };

const HISTORY_LIMIT = 20;

export class DebugCommandShell {
  private readonly commandHistory = new CommandHistory(HISTORY_LIMIT);
  private readonly outputHistory: HistoryEntry[] = [];
  private running = false;

  constructor(private readonly options: DebugCommandShellOptions) {
    options.elements.commandForm.onsubmit = (event) => {
      event.preventDefault();
      void this.submit();
    };
    options.elements.commandInput.onkeydown = (event) => {
      event.stopPropagation();
      if (event.code === 'Escape' || event.code === 'F4') {
        event.preventDefault();
        this.close();
      } else if (event.code === 'ArrowUp') {
        event.preventDefault();
        this.replaceInput(this.commandHistory.previous(options.elements.commandInput.value));
      } else if (event.code === 'ArrowDown') {
        event.preventDefault();
        this.replaceInput(this.commandHistory.next(options.elements.commandInput.value));
      }
    };
    options.elements.commandInput.onkeyup = (event) => event.stopPropagation();
    options.elements.commandInput.oninput = () => this.commandHistory.resetNavigation();
  }

  get isOpen(): boolean {
    return !this.options.elements.commandShell.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.options.onOpen();
    this.options.elements.commandShell.hidden = false;
    this.options.elements.commandInput.focus();
  }

  close(): void {
    this.options.elements.commandShell.hidden = true;
    this.options.elements.commandInput.blur();
  }

  dispose(): void {
    this.close();
    this.options.elements.commandForm.onsubmit = null;
    this.options.elements.commandInput.onkeydown = null;
    this.options.elements.commandInput.onkeyup = null;
    this.options.elements.commandInput.oninput = null;
    this.commandHistory.clear();
    this.outputHistory.length = 0;
    this.options.elements.commandLog.replaceChildren();
  }

  private async submit(): Promise<void> {
    const input = this.options.elements.commandInput.value.trim();
    if (!input || this.running) return;
    this.commandHistory.record(input);
    this.running = true;
    this.options.elements.commandInput.disabled = true;
    this.options.elements.commandStatus.dataset.state = 'running';
    this.options.elements.commandStatus.textContent = '执行中…';
    try {
      const execution = await this.options.execute(input);
      const { result } = execution;
      const state = result.success ? 'success' : 'error';
      const summary = result.success ? result.message : `${result.error.code} · ${result.error.message}`;
      this.outputHistory.push({ input, state, summary });
      if (this.outputHistory.length > HISTORY_LIMIT) this.outputHistory.shift();
      this.renderHistory();
      this.options.elements.commandStatus.dataset.state = state;
      this.options.elements.commandStatus.textContent = `${state === 'success' ? '成功' : '错误'} · ${summary}`;
      this.options.elements.commandInput.value = '';
    } finally {
      this.running = false;
      this.options.elements.commandInput.disabled = false;
      if (this.isOpen) this.options.elements.commandInput.focus();
    }
  }

  private renderHistory(): void {
    const fragment = document.createDocumentFragment();
    this.outputHistory.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'debug-command-entry';
      row.dataset.state = entry.state;
      const command = document.createElement('code');
      command.textContent = `› ${entry.input}`;
      const output = document.createElement('span');
      output.textContent = entry.summary;
      row.append(command, output);
      fragment.append(row);
    });
    this.options.elements.commandLog.replaceChildren(fragment);
    this.options.elements.commandLog.scrollTop = this.options.elements.commandLog.scrollHeight;
  }

  private replaceInput(value: string): void {
    const input = this.options.elements.commandInput;
    input.value = value;
    input.setSelectionRange(value.length, value.length);
  }
}
