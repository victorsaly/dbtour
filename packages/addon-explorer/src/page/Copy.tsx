// Copying to the clipboard: the helper the entry's "Copy for …" uses, and the Copy button a definition has.
import { useState } from 'react';

/** How long a button says "Copied" before it offers to copy again. */
export const copiedForMs = 1500;

/** True when the text reached the clipboard; the old way answers false rather than throwing when refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The clipboard API is refused on some file: pages; the old way still works.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    try {
      area.select();
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** A button that copies `text` and says so for a moment, or says the clipboard refused. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'refused'>('idle');
  const copy = async () => {
    setState((await copyText(text)) ? 'copied' : 'refused');
    setTimeout(() => setState('idle'), copiedForMs);
  };
  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Copied' : state === 'refused' ? 'Clipboard refused' : 'Copy'}
    </button>
  );
}
