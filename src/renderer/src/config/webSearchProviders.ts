import type { WebSearchProvider, WebSearchProviderId } from '@renderer/types'

type WebSearchProviderConfig = {
  websites: {
    official: string
    apiKey?: string
  }
}

export const WEB_SEARCH_PROVIDER_CONFIG: Partial<Record<WebSearchProviderId, WebSearchProviderConfig>> = {
  'local-google': {
    websites: {
      official: 'https://www.google.com'
    }
  }
} as const

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  {
    id: 'local-google',
    name: 'Google',
    url: 'https://www.google.com/search?q=%s'
  }
] as const
