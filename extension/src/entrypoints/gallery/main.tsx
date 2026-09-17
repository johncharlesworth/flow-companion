import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles/app.css';

import { TooltipProvider } from '@/components/ui/tooltip';

import { SCREENS, SEEDS } from './screens';

const WIDTHS = [320, 400, 600] as const;
const THEMES = ['light', 'dark'] as const;
const HEIGHT = 640;

function Frame({ name, width, theme }: { name: string; width: number; theme: 'light' | 'dark' }) {
  const render = SCREENS[name];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-3">
        {width}px · {theme}
      </span>
      <div data-theme={theme} className="overflow-hidden rounded-[6px] bg-bg text-text-1 ring-1 ring-hairline" style={{ width, height: HEIGHT }}>
        <div className="h-full">{render ? render() : `Unknown screen: ${name}`}</div>
      </div>
    </div>
  );
}

function Sheet({ name }: { name: string }) {
  return (
    <div id="sheet" data-sheet-ready="true" className="inline-flex flex-col gap-4 bg-bg p-4">
      <h1 className="text-[15px] font-semibold">{name}</h1>
      {THEMES.map((theme) => (
        <div key={theme} className="flex items-start gap-4">
          {WIDTHS.map((width) => (
            <Frame key={width} name={name} width={width} theme={theme} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Index() {
  return (
    <div className="p-4">
      <h1 className="text-[15px] font-semibold">Flow Companion screens</h1>
      <ul className="mt-2 list-disc pl-5">
        {Object.keys(SCREENS).map((name) => (
          <li key={name}>
            <a className="text-accent underline" href={`?screen=${name}`}>
              {name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const params = new URLSearchParams(location.search);
const screen = params.get('screen');
void (async () => {
  if (screen && SEEDS[screen]) await SEEDS[screen]!();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TooltipProvider>{screen ? <Sheet name={screen} /> : <Index />}</TooltipProvider>
    </StrictMode>,
  );
})();
