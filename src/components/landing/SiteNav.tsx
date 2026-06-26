'use client';

interface SiteNavProps {
  onGetStarted: () => void;
  showLinks?: boolean;
  onLogoClick?: (e: React.MouseEvent) => void;
}

const navItems = [
  { label: 'Home', href: '/', active: true },
  { label: 'Premium', href: '#' },
  { label: 'History', href: '#' },
  { label: 'API', href: '#' },
  { label: 'Blog', href: '#' },
];

export default function SiteNav({ onGetStarted, showLinks = true, onLogoClick }: SiteNavProps) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="brand" onClick={onLogoClick}>
          <span className="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden>
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </span>
          <span className="brand-name">
            <span className="brand-luxe">LUXE</span>
            <span className="brand-down">DOWN</span>
          </span>
        </a>

        {showLinks && (
          <nav className="header-nav" aria-label="Main">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`header-link${item.active ? ' header-link-active' : ''}`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}

        <div className="header-actions">
          <button type="button" className="btn-signin">Sign in</button>
          <button type="button" className="btn-elite" onClick={onGetStarted}>
            Join Elite
          </button>
        </div>
      </div>
    </header>
  );
}
