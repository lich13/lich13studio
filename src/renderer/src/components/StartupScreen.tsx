import AppLogo from '@renderer/assets/images/logo.png'
import type { CSSProperties, FC } from 'react'
import { useEffect } from 'react'

const getContainerStyle = (): CSSProperties => ({
  alignItems: 'center',
  backgroundColor:
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? '#181818'
      : '#ffffff',
  display: 'flex',
  height: '100vh',
  justifyContent: 'center',
  left: 0,
  position: 'fixed',
  top: 0,
  width: '100vw'
})

const logoStyle: CSSProperties = {
  borderRadius: 50,
  height: 100,
  width: 100
}

const StartupScreen: FC = () => {
  useEffect(() => {
    document.getElementById('spinner')?.remove()
  }, [])

  return (
    <div style={getContainerStyle()}>
      <img src={AppLogo} alt="lich13studio" draggable={false} style={logoStyle} />
    </div>
  )
}

export default StartupScreen
