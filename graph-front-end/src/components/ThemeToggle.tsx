import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('chatlab-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatlab-theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggle };
}

export function ThemeToggle(props: { theme: Theme; onToggle: () => void }) {
  const isDark = props.theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={props.onToggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <span className={`theme-toggle-icon ${isDark ? 'moon' : 'sun'}`}>
        {isDark ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M14 8.5a6 6 0 0 1-7.5 5.82A6 6 0 0 1 6.18 2 6 6 0 0 0 14 8.5Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" fill="currentColor" />
            <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="8" y1="1" x2="8" y2="2.5" />
              <line x1="8" y1="13.5" x2="8" y2="15" />
              <line x1="1" y1="8" x2="2.5" y2="8" />
              <line x1="13.5" y1="8" x2="15" y2="8" />
              <line x1="3.05" y1="3.05" x2="4.11" y2="4.11" />
              <line x1="11.89" y1="11.89" x2="12.95" y2="12.95" />
              <line x1="3.05" y1="12.95" x2="4.11" y2="11.89" />
              <line x1="11.89" y1="4.11" x2="12.95" y2="3.05" />
            </g>
          </svg>
        )}
      </span>
    </button>
  );
}
