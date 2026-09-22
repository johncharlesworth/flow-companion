import { ExternalLink, type LucideIcon } from 'lucide-react';

import { Button } from './ui/button';

// The one component for every empty, waiting, and error state: an icon in a
// soft disc, a title, one sentence, one primary action, and at most one quiet
// link out under it.
export interface PanelStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  /** A quieter 12px line under the sentence (the data disclosure, for example). */
  note?: string;
  action?: { label: string; onClick: () => void };
  /** A quiet way out under the action, opened in a new tab; `note` is the 12px line beneath it. */
  link?: { label: string; href: string; note?: string };
}

export function PanelState({ icon: Icon, title, body, note, action, link }: PanelStateProps) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center" aria-live="polite">
      <div className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-accent-subtle">
        <Icon className="h-8 w-8 text-accent" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="text-[15px] font-semibold text-text-1">{title}</h2>
      <p className="mt-1 max-w-[42ch] text-text-2">{body}</p>
      {note && <p className="mt-3 max-w-[42ch] text-xs text-text-3">{note}</p>}
      {action && (
        <Button className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {link && (
        <>
          <a href={link.href} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-[14px] text-accent">
            {link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          {link.note && <p className="mt-1 text-xs text-text-3">{link.note}</p>}
        </>
      )}
    </section>
  );
}
