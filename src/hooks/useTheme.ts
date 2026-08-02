import { useState, useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark' | 'system'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('wallet-theme') as Theme | null
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      setThemeState(stored)
    }

    // Set initial resolved theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (stored === 'dark' || (!stored && prefersDark) || (stored === 'system' && prefersDark)) {
      document.documentElement.classList.add('dark')
      setResolvedTheme('dark')
    }
  }, [])

  // Update resolved theme and apply dark class
  useEffect(() => {
    const updateTheme = () => {
      let resolved: 'light' | 'dark'
      if (theme === 'system') {
        resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } else {
        resolved = theme
      }
      setResolvedTheme(resolved)

      if (resolved === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }

    updateTheme()

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        updateTheme()
      }
    }
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem('wallet-theme', newTheme)
  }, [])

  return { theme, setTheme, resolvedTheme }
}
