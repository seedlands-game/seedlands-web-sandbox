export class CommandHistory {
  private readonly commands: string[] = [];
  private cursor = 0;
  private draft = '';

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Command history limit must be a positive integer.');
    }
  }

  record(command: string): void {
    this.commands.push(command);
    if (this.commands.length > this.limit) this.commands.shift();
    this.resetNavigation();
  }

  previous(currentInput = ''): string {
    if (this.commands.length === 0) return currentInput;
    if (this.cursor === this.commands.length) this.draft = currentInput;
    if (this.cursor > 0) this.cursor -= 1;
    return this.commands[this.cursor] ?? this.draft;
  }

  next(currentInput = this.draft): string {
    if (this.commands.length === 0 || this.cursor === this.commands.length) return currentInput;
    if (this.cursor < this.commands.length - 1) {
      this.cursor += 1;
      return this.commands[this.cursor] ?? this.draft;
    }
    this.cursor = this.commands.length;
    return this.draft;
  }

  resetNavigation(): void {
    this.cursor = this.commands.length;
    this.draft = '';
  }

  entries(): readonly string[] {
    return [...this.commands];
  }

  clear(): void {
    this.commands.length = 0;
    this.resetNavigation();
  }
}
