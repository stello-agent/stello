import { createContext, useContext, useState, useCallback, useEffect } from 'react'

export type Theme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggle: () => {},
})

/** 消费端 hook——从 Context 读取 */
export function useTheme() {
  return useContext(ThemeContext)
}

/** Provider 端 hook——在 App 顶层调用一次，传给 ThemeContext.Provider */
export function useThemeProvider(): ThemeContextValue {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('stello-devtools-theme')
    return (saved === 'light' || saved === 'dark') ? saved : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem('stello-devtools-theme', t)
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [theme, setTheme])

  return { theme, setTheme, toggle }
}
