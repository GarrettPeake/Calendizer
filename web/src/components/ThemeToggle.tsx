import { SunIcon, MoonIcon } from './icons';

export type Theme = 'light' | 'dark';

export function ThemeToggle(props: { theme: Theme; onToggle: () => void }) {
  const next = props.theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="theme-toggle"
      onClick={props.onToggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {props.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
