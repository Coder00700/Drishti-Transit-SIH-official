import { Link } from "wouter";
import { MapPinned, ArrowUpRight, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
export function PublicHeader() {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="preview-header">
      <Link href="/" className="preview-brand">
        <span className="preview-logo">
          <MapPinned size={22} />
        </span>
        <span>
          DRISHTI<small>Delhi road intelligence</small>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/">Overview</Link>
        <Link href="/gis">Live map</Link>
      </nav>
      <div className="preview-actions">
        <button
          type="button"
          className="theme-button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <Button asChild className="contributor-link">
          <Link href="/contribute/login">
            Contribute
            <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
    </header>
  );
}
