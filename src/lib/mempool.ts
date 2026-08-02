import type { FeeRates, Transaction, UTXO } from '../types'

// Supported API providers
export type ApiProvider = 'mempool' | 'blockstream'

// API base URLs (via Vite proxy in dev/preview)
const API_ENDPOINTS: Record<ApiProvider, string> = {
  mempool: '/api/mempool',
  blockstream: '/api/blockstream',
}

const DEFAULT_FALLBACK_PROVIDER: ApiProvider = 'blockstream'
const FALLBACK_DURATION_MS = 5 * 60 * 1000 // 5 minutes

// Preferred provider (can be changed at runtime)
let preferredProvider: ApiProvider = 'mempool'
let preferredApiBase: string | null = null
let configuredFallbackProvider: ApiProvider | null = DEFAULT_FALLBACK_PROVIDER
let configuredFallbackApiBase: string | null = null
let fallbackProvider: ApiProvider | null = null
let fallbackUntil = 0

type ApiConfig = {
  provider: ApiProvider
  apiBaseUrl?: string
  fallbackProvider?: ApiProvider
  fallbackApiBaseUrl?: string
}

export function setApiConfig(config: ApiConfig) {
  preferredProvider = config.provider
  preferredApiBase = normalizeApiBase(config.apiBaseUrl)

  const defaultFallback = preferredProvider === DEFAULT_FALLBACK_PROVIDER
    ? null
    : DEFAULT_FALLBACK_PROVIDER
  const desiredFallback = config.fallbackProvider ?? defaultFallback

  configuredFallbackProvider = normalizeFallbackProvider(desiredFallback, preferredProvider)
  configuredFallbackApiBase = configuredFallbackProvider
    ? normalizeApiBase(config.fallbackApiBaseUrl)
    : null

  fallbackProvider = null
  fallbackUntil = 0
}

export function setApiProvider(provider: ApiProvider, apiBaseUrl?: string) {
  setApiConfig({ provider, apiBaseUrl })
}

export function getApiProvider(): ApiProvider {
  return getActiveProvider()
}

function getActiveProvider(): ApiProvider {
  if (fallbackProvider && Date.now() < fallbackUntil) {
    return fallbackProvider
  }
  fallbackProvider = null
  fallbackUntil = 0
  return preferredProvider
}

function markProviderFailure(provider: ApiProvider) {
  if (provider !== preferredProvider) {
    return
  }
  if (!configuredFallbackProvider) {
    return
  }
  fallbackProvider = configuredFallbackProvider
  fallbackUntil = Date.now() + FALLBACK_DURATION_MS
}

function shouldFailover(response: Response): boolean {
  return response.status >= 500 || response.status === 429
}

function normalizeFallbackProvider(
  provider: ApiProvider | null | undefined,
  preferred: ApiProvider
): ApiProvider | null {
  if (!provider) return null
  if (provider === preferred) return null
  return provider
}

function normalizeApiBase(apiBaseUrl?: string): string | null {
  if (!apiBaseUrl) return null
  const trimmed = apiBaseUrl.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/$/, '')
}

function getProviderBase(provider: ApiProvider): string {
  if (provider === preferredProvider && preferredApiBase) {
    return preferredApiBase
  }
  if (provider === configuredFallbackProvider && configuredFallbackApiBase) {
    return configuredFallbackApiBase
  }
  return API_ENDPOINTS[provider]
}

async function fetchFromProvider(
  provider: ApiProvider,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${getProviderBase(provider)}${path}`, init)
}

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  const provider = getActiveProvider()
  try {
    const response = await fetchFromProvider(provider, path, init)
    if (!response.ok && provider === preferredProvider && configuredFallbackProvider && shouldFailover(response)) {
      markProviderFailure(provider)
      return fetchFromProvider(configuredFallbackProvider, path, init)
    }
    return response
  } catch (error) {
    if (provider === preferredProvider && configuredFallbackProvider) {
      markProviderFailure(provider)
      return fetchFromProvider(configuredFallbackProvider, path, init)
    }
    throw error
  }
}

// --- Rate-limited fetch queue ---

const MIN_REQUEST_INTERVAL = 500 // ms between requests per provider
const MAX_RETRIES = 3
const INITIAL_BACKOFF = 1000

// Track last request time per provider
const lastRequestTime: Record<string, number> = {}

async function waitForRateLimit(provider: ApiProvider): Promise<void> {
  const now = Date.now()
  const last = lastRequestTime[provider] || 0
  const elapsed = now - last
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed))
  }
  lastRequestTime[provider] = Date.now()
}

/**
 * Rate-limited fetch with exponential backoff on 429.
 * Tries fallback provider before backing off.
 */
async function rateLimitedFetch(
  path: string,
  provider?: ApiProvider,
  init?: RequestInit
): Promise<Response> {
  const primary = provider ?? getActiveProvider()
  let backoff = INITIAL_BACKOFF

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForRateLimit(primary)
    try {
      const response = await fetchFromProvider(primary, path, init)

      if (response.status === 429) {
        // Try fallback provider before backing off
        const fallback = configuredFallbackProvider && configuredFallbackProvider !== primary
          ? configuredFallbackProvider
          : null
        if (fallback && attempt === 0) {
          await waitForRateLimit(fallback)
          const fallbackResponse = await fetchFromProvider(fallback, path, init)
          if (fallbackResponse.ok || fallbackResponse.status !== 429) {
            return fallbackResponse
          }
        }

        if (attempt < MAX_RETRIES) {
          console.warn(`429 rate limited on ${primary}, backing off ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
          await new Promise(r => setTimeout(r, backoff))
          backoff *= 2
          continue
        }
      }

      return response
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, backoff))
        backoff *= 2
        continue
      }
      throw error
    }
  }

  // Should not reach here, but satisfy TypeScript
  return fetchFromProvider(primary, path, init)
}

type FeeRatesError = Error & { response?: Response }

async function fetchFeeRatesFrom(provider: ApiProvider): Promise<FeeRates> {
  const response = await fetchFromProvider(
    provider,
    provider === 'blockstream' ? '/fee-estimates' : '/v1/fees/recommended'
  )
  if (!response.ok) {
    const error: FeeRatesError = new Error('Failed to fetch fee rates')
    error.response = response
    throw error
  }
  const data = await response.json()
  if (provider === 'blockstream') {
    return {
      rapid: Math.ceil(data['1'] || 10),
      normal: Math.ceil(data['3'] || 5),
      slow: Math.ceil(data['6'] || 2),
    }
  }
  return {
    rapid: Math.ceil(data.fastestFee || 10),
    normal: Math.ceil(data.halfHourFee || 5),
    slow: Math.ceil(data.hourFee || 2),
  }
}

/**
 * Fetch recommended fee rates
 */
export async function getFeeRates(): Promise<FeeRates> {
  const provider = getActiveProvider()
  try {
    return await fetchFeeRatesFrom(provider)
  } catch (error) {
    const response = (error as FeeRatesError).response
    if (provider === preferredProvider && configuredFallbackProvider && (!response || shouldFailover(response))) {
      markProviderFailure(provider)
      return fetchFeeRatesFrom(configuredFallbackProvider)
    }
    throw error
  }
}

// Cache for UTXO results (address -> { utxos, timestamp })
const utxoCache = new Map<string, { utxos: UTXO[]; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute cache

/**
 * Fetch UTXOs for an address (with caching)
 */
export async function getAddressUtxos(address: string, useCache = true): Promise<UTXO[]> {
  // Check cache first
  if (useCache) {
    const cached = utxoCache.get(address)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.utxos
    }
  }

  const response = await rateLimitedFetch(`/address/${address}/utxo`)
  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited - return cached if available, otherwise empty
      const cached = utxoCache.get(address)
      return cached?.utxos || []
    }
    throw new Error(`Failed to fetch UTXOs for ${address}`)
  }

  const data = await response.json()

  const utxos = data.map((utxo: { txid: string; vout: number; value: number; status: { confirmed: boolean } }) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    value: utxo.value,
    confirmed: utxo.status.confirmed,
  }))

  // Update cache
  utxoCache.set(address, { utxos, timestamp: Date.now() })

  return utxos
}

/**
 * Clear the UTXO cache
 */
export function clearUtxoCache() {
  utxoCache.clear()
}

/**
 * Fetch UTXOs for a specific list of addresses (no gap-limit scanning).
 * Uses both providers in parallel when available.
 */
export async function fetchUtxosForAddresses(
  addresses: string[]
): Promise<Map<string, UTXO[]>> {
  const result = new Map<string, UTXO[]>()
  if (addresses.length === 0) return result

  const primary = getActiveProvider()
  const fallback = configuredFallbackProvider && configuredFallbackProvider !== primary
    ? configuredFallbackProvider
    : null

  // Process in pairs if we have two providers, otherwise one at a time
  const step = fallback ? 2 : 1
  for (let i = 0; i < addresses.length; i += step) {
    const batch: Array<Promise<{ address: string; utxos: UTXO[] }>> = []

    batch.push(
      fetchUtxosFromProvider(addresses[i], primary, false)
        .then(utxos => ({ address: addresses[i], utxos }))
        .catch(() => ({ address: addresses[i], utxos: [] as UTXO[] }))
    )

    if (fallback && i + 1 < addresses.length) {
      batch.push(
        fetchUtxosFromProvider(addresses[i + 1], fallback, false)
          .then(utxos => ({ address: addresses[i + 1], utxos }))
          .catch(() => ({ address: addresses[i + 1], utxos: [] as UTXO[] }))
      )
    }

    const results = await Promise.all(batch)
    for (const r of results) {
      if (r.utxos.length > 0) {
        result.set(r.address, r.utxos)
      }
    }
  }

  return result
}

/**
 * Refresh UTXOs for a single address (bypasses cache).
 * Tries preferred provider first, falls back on failure.
 */
export async function refreshSingleAddressUtxos(address: string): Promise<UTXO[]> {
  const providers: ApiProvider[] = [getActiveProvider()]
  if (configuredFallbackProvider && configuredFallbackProvider !== providers[0]) {
    providers.push(configuredFallbackProvider)
  }

  for (const provider of providers) {
    try {
      await waitForRateLimit(provider)
      const response = await fetchFromProvider(provider, `/address/${address}/utxo`)
      if (!response.ok) {
        if (response.status === 429 && providers.length > 1) continue
        throw new Error(`Failed to fetch UTXOs for ${address} (status ${response.status})`)
      }

      const data = await response.json()
      const utxos: UTXO[] = data.map((utxo: { txid: string; vout: number; value: number; status: { confirmed: boolean } }) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        confirmed: utxo.status.confirmed,
      }))

      // Update cache
      utxoCache.set(address, { utxos, timestamp: Date.now() })
      return utxos
    } catch (e) {
      if (provider === providers[providers.length - 1]) throw e
      console.warn(`refreshSingleAddressUtxos: ${provider} failed, trying fallback`, e)
    }
  }

  throw new Error(`Failed to refresh UTXOs for ${address}`)
}

/**
 * Fetch UTXOs for an address using rate-limited fetch (for bulk scans).
 * Uses a specific provider when provided.
 */
async function fetchUtxosFromProvider(
  address: string,
  provider: ApiProvider,
  useCache = true
): Promise<UTXO[]> {
  if (useCache) {
    const cached = utxoCache.get(address)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.utxos
    }
  }

  const response = await rateLimitedFetch(`/address/${address}/utxo`, provider)
  if (!response.ok) {
    if (response.status === 429) {
      const cached = utxoCache.get(address)
      return cached?.utxos || []
    }
    throw new Error(`Failed to fetch UTXOs for ${address}`)
  }

  const data = await response.json()
  const utxos = data.map((utxo: { txid: string; vout: number; value: number; status: { confirmed: boolean } }) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    value: utxo.value,
    confirmed: utxo.status.confirmed,
  }))

  utxoCache.set(address, { utxos, timestamp: Date.now() })
  return utxos
}

/**
 * Smart address scanning - checks addresses in order until gap limit is reached.
 * Splits work across preferred and fallback providers when available.
 */
export async function scanAddresses(
  addresses: string[],
  gapLimit = 2
): Promise<{ usedAddresses: Map<string, UTXO[]>; nextUnusedIndex: number }> {
  const usedAddresses = new Map<string, UTXO[]>()
  let consecutiveEmpty = 0
  let nextUnusedIndex = 0

  const primary = getActiveProvider()
  const fallback = configuredFallbackProvider && configuredFallbackProvider !== primary
    ? configuredFallbackProvider
    : null

  // If we have two providers, scan in pairs (even→primary, odd→fallback)
  if (fallback) {
    try {
      return await scanWithParallelProviders(addresses, gapLimit, primary, fallback)
    } catch (e) {
      console.warn('Parallel provider scan failed, falling back to sequential:', e)
      // Fall through to sequential scan
    }
  }

  // Sequential single-provider scan
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i]

    try {
      const utxos = await fetchUtxosFromProvider(address, primary)

      if (utxos.length > 0) {
        usedAddresses.set(address, utxos)
        consecutiveEmpty = 0
        nextUnusedIndex = i + 1
      } else {
        consecutiveEmpty++
        if (nextUnusedIndex === 0 || i < nextUnusedIndex) {
          nextUnusedIndex = i
        }
      }

      if (consecutiveEmpty >= gapLimit) {
        break
      }
    } catch (e) {
      console.warn(`Failed to fetch UTXOs for ${address}:`, e)
      consecutiveEmpty++
      if (consecutiveEmpty >= gapLimit * 2) {
        throw new Error(`Failed to scan addresses: ${e instanceof Error ? e.message : 'Network error'}`)
      }
    }
  }

  return { usedAddresses, nextUnusedIndex }
}

/**
 * Scan addresses using two providers in parallel.
 * Even-indexed addresses use providerA, odd-indexed use providerB.
 */
async function scanWithParallelProviders(
  addresses: string[],
  gapLimit: number,
  providerA: ApiProvider,
  providerB: ApiProvider
): Promise<{ usedAddresses: Map<string, UTXO[]>; nextUnusedIndex: number }> {
  const usedAddresses = new Map<string, UTXO[]>()
  const results: Array<{ index: number; utxos: UTXO[] }> = []

  // Process in pairs: fire both providers simultaneously
  for (let i = 0; i < addresses.length; i += 2) {
    const batch: Array<Promise<{ index: number; utxos: UTXO[] }>> = []

    // Even index → providerA
    batch.push(
      fetchUtxosFromProvider(addresses[i], providerA)
        .then(utxos => ({ index: i, utxos }))
        .catch(() => ({ index: i, utxos: [] as UTXO[] }))
    )

    // Odd index → providerB (if it exists)
    if (i + 1 < addresses.length) {
      batch.push(
        fetchUtxosFromProvider(addresses[i + 1], providerB)
          .then(utxos => ({ index: i + 1, utxos }))
          .catch(() => ({ index: i + 1, utxos: [] as UTXO[] }))
      )
    }

    const batchResults = await Promise.all(batch)
    results.push(...batchResults)

    // Check gap limit on sorted results so far
    results.sort((a, b) => a.index - b.index)
    let consecutiveEmpty = 0
    let shouldStop = false
    for (const r of results) {
      if (r.utxos.length > 0) {
        consecutiveEmpty = 0
      } else {
        consecutiveEmpty++
        if (consecutiveEmpty >= gapLimit) {
          shouldStop = true
          break
        }
      }
    }

    if (shouldStop) break
  }

  // Build final result from sorted results
  results.sort((a, b) => a.index - b.index)
  let nextUnusedIndex = 0
  for (const r of results) {
    if (r.utxos.length > 0) {
      usedAddresses.set(addresses[r.index], r.utxos)
      nextUnusedIndex = r.index + 1
    } else if (r.index < nextUnusedIndex || nextUnusedIndex === 0) {
      nextUnusedIndex = r.index
    }
  }

  return { usedAddresses, nextUnusedIndex }
}

/**
 * Get transaction hex for a txid
 */
export async function getTransactionHex(txid: string): Promise<string> {
  const response = await fetchWithFallback(`/tx/${txid}/hex`)
  if (!response.ok) throw new Error(`Failed to fetch tx hex for ${txid}`)
  return response.text()
}

/**
 * Fetch transaction history for addresses
 */
export async function getTransactionHistory(addresses: string[]): Promise<Transaction[]> {
  const allTxs: Transaction[] = []
  const seenTxids = new Set<string>()

  for (const address of addresses) {
    try {
      const response = await rateLimitedFetch(`/address/${address}/txs`)
      if (!response.ok) continue

      const txs = await response.json()

      for (const tx of txs) {
        if (seenTxids.has(tx.txid)) continue
        seenTxids.add(tx.txid)

        // Calculate net amount for this address
        let received = 0
        let sent = 0

        for (const vout of tx.vout) {
          if (vout.scriptpubkey_address === address) {
            received += vout.value
          }
        }

        for (const vin of tx.vin) {
          if (vin.prevout?.scriptpubkey_address === address) {
            sent += vin.prevout.value
          }
        }

        allTxs.push({
          txid: tx.txid,
          timestamp: tx.status.block_time || Date.now() / 1000,
          confirmed: tx.status.confirmed,
          amount: received - sent,
          fee: tx.fee,
        })
      }
    } catch {
      // Continue on error
    }
  }

  // Sort by timestamp descending
  return allTxs.sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Broadcast a raw transaction
 */
export async function broadcastTransaction(txHex: string): Promise<string> {
  const response = await fetchWithFallback('/tx', {
    method: 'POST',
    body: txHex,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Broadcast failed: ${error}`)
  }

  return response.text() // Returns txid
}

/**
 * Format satoshis to BTC string
 */
export function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8)
}

/**
 * Parse BTC string to satoshis
 */
export function btcToSats(btc: string): number {
  const val = parseFloat(btc)
  if (isNaN(val)) return 0
  return Math.round(val * 100_000_000)
}

/**
 * Fetch current BTC price in USD
 */
export async function getBtcPriceUsd(): Promise<number> {
  const provider = getActiveProvider()
  if (provider !== 'mempool') {
    throw new Error('BTC price unavailable for current provider')
  }

  try {
    const response = await fetchFromProvider('mempool', '/v1/prices')
    if (!response.ok) {
      if (shouldFailover(response)) {
        markProviderFailure('mempool')
      }
      throw new Error('Failed to fetch BTC price')
    }
    const data = await response.json()
    return data.USD
  } catch (error) {
    markProviderFailure('mempool')
    throw error
  }
}

/**
 * Get address stats including transaction count
 */
export async function getAddressStats(address: string): Promise<{ txCount: number; balance: number }> {
  const response = await fetchWithFallback(`/address/${address}`)
  if (!response.ok) throw new Error(`Failed to fetch stats for ${address}`)
  const data = await response.json()

  // Combine chain and mempool stats
  const chainTxCount = data.chain_stats?.tx_count || 0
  const mempoolTxCount = data.mempool_stats?.tx_count || 0
  const chainBalance = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0)
  const mempoolBalance = (data.mempool_stats?.funded_txo_sum || 0) - (data.mempool_stats?.spent_txo_sum || 0)

  return {
    txCount: chainTxCount + mempoolTxCount,
    balance: chainBalance + mempoolBalance,
  }
}

/**
 * Get stats for multiple addresses
 * Scans sequentially and stops after finding unused addresses (gap limit)
 */
export async function getAddressesStats(
  addresses: string[],
  gapLimit = 1
): Promise<Map<string, { txCount: number; balance: number }>> {
  const stats = new Map<string, { txCount: number; balance: number }>()
  let consecutiveUnused = 0

  for (const address of addresses) {
    try {
      const response = await rateLimitedFetch(`/address/${address}`)
      if (!response.ok) throw new Error(`Failed to fetch stats for ${address}`)
      const data = await response.json()

      const chainTxCount = data.chain_stats?.tx_count || 0
      const mempoolTxCount = data.mempool_stats?.tx_count || 0
      const chainBalance = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0)
      const mempoolBalance = (data.mempool_stats?.funded_txo_sum || 0) - (data.mempool_stats?.spent_txo_sum || 0)

      const addressStats = {
        txCount: chainTxCount + mempoolTxCount,
        balance: chainBalance + mempoolBalance,
      }
      stats.set(address, addressStats)

      if (addressStats.txCount === 0) {
        consecutiveUnused++
        if (consecutiveUnused >= gapLimit) {
          console.log(`Stopping scan after ${gapLimit} consecutive unused addresses`)
          break
        }
      } else {
        consecutiveUnused = 0
      }
    } catch (e) {
      console.warn(`Failed to fetch stats for ${address}:`, e)
      stats.set(address, { txCount: 0, balance: 0 })
      consecutiveUnused++
      if (consecutiveUnused >= gapLimit) {
        break
      }
    }
  }

  return stats
}
