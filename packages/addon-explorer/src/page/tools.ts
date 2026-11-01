// Where the copied entry goes: the reader's own agent. The Markdown is the same for every tool; the choice
// names the button and, for a tool with a web chat, offers to open it. Remembered in this browser.
export interface Tool {
  id: string;
  name: string;
  /** The tool's chat, when it has one on the web. */
  url?: string;
}

export const tools: Tool[] = [
  { id: 'agent', name: 'any agent' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'copilot', name: 'Copilot' },
  { id: 'cursor', name: 'Cursor' },
];

const key = 'dbtour.tool';

export function toolById(id: string | null | undefined): Tool {
  return tools.find((t) => t.id === id) ?? tools[0];
}

export function storedTool(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Tool {
  try {
    return toolById(storage?.getItem(key));
  } catch {
    return tools[0];
  }
}

export function rememberTool(id: string, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(key, toolById(id).id);
  } catch {
    // A browser that refuses storage still copies; it just forgets the choice.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
