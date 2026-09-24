import os from 'node:os'

import { platformRequestHeaders } from '@shared/cliIdentity'
import { inferProviderPlatform } from '@shared/platforms'
import { providerRequestBase } from '@shared/providerImport'
import type { Provider } from '@types'

export async function formatProviderApiHost(provider: Provider): Promise<Provider> {
  return {
    ...provider,
    apiHost: providerRequestBase(provider.apiHost),
    extra_headers: platformRequestHeaders(
      inferProviderPlatform(provider),
      provider.cliVersion,
      provider.extra_headers,
      `${os.type()} ${os.release()}; ${os.arch()}`
    )
  }
}
