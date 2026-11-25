import type React from 'react'
import styled from 'styled-components'

interface FallbackFaviconProps {
  hostname: string
  alt: string
}

const FallbackFavicon: React.FC<FallbackFaviconProps> = ({ hostname, alt }) => {
  const normalizedHost = hostname.trim().replace(/^www\./i, '')
  const initial = (normalizedHost.charAt(0) || '?').toUpperCase()
  const label = alt || hostname

  return (
    <FaviconPlaceholder role="img" aria-label={label} title={label}>
      {initial}
    </FaviconPlaceholder>
  )
}

const FaviconPlaceholder = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--color-primary-1);
  color: var(--color-primary-6);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
`

export default FallbackFavicon
