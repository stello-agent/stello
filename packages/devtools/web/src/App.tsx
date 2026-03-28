import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { Sparkles, MessageSquare, Search, Activity, Settings, Globe, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { I18nContext, useI18n, useI18nProvider } from '@/lib/i18n'
import { ThemeContext, useTheme, useThemeProvider } from '@/lib/theme'
import { ToastContext, useToastProvider } from '@/lib/toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Topology } from '@/pages/Topology'
import { Conversation } from '@/pages/Conversation'
import { Inspector } from '@/pages/Inspector'
import { Events } from '@/pages/Events'
import { SettingsPage } from '@/pages/Settings'

/** 侧边栏导航项 */
const navItems = [
  { to: '/topology', icon: Sparkles, labelKey: 'nav.map' },
  { to: '/conversation', icon: MessageSquare, labelKey: 'nav.chat' },
  { to: '/inspector', icon: Search, labelKey: 'nav.inspect' },
  { to: '/events', icon: Activity, labelKey: 'nav.events' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
] as const

/** 侧边栏导航按钮 */
function NavItem({ to, icon: Icon, labelKey }: (typeof navItems)[number]) {
  const { t } = useI18n()
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group flex flex-col items-center justify-center gap-0.5 w-11 h-11 rounded-[10px]',
          'transition-all duration-200 ease-out',
          isActive
            ? 'bg-primary-light text-primary scale-105 shadow-sm'
            : 'text-text-muted hover:bg-muted hover:text-text-secondary hover:scale-105',
        )
      }
    >
      <Icon size={20} className="transition-transform duration-200 group-hover:scale-110" />
      <span className="text-[9px] font-medium transition-colors duration-200">{t(labelKey)}</span>
    </NavLink>
  )
}

/** 语言切换按钮 */
function LocaleSwitcher() {
  const { locale, setLocale } = useI18n()
  return (
    <button
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      className="flex items-center justify-center w-9 h-9 rounded-[10px] text-text-muted hover:bg-muted hover:text-text-secondary transition-all duration-200 hover:scale-105"
      title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      <Globe size={16} />
    </button>
  )
}

/** 主题切换按钮 */
function ThemeSwitcher() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-9 h-9 rounded-[10px] text-text-muted hover:bg-muted hover:text-text-secondary transition-all duration-200 hover:scale-105"
      title={theme === 'light' ? 'Dark mode' : 'Light mode'}
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}

/** 主应用布局 */
export function App() {
  const location = useLocation()
  const i18n = useI18nProvider()
  const themeCtx = useThemeProvider()
  const toast = useToastProvider()

  return (
    <ThemeContext.Provider value={themeCtx}>
      <I18nContext.Provider value={i18n}>
        <ToastContext.Provider value={toast.contextValue}>
          <div className="flex h-screen w-screen overflow-hidden">
            {/* 侧边栏 */}
            <nav className="flex flex-col items-center w-16 bg-card border-r border-border py-4 gap-2 shrink-0 transition-colors duration-200">
              <div className="flex items-center justify-center w-9 h-9 bg-primary rounded-[10px] mb-3 shadow-md transition-transform duration-200 hover:scale-110 cursor-pointer">
                <span className="text-white text-lg font-bold">S</span>
              </div>
              {navItems.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
              <div className="mt-auto flex flex-col gap-1">
                <ThemeSwitcher />
                <LocaleSwitcher />
              </div>
            </nav>

            {/* 主内容区 */}
            <main className="flex-1 min-w-0 overflow-hidden">
              <ErrorBoundary key={location.pathname}>
                <div className="h-full page-enter">
                  <Routes location={location}>
                    <Route path="/" element={<Navigate to="/topology" replace />} />
                    <Route path="/topology" element={<Topology />} />
                    <Route path="/conversation" element={<Conversation />} />
                    <Route path="/inspector" element={<Inspector />} />
                    <Route path="/events" element={<Events />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </div>
              </ErrorBoundary>
            </main>
          </div>
          {toast.viewport}
        </ToastContext.Provider>
      </I18nContext.Provider>
    </ThemeContext.Provider>
  )
}
